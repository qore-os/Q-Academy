import assert from "node:assert/strict";
import test from "node:test";

import { submissionReviewSchema } from "../src/lib/api/schemas";
import { openApiDocument } from "../src/lib/api/openapi";
import {
  submissionReviewAnnotationsInputSchema,
  submissionReviewAnnotationView,
} from "../src/lib/submission-review-annotations";

const mediaAssetId = "10000000-0000-4000-8000-000000000001";

test("review annotation input accepts only normalized strict discriminated targets", () => {
  assert.deepEqual(
    submissionReviewAnnotationsInputSchema.parse([
      {
        type: "text_range",
        body: "  Praezisiere diesen Abschnitt.  ",
        startOffset: 0,
        endOffset: 14,
      },
      {
        type: "media_timestamp",
        body: "Die Aussage benoetigt hier einen Beleg.",
        mediaAssetId,
        timestampMilliseconds: 12_500,
      },
    ]),
    [
      {
        type: "text_range",
        body: "Praezisiere diesen Abschnitt.",
        startOffset: 0,
        endOffset: 14,
      },
      {
        type: "media_timestamp",
        body: "Die Aussage benoetigt hier einen Beleg.",
        mediaAssetId,
        timestampMilliseconds: 12_500,
      },
    ],
  );

  for (const invalid of [
    [{ type: "text_range", body: "Text", startOffset: -1, endOffset: 2 }],
    [{ type: "text_range", body: "Text", startOffset: 2, endOffset: 2 }],
    [
      {
        type: "text_range",
        body: "Text",
        startOffset: 0,
        endOffset: 2,
        mediaAssetId,
      },
    ],
    [
      {
        type: "media_timestamp",
        body: "Text",
        mediaAssetId,
        timestampMilliseconds: -1,
      },
    ],
    [
      {
        type: "media_timestamp",
        body: "Text",
        mediaAssetId,
        timestampMilliseconds: 1.5,
      },
    ],
    [
      {
        type: "media_timestamp",
        body: "Text",
        mediaAssetId,
        timestampMilliseconds: 1,
        startOffset: 0,
      },
    ],
    [{ type: "text_range", body: " ", startOffset: 0, endOffset: 1 }],
    [
      {
        type: "media_timestamp",
        body: "x".repeat(2_001),
        mediaAssetId,
        timestampMilliseconds: 1,
      },
    ],
  ]) {
    assert.equal(submissionReviewAnnotationsInputSchema.safeParse(invalid).success, false);
  }

  assert.equal(
    submissionReviewAnnotationsInputSchema.safeParse([
      {
        type: "media_timestamp",
        body: "Ausserhalb des PostgreSQL-Integerbereichs",
        mediaAssetId: "10000000-0000-4000-8000-000000000001",
        timestampMilliseconds: 2_147_483_648,
      },
    ]).success,
    false,
  );
});

test("review annotation input rejects normalized duplicates and more than one hundred entries", () => {
  assert.equal(
    submissionReviewAnnotationsInputSchema.safeParse([
      {
        type: "media_timestamp",
        body: "  Wiederholung ",
        mediaAssetId: mediaAssetId.toUpperCase(),
        timestampMilliseconds: 5_000,
      },
      {
        type: "media_timestamp",
        body: "Wiederholung",
        mediaAssetId,
        timestampMilliseconds: 5_000,
      },
    ]).success,
    false,
  );
  assert.equal(
    submissionReviewAnnotationsInputSchema.safeParse(
      Array.from({ length: 101 }, (_, index) => ({
        type: "text_range" as const,
        body: `Hinweis ${index}`,
        startOffset: index,
        endOffset: index + 1,
      })),
    ).success,
    false,
  );
});

test("stored annotation views expose only their discriminated public fields", () => {
  const createdAt = new Date("2026-07-11T12:00:00.000Z");
  const view = submissionReviewAnnotationView({
    id: "20000000-0000-4000-8000-000000000001",
    type: "media_timestamp",
    body: "Zeitmarke",
    startOffset: null,
    endOffset: null,
    mediaAssetId,
    timestampMilliseconds: 99,
    createdAt,
  });
  assert.deepEqual(view, {
    id: "20000000-0000-4000-8000-000000000001",
    type: "media_timestamp",
    body: "Zeitmarke",
    mediaAssetId,
    timestampMilliseconds: 99,
    createdAt,
  });
  assert.throws(() =>
    submissionReviewAnnotationView({
      id: "20000000-0000-4000-8000-000000000002",
      type: "text_range",
      body: "Defekt",
      startOffset: null,
      endOffset: 4,
      mediaAssetId: null,
      timestampMilliseconds: null,
      createdAt,
    }),
  );
});

test("submission review Zod and OpenAPI contracts include immutable annotations", () => {
  const parsed = submissionReviewSchema.parse({
    decision: "approved",
    feedback: "Vollstaendig geprueft.",
    score: 95,
  });
  assert.deepEqual(parsed.annotations, []);
  assert.equal(
    submissionReviewSchema.safeParse({
      decision: "approved",
      feedback: "Vollstaendig geprueft.",
      score: 95,
      annotations: [],
      unknown: true,
    }).success,
    false,
  );

  const requestSchema = openApiDocument.components.schemas.SubmissionReview;
  const requestJson = JSON.stringify(requestSchema);
  assert.match(requestJson, /"annotations"/);
  assert.match(requestJson, /"maxItems":100/);
  assert.match(requestJson, /"text_range"/);
  assert.match(requestJson, /"media_timestamp"/);
  assert.match(requestJson, /"timestampMilliseconds"/);

  const annotationSchema =
    openApiDocument.components.schemas.SubmissionReviewAnnotation;
  const annotationJson = JSON.stringify(annotationSchema);
  assert.doesNotMatch(annotationJson, /fingerprint|organizationId|reviewId|sortOrder/);
  assert.match(annotationJson, /"additionalProperties":false/);

  assert.match(
    JSON.stringify(
      openApiDocument.paths["/submissions/{id}"]?.get?.responses["200"],
    ),
    /SubmissionDetail/,
  );
  assert.match(
    JSON.stringify(
      openApiDocument.paths["/submissions/{id}/review"]?.post?.responses["200"],
    ),
    /SubmissionReviewResult/,
  );
});
