import { createHash, createHmac } from "node:crypto";

import type {
  ExamQuestionPoolConfiguration,
  FrozenExamQuestionPool,
} from "@/db/schema";
import type { CurrentAssessmentDefinition } from "@/lib/assessment-engine";

export type ExamResultReleaseMode =
  | "immediate"
  | "after_deadline"
  | "manual";
export type ExamReviewReleaseMode = "never" | "after_result" | "manual";
export type ExamContentAccessMode =
  | "allow"
  | "block_course"
  | "block_academy";

export type ExamLifecycleConfiguration = {
  durationSeconds: number | null;
  questionPools: ExamQuestionPoolConfiguration[];
  resultReleaseMode: ExamResultReleaseMode;
  reviewReleaseMode: ExamReviewReleaseMode;
  contentAccessMode: ExamContentAccessMode;
};

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  return `{${Object.entries(value)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
    .join(",")}}`;
}

function rankedQuestionIds(
  questionIds: string[],
  seed: string,
  selectionSecret: string,
) {
  return [...questionIds].sort((left, right) => {
    const leftHash = createHmac("sha256", selectionSecret)
      .update("q-academy:exam-question-rank:v1\0")
      .update(seed)
      .update("\0")
      .update(left)
      .digest("hex");
    const rightHash = createHmac("sha256", selectionSecret)
      .update("q-academy:exam-question-rank:v1\0")
      .update(seed)
      .update("\0")
      .update(right)
      .digest("hex");
    return leftHash.localeCompare(rightHash) || left.localeCompare(right);
  });
}

export function examLifecycleConfigurationErrors(input: {
  configuration: ExamLifecycleConfiguration;
  questionIds: string[];
}) {
  const errors: string[] = [];
  const questionIds = new Set(input.questionIds);
  const claimedQuestions = new Set<string>();
  const poolIds = new Set<string>();
  const duration = input.configuration.durationSeconds;
  if (
    duration !== null &&
    (!Number.isInteger(duration) || duration < 60 || duration > 86_400)
  ) {
    errors.push("Die Pruefungsdauer muss zwischen 60 und 86400 Sekunden liegen.");
  }
  if (
    input.configuration.resultReleaseMode === "after_deadline" &&
    duration === null
  ) {
    errors.push("Eine Ergebnisfreigabe nach Frist benoetigt eine Pruefungsdauer.");
  }
  for (const pool of input.configuration.questionPools) {
    if (
      !pool ||
      typeof pool !== "object" ||
      !/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/.test(pool.id) ||
      !Array.isArray(pool.questionIds) ||
      !Number.isInteger(pool.drawCount) ||
      pool.drawCount < 1 ||
      pool.drawCount > pool.questionIds.length
    ) {
      errors.push("Mindestens ein Fragenpool ist ungueltig konfiguriert.");
      continue;
    }
    if (poolIds.has(pool.id)) {
      errors.push(`Der Fragenpool ${pool.id} ist mehrfach konfiguriert.`);
    }
    poolIds.add(pool.id);
    const localIds = new Set<string>();
    for (const questionId of pool.questionIds) {
      if (
        typeof questionId !== "string" ||
        !questionIds.has(questionId) ||
        localIds.has(questionId) ||
        claimedQuestions.has(questionId)
      ) {
        errors.push(`Der Fragenpool ${pool.id} enthaelt ungueltige Fragen.`);
        break;
      }
      localIds.add(questionId);
      claimedQuestions.add(questionId);
    }
  }
  return [...new Set(errors)];
}

export function examDefinitionHash(input: {
  lessonId: string;
  definition: CurrentAssessmentDefinition;
  configuration: ExamLifecycleConfiguration;
}) {
  return createHash("sha256")
    .update("q-academy:exam-definition:v1\0")
    .update(canonicalJson(input))
    .digest("hex");
}

export function freezeExamQuestionSelection(input: {
  definition: CurrentAssessmentDefinition;
  configuration: ExamLifecycleConfiguration;
  definitionHash: string;
  userId: string;
  attemptNumber: number;
  selectionSecret: string;
}) {
  const questionIds = input.definition.questions.map(
    (question) => question.blockId,
  );
  const errors = examLifecycleConfigurationErrors({
    configuration: input.configuration,
    questionIds,
  });
  if (errors.length) throw new TypeError(errors[0]);

  const pooledIds = new Set(
    input.configuration.questionPools.flatMap((pool) => pool.questionIds),
  );
  const selectedIds = new Set(
    questionIds.filter((questionId) => !pooledIds.has(questionId)),
  );
  const frozenPools: FrozenExamQuestionPool[] = [];
  for (const pool of input.configuration.questionPools) {
    const ranked = rankedQuestionIds(
      pool.questionIds,
      `${input.definitionHash}:${input.userId}:${input.attemptNumber}:${pool.id}`,
      input.selectionSecret,
    );
    const selectedQuestionIds = ranked.slice(0, pool.drawCount);
    selectedQuestionIds.forEach((questionId) => selectedIds.add(questionId));
    frozenPools.push({
      id: pool.id,
      drawCount: pool.drawCount,
      availableQuestionIds: [...pool.questionIds],
      selectedQuestionIds,
    });
  }

  let questionOrder = questionIds.filter((questionId) =>
    selectedIds.has(questionId),
  );
  if (input.definition.shuffleQuestions && questionOrder.length > 1) {
    questionOrder = rankedQuestionIds(
      questionOrder,
      `${input.definitionHash}:${input.userId}:${input.attemptNumber}:order`,
      input.selectionSecret,
    );
  }
  if (!questionOrder.length) {
    throw new TypeError("Die eingefrorene Pruefung enthaelt keine Fragen.");
  }
  return { questionOrder, questionPools: frozenPools };
}

export function examDeadline(
  startedAt: Date,
  durationSeconds: number | null,
) {
  return durationSeconds === null
    ? null
    : new Date(startedAt.getTime() + durationSeconds * 1_000);
}
