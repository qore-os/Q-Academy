import { createHash, randomUUID } from "node:crypto";
import {
  MAIL_GATEWAY_SIGNATURE_HEADER,
  MAIL_GATEWAY_TIMESTAMP_HEADER,
  mailGatewayFeedbackEventSchema,
  verifyMailGatewayFeedbackSignature,
} from "@/lib/email-feedback-model";
import {
  EmailFeedbackConflictError,
  EmailFeedbackDeliveryError,
  processMailGatewayFeedback,
} from "@/lib/email-feedback";
import { readLimitedRequestText } from "@/lib/limited-request-body";
import { getEmailDeliveryInboundSecret } from "@/lib/server-environment";
import { logServerError } from "@/lib/server-error-logging";

export const dynamic = "force-dynamic";

const MAX_FEEDBACK_PAYLOAD_BYTES = 64 * 1024;
const MAX_EVENT_AGE_MS = 365 * 24 * 60 * 60_000;
const MAX_EVENT_FUTURE_MS = 5 * 60_000;

function response(
  status: number,
  requestId: string,
  body: Record<string, unknown>,
) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Request-Id": requestId,
    },
  });
}

export async function POST(request: Request) {
  const requestId = randomUUID();
  const secret = getEmailDeliveryInboundSecret();
  if (!secret) {
    return response(503, requestId, {
      accepted: false,
      code: "gateway_not_configured",
    });
  }
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("application/json")) {
    return response(415, requestId, {
      accepted: false,
      code: "content_type_invalid",
    });
  }
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (
    Number.isFinite(contentLength) &&
    contentLength > MAX_FEEDBACK_PAYLOAD_BYTES
  ) {
    return response(413, requestId, {
      accepted: false,
      code: "payload_too_large",
    });
  }
  const body = await readLimitedRequestText(
    request,
    MAX_FEEDBACK_PAYLOAD_BYTES,
  ).catch(() => null);
  if (!body?.ok) {
    return response(413, requestId, {
      accepted: false,
      code: "payload_too_large",
    });
  }
  const signature = verifyMailGatewayFeedbackSignature({
    secret,
    headers: request.headers,
    rawBody: body.text,
  });
  if (!signature.ok) {
    return response(401, requestId, {
      accepted: false,
      code: signature.code,
      requiredHeaders: [
        MAIL_GATEWAY_TIMESTAMP_HEADER,
        MAIL_GATEWAY_SIGNATURE_HEADER,
      ],
    });
  }
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(body.text);
  } catch {
    return response(422, requestId, {
      accepted: false,
      code: "payload_invalid",
    });
  }
  const parsed = mailGatewayFeedbackEventSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return response(422, requestId, {
      accepted: false,
      code: "payload_invalid",
    });
  }
  const now = Date.now();
  if (
    parsed.data.occurredAt.getTime() < now - MAX_EVENT_AGE_MS ||
    parsed.data.occurredAt.getTime() > now + MAX_EVENT_FUTURE_MS
  ) {
    return response(422, requestId, {
      accepted: false,
      code: "event_time_invalid",
    });
  }
  try {
    const result = await processMailGatewayFeedback({
      event: parsed.data,
      payloadHash: createHash("sha256").update(body.text).digest("hex"),
    });
    return response(result.replayed ? 200 : 202, requestId, {
      accepted: true,
      replayed: result.replayed,
    });
  } catch (error) {
    if (error instanceof EmailFeedbackConflictError) {
      return response(409, requestId, {
        accepted: false,
        code: "event_conflict",
      });
    }
    if (error instanceof EmailFeedbackDeliveryError) {
      return response(422, requestId, {
        accepted: false,
        code: "delivery_invalid",
      });
    }
    logServerError(error, {
      action: "email.gateway.feedback",
      requestId,
    });
    return response(500, requestId, {
      accepted: false,
      code: "processing_failed",
    });
  }
}
