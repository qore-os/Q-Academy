import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { getNotificationCopy } from "../src/lib/i18n/notifications";
import { SUPPORTED_LOCALES } from "../src/lib/i18n/model";

function flatten(value: unknown, prefix = "", result = new Map<string, string>()) {
  if (typeof value === "string") {
    result.set(prefix, value);
  } else if (typeof value === "function") {
    result.set(prefix, String(value(2)));
  } else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      flatten(child, prefix ? `${prefix}.${key}` : key, result);
    }
  }
  return result;
}

test("notification and push copy has complete DE/EN/IT/ES/FR parity", () => {
  const german = flatten(getNotificationCopy("de"));
  assert.equal(german.size, 27);
  for (const locale of SUPPORTED_LOCALES) {
    const localized = flatten(getNotificationCopy(locale));
    assert.deepEqual([...localized.keys()], [...german.keys()]);
    assert.ok([...localized.values()].every((value) => value.trim().length > 0));
    if (locale !== "de") {
      const changed = [...localized].filter(
        ([key, value]) => value !== german.get(key),
      ).length;
      assert.ok(changed >= 22, `${locale} changes only ${changed}/${german.size} leaves`);
    }
  }
});

test("notification surfaces require an explicit locale and contain no German fallback copy", () => {
  const center = readFileSync(
    "src/components/layout/notification-center.tsx",
    "utf8",
  );
  const push = readFileSync(
    "src/components/pwa/push-notification-control.tsx",
    "utf8",
  );
  const navigation = readFileSync(
    "src/components/layout/navigation-shell.tsx",
    "utf8",
  );
  for (const source of [center, push]) {
    assert.match(source, /getNotificationCopy/);
    assert.match(source, /AppLocale/);
    assert.doesNotMatch(
      source,
      /Benachrichtigungen schliessen|Keine Benachrichtigungen|Alles auf dem neuesten Stand|konnten nicht aktiviert|konnten nicht deaktiviert/,
    );
  }
  assert.match(navigation, /<NotificationCenter[\s\S]*locale=\{locale\}/);
});

test("notification timestamps use the resolved user locale", () => {
  const service = readFileSync("src/lib/notifications.ts", "utf8");
  const adminLayout = readFileSync(
    "src/app/(admin)/admin/layout.tsx",
    "utf8",
  );
  const memberLayout = readFileSync(
    "src/app/(member)/academy/layout.tsx",
    "utf8",
  );

  assert.match(service, /locale: AppLocale/);
  assert.match(service, /Intl\.DateTimeFormat\(intlLocale\(locale\)/);
  assert.doesNotMatch(service, /DateTimeFormat\("de-DE"/);
  for (const layout of [adminLayout, memberLayout]) {
    assert.match(layout, /const locale = await resolveUserLocale\(user\)/);
    assert.match(layout, /getCurrentUserNotificationData\(locale\)/);
  }
});
