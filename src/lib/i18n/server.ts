import "server-only";

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { organizations, users, type User } from "@/db/schema";
import {
  DEFAULT_LOCALE,
  effectiveLocale,
  normalizeLocale,
  type AppLocale,
} from "@/lib/i18n/model";

type LocaleReader = Pick<typeof db, "select">;

export async function getOrganizationDefaultLocale(
  organizationId: string | null | undefined,
  reader: LocaleReader = db,
): Promise<AppLocale> {
  if (!organizationId) return DEFAULT_LOCALE;
  const [organization] = await reader
    .select({ defaultLocale: organizations.defaultLocale })
    .from(organizations)
    .where(
      and(
        eq(organizations.id, organizationId),
        eq(organizations.status, "active"),
      ),
    )
    .limit(1);
  return normalizeLocale(organization?.defaultLocale);
}

export async function resolveUserLocale(
  user: Pick<User, "organizationId" | "preferredLocale">,
  reader: LocaleReader = db,
): Promise<AppLocale> {
  if (user.preferredLocale) return normalizeLocale(user.preferredLocale);
  return getOrganizationDefaultLocale(user.organizationId, reader);
}

export async function resolveRecipientLocale(
  reader: LocaleReader,
  input: { organizationId: string; userId: string },
): Promise<AppLocale> {
  const [record] = await reader
    .select({
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
        eq(users.id, input.userId),
        eq(users.organizationId, input.organizationId),
      ),
    )
    .limit(1);
  if (!record) {
    throw new Error("Locale recipient is not available in the requested tenant.");
  }
  return effectiveLocale(record);
}
