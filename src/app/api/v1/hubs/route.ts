import { and, asc, desc, eq, ilike, or, type SQL } from "drizzle-orm";

import { db } from "@/db";
import { hubs } from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import { apiOptions, handleApi, parseJson } from "@/lib/api/handler";
import { paginationMeta, parsePagination } from "@/lib/api/pagination";
import { hubCreateSchema } from "@/lib/api/schemas";
import { enqueueWebhook } from "@/lib/api/webhooks";
import { slugify } from "@/lib/utils";
import { lockHubLayoutFormsForMutation } from "@/lib/data-form-embedding";
import { assertPublishedAiAgentHubLayout } from "@/lib/hub-ai-agent-embedding";
import { publicHubRecord } from "@/lib/hub-layout";
import { validateTenantPersonalizedTexts } from "@/lib/member-properties";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

export async function GET(request: Request) {
  return handleApi(
    request,
    { scopes: ["hubs:read"], action: "hub.list", resourceType: "hub" },
    async (context) => {
      const url = new URL(request.url);
      const pagination = parsePagination(url);
      const conditions: SQL[] = [eq(hubs.organizationId, context.organizationId)];
      const search = url.searchParams.get("search")?.trim();
      const status = url.searchParams.get("status");

      if (search) {
        conditions.push(
          or(
            ilike(hubs.title, `%${search}%`),
            ilike(hubs.slug, `%${search}%`),
            ilike(hubs.description, `%${search}%`),
          )!,
        );
      }
      if (status && ["draft", "published", "archived"].includes(status)) {
        conditions.push(eq(hubs.status, status as "draft" | "published" | "archived"));
      }

      const sort = url.searchParams.get("sort") ?? "createdAt:desc";
      const order =
        sort === "title:asc"
          ? asc(hubs.title)
          : sort === "title:desc"
            ? desc(hubs.title)
            : sort === "createdAt:asc"
              ? asc(hubs.createdAt)
              : desc(hubs.createdAt);
      const rows = await db
        .select({
          id: hubs.id,
          title: hubs.title,
          slug: hubs.slug,
          description: hubs.description,
          status: hubs.status,
          layout: hubs.layout,
          createdAt: hubs.createdAt,
        })
        .from(hubs)
        .where(and(...conditions))
        .orderBy(order, asc(hubs.id))
        .limit(pagination.limit + 1)
        .offset(pagination.offset);
      const hasMore = rows.length > pagination.limit;
      const data = (hasMore ? rows.slice(0, pagination.limit) : rows).map(
        publicHubRecord,
      );

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
    { scopes: ["hubs:write"], action: "hub.create", resourceType: "hub", idempotent: true },
    async (context) => {
      const input = await parseJson(request, hubCreateSchema);
      const slug = input.slug ?? (slugify(input.title) || `hub-${crypto.randomUUID().slice(0, 8)}`);
      const [existing] = await db
        .select({ id: hubs.id })
        .from(hubs)
        .where(and(eq(hubs.organizationId, context.organizationId), eq(hubs.slug, slug)))
        .limit(1);
      if (existing) {
        throw new ApiError(409, "conflict", "Ein Hub mit diesem Slug existiert bereits.", {
          field: "slug",
        });
      }

      const hub = await db.transaction(async (tx) => {
        const personalizationError = await validateTenantPersonalizedTexts({
          organizationId: context.organizationId,
          values: input.layout.flatMap((row) =>
            row.columns.flatMap((widget) => [
              widget.title,
              ...(widget.type === "code" ? [] : [widget.description ?? ""]),
            ]),
          ),
          staticTokens: [
            "member.firstName",
            "member.lastName",
            "member.fullName",
            "course.title",
            "course.progress",
          ],
          reader: tx,
        });
        if (personalizationError) {
          throw new ApiError(422, "validation_error", personalizationError);
        }
        if (
          !(await lockHubLayoutFormsForMutation(
            input.layout,
            context.organizationId,
            tx,
          ))
        ) {
          throw new ApiError(
            422,
            "validation_error",
            "Hub-Formular ist nicht verfuegbar.",
          );
        }
        await assertPublishedAiAgentHubLayout({
          transaction: tx,
          organizationId: context.organizationId,
          layout: input.layout,
        });
        const [created] = await tx
          .insert(hubs)
          .values({ ...input, slug, organizationId: context.organizationId })
          .returning();
        return created;
      });
      const publicHub = publicHubRecord(hub);
      await enqueueWebhook(context.organizationId, "hub.updated", {
        ...publicHub,
        mutation: "created",
      });

      return { data: publicHub, status: 201, resourceId: hub.id };
    },
  );
}
