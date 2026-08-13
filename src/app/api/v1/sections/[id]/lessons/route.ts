import { courseSectionGone } from "@/lib/api/deprecated-course-sections";
import { apiOptions, handleApi } from "@/lib/api/handler";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

export async function GET(request: Request) {
  return handleApi(
    request,
    {
      scopes: ["modules:read"],
      action: "section.lesson.list",
      resourceType: "lesson",
    },
    async () => {
      throw courseSectionGone();
    },
  );
}

export async function POST(request: Request) {
  return handleApi(
    request,
    {
      scopes: ["modules:write"],
      action: "section.lesson.create",
      resourceType: "lesson",
    },
    async () => {
      throw courseSectionGone();
    },
  );
}
