import { z } from "zod";

import { orbitTransferSchema } from "@/lib/orbit/schemas";
import { preflightOrbitTransfer } from "@/lib/orbit/transfer";
import { MAX_ORBIT_TRANSFER_REQUEST_BYTES } from "@/lib/orbit/transfer-authors";
import { handleSessionRequest, parseSessionJson, sessionData } from "@/lib/session-api";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  return handleSessionRequest(
    request,
    { mutation: true, action: "orbit.transfer.preflight" },
    async (user) => {
      const workspaceId = z.string().uuid().parse((await params).workspaceId);
      const input = orbitTransferSchema.parse(
        await parseSessionJson(request, {
          maxBytes: MAX_ORBIT_TRANSFER_REQUEST_BYTES,
        }),
      );
      return sessionData(request, await preflightOrbitTransfer(user, workspaceId, input));
    },
  );
}
