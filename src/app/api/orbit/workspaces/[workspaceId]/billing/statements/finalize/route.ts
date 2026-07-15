import { z } from "zod";

import { orbitBillingFinalizeSchema } from "@/lib/orbit/schemas";
import { finalizePreviousOrbitBillingPeriod } from "@/lib/orbit/service";
import {
  handleSessionRequest,
  parseSessionJson,
  sessionData,
} from "@/lib/session-api";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  return handleSessionRequest(
    request,
    { mutation: true, action: "orbit.billing.statement.finalize" },
    async (user) => {
      const workspaceId = z.string().uuid().parse((await params).workspaceId);
      orbitBillingFinalizeSchema.parse(
        await parseSessionJson(request, { maxBytes: 128 }),
      );
      const result = await finalizePreviousOrbitBillingPeriod(
        user,
        workspaceId,
      );
      return sessionData(request, result, result.created ? 201 : 200);
    },
  );
}
