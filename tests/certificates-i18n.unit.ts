import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  getCertificateCopy,
  resolveCertificateMessage,
} from "../src/lib/i18n/certificates";
import { SUPPORTED_LOCALES } from "../src/lib/i18n/model";

function flatten(value: unknown, prefix = "", result = new Map<string, string>()) {
  if (typeof value === "string") result.set(prefix, value);
  else if (typeof value === "function") {
    result.set(prefix, String(value("TEST-123")));
  } else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      flatten(child, prefix ? `${prefix}.${key}` : key, result);
    }
  }
  return result;
}

test("certificate copy has complete DE/EN/IT/ES/FR parity", () => {
  const german = flatten(getCertificateCopy("de"));
  assert.ok(german.size >= 50, `expected at least 50 leaves, got ${german.size}`);
  for (const locale of SUPPORTED_LOCALES) {
    const localized = flatten(getCertificateCopy(locale));
    assert.deepEqual([...localized.keys()], [...german.keys()]);
    assert.ok([...localized.values()].every((value) => value.trim().length > 0));
    if (locale !== "de") {
      const changed = [...localized].filter(
        ([key, value]) => value !== german.get(key),
      ).length;
      assert.ok(changed >= 50, `${locale} changes only ${changed}/${german.size}`);
    }
  }
});

test("certificate action messages remain stable in German and localize elsewhere", () => {
  assert.equal(resolveCertificateMessage("de", "revoked"), "Zertifikat widerrufen.");
  assert.equal(resolveCertificateMessage("de", "reissued"), "Zertifikat neu ausgestellt.");
  assert.equal(resolveCertificateMessage("en", "revoked"), "Certificate revoked.");
  assert.equal(resolveCertificateMessage("fr", "already_active"), "Un certificat actif existe deja.");
});

test("certificate pages and document propagate locale without German UI fallbacks", () => {
  const adminPage = readFileSync(
    "src/app/(admin)/admin/certificates/page.tsx",
    "utf8",
  );
  const adminDetail = readFileSync(
    "src/app/(admin)/admin/certificates/[id]/page.tsx",
    "utf8",
  );
  const memberDetail = readFileSync(
    "src/app/(member)/academy/certificates/[id]/page.tsx",
    "utf8",
  );
  const document = readFileSync(
    "src/components/certificates/certificate-document.tsx",
    "utf8",
  );
  const actions = readFileSync(
    "src/components/admin/certificate-admin-actions.tsx",
    "utf8",
  );

  assert.match(adminPage, /resolveUserLocale\(actor\)/);
  assert.match(adminPage, /CertificateAdminActions[\s\S]{0,160}?locale=\{locale\}/);
  assert.match(adminDetail, /CertificateDocument[\s\S]{0,180}?locale=\{locale\}/);
  assert.match(memberDetail, /CertificateDocument[\s\S]{0,180}?locale=\{locale\}/);
  assert.match(document, /formatDate\(date, undefined, locale\)/);
  assert.doesNotMatch(document, />Widerrufen</);
  assert.doesNotMatch(document, /Hiermit wird bestaetigt/);
  assert.doesNotMatch(actions, />\{messageState\.message\}</);
});

test("certificate revocation stores recipient-localized notification copy", () => {
  const actions = readFileSync("src/lib/certificate-actions.ts", "utf8");
  assert.match(actions, /resolveRecipientLocale\(tx,/);
  assert.match(actions, /getCertificateCopy\(recipientLocale\)\.notification/);
  assert.match(actions, /title: notificationCopy\.revokedTitle/);
  assert.match(actions, /body: notificationCopy\.revokedBody\(certificate\.courseTitle\)/);
  assert.doesNotMatch(actions, /title: "Zertifikat widerrufen"/);
  assert.doesNotMatch(actions, /reason \|\| "Durch die Administration widerrufen\."/);
});

test("certificate issuance stores recipient-localized notification copy", () => {
  const service = readFileSync("src/lib/certificates.ts", "utf8");

  assert.match(service, /preferredLocale: users\.preferredLocale/);
  assert.match(service, /defaultLocale: organizations\.defaultLocale/);
  assert.match(service, /getCertificateCopy\([\s\S]{0,180}?effectiveLocale\(/);
  assert.match(service, /title: notificationCopy\.issuedTitle/);
  assert.match(
    service,
    /body: notificationCopy\.issuedBody\(published\.snapshot\.course\.title\)/,
  );
  assert.doesNotMatch(service, /title: "Dein Zertifikat ist bereit"/);
});
