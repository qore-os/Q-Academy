import { z } from "zod";

import { ApiError } from "@/lib/api/errors";
import { getSession } from "@/lib/auth";
import { hasNativePushDevice } from "@/lib/push/native-devices";
import {
  handleSessionRequest,
  parseSessionJson,
  sessionData,
} from "@/lib/session-api";

export const dynamic = "force-dynamic";

const inputSchema = z.object({ platform: z.enum(["ios", "android"]) }).strict();

export async function POST(request: Request) {
  return handleSessionRequest(
    request,
    { mutation: true, action: "push.native_device.status" },
    async (user) => {
      const session = await getSession();
      if (!session || session.sub !== user.id || session.organizationId !== user.organizationId) {
        throw new ApiError(401, "authentication_required", "Eine aktive Sitzung ist erforderlich.");
      }
      const input = inputSchema.parse(
        await parseSessionJson(request, { maxBytes: 512 }),
      );
      return sessionData(request, {
        subscribed: await hasNativePushDevice({
          organizationId: user.organizationId,
          userId: user.id,
          sessionId: session.sessionId,
          platform: input.platform,
        }),
      });
    },
  );
}
