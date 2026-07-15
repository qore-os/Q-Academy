import { z } from "zod";

import { ApiError } from "@/lib/api/errors";
import { getSession } from "@/lib/auth";
import {
  deleteNativePushDevices,
  nativePushDeviceInputSchema,
  upsertNativePushDevice,
} from "@/lib/push/native-devices";
import {
  handleSessionRequest,
  parseSessionJson,
  sessionData,
} from "@/lib/session-api";

export const dynamic = "force-dynamic";

const deleteSchema = z.object({ platform: z.enum(["ios", "android"]) }).strict();

async function currentSession(userId: string, organizationId: string) {
  const session = await getSession();
  if (!session || session.sub !== userId || session.organizationId !== organizationId) {
    throw new ApiError(401, "authentication_required", "Eine aktive Sitzung ist erforderlich.");
  }
  return session;
}

export async function POST(request: Request) {
  return handleSessionRequest(
    request,
    { mutation: true, action: "push.native_device.upsert" },
    async (user) => {
      const device = nativePushDeviceInputSchema.parse(
        await parseSessionJson(request, { maxBytes: 5_000 }),
      );
      const session = await currentSession(user.id, user.organizationId);
      return sessionData(
        request,
        await upsertNativePushDevice({
          organizationId: user.organizationId,
          userId: user.id,
          sessionId: session.sessionId,
          device,
        }),
        201,
      );
    },
  );
}

export async function DELETE(request: Request) {
  return handleSessionRequest(
    request,
    { mutation: true, action: "push.native_device.delete" },
    async (user) => {
      const input = deleteSchema.parse(
        await parseSessionJson(request, { maxBytes: 512 }),
      );
      const session = await currentSession(user.id, user.organizationId);
      return sessionData(
        request,
        await deleteNativePushDevices({
          organizationId: user.organizationId,
          userId: user.id,
          sessionId: session.sessionId,
          platform: input.platform,
        }),
      );
    },
  );
}
