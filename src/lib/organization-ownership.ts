import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import type { db } from "@/db";
import {
  activityEvents,
  teamRoleAssignments,
  users,
  userSessions,
  type User,
} from "@/db/schema";
import { ApiError } from "@/lib/api/errors";

type OwnershipTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type OwnershipTransferResult = Readonly<{
  previousOwnerId: string;
  nextOwnerId: string;
  nextOwnerEmail: string;
  transferredAt: Date;
}>;

export async function transferOrganizationOwnershipInTransaction(
  tx: OwnershipTransaction,
  input: {
    actor: Pick<User, "id" | "organizationId" | "passwordHash">;
    targetUserId: string;
    now?: Date;
  },
): Promise<OwnershipTransferResult> {
  if (input.actor.id === input.targetUserId) {
    throw new ApiError(
      422,
      "validation_error",
      "Der aktuelle Owner kann nicht an sich selbst uebertragen.",
    );
  }

  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`organization-owner-transfer:${input.actor.organizationId}`}, 0))`,
  );

  const accounts = await tx
    .select({
      id: users.id,
      email: users.email,
      role: users.role,
      status: users.status,
      passwordHash: users.passwordHash,
    })
    .from(users)
    .where(
      and(
        eq(users.organizationId, input.actor.organizationId),
        inArray(users.id, [input.actor.id, input.targetUserId]),
      ),
    )
    .for("update");

  const currentOwner = accounts.find((account) => account.id === input.actor.id);
  const nextOwner = accounts.find((account) => account.id === input.targetUserId);
  if (
    !currentOwner ||
    currentOwner.role !== "owner" ||
    currentOwner.status !== "active" ||
    currentOwner.passwordHash !== input.actor.passwordHash
  ) {
    throw new ApiError(
      409,
      "conflict",
      "Die Owner-Berechtigung hat sich geaendert. Bitte bestaetige die Aktion erneut.",
    );
  }
  if (!nextOwner) {
    throw new ApiError(404, "not_found", "Das Zielkonto wurde nicht gefunden.");
  }
  if (nextOwner.role !== "admin" || nextOwner.status !== "active") {
    throw new ApiError(
      422,
      "validation_error",
      "Ownership kann nur an ein aktives Admin-Konto uebertragen werden.",
    );
  }

  const [ownerCount] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(users)
    .where(
      and(
        eq(users.organizationId, input.actor.organizationId),
        eq(users.role, "owner"),
      ),
    );
  if (Number(ownerCount?.count ?? 0) !== 1) {
    throw new ApiError(
      409,
      "conflict",
      "Der Owner-Wechsel erfordert genau einen aktuellen Organisations-Owner.",
    );
  }

  const transferredAt = input.now ?? new Date();
  const [promoted] = await tx
    .update(users)
    .set({ role: "owner" })
    .where(
      and(
        eq(users.id, nextOwner.id),
        eq(users.organizationId, input.actor.organizationId),
        eq(users.role, "admin"),
        eq(users.status, "active"),
      ),
    )
    .returning({ id: users.id });
  const [demoted] = await tx
    .update(users)
    .set({ role: "admin" })
    .where(
      and(
        eq(users.id, currentOwner.id),
        eq(users.organizationId, input.actor.organizationId),
        eq(users.role, "owner"),
        eq(users.status, "active"),
      ),
    )
    .returning({ id: users.id });
  if (!promoted || !demoted) {
    throw new ApiError(
      409,
      "conflict",
      "Der Owner-Wechsel konnte nicht atomar abgeschlossen werden.",
    );
  }

  await tx
    .delete(teamRoleAssignments)
    .where(
      and(
        eq(teamRoleAssignments.organizationId, input.actor.organizationId),
        eq(teamRoleAssignments.userId, nextOwner.id),
      ),
    );
  await tx
    .update(userSessions)
    .set({ revokedAt: transferredAt })
    .where(
      and(
        eq(userSessions.organizationId, input.actor.organizationId),
        inArray(userSessions.userId, [currentOwner.id, nextOwner.id]),
        isNull(userSessions.revokedAt),
      ),
    );
  await tx.insert(activityEvents).values({
    organizationId: input.actor.organizationId,
    userId: currentOwner.id,
    type: "organization.owner_transferred",
    entityType: "organization",
    entityId: input.actor.organizationId,
    metadata: {
      previousOwnerId: currentOwner.id,
      nextOwnerId: nextOwner.id,
    },
    createdAt: transferredAt,
  });

  return {
    previousOwnerId: currentOwner.id,
    nextOwnerId: nextOwner.id,
    nextOwnerEmail: nextOwner.email,
    transferredAt,
  };
}
