import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

import {
  formatCommunityAdminDateTime,
  formatCommunityAdminNumber,
  getCommunityAdminCopy,
  localizeCommunityAdminAction,
  type CommunityAdminActionCode,
} from "../src/lib/i18n/community-admin";
import { SUPPORTED_LOCALES } from "../src/lib/i18n/model";

const adminSources = [
  "src/components/admin/community-moderation.tsx",
  "src/components/admin/community-boost-manager.tsx",
  "src/components/admin/community-layout-manager.tsx",
  "src/components/admin/community-public-profile-settings.tsx",
  "src/components/admin/community-access-policy-editor.tsx",
  "src/components/admin/community-moderation-queue.tsx",
  "src/components/admin/community-badge-manager.tsx",
  "src/components/admin/community-governance-settings.tsx",
] as const;

type FlatLeaf = Readonly<{
  value: string;
  placeholders: readonly string[];
}>;

function flattenCopy(
  value: unknown,
  prefix = "",
  result = new Map<string, FlatLeaf>(),
) {
  if (typeof value === "string") {
    result.set(prefix, { value: value.trim(), placeholders: [] });
    return result;
  }
  if (typeof value === "function") {
    const args = Array.from(
      { length: Math.max(1, value.length) },
      (_, index) => `__PARAM_${index}__`,
    );
    const rendered = String(value(...args)).trim();
    result.set(prefix, {
      value: rendered,
      placeholders: args.map((argument) => argument.toLowerCase()),
    });
    return result;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      flattenCopy(child, prefix ? `${prefix}.${key}` : key, result);
    }
  }
  return result;
}

function actionableLiterals(file: string) {
  const source = readFileSync(file, "utf8");
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const findings: string[] = [];
  const add = (node: ts.Node, value: string) => {
    const normalized = value.replace(/\s+/g, " ").trim();
    if (!/[A-Za-zÀ-ÿ]/.test(normalized)) return;
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
      ts.isStringLiteralLike(node) &&
      ts.isCallExpression(node.parent) &&
      /toast\.(error|success)$/.test(node.parent.expression.getText(sourceFile))
    ) {
      add(node, node.text);
    }
    if (
      ts.isStringLiteralLike(node) &&
      ts.isNewExpression(node.parent) &&
      node.parent.expression.getText(sourceFile) === "Error"
    ) {
      add(node, node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return [...new Set(findings)];
}

test("community admin dictionaries have strict key and placeholder parity", () => {
  const german = flattenCopy(getCommunityAdminCopy("de"));
  assert.ok(
    german.size >= 250,
    `expected at least 250 leaves, received ${german.size}`,
  );

  for (const locale of SUPPORTED_LOCALES) {
    const localized = flattenCopy(getCommunityAdminCopy(locale));
    assert.deepEqual([...localized.keys()].sort(), [...german.keys()].sort());
    for (const [key, leaf] of localized) {
      assert.ok(leaf.value.length > 0, `${locale}.${key} must not be empty`);
      for (const placeholder of leaf.placeholders) {
        assert.ok(
          leaf.value.toLowerCase().includes(placeholder),
          `${locale}.${key} must preserve ${placeholder}`,
        );
      }
    }
    if (locale !== "de") {
      const changed = [...localized].filter(
        ([key, leaf]) => leaf.value !== german.get(key)?.value,
      ).length;
      assert.ok(
        changed / german.size >= 0.7,
        `${locale} must translate at least 70% of community admin leaves`,
      );
    }
  }
});

test("community admin action codes and locale formatters resolve safely", () => {
  const actionCodes = Object.keys(
    getCommunityAdminCopy("de").actions,
  ) as CommunityAdminActionCode[];
  assert.ok(actionCodes.length >= 40);
  for (const locale of SUPPORTED_LOCALES) {
    for (const messageCode of actionCodes) {
      assert.ok(
        localizeCommunityAdminAction(locale, { ok: false, messageCode })
          .length > 0,
        `${locale}.${messageCode}`,
      );
    }
  }

  assert.equal(
    localizeCommunityAdminAction("en", {
      ok: false,
      messageCode: "accessSaveFailed",
    }),
    "The access rules could not be saved.",
  );
  assert.notEqual(
    formatCommunityAdminNumber(1234567.89, "en"),
    formatCommunityAdminNumber(1234567.89, "de"),
  );
  assert.notEqual(
    formatCommunityAdminDateTime("2026-07-13T12:30:00.000Z", "it"),
    formatCommunityAdminDateTime("2026-07-13T12:30:00.000Z", "en"),
  );

  const sentinel = "USER-NAME-Sentinel";
  assert.ok(
    getCommunityAdminCopy("fr").layout.editSpace(sentinel).includes(sentinel),
  );
  assert.ok(
    getCommunityAdminCopy("es").boost.removeNamed(sentinel).includes(sentinel),
  );
  assert.ok(
    getCommunityAdminCopy("it")
      .moderation.contentBy("POST", sentinel)
      .includes(sentinel),
  );
});

test("community admin surfaces require locale and expose no hardcoded product copy", () => {
  const page = readFileSync("src/app/(admin)/admin/community/page.tsx", "utf8");
  for (const component of [
    "CommunityLayoutManager",
    "CommunityPublicProfileSettings",
    "CommunityModerationQueue",
    "CommunityAccessPolicyEditor",
    "CommunityGovernanceSettings",
    "CommunityBadgeManager",
    "CommunityBoostManager",
    "CommunityModeration",
  ]) {
    assert.match(
      page,
      new RegExp(`<${component}[\\s\\S]{0,900}?locale=\\{locale\\}`),
      `${component} must receive locale`,
    );
  }

  const combined = adminSources
    .map((file) => readFileSync(file, "utf8"))
    .join("\n");
  assert.doesNotMatch(combined, /locale\?: AppLocale|locale = "de"/);
  assert.doesNotMatch(
    combined,
    /state\.message|result\.message|error\.message/,
  );
  assert.deepEqual(adminSources.flatMap(actionableLiterals), []);

  const createDialog = readFileSync(
    "src/components/admin/admin-create-dialog.tsx",
    "utf8",
  );
  for (const formerLiteral of [
    "Community-Bereich erstellen",
    "Themen und Ziel dieses Community-Bereichs",
    "Ankuendigung",
    "Neuer Bereich",
  ]) {
    assert.doesNotMatch(createDialog, new RegExp(formerLiteral));
  }
  assert.match(createDialog, /getCommunityAdminCopy\(locale\)/);
});
