import { courseSectionGone } from "@/lib/api/deprecated-course-sections";
import { apiOptions, handleApi } from "@/lib/api/handler";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

export async function GET(request: Request) {
  return handleApi(
    request,
    {
      scopes: ["modules:read"],
      action: "section.read",
      resourceType: "section",
    },
    async () => {
      throw courseSectionGone();
    },
  );
}

export async function PATCH(request: Request) {
  return handleApi(
    request,
    {
      scopes: ["modules:write"],
      action: "section.update",
      resourceType: "section",
    },
    async () => {
      throw courseSectionGone();
    },
  );
}

export async function DELETE(request: Request) {
  return handleApi(
    request,
    {
      scopes: ["modules:write"],
      action: "section.delete",
      resourceType: "section",
    },
    async () => {
      throw courseSectionGone();
    },
  );
}
