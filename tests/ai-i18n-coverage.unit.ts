import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

import {
  formatAiAdminDateTime,
  formatAiAdminNumber,
  getAiAdminCopy,
  localizeAiAdminMessage,
  type AiAdminMessageCode,
} from "../src/lib/i18n/ai-admin";
import { getAiManagerCopy } from "../src/lib/i18n/ai-manager";
import {
  formatAiConversationDate,
  getAiInitialSuggestions,
  getAiMemberCopy,
  resolveAiMemberApiError,
} from "../src/lib/i18n/ai-member";
import { SUPPORTED_LOCALES } from "../src/lib/i18n/model";

const uiFiles = [
  "src/app/(admin)/admin/ai/page.tsx",
  "src/components/admin/ai-agent-manager.tsx",
  "src/components/admin/ai-agent-policy-panel.tsx",
  "src/components/admin/ai-agent-action-review.tsx",
  "src/components/academy/ai-workspace.tsx",
  "src/components/academy/ai-concierge.tsx",
  "src/components/academy/embedded-ai-agent.tsx",
  "src/components/academy/ai-agent-action-list.tsx",
  "src/components/academy/ai-transparency-notice.tsx",
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
    const args = Array.from(
      { length: Math.max(1, value.length) },
      (_, index) => (index === 0 ? "User-authored sentinel" : index + 1),
    );
    result.set(prefix, String(value(...args)).trim());
    return result;
  }
  if (value && typeof value === "object") {
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
    "AI",
    "API",
    "Bot",
    "Bundle",
    "Input",
    "Output",
    "Prompt",
    "Q-Academy",
    "Q-Coach",
    "Rollback",
    "SHA-256",
    "Web",
  ]);
  const add = (node: ts.Node, value: string) => {
    const normalized = value.replace(/\s+/g, " ").trim();
    if (!/[A-Za-zÀ-ÿ]/.test(normalized) || technicalTokens.has(normalized)) {
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
    if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
      ts.isCallExpression(node.parent) &&
      /(?:toast\.(?:error|success)|setError)$/.test(
        node.parent.expression.getText(sourceFile),
      )
    ) {
      add(node, node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return [...new Set(findings)];
}

test("AI dictionaries have strict DE/EN/IT/ES/FR parity", () => {
  for (const getter of [
    getAiMemberCopy,
    getAiAdminCopy,
    getAiManagerCopy,
  ]) {
    const german = flattenCopy(getter("de"));
    assert.ok(german.size >= 60, `copy catalog is unexpectedly small: ${german.size}`);
    for (const locale of SUPPORTED_LOCALES) {
      const localized = flattenCopy(getter(locale));
      assert.deepEqual([...localized.keys()].sort(), [...german.keys()].sort());
      assert.ok(
        [...localized.values()].every((value) => value.length > 0),
        `${locale} contains empty AI copy`,
      );
      if (locale !== "de") {
        const changed = [...localized].filter(
          ([key, value]) => value !== german.get(key),
        ).length;
        assert.ok(
          changed / localized.size >= 0.7,
          `${locale} localizes only ${changed}/${localized.size} leaves`,
        );
      }
    }
  }

  assert.equal(getAiMemberCopy("en").workspace.history, "History");
  assert.equal(getAiAdminCopy("it").review.approve, "Approva");
  assert.equal(getAiManagerCopy("es").editor.access, "Acceso");
  assert.equal(getAiManagerCopy("fr").deletion.title, "Supprimer l'agent IA");
});

test("AI action codes, safe API errors and locale formatters resolve", () => {
  const codes: AiAdminMessageCode[] = [
    "invalidAgent", "agentMissing", "lastActivePause", "unpublishedActivate",
    "agentStatusChanged", "agentStatusFailed", "invalidConfirmation",
    "confirmationMismatch", "agentInUse", "publishedDelete", "lastActiveDelete",
    "agentDeleted", "agentDeleteFailed", "invalidConfiguration", "draftSaved",
    "draftSaveFailed", "publishInvalid", "published", "publishFailed",
    "rollbackInvalid", "rolledBack", "rollbackFailed", "previewInvalid",
    "previewBusy", "previewRateLimited", "previewFailed", "policyInvalid",
    "policySaved", "policyUnchanged", "policySaveFailed",
    "decisionReasonRequired", "decisionInvalid", "decisionApproved",
    "decisionRejected", "decisionFailed",
  ];
  for (const locale of SUPPORTED_LOCALES) {
    for (const messageCode of codes) {
      const message = localizeAiAdminMessage(locale, {
        ok: messageCode.endsWith("Saved") || messageCode === "published",
        messageCode,
        messageParams: {
          name: "User-authored sentinel",
          count: 2,
          version: 3,
          active: true,
        },
      });
      assert.ok(message.trim(), `${locale}.${messageCode} must resolve`);
    }
    assert.match(
      localizeAiAdminMessage(locale, {
        ok: true,
        messageCode: "agentDeleted",
        messageParams: { name: "User-authored sentinel" },
      }),
      /User-authored sentinel/,
    );
    assert.equal(getAiInitialSuggestions(locale).length, 3);
  }

  const memberCopy = getAiMemberCopy("en");
  assert.equal(
    resolveAiMemberApiError({ status: 401 }, memberCopy, "fallback"),
    memberCopy.errors.signedOut,
  );
  assert.equal(
    resolveAiMemberApiError({ status: 500 }, memberCopy, "fallback"),
    "fallback",
  );
  assert.equal(formatAiAdminNumber(12345.5, "en"), "12,345.5");
  assert.equal(formatAiAdminNumber(12345.5, "it"), "12.345,5");
  assert.notEqual(
    formatAiAdminDateTime("2026-07-13T10:00:00.000Z", "en"),
    formatAiAdminDateTime("2026-07-13T10:00:00.000Z", "de"),
  );
  assert.notEqual(
    formatAiConversationDate("2026-07-13T10:00:00.000Z", "en"),
    formatAiConversationDate("2026-07-13T10:00:00.000Z", "fr"),
  );
});

test("AI surfaces require locale and contain zero actionable hardcoded copy", () => {
  const page = readFileSync(uiFiles[0], "utf8");
  const manager = readFileSync(uiFiles[1], "utf8");
  const hook = readFileSync(
    "src/components/academy/use-ai-conversations.ts",
    "utf8",
  );
  const layout = readFileSync("src/app/(member)/academy/layout.tsx", "utf8");
  const coachPage = readFileSync("src/app/(member)/academy/ai/page.tsx", "utf8");
  const lesson = readFileSync("src/components/academy/lesson-content.tsx", "utf8");
  const hub = readFileSync("src/app/(member)/academy/hub/page.tsx", "utf8");

  assert.match(page, /resolveUserLocale\(user\)/);
  assert.match(page, /<AiAgentManager[\s\S]{0,120}?locale=\{locale\}/);
  assert.match(layout, /<AiConcierge locale=\{locale\}/);
  assert.match(coachPage, /<AiWorkspace locale=\{locale\}/);
  assert.match(lesson, /<EmbeddedAiAgent[\s\S]{0,100}?locale=\{locale\}/);
  assert.match(hub, /<EmbeddedAiAgent[\s\S]{0,100}?locale=\{locale\}/);
  assert.match(hook, /locale: AppLocale/);
  assert.doesNotMatch(hook, /errorMessage\(/);
  assert.doesNotMatch(hook, /instanceof Error|\.message\s*:/);
  assert.doesNotMatch(manager, /(?:state|result)\.message/);
  assert.deepEqual(uiFiles.flatMap(actionableLiterals), []);
});
