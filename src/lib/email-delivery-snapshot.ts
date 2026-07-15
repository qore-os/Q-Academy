import { z } from "zod";
import { parseStoredEmailDeliverySourcePayloadV1 } from "@/lib/email-center-model";
import {
  emailGatewayRequestV1Schema,
  type EmailGatewayRequestV1,
} from "@/lib/email-gateway-contract";

// Immutable encrypted payload contract. Future fields require schemaVersion 2.
export const emailDeliveryPayloadEnvelopeV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    source: z.unknown(),
    gatewayRequest: emailGatewayRequestV1Schema,
  })
  .strict();
export const emailDeliveryPayloadEnvelopeSchema =
  emailDeliveryPayloadEnvelopeV1Schema;
const emailDeliveryPayloadEnvelopeShapeSchema = z
  .object({
    schemaVersion: z.literal(1),
    source: z.unknown(),
    gatewayRequest: z.unknown(),
  })
  .strict();

export type EmailDeliveryPayloadEnvelope = z.infer<
  typeof emailDeliveryPayloadEnvelopeV1Schema
>;

type DeliveryBinding = {
  event: string;
  email: string;
  organizationId: string;
};

type ParsedEmailDeliveryPayload =
  | { kind: "legacy"; source: unknown }
  | {
      kind: "snapshot";
      source: unknown;
      gatewayRequest: EmailGatewayRequestV1;
      envelope: EmailDeliveryPayloadEnvelope;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function looksLikeEnvelope(value: unknown) {
  return (
    isRecord(value) &&
    ["schemaVersion", "source", "gatewayRequest"].some((key) =>
      Object.hasOwn(value, key),
    )
  );
}

function assertGatewayRequestBinding(
  gatewayRequest: EmailGatewayRequestV1,
  binding: DeliveryBinding,
) {
  if (
    gatewayRequest.event !== binding.event ||
    gatewayRequest.email !== binding.email ||
    gatewayRequest.tenantBranding.organizationId !== binding.organizationId
  ) {
    throw new Error("Der E-Mail-Snapshot passt nicht zur Delivery.");
  }
}

function assertSourceRequestConsistency(
  event: string,
  source: unknown,
  gatewayRequest: EmailGatewayRequestV1,
) {
  if (!isRecord(source)) {
    throw new Error("Der E-Mail-Snapshot enthaelt keine gueltige Quelle.");
  }
  const fields =
    event === "invitation.created" || event === "password.reset"
      ? Object.hasOwn(source, "subject")
        ? (["subject", "message", "html", "link"] as const)
        : (["link"] as const)
      : event === "feedback.reply" || event === "email.template.test"
        ? (["subject", "message", "html"] as const)
        : (["subject", "message", "html", "link"] as const);
  const request = gatewayRequest as unknown as Record<string, unknown>;
  if (fields.some((field) => source[field] !== request[field])) {
    throw new Error("Quelle und Gateway-Request des Snapshots stimmen nicht ueberein.");
  }
}

export function parseEmailGatewayRequestForDelivery(
  input: DeliveryBinding & { gatewayRequest: unknown },
) {
  const validated = emailGatewayRequestV1Schema.parse(input.gatewayRequest);
  assertGatewayRequestBinding(validated, input);
  return input.gatewayRequest as EmailGatewayRequestV1;
}

export function parseEmailDeliveryPayload(
  input: DeliveryBinding & { payload: unknown },
): ParsedEmailDeliveryPayload {
  if (!looksLikeEnvelope(input.payload)) {
    return {
      kind: "legacy",
      source: parseStoredEmailDeliverySourcePayloadV1(
        input.event,
        input.payload,
      ),
    };
  }

  const envelope = emailDeliveryPayloadEnvelopeShapeSchema.parse(input.payload);
  if (looksLikeEnvelope(envelope.source)) {
    throw new Error("Verschachtelte E-Mail-Snapshots sind nicht erlaubt.");
  }
  const source = parseStoredEmailDeliverySourcePayloadV1(
    input.event,
    envelope.source,
  );
  const gatewayRequest = parseEmailGatewayRequestForDelivery({
    ...input,
    gatewayRequest: envelope.gatewayRequest,
  });
  assertSourceRequestConsistency(input.event, source, gatewayRequest);
  return {
    kind: "snapshot",
    source,
    gatewayRequest,
    envelope: { ...envelope, source, gatewayRequest },
  };
}

export function createEmailDeliveryPayloadEnvelope(
  input: DeliveryBinding & {
    source: unknown;
    gatewayRequest: unknown;
  },
): EmailDeliveryPayloadEnvelope {
  if (looksLikeEnvelope(input.source)) {
    throw new Error("Verschachtelte E-Mail-Snapshots sind nicht erlaubt.");
  }
  const source = parseStoredEmailDeliverySourcePayloadV1(
    input.event,
    input.source,
  );
  const gatewayRequest = parseEmailGatewayRequestForDelivery(input);
  assertSourceRequestConsistency(input.event, source, gatewayRequest);
  return emailDeliveryPayloadEnvelopeSchema.parse({
    schemaVersion: 1,
    source,
    gatewayRequest,
  });
}

export function emailDeliveryPayloadSource(
  input: DeliveryBinding & { payload: unknown },
) {
  return parseEmailDeliveryPayload(input).source;
}
