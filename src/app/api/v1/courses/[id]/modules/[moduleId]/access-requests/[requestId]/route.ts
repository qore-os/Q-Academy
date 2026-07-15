import {
  apiOptions,
  handleTransactionalApiCommand,
  parseJson,
} from "@/lib/api/handler";
import {
  courseModuleAccessRequestCancelSchema,
  courseModuleAccessRequestDecisionSchema,
} from "@/lib/api/schemas";
import {
  cancelCourseModuleAccessRequestInTransaction,
  decideCourseModuleAccessRequestInTransaction,
} from "@/lib/course-module-access-service";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

type AccessRequestItemParams = {
  params: Promise<{ id: string; moduleId: string; requestId: string }>;
};

export async function PATCH(
  request: Request,
  { params }: AccessRequestItemParams,
) {
  const { id, moduleId, requestId } = await params;
  return handleTransactionalApiCommand(
    request,
    {
      scopes: ["courses:write"],
      action: "course.module_access_request.decide",
      resourceType: "course_module_access_request",
      idempotent: true,
    },
    {
      prepare: () => parseJson(request, courseModuleAccessRequestDecisionSchema),
      execute: async ({ context, tx, activity }, input) => {
        const decided = await decideCourseModuleAccessRequestInTransaction(tx, {
          organizationId: context.organizationId,
          requestId,
          actorId: input.actorId,
          decision: input.decision,
          decisionNote: input.decisionNote,
          expiresAt: input.expiresAt,
          expectedCourseId: id,
          expectedModuleId: moduleId,
        });
        await activity({
          userId: input.actorId,
          type: decided.stale
            ? "course_module.access_request_stale_rejected"
            : input.decision === "approved"
              ? "course_module.access_request_approved"
              : "course_module.access_request_rejected",
          entityType: "course_module_access_request",
          entityId: decided.request.id,
          metadata: {
            courseId: id,
            moduleId,
            memberId: decided.request.userId,
            overrideId: decided.override?.id ?? null,
          },
        });
        return { data: decided, resourceId: decided.request.id };
      },
    },
  );
}

export async function DELETE(
  request: Request,
  { params }: AccessRequestItemParams,
) {
  const { id, moduleId, requestId } = await params;
  return handleTransactionalApiCommand(
    request,
    {
      scopes: ["courses:write"],
      action: "course.module_access_request.withdraw",
      resourceType: "course_module_access_request",
      idempotent: true,
    },
    {
      prepare: () => parseJson(request, courseModuleAccessRequestCancelSchema),
      execute: async ({ context, tx, activity }, input) => {
        const cancelled = await cancelCourseModuleAccessRequestInTransaction(tx, {
          organizationId: context.organizationId,
          requestId,
          userId: input.userId,
          courseId: id,
          moduleId,
        });
        await activity({
          userId: input.userId,
          type: "course_module.access_request_withdrawn",
          entityType: "course_module_access_request",
          entityId: cancelled.id,
          metadata: { courseId: id, moduleId },
        });
        return { data: cancelled, resourceId: cancelled.id };
      },
    },
  );
}
