import "server-only";

import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { organizations, users } from "@/db/schema";
import { effectiveLocale, type AppLocale } from "@/lib/i18n/model";

type CommunityLocaleReader = Pick<typeof db, "select">;

export async function resolveCommunityRecipientLocales(
  reader: CommunityLocaleReader,
  input: { organizationId: string; userIds: readonly string[] },
): Promise<Map<string, AppLocale>> {
  const userIds = [...new Set(input.userIds)];
  if (!userIds.length) return new Map();

  const rows = await reader
    .select({
      userId: users.id,
      preferredLocale: users.preferredLocale,
      defaultLocale: organizations.defaultLocale,
    })
    .from(users)
    .innerJoin(
      organizations,
      and(
        eq(organizations.id, users.organizationId),
        eq(organizations.status, "active"),
      ),
    )
    .where(
      and(
        eq(users.organizationId, input.organizationId),
        inArray(users.id, userIds),
      ),
    );

  return new Map(
    rows.map((row) => [row.userId, effectiveLocale(row)] as const),
  );
}
