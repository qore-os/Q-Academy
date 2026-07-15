import { z } from "zod";

import { ApiError } from "@/lib/api/errors";
import { getSession } from "@/lib/auth";
import { hasWebPushSubscription } from "@/lib/push/subscriptions";
import {
  handleSessionRequest,
  parseSessionJson,
  sessionData,
} from "@/lib/session-api";

export const dynamic = "force-dynamic";

const statusSchema = z
  .object({ endpoint: z.string().trim().min(1).max(4_096) })
  .strict();

export async function POST(request: Request) {
  return handleSessionRequest(
    request,
    { mutation: true, action: "push.subscription.status" },
    async (user) => {
      const session = await getSession();
      if (
        !session ||
        session.sub !== user.id ||
        session.organizationId !== user.organizationId
      ) {
        throw new ApiError(
          401,
          "authentication_required",
          "Eine aktive Browser-Sitzung ist erforderlich.",
        );
      }
      const input = statusSchema.parse(
        await parseSessionJson(request, { maxBytes: 4_608 }),
      );
      return sessionData(request, {
        subscribed: await hasWebPushSubscription({
          organizationId: user.organizationId,
          userId: user.id,
          sessionId: session.sessionId,
          endpoint: input.endpoint,
        }),
      });
    },
  );
}
