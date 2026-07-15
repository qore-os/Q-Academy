import { handleSessionRequest, parseSessionJson, sessionData } from "@/lib/session-api";
import { orbitBootstrapSchema } from "@/lib/orbit/schemas";
import { bootstrapOrbitWorkspace, listOrbitWorkspaces } from "@/lib/orbit/service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handleSessionRequest(request, { action: "orbit.workspace.list" }, async (user) =>
    sessionData(request, await listOrbitWorkspaces(user)),
  );
}

export async function POST(request: Request) {
  return handleSessionRequest(
    request,
    { mutation: true, action: "orbit.workspace.bootstrap" },
    async (user) => {
      const input = orbitBootstrapSchema.parse(
        await parseSessionJson(request, { maxBytes: 2_048 }),
      );
      return sessionData(request, await bootstrapOrbitWorkspace(user, input), 201);
    },
  );
}

