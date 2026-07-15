import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const actions = readFileSync(
  path.join(root, "src/lib/course-builder-actions.ts"),
  "utf8",
);
const service = readFileSync(
  path.join(root, "src/lib/course-content-copy-service.ts"),
  "utf8",
);
const cloneRoute = readFileSync(
  path.join(root, "src/app/api/v1/courses/[id]/clone/route.ts"),
  "utf8",
);

test("copy actions recheck both courses in one transaction and write audit events", () => {
  for (const action of ["copyCourseLessonAction", "copyCourseSectionAction"]) {
    const start = actions.indexOf(`export async function ${action}`);
    assert.notEqual(start, -1, `${action} is missing`);
    const body = actions.slice(
      start,
      actions.indexOf("\nexport async function", start + 1),
    );
    assert.match(body, /db\.transaction\(async \(tx\)/);
    assert.match(body, /requireSharedModuleContentPermission\(/);
    assert.match(body, /sourceCourseId[\s\S]*required: "edit"/);
    assert.match(body, /tx\.insert\(activityEvents\)/);
  }
  assert.match(actions, /type: "course\.lesson\.copied"/);
  assert.match(actions, /type: "course\.section\.copied"/);
});

test("copy service enforces tenant, target status, media source binding and ordering locks", () => {
  assert.match(
    service,
    /eq\(courses\.organizationId, courseModules\.organizationId\)/,
  );
  assert.match(service, /target\.courseStatus === "archived"/);
  assert.match(
    service,
    /eq\(courseMediaAssets\.courseId, context\.sourceCourseId\)/,
  );
  assert.match(service, /eq\(mediaAssets\.purpose, "course_content"\)/);
  assert.match(service, /eq\(mediaAssets\.status, "ready"\)/);
  assert.match(service, /insert\(courseMediaAssets\)/);
  assert.match(service, /pg_advisory_xact_lock/);
  assert.match(service, /initialLessonSortOrder \+ index/);
});

test("copy service rejects dangling page and assessment references", () => {
  assert.match(
    service,
    /block\.pageId !== null && !pageIds\.has\(block\.pageId\)/,
  );
  assert.match(service, /remapCopiedExamQuestionPools/);
  assert.match(service, /reference_invalid/);
});

test("course clone and lesson or section copy strip source-course render jobs", () => {
  assert.match(service, /data: courseContentDataForCopy\(block\.data\)/);
  assert.match(cloneRoute, /courseContentDataForCopy\(block\.data\)/);
  assert.match(cloneRoute, /data: copiedBlockData\.get\(block\.id\)!/);
});

test("course clone remaps its lesson graph and preserves presentation metadata", () => {
  assert.match(
    cloneRoute,
    /blocks\.map\(\(block\) => \[block\.id, randomUUID\(\)\]\)/,
  );
  assert.match(cloneRoute, /remapCopiedExamQuestionPools\(/);
  assert.match(
    cloneRoute,
    /block\.pageId !== null && !pageIds\.has\(block\.pageId\)/,
  );
  assert.match(cloneRoute, /id: blockIds\.get\(block\.id\)!/);
  assert.match(cloneRoute, /pageId: block\.pageId \? pageIds\.get\(block\.pageId\)! : null/);
  assert.match(cloneRoute, /style: block\.style/);
  for (const field of ["layoutWidth", "backgroundTone", "contentSpacing"]) {
    assert.match(cloneRoute, new RegExp(`${field}: sourcePage\\.${field}`));
  }
});

test("course clone keeps explicit tenant predicates below the course boundary", () => {
  assert.match(
    cloneRoute,
    /eq\(courseModules\.organizationId, context\.organizationId\)/,
  );
  assert.match(
    cloneRoute,
    /eq\(moduleSections\.organizationId, context\.organizationId\)/,
  );
  assert.match(
    cloneRoute,
    /eq\(lessons\.organizationId, context\.organizationId\)/,
  );
  assert.match(cloneRoute, /requireActiveApiKeyCreator\(/);
  assert.match(cloneRoute, /scopes: \["courses:write", "modules:write"\]/);
});
