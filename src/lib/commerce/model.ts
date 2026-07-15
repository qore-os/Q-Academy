import { z } from "zod";

export const COMMERCE_PROVIDERS = [
  "digistore24",
  "ablefy",
  "copecart",
] as const;
export type CommerceProvider = (typeof COMMERCE_PROVIDERS)[number];

export const COMMERCE_SIGNATURE_MODES = [
  "hmac_sha256",
  "digistore_sha512",
  "shared_token",
] as const;
export type CommerceSignatureMode = (typeof COMMERCE_SIGNATURE_MODES)[number];

export function commerceSignatureModeIsSupported(
  provider: CommerceProvider,
  mode: CommerceSignatureMode,
) {
  return mode !== "digistore_sha512" || provider === "digistore24";
}

export const COMMERCE_LIFECYCLE_EVENTS = [
  "order_created",
  "subscription_activated",
  "payment_failed",
  "subscription_cancelled",
  "subscription_expired",
  "refunded",
] as const;
export type CommerceLifecycleEvent =
  (typeof COMMERCE_LIFECYCLE_EVENTS)[number];

const nullableDate = z
  .union([z.iso.datetime({ offset: true }), z.iso.date(), z.null()])
  .optional()
  .transform((value) => (value ? new Date(value) : null));

export const normalizedCommerceEventSchema = z
  .object({
    externalEventId: z.string().trim().min(1).max(240),
    type: z.enum(COMMERCE_LIFECYCLE_EVENTS),
    externalOrderId: z.string().trim().min(1).max(240),
    externalSubscriptionId: z.string().trim().min(1).max(240).nullable(),
    providerProductId: z.string().trim().min(1).max(240),
    providerVariantId: z.string().trim().min(1).max(240).nullable(),
    customerEmail: z.string().trim().toLowerCase().email().max(255),
    customerFirstName: z.string().trim().max(100),
    customerLastName: z.string().trim().max(100),
    currency: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}$/)
      .nullable(),
    totalMinor: z.number().int().min(0).max(2_147_483_647).nullable(),
    occurredAt: nullableDate,
    accessUntil: nullableDate,
  })
  .strict()
  .transform((value) => ({
    ...value,
    occurredAt: value.occurredAt ?? new Date(),
  }));

export type NormalizedCommerceEvent = z.output<
  typeof normalizedCommerceEventSchema
>;

export const commerceConnectionInputSchema = z
  .object({
    provider: z.enum(COMMERCE_PROVIDERS),
    displayName: z.string().trim().min(2).max(120),
    signatureMode: z.enum(COMMERCE_SIGNATURE_MODES),
    signingSecret: z.string().min(16).max(4096),
    active: z.boolean().default(true),
    autoCreateMembers: z.boolean().default(true),
  })
  .strict()
  .superRefine((value, context) => {
    if (!commerceSignatureModeIsSupported(value.provider, value.signatureMode)) {
      context.addIssue({
        code: "custom",
        path: ["signatureMode"],
        message:
          "Die Digistore-SHA-512-Feldsignatur ist nur fuer Digistore24 zulaessig.",
      });
    }
  });

export const commerceProductInputSchema = z
  .object({
    name: z.string().trim().min(2).max(180),
    sku: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
    bundleId: z.string().uuid(),
    active: z.boolean().default(true),
    metadata: z.record(z.string().max(120), z.unknown()).default({}),
  })
  .strict();

export const commerceMappingInputSchema = z
  .object({
    connectionId: z.string().uuid(),
    productId: z.string().uuid(),
    providerProductId: z.string().trim().min(1).max(240),
    providerVariantId: z.string().trim().min(1).max(240).nullable().default(null),
    active: z.boolean().default(true),
  })
  .strict();

export const commerceEntitlementCommandSchema = z
  .object({
    action: z.enum(["grant", "revoke"]),
    userId: z.string().uuid(),
    productId: z.string().uuid(),
    sourceReference: z.string().trim().min(1).max(240),
    endsAt: nullableDate,
    reason: z.string().trim().max(500).nullable().default(null),
  })
  .strict();

export const automationMemberUpsertSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(255),
    firstName: z.string().trim().min(1).max(100).default("Mitglied"),
    lastName: z.string().trim().max(100).default(""),
    bundleId: z.string().uuid().nullable().default(null),
    bundleAction: z.enum(["grant", "revoke"]).default("grant"),
    sendInvitation: z.boolean().default(true),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.bundleAction === "revoke" && !value.bundleId) {
      context.addIssue({
        code: "custom",
        path: ["bundleId"],
        message: "Zum Entziehen des Zugriffs ist ein Bundle erforderlich.",
      });
    }
  });

export const n8nWorkflowInputSchema = z
  .object({
    name: z.string().trim().min(2).max(160),
    url: z
      .string()
      .trim()
      .url()
      .max(2000)
      .refine((value) => new URL(value).protocol === "https:"),
    signingSecret: z.string().min(16).max(4096),
    events: z
      .array(
        z.enum([
          "commerce.order.created",
          "commerce.subscription.activated",
          "commerce.subscription.payment_failed",
          "commerce.subscription.cancelled",
          "commerce.subscription.expired",
          "commerce.entitlement.granted",
          "commerce.entitlement.revoked",
          "automation.member.upserted",
          "automation.n8n.triggered",
        ]),
      )
      .min(1)
      .max(9)
      .refine((events) => new Set(events).size === events.length),
    active: z.boolean().default(true),
  })
  .strict();

export const n8nTriggerSchema = z
  .object({
    eventKey: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .regex(/^[a-z][a-z0-9_.-]*$/),
    data: z
      .record(z.string().min(1).max(120), z.unknown())
      .refine(
        (value) => Buffer.byteLength(JSON.stringify(value), "utf8") <= 64 * 1024,
        "Der Workflow-Payload ist zu gross.",
      ),
  })
  .strict();

export const supportSettingsInputSchema = z
  .object({
    enabled: z.boolean(),
    provider: z.enum(["link", "email", "intercom"]),
    launcherLabel: z.string().trim().min(2).max(80),
    supportUrl: z
      .string()
      .trim()
      .url()
      .refine((value) => new URL(value).protocol === "https:")
      .nullable(),
    supportEmail: z.string().trim().toLowerCase().email().max(255).nullable(),
    intercomAppId: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9_-]{4,120}$/)
      .nullable(),
    identitySecret: z.string().min(16).max(4096).nullable(),
    clearIdentitySecret: z.boolean().default(false),
  })
  .strict()
  .superRefine((value, context) => {
    if (!value.enabled) return;
    const configured =
      (value.provider === "link" && value.supportUrl) ||
      (value.provider === "email" && value.supportEmail) ||
      (value.provider === "intercom" && value.intercomAppId);
    if (!configured) {
      context.addIssue({
        code: "custom",
        path: [value.provider === "intercom" ? "intercomAppId" : "supportUrl"],
        message: "Der aktive Supportkanal ist nicht vollstaendig konfiguriert.",
      });
    }
  });

export function commerceAccessSource(entitlementId: string) {
  return `commerce:entitlement:${entitlementId}`;
}

export function commerceEntitlementSourceKey(input: {
  connectionId?: string | null;
  sourceReference: string;
  productId: string;
  userId: string;
}) {
  return [
    input.connectionId ?? "manual",
    input.sourceReference,
    input.productId,
    input.userId,
  ].join(":");
}

export function resolveCommerceLifecycleDecision(
  type: CommerceLifecycleEvent,
  accessUntil: Date | null,
  now = new Date(),
) {
  if (type === "order_created" || type === "subscription_activated") {
    return { action: "grant" as const, endsAt: null, terminalStatus: null };
  }
  if (
    type === "subscription_cancelled" &&
    accessUntil !== null &&
    accessUntil > now
  ) {
    return {
      action: "grant" as const,
      endsAt: accessUntil,
      terminalStatus: null,
    };
  }
  return {
    action: "revoke" as const,
    endsAt: null,
    terminalStatus:
      type === "subscription_expired" || type === "refunded"
        ? ("expired" as const)
        : ("revoked" as const),
  };
}
