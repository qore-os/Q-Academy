import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { getCoreDictionary } from "../src/lib/i18n/dictionaries";
import {
  getMainPageDictionary,
  MAIN_PAGE_I18N_ROUTES,
} from "../src/lib/i18n/main-pages";
import { SUPPORTED_LOCALES } from "../src/lib/i18n/model";

const routeFiles: Record<(typeof MAIN_PAGE_I18N_ROUTES)[number], string> = {
  "/academy": "src/app/(member)/academy/page.tsx",
  "/academy/community": "src/app/(member)/academy/community/page.tsx",
  "/academy/community/members/[id]": "src/app/(member)/academy/community/members/[id]/page.tsx",
  "/academy/certificates": "src/app/(member)/academy/certificates/page.tsx",
  "/academy/courses/[slug]": "src/app/(member)/academy/courses/[slug]/page.tsx",
  "/academy/courses/[slug]/learn/[lessonId]": "src/app/(member)/academy/courses/[slug]/learn/[lessonId]/page.tsx",
  "/academy/ai": "src/app/(member)/academy/ai/page.tsx",
  "/admin": "src/app/(admin)/admin/page.tsx",
  "/admin/analytics": "src/app/(admin)/admin/analytics/page.tsx",
  "/admin/courses": "src/app/(admin)/admin/courses/page.tsx",
  "/admin/courses/[id]": "src/app/(admin)/admin/courses/[id]/page.tsx",
  "/admin/members": "src/app/(admin)/admin/members/page.tsx",
  "/admin/members/[id]": "src/app/(admin)/admin/members/[id]/page.tsx",
  "/admin/modules": "src/app/(admin)/admin/modules/page.tsx",
  "/admin/tasks": "src/app/(admin)/admin/tasks/page.tsx",
  "/admin/events": "src/app/(admin)/admin/events/page.tsx",
  "/admin/community": "src/app/(admin)/admin/community/page.tsx",
  "/admin/settings": "src/app/(admin)/admin/settings/page.tsx",
};

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
    let rendered: string;
    try {
      rendered = String(value(2, "Level")).trim();
    } catch {
      rendered = String(value("Sample", "Level")).trim();
    }
    result.set(prefix, rendered);
    return result;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      flattenCopy(child, prefix ? `${prefix}.${key}` : key, result);
    }
  }
  return result;
}

test("main-page dictionaries cover a declared set of 18 rendered routes", () => {
  assert.equal(MAIN_PAGE_I18N_ROUTES.length, 18);
  assert.deepEqual(Object.keys(routeFiles), [...MAIN_PAGE_I18N_ROUTES]);

  for (const route of MAIN_PAGE_I18N_ROUTES) {
    const source = readFileSync(routeFiles[route], "utf8");
    assert.match(source, /getMainPageDictionary/);
    assert.match(source, /resolveUserLocale/);
  }

  const clientSurfaces = [
    "src/components/academy/community-feed.tsx",
    "src/components/academy/community-content-editor.tsx",
    "src/components/admin/analytics-member-table.tsx",
    "src/components/admin/course-builder.tsx",
    "src/components/admin/member-data-profile-manager.tsx",
    "src/components/admin/rich-text-editor.tsx",
    "src/components/admin/member-table.tsx",
  ];
  for (const file of clientSurfaces) {
    const source = readFileSync(file, "utf8");
    assert.match(source, /getMainPageDictionary/);
    assert.match(source, /AppLocale/);
  }
});

test("all five main-page dictionaries expose the same non-empty measured surface", () => {
  const german = flattenCopy(getMainPageDictionary("de"));
  assert.ok(
    german.size >= 430,
    `expected at least 430 main-page copy leaves, received ${german.size}`,
  );

  for (const locale of SUPPORTED_LOCALES) {
    const localized = flattenCopy(getMainPageDictionary(locale));
    assert.deepEqual([...localized.keys()], [...german.keys()]);
    for (const [key, value] of localized) {
      assert.ok(value.length > 0, `${locale}.${key} must not be empty`);
    }
    if (locale !== "de") {
      const changed = [...localized].filter(
        ([key, value]) => value !== german.get(key),
      ).length;
      assert.ok(
        changed / localized.size >= 0.7,
        `${locale} localizes only ${changed}/${localized.size} measured leaves`,
      );
    }
  }
});

test("email-centre copy is centrally complete for all supported locales", () => {
  const german = flattenCopy(getCoreDictionary("de").experience.emailCenter);
  assert.equal(german.size, 54);

  for (const locale of SUPPORTED_LOCALES) {
    const localized = flattenCopy(
      getCoreDictionary(locale).experience.emailCenter,
    );
    assert.deepEqual([...localized.keys()], [...german.keys()]);
    assert.ok([...localized.values()].every((value) => value.length > 0));
  }
});

test("localized dashboard and administration routes generate metadata", () => {
  for (const file of [
    "src/app/(member)/academy/page.tsx",
    "src/app/(member)/academy/courses/page.tsx",
    "src/app/(admin)/admin/page.tsx",
    "src/app/(admin)/admin/tasks/page.tsx",
    "src/app/(admin)/admin/members/page.tsx",
    "src/app/(admin)/admin/modules/page.tsx",
    "src/app/(admin)/admin/email/page.tsx",
    "src/app/(admin)/admin/email/templates/page.tsx",
  ]) {
    const source = readFileSync(file, "utf8");
    assert.match(source, /export async function generateMetadata/);
    assert.doesNotMatch(source, /export const metadata\s*=/);
  }
});

test("activity charts require localized accessible copy from every caller", () => {
  const chart = readFileSync(
    "src/components/charts/activity-chart.tsx",
    "utf8",
  );
  assert.match(chart, /ariaLabel: string;/);
  assert.match(chart, /emptyLabel: string;/);
  assert.match(chart, /seriesLabel: string;/);
  assert.match(chart, /locale: AppLocale;/);
  assert.doesNotMatch(chart, /Aktive Lernende|Keine Aktivitaetsdaten/);

  for (const file of [
    "src/app/(admin)/admin/page.tsx",
    "src/app/(admin)/admin/analytics/page.tsx",
  ]) {
    const source = readFileSync(file, "utf8");
    assert.match(source, /<ActivityChart[\s\S]{0,350}?ariaLabel=/);
    assert.match(source, /<ActivityChart[\s\S]{0,350}?emptyLabel=/);
    assert.match(source, /<ActivityChart[\s\S]{0,350}?seriesLabel=/);
    assert.match(source, /<ActivityChart[\s\S]{0,350}?locale=\{locale\}/);
  }
});
