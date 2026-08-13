import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
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

test("transactional course ACL locks every course before actor and grants", () => {
  const permissions = source("src/lib/course-permissions.ts");
  const multi = permissions.slice(
    permissions.indexOf(
      "export async function requireCoursePermissionsInTransaction",
    ),
  );
  assertOrdered(multi, [
    "for (const lockedCourseId of sortedCourseIds)",
    '.for("update")',
    "const [currentActor]",
    '.for("share")',
    "const grants =",
  ]);
  assert.match(multi, /eq\(users\.status, "active"\)/);
  assert.match(multi, /coursePermissionAllows\(/);
});

test("collaborator updates retain course, actor, target lock order", () => {
  const collaborator = actionSource(
    source("src/lib/admin/course-collaborator-actions.ts"),
    "setCourseCollaboratorAction",
  );
  assertOrdered(collaborator, [
    "const [course]",
    '.for("update")',
    "const [currentActor]",
    '.for("share")',
    "const [collaborator]",
    '.for("update")',
    'parsed.data.permission === "none"',
  ]);
  assert.match(collaborator, /inArray\(users\.role, \["owner", "admin"\]\)/);
});

test("course writers recheck permissions inside their transactions", () => {
  const builder = source("src/lib/course-builder-actions.ts");
  for (const action of [
    "updateCourseInformationAction",
    "createCourseModuleAction",
    "attachReusableModuleAction",
    "updateCourseModuleOutlineAction",
    "detachCourseModuleAction",
    "updateCourseModuleAccessAction",
  ]) {
    assert.match(
      actionSource(builder, action),
      /requireCoursePermissionInTransaction\(/,
      action,
    );
  }

  for (const action of [
    "createModuleLessonAction",
    "moveCourseLessonAction",
    "createLessonPageAction",
    "updateCourseLessonTitleAction",
    "updateLessonPageTitleAction",
    "addCourseContentBlockAction",
    "updateCourseContentBlockAction",
    "deleteCourseContentBlockAction",
    "duplicateCourseContentBlockAction",
    "reorderCourseContentBlocksAction",
    "updateCourseLessonAccessAction",
    "updateCourseLessonAssessmentAction",
  ]) {
    assert.match(
      actionSource(builder, action),
      /requireSharedModuleContentPermission\(\s*tx,\s*user,\s*courseId/,
      action,
    );
  }

  const widgets = source("src/lib/course-widget-actions.ts");
  for (const action of [
    "createCourseWidgetAction",
    "updateCourseWidgetAction",
    "deleteCourseWidgetAction",
    "reorderCourseWidgetsAction",
  ]) {
    assert.match(
      actionSource(widgets, action),
      /requireCoursePermissionInTransaction\(/,
      action,
    );
  }
});

test("graph mutations lock graph before course ACL and publication rows", () => {
  const actions = source("src/lib/actions.ts");
  for (const action of [
    "toggleCourseStatusAction",
    "publishCourseChangesAction",
  ]) {
    assertOrdered(actionSource(actions, action), [
      "lockCourseLinkGraph(",
      "requireCoursePermissionInTransaction(",
      "lockCourseForVersion(",
    ]);
  }

  const shared = source("src/lib/shared-module-permissions.ts");
  const sharedGuard = shared.slice(
    shared.indexOf(
      "export async function requireSharedModuleContentPermission",
    ),
    shared.indexOf(
      "export async function requireLinkModuleTargetViewPermission",
    ),
  );
  assertOrdered(sharedGuard, [
    "lockCourseLinkGraph(",
    "const references =",
    "requireCoursePermissionsInTransaction(",
  ]);
});

test("manual course creation revalidates and locks its active actor", () => {
  const createCourse = actionSource(source("src/lib/actions.ts"), "createCourseAction");
  assertOrdered(createCourse, [
    "const [currentActor]",
    'eq(users.status, "active")',
    '.for("update")',
    "const [category]",
    ".insert(courses)",
  ]);
  assert.match(createCourse, /currentActor\.role === "trainer"/);
});

test("submission and feedback rows are locked only after course authorization", () => {
  const submissions = source("src/lib/submissions.ts");
  const review = submissions.slice(
    submissions.indexOf(
      "export async function reviewSubmissionAttemptInTransaction",
    ),
    submissions.indexOf("export async function reviewSubmissionAttempt(", 1),
  );
  assertOrdered(review, [
    "const [submissionTarget]",
    "requireCoursePermissionInTransaction(",
    "const [record]",
    '.for("update", { of: submissions })',
  ]);
  assert.match(
    review,
    /eq\(submissions\.courseId, submissionTarget\.courseId\)/,
  );

  const feedback = source("src/lib/feedback-service.ts");
  for (const action of [
    "updateFeedbackStatusInTransaction",
    "queueFeedbackReplyInTransaction",
  ]) {
    assertOrdered(actionSource(feedback, action), [
      "requireFeedbackModerationPermission(",
      "feedbackTargetForUpdate(",
    ]);
  }
});

test("interactive feedback uses course ACL while API scopes retain tenant access", () => {
  const feedbackActions = source("src/lib/feedback-actions.ts");
  assert.equal((feedbackActions.match(/access: "course"/g) ?? []).length, 2);

  for (const path of [
    "src/app/api/v1/feedback/[id]/route.ts",
    "src/app/api/v1/feedback/[id]/reply/route.ts",
  ]) {
    assert.match(source(path), /access: "tenant"/, path);
  }
});
