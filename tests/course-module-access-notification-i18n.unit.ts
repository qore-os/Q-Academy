import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { getCourseModuleAccessNotificationCopy } from "../src/lib/i18n/course-module-access-notifications";
import { SUPPORTED_LOCALES } from "../src/lib/i18n/model";

function flatten(value: unknown, prefix = "", result = new Map<string, string>()) {
  if (typeof value === "string") {
    result.set(prefix, value);
  } else if (typeof value === "function") {
    result.set(prefix, String(value("Member", "Module", "Course")));
  } else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      flatten(child, prefix ? `${prefix}.${key}` : key, result);
    }
  }
  return result;
}

test("module access notification copy has complete five-locale parity", () => {
  const german = flatten(getCourseModuleAccessNotificationCopy("de"));
  assert.equal(german.size, 16);

  for (const locale of SUPPORTED_LOCALES) {
    const localized = flatten(getCourseModuleAccessNotificationCopy(locale));
    assert.deepEqual([...localized.keys()], [...german.keys()]);
    assert.ok([...localized.values()].every((value) => value.trim().length > 0));
    if (locale !== "de") {
      assert.ok(
        [...localized].filter(([key, value]) => value !== german.get(key)).length >= 15,
      );
    }
  }
});

test("module access notifications use each recipient locale without German fallbacks", () => {
  const service = readFileSync(
    "src/lib/course-module-access-service.ts",
    "utf8",
  );

  assert.match(service, /preferredLocale: users\.preferredLocale/);
  assert.match(service, /defaultLocale: organizations\.defaultLocale/);
  assert.match(service, /effectiveLocale\(recipient\)/);
  assert.match(service, /resolveRecipientLocale\(tx,/);
  assert.match(service, /getCourseModuleAccessNotificationCopy/);
  for (const raw of [
    "Neue Modul-Zugriffsanfrage",
    "Modulzugriff freigegeben",
    "Modul-Zugriffsanfrage abgelehnt",
    "Du kannst das Modul",
    "Modulzugriff aktualisiert",
    "Individuelle Modulfreigabe beendet",
  ]) {
    assert.doesNotMatch(service, new RegExp(raw));
  }

  assert.equal(
    getCourseModuleAccessNotificationCopy("en").approvedBody("Onboarding"),
    'You can now open the module "Onboarding".',
  );
  assert.equal(
    getCourseModuleAccessNotificationCopy("it").rejectedTitle,
    "Richiesta di accesso al modulo rifiutata",
  );
});
