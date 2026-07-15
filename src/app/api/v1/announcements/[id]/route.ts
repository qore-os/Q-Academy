import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { announcements } from "@/db/schema";
import {
  assertAnnouncementAudience,
  assertAnnouncementTargetRuleSetTargets,
  getAnnouncementForOrganization,
  validateAnnouncementConfiguration,
  type AnnouncementAudience,
} from "@/lib/announcements";
import { apiOptions, handleApi, parseJson } from "@/lib/api/handler";
import { announcementUpdateSchema } from "@/lib/api/schemas";
import { enqueueWebhook } from "@/lib/api/webhooks";
import { ApiError } from "@/lib/api/errors";
import { validateTenantPersonalizedTexts } from "@/lib/member-properties";
import {
  announcementContentDocumentSchema,
  announcementContentFromLegacy,
  announcementContentPersonalizationValues,
  announcementContentToLegacyProjection,
  normalizeAnnouncementContent,
} from "@/lib/announcement-content";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: RouteParams) {
  const { id } = await params;
  return handleApi(
    request,
    {
      scopes: ["notifications:read"],
      action: "announcement.read",
      resourceType: "announcement",
    },
    async (context) => ({
      data: await getAnnouncementForOrganization(id, context.organizationId),
      resourceId: id,
    }),
  );
}

export async function PATCH(request: Request, { params }: RouteParams) {
  const { id } = await params;
  return handleApi(
    request,
    {
      scopes: ["notifications:write"],
      action: "announcement.update",
      resourceType: "announcement",
      idempotent: true,
    },
    async (context) => {
      const current = await getAnnouncementForOrganization(
        id,
        context.organizationId,
      );
      const input = await parseJson(request, announcementUpdateSchema);
      const audience = (input.audience ??
        current.audience) as AnnouncementAudience;
      const audienceId =
        audience === "all" ? null : (input.audienceId ?? current.audienceId);
      const targetRuleSet = input.targetRuleSet ?? current.targetRuleSet;
      const legacyContentChanged =
        input.body !== undefined ||
        input.href !== undefined ||
        input.actionLabel !== undefined;
      const contentChanged =
        input.contentDocument !== undefined || legacyContentChanged;
      const contentDocument = input.contentDocument
        ? announcementContentDocumentSchema.parse(input.contentDocument)
        : legacyContentChanged
          ? announcementContentDocumentSchema.parse(
              announcementContentFromLegacy({
                body: input.body ?? current.body,
                href:
                  input.href === undefined ? current.href : (input.href ?? null),
                actionLabel:
                  input.actionLabel === undefined
                    ? current.actionLabel
                    : (input.actionLabel ?? null),
              }),
            )
          : normalizeAnnouncementContent(current);
      const legacyContent = contentChanged
        ? announcementContentToLegacyProjection(contentDocument)
        : {
            body: current.body,
            href: current.href,
            actionLabel: current.actionLabel,
          };
      const configuration = {
        startsAt: input.startsAt ?? current.startsAt,
        endsAt:
          input.endsAt === undefined ? current.endsAt : (input.endsAt ?? null),
        href: legacyContent.href,
        actionLabel: legacyContent.actionLabel,
        placement: input.placement ?? current.placement,
        dismissible: input.dismissible ?? current.dismissible,
      };
      await assertAnnouncementAudience(
        context.organizationId,
        audience,
        audienceId,
      );
      await assertAnnouncementTargetRuleSetTargets(
        context.organizationId,
        targetRuleSet,
      );
      validateAnnouncementConfiguration(configuration);
      const personalizationError = await validateTenantPersonalizedTexts({
        organizationId: context.organizationId,
        values: [
          input.title ?? current.title,
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
      const [updated] = await db
        .update(announcements)
        .set({
          ...input,
          ...(contentChanged
            ? {
                ...legacyContent,
                contentDocument,
              }
            : {}),
          audience,
          audienceId,
          targetRuleSet,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(announcements.id, id),
            eq(announcements.organizationId, context.organizationId),
          ),
        )
        .returning();
      await enqueueWebhook(
        context.organizationId,
        "announcement.updated",
        updated,
      );
      return { data: updated, resourceId: id };
    },
  );
}

export async function DELETE(request: Request, { params }: RouteParams) {
  const { id } = await params;
  return handleApi(
    request,
    {
      scopes: ["notifications:write"],
      action: "announcement.delete",
      resourceType: "announcement",
      idempotent: true,
    },
    async (context) => {
      const current = await getAnnouncementForOrganization(
        id,
        context.organizationId,
      );
      await db
        .delete(announcements)
        .where(
          and(
            eq(announcements.id, id),
            eq(announcements.organizationId, context.organizationId),
          ),
        );
      await enqueueWebhook(context.organizationId, "announcement.updated", {
        ...current,
        mutation: "deleted",
      });
      return { data: { id, deleted: true }, resourceId: id };
    },
  );
}
