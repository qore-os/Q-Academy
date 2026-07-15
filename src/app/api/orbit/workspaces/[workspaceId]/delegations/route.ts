import { z } from "zod";

import { orbitDelegationSchema } from "@/lib/orbit/schemas";
import { upsertOrbitDelegation } from "@/lib/orbit/service";
import { handleSessionRequest, parseSessionJson, sessionData } from "@/lib/session-api";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  return handleSessionRequest(
    request,
    { mutation: true, action: "orbit.delegation.upsert" },
    async (user) => {
      const workspaceId = z.string().uuid().parse((await params).workspaceId);
      const input = orbitDelegationSchema.parse(
        await parseSessionJson(request, { maxBytes: 4_096 }),
      );
      return sessionData(
        request,
        await upsertOrbitDelegation(user, workspaceId, input),
        201,
      );
    },
  );
}
