import assert from "node:assert/strict";
import test from "node:test";

import { customFieldCreateSchema } from "../src/lib/api/schemas";
import { openApiDocument } from "../src/lib/api/openapi";
import {
  DEFAULT_EMAIL_TEMPLATE_SETTINGS,
  emailTemplateSettingsSchema,
  plainTextToSafeEmailHtml,
  renderEmailTemplate,
} from "../src/lib/email-center-model";
import {
  csvCell,
  extractTemplateTokens,
  memberPropertyValueMatches,
  renderPersonalizedTemplateText,
  validatePersonalizedTemplateText,
} from "../src/lib/member-property-model";

const profileToken = "profile.department.location";
const emailProfileToken = "profile_department_location";

test("personalization accepts only explicitly catalogued profile variables", () => {
  assert.deepEqual(
    extractTemplateTokens(`Hallo {{ firstName }}, {{${profileToken}}}`),
    ["firstName", profileToken],
  );
  assert.equal(
    validatePersonalizedTemplateText({
      value: `Standort: {{${profileToken}}}`,
      allowedTokens: [profileToken],
    }),
    null,
  );
  assert.match(
    validatePersonalizedTemplateText({
      value: "Privat: {{profile.private.salary}}",
      allowedTokens: [profileToken],
    }) ?? "",
    /nicht freigegeben/,
  );
  assert.match(
    validatePersonalizedTemplateText({
      value: "{{profile.department.location",
      allowedTokens: [profileToken],
    }) ?? "",
    /ungueltige Variable/,
  );
});

test("profile rendering fails closed and keeps property values as escaped text", () => {
  assert.equal(
    renderPersonalizedTemplateText(
      `A {{${profileToken}}} B {{profile.department.unknown}} C {{firstName}}`,
      { [profileToken]: "<img src=x onerror=alert(1)>" },
    ),
    "A <img src=x onerror=alert(1)> B  C {{firstName}}",
  );
  assert.equal(
    plainTextToSafeEmailHtml("<img src=x onerror=alert(1)>&"),
    "<p>&lt;img src=x onerror=alert(1)&gt;&amp;</p>",
  );
});

test("member-property filters handle missing and multi-select values", () => {
  assert.equal(
    memberPropertyValueMatches({
      value: ["Berlin", "Paris"],
      operator: "equals",
      expected: "paris",
    }),
    true,
  );
  assert.equal(
    memberPropertyValueMatches({
      value: ["Berlin", "Paris"],
      operator: "contains",
      expected: "lin",
    }),
    true,
  );
  assert.equal(
    memberPropertyValueMatches({ value: null, operator: "is_not_set" }),
    true,
  );
});

test("CSV cells neutralize spreadsheet formulas and quote delimiters", () => {
  assert.equal(csvCell("=HYPERLINK(\"https://invalid\")"), '"\'=HYPERLINK(""https://invalid"")"');
  assert.equal(csvCell("Berlin, DE"), '"Berlin, DE"');
});

test("custom fields require a member-visible safe type for personalization", () => {
  const base = {
    key: "location",
    label: "Standort",
    type: "text" as const,
    visibility: "member" as const,
    personalizationEnabled: true,
  };
  assert.equal(customFieldCreateSchema.safeParse(base).success, true);
  assert.equal(
    customFieldCreateSchema.safeParse({ ...base, visibility: "admin" }).success,
    false,
  );
  assert.equal(
    customFieldCreateSchema.safeParse({ ...base, type: "url" }).success,
    false,
  );
});

test("personalized mail is allowed only for non-authentication events", () => {
  const settings = structuredClone(DEFAULT_EMAIL_TEMPLATE_SETTINGS);
  settings.templates["feedback.reply"].body = `Hallo {{firstName}}: {{${emailProfileToken}}}`;
  const schema = emailTemplateSettingsSchema({
    "feedback.reply": [emailProfileToken],
  });
  assert.equal(schema.safeParse(settings).success, true);
  const rendered = renderEmailTemplate({
    event: "feedback.reply",
    settings,
    variables: {
      defaultSubject: "Antwort",
      defaultMessage: "Nachricht",
      firstName: "Ada",
      platformName: "Academy",
      [emailProfileToken]: "<script>alert(1)</script>",
    },
    additionalAllowedVariables: [emailProfileToken],
  });
  assert.doesNotMatch(rendered.html, /<script>/);
  assert.match(rendered.html, /&lt;script&gt;/);

  settings.templates["invitation.created"].body = `{{invitationUrl}} {{${emailProfileToken}}}`;
  assert.equal(
    emailTemplateSettingsSchema({
      "invitation.created": [emailProfileToken],
    }).safeParse(settings).success,
    false,
  );
});

test("member-property REST analytics requires all privacy-relevant scopes", () => {
  const operation = openApiDocument.paths["/member-properties/analytics"]?.get;
  assert.ok(operation);
  assert.deepEqual(operation["x-required-scopes"], [
    "analytics:read",
    "custom_fields:read",
    "members:read",
  ]);
  assert.match(operation.description ?? "", /never returns member identities/i);

  const catalog = openApiDocument.paths["/member-properties/variables"]?.get;
  assert.ok(catalog);
  assert.deepEqual(catalog["x-required-scopes"], ["custom_fields:read"]);
  assert.match(catalog.description ?? "", /no member values/i);
});
