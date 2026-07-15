import {
  apiOptions,
  handleApi,
  handleTransactionalApiCommand,
  parseJson,
} from "@/lib/api/handler";
import { communityLevelConfigurationUpdateSchema } from "@/lib/api/schemas";
import { communityAdminApiActorForContext } from "@/lib/community-admin";
import {
  getCommunityLevelConfiguration,
  replaceCommunityLevelConfiguration,
} from "@/lib/community-governance";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

export async function GET(request: Request) {
  return handleApi(
    request,
    {
      scopes: ["community:read"],
      action: "community.level_configuration.read",
      resourceType: "community_level_configuration",
    },
    async (context) => {
      await communityAdminApiActorForContext(context);
      return {
        data: await getCommunityLevelConfiguration(context.organizationId),
        resourceId: context.organizationId,
      };
    },
  );
}

export async function PUT(request: Request) {
  return handleTransactionalApiCommand(
    request,
    {
      scopes: ["community:write"],
      action: "community.level_configuration.replace",
      resourceType: "community_level_configuration",
      idempotent: true,
    },
    {
      prepare: async (context) => ({
        actor: await communityAdminApiActorForContext(context),
        body: await parseJson(
          request,
          communityLevelConfigurationUpdateSchema,
        ),
      }),
      execute: async ({ context, tx }, prepared) => {
        const configuration = await replaceCommunityLevelConfiguration({
          organizationId: context.organizationId,
          actorId: prepared.actor.id,
          ...prepared.body,
          tx,
        });
        return {
          data: configuration,
          resourceId: context.organizationId,
        };
      },
    },
  );
}
