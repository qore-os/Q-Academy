import "server-only";

import { and, asc, desc, eq, inArray, isNull, lte, or } from "drizzle-orm";

import { db } from "@/db";
import {
  activityEvents,
  assessmentAnswers,
  assessmentAttempts,
  submissions,
  users,
  type AssessmentAttemptSnapshot,
  type ExamDraftAnswer,
} from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import {
  compatibleAssessmentSnapshots,
  publicAssessmentBlockData,
  type CurrentAssessmentDefinition,
} from "@/lib/assessment-engine";
import { publishedAssessmentLifecycleSource } from "@/lib/assessments";
import {
  examDeadline,
  examDefinitionHash,
  examLifecycleConfigurationErrors,
  freezeExamQuestionSelection,
  type ExamLifecycleConfiguration,
} from "@/lib/exam-lifecycle-policy";
import { getCourseLearningAccess } from "@/lib/learning-access";
import { lockMemberCourseProgress } from "@/lib/progress-lock";
import { getExamSelectionSecret } from "@/lib/server-environment";
import { requireCoursePermissionInTransaction } from "@/lib/course-permissions";
import {
  assessmentResultIsReleased,
  assessmentReviewIsReleased,
} from "@/lib/assessment-release-policy";
import { conflictingExamAttemptForStart } from "@/lib/exam-attempt-start-policy";
import {
  evaluateExamDraftAnswers,
  ExamDraftValidationError,
} from "@/lib/exam-answer-policy";
import { examAttemptPresentationView } from "@/lib/exam-lifecycle-view";

type ExamTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type ExamAttempt = typeof assessmentAttempts.$inferSelect;

function currentDefinition(
  snapshot: AssessmentAttemptSnapshot,
): CurrentAssessmentDefinition {
  if (snapshot.schemaVersion !== 3) {
    throw new ApiError(
      409,
      "conflict",
      "Der Pruefungsversuch besitzt keine unterstuetzte Definition.",
    );
  }
  return snapshot;
}

function lifecycleConfiguration(input: {
  examDurationSeconds: number | null;
  examQuestionPools: ExamLifecycleConfiguration["questionPools"];
  examResultReleaseMode: ExamLifecycleConfiguration["resultReleaseMode"];
  examReviewReleaseMode: ExamLifecycleConfiguration["reviewReleaseMode"];
  examContentAccessMode: ExamLifecycleConfiguration["contentAccessMode"];
}): ExamLifecycleConfiguration {
  return {
    durationSeconds: input.examDurationSeconds,
    questionPools: input.examQuestionPools,
    resultReleaseMode: input.examResultReleaseMode,
    reviewReleaseMode: input.examReviewReleaseMode,
    contentAccessMode: input.examContentAccessMode,
  };
}

function publicAttempt(attempt: ExamAttempt) {
  const presentation = examAttemptPresentationView({
    questionOrder: attempt.questionOrder,
    presentation: attempt.questionPresentation,
  });
  return {
    id: attempt.id,
    courseId: attempt.courseId,
    lessonId: attempt.lessonId,
    courseVersionId: attempt.courseVersionId,
    attemptNumber: attempt.attemptNumber,
    status: attempt.status,
    draftRevision: attempt.draftRevision,
    draftAnswers: attempt.draftAnswers,
    ...presentation,
    questionOrder: attempt.questionOrder,
    deadlineAt: attempt.deadlineAt,
    startedAt: attempt.startedAt,
    lastSavedAt: attempt.lastSavedAt,
    submittedAt: attempt.submittedAt,
    gradedAt: attempt.gradedAt,
    finalizationReason: attempt.finalizationReason,
    contentAccessMode: attempt.contentAccessMode,
    release: {
      resultMode: attempt.resultReleaseMode,
      reviewMode: attempt.reviewReleaseMode,
      resultReleasedAt: attempt.resultReleasedAt,
      reviewReleasedAt: attempt.reviewReleasedAt,
    },
  };
}

async function lockedAttempt(
  transaction: ExamTransaction,
  input: {
    organizationId: string;
    attemptId: string;
    userId?: string;
  },
) {
  const conditions = [
    eq(assessmentAttempts.id, input.attemptId),
    eq(assessmentAttempts.organizationId, input.organizationId),
  ];
  if (input.userId) conditions.push(eq(assessmentAttempts.userId, input.userId));
  const [attempt] = await transaction
    .select()
    .from(assessmentAttempts)
    .where(and(...conditions))
    .limit(1)
    .for("update");
  if (!attempt || !attempt.courseVersionId || !attempt.definitionHash) {
    throw new ApiError(404, "not_found", "Pruefungsversuch nicht gefunden.");
  }
  return attempt;
}

async function requireAttemptUserCourseAccess(
  transaction: ExamTransaction,
  attempt: ExamAttempt,
  userId: string | undefined,
  now: Date,
) {
  if (!userId) return;
  const access = await getCourseLearningAccess(transaction, {
    organizationId: attempt.organizationId,
    userId,
    courseId: attempt.courseId,
    now,
  });
  if (!access) {
    throw new ApiError(404, "not_found", "Pruefungsversuch nicht gefunden.");
  }
  const currentLesson = access.lessons.get(attempt.lessonId);
  const activeFrozenAttempt =
    attempt.status === "in_progress" || attempt.status === "submitted";
  if (!currentLesson?.access.canInteract && !activeFrozenAttempt) {
    throw new ApiError(404, "not_found", "Pruefungsversuch nicht gefunden.");
  }
}

function evaluatedAnswers(
  attempt: ExamAttempt,
  answers: ExamDraftAnswer[],
  requireComplete: boolean,
) {
  try {
    return evaluateExamDraftAnswers({
      definition: currentDefinition(attempt.assessmentSnapshot),
      questionOrder: attempt.questionOrder,
      answers,
      requireComplete,
    });
  } catch (error) {
    if (!(error instanceof ExamDraftValidationError)) throw error;
    const messages = {
      duplicate_answer: "Eine Pruefungsfrage wurde mehrfach beantwortet.",
      unknown_question: "Die Antwort gehoert nicht zu diesem Pruefungsversuch.",
      invalid_answer: "Eine Pruefungsantwort ist fuer den Fragetyp ungueltig.",
      incomplete_answers:
        "Alle eingefrorenen Pruefungsfragen muessen beantwortet werden.",
    } as const;
    throw new ApiError(
      422,
      "validation_error",
      messages[error.code],
      error.blockId ? { blockId: error.blockId } : undefined,
    );
  }
}

function automaticReleaseTimes(attempt: ExamAttempt, now: Date) {
  const resultReleasedAt =
    attempt.resultReleaseMode === "immediate" ||
    (attempt.resultReleaseMode === "after_deadline" &&
      attempt.deadlineAt !== null &&
      attempt.deadlineAt <= now)
      ? now
      : null;
  return {
    resultReleasedAt,
    reviewReleasedAt:
      resultReleasedAt && attempt.reviewReleaseMode === "after_result"
        ? resultReleasedAt
        : null,
  };
}

async function requireSubmittedExamSupplementals(
  transaction: ExamTransaction,
  attempt: ExamAttempt,
) {
  const automaticIds = new Set(attempt.questionOrder);
  const requiredBlockIds = attempt.questionPresentation
    .filter(
      (block) =>
        block.type === "submission" &&
        block.required &&
        !automaticIds.has(block.blockId),
    )
    .map((block) => block.blockId);
  if (!requiredBlockIds.length) return;

  const submitted = await transaction
    .select({ blockId: submissions.blockId })
    .from(submissions)
    .where(
      and(
        eq(submissions.organizationId, attempt.organizationId),
        eq(submissions.userId, attempt.userId),
        eq(submissions.courseId, attempt.courseId),
        eq(submissions.lessonId, attempt.lessonId),
        inArray(submissions.blockId, requiredBlockIds),
        inArray(submissions.status, ["open", "in_review", "approved"]),
      ),
    );
  const submittedBlockIds = new Set(
    submitted.flatMap((row) => row.blockId ?? []),
  );
  if (requiredBlockIds.some((blockId) => !submittedBlockIds.has(blockId))) {
    throw new ApiError(
      422,
      "validation_error",
      "Alle verpflichtenden Praxisabgaben muessen vor der Pruefungsabgabe eingereicht werden.",
    );
  }
}

async function finalizeLockedAttempt(
  transaction: ExamTransaction,
  attempt: ExamAttempt,
  input: {
    answers: ExamDraftAnswer[];
    reason: "submitted" | "timeout" | "administrator";
    now: Date;
    replaceDraft: boolean;
    actorUserId?: string;
  },
) {
  if (attempt.status === "graded") return attempt;
  const evaluated = evaluatedAnswers(
    attempt,
    input.answers,
    input.reason === "submitted",
  );
  const correctCount = evaluated.filter((answer) => answer.correct).length;
  const questionCount = attempt.questionOrder.length;
  const score = Math.round((correctCount / questionCount) * 10_000) / 100;
  const definition = currentDefinition(attempt.assessmentSnapshot);
  const passed = score >= definition.passingScore;
  const releaseTimes = automaticReleaseTimes(attempt, input.now);

  if (evaluated.length) {
    await transaction.insert(assessmentAnswers).values(
      evaluated.map((answer) => ({
        organizationId: attempt.organizationId,
        attemptId: attempt.id,
        blockId: answer.question.blockId,
        questionSnapshot: answer.question,
        selectedOption: answer.selectedOption,
        answerSnapshot: answer.answerSnapshot,
        correct: answer.correct,
        answeredAt: input.now,
      })),
    );
  }
  const [updated] = await transaction
    .update(assessmentAttempts)
    .set({
      status: "graded",
      score,
      passed,
      correctCount,
      finalizationReason: input.reason,
      submittedAt: input.now,
      gradedAt: input.now,
      ...(input.replaceDraft
        ? {
            draftAnswers: input.answers,
            draftRevision: attempt.draftRevision + 1,
            lastSavedAt: input.now,
          }
        : {}),
      ...releaseTimes,
    })
    .where(
      and(
        eq(assessmentAttempts.id, attempt.id),
        eq(assessmentAttempts.organizationId, attempt.organizationId),
        or(
          eq(assessmentAttempts.status, "in_progress"),
          eq(assessmentAttempts.status, "submitted"),
        ),
      ),
    )
    .returning();
  if (!updated) {
    throw new ApiError(409, "conflict", "Der Versuch wurde bereits finalisiert.");
  }
  await transaction.insert(activityEvents).values({
    organizationId: attempt.organizationId,
    userId: input.actorUserId ?? attempt.userId,
    type: "assessment.graded",
    entityType: "assessment_attempt",
    entityId: attempt.id,
    metadata: {
      source: "exam_lifecycle_v1",
      courseId: attempt.courseId,
      lessonId: attempt.lessonId,
      definitionHash: attempt.definitionHash,
      score,
      passed,
      finalizationReason: input.reason,
      attemptNumber: attempt.attemptNumber,
      ...(input.actorUserId ? { learnerUserId: attempt.userId } : {}),
    },
  });
  return updated;
}

async function settleLockedAttempt(
  transaction: ExamTransaction,
  attempt: ExamAttempt,
  now: Date,
) {
  if (
    (attempt.status === "in_progress" || attempt.status === "submitted") &&
    attempt.deadlineAt &&
    attempt.deadlineAt <= now
  ) {
    return finalizeLockedAttempt(transaction, attempt, {
      answers: attempt.draftAnswers,
      reason: "timeout",
      now,
      replaceDraft: false,
    });
  }
  if (
    attempt.status === "graded" &&
    !attempt.resultReleasedAt &&
    attempt.resultReleaseMode === "after_deadline" &&
    attempt.deadlineAt &&
    attempt.deadlineAt <= now
  ) {
    const reviewReleasedAt =
      attempt.reviewReleaseMode === "after_result" ? now : null;
    const [released] = await transaction
      .update(assessmentAttempts)
      .set({ resultReleasedAt: now, reviewReleasedAt })
      .where(
        and(
          eq(assessmentAttempts.id, attempt.id),
          eq(assessmentAttempts.organizationId, attempt.organizationId),
          isNull(assessmentAttempts.resultReleasedAt),
        ),
      )
      .returning();
    return released ?? attempt;
  }
  return attempt;
}

function compatibleLegacyDefinitionCondition(
  definition: CurrentAssessmentDefinition,
) {
  return or(
    ...compatibleAssessmentSnapshots(definition).map((snapshot) =>
      eq(assessmentAttempts.assessmentSnapshot, snapshot),
    ),
  )!;
}

export async function startOrResumeExamAttempt(input: {
  organizationId: string;
  userId: string;
  courseId: string;
  lessonId: string;
  now?: Date;
}) {
  return db.transaction(async (transaction) => {
    const now = input.now ?? new Date();
    const [member] = await transaction
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.id, input.userId),
          eq(users.organizationId, input.organizationId),
          eq(users.status, "active"),
        ),
      )
      .limit(1)
      .for("update");
    if (!member) {
      throw new ApiError(404, "not_found", "Pruefung nicht gefunden.");
    }
    await lockMemberCourseProgress(transaction, input);
    const lockedActiveAttempts = await transaction
      .select()
      .from(assessmentAttempts)
      .where(
        and(
          eq(assessmentAttempts.organizationId, input.organizationId),
          eq(assessmentAttempts.userId, input.userId),
          or(
            eq(assessmentAttempts.status, "in_progress"),
            eq(assessmentAttempts.status, "submitted"),
          ),
        ),
      )
      .orderBy(asc(assessmentAttempts.startedAt), asc(assessmentAttempts.id))
      .for("update");
    const activeAttempts: ExamAttempt[] = [];
    for (const candidate of lockedActiveAttempts) {
      activeAttempts.push(
        candidate.courseVersionId && candidate.definitionHash
          ? await settleLockedAttempt(transaction, candidate, now)
          : candidate,
      );
    }
    const stillActiveAttempts = activeAttempts.filter(
      (attempt) =>
        attempt.status === "in_progress" || attempt.status === "submitted",
    );
    const learningAccess = await getCourseLearningAccess(transaction, {
      organizationId: input.organizationId,
      userId: input.userId,
      courseId: input.courseId,
      now,
    });
    if (!learningAccess) {
      throw new ApiError(404, "not_found", "Pruefung nicht gefunden.");
    }

    const active = stillActiveAttempts.find(
      (attempt) =>
        attempt.courseId === input.courseId &&
        attempt.lessonId === input.lessonId,
    );
    if (active) {
      if (!active.courseVersionId || !active.definitionHash) {
        throw new ApiError(
          409,
          "conflict",
          "Ein alter aktiver Quizversuch muss zuerst abgeschlossen werden.",
        );
      }
      const settled = await settleLockedAttempt(transaction, active, now);
      return { ...publicAttempt(settled), resumed: true };
    }
    const existingLockConflict = conflictingExamAttemptForStart(
      stillActiveAttempts,
      {
        courseId: input.courseId,
        lessonId: input.lessonId,
        contentAccessMode: "allow",
      },
    );
    if (existingLockConflict) {
      throw new ApiError(
        409,
        "conflict",
        "Vor dieser Pruefung muss der laufende Versuch abgeschlossen werden.",
        { activeAttemptId: existingLockConflict.id },
      );
    }

    const accessibleLesson = learningAccess.lessons.get(input.lessonId);
    if (!accessibleLesson?.access.canInteract) {
      throw new ApiError(404, "not_found", "Pruefung nicht gefunden.");
    }
    const source = publishedAssessmentLifecycleSource(
      learningAccess.published.snapshot,
      input.lessonId,
    );
    if (!source || source.lesson.type !== "exam") {
      throw new ApiError(
        422,
        "validation_error",
        "Der neue Pruefungslebenszyklus ist nur fuer veroeffentlichte Pruefungen verfuegbar.",
      );
    }
    if (!source.definition.questions.length) {
      throw new ApiError(
        422,
        "validation_error",
        "Die Pruefung benoetigt mindestens eine automatisch bewertbare Frage; Abgaben koennen zusaetzlich verwendet werden.",
      );
    }
    const configuration = lifecycleConfiguration(source.lesson);
    const configurationErrors = examLifecycleConfigurationErrors({
      configuration,
      questionIds: source.definition.questions.map((question) => question.blockId),
    });
    if (configurationErrors.length) {
      throw new ApiError(422, "validation_error", configurationErrors[0]);
    }
    const conflictingAttempt = conflictingExamAttemptForStart(
      stillActiveAttempts,
      {
        courseId: input.courseId,
        lessonId: input.lessonId,
        contentAccessMode: configuration.contentAccessMode,
      },
    );
    if (conflictingAttempt) {
      throw new ApiError(
        409,
        "conflict",
        "Vor dieser Pruefung muss der laufende Versuch abgeschlossen werden.",
        { activeAttemptId: conflictingAttempt.id },
      );
    }
    const selectionSecret = getExamSelectionSecret();
    const definitionHash = examDefinitionHash({
      lessonId: input.lessonId,
      definition: source.definition,
      configuration,
    });
    const gradedAttempts = await transaction
      .select()
      .from(assessmentAttempts)
      .where(
        and(
          eq(assessmentAttempts.organizationId, input.organizationId),
          eq(assessmentAttempts.userId, input.userId),
          eq(assessmentAttempts.courseId, input.courseId),
          eq(assessmentAttempts.lessonId, input.lessonId),
          eq(assessmentAttempts.status, "graded"),
          or(
            eq(assessmentAttempts.definitionHash, definitionHash),
            and(
              isNull(assessmentAttempts.definitionHash),
              compatibleLegacyDefinitionCondition(source.definition),
            ),
          ),
        ),
      );
    const pendingReleaseAttempt = gradedAttempts.find(
      (attempt) =>
        attempt.definitionHash === definitionHash &&
        attempt.resultReleasedAt === null,
    );
    if (pendingReleaseAttempt) {
      const settledPending = await settleLockedAttempt(
        transaction,
        pendingReleaseAttempt,
        now,
      );
      if (!settledPending.resultReleasedAt) {
        return {
          ...publicAttempt(settledPending),
          resumed: true,
          pendingRelease: true,
        };
      }
    }
    if (
      source.definition.maxAttempts !== null &&
      gradedAttempts.length >= source.definition.maxAttempts
    ) {
      throw new ApiError(
        409,
        "conflict",
        "Die maximale Anzahl an Pruefungsversuchen ist erreicht.",
        {
          maxAttempts: source.definition.maxAttempts,
          attemptsUsed: gradedAttempts.length,
        },
      );
    }
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
    const attemptNumber = (latest?.attemptNumber ?? 0) + 1;
    const frozen = freezeExamQuestionSelection({
      definition: source.definition,
      configuration,
      definitionHash,
      userId: input.userId,
      attemptNumber,
      selectionSecret,
    });
    const presentations = new Map(
      source.questionRows.map((question) => [
        question.id,
        {
          blockId: question.id,
          type: question.type,
          title: question.title,
          required: question.required,
          data: publicAssessmentBlockData(question),
        },
      ]),
    );
    const questionPresentation = frozen.questionOrder.map((questionId) => {
      const presentation = presentations.get(questionId);
      if (!presentation) {
        throw new ApiError(
          409,
          "conflict",
          "Die eingefrorene Fragenpraesentation ist unvollstaendig.",
        );
      }
      return presentation;
    });
    questionPresentation.push(
      ...source.supplementalRows.map((block) => ({
        blockId: block.id,
        type: block.type,
        title: block.title,
        required: block.required,
        data: publicAssessmentBlockData(block),
      })),
    );
    const deadlineAt = examDeadline(now, configuration.durationSeconds);
    const [attempt] = await transaction
      .insert(assessmentAttempts)
      .values({
        organizationId: input.organizationId,
        userId: input.userId,
        courseId: input.courseId,
        lessonId: input.lessonId,
        courseVersionId: learningAccess.published.versionId,
        definitionHash,
        attemptNumber,
        status: "in_progress",
        questionCount: frozen.questionOrder.length,
        assessmentSnapshot: source.definition,
        questionOrder: frozen.questionOrder,
        questionPools: frozen.questionPools,
        questionPresentation,
        deadlineAt,
        resultReleaseMode: configuration.resultReleaseMode,
        reviewReleaseMode: configuration.reviewReleaseMode,
        contentAccessMode: configuration.contentAccessMode,
        startedAt: now,
      })
      .returning();
    await transaction.insert(activityEvents).values({
      organizationId: input.organizationId,
      userId: input.userId,
      type: "assessment.started",
      entityType: "assessment_attempt",
      entityId: attempt.id,
      metadata: {
        source: "exam_lifecycle_v1",
        courseId: input.courseId,
        lessonId: input.lessonId,
        courseVersionId: learningAccess.published.versionId,
        definitionHash,
        attemptNumber,
        deadlineAt: deadlineAt?.toISOString() ?? null,
      },
    });
    return { ...publicAttempt(attempt), resumed: false };
  });
}

export async function getExamAttempt(input: {
  organizationId: string;
  attemptId: string;
  userId?: string;
  now?: Date;
}) {
  return db.transaction(async (transaction) => {
    const attempt = await lockedAttempt(transaction, input);
    const now = input.now ?? new Date();
    await requireAttemptUserCourseAccess(
      transaction,
      attempt,
      input.userId,
      now,
    );
    return publicAttempt(
      await settleLockedAttempt(transaction, attempt, now),
    );
  });
}

export async function saveExamAttemptDraft(input: {
  organizationId: string;
  attemptId: string;
  userId?: string;
  expectedRevision: number;
  answers: ExamDraftAnswer[];
  now?: Date;
}) {
  return db.transaction(async (transaction) => {
    const now = input.now ?? new Date();
    const current = await lockedAttempt(transaction, input);
    await requireAttemptUserCourseAccess(
      transaction,
      current,
      input.userId,
      now,
    );
    const attempt = await settleLockedAttempt(transaction, current, now);
    if (attempt.status !== "in_progress") {
      throw new ApiError(
        409,
        "conflict",
        "Der Pruefungsversuch kann nicht mehr gespeichert werden.",
        { status: attempt.status, finalizationReason: attempt.finalizationReason },
      );
    }
    if (attempt.draftRevision !== input.expectedRevision) {
      throw new ApiError(
        409,
        "conflict",
        "Der Pruefungsentwurf wurde zwischenzeitlich geaendert.",
        { currentRevision: attempt.draftRevision },
      );
    }
    evaluatedAnswers(attempt, input.answers, false);
    const [updated] = await transaction
      .update(assessmentAttempts)
      .set({
        draftAnswers: input.answers,
        draftRevision: attempt.draftRevision + 1,
        lastSavedAt: now,
      })
      .where(
        and(
          eq(assessmentAttempts.id, attempt.id),
          eq(assessmentAttempts.organizationId, attempt.organizationId),
          eq(assessmentAttempts.status, "in_progress"),
          eq(assessmentAttempts.draftRevision, input.expectedRevision),
        ),
      )
      .returning();
    if (!updated) {
      throw new ApiError(409, "conflict", "Der Entwurf konnte nicht gespeichert werden.");
    }
    return publicAttempt(updated);
  });
}

export async function submitExamAttempt(input: {
  organizationId: string;
  attemptId: string;
  userId?: string;
  expectedRevision: number;
  answers?: ExamDraftAnswer[];
  now?: Date;
}) {
  return db.transaction(async (transaction) => {
    const now = input.now ?? new Date();
    const current = await lockedAttempt(transaction, input);
    await requireAttemptUserCourseAccess(
      transaction,
      current,
      input.userId,
      now,
    );
    const attempt = await settleLockedAttempt(transaction, current, now);
    if (attempt.status === "graded") return publicAttempt(attempt);
    if (attempt.draftRevision !== input.expectedRevision) {
      throw new ApiError(
        409,
        "conflict",
        "Der Pruefungsentwurf wurde zwischenzeitlich geaendert.",
        { currentRevision: attempt.draftRevision },
      );
    }
    await requireSubmittedExamSupplementals(transaction, attempt);
    const finalized = await finalizeLockedAttempt(transaction, attempt, {
      answers: input.answers ?? attempt.draftAnswers,
      reason: "submitted",
      now,
      replaceDraft: input.answers !== undefined,
    });
    return publicAttempt(finalized);
  });
}

export async function getExamAttemptResult(input: {
  organizationId: string;
  attemptId: string;
  userId?: string;
  now?: Date;
}) {
  return db.transaction(async (transaction) => {
    const current = await lockedAttempt(transaction, input);
    const now = input.now ?? new Date();
    await requireAttemptUserCourseAccess(
      transaction,
      current,
      input.userId,
      now,
    );
    const attempt = await settleLockedAttempt(
      transaction,
      current,
      now,
    );
    const reviewAnswers = assessmentReviewIsReleased(attempt)
      ? await transaction
          .select({
            blockId: assessmentAnswers.blockId,
            questionSnapshot: assessmentAnswers.questionSnapshot,
            answerSnapshot: assessmentAnswers.answerSnapshot,
            correct: assessmentAnswers.correct,
            answeredAt: assessmentAnswers.answeredAt,
          })
          .from(assessmentAnswers)
          .where(
            and(
              eq(assessmentAnswers.organizationId, input.organizationId),
              eq(assessmentAnswers.attemptId, attempt.id),
            ),
          )
          .orderBy(asc(assessmentAnswers.answeredAt), asc(assessmentAnswers.id))
      : null;
    return {
      attempt: publicAttempt(attempt),
      result: assessmentResultIsReleased(attempt)
        ? {
            score: attempt.score,
            passed: attempt.passed,
            questionCount: attempt.questionCount,
            correctCount: attempt.correctCount,
            finalizationReason: attempt.finalizationReason,
          }
        : null,
      review: reviewAnswers,
    };
  });
}

export async function releaseExamAttempt(input: {
  organizationId: string;
  attemptId: string;
  actorUserId: string;
  release: "result" | "review";
  now?: Date;
}) {
  return db.transaction(async (transaction) => {
    const now = input.now ?? new Date();
    const current = await lockedAttempt(transaction, input);
    await requireCoursePermissionInTransaction(
      transaction,
      { id: input.actorUserId, organizationId: input.organizationId },
      current.courseId,
      "edit",
    );
    const attempt = await settleLockedAttempt(transaction, current, now);
    if (attempt.status !== "graded") {
      throw new ApiError(409, "conflict", "Die Pruefung ist noch nicht bewertet.");
    }
    if (input.release === "result") {
      if (attempt.resultReleaseMode !== "manual") {
        throw new ApiError(409, "conflict", "Das Ergebnis ist nicht manuell freizugeben.");
      }
      const reviewReleasedAt =
        attempt.reviewReleaseMode === "after_result" ? now : attempt.reviewReleasedAt;
      await transaction
        .update(assessmentAttempts)
        .set({ resultReleasedAt: attempt.resultReleasedAt ?? now, reviewReleasedAt })
        .where(
          and(
            eq(assessmentAttempts.id, attempt.id),
            eq(assessmentAttempts.organizationId, input.organizationId),
          ),
        );
    } else {
      if (attempt.reviewReleaseMode !== "manual") {
        throw new ApiError(409, "conflict", "Die Einsicht ist nicht manuell freizugeben.");
      }
      if (!attempt.resultReleasedAt) {
        throw new ApiError(409, "conflict", "Das Ergebnis muss zuerst freigegeben werden.");
      }
      await transaction
        .update(assessmentAttempts)
        .set({ reviewReleasedAt: attempt.reviewReleasedAt ?? now })
        .where(
          and(
            eq(assessmentAttempts.id, attempt.id),
            eq(assessmentAttempts.organizationId, input.organizationId),
          ),
        );
    }
    await transaction.insert(activityEvents).values({
      organizationId: input.organizationId,
      userId: input.actorUserId,
      type: `assessment.${input.release}.released`,
      entityType: "assessment_attempt",
      entityId: attempt.id,
      metadata: { source: "exam_lifecycle_v1" },
    });
    const released = await lockedAttempt(transaction, input);
    return publicAttempt(released);
  });
}

export async function finalizeExamAttemptByAdministrator(input: {
  organizationId: string;
  attemptId: string;
  actorUserId: string;
  now?: Date;
}) {
  return db.transaction(async (transaction) => {
    const now = input.now ?? new Date();
    const current = await lockedAttempt(transaction, input);
    await requireCoursePermissionInTransaction(
      transaction,
      { id: input.actorUserId, organizationId: input.organizationId },
      current.courseId,
      "edit",
    );
    const attempt = await settleLockedAttempt(transaction, current, now);
    if (attempt.status === "graded") return publicAttempt(attempt);
    return publicAttempt(
      await finalizeLockedAttempt(transaction, attempt, {
        answers: attempt.draftAnswers,
        reason: "administrator",
        now,
        replaceDraft: false,
        actorUserId: input.actorUserId,
      }),
    );
  });
}

export async function processExamLifecycleDeadlines(limit = 25, now = new Date()) {
  const boundedLimit = Math.max(1, Math.min(100, limit));
  const processed: Array<{ id: string; status: string; resultReleased: boolean }> = [];
  for (let index = 0; index < boundedLimit; index += 1) {
    const result = await db.transaction(async (transaction) => {
      const [candidate] = await transaction
        .select()
        .from(assessmentAttempts)
        .where(
          and(
            or(
              and(
                or(
                  eq(assessmentAttempts.status, "in_progress"),
                  eq(assessmentAttempts.status, "submitted"),
                ),
                lte(assessmentAttempts.deadlineAt, now),
              ),
              and(
                eq(assessmentAttempts.status, "graded"),
                eq(assessmentAttempts.resultReleaseMode, "after_deadline"),
                isNull(assessmentAttempts.resultReleasedAt),
                lte(assessmentAttempts.deadlineAt, now),
              ),
            ),
          ),
        )
        .orderBy(asc(assessmentAttempts.deadlineAt), asc(assessmentAttempts.id))
        .limit(1)
        .for("update", { skipLocked: true });
      if (!candidate) return null;
      const settled = await settleLockedAttempt(transaction, candidate, now);
      return {
        id: settled.id,
        status: settled.status,
        resultReleased: Boolean(settled.resultReleasedAt),
      };
    });
    if (!result) break;
    processed.push(result);
  }
  return processed;
}
