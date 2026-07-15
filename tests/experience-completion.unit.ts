import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  BRAND_COLOR_MODE_OPTIONS,
  DEFAULT_TENANT_BRANDING,
} from "../src/lib/branding-model";
import { getCoreDictionary } from "../src/lib/i18n/dictionaries";
import { SUPPORTED_LOCALES } from "../src/lib/i18n/model";

test("tenant branding exposes light, dark and system color modes", () => {
  assert.deepEqual(
    BRAND_COLOR_MODE_OPTIONS.map((option) => option.value),
    ["light", "dark", "system"],
  );
  assert.equal(DEFAULT_TENANT_BRANDING.colorMode, "light");
  const layout = readFileSync("src/app/layout.tsx", "utf8");
  const styles = readFileSync("src/app/globals.css", "utf8");
  assert.match(layout, /data-color-mode=\{branding\.colorMode\}/);
  assert.match(layout, /theme=\{branding\.colorMode\}/);
  assert.match(styles, /html\[data-color-mode="dark"\]/);
  assert.match(styles, /prefers-color-scheme: dark/);
});

test("all supported locales include core member and admin experience copy", () => {
  const courseTitles = new Set<string>();
  const eventFilters = new Set<string>();
  for (const locale of SUPPORTED_LOCALES) {
    const copy = getCoreDictionary(locale).experience;
    assert.ok(copy.courses.description.length > 10);
    assert.ok(copy.events.joinOnline.length > 3);
    assert.ok(copy.profile.description.length > 10);
    assert.ok(copy.admin.greeting("Mara").includes("Mara"));
    courseTitles.add(copy.courses.title);
    eventFilters.add(copy.events.filterLabel);
  }
  assert.equal(courseTitles.size, SUPPORTED_LOCALES.length);
  assert.equal(eventFilters.size, SUPPORTED_LOCALES.length);
});

test("remembered account switching stays origin scoped and requires reauthentication", () => {
  const navigation = readFileSync(
    "src/components/layout/navigation-shell.tsx",
    "utf8",
  );
  const login = readFileSync("src/app/login/page.tsx", "utf8");
  assert.match(navigation, /window\.localStorage/);
  assert.match(navigation, /await logoutAction\(\)/);
  assert.match(navigation, /destination\.searchParams\.set\("account", email\)/);
  assert.doesNotMatch(navigation, /sessionStorage|document\.cookie/);
  assert.match(login, /initialEmail/);
});

test("localized email editor, communication presets and event palettes are wired", () => {
  const emailCenter = readFileSync("src/lib/email-center.ts", "utf8");
  const emailEditor = readFileSync(
    "src/components/admin/email-template-editor.tsx",
    "utf8",
  );
  const announcements = readFileSync(
    "src/components/admin/announcement-manager.tsx",
    "utf8",
  );
  const events = readFileSync("src/components/admin/event-manager.tsx", "utf8");
  assert.match(emailCenter, /localizedEmailTemplateSettingsKey/);
  assert.match(emailCenter, /DEFAULT_EMAIL_TEMPLATE_SETTINGS_BY_LOCALE\[locale\]/);
  assert.match(emailEditor, /LOCALE_OPTIONS\.map/);
  assert.match(emailEditor, /name="locale" value=\{locale\}/);
  assert.match(announcements, /ANNOUNCEMENT_TEMPLATES/);
  assert.match(announcements, /AnnouncementBlockEditor/);
  assert.match(announcements, /contentDocument/);
  assert.match(events, /EVENT_COLOR_PRESETS/);
  assert.match(events, /aria-label=\{copy\.details\.preview\}/);
});
