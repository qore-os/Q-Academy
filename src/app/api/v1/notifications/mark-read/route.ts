import { and, eq, inArray, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { notifications, users } from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import { apiOptions, handleApi, parseJson } from "@/lib/api/handler";
import { notificationBulkMarkReadSchema } from "@/lib/api/schemas";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

export async function POST(request: Request) {
  return handleApi(
    request,
    {
      scopes: ["notifications:write"],
      action: "notification.bulk_mark_read",
      resourceType: "notification",
      idempotent: true,
    },
    async (context) => {
      const input = await parseJson(request, notificationBulkMarkReadSchema);
      const marked = await db.transaction(async (tx) => {
        const [user] = await tx
          .select({ id: users.id })
          .from(users)
          .where(and(eq(users.id, input.userId), eq(users.organizationId, context.organizationId)))
          .limit(1);
        if (!user) throw new ApiError(404, "not_found", "Mitglied nicht gefunden.");

        const conditions: SQL[] = [eq(notifications.userId, user.id), eq(notifications.read, false)];
        conditions.push(
          inArray(
            notifications.userId,
            tx
              .select({ id: users.id })
              .from(users)
              .where(and(eq(users.id, user.id), eq(users.organizationId, context.organizationId))),
          ),
        );
        if (input.notificationIds) conditions.push(inArray(notifications.id, input.notificationIds));

        return tx
          .update(notifications)
          .set({ read: true })
          .where(and(...conditions))
          .returning({ id: notifications.id });
      });

      return {
        data: {
          userId: input.userId,
          markedRead: marked.length,
          notificationIds: marked.map((notification) => notification.id),
        },
      };
    },
  );
}
