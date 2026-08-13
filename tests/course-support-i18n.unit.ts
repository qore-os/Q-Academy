import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import ts from "typescript";

import type { CourseVersionSnapshot } from "../src/db/schema";
import {
  getCourseCategoryActionCopy,
  getCourseCategoryColorCopy,
  getCourseSupportCopy,
} from "../src/lib/i18n/course-support";
import { SUPPORTED_LOCALES } from "../src/lib/i18n/model";

type Leaf = { kind: "string" | "function"; value: string; arity: number };

function flatten(
  value: unknown,
  prefix = "",
  result = new Map<string, Leaf>(),
) {
  if (typeof value === "string") {
    result.set(prefix, { kind: "string", value: value.trim(), arity: 0 });
    return result;
  }
  if (typeof value === "function") {
    const fn = value as (...args: string[]) => string;
    result.set(prefix, {
      kind: "function",
      value: fn("__A__", "__B__", "__C__").trim(),
      arity: fn.length,
    });
    return result;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      flatten(child, prefix ? `${prefix}.${key}` : key, result);
    }
  }
  return result;
}

test("course support copy has complete key and placeholder parity", () => {
  const german = flatten(getCourseSupportCopy("de"));
  assert.ok(german.size >= 250, `unexpectedly small catalog: ${german.size}`);

  for (const locale of SUPPORTED_LOCALES) {
    const localized = flatten(getCourseSupportCopy(locale));
    assert.deepEqual([...localized.keys()], [...german.keys()]);
    assert.deepEqual(
      [...localized].map(([key, leaf]) => [key, leaf.kind, leaf.arity]),
      [...german].map(([key, leaf]) => [key, leaf.kind, leaf.arity]),
      `${locale} function placeholders differ`,
    );
    assert.ok(
      [...localized.values()].every((leaf) => leaf.value.length > 0),
      `${locale} contains empty copy`,
    );
    for (const [key, leaf] of localized) {
      if (leaf.kind === "function" && leaf.arity > 0) {
        assert.match(leaf.value, /__A__/, `${locale}.${key} drops its placeholder`);
      }
    }
    if (locale !== "de") {
      const changed = [...localized].filter(
        ([key, leaf]) => leaf.value !== german.get(key)?.value,
      ).length;
      assert.ok(
        changed / localized.size >= 0.8,
        `${locale} localizes only ${changed}/${localized.size} leaves`,
      );
    }
  }
});

test("German course media copy uses native umlauts and eszett", () => {
  const copy = getCourseSupportCopy("de");

  assert.equal(copy.media.selectFile, "Datei auswählen");
  assert.equal(copy.media.processing, "Sicherheitsprüfung");
  assert.equal(copy.media.ready, "Geprüft und bereit");
  assert.equal(
    getCourseCategoryColorCopy("de").picker,
    "Kategoriefarbe auswählen",
  );
  assert.equal(
    getCourseCategoryActionCopy("de").delete("Kategorie"),
    "Kategorie löschen",
  );
  assert.equal(
    copy.media.errors.invalidFile,
    "Dateityp oder Dateigröße ist ungültig.",
  );
});

test("course support surfaces render catalog copy instead of direct UI literals", () => {
  const files = [
    "src/components/admin/course-change-overview.tsx",
    "src/components/admin/course-explorer.tsx",
    "src/components/admin/course-category-manager.tsx",
    "src/components/admin/course-creation-dialog.tsx",
    "src/components/admin/course-widgets-editor.tsx",
    "src/components/admin/course-media-source-field.tsx",
    "src/components/admin/course-information-lists-editor.tsx",
    "src/components/admin/course-module-access-admin.tsx",
    "src/components/admin/gallery-block-editor.tsx",
    "src/app/(admin)/admin/courses/[id]/team/page.tsx",
    "src/app/(admin)/admin/courses/[id]/preview/page.tsx",
    "src/app/(admin)/admin/courses/[id]/access/page.tsx",
  ];
  const directCopy: string[] = [];
  const uiAttributes = new Set([
    "alt",
    "aria-label",
    "description",
    "label",
    "placeholder",
    "submitLabel",
    "title",
  ]);

  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const sourceFile = ts.createSourceFile(
      file,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    function visit(node: ts.Node) {
      if (ts.isJsxText(node)) {
        const text = node
          .getText(sourceFile)
          .replace(/\{\s*["']\s+["']\s*\}/g, "")
          .trim();
        if (/[A-Za-z]/.test(text)) directCopy.push(`${file}: ${text}`);
      }
      if (
        ts.isJsxAttribute(node) &&
        node.initializer &&
        ts.isStringLiteral(node.initializer) &&
        node.initializer.text.length > 0 &&
        uiAttributes.has(node.name.getText(sourceFile)) &&
        !/^(?:https:\/\/|\/)/.test(node.initializer.text)
      ) {
        directCopy.push(`${file}: ${node.initializer.text}`);
      }
      ts.forEachChild(node, visit);
    }
    visit(sourceFile);
  }

  assert.deepEqual(directCopy, []);
});

test("course support mutations do not expose raw server error messages", () => {
  const files = [
    "src/lib/admin/ai-course-actions.ts",
    "src/lib/admin/course-category-actions.ts",
    "src/lib/course-widget-actions.ts",
    "src/lib/course-module-access-actions.ts",
    "src/components/admin/course-media-source-field.tsx",
  ];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(
      source,
      /return\s+\{[\s\S]*?error:\s*error\.message/,
      file,
    );
    assert.doesNotMatch(source, /message:\s*error\.message/, file);
    assert.doesNotMatch(source, /payload\.detail\s*\|\|/, file);
  }
});

test("course snapshot diffs localize system copy without changing authored content", async () => {
  const { diffCourseSnapshots } = await import("../src/lib/course-change-log");
  const capturedAt = new Date(0).toISOString();
  const snapshot: CourseVersionSnapshot = {
    schemaVersion: 6,
    accessPolicyVersion: 2,
    moduleKindVersion: 1,
    courseOutlineVersion: 1,
    capturedAt,
    course: {
      id: "00000000-0000-4000-8000-000000000001",
      organizationId: "00000000-0000-4000-8000-000000000002",
      categoryId: null,
      title: "Authored sentinel",
      slug: "authored-sentinel",
      shortDescription: "Authored description",
      description: "Authored description",
      coverImage: null,
      status: "draft",
      difficulty: "beginner",
      estimatedMinutes: 0,
      certificateEnabled: false,
      featured: false,
      visibleInCatalog: true,
      showProgressPercentage: true,
      notifyMembersOnModuleRelease: false,
      publishedVersionId: null,
      firstPublishedAt: null,
      createdById: null,
      createdAt: capturedAt,
      updatedAt: capturedAt,
    },
    learningGoals: [],
    authors: [],
    widgets: [],
    modules: [],
  };

  const english = diffCourseSnapshots(null, snapshot, "en");
  const italian = diffCourseSnapshots(null, snapshot, "it");
  const french = diffCourseSnapshots(null, snapshot, "fr");
  assert.equal(english.groups[0]?.label, "Course information");
  assert.equal(italian.groups[0]?.label, "Informazioni corso");
  assert.equal(french.groups[0]?.label, "Informations du cours");
  assert.equal(english.groups[0]?.entries[0]?.title, "Course draft created");
});
