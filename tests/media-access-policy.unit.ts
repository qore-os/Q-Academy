import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  canManageCourseMedia,
  canReadCourseMedia,
  canReadSubmissionMedia,
} from "@/lib/media/access-policy";

test("trainer course media access requires an own unbound upload or a current grant", () => {
  assert.equal(
    canReadCourseMedia({
      role: "trainer",
      uploadedByActor: true,
      isBound: false,
      hasViewGrant: false,
    }),
    true,
  );
  assert.equal(
    canReadCourseMedia({
      role: "trainer",
      uploadedByActor: false,
      isBound: false,
      hasViewGrant: false,
    }),
    false,
  );
  assert.equal(
    canReadCourseMedia({
      role: "trainer",
      uploadedByActor: true,
      isBound: true,
      hasViewGrant: false,
    }),
    false,
  );
  assert.equal(
    canReadCourseMedia({
      role: "trainer",
      uploadedByActor: false,
      isBound: true,
      hasViewGrant: true,
    }),
    true,
  );
  assert.equal(
    canManageCourseMedia({
      role: "trainer",
      uploadedByActor: true,
      isBound: true,
      hasViewGrant: true,
      hasEditGrant: false,
    }),
    false,
  );
  assert.equal(
    canManageCourseMedia({
      role: "trainer",
      uploadedByActor: false,
      isBound: true,
      hasViewGrant: true,
      hasEditGrant: true,
    }),
    true,
  );
});

test("tenant admins retain course media access while members do not bypass learning access", () => {
  for (const role of ["owner", "admin"] as const) {
    assert.equal(
      canReadCourseMedia({
        role,
        uploadedByActor: false,
        isBound: true,
        hasViewGrant: false,
      }),
      true,
    );
  }
  assert.equal(
    canReadCourseMedia({
      role: "member",
      uploadedByActor: true,
      isBound: false,
      hasViewGrant: true,
    }),
    false,
  );
});

test("submission attachments require course edit access for trainers and ownership for members", () => {
  assert.equal(
    canReadSubmissionMedia({
      role: "trainer",
      uploadedByActor: true,
      ownedByActor: true,
      isBound: true,
      ownsSubmission: true,
      hasEditGrant: false,
    }),
    false,
  );
  assert.equal(
    canReadSubmissionMedia({
      role: "trainer",
      uploadedByActor: false,
      ownedByActor: false,
      isBound: true,
      ownsSubmission: false,
      hasEditGrant: true,
    }),
    true,
  );
  assert.equal(
    canReadSubmissionMedia({
      role: "member",
      uploadedByActor: false,
      ownedByActor: false,
      isBound: true,
      ownsSubmission: true,
      hasEditGrant: false,
    }),
    true,
  );
  assert.equal(
    canReadSubmissionMedia({
      role: "member",
      uploadedByActor: true,
      ownedByActor: true,
      isBound: true,
      ownsSubmission: false,
      hasEditGrant: false,
    }),
    false,
  );
  assert.equal(
    canReadSubmissionMedia({
      role: "member",
      uploadedByActor: true,
      ownedByActor: true,
      isBound: false,
      ownsSubmission: false,
      hasEditGrant: false,
    }),
    true,
  );
});

test("session media wires grant-aware reads and mutations", () => {
  const scopes = readFileSync("src/lib/media/api-scopes.ts", "utf8");
  const session = readFileSync("src/lib/media/session-service.ts", "utf8");
  const binding = readFileSync("src/lib/media/course-assets.ts", "utf8");

  assert.match(scopes, /trainerCourseMediaGrant/);
  assert.match(scopes, /trainerSubmissionGrant/);
  assert.match(scopes, /\["edit", "manage"\]/);
  assert.match(scopes, /throw new ApiError\(404, "not_found"/);
  assert.match(session, /sessionMediaAssetReadVisibility\(user\)/);
  assert.match(session, /sessionMediaAssetManageVisibility\(user\)/);
  assert.match(binding, /canReadCourseMedia/);
});

test("API media keeps scoped tenant reads separate from session course grants", () => {
  const scopes = readFileSync("src/lib/media/api-scopes.ts", "utf8");
  const listRoute = readFileSync("src/app/api/v1/media-assets/route.ts", "utf8");
  const detailRoute = readFileSync(
    "src/app/api/v1/media-assets/[id]/route.ts",
    "utf8",
  );
  const contentRoute = readFileSync(
    "src/app/api/v1/media-assets/[id]/content/route.ts",
    "utf8",
  );
  const completeRoute = readFileSync(
    "src/app/api/v1/media-assets/[id]/complete/route.ts",
    "utf8",
  );
  const multipartService = readFileSync(
    "src/lib/media/api-multipart-service.ts",
    "utf8",
  );

  assert.match(scopes, /export function apiMediaReadVisibility\(actor: MediaActor\)/);
  assert.match(scopes, /ne\(mediaAssets\.purpose, "submission"\)/);
  assert.match(scopes, /visibleCommunityBinding/);
  assert.match(scopes, /communityAttachmentExists/);
  assert.match(scopes, /export function apiMediaManageVisibility/);
  assert.match(listRoute, /conditions\.push\(apiMediaReadVisibility\(actor\)\)/);
  assert.match(detailRoute, /apiMediaManageVisibility\(prepared\.actor\)/);
  assert.match(contentRoute, /apiMediaManageVisibility\(actor\)/);
  assert.match(completeRoute, /completeApiMediaAsset\(context, id\)/);
  assert.match(
    multipartService,
    /const actor = await assertApiMediaManageVisibility\(context, asset\)/,
  );
  assert.match(multipartService, /apiMediaManageVisibility\(actor\)/);
});
