import assert from "node:assert/strict";
import test from "node:test";

import {
  emailDeliveryListQuerySchema,
  emailDeliveryRetryInputSchema,
  emailSuppressionReleaseSchema,
  emailTemplateLocaleQuerySchema,
  emailTemplateSettingsInputSchema,
  emailTemplateSettingsUpdateInputSchema,
  emailTemplateTestInputSchema,
  organizationUpdateSchema,
} from "../src/lib/api/schemas";
import { openApiDocument } from "../src/lib/api/openapi";

function operation(path: string, method: "get" | "post" | "patch") {
  const value = openApiDocument.paths[path]?.[method];
  assert.ok(value, `${method.toUpperCase()} ${path} is not documented.`);
  return value;
}

test("email-center OpenAPI operations expose exact scopes and typed contracts", () => {
  const list = operation("/email-deliveries", "get");
  assert.deepEqual(list["x-required-scopes"], ["email:read"]);
  assert.match(JSON.stringify(list.responses["200"]), /EmailDeliveryListItem/);
  assert.match(JSON.stringify(list.responses["200"]), /EmailDeliveryListMeta/);

  const detail = operation("/email-deliveries/{id}", "get");
  assert.deepEqual(detail["x-required-scopes"], ["email:read"]);
  assert.match(JSON.stringify(detail.responses["200"]), /EmailDeliveryDetail/);

  const retry = operation("/email-deliveries/{id}/retry", "post");
  assert.deepEqual(retry["x-required-scopes"], ["email:write"]);
  assert.match(JSON.stringify(retry.requestBody), /EmailDeliveryRetry/);
  assert.match(JSON.stringify(retry.responses["202"]), /EmailDeliveryRetryResult/);
  assert.match(JSON.stringify(retry.parameters), /IdempotencyKey/);

  const templates = operation("/email-templates", "get");
  assert.deepEqual(templates["x-required-scopes"], ["email:read"]);
  assert.match(JSON.stringify(templates.responses["200"]), /EmailTemplateSettings/);
  assert.match(JSON.stringify(templates.parameters), /locale/);

  const update = operation("/email-templates", "patch");
  assert.deepEqual(update["x-required-scopes"], ["email:write"]);
  assert.match(JSON.stringify(update.requestBody), /EmailTemplateSettingsUpdate/);
  assert.match(JSON.stringify(update.parameters), /IdempotencyKey/);

  const testDelivery = operation("/email-templates/test-deliveries", "post");
  assert.deepEqual(testDelivery["x-required-scopes"], ["email:write"]);
  assert.match(
    JSON.stringify(testDelivery.requestBody),
    /EmailTemplateTestDeliveryCreate/,
  );
  assert.match(JSON.stringify(testDelivery.parameters), /IdempotencyKey/);

  const suppressions = operation("/email-suppressions", "get");
  assert.deepEqual(suppressions["x-required-scopes"], ["email:read"]);
  assert.match(
    JSON.stringify(suppressions.responses["200"]),
    /EmailSuppressionListItem/,
  );

  const release = operation("/email-suppressions/{id}/release", "post");
  assert.deepEqual(release["x-required-scopes"], ["email:write"]);
  assert.match(JSON.stringify(release.requestBody), /EmailSuppressionRelease/);
  assert.match(JSON.stringify(release.parameters), /IdempotencyKey/);
});

test("email-center response schemas exclude encrypted and raw transport fields", () => {
  for (const name of [
    "EmailDeliveryListItem",
    "EmailDeliveryDetail",
    "EmailDeliveryRetryResult",
    "EmailTemplateTestDelivery",
    "EmailSuppressionListItem",
  ] as const) {
    const schema = openApiDocument.components.schemas[name];
    assert.equal(schema.additionalProperties, false);
    const serialized = JSON.stringify(schema);
    assert.doesNotMatch(serialized, /"payload"/i);
    assert.doesNotMatch(serialized, /ciphertext/i);
    assert.doesNotMatch(serialized, /responseBody/i);
    assert.doesNotMatch(serialized, /recipientHash/i);
    assert.doesNotMatch(serialized, /payloadHash/i);
  }
  const listItem = openApiDocument.components.schemas.EmailDeliveryListItem as {
    properties: { event: Record<string, unknown> };
  };
  assert.equal(Object.hasOwn(listItem.properties.event, "enum"), false);
  const retry = openApiDocument.components.schemas.EmailDeliveryRetryResult as {
    properties: { event: { enum: readonly string[] } };
  };
  assert.deepEqual(retry.properties.event.enum, [
    "feedback.reply",
    "lesson.available",
    "course.modules.released",
    "event.rescheduled",
    "event.cancelled",
    "email.template.test",
  ]);
});

test("central email-center Zod exports preserve strict request validation", () => {
  assert.deepEqual(emailSuppressionReleaseSchema.parse({
    reason: "address_corrected",
  }), { reason: "address_corrected" });
  assert.equal(
    emailSuppressionReleaseSchema.safeParse({
      reason: "other",
      note: "free text must not be accepted",
    }).success,
    false,
  );
  assert.deepEqual(emailDeliveryRetryInputSchema.parse({}), {});
  assert.equal(emailDeliveryRetryInputSchema.safeParse({ force: true }).success, false);
  assert.equal(
    emailDeliveryListQuerySchema.safeParse({
      event: "feedback.reply",
      status: "failed",
      from: "2026-07-01T00:00:00Z",
      to: "2026-07-11T00:00:00Z",
    }).success,
    true,
  );
  assert.equal(
    emailDeliveryListQuerySchema.safeParse({ event: "unknown.event" }).success,
    false,
  );

  const settings = {
    version: 1 as const,
    templates: {
      "feedback.reply": {
        subject: "{{defaultSubject}}",
        body: "{{defaultMessage}}",
      },
      "lesson.available": {
        subject: "{{lessonTitle}} ist verfuegbar",
        body: "Hallo {{firstName}}, {{lessonUrl}}",
      },
      "course.modules.released": {
        subject: "Neue Module in {{courseTitle}}",
        body: "Hallo {{firstName}}, {{moduleList}} {{courseUrl}}",
      },
      "invitation.created": {
        subject: "Einladung zu {{platformName}}",
        body: "Hallo {{firstName}}, {{invitationUrl}} ({{expiresIn}})",
      },
      "password.reset": {
        subject: "Passwort fuer {{platformName}} zuruecksetzen",
        body: "Hallo {{firstName}}, {{resetUrl}} ({{expiresIn}})",
      },
    },
  };
  assert.equal(emailTemplateSettingsInputSchema.safeParse(settings).success, true);
  assert.equal(
    emailTemplateSettingsUpdateInputSchema.safeParse({
      ...settings,
      locale: "fr",
    }).success,
    true,
  );
  assert.equal(
    emailTemplateSettingsUpdateInputSchema.safeParse({
      ...settings,
      locale: "nl",
    }).success,
    false,
  );
  assert.deepEqual(emailTemplateLocaleQuerySchema.parse({ locale: "it" }), {
    locale: "it",
  });
  assert.deepEqual(
    (
      openApiDocument.components.schemas.EmailTemplateSettings as {
        properties: {
          templates: { required: readonly string[] };
        };
      }
    ).properties.templates.required,
    [
      "feedback.reply",
      "lesson.available",
      "course.modules.released",
      "invitation.created",
      "password.reset",
    ],
  );
  assert.deepEqual(
    (
      openApiDocument.components.schemas.EmailTemplateSettings as {
        required: readonly string[];
      }
    ).required,
    ["version", "locale", "source", "templates", "updatedAt"],
  );
  assert.match(
    JSON.stringify(
      openApiDocument.components.schemas.EmailTemplateSettingsUpdateResult,
    ),
    /migratedLegacy/,
  );
  assert.equal(
    emailTemplateSettingsInputSchema.safeParse({
      ...settings,
      templates: {
        ...settings.templates,
        "feedback.reply": { subject: "<b>Test</b>", body: "Nachricht" },
      },
    }).success,
    false,
  );
  assert.equal(
    emailTemplateTestInputSchema.safeParse({
      event: "password.reset",
      requestId: "0198fc51-6653-7000-8000-000000000001",
      locale: "es",
    }).success,
    true,
  );
  assert.equal(
    organizationUpdateSchema.safeParse({
      settings: { email_templates: { version: 1 } },
    }).success,
    false,
  );
});
