import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { activityEvents, courseModules, modules } from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import { apiOptions, handleApi, parseJson } from "@/lib/api/handler";
import {
  courseModuleAccessConfigurationSchema,
  courseModuleUpdateSchema,
} from "@/lib/api/schemas";
import { lockCourseLinkGraph } from "@/lib/course-link-service";
import { normalizeCourseOutline } from "@/lib/course-outline-service";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

function rethrowCourseModuleDatabaseError(error: unknown): never {
  const directCode =
    typeof error === "object" && error !== null && "code" in error
      ? error.code
      : null;
  const cause =
    typeof error === "object" && error !== null && "cause" in error
      ? error.cause
      : null;
  const causeCode =
    typeof cause === "object" && cause !== null && "code" in cause
      ? cause.code
      : null;
  const code =
    typeof directCode === "string"
      ? directCode
      : typeof causeCode === "string"
        ? causeCode
        : null;

  if (code === "23514" || code === "23502") {
    throw new ApiError(
      422,
      "validation_error",
      "Die Modul-Zugriffskonfiguration ist nicht gueltig.",
    );
  }
  if (
    code === "23503" ||
    code === "23505" ||
    code === "40001" ||
    code === "40P01"
  ) {
    throw new ApiError(
      409,
      "conflict",
      "Die Kurs-Modul-Zuweisung wurde parallel geaendert. Bitte erneut versuchen.",
    );
  }
  throw error;
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; moduleId: string }> }) {
  const { id, moduleId } = await params;
  return handleApi(request, { scopes: ["courses:write"], action: "course.module.update", resourceType: "course", idempotent: true }, async (context) => {
      const input = await parseJson(request, courseModuleUpdateSchema);
    try {
      const association = await db.transaction(async (tx) => {
        await lockCourseLinkGraph(tx, context.organizationId);
        const [current] = await tx
          .select({ assignment: courseModules, kind: modules.kind })
          .from(courseModules)
          .innerJoin(
            modules,
            and(
              eq(modules.id, courseModules.moduleId),
              eq(modules.organizationId, courseModules.organizationId),
            ),
          )
          .where(
            and(
              eq(courseModules.organizationId, context.organizationId),
              eq(courseModules.courseId, id),
              eq(courseModules.moduleId, moduleId),
            ),
          )
          .limit(1)
          .for("update");
        if (!current) {
          throw new ApiError(
            404,
            "not_found",
            "Kurs-Modul-Zuweisung nicht gefunden.",
          );
        }
        if (current.kind === "link" && input.isRequired === true) {
          throw new ApiError(
            422,
            "validation_error",
            "Link-Module koennen nicht verpflichtend sein.",
          );
        }

        courseModuleAccessConfigurationSchema.parse({
          sortOrder: current.assignment.sortOrder,
          indentLevel: current.assignment.indentLevel,
          accessMode: current.assignment.accessMode,
          dripDays: current.assignment.dripDays,
          delayPendingState: current.assignment.delayPendingState,
          availableFrom: current.assignment.availableFrom,
          availableUntil: current.assignment.availableUntil,
          windowDefaultState: current.assignment.windowDefaultState,
          windowState: current.assignment.windowState,
          requestAccessEnabled: current.assignment.requestAccessEnabled,
          isRequired: current.assignment.isRequired,
          ...input,
        });

        const [updated] = await tx
          .update(courseModules)
          .set(input)
          .where(
            and(
              eq(courseModules.organizationId, context.organizationId),
              eq(courseModules.courseId, id),
              eq(courseModules.moduleId, moduleId),
            ),
          )
          .returning();
        if (!updated) {
          throw new ApiError(
            409,
            "conflict",
            "Die Kurs-Modul-Zuweisung wurde parallel entfernt.",
          );
        }
        await tx.insert(activityEvents).values({
          organizationId: context.organizationId,
          userId: null,
          type: "course.module.updated",
          entityType: "module",
          entityId: moduleId,
          metadata: {
            source: "api",
            apiKeyId: context.apiKeyId,
            courseId: id,
            changedFields: Object.keys(input).sort(),
          },
        });
        return updated;
      });
      return { data: association, resourceId: id };
    } catch (error) {
      rethrowCourseModuleDatabaseError(error);
    }
  });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string; moduleId: string }> }) {
  const { id, moduleId } = await params;
  return handleApi(request, { scopes: ["courses:write"], action: "course.module.detach", resourceType: "course", idempotent: true }, async (context) => {
    try {
      await db.transaction(async (tx) => {
        await lockCourseLinkGraph(tx, context.organizationId);
        const [association] = await tx
          .select({ courseId: courseModules.courseId })
          .from(courseModules)
          .where(
            and(
              eq(courseModules.organizationId, context.organizationId),
              eq(courseModules.courseId, id),
              eq(courseModules.moduleId, moduleId),
            ),
          )
          .limit(1)
          .for("update");
        if (!association) {
          throw new ApiError(
            404,
            "not_found",
            "Kurs-Modul-Zuweisung nicht gefunden.",
          );
        }

        const deleted = await tx
          .delete(courseModules)
          .where(
            and(
              eq(courseModules.organizationId, context.organizationId),
              eq(courseModules.courseId, id),
              eq(courseModules.moduleId, moduleId),
            ),
          )
          .returning({ courseId: courseModules.courseId });
        if (deleted.length !== 1) {
          throw new ApiError(
            409,
            "conflict",
            "Die Kurs-Modul-Zuweisung wurde parallel geaendert.",
          );
        }
        await normalizeCourseOutline(tx, {
          organizationId: context.organizationId,
          courseId: id,
        });
        await tx.insert(activityEvents).values({
          organizationId: context.organizationId,
          userId: null,
          type: "course.module.detached",
          entityType: "module",
          entityId: moduleId,
          metadata: {
            source: "api",
            apiKeyId: context.apiKeyId,
            courseId: id,
          },
        });
      });
      return {
        data: { courseId: id, moduleId, deleted: true },
        resourceId: id,
      };
    } catch (error) {
      rethrowCourseModuleDatabaseError(error);
    }
  });
}
