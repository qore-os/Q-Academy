import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { activityEvents, courseModules, courses, modules } from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import { apiOptions, handleApi, parseJson } from "@/lib/api/handler";
import { courseModuleAttachSchema } from "@/lib/api/schemas";
import {
  getCourseLinkTarget,
  lockCourseLinkGraph,
} from "@/lib/course-link-service";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

async function assertCourse(id: string, organizationId: string) {
  const [course] = await db.select({ id: courses.id }).from(courses).where(and(eq(courses.id, id), eq(courses.organizationId, organizationId))).limit(1);
  if (!course) throw new ApiError(404, "not_found", "Kurs nicht gefunden.");
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleApi(request, { scopes: ["courses:read", "modules:read"], action: "course.module.list", resourceType: "course" }, async (context) => {
    await assertCourse(id, context.organizationId);
    const data = await db
      .select({
        id: modules.id,
        title: modules.title,
        kind: modules.kind,
        linkedCourseId: modules.linkedCourseId,
        description: modules.description,
        folder: modules.folder,
        isReusable: modules.isReusable,
        estimatedMinutes: modules.estimatedMinutes,
        sortOrder: courseModules.sortOrder,
        indentLevel: courseModules.indentLevel,
        accessMode: courseModules.accessMode,
        dripDays: courseModules.dripDays,
        delayPendingState: courseModules.delayPendingState,
        availableFrom: courseModules.availableFrom,
        availableUntil: courseModules.availableUntil,
        windowDefaultState: courseModules.windowDefaultState,
        windowState: courseModules.windowState,
        requestAccessEnabled: courseModules.requestAccessEnabled,
        isRequired: courseModules.isRequired,
      })
      .from(courseModules)
      .innerJoin(modules, eq(modules.id, courseModules.moduleId))
      .where(and(eq(courseModules.courseId, id), eq(modules.organizationId, context.organizationId)))
      .orderBy(asc(courseModules.sortOrder));
    return { data, resourceId: id };
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleApi(request, { scopes: ["courses:write", "modules:read"], action: "course.module.attach", resourceType: "course", idempotent: true }, async (context) => {
    const input = await parseJson(request, courseModuleAttachSchema);
    const association = await db.transaction(async (tx) => {
      await lockCourseLinkGraph(tx, context.organizationId);
      const [course] = await tx
        .select({ id: courses.id })
        .from(courses)
        .where(
          and(
            eq(courses.id, id),
            eq(courses.organizationId, context.organizationId),
          ),
        )
        .limit(1);
      if (!course) throw new ApiError(404, "not_found", "Kurs nicht gefunden.");
      const [learningModule] = await tx
        .select({
          id: modules.id,
          kind: modules.kind,
          linkedCourseId: modules.linkedCourseId,
        })
        .from(modules)
        .where(
          and(
            eq(modules.id, input.moduleId),
            eq(modules.organizationId, context.organizationId),
          ),
        )
        .limit(1);
      if (!learningModule) {
        throw new ApiError(404, "not_found", "Modul nicht gefunden.");
      }
      if (learningModule.kind === "link") {
        if (!learningModule.linkedCourseId) {
          throw new ApiError(409, "conflict", "Link-Ziel fehlt.");
        }
        if (input.isRequired) {
          throw new ApiError(
            422,
            "validation_error",
            "Link-Module koennen nicht verpflichtend sein.",
          );
        }
        await getCourseLinkTarget(tx, {
          organizationId: context.organizationId,
          sourceCourseId: id,
          targetCourseId: learningModule.linkedCourseId,
          requirePublished: false,
        });
      }
      const [created] = await tx
        .insert(courseModules)
        .values({
          organizationId: context.organizationId,
          courseId: id,
          ...input,
          isRequired:
            learningModule.kind === "link" ? false : input.isRequired,
        })
        .onConflictDoUpdate({
          target: [courseModules.courseId, courseModules.moduleId],
          set: {
            sortOrder: input.sortOrder,
            indentLevel: input.indentLevel,
            accessMode: input.accessMode,
            dripDays: input.dripDays,
            delayPendingState: input.delayPendingState,
            availableFrom: input.availableFrom,
            availableUntil: input.availableUntil,
            windowDefaultState: input.windowDefaultState,
            windowState: input.windowState,
            requestAccessEnabled: input.requestAccessEnabled,
            isRequired:
              learningModule.kind === "link" ? false : input.isRequired,
          },
        })
        .returning();
      await tx.insert(activityEvents).values({
        organizationId: context.organizationId,
        userId: null,
        type: "course.module.attached",
        entityType: "module",
        entityId: learningModule.id,
        metadata: {
          source: "api",
          apiKeyId: context.apiKeyId,
          courseId: id,
          kind: learningModule.kind,
        },
      });
      return created;
    });
    return { data: association, status: 201, resourceId: id };
  });
}
