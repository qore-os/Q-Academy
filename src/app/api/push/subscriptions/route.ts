import { z } from "zod";

import { ApiError } from "@/lib/api/errors";
import { getSession } from "@/lib/auth";
import {
  deleteWebPushSubscription,
  pushSubscriptionSchema,
  upsertWebPushSubscription,
} from "@/lib/push/subscriptions";
import { getWebPushConfiguration } from "@/lib/server-environment";
import {
  handleSessionRequest,
  parseSessionJson,
  sessionData,
} from "@/lib/session-api";

export const dynamic = "force-dynamic";

const deleteSubscriptionSchema = z
  .object({ endpoint: z.string().trim().min(1).max(4_096) })
  .strict();

function requirePushConfiguration() {
  if (getWebPushConfiguration()) return;
  throw new ApiError(
    409,
    "conflict",
    "Push-Benachrichtigungen sind fuer diese Installation nicht konfiguriert.",
  );
}

async function currentSessionId(userId: string, organizationId: string) {
  const session = await getSession();
  if (
    !session ||
    session.sub !== userId ||
    session.organizationId !== organizationId
  ) {
    throw new ApiError(
      401,
      "authentication_required",
      "Eine aktive Browser-Sitzung ist erforderlich.",
    );
  }
  return session.sessionId;
}

export async function POST(request: Request) {
  return handleSessionRequest(
    request,
    { mutation: true, action: "push.subscription.upsert" },
    async (user) => {
      requirePushConfiguration();
      const subscription = pushSubscriptionSchema.parse(
        await parseSessionJson(request, { maxBytes: 8_192 }),
      );
      const result = await upsertWebPushSubscription({
        organizationId: user.organizationId,
        userId: user.id,
        sessionId: await currentSessionId(user.id, user.organizationId),
        subscription,
      });
      return sessionData(request, result, 201);
    },
  );
}

export async function DELETE(request: Request) {
  return handleSessionRequest(
    request,
    { mutation: true, action: "push.subscription.delete" },
    async (user) => {
      const input = deleteSubscriptionSchema.parse(
        await parseSessionJson(request, { maxBytes: 4_608 }),
      );
      return sessionData(
        request,
        await deleteWebPushSubscription({
          organizationId: user.organizationId,
          userId: user.id,
          sessionId: await currentSessionId(user.id, user.organizationId),
          endpoint: input.endpoint,
        }),
      );
    },
  );
}
