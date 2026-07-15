import { z } from "zod";

import { orbitInstanceUpdateSchema } from "@/lib/orbit/schemas";
import { updateOrbitInstance } from "@/lib/orbit/service";
import { handleSessionRequest, parseSessionJson, sessionData } from "@/lib/session-api";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string; organizationId: string }> },
) {
  return handleSessionRequest(
    request,
    { mutation: true, action: "orbit.instance.update" },
    async (user) => {
      const parsed = z
        .object({ workspaceId: z.string().uuid(), organizationId: z.string().uuid() })
        .parse(await params);
      const input = orbitInstanceUpdateSchema.parse(
        await parseSessionJson(request, { maxBytes: 4_096 }),
      );
      return sessionData(
        request,
        await updateOrbitInstance(user, parsed.workspaceId, parsed.organizationId, input),
      );
    },
  );
}
