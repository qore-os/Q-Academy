import assert from "node:assert/strict";
import test from "node:test";

import { openApiDocument } from "../src/lib/api/openapi";

function operation(path: string, method: "get" | "post") {
  const value = openApiDocument.paths[path]?.[method];
  assert.ok(value, `${method.toUpperCase()} ${path} is not documented.`);
  return value;
}

test("webhook delivery operations expose typed sanitized contracts", () => {
  const allDeliveries = operation("/webhooks/deliveries", "get");
  assert.deepEqual(allDeliveries["x-required-scopes"], ["webhooks:read"]);
  assert.match(
    JSON.stringify(allDeliveries.responses["200"]),
    /WebhookDeliverySummary/,
  );

  const nestedList = operation("/webhooks/{id}/deliveries", "get");
  assert.match(
    JSON.stringify(nestedList.responses["200"]),
    /WebhookDeliverySummary/,
  );

  const detail = operation(
    "/webhooks/{id}/deliveries/{deliveryId}",
    "get",
  );
  assert.match(
    JSON.stringify(detail.responses["200"]),
    /WebhookDeliveryDetail/,
  );

  for (const [path, identifier] of [
    ["/webhooks/deliveries/{id}/replay", "id"],
    ["/webhooks/{id}/deliveries/{deliveryId}/retry", "deliveryId"],
  ] as const) {
    const replay = operation(path, "post");
    assert.deepEqual(replay["x-required-scopes"], ["webhooks:write"]);
    assert.match(JSON.stringify(replay.parameters), /IdempotencyKey/);
    assert.match(JSON.stringify(replay.parameters), new RegExp(identifier));
    assert.match(
      JSON.stringify(replay.responses["202"]),
      /WebhookDeliveryDetail/,
    );
    assert.match(replay.description ?? "", /failed delivery/);
  }
});

test("webhook delivery schemas exclude raw transport and payload values", () => {
  const summary = openApiDocument.components.schemas.WebhookDeliverySummary;
  const detail = openApiDocument.components.schemas.WebhookDeliveryDetail;
  assert.equal(summary.additionalProperties, false);
  assert.equal(detail.additionalProperties, false);

  const summaryContract = JSON.stringify(summary);
  const summaryProperties = summary.properties as Record<string, unknown>;
  assert.equal(Object.hasOwn(summaryProperties, "responseBody"), false);
  assert.equal(Object.hasOwn(summaryProperties, "responseBodyRedacted"), true);
  assert.doesNotMatch(summaryContract, /claimedAt/i);
  assert.doesNotMatch(summaryContract, /"payload"/i);

  const detailContract = JSON.stringify(detail);
  const detailProperties = detail.properties as Record<string, unknown>;
  assert.equal(Object.hasOwn(detailProperties, "responseBody"), false);
  assert.equal(Object.hasOwn(detailProperties, "responseBodyRedacted"), true);
  assert.doesNotMatch(detailContract, /additionalProperties":true/i);
  assert.match(detailContract, /dataKeys/);
  assert.doesNotMatch(detailContract, /payload.*data.*additionalProperties/i);
});
