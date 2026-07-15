import { handleSessionRequest, sessionData } from "@/lib/session-api";
import { resolveNativePushProviderConfiguration } from "@/lib/push/native-provider-config";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handleSessionRequest(
    request,
    { action: "push.native_configuration.read" },
    async () => {
      const configuration = resolveNativePushProviderConfiguration();
      return sessionData(request, {
        platforms: [
          ...(configuration.ios ? ["ios" as const] : []),
          ...(configuration.android ? ["android" as const] : []),
        ],
        appId: process.env.MOBILE_APP_BUNDLE_ID?.trim() || "com.qacademy.mobile",
      });
    },
  );
}
