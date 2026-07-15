import assert from "node:assert/strict";
import test from "node:test";

import {
  describeWebhookDeliveryResponse,
  presentWebhookDelivery,
  summarizeWebhookDeliveryPayload,
  toWebhookDeliverySummary,
} from "@/lib/api/webhook-delivery-model";

test("webhook delivery responses never expose downstream response bodies", () => {
  const response = describeWebhookDeliveryResponse({
    responseStatus: 500,
    responseBody: JSON.stringify({
      password: "never-show-this",
      authorization: "Bearer secret-token",
    }),
  });

  assert.equal(response.failureKind, "http");
  assert.equal(response.bodyRedacted, true);
  assert.match(response.summary ?? "", /HTTP 500/);
  assert.doesNotMatch(JSON.stringify(response), /never-show-this|secret-token/);
});

test("network failures are categorized without echoing URLs or credentials", () => {
  const response = describeWebhookDeliveryResponse({
    responseStatus: null,
    responseBody:
      "connect ETIMEDOUT https://user:password@example.test/hook?token=secret",
  });

  assert.equal(response.failureKind, "timeout");
  assert.equal(response.bodyRedacted, true);
  assert.doesNotMatch(
    JSON.stringify(response),
    /example\.test|password|token=secret/,
  );
});

test("payload presentation contains structure but no payload values", () => {
  const payload = summarizeWebhookDeliveryPayload({
    id: "evt_safe",
    type: "course.published",
    createdAt: "2026-07-13T10:00:00.000Z",
    data: {
      email: "private@example.test",
      apiToken: "never-show-this",
    },
  });

  assert.deepEqual(payload, {
    id: "evt_safe",
    type: "course.published",
    createdAt: "2026-07-13T10:00:00.000Z",
    dataKeys: ["email", "apiToken"],
  });
  assert.doesNotMatch(JSON.stringify(payload), /private@example\.test|never-show-this/);
});

test("summary DTO omits payloads and marks only failed deliveries replayable", () => {
  const detail = presentWebhookDelivery({
    id: "00000000-0000-4000-8000-000000000001",
    webhookId: "00000000-0000-4000-8000-000000000002",
    webhookName: "CRM",
    event: "course.published",
    payload: { data: { courseId: "private-course-id" } },
    status: "failed",
    attempt: 6,
    responseStatus: 503,
    responseBody: "private downstream body",
    durationMs: 850,
    nextRetryAt: null,
    deliveredAt: null,
    createdAt: new Date("2026-07-13T10:00:00.000Z"),
    updatedAt: new Date("2026-07-13T10:10:00.000Z"),
  });
  const summary = toWebhookDeliverySummary(detail);

  assert.equal(summary.replayable, true);
  assert.equal(summary.maxAttempts, 6);
  assert.equal("payload" in summary, false);
  assert.equal("responseBody" in summary, false);
  assert.doesNotMatch(JSON.stringify(summary), /private downstream body|private-course-id/);
});
