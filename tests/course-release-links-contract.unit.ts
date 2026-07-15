import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const files = {
  migration: new URL("../drizzle/0062_course_release_links.sql", import.meta.url),
  versioning: new URL("../src/lib/api/course-versioning.ts", import.meta.url),
  schemas: new URL("../src/lib/api/schemas.ts", import.meta.url),
  openapi: new URL("../src/lib/api/openapi.ts", import.meta.url),
  postCreate: new URL("../src/lib/community-mutations.ts", import.meta.url),
  feed: new URL("../src/lib/community-feed.ts", import.meta.url),
  ui: new URL("../src/components/academy/community-feed.tsx", import.meta.url),
};

test("course release mail is bound to publication and not a clock scheduler", async () => {
  const versioning = await readFile(files.versioning, "utf8");
  assert.match(
    versioning,
    /export async function publishCourseVersion[\s\S]*queueCourseModuleReleaseEmails\(/,
  );
  assert.doesNotMatch(versioning, /setInterval|scheduleCourseModuleRelease/);
  assert.match(
    versioning,
    /diffCourseSnapshots\(currentVersion\.snapshot, snapshot\)\.hasChanges/,
  );
});

test("community course links use a tenant foreign key that unlinks on course deletion", async () => {
  const migration = await readFile(files.migration, "utf8");
  assert.match(
    migration,
    /FOREIGN KEY \("linked_course_id","organization_id"\)[\s\S]*ON DELETE SET NULL \("linked_course_id"\)/,
  );
  assert.match(
    migration,
    /CREATE INDEX "posts_org_linked_course_idx"[\s\S]*\("organization_id","linked_course_id"\)/,
  );
});

test("REST post creation accepts only a typed course id and exposes a typed course link", async () => {
  const [schemas, openapi, postCreate, feed, ui] = await Promise.all([
    readFile(files.schemas, "utf8"),
    readFile(files.openapi, "utf8"),
    readFile(files.postCreate, "utf8"),
    readFile(files.feed, "utf8"),
    readFile(files.ui, "utf8"),
  ]);

  assert.match(
    schemas,
    /courseId:\s*z\.string\(\)\.uuid\(\)\.nullable\(\)\.optional\(\)/,
  );
  assert.match(openapi, /CommunityCourseLink/);
  assert.match(openapi, /courseLink/);
  assert.match(postCreate, /requireCommunityCourseLinkForActor\(tx, author, input\.courseId\)/);
  assert.match(feed, /communityCourseLinksForPosts/);
  assert.match(ui, /post\.courseLink/);
  assert.doesNotMatch(schemas, /postCreateSchema[\s\S]{0,600}(?:url|href):\s*z\./i);
});
