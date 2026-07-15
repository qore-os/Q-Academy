import "server-only";

import { and, eq, inArray } from "drizzle-orm";

import { users } from "@/db/schema";
import type { ApiContext } from "@/lib/api/auth";
import { ApiError } from "@/lib/api/errors";
import type { ApiTransaction } from "@/lib/api/handler";
import {
  communityApiActorForContext,
  type CommunityPolicyActor,
} from "@/lib/community-access";

export function assertCommunityAdminRole(actor: CommunityPolicyActor) {
  if (actor.role === "owner" || actor.role === "admin") return;

  throw new ApiError(
    403,
    "forbidden",
    "Nur aktive Organisationsadministratoren duerfen die Community-Governance verwalten.",
  );
}

export async function communityAdminApiActorForContext(context: ApiContext) {
  const actor = await communityApiActorForContext(context);
  assertCommunityAdminRole(actor);
  return actor;
}

export async function requireActiveCommunityAdmin(
  tx: ApiTransaction,
  input: Readonly<{ organizationId: string; actorId: string }>,
) {
  const [actor] = await tx
    .select({
      id: users.id,
      organizationId: users.organizationId,
      role: users.role,
    })
    .from(users)
    .where(
      and(
        eq(users.id, input.actorId),
        eq(users.organizationId, input.organizationId),
        eq(users.status, "active"),
        inArray(users.role, ["owner", "admin"]),
      ),
    )
    .limit(1)
    .for("share", { of: users });

  if (!actor) {
    throw new ApiError(
      403,
      "forbidden",
      "Die Community-Governance erfordert weiterhin eine aktive Administratorrolle.",
    );
  }

  return actor;
}
