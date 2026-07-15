import { and, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { hubs } from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import { apiOptions, handleApi, parseJson } from "@/lib/api/handler";
import { hubUpdateSchema } from "@/lib/api/schemas";
import { enqueueWebhook } from "@/lib/api/webhooks";
import { lockHubLayoutFormTransitionForMutation } from "@/lib/data-form-embedding";
import { assertPublishedAiAgentHubLayout } from "@/lib/hub-ai-agent-embedding";
import { publicHubRecord } from "@/lib/hub-layout";
import { validateTenantPersonalizedTexts } from "@/lib/member-properties";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

async function hubForOrganization(id: string, organizationId: string) {
  const [hub] = await db
    .select()
    .from(hubs)
    .where(and(eq(hubs.id, id), eq(hubs.organizationId, organizationId)))
    .limit(1);
  if (!hub) throw new ApiError(404, "not_found", "Hub nicht gefunden.");
  return hub;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleApi(
    request,
    { scopes: ["hubs:read"], action: "hub.read", resourceType: "hub" },
    async (context) => ({
      data: publicHubRecord(
        await hubForOrganization(id, context.organizationId),
      ),
      resourceId: id,
    }),
  );
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleApi(
    request,
    { scopes: ["hubs:write"], action: "hub.update", resourceType: "hub", idempotent: true },
    async (context) => {
      const current = await hubForOrganization(id, context.organizationId);
      const input = await parseJson(request, hubUpdateSchema);
      if (input.slug && input.slug !== current.slug) {
        const [duplicate] = await db
          .select({ id: hubs.id })
          .from(hubs)
          .where(and(eq(hubs.organizationId, context.organizationId), eq(hubs.slug, input.slug)))
          .limit(1);
        if (duplicate) {
          throw new ApiError(409, "conflict", "Ein Hub mit diesem Slug existiert bereits.", {
            field: "slug",
          });
        }
      }

      const updated = await db.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${`hub-layout:${context.organizationId}:${id}`}))`,
        );
        const [locked] = await tx
          .select()
          .from(hubs)
          .where(
            and(
              eq(hubs.id, id),
              eq(hubs.organizationId, context.organizationId),
            ),
          )
          .limit(1)
          .for("update");
        if (!locked) {
          throw new ApiError(404, "not_found", "Hub nicht gefunden.");
        }
        const nextLayout = input.layout ?? locked.layout;
        const personalizationError = await validateTenantPersonalizedTexts({
          organizationId: context.organizationId,
          values: nextLayout.flatMap((row) =>
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
          !(await lockHubLayoutFormTransitionForMutation(
            locked.layout,
            nextLayout,
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
          layout: nextLayout,
        });
        const [record] = await tx
          .update(hubs)
          .set(input)
          .where(
            and(
              eq(hubs.id, id),
              eq(hubs.organizationId, context.organizationId),
            ),
          )
          .returning();
        return record;
      });
      if (!updated) throw new ApiError(404, "not_found", "Hub nicht gefunden.");
      const publicHub = publicHubRecord(updated);
      await enqueueWebhook(context.organizationId, "hub.updated", {
        ...publicHub,
        mutation: "updated",
      });

      return { data: publicHub, resourceId: id };
    },
  );
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleApi(
    request,
    { scopes: ["hubs:write"], action: "hub.delete", resourceType: "hub", idempotent: true },
    async (context) => {
      const deleted = await db.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${`hub-layout:${context.organizationId}:${id}`}))`,
        );
        const [current] = await tx
          .select()
          .from(hubs)
          .where(
            and(
              eq(hubs.id, id),
              eq(hubs.organizationId, context.organizationId),
            ),
          )
          .limit(1)
          .for("update");
        if (!current) {
          throw new ApiError(404, "not_found", "Hub nicht gefunden.");
        }
        await lockHubLayoutFormTransitionForMutation(
          current.layout,
          [],
          context.organizationId,
          tx,
        );
        const [record] = await tx
          .delete(hubs)
          .where(
            and(
              eq(hubs.id, id),
              eq(hubs.organizationId, context.organizationId),
            ),
          )
          .returning();
        return record ? { current, record } : null;
      });
      if (!deleted) throw new ApiError(404, "not_found", "Hub nicht gefunden.");
      await enqueueWebhook(context.organizationId, "hub.updated", {
        ...publicHubRecord(deleted.current),
        mutation: "deleted",
      });

      return { data: { id, deleted: true }, resourceId: id };
    },
  );
}
