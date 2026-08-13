import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import ts from "typescript";

import { getCourseBuilderCopy } from "../src/lib/i18n/course-builder";
import { getMainPageDictionary } from "../src/lib/i18n/main-pages";
import { SUPPORTED_LOCALES } from "../src/lib/i18n/model";

function flattenCopy(
  value: unknown,
  prefix = "",
  result = new Map<string, string>(),
) {
  if (typeof value === "string") {
    result.set(prefix, value.trim());
    return result;
  }
  if (typeof value === "function") {
    result.set(prefix, String(value(2, "Sample")).trim());
    return result;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      flattenCopy(child, prefix ? `${prefix}.${key}` : key, result);
    }
  }
  return result;
}

test("course-builder copy has complete five-locale parity", () => {
  const german = flattenCopy(getCourseBuilderCopy("de"));
  assert.equal(german.size, 381);

  for (const locale of SUPPORTED_LOCALES) {
    const localized = flattenCopy(getCourseBuilderCopy(locale));
    assert.deepEqual([...localized.keys()], [...german.keys()]);
    assert.ok(
      [...localized.values()].every((value) => value.length > 0),
      `${locale} contains empty CourseBuilder copy`,
    );
    assert.deepEqual(
      localized,
      flattenCopy(getMainPageDictionary(locale).admin.courseEditor),
    );

    if (locale !== "de") {
      const changed = [...localized].filter(
        ([key, value]) => value !== german.get(key),
      ).length;
      assert.ok(
        changed / localized.size >= 0.9,
        `${locale} localizes only ${changed}/${localized.size} CourseBuilder leaves`,
      );
    }
  }
});

test("course-builder renders catalog copy instead of direct UI literals", () => {
  const file = "src/components/admin/course-builder.tsx";
  const source = readFileSync(file, "utf8");
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const directCopy: string[] = [];
  const uiAttributes = new Set([
    "alt",
    "aria-label",
    "description",
    "detail",
    "eyebrow",
    "label",
    "placeholder",
    "submitLabel",
    "title",
  ]);

  function visit(node: ts.Node) {
    if (ts.isJsxText(node)) {
      const text = node.getText(sourceFile).trim();
      if (/\p{L}/u.test(text)) {
        directCopy.push(text);
      }
    }
    if (
      ts.isJsxAttribute(node) &&
      node.initializer &&
      ts.isStringLiteral(node.initializer) &&
      uiAttributes.has(node.name.getText(sourceFile)) &&
      !/^(?:https:\/\/|\/images\/)/.test(node.initializer.text)
    ) {
      directCopy.push(node.initializer.text);
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  assert.deepEqual(directCopy, []);

  const legacyGermanCopy = [
    "Kursstatistik",
    "Einschreibungen gesamt",
    "Fortschritt aktiver Lernender",
    "Letzte Abgaben",
    "Noch keine Abgaben",
    "Modul anlegen",
    "Vorhandenes Modul verwenden",
    "Wiederverwendbares Modul",
    "Neues Modul",
    "Sektion anlegen",
    "Sektionstitel",
    "Lektion anlegen",
    "Lektionstitel",
    "Ohne Sektion",
    "Lektionsseite anlegen",
    "KI-Agent einbetten",
    "Agenten werden geladen",
    "Inhaltselement bearbeiten",
    "Aenderungen speichern",
    "Blockbreite",
    "Inhaltsbreite",
    "Volle Breite",
    "Ausrichtung",
    "Zentriert",
    "Umrandet",
    "Hinterlegt",
  ];
  for (const legacyCopy of legacyGermanCopy) {
    assert.ok(
      !source.includes(legacyCopy),
      `CourseBuilder still contains direct German copy: ${legacyCopy}`,
    );
  }

  assert.match(
    source,
    /formatDuration\(module\.estimatedMinutes, locale\)/,
  );
  assert.match(
    source,
    /formatDuration\(data\.course\.estimatedMinutes, locale\)/,
  );
  assert.match(
    source,
    /formatDate\(submission\.submittedAt, undefined, locale\)/,
  );
});
