import { apiOptions, handleApi } from "@/lib/api/handler";
import { communityPostActorParamsSchema } from "@/lib/api/schemas";
import { setPostReactionMutation } from "@/lib/community-mutations";
import {
  assertCommunityApiActorCanActAs,
  communityApiActorForContext,
} from "@/lib/community-access";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string; userId: string }> },
) {
  return handleApi(
    request,
    {
      scopes: ["community:write"],
      action: "community.reaction.add",
      resourceType: "post",
      idempotent: true,
    },
    async (context) => {
      const { id, userId } = communityPostActorParamsSchema.parse(await params);
      assertCommunityApiActorCanActAs(
        await communityApiActorForContext(context),
        userId,
      );
      const reaction = await setPostReactionMutation({
        organizationId: context.organizationId,
        postId: id,
        userId,
        reaction: "like",
      });
      return { data: reaction, resourceId: id };
    },
  );
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; userId: string }> },
) {
  return handleApi(
    request,
    {
      scopes: ["community:write"],
      action: "community.reaction.remove",
      resourceType: "post",
      idempotent: true,
    },
    async (context) => {
      const { id, userId } = communityPostActorParamsSchema.parse(await params);
      assertCommunityApiActorCanActAs(
        await communityApiActorForContext(context),
        userId,
      );
      const reaction = await setPostReactionMutation({
        organizationId: context.organizationId,
        postId: id,
        userId,
        reaction: null,
      });
      return { data: reaction, resourceId: id };
    },
  );
}
