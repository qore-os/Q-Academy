import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  announcementDismissals,
  announcementInteractions,
  users,
} from "@/db/schema";
import { getAnnouncementForOrganization } from "@/lib/announcements";
import { ApiError } from "@/lib/api/errors";
import { apiOptions, handleApi } from "@/lib/api/handler";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

type RouteParams = { params: Promise<{ id: string; userId: string }> };

async function assertUser(userId: string, organizationId: string) {
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.organizationId, organizationId)))
    .limit(1);
  if (!user) throw new ApiError(404, "not_found", "Mitglied nicht gefunden.");
}

export async function PUT(request: Request, { params }: RouteParams) {
  const { id, userId } = await params;
  return handleApi(
    request,
    {
      scopes: ["notifications:write"],
      action: "announcement.dismissal.create",
      resourceType: "announcement",
      idempotent: true,
    },
    async (context) => {
      await Promise.all([
        getAnnouncementForOrganization(id, context.organizationId),
        assertUser(userId, context.organizationId),
      ]);
      const dismissal = await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(announcementDismissals)
          .values({ announcementId: id, userId })
          .onConflictDoUpdate({
            target: [
              announcementDismissals.announcementId,
              announcementDismissals.userId,
            ],
            set: { dismissedAt: new Date() },
          })
          .returning();
        await tx
          .insert(announcementInteractions)
          .values({
            organizationId: context.organizationId,
            announcementId: id,
            userId,
            kind: "dismiss",
          })
          .onConflictDoNothing();
        return row;
      });
      return { data: dismissal, resourceId: id };
    },
  );
}

export async function DELETE(request: Request, { params }: RouteParams) {
  const { id, userId } = await params;
  return handleApi(
    request,
    {
      scopes: ["notifications:write"],
      action: "announcement.dismissal.delete",
      resourceType: "announcement",
      idempotent: true,
    },
    async (context) => {
      await Promise.all([
        getAnnouncementForOrganization(id, context.organizationId),
        assertUser(userId, context.organizationId),
      ]);
      await db
        .delete(announcementDismissals)
        .where(
          and(
            eq(announcementDismissals.announcementId, id),
            eq(announcementDismissals.userId, userId),
          ),
        );
      return {
        data: { announcementId: id, userId, deleted: true },
        resourceId: id,
      };
    },
  );
}
