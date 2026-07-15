import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { getMemberExperienceCopy } from "../src/lib/i18n/member-experience";
import { SUPPORTED_LOCALES } from "../src/lib/i18n/model";

function flatten(value: unknown, prefix = "", result = new Map<string, string>()) {
  if (typeof value === "string") {
    result.set(prefix, value.trim());
  } else if (typeof value === "function") {
    result.set(prefix, String(value(2, true)).trim());
  } else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      flatten(child, prefix ? `${prefix}.${key}` : key, result);
    }
  }
  return result;
}

test("member experience copy has complete DE/EN/IT/ES/FR parity", () => {
  const german = flatten(getMemberExperienceCopy("de"));
  assert.ok(german.size >= 115, `expected at least 115 leaves, got ${german.size}`);

  for (const locale of SUPPORTED_LOCALES) {
    const localized = flatten(getMemberExperienceCopy(locale));
    assert.deepEqual([...localized.keys()], [...german.keys()]);
    assert.ok(
      [...localized.values()].every((value) => value.length > 0),
      `${locale} must not contain empty copy`,
    );
    if (locale !== "de") {
      const changed = [...localized].filter(
        ([key, value]) => value !== german.get(key),
      ).length;
      assert.ok(
        changed >= 105,
        `${locale} changes only ${changed}/${german.size} leaves`,
      );
    }
  }
});

test("profile, course explorer and bookmarks propagate the resolved locale", () => {
  const profilePage = readFileSync(
    "src/app/(member)/academy/profile/page.tsx",
    "utf8",
  );
  const coursesPage = readFileSync(
    "src/app/(member)/academy/courses/page.tsx",
    "utf8",
  );
  const bookmarksPage = readFileSync(
    "src/app/(member)/academy/bookmarks/page.tsx",
    "utf8",
  );

  for (const component of [
    "ProfileDetailsForm",
    "NotificationPreferencesForm",
    "PasswordForm",
    "SsoAccountStatus",
    "SessionManager",
  ]) {
    assert.match(
      profilePage,
      new RegExp(`<${component}[\\s\\S]{0,500}?locale=\\{locale\\}`),
      `${component} must receive the resolved locale`,
    );
  }
  assert.match(coursesPage, /<MemberCourseExplorer courses=\{courses\} locale=\{locale\}/);
  assert.match(bookmarksPage, /resolveUserLocale\(user\)/);
  assert.match(bookmarksPage, /getMemberExperienceCopy\(locale\)\.bookmarks/);
});

test("member experience surfaces no longer render the former German fallback copy", () => {
  const sources = [
    "src/components/academy/profile-settings.tsx",
    "src/components/academy/member-course-explorer.tsx",
    "src/app/(member)/academy/profile/page.tsx",
    "src/app/(member)/academy/bookmarks/page.tsx",
    "src/components/media/image-asset-upload-field.tsx",
  ].map((file) => readFileSync(file, "utf8")).join("\n");

  for (const pattern of [
    /Persoenliche Angaben/,
    /Profil speichern/,
    /Einstellungen speichern/,
    /Aktive Sitzungen/,
    /Kurse durchsuchen/,
    /Keine passenden Kurse/,
    /Noch keine Lesezeichen/,
    /Wird vorbereitet/,
    /Sicherheitspruefung/,
  ]) {
    assert.doesNotMatch(sources, pattern);
  }

  const profileSettings = readFileSync(
    "src/components/academy/profile-settings.tsx",
    "utf8",
  );
  assert.match(profileSettings, /placeholder=\{copy\.phonePlaceholder\}/);
  assert.doesNotMatch(profileSettings, /placeholder="\+49/);
});

test("profile actions resolve server-side locale before returning user-facing messages", () => {
  const actions = readFileSync("src/lib/profile-actions.ts", "utf8");
  assert.equal(
    (actions.match(/getMemberExperienceCopy\(await resolveUserLocale\(actor\)\)\.actions/g) ?? [])
      .length,
    5,
  );
  assert.doesNotMatch(actions, /message: "Profil gespeichert\."/);
  assert.doesNotMatch(actions, /message: "Sitzung beendet\."/);
});
