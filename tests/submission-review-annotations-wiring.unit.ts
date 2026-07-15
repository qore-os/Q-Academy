import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../drizzle/0041_submission_review_annotations.sql", import.meta.url),
  "utf8",
);
const schema = readFileSync(new URL("../src/db/schema.ts", import.meta.url), "utf8");
const submissions = readFileSync(
  new URL("../src/lib/submissions.ts", import.meta.url),
  "utf8",
);
const reviewRoute = readFileSync(
  new URL(
    "../src/app/api/v1/submissions/[id]/review/route.ts",
    import.meta.url,
  ),
  "utf8",
);
const detailRoute = readFileSync(
  new URL("../src/app/api/v1/submissions/[id]/route.ts", import.meta.url),
  "utf8",
);

test("0041 enforces immutable annotation shape and same-scope references", () => {
  assert.match(migration, /CREATE TABLE "submission_review_annotations"/);
  assert.match(migration, /submission_review_annotations_review_scope_fk/);
  assert.match(migration, /submission_review_annotations_attachment_scope_fk/);
  assert.match(migration, /submission_review_annotations_media_kind_fk/);
  assert.match(migration, /submission_review_annotations_shape_check/);
  assert.match(migration, /char_length\("submission_review_annotations"\."body"\) between 1 and 2000/);
  assert.match(migration, /submission_review_annotations_review_fingerprint_idx/);
  assert.match(migration, /submission_review_annotations_prevent_update/);
  assert.match(migration, /ERRCODE = '55000'/);

  for (const referencedIndex of [
    "media_assets_id_org_kind_idx",
    "submission_attachments_asset_submission_org_idx",
    "submission_reviews_id_submission_org_idx",
  ]) {
    assert.ok(
      migration.indexOf(referencedIndex) <
        migration.indexOf("submission_review_annotations_review_scope_fk"),
      `${referencedIndex} must exist before annotation foreign keys are added.`,
    );
  }

  assert.match(schema, /export const submissionReviewAnnotations = pgTable/);
  assert.match(schema, /submission_review_annotations_shape_check/);
});

test("review transaction validates ACL, row and attachments before atomic inserts", () => {
  const acl = submissions.indexOf("requireCoursePermissionInTransaction(");
  const rowLock = submissions.indexOf('.for("update", { of: submissions })', acl);
  const attachmentLock = submissions.indexOf(
    '.for("share", { of: [submissionAttachments, mediaAssets] })',
    rowLock,
  );
  const reviewInsert = submissions.indexOf(".insert(submissionReviews)", attachmentLock);
  const annotationInsert = submissions.indexOf(
    ".insert(submissionReviewAnnotations)",
    reviewInsert,
  );
  const submissionUpdate = submissions.indexOf(".update(submissions)", annotationInsert);

  for (const position of [
    acl,
    rowLock,
    attachmentLock,
    reviewInsert,
    annotationInsert,
    submissionUpdate,
  ]) {
    assert.ok(position >= 0);
  }
  assert.ok(acl < rowLock);
  assert.ok(rowLock < attachmentLock);
  assert.ok(attachmentLock < reviewInsert);
  assert.ok(reviewInsert < annotationInsert);
  assert.ok(annotationInsert < submissionUpdate);
  assert.match(submissions, /submissionReviewAnnotationsInputSchema\.safeParse/);
  assert.match(submissions, /kind !== "audio" && kind !== "video"/);
});

test("REST review derives its actor and detail readback emits safe annotations", () => {
  assert.match(reviewRoute, /requireActiveApiKeyCreator/);
  assert.match(reviewRoute, /input\.reviewerId !== actor\.id/);
  assert.match(reviewRoute, /reviewerId: actor\.id/);
  assert.match(reviewRoute, /annotations: input\.annotations/);
  assert.match(reviewRoute, /annotationCount: reviewed\.review\.annotations\.length/);

  assert.match(detailRoute, /submissionReviewAnnotations\.organizationId/);
  assert.match(detailRoute, /submissionReviewAnnotations\.submissionId/);
  assert.match(detailRoute, /submissionReviewAnnotationView/);
  assert.doesNotMatch(
    detailRoute,
    /fingerprint: submissionReviewAnnotations\.fingerprint/,
  );
});
