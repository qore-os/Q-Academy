import type { ExamQuestionPoolConfiguration } from "@/db/schema";

export const ADMIN_EXAM_POOL_ID = "all_questions";
export const MAX_ADMIN_EXAM_POOL_QUESTIONS = 100;

export type AdminExamPoolDerivation =
  | { ok: true; questionPools: ExamQuestionPoolConfiguration[] }
  | { ok: false; message: string };

export function deriveAdminExamQuestionPools(input: {
  questionIds: readonly string[];
  drawCount: number | null;
}): AdminExamPoolDerivation {
  if (input.drawCount === null) return { ok: true, questionPools: [] };

  const questionIds = [...new Set(input.questionIds)];
  if (questionIds.length !== input.questionIds.length) {
    return {
      ok: false,
      message: "Die automatisch ermittelten Pruefungsfragen sind nicht eindeutig.",
    };
  }
  if (!questionIds.length) {
    return {
      ok: false,
      message: "Fuer eine Zufallsauswahl wird mindestens eine automatische Frage benoetigt.",
    };
  }
  if (questionIds.length > MAX_ADMIN_EXAM_POOL_QUESTIONS) {
    return {
      ok: false,
      message: `Der automatisch ermittelte Fragenpool darf hoechstens ${MAX_ADMIN_EXAM_POOL_QUESTIONS} Fragen enthalten.`,
    };
  }
  if (
    !Number.isInteger(input.drawCount) ||
    input.drawCount < 1 ||
    input.drawCount > questionIds.length
  ) {
    return {
      ok: false,
      message: `Die Zufallsauswahl muss zwischen 1 und ${questionIds.length} Fragen enthalten.`,
    };
  }

  return {
    ok: true,
    questionPools: [
      {
        id: ADMIN_EXAM_POOL_ID,
        questionIds,
        drawCount: input.drawCount,
      },
    ],
  };
}
