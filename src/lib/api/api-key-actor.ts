import "server-only";

import { and, eq, gt, isNull, or } from "drizzle-orm";

import { apiKeys, users } from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import type { ApiTransaction } from "@/lib/api/handler";

export async function requireActiveApiKeyCreator(
  transaction: ApiTransaction,
  input: Readonly<{ organizationId: string; apiKeyId: string }>,
) {
  const [actor] = await transaction
    .select({ id: users.id })
    .from(apiKeys)
    .innerJoin(
      users,
      and(
        eq(users.id, apiKeys.createdById),
        eq(users.organizationId, apiKeys.organizationId),
        eq(users.status, "active"),
      ),
    )
    .where(
      and(
        eq(apiKeys.id, input.apiKeyId),
        eq(apiKeys.organizationId, input.organizationId),
        eq(apiKeys.status, "active"),
        or(isNull(apiKeys.expiresAt), gt(apiKeys.expiresAt, new Date())),
      ),
    )
    .limit(1)
    .for("share");

  if (!actor) {
    throw new ApiError(
      403,
      "forbidden",
      "Der API-Schluessel ist keinem aktiven Benutzer dieser Organisation zugeordnet.",
    );
  }

  return actor;
}
