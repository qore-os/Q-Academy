import { z } from "zod";

import { orbitBillingUpdateSchema } from "@/lib/orbit/schemas";
import {
  getOrbitBillingOverview,
  updateOrbitBilling,
} from "@/lib/orbit/service";
import {
  handleSessionRequest,
  parseSessionJson,
  sessionData,
} from "@/lib/session-api";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  return handleSessionRequest(
    request,
    { action: "orbit.billing.read" },
    async (user) => {
      const workspaceId = z.string().uuid().parse((await params).workspaceId);
      return sessionData(
        request,
        await getOrbitBillingOverview(user, workspaceId),
      );
    },
  );
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  return handleSessionRequest(
    request,
    { mutation: true, action: "orbit.billing.update" },
    async (user) => {
      const workspaceId = z.string().uuid().parse((await params).workspaceId);
      const input = orbitBillingUpdateSchema.parse(
        await parseSessionJson(request, { maxBytes: 4_096 }),
      );
      return sessionData(
        request,
        await updateOrbitBilling(user, workspaceId, input),
      );
    },
  );
}
