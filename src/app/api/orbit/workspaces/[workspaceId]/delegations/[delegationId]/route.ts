import { z } from "zod";

import { revokeOrbitDelegation } from "@/lib/orbit/service";
import { handleSessionRequest, sessionData } from "@/lib/session-api";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string; delegationId: string }> },
) {
  return handleSessionRequest(
    request,
    { mutation: true, action: "orbit.delegation.revoke" },
    async (user) => {
      const parsed = z
        .object({ workspaceId: z.string().uuid(), delegationId: z.string().uuid() })
        .parse(await params);
      return sessionData(
        request,
        await revokeOrbitDelegation(user, parsed.workspaceId, parsed.delegationId),
      );
    },
  );
}
