import { and, desc, eq, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { notifications, users } from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import { apiOptions, handleApi } from "@/lib/api/handler";
import { paginationMeta, parsePagination } from "@/lib/api/pagination";
import { notificationListQuerySchema } from "@/lib/api/schemas";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

async function assertUserInOrganization(userId: string, organizationId: string) {
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, userId), eq(users.organizationId, organizationId)))
    .limit(1);
  if (!user) throw new ApiError(404, "not_found", "Mitglied nicht gefunden.");
}

export async function GET(request: Request) {
  return handleApi(
    request,
    { scopes: ["notifications:read"], action: "notification.list", resourceType: "notification" },
    async (context) => {
      const url = new URL(request.url);
      const input = notificationListQuerySchema.parse({
        userId: url.searchParams.get("userId"),
        unread: url.searchParams.get("unread") ?? undefined,
      });
      const pagination = parsePagination(url);
      await assertUserInOrganization(input.userId, context.organizationId);

      const conditions: SQL[] = [eq(notifications.userId, input.userId)];
      if (input.unread !== undefined) conditions.push(eq(notifications.read, !input.unread));

      const rows = await db
        .select({
          id: notifications.id,
          userId: notifications.userId,
          title: notifications.title,
          body: notifications.body,
          type: notifications.type,
          category: notifications.category,
          href: notifications.href,
          read: notifications.read,
          createdAt: notifications.createdAt,
        })
        .from(notifications)
        .innerJoin(
          users,
          and(eq(users.id, notifications.userId), eq(users.organizationId, context.organizationId)),
        )
        .where(and(...conditions))
        .orderBy(desc(notifications.createdAt), desc(notifications.id))
        .limit(pagination.limit + 1)
        .offset(pagination.offset);
      const hasMore = rows.length > pagination.limit;
      const data = hasMore ? rows.slice(0, pagination.limit) : rows;

      return { data, meta: { pagination: paginationMeta(pagination, data.length, hasMore) } };
    },
  );
}
