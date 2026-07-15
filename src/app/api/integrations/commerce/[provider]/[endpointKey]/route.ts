import { createHash, randomUUID } from "node:crypto";
import { decryptWebhookSecret } from "@/lib/api/crypto";
import {
  COMMERCE_PROVIDERS,
  COMMERCE_SIGNATURE_MODES,
  type CommerceProvider,
  type CommerceSignatureMode,
} from "@/lib/commerce/model";
import {
  normalizeCommerceProviderEvent,
  parseProviderBody,
  verifyCommerceProviderSignature,
  CommerceProviderPayloadError,
} from "@/lib/commerce/provider-adapters";
import {
  commerceConnectionByEndpoint,
  CommerceConfigurationError,
  CommerceEventConflictError,
  processInboundCommerceEvent,
} from "@/lib/commerce/service";
import { readLimitedRequestText } from "@/lib/limited-request-body";
import { logServerError } from "@/lib/server-error-logging";

export const dynamic = "force-dynamic";
const MAX_PROVIDER_PAYLOAD_BYTES = 256 * 1024;

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

export async function POST(
  request: Request,
  context: { params: Promise<{ provider: string; endpointKey: string }> },
) {
  const requestId = randomUUID();
  const { provider, endpointKey } = await context.params;
  if (
    !COMMERCE_PROVIDERS.includes(provider as CommerceProvider) ||
    !/^[A-Za-z0-9_-]{32,80}$/.test(endpointKey)
  ) {
    return response(404, requestId, { accepted: false });
  }
  const connection = await commerceConnectionByEndpoint(provider, endpointKey);
  if (!connection) return response(404, requestId, { accepted: false });
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_PROVIDER_PAYLOAD_BYTES) {
    return response(413, requestId, { accepted: false, code: "payload_too_large" });
  }
  const body = await readLimitedRequestText(
    request,
    MAX_PROVIDER_PAYLOAD_BYTES,
  ).catch(() => null);
  if (!body?.ok) {
    return response(413, requestId, { accepted: false, code: "payload_too_large" });
  }
  try {
    const fields = parseProviderBody(body.text, request.headers.get("content-type"));
    const secret = decryptWebhookSecret(connection.signingSecretEncrypted);
    const signatureMode = connection.signatureMode as CommerceSignatureMode;
    if (!COMMERCE_SIGNATURE_MODES.includes(signatureMode)) {
      throw new CommerceConfigurationError("Unbekannter Signaturmodus.");
    }
    const verified = verifyCommerceProviderSignature({
      provider: provider as CommerceProvider,
      mode: signatureMode,
      secret,
      headers: request.headers,
      rawBody: body.text,
      fields,
    });
    if (!verified) {
      return response(401, requestId, {
        accepted: false,
        code: "signature_invalid",
      });
    }
    const event = normalizeCommerceProviderEvent(
      provider as CommerceProvider,
      fields,
    );
    const result = await processInboundCommerceEvent({
      connection,
      event,
      payloadHash: createHash("sha256").update(body.text).digest("hex"),
    });
    return response(result.replayed ? 200 : 202, requestId, {
      accepted: true,
      replayed: result.replayed,
      eventId: result.eventId,
    });
  } catch (error) {
    if (error instanceof CommerceEventConflictError) {
      return response(409, requestId, {
        accepted: false,
        code: "event_conflict",
      });
    }
    if (
      error instanceof CommerceProviderPayloadError ||
      error instanceof CommerceConfigurationError
    ) {
      return response(422, requestId, {
        accepted: false,
        code:
          error instanceof CommerceConfigurationError
            ? "configuration_error"
            : "payload_invalid",
      });
    }
    logServerError(error, {
      action: "commerce.provider.inbound",
      requestId,
    });
    return response(500, requestId, {
      accepted: false,
      code: "processing_failed",
    });
  }
}
