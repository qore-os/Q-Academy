import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { notifications, users } from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import { apiOptions, handleApi, parseJson } from "@/lib/api/handler";
import {
  notificationParamsSchema,
  notificationUpdateSchema,
  notificationUserSchema,
} from "@/lib/api/schemas";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

function organizationUserIds(userId: string, organizationId: string) {
  return db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.organizationId, organizationId)));
}

async function updateNotification(
  request: Request,
  params: Promise<{ id: string }>,
) {
  return handleApi(
    request,
    { scopes: ["notifications:write"], action: "notification.update", resourceType: "notification", idempotent: true },
    async (context) => {
      const { id } = notificationParamsSchema.parse(await params);
      const input = await parseJson(request, notificationUpdateSchema);
      const [notification] = await db
        .update(notifications)
        .set({ read: input.read })
        .where(
          and(
            eq(notifications.id, id),
            eq(notifications.userId, input.userId),
            inArray(notifications.userId, organizationUserIds(input.userId, context.organizationId)),
          ),
        )
        .returning();
      if (!notification) throw new ApiError(404, "not_found", "Benachrichtigung nicht gefunden.");
      return { data: notification, resourceId: notification.id };
    },
  );
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return updateNotification(request, params);
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return updateNotification(request, params);
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleApi(
    request,
    { scopes: ["notifications:write"], action: "notification.delete", resourceType: "notification" },
    async (context) => {
      const { id } = notificationParamsSchema.parse(await params);
      const url = new URL(request.url);
      const { userId } = notificationUserSchema.parse({ userId: url.searchParams.get("userId") });
      const [deleted] = await db
        .delete(notifications)
        .where(
          and(
            eq(notifications.id, id),
            eq(notifications.userId, userId),
            inArray(notifications.userId, organizationUserIds(userId, context.organizationId)),
          ),
        )
        .returning({ id: notifications.id });
      if (!deleted) throw new ApiError(404, "not_found", "Benachrichtigung nicht gefunden.");
      return { data: { id: deleted.id, deleted: true }, resourceId: deleted.id };
    },
  );
}
