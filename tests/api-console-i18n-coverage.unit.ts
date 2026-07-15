import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

import type { ApiAdminActionMessageKey } from "../src/lib/api/admin-actions";
import { API_SCOPES } from "../src/lib/api/scopes";
import {
  formatApiConsoleDateTime,
  formatApiConsoleNumber,
  formatApiConsolePercent,
  getApiConsoleCopy,
  getApiScopePresentation,
  resolveApiAdminActionMessage,
} from "../src/lib/i18n/api-console";
import { SUPPORTED_LOCALES } from "../src/lib/i18n/model";

const sourceFiles = [
  "src/app/(admin)/admin/api/page.tsx",
  "src/components/admin/api-console.tsx",
  "src/lib/api/admin-actions.ts",
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
    const rendered = value({ name: "Sentinel" }, 2, 3);
    result.set(prefix, String(rendered).trim());
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
    "API",
    "Webhook",
    "cURL",
    "JavaScript",
    "HTTP",
    "NET",
    "ms",
    "Q-Academy",
  ]);
  const add = (node: ts.Node, value: string) => {
    const normalized = value.replace(/\s+/g, " ").trim();
    if (!/[A-Za-zÀ-ÿ]/.test(normalized) || technicalTokens.has(normalized)) {
      return;
    }
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
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
      renderedStringExpression(node)
    ) {
      add(node, node.text);
    }

    if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
      ts.isCallExpression(node.parent) &&
      /(?:toast\.(?:error|success)|set(?:Detail|Refresh)?Error)$/.test(
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

test("API console dictionaries have strict DE/EN/IT/ES/FR parity", () => {
  const german = flattenCopy(getApiConsoleCopy("de"));
  assert.ok(
    german.size >= 250,
    `expected at least 250 API console copy leaves, received ${german.size}`,
  );

  for (const locale of SUPPORTED_LOCALES) {
    const localized = flattenCopy(getApiConsoleCopy(locale));
    assert.deepEqual([...localized.keys()].sort(), [...german.keys()].sort());
    for (const [key, value] of localized) {
      assert.ok(value.length > 0, `${locale}.${key} must not be empty`);
    }
    assert.equal(
      Object.keys(getApiConsoleCopy(locale).actionMessages).length,
      45,
    );
  }

  assert.equal(getApiConsoleCopy("en").header.title, "API console");
  assert.equal(getApiConsoleCopy("it").tabs.requests, "Registro richieste");
  assert.equal(getApiConsoleCopy("es").deadLetters.event, "Evento");
  assert.equal(getApiConsoleCopy("fr").createKey.submit, "Créer la clé");
});

test("API scopes, action messages and locale formatters are fully localized", () => {
  for (const locale of SUPPORTED_LOCALES) {
    for (const scope of ["*", ...API_SCOPES] as const) {
      const presentation = getApiScopePresentation(locale, scope);
      assert.ok(presentation.label.trim());
      assert.ok(presentation.category.trim());
      assert.ok(presentation.description.trim());
    }
    for (const key of Object.keys(getApiConsoleCopy("de").actionMessages)) {
      const message = resolveApiAdminActionMessage(locale, {
        key: key as ApiAdminActionMessageKey,
        values: { name: "User-authored sentinel" },
      });
      assert.ok(message.trim(), `${locale}.${key} must resolve`);
    }
    assert.match(
      resolveApiAdminActionMessage(locale, {
        key: "apiKey.revoked",
        values: { name: "User-authored sentinel" },
      }),
      /User-authored sentinel/,
    );
  }

  assert.notEqual(
    formatApiConsoleDateTime("2026-07-13T10:00:00.000Z", "en"),
    formatApiConsoleDateTime("2026-07-13T10:00:00.000Z", "it"),
  );
  assert.equal(formatApiConsoleNumber(12345.5, "en"), "12,345.5");
  assert.equal(formatApiConsoleNumber(12345.5, "it"), "12.345,5");
  assert.equal(formatApiConsolePercent(12.34, "en"), "12.3%");
  assert.match(formatApiConsolePercent(12.34, "fr"), /12,3/);
});

test("API console propagates locale and contains zero actionable hardcoded copy", () => {
  const page = readFileSync(sourceFiles[0], "utf8");
  const consoleSource = readFileSync(sourceFiles[1], "utf8");
  const actions = readFileSync(sourceFiles[2], "utf8");

  assert.match(page, /resolveUserLocale\(user\)/);
  assert.match(page, /<ApiConsole[\s\S]{0,160}?locale=\{locale\}/);
  assert.match(consoleSource, /locale: AppLocale/);
  assert.doesNotMatch(consoleSource, /locale\?: AppLocale/);
  assert.match(consoleSource, /resolveApiAdminActionMessage\(locale,/);
  assert.doesNotMatch(actions, /ApiError\)[\s\S]{0,80}?\.message/);
  assert.doesNotMatch(actions, /PrivacyOwnerStepUpError\)[\s\S]{0,80}?\.message/);

  assert.deepEqual(sourceFiles.flatMap(actionableLiterals), []);

  const source = `${page}\n${consoleSource}`;
  for (const formerlyHardcoded of [
    "API-Konsole Bereiche",
    "API-Schluessel erstellen",
    "Fehlgeschlagene Zustellungen",
    "Zustellungsdetails anzeigen",
    "Versuchshistorie",
    "Antwortinhalt aus Sicherheitsgruenden ausgeblendet.",
    "Request-Vertrag",
    "Webhook-Ziele",
    "Keine passenden Requests",
  ]) {
    assert.doesNotMatch(source, new RegExp(formerlyHardcoded));
  }
});
