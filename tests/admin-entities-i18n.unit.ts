import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import ts from "typescript";

import {
  adminEntityDictionaries,
  formatAdminEntityNumber,
  getAdminEntityCopy,
} from "../src/lib/i18n/admin-entities";
import { SUPPORTED_LOCALES } from "../src/lib/i18n/model";

const uiFiles = [
  "src/components/admin/group-detail-manager.tsx",
  "src/components/admin/bundle-detail-manager.tsx",
  "src/components/admin/hub-editor.tsx",
  "src/app/(admin)/admin/groups/page.tsx",
  "src/app/(admin)/admin/groups/[id]/page.tsx",
  "src/app/(admin)/admin/bundles/page.tsx",
  "src/app/(admin)/admin/bundles/[id]/page.tsx",
  "src/app/(admin)/admin/hubs/page.tsx",
  "src/app/(admin)/admin/hubs/[id]/page.tsx",
] as const;

function placeholders(value: string) {
  return [...value.matchAll(/\{([A-Za-z][A-Za-z0-9]*)\}/g)]
    .map((match) => match[1])
    .sort();
}

test("admin entity copy has complete five-locale key and placeholder parity", () => {
  const referenceKeys = Object.keys(adminEntityDictionaries.de);
  assert.equal(referenceKeys.length, 267);

  for (const locale of SUPPORTED_LOCALES) {
    const dictionary = adminEntityDictionaries[locale];
    assert.deepEqual(Object.keys(dictionary), referenceKeys);
    for (const key of referenceKeys) {
      const typedKey = key as keyof typeof dictionary;
      assert.ok(dictionary[typedKey].trim(), `${locale}.${key} is empty`);
      assert.deepEqual(
        placeholders(dictionary[typedKey]),
        placeholders(adminEntityDictionaries.de[typedKey]),
        `${locale}.${key} changes interpolation placeholders`,
      );
    }

    if (locale !== "de") {
      const translated = referenceKeys.filter((key) => {
        const typedKey = key as keyof typeof dictionary;
        return dictionary[typedKey] !== adminEntityDictionaries.de[typedKey];
      }).length;
      assert.ok(
        translated / referenceKeys.length >= 0.9,
        `${locale} translates only ${translated}/${referenceKeys.length} entries`,
      );
    }
  }
});

test("admin entity interpolation and number formatting honor the locale", () => {
  assert.equal(
    getAdminEntityCopy("en")("hub.layoutSummary", {
      rows: "1,234",
      widgets: "5,678",
    }),
    "1,234 rows with 5,678 widgets",
  );
  assert.equal(
    getAdminEntityCopy("fr")("common.removeNamed", { name: "Public pilote" }),
    "Retirer Public pilote",
  );
  assert.equal(formatAdminEntityNumber(1234, "en"), "1,234");
  assert.match(formatAdminEntityNumber(1234, "de"), /^1[.\u00a0]234$/u);
  assert.match(formatAdminEntityNumber(1234, "fr"), /^1[\u202f\u00a0]234$/u);
});

test("group, bundle, and hub UI render catalog copy instead of direct UI literals", () => {
  const directCopy: string[] = [];
  const uiAttributes = new Set([
    "alt",
    "aria-label",
    "description",
    "eyebrow",
    "label",
    "placeholder",
    "title",
  ]);

  for (const file of uiFiles) {
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
        const text = node.getText(sourceFile).trim();
        if (/\p{L}/u.test(text)) directCopy.push(`${file}: ${text}`);
      }
      if (
        ts.isJsxAttribute(node) &&
        node.initializer &&
        ts.isStringLiteral(node.initializer) &&
        uiAttributes.has(node.name.getText(sourceFile)) &&
        !/^(?:https?:\/\/|\/academy\/)/.test(node.initializer.text)
      ) {
        directCopy.push(`${file}: ${node.initializer.text}`);
      }
      ts.forEachChild(node, visit);
    }

    visit(sourceFile);
  }

  assert.deepEqual(directCopy, []);
});

test("locale and stable action copy are explicit at admin entity boundaries", () => {
  const groupManager = readFileSync(
    "src/components/admin/group-detail-manager.tsx",
    "utf8",
  );
  const bundleManager = readFileSync(
    "src/components/admin/bundle-detail-manager.tsx",
    "utf8",
  );
  const hubEditor = readFileSync(
    "src/components/admin/hub-editor.tsx",
    "utf8",
  );
  const createDialog = readFileSync(
    "src/components/admin/admin-create-dialog.tsx",
    "utf8",
  );

  for (const source of [groupManager, bundleManager, hubEditor]) {
    assert.doesNotMatch(source, /toast\.(?:success|error)\(result\.message\)/);
    assert.match(source, /locale: AppLocale/);
    assert.match(source, /getAdminEntityCopy\(locale\)/);
  }
  assert.match(createDialog, /locale: AppLocale/);
  assert.doesNotMatch(createDialog, /locale\?: AppLocale/);
  assert.doesNotMatch(createDialog, /locale = "de"/);
  for (const directTargetCopy of [
    "Neue Gruppe",
    "Gruppe erstellen",
    "Neues Bundle",
    "Bundle erstellen",
    "Neuer Hub",
    "Hub erstellen",
  ]) {
    assert.ok(
      !createDialog.includes(directTargetCopy),
      `Create dialog still contains direct target copy: ${directTargetCopy}`,
    );
  }

  for (const resource of ["groups", "bundles", "hubs"] as const) {
    const listPage = readFileSync(
      `src/app/(admin)/admin/${resource}/page.tsx`,
      "utf8",
    );
    const detailPage = readFileSync(
      `src/app/(admin)/admin/${resource}/[id]/page.tsx`,
      "utf8",
    );
    assert.match(listPage, /resolveUserLocale\(/);
    assert.match(detailPage, /resolveUserLocale\(/);
    assert.match(detailPage, /locale=\{locale\}/);
  }
});
