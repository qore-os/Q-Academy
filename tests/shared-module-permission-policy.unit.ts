import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import {
  canMutateSharedModuleContent,
  canUseLinkModuleTarget,
} from "../src/lib/shared-module-permission-policy";

test("owner and admin may always mutate shared module content", () => {
  for (const actorRole of ["owner", "admin"] as const) {
    assert.equal(
      canMutateSharedModuleContent({
        actorRole,
        referencedCoursePermissions: [null, "view"],
      }),
      true,
    );
  }
});

test("trainer is denied when any referencing course lacks edit permission", () => {
  for (const referencedCoursePermissions of [
    ["edit", null],
    ["manage", "view"],
    [null],
  ] as const) {
    assert.equal(
      canMutateSharedModuleContent({
        actorRole: "trainer",
        referencedCoursePermissions,
      }),
      false,
    );
  }
});

test("trainer may mutate only when every referencing course grants edit or manage", () => {
  for (const referencedCoursePermissions of [
    [],
    ["edit"],
    ["edit", "manage"],
  ] as const) {
    assert.equal(
      canMutateSharedModuleContent({
        actorRole: "trainer",
        referencedCoursePermissions,
      }),
      true,
    );
  }
  assert.equal(
    canMutateSharedModuleContent({
      actorRole: "member",
      referencedCoursePermissions: [],
    }),
    false,
  );
});

test("link module targets require trainer view permission and never trust an ID alone", () => {
  assert.equal(
    canUseLinkModuleTarget({
      actorRole: "trainer",
      targetCoursePermission: null,
    }),
    false,
  );
  for (const targetCoursePermission of ["view", "edit", "manage"] as const) {
    assert.equal(
      canUseLinkModuleTarget({
        actorRole: "trainer",
        targetCoursePermission,
      }),
      true,
    );
  }
  assert.equal(
    canUseLinkModuleTarget({
      actorRole: "admin",
      targetCoursePermission: null,
    }),
    true,
  );
});

function actionSource(source: string, action: string) {
  const start = source.indexOf(`export async function ${action}`);
  assert.notEqual(start, -1, `${action} is missing`);
  const next = source.indexOf("\nexport async function ", start + 1);
  return source.slice(start, next === -1 ? source.length : next);
}

test("all shared builder content mutations use the central permission", () => {
  const builder = readFileSync(
    resolve(process.cwd(), "src/lib/course-builder-actions.ts"),
    "utf8",
  );
  for (const action of [
    "updateCourseLinkModuleAction",
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
    "updateModuleSectionAccessAction",
    "updateCourseLessonAccessAction",
    "updateCourseLessonAssessmentAction",
  ]) {
    assert.match(
      actionSource(builder, action),
      /requireSharedModuleContentPermission\(/,
      `${action} must enforce all referencing course permissions`,
    );
  }

  for (const action of [
    "updateCourseModuleOutlineAction",
    "detachCourseModuleAction",
    "updateCourseModuleAccessAction",
  ]) {
    assert.doesNotMatch(
      actionSource(builder, action),
      /requireSharedModuleContentPermission\(/,
      `${action} is course-local and must not require every module reference`,
    );
  }

  assert.match(
    actionSource(builder, "attachReusableModuleAction"),
    /requireSharedModuleContentPermission\(/,
    "attachReusableModuleAction must validate every reference before binding shared media",
  );
});

test("link target and secondary content actions use their central guards", () => {
  const builder = readFileSync(
    resolve(process.cwd(), "src/lib/course-builder-actions.ts"),
    "utf8",
  );
  for (const action of [
    "createCourseModuleAction",
    "attachReusableModuleAction",
  ]) {
    assert.match(
      actionSource(builder, action),
      /requireLinkModuleTargetViewPermission\(/,
      `${action} must validate direct link target IDs`,
    );
  }

  const updateLink = actionSource(builder, "updateCourseLinkModuleAction");
  assert.match(updateLink, /requireSharedModuleContentPermission\(/);
  assert.match(
    updateLink,
    /courseId:\s*parsed\.data\.linkedCourseId,\s*required:\s*"view"/,
    "shared link updates must lock and authorize the target with all references",
  );

  for (const path of [
    "src/lib/admin/transcript-wizard-actions.ts",
    "src/lib/section-lesson-visibility-actions.ts",
  ]) {
    const source = readFileSync(resolve(process.cwd(), path), "utf8");
    assert.match(source, /requireSharedModuleContentPermission\(/, path);
  }
});
