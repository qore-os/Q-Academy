import assert from "node:assert/strict";
import test from "node:test";
import { openApiDocument } from "../src/lib/api/openapi";
import { hasValidOpenApiResponseContract } from "../src/lib/api/openapi-contract";
import { WEBHOOK_EVENTS } from "../src/lib/api/scopes";
import { eventLifecycleCommandSchema } from "../src/lib/event-lifecycle-model";
import { createEventCalendar } from "../src/lib/icalendar";

test("event lifecycle REST contract is scoped, typed and idempotent", () => {
  const path = openApiDocument.paths["/events/{id}/lifecycle"];
  assert.ok(path?.get);
  assert.ok(path.patch);
  assert.deepEqual(path.get["x-required-scopes"], ["events:read"]);
  assert.deepEqual(path.patch["x-required-scopes"], ["events:write"]);
  assert.match(JSON.stringify(path.patch.requestBody), /EventLifecycleCommand/);
  assert.match(JSON.stringify(path.patch.parameters), /IdempotencyKey/);
  assert.equal(
    eventLifecycleCommandSchema.safeParse({
      action: "cancel",
      reason: "Trainer ist verhindert.",
    }).success,
    true,
  );
  assert.equal(
    eventLifecycleCommandSchema.safeParse({
      action: "cancel",
      reason: "Trainer ist verhindert.",
      startsAt: "2030-01-01T10:00:00Z",
    }).success,
    false,
  );
});

test("event deletion fails closed in favor of the append-only lifecycle", () => {
  const operation = openApiDocument.paths["/events/{id}"]?.delete;
  assert.ok(operation);
  assert.equal(operation.deprecated, true);
  assert.equal(operation["x-always-error"], true);
  assert.deepEqual(Object.keys(operation.responses).sort(), [
    "400",
    "401",
    "403",
    "404",
    "409",
    "429",
    "500",
  ]);
  assert.equal(hasValidOpenApiResponseContract(operation), true);
});

test("always-error OpenAPI operations require explicit deprecation and conflict", () => {
  assert.equal(
    hasValidOpenApiResponseContract({ responses: { "200": {} } }),
    true,
  );
  assert.equal(
    hasValidOpenApiResponseContract({
      responses: { "409": {} },
      "x-always-error": true,
    }),
    false,
  );
  assert.equal(
    hasValidOpenApiResponseContract({
      deprecated: true,
      responses: { "500": {} },
      "x-always-error": true,
    }),
    false,
  );
});

test("event lifecycle webhook events are explicitly registered", () => {
  assert.ok(WEBHOOK_EVENTS.includes("event.rescheduled"));
  assert.ok(WEBHOOK_EVENTS.includes("event.cancelled"));
});

test("cancelled ICS exports preserve identity and advance sequence", () => {
  const calendar = createEventCalendar(
    {
      id: "0198fc51-6653-7000-8000-000000000001",
      organizationId: "0198fc51-6653-7000-8000-000000000002",
      title: "Abgesagter Workshop",
      description: null,
      startsAt: new Date("2030-01-15T09:00:00Z"),
      endsAt: new Date("2030-01-15T11:00:00Z"),
      timezone: "Europe/Zurich",
      location: null,
      meetingUrl: null,
      status: "cancelled",
      lifecycleRevision: 3,
    },
    "Q Academy",
    new Date("2026-07-12T10:00:00Z"),
  ).replaceAll("\r\n ", "");
  assert.match(calendar, /METHOD:CANCEL/);
  assert.match(calendar, /STATUS:CANCELLED/);
  assert.match(calendar, /SEQUENCE:3/);
  assert.match(calendar, /X-WR-TIMEZONE:Europe\/Zurich/);
  assert.match(calendar, /X-Q-ACADEMY-TIMEZONE:Europe\/Zurich/);
  assert.match(
    calendar,
    /UID:0198fc51-6653-7000-8000-000000000001@0198fc51-6653-7000-8000-000000000002\.q-academy/,
  );
});
