import { z } from "zod";

const annotationBodySchema = z.string().trim().min(1).max(2_000);
const postgresIntegerSchema = z.number().int().min(0).max(2_147_483_647);

export const textRangeReviewAnnotationSchema = z
  .object({
    type: z.literal("text_range"),
    body: annotationBodySchema,
    startOffset: postgresIntegerSchema,
    endOffset: postgresIntegerSchema.min(1),
  })
  .strict()
  .refine((annotation) => annotation.endOffset > annotation.startOffset, {
    message: "endOffset muss groesser als startOffset sein.",
    path: ["endOffset"],
  });

export const mediaTimestampReviewAnnotationSchema = z
  .object({
    type: z.literal("media_timestamp"),
    body: annotationBodySchema,
    mediaAssetId: z.string().uuid(),
    timestampMilliseconds: postgresIntegerSchema,
  })
  .strict();

export const submissionReviewAnnotationSchema = z.discriminatedUnion("type", [
  textRangeReviewAnnotationSchema,
  mediaTimestampReviewAnnotationSchema,
]);

export type SubmissionReviewAnnotationInput = z.infer<
  typeof submissionReviewAnnotationSchema
>;

export type SubmissionReviewAnnotationView =
  | Readonly<{
      id: string;
      type: "text_range";
      body: string;
      startOffset: number;
      endOffset: number;
      createdAt: Date;
    }>
  | Readonly<{
      id: string;
      type: "media_timestamp";
      body: string;
      mediaAssetId: string;
      timestampMilliseconds: number;
      createdAt: Date;
    }>;

export function submissionReviewAnnotationView(row: {
  id: string;
  type: "text_range" | "media_timestamp";
  body: string;
  startOffset: number | null;
  endOffset: number | null;
  mediaAssetId: string | null;
  timestampMilliseconds: number | null;
  createdAt: Date;
}): SubmissionReviewAnnotationView {
  if (
    row.type === "text_range" &&
    row.startOffset !== null &&
    row.endOffset !== null
  ) {
    return {
      id: row.id,
      type: row.type,
      body: row.body,
      startOffset: row.startOffset,
      endOffset: row.endOffset,
      createdAt: row.createdAt,
    };
  }
  if (
    row.type === "media_timestamp" &&
    row.mediaAssetId !== null &&
    row.timestampMilliseconds !== null
  ) {
    return {
      id: row.id,
      type: row.type,
      body: row.body,
      mediaAssetId: row.mediaAssetId,
      timestampMilliseconds: row.timestampMilliseconds,
      createdAt: row.createdAt,
    };
  }
  throw new Error("Stored submission review annotation violates its shape.");
}

export function submissionReviewAnnotationIdentity(
  annotation: SubmissionReviewAnnotationInput,
) {
  return annotation.type === "text_range"
    ? JSON.stringify([
        annotation.type,
        annotation.body,
        annotation.startOffset,
        annotation.endOffset,
      ])
    : JSON.stringify([
        annotation.type,
        annotation.body,
        annotation.mediaAssetId.toLowerCase(),
        annotation.timestampMilliseconds,
      ]);
}

export const submissionReviewAnnotationsInputSchema = z
  .array(submissionReviewAnnotationSchema)
  .max(100)
  .superRefine((annotations, context) => {
    const seen = new Set<string>();
    annotations.forEach((annotation, index) => {
      const identity = submissionReviewAnnotationIdentity(annotation);
      if (seen.has(identity)) {
        context.addIssue({
          code: "custom",
          message: "Doppelte Review-Annotationen sind nicht erlaubt.",
          path: [index],
        });
      }
      seen.add(identity);
    });
  });

export const submissionReviewAnnotationsSchema =
  submissionReviewAnnotationsInputSchema;
