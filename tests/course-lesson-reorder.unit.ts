import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path: string) {
  return readFileSync(path, "utf8");
}

function actionSource(input: string, action: string) {
  const start = input.indexOf(`export async function ${action}`);
  assert.notEqual(start, -1, `${action} is missing`);
  const next = input.indexOf("\nexport async function ", start + 1);
  return input.slice(start, next === -1 ? input.length : next);
}

function assertOrdered(input: string, labels: readonly string[]) {
  let previous = -1;
  for (const label of labels) {
    const current = input.indexOf(label, previous + 1);
    assert.notEqual(current, -1, `${label} is missing`);
    assert.ok(current > previous, `${label} is out of order`);
    previous = current;
  }
}

test("lesson moves authorize, lock, normalize and audit in one transaction", () => {
  const action = actionSource(
    source("src/lib/course-builder-actions.ts"),
    "moveCourseLessonAction",
  );

  assert.match(action, /direction: z\.enum\(\["up", "down"\]\)/);
  assertOrdered(action, [
    "db.transaction(async (tx)",
    "requireSharedModuleContentPermission(",
    ".from(lessons)",
    ".orderBy(asc(lessons.sortOrder), asc(lessons.id))",
    '.for("update")',
    "const reordered = [...moduleLessons]",
    "for (const [sortOrder, lesson] of reordered.entries())",
    ".update(lessons)",
    ".insert(activityEvents)",
    "for (const referencedCourseId of new Set(moved.referencedCourseIds))",
    "revalidateCourse(referencedCourseId)",
  ]);
  assert.match(action, /type: "course\.lesson\.moved"/);
  assert.match(action, /code: "course_builder\.lesson\.edge_reached"/);
  assert.match(action, /code: "course_builder\.lesson\.moved"/);
});

test("lesson rows use sibling move controls and a wrapping access grid", () => {
  const builder = source("src/components/admin/course-builder.tsx");
  const listStart = builder.indexOf(
    "{module.lessons.map((lesson, lessonIndex) => (",
  );
  const listEnd = builder.indexOf("{module.kind === \"learning\"", listStart);
  assert.notEqual(listStart, -1, "lesson list is missing");
  assert.notEqual(listEnd, -1, "lesson list boundary is missing");
  const list = builder.slice(listStart, listEnd);

  assert.match(list, /<div\s+key=\{lesson\.id\}/);
  assert.match(list, /moveCourseLessonAction\([\s\S]*?"up"/);
  assert.match(list, /moveCourseLessonAction\([\s\S]*?"down"/);
  assert.match(list, /disabled=\{pending \|\| lessonIndex === 0\}/);
  assert.match(list, /lessonIndex === module\.lessons\.length - 1/);
  assert.match(list, /<ArrowUp className="size-3\.5" \/>/);
  assert.match(list, /<ArrowDown className="size-3\.5" \/>/);
  assert.doesNotMatch(list, /<button\s+key=\{lesson\.id\}/);

  assert.match(
    builder,
    /sm:grid-cols-2 sm:items-end 2xl:grid-cols-3/,
  );
  assert.doesNotMatch(
    builder,
    /xl:grid-cols-\[130px_150px_130px_minmax\(0,1fr\)_190px_auto\]/,
  );
});
