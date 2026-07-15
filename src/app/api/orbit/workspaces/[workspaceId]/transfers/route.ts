import { z } from "zod";

import { ApiError } from "@/lib/api/errors";
import { orbitTransferExecutionSchema } from "@/lib/orbit/schemas";
import { createOrbitTransfer } from "@/lib/orbit/transfer";
import { MAX_ORBIT_TRANSFER_REQUEST_BYTES } from "@/lib/orbit/transfer-authors";
import { handleSessionRequest, parseSessionJson, sessionData } from "@/lib/session-api";

const idempotencyKeySchema = z.string().trim().min(8).max(180);

export async function POST(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  return handleSessionRequest(
    request,
    { mutation: true, action: "orbit.transfer.create" },
    async (user) => {
      const workspaceId = z.string().uuid().parse((await params).workspaceId);
      const key = request.headers.get("idempotency-key");
      if (!key) {
        throw new ApiError(428, "precondition_required", "Der Header Idempotency-Key ist erforderlich.");
      }
      const input = orbitTransferExecutionSchema.parse(
        await parseSessionJson(request, {
          maxBytes: MAX_ORBIT_TRANSFER_REQUEST_BYTES,
        }),
      );
      const result = await createOrbitTransfer({
        user,
        workspaceId,
        request: input,
        idempotencyKey: idempotencyKeySchema.parse(key),
      });
      return sessionData(request, result, result.created ? 201 : 200);
    },
  );
}
