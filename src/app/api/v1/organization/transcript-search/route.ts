import {
  apiOptions,
  handleApi,
  handleTransactionalApiCommand,
  parseJson,
} from "@/lib/api/handler";
import {
  getTranscriptSearchSettings,
  updateTranscriptSearchSettings,
} from "@/lib/transcript-search-settings";
import { transcriptSearchSettingsInputSchema } from "@/lib/transcript-search-settings-model";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

export async function GET(request: Request) {
  return handleApi(
    request,
    {
      scopes: ["organization:read"],
      action: "organization.transcript_search.read",
      resourceType: "transcript_search_settings",
    },
    async (context) => ({
      data: {
        organizationId: context.organizationId,
        ...(await getTranscriptSearchSettings(context.organizationId)),
      },
      resourceId: context.organizationId,
    }),
  );
}

export async function PATCH(request: Request) {
  return handleTransactionalApiCommand(
    request,
    {
      scopes: ["organization:write"],
      action: "organization.transcript_search.update",
      resourceType: "transcript_search_settings",
      idempotent: true,
    },
    {
      prepare: () => parseJson(request, transcriptSearchSettingsInputSchema),
      execute: async (tools, settings) => {
        const saved = await updateTranscriptSearchSettings(tools.tx, {
          organizationId: tools.context.organizationId,
          source: "api",
          settings,
        });
        return {
          data: {
            organizationId: tools.context.organizationId,
            excludedSearchTerms: saved.excludedSearchTerms,
            updatedAt: saved.updatedAt,
          },
          resourceId: tools.context.organizationId,
        };
      },
    },
  );
}
