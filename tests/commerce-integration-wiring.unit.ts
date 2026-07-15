import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const schema = readFileSync(path.join(root, "src/db/schema.ts"), "utf8");
const service = readFileSync(path.join(root, "src/lib/commerce/service.ts"), "utf8");
const inboundRoute = readFileSync(
  path.join(root, "src/app/api/integrations/commerce/[provider]/[endpointKey]/route.ts"),
  "utf8",
);
const n8nTrigger = readFileSync(
  path.join(root, "src/app/api/v1/automation/n8n/trigger/route.ts"),
  "utf8",
);
const automationMemberRoute = readFileSync(
  path.join(root, "src/app/api/v1/automation/members/upsert/route.ts"),
  "utf8",
);
const adminActions = readFileSync(
  path.join(root, "src/lib/commerce/admin-actions.ts"),
  "utf8",
);
const integrationManager = readFileSync(
  path.join(root, "src/components/admin/integration-manager.tsx"),
  "utf8",
);
const openApi = readFileSync(path.join(root, "src/lib/api/openapi.ts"), "utf8");

test("commerce schema persists tenant-bound inbox, lifecycle and outbox state", () => {
  for (const table of [
    "commerce_provider_connections",
    "commerce_products",
    "commerce_product_mappings",
    "commerce_orders",
    "commerce_subscriptions",
    "commerce_entitlements",
    "commerce_inbound_events",
    "commerce_outbox_events",
    "automation_workflow_connections",
    "organization_support_settings",
  ]) {
    assert.match(schema, new RegExp(`\\"${table}\\"`));
  }
  for (const constraint of [
    "commerce_product_mappings_connection_tenant_fk",
    "commerce_orders_user_tenant_fk",
    "commerce_subscriptions_user_tenant_fk",
    "commerce_entitlements_connection_tenant_fk",
    "commerce_entitlements_user_tenant_fk",
    "commerce_inbound_events_connection_tenant_fk",
    "automation_workflows_webhook_tenant_fk",
  ]) {
    assert.match(schema, new RegExp(constraint));
  }
  assert.match(schema, /commerce_inbound_events_connection_external_idx/);
  assert.match(schema, /commerce_entitlements_org_source_idx/);
});

test("inbound commerce verifies a bounded raw body before lifecycle processing", () => {
  const readIndex = inboundRoute.indexOf("readLimitedRequestText");
  const verifyIndex = inboundRoute.indexOf("verifyCommerceProviderSignature({");
  const processIndex = inboundRoute.indexOf("processInboundCommerceEvent({");
  assert.ok(readIndex >= 0 && verifyIndex > readIndex && processIndex > verifyIndex);
  assert.match(inboundRoute, /MAX_PROVIDER_PAYLOAD_BYTES = 256 \* 1024/);
  assert.match(inboundRoute, /createHash\("sha256"\)\.update\(body\.text\)/);
});

test("commerce processing revalidates mutable provider and entitlement state", () => {
  assert.match(service, /currentConnection/);
  assert.match(service, /\.for\("share"\)/);
  assert.match(
    service,
    /currentConnection\.updatedAt\.getTime\(\)[\s\S]*input\.connection\.updatedAt\.getTime\(\)/,
  );
  assert.match(service, /existing\?\.status === "disabled"/);
  assert.match(service, /eq\(bundles\.active, true\)/);
  assert.match(automationMemberRoute, /eq\(bundles\.active, true\)/);
  assert.match(service, /const acquisitionEvent =/);
  assert.match(service, /allowCreate: acquisitionEvent/);
  assert.match(
    service,
    /acquisitionEvent\s*\? eq\(commerceProductMappings\.active, true\)\s*:\s*undefined/,
  );
});

test("entitlement revocation removes only its provenance source", () => {
  assert.match(service, /commerceAccessSource\(entitlement\.id\)/);
  assert.match(service, /eq\(courseAccessGrants\.source, commerceAccessSource\(entitlement\.id\)\)/);
  assert.match(service, /refreshEnrollment/);
  assert.match(service, /reconcileAllExpiredCommerceEntitlements/);
});

test("n8n trigger is API-key scoped, transactional and idempotent", () => {
  assert.match(n8nTrigger, /handleTransactionalApiCommand/);
  assert.match(n8nTrigger, /scopes: \["automations:write"\]/);
  assert.match(n8nTrigger, /idempotent: true/);
  assert.match(n8nTrigger, /webhook\("automation\.n8n\.triggered"/);
});

test("operators can preflight provider, n8n and effective support paths", () => {
  assert.match(adminActions, /runCommerceProviderAdapterPreflight/);
  assert.match(adminActions, /eq\(commerceProductMappings\.active, true\)/);
  assert.match(adminActions, /decryptWebhookSecret/);
  assert.match(adminActions, /assertSafeWebhookUrl\(candidate\.url\)/);
  assert.match(adminActions, /\.for\("update", \{ of: webhooks \}\)/);
  assert.match(adminActions, /\.insert\(webhookDeliveries\)/);
  assert.match(adminActions, /getSupportLauncherConfiguration\(actor\)/);
  assert.match(adminActions, /\^\[a-f0-9\]\{64\}\$/);
  assert.match(integrationManager, /value="preflight"/);
  assert.match(integrationManager, /workflowIntent/);
  assert.match(integrationManager, /value="rotate_endpoint"/);
});

test("Zapier and Make member action supports provenance-safe grant and revoke", () => {
  assert.match(automationMemberRoute, /bundleAction/);
  assert.match(service, /input\.bundleAction === "revoke"/);
  assert.match(service, /automation_bundle_access_revoked/);
  assert.match(service, /revokeEntitlement/);
  assert.match(service, /commerceEntitlementSourceKey/);
});

test("OpenAPI publishes commerce, Zapier-Make action, n8n and support contracts", () => {
  for (const route of [
    "/commerce/connections",
    "/commerce/products",
    "/commerce/orders",
    "/commerce/subscriptions",
    "/commerce/entitlements",
    "/automation/members/upsert",
    "/automation/n8n/workflows",
    "/automation/n8n/trigger",
    "/organization/support",
  ]) {
    assert.match(openApi, new RegExp(route.replaceAll("/", "\\/")));
  }
});
