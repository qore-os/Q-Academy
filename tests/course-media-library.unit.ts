import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  escapeCourseMediaLibrarySearch,
  sessionCourseMediaListSchema,
} from "../src/lib/media/course-media-library";

test("course media library query is bounded and strict", () => {
  assert.deepEqual(sessionCourseMediaListSchema.parse({ kind: "video" }), {
    kind: "video",
    search: "",
    limit: 30,
  });
  assert.deepEqual(
    sessionCourseMediaListSchema.parse({ kind: "document", search: " report ", limit: "50" }),
    { kind: "document", search: "report", limit: 50 },
  );
  assert.equal(sessionCourseMediaListSchema.safeParse({ kind: "profile" }).success, false);
  assert.equal(sessionCourseMediaListSchema.safeParse({ kind: "image", limit: 51 }).success, false);
  assert.equal(sessionCourseMediaListSchema.safeParse({ kind: "image", extra: true }).success, false);
});

test("course media library search treats SQL wildcards literally", () => {
  assert.equal(escapeCourseMediaLibrarySearch("100%_done\\draft"), "100\\%\\_done\\\\draft");
});

test("course media library is wired through the authenticated route and picker", () => {
  const route = readFileSync("src/app/api/media-assets/route.ts", "utf8");
  const service = readFileSync("src/lib/media/session-service.ts", "utf8");
  const picker = readFileSync("src/components/admin/course-media-source-field.tsx", "utf8");

  assert.match(route, /export async function GET/);
  assert.match(route, /listSessionCourseMediaAssets/);
  for (const policy of [
    /eq\(mediaAssets\.organizationId, user\.organizationId\)/,
    /eq\(mediaAssets\.purpose, "course_content"\)/,
    /eq\(mediaAssets\.status, "ready"\)/,
    /sessionMediaAssetReadVisibility\(user\)/,
    /isNull\(mediaAssets\.deletedAt\)/,
  ]) {
    assert.match(service, policy);
  }
  assert.match(service, /\.select\(\{\s*id: mediaAssets\.id,/);
  assert.doesNotMatch(
    service.slice(
      service.indexOf("export async function listSessionCourseMediaAssets"),
      service.indexOf("async function* requestChunks"),
    ),
    /publicMediaAssetFields/,
  );
  assert.match(picker, /\/api\/media-assets\?\$\{params\}/);
  assert.match(picker, /name=\{mediaAssetIdName\}/);
  assert.match(picker, /onAssetChange\?\.\(asset\.id\)/);
});
