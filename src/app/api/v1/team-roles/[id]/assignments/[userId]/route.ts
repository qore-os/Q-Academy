import { z } from "zod";
import { apiOptions, handleApi } from "@/lib/api/handler";
import { getOwnerActorForApiKey, unassignTeamRole } from "@/lib/team-permissions";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;
const idSchema = z.string().uuid();

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; userId: string }> },
) {
  const values = await params;
  return handleApi(
    request,
    {
      scopes: ["team_roles:write"],
      action: "team_role_assignment.delete",
      resourceType: "team_role_assignment",
      idempotent: true,
    },
    async (context) => {
      const roleId = idSchema.parse(values.id);
      const userId = idSchema.parse(values.userId);
      const actor = await getOwnerActorForApiKey(context);
      return {
        data: await unassignTeamRole(actor, userId, roleId),
        resourceId: userId,
      };
    },
  );
}
