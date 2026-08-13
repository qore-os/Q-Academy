import { courseSectionGone } from "@/lib/api/deprecated-course-sections";
import { apiOptions, handleApi } from "@/lib/api/handler";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

async function update(request: Request) {
  return handleApi(
    request,
    {
      scopes: ["modules:write"],
      action: "section.lesson_visibility.update",
      resourceType: "section",
    },
    async () => {
      throw courseSectionGone();
    },
  );
}

export const PATCH = update;
export const PUT = update;
