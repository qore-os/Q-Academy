import { z } from "zod";

import { createOrbitInstanceClaim } from "@/lib/orbit/service";
import { handleSessionRequest, parseSessionJson, sessionData } from "@/lib/session-api";
import { orbitClaimCreateSchema } from "@/lib/orbit/schemas";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  return handleSessionRequest(
    request,
    { mutation: true, action: "orbit.instance_claim.create" },
    async (user) => {
      const workspaceId = z.string().uuid().parse((await params).workspaceId);
      orbitClaimCreateSchema.parse(await parseSessionJson(request, { maxBytes: 128 }));
      return sessionData(request, await createOrbitInstanceClaim(user, workspaceId), 201);
    },
  );
}
