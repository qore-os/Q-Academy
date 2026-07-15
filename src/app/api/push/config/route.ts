import { getWebPushConfiguration } from "@/lib/server-environment";
import { handleSessionRequest, sessionData } from "@/lib/session-api";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handleSessionRequest(
    request,
    { action: "push.configuration.read" },
    async () => {
      const configuration = getWebPushConfiguration();
      return sessionData(request, {
        enabled: configuration !== null,
        publicKey: configuration?.publicKey ?? null,
      });
    },
  );
}
