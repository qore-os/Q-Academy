import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  courseBuilderActionCodes,
  getCourseBuilderActionMessage,
} from "../src/lib/i18n/course-builder-actions";
import { getAdminEntityCopy } from "../src/lib/i18n/admin-entities";
import type { AppLocale } from "../src/lib/i18n/model";

const locales: AppLocale[] = ["de", "en", "it", "es", "fr"];

test("course builder action codes resolve in every supported locale", () => {
  for (const locale of locales) {
    for (const code of courseBuilderActionCodes) {
      const message = getCourseBuilderActionMessage(locale, code);
      assert.ok(message.trim(), `${locale}:${code}`);
      assert.notEqual(message, code, `${locale}:${code}`);
    }
  }
});

test("course builder actions return stable codes instead of client-facing German", () => {
  const actions = readFileSync("src/lib/course-builder-actions.ts", "utf8");
  const client = readFileSync("src/components/admin/course-builder.tsx", "utf8");

  assert.doesNotMatch(actions, /failure\(error\.message\)/);
  assert.doesNotMatch(actions, /return\s+failure\("(?!course_|course_content_copy\.)/);
  assert.doesNotMatch(actions, /return\s+success\("(?!course_|course_content_copy\.)/);
  assert.doesNotMatch(client, /result\.message/);
  assert.match(client, /getCourseBuilderActionMessage\(locale, result\.code\)/);
});

test("module creation dialog has complete localized copy", () => {
  const dialog = readFileSync("src/components/admin/admin-create-dialog.tsx", "utf8");
  const modulePage = readFileSync(
    "src/app/(admin)/admin/modules/page.tsx",
    "utf8",
  );
  const keys = [
    "create.moduleButton",
    "create.moduleTitle",
    "create.moduleType",
    "create.moduleLearning",
    "create.moduleExam",
    "create.moduleDescription",
    "create.moduleFolder",
    "create.moduleDuration",
    "create.moduleReusable",
    "create.moduleSuccess",
  ] as const;

  for (const locale of locales) {
    const copy = getAdminEntityCopy(locale);
    for (const key of keys) assert.ok(copy(key).trim(), `${locale}:${key}`);
  }

  assert.doesNotMatch(
    dialog,
    />\s*(Modultyp|Lernmodul|Pruefungsmodul|Titel|Ordner|Abbrechen)\s*</,
  );
  assert.doesNotMatch(dialog, /label\s*=\s*"Beschreibung"/);
  assert.match(
    dialog,
    /resource === "group"\s*\|\|\s*resource === "bundle"\s*\|\|\s*resource === "module"\s*\|\|\s*resource === "hub"/,
  );

  const moduleCreateButtons = [
    ...modulePage.matchAll(/<AdminCreateButton\b[\s\S]*?\/>/g),
  ];
  assert.equal(moduleCreateButtons.length, 2);
  for (const [button] of moduleCreateButtons) {
    assert.match(button, /resource="module"/);
    assert.match(button, /locale=\{locale\}/);
  }
});
