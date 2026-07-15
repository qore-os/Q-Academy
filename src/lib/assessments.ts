import "server-only";

import { createHash } from "node:crypto";
import { and, desc, eq, isNotNull, isNull, or } from "drizzle-orm";

import { db } from "@/db";
import {
  activityEvents,
  assessmentAnswers,
  assessmentAttempts,
  courses,
  enrollments,
  users,
  type AssessmentQuestionSnapshot,
  type ContentBlockData,
  type CourseVersionSnapshot,
} from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import {
  buildAssessmentQuestionSnapshot,
  compatibleAssessmentSnapshots,
  evaluateAssessmentAnswer,
  isAssessmentQuestionType,
  type AssessmentAnswerInput,
  type CurrentAssessmentDefinition,
} from "@/lib/assessment-engine";
import { getCourseLearningAccess } from "@/lib/learning-access";
import { examDefinitionHash } from "@/lib/exam-lifecycle-policy";
import {
  findSnapshotLesson,
  getPublishedCourseContent,
} from "@/lib/published-course";
import { lockMemberCourseProgress } from "@/lib/progress-lock";
import {
  legacyCompatibleAssessmentResultIsReleased,
  pendingAssessmentAttemptView,
} from "@/lib/assessment-release-policy";

export { redactAssessmentAnswerKeys } from "@/lib/assessment-engine";
export type { AssessmentAnswerInput } from "@/lib/assessment-engine";

type AssessmentReader = Pick<typeof db, "select">;
type AssessmentDefinition = CurrentAssessmentDefinition;

type QuestionRow = {
  id: string;
  type: string;
  title: string | null;
  required: boolean;
  data: ContentBlockData;
};

function questionSnapshot(question: QuestionRow): AssessmentQuestionSnapshot {
  const snapshot = buildAssessmentQuestionSnapshot(question);
  if (!snapshot) {
    throw new ApiError(
      422,
      "validation_error",
      "Mindestens eine Quizfrage ist nicht gueltig konfiguriert.",
      { blockId: question.id },
    );
  }

  return snapshot;
}

function lessonQuestionRows(
  snapshot: CourseVersionSnapshot,
  lessonId: string,
) {
  const resolved = findSnapshotLesson(snapshot, lessonId);
  if (!resolved || resolved.lesson.status !== "published") return null;
  const rows = [
    ...resolved.lesson.blocks,
    ...resolved.lesson.pages
      .filter((page) => page.status === "published")
      .flatMap((page) => page.blocks),
  ].sort(
      (left, right) =>
        left.sortOrder - right.sortOrder || left.id.localeCompare(right.id),
    );
  return {
    lesson: resolved.lesson,
    allRows: rows,
    rows: rows.filter((block) => isAssessmentQuestionType(block.type)),
  };
}

function normalizedAssessmentConfiguration(
  lesson: CourseVersionSnapshot["modules"][number]["lessons"][number],
) {
  const passingScore = Number.isInteger(lesson.passingScore)
    ? Number(lesson.passingScore)
    : 100;
  const maxAttempts = Number.isInteger(lesson.maxAttempts)
    ? Number(lesson.maxAttempts)
    : null;
  return {
    passingScore:
      passingScore >= 1 && passingScore <= 100 ? passingScore : 100,
    maxAttempts:
      maxAttempts !== null && maxAttempts >= 1 && maxAttempts <= 100
        ? maxAttempts
        : null,
    shuffleQuestions: lesson.shuffleQuestions === true,
  };
}

function assessmentDefinition(
  snapshot: CourseVersionSnapshot,
  lessonId: string,
  requiredOnly: boolean,
) {
  const resolved = lessonQuestionRows(snapshot, lessonId);
  if (!resolved) return null;
  const questions = resolved.rows
    .filter((question) => !requiredOnly || question.required)
    .map(questionSnapshot);
  return {
    schemaVersion: 3,
    ...normalizedAssessmentConfiguration(resolved.lesson),
    questions,
  } satisfies AssessmentDefinition;
}

function submissionDefinition(
  snapshot: CourseVersionSnapshot,
  lessonId: string,
) {
  const required = assessmentDefinition(snapshot, lessonId, true);
  if (!required) return null;
  return required.questions.length
    ? required
    : assessmentDefinition(snapshot, lessonId, false);
}

export function publishedAssessmentLifecycleSource(
  snapshot: CourseVersionSnapshot,
  lessonId: string,
) {
  const resolved = lessonQuestionRows(snapshot, lessonId);
  const definition = submissionDefinition(snapshot, lessonId);
  if (!resolved || !definition) return null;
  const definitionIds = new Set(
    definition.questions.map((question) => question.blockId),
  );
  return {
    lesson: resolved.lesson,
    definition,
    questionRows: resolved.rows.filter((row) => definitionIds.has(row.id)),
    supplementalRows: resolved.allRows.filter(
      (row) => row.type === "submission" && row.required,
    ),
  };
}

function matchingDefinitionCondition(definition: AssessmentDefinition) {
  const conditions = compatibleAssessmentSnapshots(definition).map(
    (snapshot) => eq(assessmentAttempts.assessmentSnapshot, snapshot),
  );
  return or(...conditions)!;
}

function matchingLifecycleDefinitionCondition(
  definition: AssessmentDefinition,
  definitionHash: string,
) {
  return or(
    eq(assessmentAttempts.definitionHash, definitionHash),
    and(
      isNull(assessmentAttempts.definitionHash),
      matchingDefinitionCondition(definition),
    ),
  )!;
}

function shuffledQuestionIds(
  definition: AssessmentDefinition,
  input: {
    organizationId: string;
    userId: string;
    courseId: string;
    lessonId: string;
    nextAttempt: number;
  },
) {
  const ids = definition.questions.map((question) => question.blockId);
  if (!definition.shuffleQuestions || ids.length < 2) return ids;
  const seed = [
    input.organizationId,
    input.userId,
    input.courseId,
    input.lessonId,
    String(input.nextAttempt),
    JSON.stringify(definition),
  ].join(":");
  return [...ids].sort((left, right) => {
    const leftHash = createHash("sha256")
      .update(`${seed}:${left}`)
      .digest("hex");
    const rightHash = createHash("sha256")
      .update(`${seed}:${right}`)
      .digest("hex");
    return leftHash.localeCompare(rightHash) || left.localeCompare(right);
  });
}

export async function getPublishedAssessmentOverview(
  reader: AssessmentReader,
  input: {
    organizationId: string;
    userId: string;
    courseId: string;
    lessonId: string;
    snapshot: CourseVersionSnapshot;
  },
) {
  const definition = submissionDefinition(input.snapshot, input.lessonId);
  const lifecycleExam =
    findSnapshotLesson(input.snapshot, input.lessonId)?.lesson.type === "exam";
  const lifecycleSource = lifecycleExam
    ? publishedAssessmentLifecycleSource(input.snapshot, input.lessonId)
    : null;
  const lifecycleDefinitionHash =
    lifecycleSource
      ? examDefinitionHash({
          lessonId: input.lessonId,
          definition: lifecycleSource.definition,
          configuration: {
            durationSeconds: lifecycleSource.lesson.examDurationSeconds,
            questionPools: lifecycleSource.lesson.examQuestionPools,
            resultReleaseMode:
              lifecycleSource.lesson.examResultReleaseMode,
            reviewReleaseMode:
              lifecycleSource.lesson.examReviewReleaseMode,
            contentAccessMode:
              lifecycleSource.lesson.examContentAccessMode,
          },
        })
      : null;
  const requiredDefinition = assessmentDefinition(
    input.snapshot,
    input.lessonId,
    true,
  );
  const requiredQuizCount = requiredDefinition?.questions.length ?? 0;
  if (!definition?.questions.length) {
    return {
      requiredQuizCount,
      passingScore: definition?.passingScore ?? 100,
      maxAttempts: definition?.maxAttempts ?? null,
      shuffleQuestions: definition?.shuffleQuestions ?? false,
      attemptsUsed: 0,
      attemptsRemaining: definition?.maxAttempts ?? null,
      maxAttemptsReached: false,
      passed: requiredQuizCount === 0,
      latestAttempt: null,
      pendingAttempt: null,
      questionOrder: [] as string[],
    };
  }

  const attempts = await reader
    .select({
      id: assessmentAttempts.id,
      attemptNumber: assessmentAttempts.attemptNumber,
      score: assessmentAttempts.score,
      passed: assessmentAttempts.passed,
      submittedAt: assessmentAttempts.submittedAt,
      definitionHash: assessmentAttempts.definitionHash,
      resultReleasedAt: assessmentAttempts.resultReleasedAt,
      reviewReleasedAt: assessmentAttempts.reviewReleasedAt,
      deadlineAt: assessmentAttempts.deadlineAt,
      resultReleaseMode: assessmentAttempts.resultReleaseMode,
      reviewReleaseMode: assessmentAttempts.reviewReleaseMode,
    })
    .from(assessmentAttempts)
    .where(
      and(
        eq(assessmentAttempts.organizationId, input.organizationId),
        eq(assessmentAttempts.userId, input.userId),
        eq(assessmentAttempts.courseId, input.courseId),
        eq(assessmentAttempts.lessonId, input.lessonId),
        eq(assessmentAttempts.status, "graded"),
        lifecycleExam && lifecycleDefinitionHash
          ? matchingLifecycleDefinitionCondition(
              definition,
              lifecycleDefinitionHash,
            )
          : matchingDefinitionCondition(definition),
      ),
    )
    .orderBy(desc(assessmentAttempts.attemptNumber));
  const visibleAttempts = lifecycleExam
    ? attempts.filter(
        (attempt) =>
          legacyCompatibleAssessmentResultIsReleased(attempt),
      )
    : attempts;
  const latestAttempt = visibleAttempts[0] ?? null;
  const latestPassedAttempt =
    visibleAttempts.find((attempt) => attempt.passed) ?? null;
  const attemptsUsed = attempts.length;
  const attemptsRemaining =
    definition.maxAttempts === null
      ? null
      : Math.max(0, definition.maxAttempts - attemptsUsed);
  const assessmentPassed = Boolean(latestPassedAttempt);
  const resultPending = lifecycleExam && visibleAttempts.length < attempts.length;
  const pendingAttempt = lifecycleExam
    ? attempts
        .filter(
          (attempt) =>
            lifecycleDefinitionHash !== null &&
            attempt.definitionHash === lifecycleDefinitionHash,
        )
        .map((attempt) => pendingAssessmentAttemptView({
          ...attempt,
          status: "graded",
        }))
        .find((attempt) => attempt !== null) ?? null
    : null;
  const selectedLatestAttempt =
    (assessmentPassed ? latestPassedAttempt : latestAttempt) ?? null;

  return {
    requiredQuizCount,
    passingScore: definition.passingScore,
    maxAttempts: definition.maxAttempts,
    shuffleQuestions: definition.shuffleQuestions,
    attemptsUsed,
    attemptsRemaining,
    maxAttemptsReached:
      !assessmentPassed &&
      definition.maxAttempts !== null &&
      attemptsUsed >= definition.maxAttempts,
    passed: resultPending && !assessmentPassed
      ? null
      : requiredQuizCount > 0
        ? assessmentPassed
        : Boolean(latestAttempt?.passed),
    latestAttempt: selectedLatestAttempt
      ? {
          id: selectedLatestAttempt.id,
          attemptNumber: selectedLatestAttempt.attemptNumber,
          score: selectedLatestAttempt.score,
          passed: selectedLatestAttempt.passed,
          submittedAt: selectedLatestAttempt.submittedAt,
        }
      : null,
    pendingAttempt,
    questionOrder: lifecycleExam
      ? []
      : shuffledQuestionIds(definition, {
          ...input,
          nextAttempt: attemptsUsed + 1,
        }),
  };
}

export async function hasPassedRequiredQuiz(
  reader: AssessmentReader,
  input: {
    organizationId: string;
    userId: string;
    courseId: string;
    lessonId: string;
  },
) {
  const published = await getPublishedCourseContent(reader, {
    organizationId: input.organizationId,
    courseId: input.courseId,
  });
  if (!published) return false;
  const definition = assessmentDefinition(
    published.snapshot,
    input.lessonId,
    true,
  );
  if (!definition) return false;
  if (!definition.questions.length) return true;
  const lifecycleExam =
    findSnapshotLesson(published.snapshot, input.lessonId)?.lesson.type ===
    "exam";
  const lifecycleSource = lifecycleExam
    ? publishedAssessmentLifecycleSource(published.snapshot, input.lessonId)
    : null;
  const lifecycleDefinitionHash = lifecycleSource
    ? examDefinitionHash({
        lessonId: input.lessonId,
        definition: lifecycleSource.definition,
        configuration: {
          durationSeconds: lifecycleSource.lesson.examDurationSeconds,
          questionPools: lifecycleSource.lesson.examQuestionPools,
          resultReleaseMode: lifecycleSource.lesson.examResultReleaseMode,
          reviewReleaseMode: lifecycleSource.lesson.examReviewReleaseMode,
          contentAccessMode: lifecycleSource.lesson.examContentAccessMode,
        },
      })
    : null;

  const [passed] = await reader
    .select({ id: assessmentAttempts.id })
    .from(assessmentAttempts)
    .where(
      and(
        eq(assessmentAttempts.organizationId, input.organizationId),
        eq(assessmentAttempts.userId, input.userId),
        eq(assessmentAttempts.courseId, input.courseId),
        eq(assessmentAttempts.lessonId, input.lessonId),
        eq(assessmentAttempts.status, "graded"),
        eq(assessmentAttempts.passed, true),
        ...(lifecycleExam
          ? [
              or(
                isNull(assessmentAttempts.definitionHash),
                isNotNull(assessmentAttempts.resultReleasedAt),
              )!,
            ]
          : []),
        lifecycleExam && lifecycleDefinitionHash
          ? matchingLifecycleDefinitionCondition(
              definition,
              lifecycleDefinitionHash,
            )
          : matchingDefinitionCondition(definition),
      ),
    )
    .limit(1);
  return Boolean(passed);
}

export async function submitAssessmentAttempt(input: {
  organizationId: string;
  userId: string;
  courseId: string;
  lessonId: string;
  answers: AssessmentAnswerInput[];
}) {
  return db.transaction(async (transaction) => {
    await lockMemberCourseProgress(transaction, input);
    const [access] = await transaction
      .select({ enrollmentId: enrollments.id })
      .from(enrollments)
      .innerJoin(
        users,
        and(
          eq(users.id, enrollments.userId),
          eq(users.organizationId, input.organizationId),
          eq(users.status, "active"),
        ),
      )
      .innerJoin(
        courses,
        and(
          eq(courses.id, enrollments.courseId),
          eq(courses.organizationId, input.organizationId),
        ),
      )
      .where(
        and(
          eq(enrollments.userId, input.userId),
          eq(enrollments.courseId, input.courseId),
          eq(enrollments.accessActive, true),
        ),
      )
      .limit(1)
      .for("update", { of: enrollments });
    if (!access) {
      throw new ApiError(
        404,
        "not_found",
        "Mitglied oder Kurseinschreibung wurde nicht gefunden.",
      );
    }

    const learningAccess = await getCourseLearningAccess(transaction, {
      organizationId: input.organizationId,
      userId: input.userId,
      courseId: input.courseId,
    });
    const accessibleLesson = learningAccess?.lessons.get(input.lessonId);
    if (!learningAccess || !accessibleLesson?.access.canInteract) {
      throw new ApiError(404, "not_found", "Quizlektion nicht gefunden.");
    }
    if (accessibleLesson.lesson.type === "exam") {
      throw new ApiError(
        409,
        "conflict",
        "Pruefungen muessen ueber den Start-/Fortsetzen-Ablauf bearbeitet werden.",
      );
    }

    const definition = submissionDefinition(
      learningAccess.published.snapshot,
      input.lessonId,
    );
    if (!definition?.questions.length) {
      throw new ApiError(
        422,
        "validation_error",
        "Diese Lektion enthaelt kein Quiz.",
      );
    }

    const [activeLifecycleAttempt] = await transaction
      .select({ id: assessmentAttempts.id })
      .from(assessmentAttempts)
      .where(
        and(
          eq(assessmentAttempts.organizationId, input.organizationId),
          eq(assessmentAttempts.userId, input.userId),
          eq(assessmentAttempts.courseId, input.courseId),
          eq(assessmentAttempts.lessonId, input.lessonId),
          or(
            eq(assessmentAttempts.status, "in_progress"),
            eq(assessmentAttempts.status, "submitted"),
          ),
        ),
      )
      .limit(1);
    if (activeLifecycleAttempt) {
      throw new ApiError(
        409,
        "conflict",
        "Diese Pruefung besitzt bereits einen aktiven Versuch.",
        { activeAttemptId: activeLifecycleAttempt.id },
      );
    }

    const currentAttempts = await transaction
      .select({ id: assessmentAttempts.id })
      .from(assessmentAttempts)
      .where(
        and(
          eq(assessmentAttempts.organizationId, input.organizationId),
          eq(assessmentAttempts.userId, input.userId),
          eq(assessmentAttempts.courseId, input.courseId),
          eq(assessmentAttempts.lessonId, input.lessonId),
          eq(assessmentAttempts.status, "graded"),
          matchingDefinitionCondition(definition),
        ),
      );
    if (
      definition.maxAttempts !== null &&
      currentAttempts.length >= definition.maxAttempts
    ) {
      throw new ApiError(
        409,
        "conflict",
        "Die maximale Anzahl an Quizversuchen ist erreicht.",
        {
          maxAttempts: definition.maxAttempts,
          attemptsUsed: currentAttempts.length,
        },
      );
    }

    const submittedAnswers = new Map<string, AssessmentAnswerInput>();
    for (const answer of input.answers) {
      if (submittedAnswers.has(answer.blockId)) {
        throw new ApiError(
          422,
          "validation_error",
          "Eine Quizfrage wurde mehrfach beantwortet.",
          { blockId: answer.blockId },
        );
      }
      submittedAnswers.set(answer.blockId, answer);
    }
    if (
      submittedAnswers.size !== definition.questions.length ||
      definition.questions.some(
        (question) => !submittedAnswers.has(question.blockId),
      ) ||
      [...submittedAnswers.keys()].some(
        (blockId) =>
          !definition.questions.some(
            (question) => question.blockId === blockId,
          ),
      )
    ) {
      throw new ApiError(
        422,
        "validation_error",
        "Alle Quizfragen muessen genau einmal beantwortet werden.",
      );
    }

    const evaluated = definition.questions.map((question) => {
      const answer = submittedAnswers.get(question.blockId)!;
      const evaluation = evaluateAssessmentAnswer(question, answer);
      if (!evaluation) {
        throw new ApiError(
          422,
          "validation_error",
          "Eine Quizantwort ist fuer den Fragetyp ungueltig.",
          { blockId: question.blockId },
        );
      }
      return {
        question,
        ...evaluation,
      };
    });
    const correctCount = evaluated.filter((answer) => answer.correct).length;
    const questionCount = evaluated.length;
    const score = Math.round((correctCount / questionCount) * 10_000) / 100;
    const passed = score >= definition.passingScore;
    const [latest] = await transaction
      .select({ attemptNumber: assessmentAttempts.attemptNumber })
      .from(assessmentAttempts)
      .where(
        and(
          eq(assessmentAttempts.organizationId, input.organizationId),
          eq(assessmentAttempts.userId, input.userId),
          eq(assessmentAttempts.courseId, input.courseId),
          eq(assessmentAttempts.lessonId, input.lessonId),
        ),
      )
      .orderBy(desc(assessmentAttempts.attemptNumber))
      .limit(1);
    const now = new Date();
    const [attempt] = await transaction
      .insert(assessmentAttempts)
      .values({
        organizationId: input.organizationId,
        userId: input.userId,
        courseId: input.courseId,
        lessonId: input.lessonId,
        attemptNumber: (latest?.attemptNumber ?? 0) + 1,
        status: "graded",
        score,
        passed,
        questionCount,
        correctCount,
        assessmentSnapshot: definition,
        finalizationReason: "submitted",
        resultReleaseMode: "immediate",
        reviewReleaseMode: "after_result",
        startedAt: now,
        submittedAt: now,
        gradedAt: now,
        resultReleasedAt: now,
        reviewReleasedAt: now,
      })
      .returning();
    const answerRows = await transaction
      .insert(assessmentAnswers)
      .values(
        evaluated.map(
          ({ question, selectedOption, answerSnapshot, correct }) => ({
          organizationId: input.organizationId,
          attemptId: attempt.id,
          blockId: question.blockId,
          questionSnapshot: question,
          selectedOption,
          answerSnapshot,
          correct,
          answeredAt: now,
          }),
        ),
      )
      .returning();
    await transaction.insert(activityEvents).values({
      organizationId: input.organizationId,
      userId: input.userId,
      type: "assessment.graded",
      entityType: "assessment_attempt",
      entityId: attempt.id,
      metadata: {
        courseId: input.courseId,
        lessonId: input.lessonId,
        score,
        passed,
        passingScore: definition.passingScore,
        attemptNumber: attempt.attemptNumber,
      },
    });

    const attemptsUsed = currentAttempts.length + 1;
    const attemptsRemaining =
      definition.maxAttempts === null
        ? null
        : Math.max(0, definition.maxAttempts - attemptsUsed);
    return {
      ...attempt,
      answers: answerRows,
      passingScore: definition.passingScore,
      maxAttempts: definition.maxAttempts,
      attemptsUsed,
      attemptsRemaining,
      maxAttemptsReached:
        !passed &&
        definition.maxAttempts !== null &&
        attemptsUsed >= definition.maxAttempts,
    };
  });
}
