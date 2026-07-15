import {
  apiOptions,
  handleTransactionalApiCommand,
  parseJson,
} from "@/lib/api/handler";
import {
  courseModuleAccessOverrideDeleteSchema,
  courseModuleAccessOverrideSchema,
} from "@/lib/api/schemas";
import {
  deleteCourseModuleAccessOverrideInTransaction,
  upsertCourseModuleAccessOverrideInTransaction,
} from "@/lib/course-module-access-service";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

type AccessOverrideParams = {
  params: Promise<{ id: string; moduleId: string; userId: string }>;
};

export async function PUT(request: Request, { params }: AccessOverrideParams) {
  const { id, moduleId, userId } = await params;
  return handleTransactionalApiCommand(
    request,
    {
      scopes: ["courses:write"],
      action: "course.module_access_override.save",
      resourceType: "course_module_access_override",
      idempotent: true,
    },
    {
      prepare: () => parseJson(request, courseModuleAccessOverrideSchema),
      execute: async ({ context, tx, activity }, input) => {
        const saved = await upsertCourseModuleAccessOverrideInTransaction(tx, {
          organizationId: context.organizationId,
          actorId: input.actorId,
          courseId: id,
          moduleId,
          userId,
          state: input.state,
          reason: input.reason,
          expiresAt: input.expiresAt,
        });
        await activity({
          userId: input.actorId,
          type: "course_module.access_override_saved",
          entityType: "course_module_access_override",
          entityId: saved.override.id,
          metadata: {
            courseId: id,
            moduleId,
            memberId: userId,
            state: input.state,
            expiresAt: input.expiresAt?.toISOString() ?? null,
          },
        });
        return { data: saved.override, resourceId: saved.override.id };
      },
    },
  );
}

export async function DELETE(
  request: Request,
  { params }: AccessOverrideParams,
) {
  const { id, moduleId, userId } = await params;
  return handleTransactionalApiCommand(
    request,
    {
      scopes: ["courses:write"],
      action: "course.module_access_override.delete",
      resourceType: "course_module_access_override",
      idempotent: true,
    },
    {
      prepare: () => parseJson(request, courseModuleAccessOverrideDeleteSchema),
      execute: async ({ context, tx, activity }, input) => {
        const deleted = await deleteCourseModuleAccessOverrideInTransaction(tx, {
          organizationId: context.organizationId,
          actorId: input.actorId,
          courseId: id,
          moduleId,
          userId,
        });
        await activity({
          userId: input.actorId,
          type: "course_module.access_override_deleted",
          entityType: "course_module_access_override",
          entityId: deleted.id,
          metadata: { courseId: id, moduleId, memberId: userId },
        });
        return { data: deleted, resourceId: deleted.id };
      },
    },
  );
}
