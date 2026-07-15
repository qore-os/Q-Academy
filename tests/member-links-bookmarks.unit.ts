import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { normalizeMemberSidebarHref } from "../src/lib/member-sidebar-link-model";

const read = (file: string) =>
  readFileSync(path.resolve(process.cwd(), file), "utf8");

test("member sidebar URLs accept only tenant paths and credential-free HTTPS", () => {
  assert.equal(normalizeMemberSidebarHref(" /academy/hub?tab=tools#top "), "/academy/hub?tab=tools#top");
  assert.equal(normalizeMemberSidebarHref("https://docs.example.com/start"), "https://docs.example.com/start");
  assert.equal(normalizeMemberSidebarHref("javascript:alert(1)"), null);
  assert.equal(normalizeMemberSidebarHref("//evil.example/path"), null);
  assert.equal(normalizeMemberSidebarHref("https://user:secret@example.com"), null);
  assert.equal(normalizeMemberSidebarHref("http://example.com"), null);
  assert.equal(normalizeMemberSidebarHref("/academy\\evil"), null);
});

test("0061 binds bookmarks to one tenant, course module, and lesson module", () => {
  const migration = read("drizzle/0061_member_links_bookmarks.sql");
  const uniqueIndex = migration.indexOf(
    'CREATE UNIQUE INDEX "lessons_id_module_organization_idx"',
  );
  const bookmarkForeignKey = migration.indexOf(
    'ADD CONSTRAINT "lesson_bookmarks_lesson_module_tenant_fk"',
  );
  assert.ok(uniqueIndex >= 0 && uniqueIndex < bookmarkForeignKey);
  assert.match(
    migration,
    /FOREIGN KEY \("course_id","module_id","organization_id"\).*"course_modules"\("course_id","module_id","organization_id"\)/,
  );
  assert.match(
    migration,
    /FOREIGN KEY \("lesson_id","module_id","organization_id"\).*"lessons"\("id","module_id","organization_id"\)/,
  );
  assert.match(migration, /ON DELETE cascade/);
});

test("bookmark mutations reauthorize access and sidebar mutations serialize", () => {
  const bookmarks = read("src/lib/lesson-bookmarks.ts");
  const sidebar = read("src/lib/member-sidebar-links.ts");
  const academyLayout = read("src/app/(member)/academy/layout.tsx");
  const navigation = read("src/components/layout/navigation-shell.tsx");
  assert.match(bookmarks, /pg_advisory_xact_lock/);
  assert.match(bookmarks, /getCourseLearningAccess\(tx/);
  assert.match(bookmarks, /lesson\?\.access\.accessible/);
  assert.match(sidebar, /member-sidebar-links:/);
  assert.match(sidebar, /inArray\(users\.role, \["owner", "admin"\]\)/);
  assert.match(academyLayout, /listMemberSidebarLinks\(user\.organizationId\)/);
  assert.match(navigation, /rel="noreferrer noopener"/);
});

test("privacy export and erasure cover personal lesson bookmarks", () => {
  const exporter = read("scripts/export-user-data.ts");
  const erasure = read("src/lib/privacy/erasure-executor.ts");
  const inventory = read("src/lib/privacy/data-inventory.ts");
  assert.match(exporter, /const lessonBookmarks = await tx/);
  assert.match(exporter, /lessonBookmarks,/);
  assert.match(erasure, /delete from lesson_bookmarks/);
  assert.match(inventory, /lesson_bookmarks: table/);
  assert.match(inventory, /member_sidebar_links: table/);
});
