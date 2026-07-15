import assert from "node:assert/strict";
import test from "node:test";
import {
  authenticationLinkSourcePayloadSchema,
  authenticationLinkTemplateVariables,
  DEFAULT_EMAIL_TEMPLATE_SETTINGS_BY_LOCALE,
  renderEmailTemplate,
} from "../src/lib/email-center-model";
import { getCoreDictionary } from "../src/lib/i18n/dictionaries";
import {
  effectiveLocale,
  isAppLocale,
  normalizeLocale,
  SUPPORTED_LOCALES,
} from "../src/lib/i18n/model";
import {
  memberCreateSchema,
  memberUpdateSchema,
  organizationUpdateSchema,
} from "../src/lib/api/schemas";

test("locale resolution prefers a valid account preference and fails back to German", () => {
  assert.equal(effectiveLocale({ preferredLocale: "it", defaultLocale: "fr" }), "it");
  assert.equal(effectiveLocale({ preferredLocale: null, defaultLocale: "fr" }), "fr");
  assert.equal(effectiveLocale({ preferredLocale: "pt", defaultLocale: "en" }), "en");
  assert.equal(effectiveLocale({ preferredLocale: null, defaultLocale: "pt" }), "de");
  assert.equal(normalizeLocale("es"), "es");
  assert.equal(isAppLocale("nl"), false);
});

test("all supported locales provide localized navigation, auth and MFA core copy", () => {
  assert.deepEqual(SUPPORTED_LOCALES, ["de", "en", "it", "es", "fr"]);
  const signIns = new Set<string>();
  const mfaTitles = new Set<string>();
  for (const locale of SUPPORTED_LOCALES) {
    const dictionary = getCoreDictionary(locale);
    assert.ok(dictionary.navigation.items.settings.length > 2);
    assert.ok(dictionary.navigation.items.privacy.length > 2);
    assert.ok(dictionary.auth.signIn.length > 2);
    assert.ok(dictionary.mfa.enrollTitle.length > 2);
    signIns.add(dictionary.auth.signIn);
    mfaTitles.add(dictionary.mfa.enrollTitle);
  }
  assert.equal(signIns.size, SUPPORTED_LOCALES.length);
  assert.equal(mfaTitles.size, SUPPORTED_LOCALES.length);
});

test("invitation and password standard templates render safely in all five locales", () => {
  const invitationSubjects = new Set<string>();
  const passwordSubjects = new Set<string>();
  for (const locale of SUPPORTED_LOCALES) {
    const settings = DEFAULT_EMAIL_TEMPLATE_SETTINGS_BY_LOCALE[locale];
    const invitation = renderEmailTemplate({
      event: "invitation.created",
      settings,
      variables: {
        ...authenticationLinkTemplateVariables("invitation.created", {
          firstName: "Mara",
          link: "https://academy.example.test/invitations/token?a=1&b=2",
          locale,
        }),
        platformName: "Q-Academy",
      },
    });
    const password = renderEmailTemplate({
      event: "password.reset",
      settings,
      variables: {
        ...authenticationLinkTemplateVariables("password.reset", {
          firstName: "Mara",
          link: "https://academy.example.test/password/reset?token=secret",
          locale,
        }),
        platformName: "Q-Academy",
      },
    });
    assert.match(invitation.html, /&amp;/);
    assert.doesNotMatch(invitation.html, /<script/i);
    assert.ok(password.message.includes("30"));
    invitationSubjects.add(invitation.subject);
    passwordSubjects.add(password.subject);
  }
  assert.equal(invitationSubjects.size, SUPPORTED_LOCALES.length);
  assert.equal(passwordSubjects.size, SUPPORTED_LOCALES.length);
});

test("queued authentication-link sources accept only supported immutable locales", () => {
  assert.equal(
    authenticationLinkSourcePayloadSchema.safeParse({
      link: "https://academy.example.test/invitations/token",
      locale: "fr",
    }).success,
    true,
  );
  assert.equal(
    authenticationLinkSourcePayloadSchema.safeParse({
      link: "https://academy.example.test/invitations/token",
      locale: "pt",
    }).success,
    false,
  );
});

test("organization and member API inputs expose only supported locale projections", () => {
  assert.equal(
    organizationUpdateSchema.safeParse({ defaultLocale: "fr" }).success,
    true,
  );
  assert.equal(
    organizationUpdateSchema.safeParse({ defaultLocale: "pt" }).success,
    false,
  );
  assert.equal(
    memberCreateSchema.safeParse({
      email: "locale@example.test",
      firstName: "Locale",
      lastName: "Member",
      preferredLocale: "es",
    }).success,
    true,
  );
  assert.equal(
    memberUpdateSchema.safeParse({ preferredLocale: null }).success,
    true,
  );
  assert.equal(
    memberUpdateSchema.safeParse({ preferredLocale: "nl" }).success,
    false,
  );
});
