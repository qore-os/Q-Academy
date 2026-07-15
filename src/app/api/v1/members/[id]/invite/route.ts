import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { invitations, users } from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import { getCanonicalTenantAuthOrigin } from "@/lib/branding";
import { apiOptions, handleApi } from "@/lib/api/handler";
import {
  deliverAuthLink,
  generateOpaqueToken,
  hashOpaqueToken,
} from "@/lib/auth-tokens";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleApi(request, { scopes: ["members:write"], action: "member.invite", resourceType: "member", idempotent: true }, async (context) => {
    const token = generateOpaqueToken("invite");
    const invitationOrigin = await getCanonicalTenantAuthOrigin(
      context.organizationId,
    );
    const link = `${invitationOrigin}/invitations/${encodeURIComponent(token)}`;
    const invitationExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60_000);
    const { member, invitation } = await db.transaction(async (tx) => {
      const [current] = await tx
        .select({
          id: users.id,
          email: users.email,
          role: users.role,
          status: users.status,
        })
        .from(users)
        .where(
          and(
            eq(users.id, id),
            eq(users.organizationId, context.organizationId),
          ),
        )
        .limit(1)
        .for("update");
      if (!current) throw new ApiError(404, "not_found", "Mitglied nicht gefunden.");
      if (current.role !== "member" || current.status !== "invited") {
        throw new ApiError(
          403,
          "forbidden",
          "Einladungen duerfen nur fuer eingeladene Mitgliedskonten neu ausgestellt werden.",
        );
      }
      await tx
        .update(invitations)
        .set({ acceptedAt: new Date() })
        .where(
          and(
            eq(invitations.userId, current.id),
            isNull(invitations.acceptedAt),
          ),
        );
      const [createdInvitation] = await tx
        .insert(invitations)
        .values({
          organizationId: context.organizationId,
          userId: current.id,
          email: current.email,
          tokenHash: hashOpaqueToken(token),
          expiresAt: invitationExpiresAt,
        })
        .returning();
      await deliverAuthLink(
        {
          organizationId: context.organizationId,
          userId: current.id,
          event: "invitation.created",
          email: current.email,
          link,
        },
        tx,
      );
      return { member: current, invitation: createdInvitation };
    });
    return { data: { memberId: member.id, token, link, expiresAt: invitation.expiresAt }, resourceId: member.id, meta: { invitationTokenShownOnce: true } };
  });
}
