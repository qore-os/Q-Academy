import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";

import postgres from "postgres";

import {
  calculateOrbitBillingProjection,
  dueOrbitBillingPeriods,
} from "../src/lib/orbit/billing-policy";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";
const sql = postgres(databaseUrl, { max: 1, prepare: false });

after(async () => {
  await sql.end();
});

test("Orbit billing preserves immutable pricing and reconciles historical gaps", async () => {
  const accountId = randomUUID();
  const workspaceId = randomUUID();
  const activation = new Date("2026-01-15T12:00:00.000Z");
  const finalizedAt = new Date("2026-05-15T12:00:00.000Z");
  const rollback = new Error("rollback Orbit billing integration fixture");

  await assert.rejects(
    sql.begin(async (tx) => {
      await tx`
        insert into orbit_accounts (
          id, email, display_name, created_at, updated_at
        ) values (
          ${accountId}, ${`orbit-billing-${accountId}@example.test`},
          'Orbit billing fixture', ${activation}, ${activation}
        )
      `;
      await tx`
        insert into orbit_workspaces (
          id, name, slug, instance_slot_limit, created_by_account_id,
          created_at, updated_at
        ) values (
          ${workspaceId}, 'Orbit billing fixture',
          ${`orbit-billing-${workspaceId}`}, 10, ${accountId},
          ${activation}, ${activation}
        )
      `;
      await tx`
        insert into orbit_billing_accounts (
          workspace_id, status, currency, billing_interval,
          base_fee_cents, included_instance_slots,
          additional_instance_fee_cents, settlement_mode, revision,
          created_at, updated_at
        ) values (
          ${workspaceId}, 'active', 'EUR', 'monthly',
          2000, 2, 400, 'manual', 2, ${activation}, ${activation}
        )
      `;
      await tx`
        insert into orbit_billing_price_versions (
          workspace_id, revision, effective_from, currency,
          base_fee_cents, included_instance_slots,
          additional_instance_fee_cents, created_by_account_id, created_at
        ) values
          (
            ${workspaceId}, 1, '1970-01-01T00:00:00Z', 'EUR',
            1000, 1, 250, ${accountId}, ${activation}
          ),
          (
            ${workspaceId}, 2, '2026-03-01T00:00:00Z', 'EUR',
            2000, 2, 400, ${accountId}, ${activation}
          )
      `;

      await assert.rejects(
        tx.savepoint(async (savepoint) => {
          await savepoint`
            update orbit_billing_price_versions
            set base_fee_cents = 9999
            where workspace_id = ${workspaceId} and revision = 1
          `;
        }),
        /orbit_billing_price_versions is append-only/,
      );
      await assert.rejects(
        tx.savepoint(async (savepoint) => {
          await savepoint`
            delete from orbit_billing_price_versions
            where workspace_id = ${workspaceId} and revision = 1
          `;
        }),
        /orbit_billing_price_versions is append-only/,
      );
      await assert.rejects(
        tx.savepoint(async (savepoint) => {
          await savepoint`
            insert into orbit_billing_price_versions (
              workspace_id, revision, effective_from, currency,
              base_fee_cents, included_instance_slots,
              additional_instance_fee_cents, created_by_account_id
            ) values (
              ${workspaceId}, 3, '2026-06-01T00:00:00Z', 'EUR',
              100000000001, 2, 400, ${accountId}
            )
          `;
        }),
        /orbit_billing_price_versions_amounts_check/,
      );

      const februaryPeriod = {
        start: new Date("2026-02-01T00:00:00.000Z"),
        end: new Date("2026-03-01T00:00:00.000Z"),
      };
      const februaryProjection = calculateOrbitBillingProjection({
        pricing: {
          currency: "EUR",
          billingInterval: "monthly",
          baseFeeCents: 1000,
          includedInstanceSlots: 1,
          additionalInstanceFeeCents: 250,
          revision: 1,
        },
        instanceCount: 3,
        period: februaryPeriod,
      });
      await tx`
        insert into orbit_billing_statements (
          workspace_id, period_start, period_end, instance_count,
          included_instance_slots, additional_instance_count,
          base_fee_cents, additional_instance_fee_cents, subtotal_cents,
          currency, pricing_revision, finalized_at, created_at
        ) values (
          ${workspaceId}, ${februaryPeriod.start}, ${februaryPeriod.end},
          ${februaryProjection.instanceCount},
          ${februaryProjection.includedInstanceSlots},
          ${februaryProjection.additionalInstanceCount},
          ${februaryProjection.baseFeeCents},
          ${februaryProjection.additionalInstanceFeeCents},
          ${februaryProjection.subtotalCents},
          ${februaryProjection.currency},
          ${februaryProjection.pricingRevision}, ${finalizedAt}, ${finalizedAt}
        )
      `;

      const finalizedPeriods = await tx<Array<{ period_start: Date }>>`
        select period_start
        from orbit_billing_statements
        where workspace_id = ${workspaceId}
      `;
      const duePeriods = dueOrbitBillingPeriods(
        "monthly",
        activation,
        finalizedPeriods.map((row) => row.period_start),
        finalizedAt,
      );
      assert.deepEqual(
        duePeriods.map((period) => period.start.toISOString()),
        [
          "2026-01-01T00:00:00.000Z",
          "2026-03-01T00:00:00.000Z",
          "2026-04-01T00:00:00.000Z",
        ],
      );

      for (const period of duePeriods) {
        const [pricing] = await tx<
          Array<{
            revision: number;
            currency: string;
            base_fee_cents: string;
            included_instance_slots: number;
            additional_instance_fee_cents: string;
          }>
        >`
          select revision, currency, base_fee_cents,
            included_instance_slots, additional_instance_fee_cents
          from orbit_billing_price_versions
          where workspace_id = ${workspaceId}
            and effective_from <= ${period.start}
          order by effective_from desc, revision desc
          limit 1
        `;
        assert.ok(pricing);
        const projection = calculateOrbitBillingProjection({
          pricing: {
            currency: pricing.currency,
            billingInterval: "monthly",
            baseFeeCents: Number(pricing.base_fee_cents),
            includedInstanceSlots: pricing.included_instance_slots,
            additionalInstanceFeeCents: Number(
              pricing.additional_instance_fee_cents,
            ),
            revision: pricing.revision,
          },
          instanceCount: 3,
          period,
        });
        await tx`
          insert into orbit_billing_statements (
            workspace_id, period_start, period_end, instance_count,
            included_instance_slots, additional_instance_count,
            base_fee_cents, additional_instance_fee_cents, subtotal_cents,
            currency, pricing_revision, finalized_at, created_at
          ) values (
            ${workspaceId}, ${period.start}, ${period.end},
            ${projection.instanceCount}, ${projection.includedInstanceSlots},
            ${projection.additionalInstanceCount}, ${projection.baseFeeCents},
            ${projection.additionalInstanceFeeCents},
            ${projection.subtotalCents}, ${projection.currency},
            ${projection.pricingRevision}, ${finalizedAt}, ${finalizedAt}
          )
        `;
      }

      const duplicate = await tx`
        insert into orbit_billing_statements (
          workspace_id, period_start, period_end, instance_count,
          included_instance_slots, additional_instance_count,
          base_fee_cents, additional_instance_fee_cents, subtotal_cents,
          currency, pricing_revision, finalized_at, created_at
        ) values (
          ${workspaceId}, ${duePeriods[0]!.start}, ${duePeriods[0]!.end},
          3, 1, 2, 1000, 250, 1500, 'EUR', 1,
          ${finalizedAt}, ${finalizedAt}
        )
        on conflict (workspace_id, period_start, period_end) do nothing
        returning id
      `;
      assert.equal(duplicate.length, 0);

      const statements = await tx<
        Array<{
          period_start: Date;
          pricing_revision: number;
          subtotal_cents: string;
        }>
      >`
        select period_start, pricing_revision, subtotal_cents
        from orbit_billing_statements
        where workspace_id = ${workspaceId}
        order by period_start
      `;
      assert.deepEqual(
        statements.map((statement) => ({
          periodStart: statement.period_start.toISOString(),
          revision: statement.pricing_revision,
          subtotalCents: Number(statement.subtotal_cents),
        })),
        [
          {
            periodStart: "2026-01-01T00:00:00.000Z",
            revision: 1,
            subtotalCents: 1500,
          },
          {
            periodStart: "2026-02-01T00:00:00.000Z",
            revision: 1,
            subtotalCents: 1500,
          },
          {
            periodStart: "2026-03-01T00:00:00.000Z",
            revision: 2,
            subtotalCents: 2400,
          },
          {
            periodStart: "2026-04-01T00:00:00.000Z",
            revision: 2,
            subtotalCents: 2400,
          },
        ],
      );

      await tx`delete from orbit_accounts where id = ${accountId}`;
      const priceVersions = await tx<
        Array<{ revision: number; created_by_account_id: string | null }>
      >`
        select revision, created_by_account_id
        from orbit_billing_price_versions
        where workspace_id = ${workspaceId}
        order by revision
      `;
      assert.deepEqual(
        Array.from(priceVersions),
        [
          { revision: 1, created_by_account_id: null },
          { revision: 2, created_by_account_id: null },
        ],
      );

      throw rollback;
    }),
    (error: unknown) => error === rollback,
  );

  const [remaining] = await sql<Array<{ value: number }>>`
    select count(*)::int as value
    from orbit_workspaces
    where id = ${workspaceId}
  `;
  assert.equal(remaining?.value, 0);
});
