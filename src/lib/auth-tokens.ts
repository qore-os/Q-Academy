import "server-only";

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  emailDeliveries,
  invitations,
  oidcConfigurations,
  organizations,
  passwordResetTokens,
  users,
} from "@/db/schema";
import { encryptPayload } from "@/lib/api/crypto";
import { InactiveOrganizationError } from "@/lib/organization-status";
import { resolveRecipientLocale } from "@/lib/i18n/server";
import { effectiveLocale } from "@/lib/i18n/model";

export function hashOpaqueToken(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function generateOpaqueToken(prefix: "invite" | "reset") {
  return `${prefix}_${randomBytes(32).toString("base64url")}`;
}

export async function getInvitationAuthContext(token: string) {
  if (token.length < 32 || token.length > 512) return null;
  const [record] = await db
    .select({
      organizationId: invitations.organizationId,
      oidcEnabled: oidcConfigurations.enabled,
      oidcDisplayName: oidcConfigurations.displayName,
      passwordLoginEnabled: oidcConfigurations.passwordLoginEnabled,
      preferredLocale: users.preferredLocale,
      defaultLocale: organizations.defaultLocale,
    })
    .from(invitations)
    .innerJoin(
      users,
      and(
        eq(users.id, invitations.userId),
        eq(users.organizationId, invitations.organizationId),
        eq(users.status, "invited"),
      ),
    )
    .innerJoin(
      organizations,
      and(
        eq(organizations.id, invitations.organizationId),
        eq(organizations.status, "active"),
      ),
    )
    .leftJoin(
      oidcConfigurations,
      eq(oidcConfigurations.organizationId, invitations.organizationId),
    )
    .where(
      and(
        eq(invitations.tokenHash, hashOpaqueToken(token)),
        isNull(invitations.acceptedAt),
        gt(invitations.expiresAt, new Date()),
      ),
    )
    .limit(1);
  if (!record) return null;
  return {
    organizationId: record.organizationId,
    oidcEnabled: record.oidcEnabled === true,
    oidcDisplayName: record.oidcDisplayName ?? "Unternehmens-Login",
    passwordLoginEnabled: record.passwordLoginEnabled !== false,
    locale: effectiveLocale(record),
  };
}

type AuthTokenExecutor = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function createInvitationToken(
  input: {
    organizationId: string;
    userId: string;
    email: string;
    createdById?: string | null;
    deliveryOrigin: string;
  },
  executor?: AuthTokenExecutor,
) {
  const token = generateOpaqueToken("invite");
  const link = `${input.deliveryOrigin}/invitations/${encodeURIComponent(token)}`;
  const create = async (tx: AuthTokenExecutor) => {
    const [organization] = await tx
      .select({ id: organizations.id })
      .from(organizations)
      .innerJoin(
        users,
        and(
          eq(users.id, input.userId),
          eq(users.organizationId, organizations.id),
          eq(users.status, "invited"),
        ),
      )
      .where(
        and(
          eq(organizations.id, input.organizationId),
          eq(organizations.status, "active"),
        ),
      )
      .limit(1)
      .for("share");
    if (!organization) throw new InactiveOrganizationError();
    await tx.update(invitations).set({ acceptedAt: new Date() }).where(
      openInvitationForUser(input.userId),
    );
    const [invitation] = await tx
      .insert(invitations)
      .values({
        organizationId: input.organizationId,
        userId: input.userId,
        email: input.email,
        createdById: input.createdById,
        tokenHash: hashOpaqueToken(token),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60_000),
      })
      .returning();
    await deliverAuthLink(
      {
        organizationId: input.organizationId,
        userId: input.userId,
        event: "invitation.created",
        email: input.email,
        link,
      },
      tx,
    );
    return { invitation, token, link };
  };
  return executor ? create(executor) : db.transaction(create);
}

function openInvitationForUser(userId: string) {
  return and(eq(invitations.userId, userId), isNull(invitations.acceptedAt));
}

export async function createPasswordResetDelivery(input: {
  organizationId: string;
  userId: string;
  email: string;
  origin: string;
}) {
  const token = generateOpaqueToken("reset");
  const link = `${input.origin}/password/reset?token=${encodeURIComponent(token)}`;
  await db.transaction(async (tx) => {
    const [organization] = await tx
      .select({ id: organizations.id })
      .from(organizations)
      .innerJoin(
        users,
        and(
          eq(users.id, input.userId),
          eq(users.organizationId, organizations.id),
          eq(users.status, "active"),
        ),
      )
      .where(
        and(
          eq(organizations.id, input.organizationId),
          eq(organizations.status, "active"),
        ),
      )
      .limit(1)
      .for("share");
    if (!organization) throw new InactiveOrganizationError();
    await tx
      .update(passwordResetTokens)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(passwordResetTokens.userId, input.userId),
          isNull(passwordResetTokens.usedAt),
        ),
      );
    await tx.insert(passwordResetTokens).values({
      userId: input.userId,
      tokenHash: hashOpaqueToken(token),
      expiresAt: new Date(Date.now() + 30 * 60_000),
    });
    await deliverAuthLink(
      {
        organizationId: input.organizationId,
        userId: input.userId,
        event: "password.reset",
        email: input.email,
        link,
      },
      tx,
    );
  });
  return { token, link };
}

type AuthLinkExecutor = Pick<typeof db, "insert" | "select">;

export async function deliverAuthLink(input: {
  organizationId: string;
  userId: string;
  event: "invitation.created" | "password.reset";
  email: string;
  link: string;
}, executor: AuthLinkExecutor = db) {
  const id = randomUUID();
  const locale = await resolveRecipientLocale(executor, {
    organizationId: input.organizationId,
    userId: input.userId,
  });
  await executor.insert(emailDeliveries).values({
    id,
    organizationId: input.organizationId,
    userId: input.userId,
    event: input.event,
    category: "system",
    recipientEmail: input.email,
    payload: encryptPayload(
      JSON.stringify({ link: input.link, locale }),
      `email-delivery:${id}`,
    ),
  });
  return { id };
}
