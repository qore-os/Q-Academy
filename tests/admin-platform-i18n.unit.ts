import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import ts from "typescript";

import { createEventAttendeeCsv } from "../src/lib/event-csv";
import { eventAdminDictionaries } from "../src/lib/i18n/event-admin";
import { integrationAdminDictionaries } from "../src/lib/i18n/integration-admin";
import { SUPPORTED_LOCALES } from "../src/lib/i18n/model";
import { operationsAdminDictionaries } from "../src/lib/i18n/operations-admin";
import { privacyAdminDictionaries } from "../src/lib/i18n/privacy-admin";
import { settingsDataDictionaries } from "../src/lib/i18n/settings-data";
import { settingsAdminDictionaries } from "../src/lib/i18n/settings-admin";
import { MEMBER_SIDEBAR_LINK_ICONS } from "../src/lib/member-sidebar-link-model";
import { memberSidebarLinkIconComponents } from "../src/components/member-sidebar-link-icons";

type Leaf = {
  kind: "string" | "function";
  value: string;
  arity: number;
};

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
  if (Array.isArray(value)) {
    value.forEach((entry, index) => flatten(entry, `${prefix}.${index}`, result));
    return result;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      flatten(child, prefix ? `${prefix}.${key}` : key, result);
    }
  }
  return result;
}

const catalogs = [
  ["operations", operationsAdminDictionaries, 120],
  ["settings-data", settingsDataDictionaries, 80],
  ["settings-admin", settingsAdminDictionaries, 220],
  ["privacy", privacyAdminDictionaries, 120],
  ["integrations", integrationAdminDictionaries, 60],
  ["events", eventAdminDictionaries, 140],
] as const;

test("admin platform catalogs have complete five-locale key and function parity", () => {
  for (const [name, dictionaries, minimumLeaves] of catalogs) {
    const german = flatten(dictionaries.de);
    assert.ok(
      german.size >= minimumLeaves,
      `${name} catalog is unexpectedly small: ${german.size}`,
    );

    for (const locale of SUPPORTED_LOCALES) {
      const localized = flatten(dictionaries[locale]);
      assert.deepEqual(
        [...localized.keys()],
        [...german.keys()],
        `${name}.${locale} changes catalog keys`,
      );
      assert.deepEqual(
        [...localized].map(([key, leaf]) => [key, leaf.kind, leaf.arity]),
        [...german].map(([key, leaf]) => [key, leaf.kind, leaf.arity]),
        `${name}.${locale} changes function placeholders`,
      );
      assert.ok(
        [...localized.values()].every((leaf) => leaf.value.length > 0),
        `${name}.${locale} contains empty copy`,
      );

      if (locale !== "de") {
        const changed = [...localized].filter(
          ([key, leaf]) => leaf.value !== german.get(key)?.value,
        ).length;
        assert.ok(
          changed / localized.size >= 0.75,
          `${name}.${locale} localizes only ${changed}/${localized.size} leaves`,
        );
      }
    }
  }
});

test("settings, privacy, integration, operations, and event surfaces avoid direct UI literals", () => {
  const files = [
    "src/components/admin/custom-field-manager.tsx",
    "src/components/admin/data-structure-manager.tsx",
    "src/components/admin/privacy-request-manager.tsx",
    "src/components/admin/privacy-request-detail.tsx",
    "src/components/admin/integration-manager.tsx",
    "src/components/admin/exam-operations-center.tsx",
    "src/components/admin/feedback-center.tsx",
    "src/components/admin/member-property-analytics.tsx",
    "src/components/admin/event-manager.tsx",
    "src/components/academy/event-list.tsx",
    "src/components/admin/settings-form.tsx",
    "src/components/admin/native-start-settings.tsx",
    "src/components/admin/member-sidebar-links-manager.tsx",
    "src/components/admin/member-welcome-settings-form.tsx",
    "src/components/academy/member-welcome-modal.tsx",
    "src/components/admin/transcript-search-settings-form.tsx",
    "src/components/admin/custom-domain-panel.tsx",
    "src/components/admin/organization-contract-panel.tsx",
    "src/components/admin/ownership-transfer-form.tsx",
    "src/components/admin/settings-section-nav.tsx",
    "src/components/admin/owner-step-up-control.tsx",
  ];
  const directCopy: string[] = [];
  const invariantBrandCopy = new Set([
    "Ablefy",
    "Copecart",
    "Digistore24",
    "Intercom",
    "TXT",
  ]);
  const uiAttributes = new Set([
    "alt",
    "aria-label",
    "description",
    "label",
    "placeholder",
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
        const text = node.getText(sourceFile).trim();
        if (
          /\p{L}/u.test(text) &&
          text !== "-&gt;" &&
          !invariantBrandCopy.has(text)
        ) {
          directCopy.push(`${file}: ${text}`);
        }
      }
      if (
        ts.isJsxAttribute(node) &&
        node.initializer &&
        ts.isStringLiteral(node.initializer) &&
        uiAttributes.has(node.name.getText(sourceFile)) &&
        !/^(?:https?:\/\/|\/)/.test(node.initializer.text) &&
        !/^[^@\s]+@[^@\s]+$/.test(node.initializer.text)
      ) {
        directCopy.push(`${file}: ${node.initializer.text}`);
      }
      ts.forEachChild(node, visit);
    }
    visit(sourceFile);
  }

  assert.deepEqual(directCopy, []);
});

test("localized admin actions use stable codes instead of raw server copy", () => {
  const components = [
    "src/components/admin/custom-field-manager.tsx",
    "src/components/admin/data-structure-manager.tsx",
    "src/components/admin/privacy-request-manager.tsx",
    "src/components/admin/privacy-request-detail.tsx",
    "src/components/admin/integration-manager.tsx",
    "src/components/admin/exam-operations-center.tsx",
    "src/components/admin/feedback-center.tsx",
    "src/components/admin/event-manager.tsx",
    "src/components/academy/event-list.tsx",
    "src/components/admin/settings-form.tsx",
    "src/components/admin/native-start-settings.tsx",
    "src/components/admin/member-sidebar-links-manager.tsx",
    "src/components/admin/member-welcome-settings-form.tsx",
    "src/components/admin/transcript-search-settings-form.tsx",
    "src/components/admin/custom-domain-panel.tsx",
    "src/components/admin/ownership-transfer-form.tsx",
  ];
  for (const file of components) {
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(
      source,
      /toast\.(?:success|error)\((?:state|result)\.message\)/,
      file,
    );
    assert.doesNotMatch(source, />\s*\{(?:state|result)\.message\}\s*</, file);
  }

  for (const file of [
    "src/lib/admin/custom-field-actions.ts",
    "src/lib/admin/data-structure-actions.ts",
    "src/lib/privacy/owner-actions.ts",
    "src/lib/commerce/admin-actions.ts",
    "src/lib/admin/event-actions.ts",
    "src/lib/member-sidebar-link-actions.ts",
    "src/lib/member-welcome-actions.ts",
    "src/lib/transcript-search-settings-actions.ts",
    "src/lib/mobile/start-destination-actions.ts",
    "src/lib/custom-domain-actions.ts",
    "src/lib/admin/member-actions.ts",
    "src/lib/actions.ts",
  ]) {
    const source = readFileSync(file, "utf8");
    assert.match(source, /code\??:/, `${file} does not define action codes`);
    assert.match(source, /code:\s*["']/, `${file} does not return action codes`);
  }
});

test("integration metadata resolves from the active locale", () => {
  const page = readFileSync(
    "src/app/(admin)/admin/integrations/page.tsx",
    "utf8",
  );
  assert.match(page, /export async function generateMetadata/);
  assert.match(page, /getIntegrationAdminCopy\(locale\)\.page\.metadataTitle/);
  assert.doesNotMatch(page, /export const metadata/);
});

test("settings and privacy metadata resolve from the active locale", () => {
  const settings = readFileSync("src/app/(admin)/admin/settings/page.tsx", "utf8");
  const privacy = readFileSync("src/app/(admin)/admin/privacy/page.tsx", "utf8");
  const detail = readFileSync("src/app/(admin)/admin/privacy/[id]/page.tsx", "utf8");
  assert.match(settings, /export async function generateMetadata/);
  assert.match(settings, /getSettingsAdminCopy\(locale\)\.page\.metadataTitle/);
  assert.match(privacy, /getPrivacyAdminCopy\(locale\)\.page\.metadataTitle/);
  assert.match(detail, /getPrivacyAdminCopy\(locale\)\.page\.detailMetadataTitle/);
  assert.doesNotMatch(`${settings}\n${privacy}\n${detail}`, /export const metadata/);
});

test("OIDC owner step-up always receives locale-specific failure copy", () => {
  const button = readFileSync(
    "src/components/auth/oidc-step-up-button.tsx",
    "utf8",
  );
  const control = readFileSync(
    "src/components/admin/owner-step-up-control.tsx",
    "utf8",
  );
  assert.match(button, /errorMessage: string/);
  assert.doesNotMatch(button, /errorMessage\s*=/);
  assert.match(control, /oidcErrorMessage \?\? copy\.oidcError/);
  for (const locale of SUPPORTED_LOCALES) {
    assert.ok(settingsAdminDictionaries[locale].stepUp.oidcError.length > 0);
  }
});

test("member sidebar exposes one visual Lucide component for every stable icon key", () => {
  assert.ok(MEMBER_SIDEBAR_LINK_ICONS.length >= 30);
  assert.deepEqual(
    Object.keys(memberSidebarLinkIconComponents),
    [...MEMBER_SIDEBAR_LINK_ICONS],
  );
  assert.deepEqual(
    MEMBER_SIDEBAR_LINK_ICONS.slice(0, 8),
    ["link", "book-open", "life-buoy", "video", "file-text", "globe", "messages-square", "calendar"],
  );
  const manager = readFileSync("src/components/admin/member-sidebar-links-manager.tsx", "utf8");
  const navigation = readFileSync("src/components/layout/navigation-shell.tsx", "utf8");
  const schema = readFileSync("src/db/schema.ts", "utf8");
  const migration = readFileSync("drizzle/0067_member_sidebar_icon_catalog.sql", "utf8");
  assert.match(manager, /type="radio"/);
  assert.match(manager, /memberSidebarLinkIconComponents\[icon\]/);
  assert.match(navigation, /memberSidebarLinkIconComponents\[item\.icon\]/);
  for (const icon of MEMBER_SIDEBAR_LINK_ICONS) {
    assert.match(schema, new RegExp(`'${icon}'`));
    assert.match(migration, new RegExp(`'${icon}'`));
  }
});

test("event CSV localizes system copy and preserves authored cells safely", () => {
  const attendees = [{
    firstName: "  =CMD()",
    lastName: "Sentinel",
    email: "sentinel@example.test",
    status: "going" as const,
    respondedAt: new Date("2030-01-02T03:04:05.000Z"),
  }];

  const english = createEventAttendeeCsv(attendees, "en");
  const italian = createEventAttendeeCsv(attendees, "it");
  const french = createEventAttendeeCsv(attendees, "fr");
  assert.match(english, /"First name";"Last name";"Email";"Status";"Responded at"/);
  assert.match(english, /"Going"/);
  assert.match(italian, /"Nome";"Cognome";"E-mail";"Stato";"Risposta il"/);
  assert.match(italian, /"Partecipa"/);
  assert.match(french, /"Prénom";"Nom";"E-mail";"Statut";"Réponse le"/);
  assert.match(french, /"Participe"/);
  assert.match(english, /"'  =CMD\(\)"/);
  assert.match(english, /"Sentinel"/);
  assert.match(english, /2030-01-02T03:04:05\.000Z/);
});

test("event locale is explicit across admin, member, dialog, and CSV boundaries", () => {
  const adminPage = readFileSync("src/app/(admin)/admin/events/page.tsx", "utf8");
  const memberPage = readFileSync("src/app/(member)/academy/events/page.tsx", "utf8");
  const createDialog = readFileSync("src/components/admin/admin-create-dialog.tsx", "utf8");
  const csvRoute = readFileSync("src/app/(admin)/admin/events/[id]/attendees.csv/route.ts", "utf8");
  assert.match(adminPage, /<AdminCreateButton resource="event" locale=\{locale\}/);
  assert.match(adminPage, /<EventManager[\s\S]*locale=\{locale\}/);
  assert.match(memberPage, /<EventList[\s\S]*locale=\{locale\}/);
  assert.match(createDialog, /resource === "event"/);
  assert.match(createDialog, /eventCopy\.messages\[state\.code/);
  assert.match(csvRoute, /resolveUserLocale\(user\)/);
  assert.match(csvRoute, /createEventAttendeeCsv\(attendees, locale\)/);
});
