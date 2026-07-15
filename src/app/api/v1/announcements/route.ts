import { and, desc, eq, ilike, or, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { announcements } from "@/db/schema";
import {
  assertAnnouncementAudience,
  assertAnnouncementTargetRuleSetTargets,
  validateAnnouncementConfiguration,
} from "@/lib/announcements";
import { apiOptions, handleApi, parseJson } from "@/lib/api/handler";
import { paginationMeta, parsePagination } from "@/lib/api/pagination";
import { announcementCreateSchema } from "@/lib/api/schemas";
import { enqueueWebhook } from "@/lib/api/webhooks";
import { ApiError } from "@/lib/api/errors";
import { validateTenantPersonalizedTexts } from "@/lib/member-properties";
import {
  announcementContentDocumentSchema,
  announcementContentFromLegacy,
  announcementContentPersonalizationValues,
  announcementContentToLegacyProjection,
} from "@/lib/announcement-content";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

export async function GET(request: Request) {
  return handleApi(
    request,
    {
      scopes: ["notifications:read"],
      action: "announcement.list",
      resourceType: "announcement",
    },
    async (context) => {
      const url = new URL(request.url);
      const pagination = parsePagination(url);
      const conditions: SQL[] = [
        eq(announcements.organizationId, context.organizationId),
      ];
      const search = url.searchParams.get("search")?.trim();
      const active = url.searchParams.get("active");
      const audience = url.searchParams.get("audience");
      const placement = url.searchParams.get("placement");
      if (search) {
        conditions.push(
          or(
            ilike(announcements.title, `%${search}%`),
            ilike(announcements.body, `%${search}%`),
          )!,
        );
      }
      if (active === "true" || active === "false") {
        conditions.push(eq(announcements.active, active === "true"));
      }
      if (["all", "user", "group"].includes(audience ?? "")) {
        conditions.push(eq(announcements.audience, audience!));
      }
      if (["banner", "modal"].includes(placement ?? "")) {
        conditions.push(eq(announcements.placement, placement!));
      }

      const rows = await db
        .select()
        .from(announcements)
        .where(and(...conditions))
        .orderBy(desc(announcements.createdAt), desc(announcements.id))
        .limit(pagination.limit + 1)
        .offset(pagination.offset);
      const hasMore = rows.length > pagination.limit;
      const data = hasMore ? rows.slice(0, pagination.limit) : rows;
      return {
        data,
        meta: { pagination: paginationMeta(pagination, data.length, hasMore) },
      };
    },
  );
}

export async function POST(request: Request) {
  return handleApi(
    request,
    {
      scopes: ["notifications:write"],
      action: "announcement.create",
      resourceType: "announcement",
      idempotent: true,
    },
    async (context) => {
      const input = await parseJson(request, announcementCreateSchema);
      const contentDocument = announcementContentDocumentSchema.parse(
        input.contentDocument ??
          announcementContentFromLegacy({
            body: input.body ?? "",
            href: input.href,
            actionLabel: input.actionLabel,
          }),
      );
      const legacyContent = announcementContentToLegacyProjection(
        contentDocument,
      );
      await assertAnnouncementAudience(
        context.organizationId,
        input.audience,
        input.audienceId,
      );
      await assertAnnouncementTargetRuleSetTargets(
        context.organizationId,
        input.targetRuleSet,
      );
      validateAnnouncementConfiguration({
        startsAt: input.startsAt,
        endsAt: input.endsAt ?? null,
        href: legacyContent.href,
        actionLabel: legacyContent.actionLabel,
        placement: input.placement,
        dismissible: input.dismissible,
      });
      const personalizationError = await validateTenantPersonalizedTexts({
        organizationId: context.organizationId,
        values: [
          input.title,
          ...announcementContentPersonalizationValues(contentDocument),
        ],
        staticTokens: [
          "member.firstName",
          "member.lastName",
          "member.fullName",
        ],
      });
      if (personalizationError) {
        throw new ApiError(422, "validation_error", personalizationError);
      }
      const [announcement] = await db
        .insert(announcements)
        .values({
          ...input,
          ...legacyContent,
          contentDocument,
          organizationId: context.organizationId,
          audienceId: input.audience === "all" ? null : input.audienceId,
        })
        .returning();
      await enqueueWebhook(
        context.organizationId,
        "announcement.created",
        announcement,
      );
      return {
        data: announcement,
        status: 201,
        resourceId: announcement.id,
      };
    },
  );
}
