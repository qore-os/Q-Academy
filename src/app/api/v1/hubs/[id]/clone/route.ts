import { ApiError } from "@/lib/api/errors";
import {
  apiOptions,
  handleTransactionalApiCommand,
  parseJson,
} from "@/lib/api/handler";
import { hubCloneSchema } from "@/lib/api/schemas";
import { cloneHub } from "@/lib/hub-clone-service";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return handleTransactionalApiCommand(
    request,
    {
      scopes: ["hubs:write"],
      action: "hub.clone",
      resourceType: "hub",
      idempotent: true,
    },
    {
      prepare: async () => parseJson(request, hubCloneSchema),
      execute: async ({ context, tx, activity, webhook }, input) => {
        const cloned = await cloneHub(tx, {
          organizationId: context.organizationId,
          sourceHubId: id,
          title: input.title,
        });
        if (!cloned) {
          throw new ApiError(404, "not_found", "Hub nicht gefunden.");
        }
        await activity({
          type: "hub.created",
          entityType: "hub",
          entityId: cloned.id,
          metadata: { operation: "hub.cloned", sourceHubId: id },
        });
        await webhook("hub.updated", {
          ...cloned,
          mutation: "cloned",
          clonedFromId: id,
        });
        return { data: cloned, status: 201, resourceId: cloned.id };
      },
    },
  );
}
