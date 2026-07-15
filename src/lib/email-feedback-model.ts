import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const EMAIL_FEEDBACK_EVENT_TYPES = ["bounce", "complaint"] as const;
export const EMAIL_BOUNCE_KINDS = ["hard", "soft"] as const;
export const EMAIL_SUPPRESSION_REASONS = [
  "hard_bounce",
  "soft_bounce",
  "complaint",
] as const;
export const EMAIL_SUPPRESSION_RELEASE_REASONS = [
  "address_corrected",
  "provider_error",
  "member_request",
  "other_verified",
] as const;

export const MAIL_GATEWAY_TIMESTAMP_HEADER = "x-qa-mail-timestamp";
export const MAIL_GATEWAY_SIGNATURE_HEADER = "x-qa-mail-signature";
export const MAIL_GATEWAY_SIGNATURE_TOLERANCE_SECONDS = 300;

export const mailGatewayFeedbackEventSchema = z
  .object({
    eventId: z.string().trim().min(8).max(180).regex(/^[A-Za-z0-9._:-]+$/),
    organizationId: z.string().uuid(),
    deliveryId: z.string().uuid(),
    type: z.enum(EMAIL_FEEDBACK_EVENT_TYPES),
    bounceKind: z.enum(EMAIL_BOUNCE_KINDS).nullable().optional(),
    reasonCode: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .regex(/^[A-Za-z0-9._:-]+$/),
    occurredAt: z.iso.datetime({ offset: true }).transform((value) => new Date(value)),
  })
  .strict()
  .superRefine((event, context) => {
    if (event.type === "bounce" && !event.bounceKind) {
      context.addIssue({
        code: "custom",
        path: ["bounceKind"],
        message: "Bounce events require bounceKind.",
      });
    }
    if (event.type === "complaint" && event.bounceKind !== undefined && event.bounceKind !== null) {
      context.addIssue({
        code: "custom",
        path: ["bounceKind"],
        message: "Complaint events cannot contain bounceKind.",
      });
    }
  });

export const emailSuppressionListQuerySchema = z
  .object({
    status: z.enum(["active", "released", "expired"]).optional(),
    reason: z.enum(EMAIL_SUPPRESSION_REASONS).optional(),
    search: z.string().trim().max(160).optional(),
  })
  .strict();

export const emailSuppressionReleaseSchema = z
  .object({
    reason: z.enum(EMAIL_SUPPRESSION_RELEASE_REASONS),
  })
  .strict();

function safeHex(value: string) {
  const normalized = value.startsWith("v1=") ? value.slice(3) : value;
  if (!/^[a-f0-9]{64}$/i.test(normalized)) return null;
  return Buffer.from(normalized, "hex");
}

export function signMailGatewayFeedback(input: {
  secret: string;
  timestamp: number;
  rawBody: string;
}) {
  return createHmac("sha256", input.secret)
    .update(`${input.timestamp}.${input.rawBody}`)
    .digest("hex");
}

export function verifyMailGatewayFeedbackSignature(input: {
  secret: string;
  headers: Headers;
  rawBody: string;
  now?: Date;
}):
  | { ok: true; timestamp: number }
  | { ok: false; code: "timestamp_invalid" | "timestamp_expired" | "signature_invalid" } {
  const timestampValue = input.headers.get(MAIL_GATEWAY_TIMESTAMP_HEADER)?.trim();
  if (!timestampValue || !/^\d{10}$/.test(timestampValue)) {
    return { ok: false, code: "timestamp_invalid" };
  }
  const timestamp = Number(timestampValue);
  const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1_000);
  if (
    !Number.isSafeInteger(timestamp) ||
    Math.abs(nowSeconds - timestamp) > MAIL_GATEWAY_SIGNATURE_TOLERANCE_SECONDS
  ) {
    return { ok: false, code: "timestamp_expired" };
  }
  const supplied = safeHex(
    input.headers.get(MAIL_GATEWAY_SIGNATURE_HEADER)?.trim() ?? "",
  );
  if (!supplied) return { ok: false, code: "signature_invalid" };
  const expected = Buffer.from(
    signMailGatewayFeedback({
      secret: input.secret,
      timestamp,
      rawBody: input.rawBody,
    }),
    "hex",
  );
  return supplied.length === expected.length && timingSafeEqual(supplied, expected)
    ? { ok: true, timestamp }
    : { ok: false, code: "signature_invalid" };
}

export function suppressionReasonForEvent(
  event: z.output<typeof mailGatewayFeedbackEventSchema>,
) {
  return event.type === "complaint"
    ? "complaint"
    : event.bounceKind === "soft"
      ? "soft_bounce"
      : "hard_bounce";
}
