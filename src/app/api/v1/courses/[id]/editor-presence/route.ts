import { handleApi, apiOptions } from "@/lib/api/handler";
import { listEditorPresencesForApi } from "@/lib/editor-presence-service";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return handleApi(
    request,
    {
      scopes: ["modules:read"],
      action: "editor_presence.list",
      resourceType: "course",
    },
    async (context) => ({
      data: {
        presence: await listEditorPresencesForApi(context.organizationId, id),
      },
      resourceId: id,
    }),
  );
}
