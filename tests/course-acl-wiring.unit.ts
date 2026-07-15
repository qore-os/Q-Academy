import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path: string) {
  return readFileSync(path, "utf8");
}

function assertActionPermission(
  contents: string,
  actionName: string,
  permission: "view" | "edit" | "manage",
) {
  assert.match(
    contents,
    new RegExp(
      `export async function ${actionName}\\([\\s\\S]{0,700}?requireCoursePermission\\(courseId, "${permission}"\\)`,
    ),
    `${actionName} must require ${permission}`,
  );
}

test("every course builder mutation requires edit", () => {
  const contents = source("src/lib/course-builder-actions.ts");
  for (const actionName of [
    "updateCourseInformationAction",
    "createCourseModuleAction",
    "attachReusableModuleAction",
    "updateCourseModuleOutlineAction",
    "updateCourseLinkModuleAction",
    "detachCourseModuleAction",
    "createModuleSectionAction",
    "createModuleLessonAction",
    "createLessonPageAction",
    "updateCourseLessonTitleAction",
    "updateLessonPageTitleAction",
    "addCourseContentBlockAction",
    "updateCourseContentBlockAction",
    "deleteCourseContentBlockAction",
    "duplicateCourseContentBlockAction",
    "reorderCourseContentBlocksAction",
    "updateCourseModuleAccessAction",
    "updateModuleSectionAccessAction",
    "updateCourseLessonAccessAction",
    "updateCourseLessonAssessmentAction",
  ]) {
    assertActionPermission(contents, actionName, "edit");
  }
  assert.doesNotMatch(contents, /requireAdmin\(\)/);
});

test("adjacent course content actions require edit", () => {
  const widgetActions = source("src/lib/course-widget-actions.ts");
  for (const actionName of [
    "createCourseWidgetAction",
    "updateCourseWidgetAction",
    "deleteCourseWidgetAction",
    "reorderCourseWidgetsAction",
  ]) {
    assertActionPermission(widgetActions, actionName, "edit");
  }
  assertActionPermission(
    source("src/lib/section-lesson-visibility-actions.ts"),
    "setSectionLessonsVisibilityAction",
    "edit",
  );
  assertActionPermission(
    source("src/lib/admin/transcript-wizard-actions.ts"),
    "createBlocksFromTranscriptAction",
    "edit",
  );
});

test("publication is manage-only while builder and preview use edit and view", () => {
  const actions = source("src/lib/actions.ts");
  assertActionPermission(actions, "toggleCourseStatusAction", "manage");
  assertActionPermission(actions, "publishCourseChangesAction", "manage");

  assert.match(
    source("src/app/(admin)/admin/courses/[id]/page.tsx"),
    /requireCoursePermission\(id, "edit"\)/,
  );
  assert.match(
    source("src/app/(admin)/admin/courses/[id]/preview/page.tsx"),
    /requireCoursePermission\(id, "view"\)/,
  );
});

test("trainer course creators receive manage in manual and AI flows", () => {
  const actions = source("src/lib/actions.ts");
  assert.match(
    actions,
    /if \(currentActor\.role === "trainer"\) \{[\s\S]{0,500}?permission: "manage"/,
  );

  const aiActions = source("src/lib/admin/ai-course-actions.ts");
  assert.match(
    aiActions,
    /if \(currentAuthor\.role === "trainer"\) \{[\s\S]{0,500}?permission: "manage"/,
  );
});

test("course-bound moderation is filtered and rejects unassigned direct actions", () => {
  const tasksPage = source("src/app/(admin)/admin/tasks/page.tsx");
  assert.match(tasksPage, /coursePermissionMapForUser/);
  assert.match(tasksPage, /coursePermissionAllows[\s\S]{0,200}?"edit"/);

  const actions = source("src/lib/actions.ts");
  assert.match(
    actions,
    /export async function reviewSubmissionAction\([\s\S]{0,1800}?coursePermissionForUser[\s\S]{0,300}?coursePermissionAllows\(permission, "edit"\)/,
  );

  const feedbackActions = source("src/lib/feedback-actions.ts");
  assert.match(
    feedbackActions,
    /async function canModerateFeedback\([\s\S]{0,1200}?coursePermissionForUser[\s\S]{0,100}?"edit"/,
  );
  assert.match(
    feedbackActions,
    /export async function reviewFeedbackAction\([\s\S]{0,800}?canModerateFeedback/,
  );
  assert.match(
    feedbackActions,
    /export async function replyToFeedbackAction\([\s\S]{0,800}?canModerateFeedback/,
  );
});
