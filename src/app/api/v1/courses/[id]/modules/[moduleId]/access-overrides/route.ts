import { apiOptions, handleApi } from "@/lib/api/handler";
import { listCourseModuleAccessOverrides } from "@/lib/course-module-access-service";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; moduleId: string }> },
) {
  const { id, moduleId } = await params;
  return handleApi(
    request,
    {
      scopes: ["courses:read"],
      action: "course.module_access_override.list",
      resourceType: "course_module_access_override",
    },
    async (context) => ({
      data: await listCourseModuleAccessOverrides({
        organizationId: context.organizationId,
        courseId: id,
        moduleId,
      }),
      resourceId: id,
    }),
  );
}
