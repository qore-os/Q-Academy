import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { dataForms, hubs, type HubLayout } from "@/db/schema";
import {
  hubLayoutFormIds,
  hubLayoutTransitionFormIds,
} from "@/lib/data-form-embedding-policy";
import { dataFormMutationLockKey } from "@/lib/data-profile-lock";

export { hubLayoutFormIds, hubLayoutTransitionFormIds } from "@/lib/data-form-embedding-policy";

type DataFormEmbeddingReader = Pick<typeof db, "select">;
type DataFormEmbeddingTransaction = Pick<typeof db, "execute" | "select">;

export async function hubLayoutFormsBelongToTenant(
  layout: HubLayout,
  organizationId: string,
  reader: DataFormEmbeddingReader = db,
  lockRows = false,
) {
  const formIds = hubLayoutFormIds(layout);
  if (formIds.length === 0) return true;
  const query = reader
    .select({ id: dataForms.id })
    .from(dataForms)
    .where(
      and(
        eq(dataForms.organizationId, organizationId),
        eq(dataForms.active, true),
        inArray(dataForms.id, formIds),
      ),
    );
  const rows = lockRows ? await query.for("share") : await query;
  return rows.length === formIds.length;
}

export async function lockHubLayoutFormsForMutation(
  layout: HubLayout,
  organizationId: string,
  transaction: DataFormEmbeddingTransaction,
) {
  return lockHubLayoutFormTransitionForMutation(
    [],
    layout,
    organizationId,
    transaction,
  );
}

export async function lockHubLayoutFormTransitionForMutation(
  currentLayout: HubLayout,
  nextLayout: HubLayout,
  organizationId: string,
  transaction: DataFormEmbeddingTransaction,
) {
  for (const formId of hubLayoutTransitionFormIds(currentLayout, nextLayout)) {
    await transaction.execute(
      sql`select pg_advisory_xact_lock(hashtext(${dataFormMutationLockKey(organizationId, formId)}))`,
    );
  }
  return hubLayoutFormsBelongToTenant(
    nextLayout,
    organizationId,
    transaction,
    true,
  );
}

export async function hubReferencesDataForm(
  reader: Pick<typeof db, "select">,
  organizationId: string,
  formId: string,
) {
  const [reference] = await reader
    .select({ id: hubs.id })
    .from(hubs)
    .where(
      and(
        eq(hubs.organizationId, organizationId),
        sql`exists (
          select 1
          from jsonb_array_elements(${hubs.layout}) as layout_rows(row)
          cross join lateral jsonb_array_elements(row -> 'columns')
            as layout_widgets(widget)
          where widget ->> 'type' = 'data_form'
            and widget ->> 'formId' = ${formId}
        )`,
      ),
    )
    .limit(1);
  return Boolean(reference);
}
