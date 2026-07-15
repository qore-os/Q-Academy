import { z } from "zod";

import { getOrbitWorkspaceOverview } from "@/lib/orbit/service";
import { handleSessionRequest, sessionData } from "@/lib/session-api";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  return handleSessionRequest(request, { action: "orbit.workspace.read" }, async (user) => {
    const workspaceId = z.string().uuid().parse((await params).workspaceId);
    return sessionData(request, await getOrbitWorkspaceOverview(user, workspaceId));
  });
}
