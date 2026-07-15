import { apiOptions, handleApi, parseJson } from "@/lib/api/handler";
import { communityProfileSettingsReplaceSchema } from "@/lib/api/schemas";
import {
  assertCommunityPermission,
  communityApiActorForContext,
} from "@/lib/community-access";
import {
  getCommunityProfileSettingsAdminData,
  replaceCommunityProfileSettings,
} from "@/lib/community-public-profile";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

function assertCanManage(role: "owner" | "admin" | "trainer" | "member") {
  assertCommunityPermission(
    {
      canView: true,
      canPost: true,
      canComment: true,
      canManage: role === "owner" || role === "admin",
    },
    "canManage",
  );
}

export async function GET(request: Request) {
  return handleApi(
    request,
    {
      scopes: ["community:read"],
      action: "community.profile_settings.read",
      resourceType: "community_profile_settings",
    },
    async (context) => {
      const actor = await communityApiActorForContext(context);
      assertCanManage(actor.role);
      return {
        data: await getCommunityProfileSettingsAdminData(
          context.organizationId,
        ),
      };
    },
  );
}

export async function PUT(request: Request) {
  return handleApi(
    request,
    {
      scopes: ["community:write"],
      action: "community.profile_settings.replace",
      resourceType: "community_profile_settings",
      idempotent: true,
    },
    async (context) => {
      const actor = await communityApiActorForContext(context);
      assertCanManage(actor.role);
      const input = await parseJson(
        request,
        communityProfileSettingsReplaceSchema,
      );
      const saved = await replaceCommunityProfileSettings({
        organizationId: context.organizationId,
        actorId: actor.id,
        ...input,
      });
      return {
        data: saved,
        resourceId: context.organizationId,
      };
    },
  );
}
