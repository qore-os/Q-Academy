import { z } from "zod";

import { orbitPermissionSetSchema } from "@/lib/orbit/schemas";
import { createOrbitPermissionSet } from "@/lib/orbit/service";
import { handleSessionRequest, parseSessionJson, sessionData } from "@/lib/session-api";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  return handleSessionRequest(
    request,
    { mutation: true, action: "orbit.permission_set.create" },
    async (user) => {
      const workspaceId = z.string().uuid().parse((await params).workspaceId);
      const input = orbitPermissionSetSchema.parse(
        await parseSessionJson(request, { maxBytes: 4_096 }),
      );
      return sessionData(
        request,
        await createOrbitPermissionSet(user, workspaceId, input),
        201,
      );
    },
  );
}
