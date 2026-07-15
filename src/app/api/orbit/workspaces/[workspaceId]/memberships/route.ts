import { z } from "zod";

import { orbitMembershipSchema } from "@/lib/orbit/schemas";
import { upsertOrbitMembership } from "@/lib/orbit/service";
import { handleSessionRequest, parseSessionJson, sessionData } from "@/lib/session-api";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  return handleSessionRequest(
    request,
    { mutation: true, action: "orbit.membership.upsert" },
    async (user) => {
      const workspaceId = z.string().uuid().parse((await params).workspaceId);
      const input = orbitMembershipSchema.parse(
        await parseSessionJson(request, { maxBytes: 2_048 }),
      );
      return sessionData(request, await upsertOrbitMembership(user, workspaceId, input));
    },
  );
}
