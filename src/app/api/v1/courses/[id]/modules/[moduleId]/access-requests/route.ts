import {
  apiOptions,
  handleApi,
  handleTransactionalApiCommand,
  parseJson,
} from "@/lib/api/handler";
import {
  courseModuleAccessRequestCreateSchema,
  courseModuleAccessRequestListQuerySchema,
} from "@/lib/api/schemas";
import {
  createCourseModuleAccessRequestInTransaction,
  listCourseModuleAccessRequests,
} from "@/lib/course-module-access-service";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

type AccessRequestParams = {
  params: Promise<{ id: string; moduleId: string }>;
};

export async function GET(request: Request, { params }: AccessRequestParams) {
  const { id, moduleId } = await params;
  return handleApi(
    request,
    {
      scopes: ["courses:read"],
      action: "course.module_access_request.list",
      resourceType: "course_module_access_request",
    },
    async (context) => {
      const url = new URL(request.url);
      const query = courseModuleAccessRequestListQuerySchema.parse({
        status: url.searchParams.get("status") || undefined,
        userId: url.searchParams.get("userId") || undefined,
      });
      return {
        data: await listCourseModuleAccessRequests({
          organizationId: context.organizationId,
          courseId: id,
          moduleId,
          ...query,
        }),
        resourceId: id,
      };
    },
  );
}

export async function POST(request: Request, { params }: AccessRequestParams) {
  const { id, moduleId } = await params;
  return handleTransactionalApiCommand(
    request,
    {
      scopes: ["courses:write"],
      action: "course.module_access_request.create",
      resourceType: "course_module_access_request",
      idempotent: true,
    },
    {
      prepare: () => parseJson(request, courseModuleAccessRequestCreateSchema),
      execute: async ({ context, tx, activity }, input) => {
        const created = await createCourseModuleAccessRequestInTransaction(tx, {
          organizationId: context.organizationId,
          courseId: id,
          moduleId,
          userId: input.userId,
          message: input.message,
        });
        await activity({
          userId: input.userId,
          type: "course_module.access_requested",
          entityType: "course_module_access_request",
          entityId: created.request.id,
          metadata: { courseId: id, moduleId },
        });
        return {
          data: created.request,
          status: 201,
          resourceId: created.request.id,
        };
      },
    },
  );
}
