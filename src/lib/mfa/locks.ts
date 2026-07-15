import "server-only";

import { sql } from "drizzle-orm";
import { db } from "@/db";

export type MfaTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export function mfaUserAdvisoryLockName(
  actor: { id: string; organizationId: string },
) {
  return `mfa-user:${actor.organizationId}:${actor.id}`;
}

export async function acquireMfaUserAdvisoryLock(
  tx: Pick<MfaTransaction, "execute">,
  actor: { id: string; organizationId: string },
) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${mfaUserAdvisoryLockName(actor)}, 0))`,
  );
}
