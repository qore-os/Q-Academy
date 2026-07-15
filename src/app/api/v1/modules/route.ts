import { and, asc, desc, eq, ilike, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { modules } from "@/db/schema";
import {
  apiOptions,
  handleApi,
  handleTransactionalApiCommand,
  parseJson,
} from "@/lib/api/handler";
import { paginationMeta, parsePagination } from "@/lib/api/pagination";
import { moduleCreateSchema } from "@/lib/api/schemas";
import { createModuleWithStructure } from "@/lib/module-creation-service";
import { ApiError } from "@/lib/api/errors";
import {
  getTenantLinkTarget,
  lockCourseLinkGraph,
} from "@/lib/course-link-service";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

export async function GET(request: Request) {
  return handleApi(request, { scopes: ["modules:read"], action: "module.list", resourceType: "module" }, async (context) => {
    const url = new URL(request.url);
    const pagination = parsePagination(url);
    const conditions: SQL[] = [eq(modules.organizationId, context.organizationId)];
    const search = url.searchParams.get("search")?.trim();
    const folder = url.searchParams.get("folder")?.trim();
    const kind = url.searchParams.get("kind")?.trim();
    if (kind && kind !== "learning" && kind !== "exam" && kind !== "link") {
      throw new ApiError(400, "validation_error", "Modultyp ist ungueltig.");
    }
    if (search) conditions.push(ilike(modules.title, `%${search}%`));
    if (folder) conditions.push(eq(modules.folder, folder));
    if (kind === "learning" || kind === "exam" || kind === "link") {
      conditions.push(eq(modules.kind, kind));
    }
    const rows = await db
      .select()
      .from(modules)
      .where(and(...conditions))
      .orderBy(asc(modules.folder), asc(modules.title), desc(modules.updatedAt))
      .limit(pagination.limit + 1)
      .offset(pagination.offset);
    const hasMore = rows.length > pagination.limit;
    const data = hasMore ? rows.slice(0, pagination.limit) : rows;
    return { data, meta: { pagination: paginationMeta(pagination, data.length, hasMore) } };
  });
}

export async function POST(request: Request) {
  return handleTransactionalApiCommand(
    request,
    { scopes: ["modules:write"], action: "module.create", resourceType: "module", idempotent: true },
    {
      prepare: () => parseJson(request, moduleCreateSchema),
      execute: async ({ context, tx, activity }, input) => {
        if (input.kind === "link" && input.linkedCourseId) {
          await lockCourseLinkGraph(tx, context.organizationId);
          await getTenantLinkTarget(tx, {
            organizationId: context.organizationId,
            targetCourseId: input.linkedCourseId,
          });
        }
        const structure = await createModuleWithStructure(tx, {
          organizationId: context.organizationId,
          title: input.title,
          kind: input.kind,
          linkedCourseId: input.linkedCourseId,
          description: input.description ?? null,
          folder: input.folder,
          isReusable: input.isReusable,
          estimatedMinutes: input.estimatedMinutes,
        });
        await activity({
          type: "module.created",
          entityType: "module",
          entityId: structure.learningModule.id,
          metadata: {
            kind: input.kind,
            linkedCourseId: input.linkedCourseId,
            lessonId: structure.lesson?.id ?? null,
          },
        });
        return {
          data: {
            ...structure.learningModule,
            examLessonId: structure.lesson?.id ?? null,
            firstPageId: structure.page?.id ?? null,
          },
          status: 201,
          resourceId: structure.learningModule.id,
        };
      },
    },
  );
}
