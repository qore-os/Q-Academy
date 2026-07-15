import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import test, { after } from "node:test";

import postgres from "postgres";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";
const baseUrl = process.env.TEST_BASE_URL ?? "http://127.0.0.1:3000";
const sql = postgres(databaseUrl, { max: 2, prepare: false });

after(() => sql.end());

function keyHash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

async function command(
  token: string,
  path: string,
  body: Record<string, unknown>,
) {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Idempotency-Key": randomUUID(),
    },
    body: JSON.stringify(body),
  });
}

test(
  "commerce API rejects inactive grants but still revokes historical access",
  { timeout: 60_000 },
  async () => {
    const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
    const token = `qak_test_${randomBytes(28).toString("base64url")}`;
    let organizationId = "";

    try {
      const [organization] = await sql<Array<{ id: string }>>`
        insert into organizations (name, slug)
        values (${`Commerce QA ${suffix}`}, ${`commerce-qa-${suffix}`})
        returning id
      `;
      organizationId = organization!.id;
      const users = await sql<Array<{ id: string; status: string }>>`
        insert into users (
          organization_id, email, password_hash, first_name, last_name,
          role, status
        ) values
          (${organizationId}, ${`owner-${suffix}@example.test`}, 'unused', 'QA', 'Owner', 'owner', 'active'),
          (${organizationId}, ${`member-${suffix}@example.test`}, 'unused', 'QA', 'Member', 'member', 'active'),
          (${organizationId}, ${`disabled-${suffix}@example.test`}, 'unused', 'QA', 'Disabled', 'member', 'disabled')
        returning id, status
      `;
      const ownerId = users[0]!.id;
      const memberId = users[1]!.id;
      const disabledId = users[2]!.id;
      const bundles = await sql<Array<{ id: string; active: boolean }>>`
        insert into bundles (organization_id, name, active)
        values
          (${organizationId}, ${`Active ${suffix}`}, true),
          (${organizationId}, ${`Inactive ${suffix}`}, false)
        returning id, active
      `;
      const activeBundleId = bundles.find((bundle) => bundle.active)!.id;
      const inactiveBundleId = bundles.find((bundle) => !bundle.active)!.id;
      const [product] = await sql<Array<{ id: string }>>`
        insert into commerce_products (
          organization_id, name, sku, bundle_id, active
        ) values (
          ${organizationId}, ${`Product ${suffix}`}, ${`product-${suffix}`},
          ${activeBundleId}, true
        ) returning id
      `;
      await sql`
        insert into api_keys (
          organization_id, name, prefix, key_hash, scopes, created_by_id
        ) values (
          ${organizationId}, 'Commerce QA', 'qak_test', ${keyHash(token)},
          array['commerce:read', 'commerce:write', 'automations:write'],
          ${ownerId}
        )
      `;

      const disabled = await command(
        token,
        "/api/v1/automation/members/upsert",
        {
          email: `disabled-${suffix}@example.test`,
          firstName: "QA",
          lastName: "Disabled",
          sendInvitation: false,
        },
      );
      assert.equal(disabled.status, 409);

      const inactiveBundle = await command(
        token,
        "/api/v1/automation/members/upsert",
        {
          email: `new-${suffix}@example.test`,
          firstName: "QA",
          lastName: "New",
          bundleId: inactiveBundleId,
          sendInvitation: false,
        },
      );
      assert.equal(inactiveBundle.status, 404);

      const automationGrant = await command(
        token,
        "/api/v1/automation/members/upsert",
        {
          email: `member-${suffix}@example.test`,
          firstName: "QA",
          lastName: "Member",
          bundleId: activeBundleId,
          bundleAction: "grant",
          sendInvitation: false,
        },
      );
      assert.equal(automationGrant.status, 200);
      const automationGrantBody = (await automationGrant.json()) as {
        data: { bundleAction: string; bundleAccessChanged: boolean };
      };
      assert.equal(automationGrantBody.data.bundleAction, "grant");
      assert.equal(automationGrantBody.data.bundleAccessChanged, true);

      const sourceReference = `qa:${suffix}`;
      const granted = await command(token, "/api/v1/commerce/entitlements", {
        action: "grant",
        userId: memberId,
        productId: product!.id,
        sourceReference,
      });
      assert.equal(granted.status, 200);

      await sql`
        update commerce_products set active = false, updated_at = now()
        where id = ${product!.id}
      `;
      await sql`
        update bundles set active = false where id = ${activeBundleId}
      `;

      const automationRevoke = await command(
        token,
        "/api/v1/automation/members/upsert",
        {
          email: `member-${suffix}@example.test`,
          firstName: "QA",
          lastName: "Member",
          bundleId: activeBundleId,
          bundleAction: "revoke",
          sendInvitation: false,
        },
      );
      assert.equal(automationRevoke.status, 200);
      const automationRevokeBody = (await automationRevoke.json()) as {
        data: { bundleAction: string; bundleAccessChanged: boolean };
      };
      assert.equal(automationRevokeBody.data.bundleAction, "revoke");
      assert.equal(automationRevokeBody.data.bundleAccessChanged, true);
      const [automationEntitlement] = await sql<Array<{ status: string }>>`
        select entitlement.status
        from commerce_entitlements entitlement
        inner join commerce_products product on product.id = entitlement.product_id
        where entitlement.organization_id = ${organizationId}
          and entitlement.user_id = ${memberId}
          and product.sku = ${`automation-bundle-${activeBundleId}`}
      `;
      assert.equal(automationEntitlement?.status, "revoked");

      const revoked = await command(token, "/api/v1/commerce/entitlements", {
        action: "revoke",
        userId: memberId,
        productId: product!.id,
        sourceReference,
        reason: "qa_historical_revoke",
      });
      assert.equal(revoked.status, 200);
      const [entitlement] = await sql<Array<{ status: string }>>`
        select status from commerce_entitlements
        where organization_id = ${organizationId}
          and user_id = ${memberId}
          and product_id = ${product!.id}
      `;
      assert.equal(entitlement?.status, "revoked");

      const inactiveGrant = await command(
        token,
        "/api/v1/commerce/entitlements",
        {
          action: "grant",
          userId: memberId,
          productId: product!.id,
          sourceReference: `${sourceReference}:inactive`,
        },
      );
      assert.equal(inactiveGrant.status, 409);

      assert.ok(disabledId);
    } finally {
      if (organizationId) {
        await sql`delete from organizations where id = ${organizationId}`;
      }
    }
  },
);
