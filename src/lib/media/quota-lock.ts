import "server-only";

import { sql } from "drizzle-orm";

export function mediaTenantQuotaLockQuery(organizationId: string) {
  return sql`select pg_advisory_xact_lock(hashtextextended(${`q-academy:media-quota:v1:${organizationId}`}::text, 0))`;
}
