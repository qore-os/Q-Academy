import { z } from "zod";

export const EXAM_SESSION_JSON_MAX_BYTES = 128 * 1024;

const blockId = { blockId: z.string().uuid() } as const;
export const examAnswerInputSchema = z.union([
  z.object({ ...blockId, selectedOption: z.number().int().min(0).max(999) }).strict(),
  z
    .object({
      ...blockId,
      selectedOptions: z
        .array(z.number().int().min(0).max(999))
        .min(1)
        .max(20)
        .refine((values) => new Set(values).size === values.length),
    })
    .strict(),
  z.object({ ...blockId, textAnswer: z.string().trim().min(1).max(500) }).strict(),
  z
    .object({
      ...blockId,
      orderedItemIds: z
        .array(z.string().regex(/^[0-9a-f]{64}$/))
        .min(2)
        .max(20)
        .refine((values) => new Set(values).size === values.length),
    })
    .strict(),
]);

const uniqueExamAnswers = z
  .array(examAnswerInputSchema)
  .max(100)
  .refine(
    (answers) =>
      new Set(answers.map((answer) => answer.blockId)).size === answers.length,
    "Eine Pruefungsfrage darf nur einmal beantwortet werden.",
  );

export const examAttemptStartSchema = z
  .object({ courseId: z.string().uuid(), lessonId: z.string().uuid() })
  .strict();

export const examAttemptApiStartSchema = examAttemptStartSchema
  .extend({ userId: z.string().uuid() })
  .strict();

export const examAttemptDraftSchema = z
  .object({
    expectedRevision: z.number().int().min(0),
    answers: uniqueExamAnswers,
  })
  .strict();

export const examAttemptSubmitSchema = z
  .object({
    expectedRevision: z.number().int().min(0),
    answers: uniqueExamAnswers.optional(),
  })
  .strict();

export const examAttemptReleaseSchema = z
  .object({ release: z.enum(["result", "review"]) })
  .strict();
