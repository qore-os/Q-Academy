import { ApiError } from "@/lib/api/errors";
import { consumeGuardedPersistentRateLimit } from "@/lib/auth-rate-limit";
import {
  handleSessionRequest,
  parseSessionJson,
  sessionData,
} from "@/lib/session-api";
import {
  LearningTimeHeartbeatError,
  recordLearningTimeHeartbeat,
} from "@/lib/learning-time";
import { learningTimeHeartbeatSchema } from "@/lib/learning-time-policy";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handleSessionRequest(
    request,
    { mutation: true, action: "learning_time.heartbeat" },
    async (user) => {
      const rateLimit = await consumeGuardedPersistentRateLimit({
        primary: {
          action: "learning_time_heartbeat",
          identifier: `${user.organizationId}\0${user.id}`,
        },
        guards: [
          {
            action: "learning_time_heartbeat_tenant",
            identifier: user.organizationId,
          },
        ],
      });
      if (rateLimit.limited) {
        throw new ApiError(
          429,
          "rate_limit_exceeded",
          "Zu viele Lernzeit-Heartbeats. Bitte spaeter erneut versuchen.",
          { resetAt: rateLimit.resetAt.toISOString() },
        );
      }
      const input = learningTimeHeartbeatSchema.parse(
        await parseSessionJson(request, { maxBytes: 512 }),
      );
      try {
        const heartbeat = await recordLearningTimeHeartbeat({
          organizationId: user.organizationId,
          userId: user.id,
          heartbeat: input,
        });
        return sessionData(request, heartbeat);
      } catch (error) {
        if (error instanceof LearningTimeHeartbeatError) {
          throw new ApiError(
            error.status,
            error.status === 403 ? "forbidden" : "conflict",
            error.message,
            { reason: error.code },
          );
        }
        throw error;
      }
    },
  );
}
