import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

import { getCommunityUiCopy } from "../src/lib/i18n/community";
import { getMainPageDictionary } from "../src/lib/i18n/main-pages";
import { SUPPORTED_LOCALES } from "../src/lib/i18n/model";

const communitySources = [
  "src/components/academy/community-feed.tsx",
  "src/components/academy/personalized-community-feed.tsx",
  "src/components/academy/community-follow-context.tsx",
  "src/components/academy/community-content-editor.tsx",
  "src/components/academy/community-comment-pagination.ts",
  "src/components/academy/community-attachments.tsx",
  "src/components/academy/community-spaces-sidebar.tsx",
  "src/components/academy/community-own-submissions.tsx",
  "src/app/(member)/academy/community/page.tsx",
  "src/app/(member)/academy/community/members/[id]/page.tsx",
] as const;

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
    result.set(prefix, String(value("Sample", "Level")).trim());
    return result;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      flattenCopy(child, prefix ? `${prefix}.${key}` : key, result);
    }
  }
  return result;
}

function attributeName(node: ts.Node) {
  let current: ts.Node | undefined = node;
  while (current) {
    if (ts.isJsxAttribute(current)) return current.name.getText();
    if (ts.isSourceFile(current)) return null;
    current = current.parent;
  }
  return null;
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
      ts.isSatisfiesExpression(parent)
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
  const add = (node: ts.Node, value: string) => {
    const normalized = value.replace(/\s+/g, " ").trim();
    if (!/[A-Za-zÀ-ÿ]/.test(normalized)) return;
    const line = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
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
      ts.isTemplateExpression(node) &&
      ["aria-label", "title", "placeholder"].includes(
        attributeName(node) ?? "",
      )
    ) {
      add(
        node,
        [node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join(
          " ",
        ),
      );
    }

    if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
      renderedStringExpression(node)
    ) {
      add(node, node.text);
    }

    if (
      ts.isStringLiteral(node) &&
      ts.isNewExpression(node.parent) &&
      node.parent.expression.getText(sourceFile) === "Error" &&
      node.text !== "useCommunityFollows requires CommunityFollowProvider."
    ) {
      add(node, node.text);
    }

    if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
      ts.isCallExpression(node.parent) &&
      /toast\.(error|success)$/.test(node.parent.expression.getText(sourceFile))
    ) {
      add(node, node.text);
    }

    if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
      /[A-Za-zÀ-ÿ] [A-Za-zÀ-ÿ]/.test(node.text) &&
      attributeName(node) !== "className" &&
      node.text !== "use client" &&
      node.text !== "useCommunityFollows requires CommunityFollowProvider."
    ) {
      add(node, node.text);
    }

    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return [...new Set(findings)];
}

test("community UI dictionaries have complete DE/EN/IT/ES/FR parity", () => {
  const german = flattenCopy(getCommunityUiCopy("de"));
  assert.ok(
    german.size >= 150,
    `expected at least 150 community copy leaves, received ${german.size}`,
  );

  for (const locale of SUPPORTED_LOCALES) {
    const direct = flattenCopy(getCommunityUiCopy(locale));
    const nested = flattenCopy(
      getMainPageDictionary(locale).academy.communityUi,
    );
    assert.deepEqual([...direct.keys()].sort(), [...german.keys()].sort());
    assert.deepEqual([...nested.keys()].sort(), [...german.keys()].sort());
    for (const [key, value] of direct) {
      assert.ok(value.length > 0, `${locale}.${key} must not be empty`);
    }
  }

  assert.equal(getCommunityUiCopy("en").personalized.modes.latest, "Latest");
  assert.equal(getCommunityUiCopy("it").report.submit, "Invia segnalazione");
  assert.equal(getCommunityUiCopy("es").spaces.title, "Espacios");
  assert.equal(getCommunityUiCopy("fr").attachments.title, "Pièces jointes");
});

test("community locale is propagated through every member interaction surface", () => {
  const page = readFileSync(
    "src/app/(member)/academy/community/page.tsx",
    "utf8",
  );
  for (const component of [
    "CommunityFollowProvider",
    "CommunityComposer",
    "CommunityOwnSubmissions",
    "PersonalizedCommunityFeed",
    "CommunitySpacesSidebar",
  ]) {
    assert.match(
      page,
      new RegExp(`<${component}[\\s\\S]{0,700}?locale=\\{locale\\}`),
      `${component} must receive the resolved locale`,
    );
  }

  const feed = readFileSync(
    "src/components/academy/community-feed.tsx",
    "utf8",
  );
  assert.doesNotMatch(feed, /locale\?: AppLocale/);
  assert.equal(
    (feed.match(/<CommunityAttachmentUploader[\s\S]{0,220}?locale=\{locale\}/g) ?? [])
      .length,
    2,
  );
  assert.equal(
    (feed.match(/<CommunityAttachments[\s\S]{0,180}?locale=\{locale\}/g) ?? [])
      .length,
    2,
  );
  assert.match(feed, /useCommunityCommentPagination\([\s\S]{0,180}?locale,/);
});

test("community member surfaces contain zero actionable hardcoded product copy", () => {
  const findings = communitySources.flatMap(actionableLiterals);
  assert.deepEqual(findings, []);

  const source = communitySources
    .map((file) => readFileSync(file, "utf8"))
    .join("\n");
  const formerlyHardcodedCopy = [
    /Community-Profil vervollstaendigen/,
    /Profil vervollstaendigen, um/,
    /Alle Bereiche/,
    /Gefaellt mir/,
    /Kommentarreaktionen/,
    /Positiven Vote entfernen/,
    /Antwort schreiben/,
    /Weitere Antworten laden/,
    /Grund auswaehlen/,
    /Spam oder Werbung/,
    /Aenderungen speichern/,
    /Eigenen Beitrag bearbeiten/,
    /In dieser Ansicht gibt es noch keine Beitraege/,
    /Persoenlicher Community-Feed/,
    /Datei auswaehlen/,
    /Noch keine Bereiche eingerichtet/,
    /Meine Einreichungen/,
    /Einspruch einlegen/,
  ];
  for (const pattern of formerlyHardcodedCopy) {
    assert.doesNotMatch(source, pattern);
  }
  assert.doesNotMatch(source, /error instanceof Error|error\.message/);
});
