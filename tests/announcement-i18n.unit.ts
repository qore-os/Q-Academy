import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

import { getAnnouncementCopy } from "../src/lib/i18n/announcements";
import { SUPPORTED_LOCALES } from "../src/lib/i18n/model";

const sourceFiles = [
  "src/app/(admin)/admin/announcements/page.tsx",
  "src/components/admin/announcement-manager.tsx",
  "src/components/admin/announcement-block-editor.tsx",
  "src/components/academy/announcement-layer.tsx",
  "src/app/(member)/academy/layout.tsx",
  "src/lib/announcement-actions.ts",
] as const;

function flattenCopy(
  value: unknown,
  prefix = "",
  result = new Map<string, string>(),
) {
  if (typeof value === "string") {
    result.set(prefix, value.trim());
  } else if (typeof value === "function") {
    result.set(prefix, String(value(2, 4)).trim());
  } else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      flattenCopy(child, prefix ? `${prefix}.${key}` : key, result);
    }
  }
  return result;
}

function renderedStringExpression(node: ts.StringLiteralLike) {
  let current: ts.Node = node;
  while (current.parent && !ts.isJsxExpression(current.parent)) {
    const parent = current.parent;
    if (ts.isConditionalExpression(parent)) {
      if (parent.condition === current) return false;
      current = parent;
      continue;
    }
    if (
      ts.isParenthesizedExpression(parent) ||
      ts.isAsExpression(parent) ||
      ts.isSatisfiesExpression(parent) ||
      ts.isBinaryExpression(parent)
    ) {
      current = parent;
      continue;
    }
    return false;
  }
  return Boolean(
    current.parent &&
      ts.isJsxExpression(current.parent) &&
      !ts.isJsxAttribute(current.parent.parent),
  );
}

function actionableLiterals(file: string) {
  const source = readFileSync(file, "utf8");
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const findings: string[] = [];
  const technicalTokens = new Set([
    "Admin",
    "Banner",
    "Bundle",
    "Modal",
    "Owner",
    "Trainer",
  ]);
  const add = (node: ts.Node, value: string) => {
    const normalized = value.replace(/\s+/g, " ").trim();
    if (
      !/[A-Za-z]/.test(normalized) ||
      technicalTokens.has(normalized) ||
      normalized.startsWith("/")
    ) {
      return;
    }
    const line =
      sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
    findings.push(`${file}:${line}: ${normalized}`);
  };

  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node)) add(node, node.text);
    if (
      ts.isStringLiteral(node) &&
      ts.isJsxAttribute(node.parent) &&
      ["aria-label", "title", "placeholder"].includes(
        node.parent.name.getText(sourceFile),
      )
    ) {
      add(node, node.text);
    }
    if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
      renderedStringExpression(node)
    ) {
      add(node, node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return [...new Set(findings)];
}

test("announcement dictionaries have strict DE/EN/IT/ES/FR parity", () => {
  const german = flattenCopy(getAnnouncementCopy("de"));
  assert.ok(
    german.size >= 150,
    `expected at least 150 announcement copy leaves, received ${german.size}`,
  );

  for (const locale of SUPPORTED_LOCALES) {
    const localized = flattenCopy(getAnnouncementCopy(locale));
    assert.deepEqual([...localized.keys()].sort(), [...german.keys()].sort());
    for (const [key, value] of localized) {
      if (
        key === "templates.maintenance.href" ||
        key === "templates.maintenance.actionLabel"
      ) {
        assert.equal(value, "");
      } else {
        assert.ok(value.length > 0, `${locale}.${key} must not be empty`);
      }
    }
    if (locale !== "de") {
      const changed = [...localized].filter(
        ([key, value]) => value !== german.get(key),
      ).length;
      assert.ok(
        changed >= 130,
        `${locale} changes only ${changed}/${german.size} leaves`,
      );
    }
  }
});

test("announcement surfaces require explicit locale and contain zero actionable hardcoded copy", () => {
  const page = readFileSync(sourceFiles[0], "utf8");
  const manager = readFileSync(sourceFiles[1], "utf8");
  const blockEditor = readFileSync(sourceFiles[2], "utf8");
  const layer = readFileSync(sourceFiles[3], "utf8");
  const academyLayout = readFileSync(sourceFiles[4], "utf8");
  const actions = readFileSync(sourceFiles[5], "utf8");

  assert.match(page, /resolveUserLocale\(user\)/);
  assert.match(page, /<AnnouncementManager[\s\S]*locale=\{locale\}/);
  assert.match(manager, /locale: AppLocale/);
  assert.match(blockEditor, /locale: AppLocale/);
  assert.match(layer, /locale: AppLocale/);
  assert.match(
    academyLayout,
    /<AnnouncementLayer[\s\S]*locale=\{locale\}/,
  );
  assert.match(actions, /normalizeLocale\(formData\.get\("locale"\)\)/);
  assert.doesNotMatch(actions, /ApiError\)[\s\S]{0,100}?\.message/);
  assert.deepEqual(sourceFiles.flatMap(actionableLiterals), []);

  const source = `${page}\n${manager}\n${blockEditor}\n${layer}`;
  for (const formerlyHardcoded of [
    "Ankuendigungen durchsuchen",
    "Neue Ankuendigung",
    "Zielgruppenregeln",
    "Vorschau berechnen",
    "Sichere Variablen",
    "Inhaltsvorschau",
    "Neu in deiner Academy",
    "Ankuendigung schliessen",
  ]) {
    assert.doesNotMatch(source, new RegExp(formerlyHardcoded));
  }
});
