import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { announcementDismissals, users } from "@/db/schema";
import { getAnnouncementForOrganization } from "@/lib/announcements";
import { apiOptions, handleApi } from "@/lib/api/handler";
import { paginationMeta, parsePagination } from "@/lib/api/pagination";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return handleApi(
    request,
    {
      scopes: ["notifications:read"],
      action: "announcement.dismissal.list",
      resourceType: "announcement",
    },
    async (context) => {
      await getAnnouncementForOrganization(id, context.organizationId);
      const pagination = parsePagination(new URL(request.url));
      const rows = await db
        .select({
          announcementId: announcementDismissals.announcementId,
          userId: announcementDismissals.userId,
          firstName: users.firstName,
          lastName: users.lastName,
          dismissedAt: announcementDismissals.dismissedAt,
        })
        .from(announcementDismissals)
        .innerJoin(
          users,
          and(
            eq(users.id, announcementDismissals.userId),
            eq(users.organizationId, context.organizationId),
          ),
        )
        .where(eq(announcementDismissals.announcementId, id))
        .orderBy(desc(announcementDismissals.dismissedAt))
        .limit(pagination.limit + 1)
        .offset(pagination.offset);
      const hasMore = rows.length > pagination.limit;
      const data = hasMore ? rows.slice(0, pagination.limit) : rows;
      return {
        data,
        meta: { pagination: paginationMeta(pagination, data.length, hasMore) },
        resourceId: id,
      };
    },
  );
}
