import {
  createHash,
  createHmac,
  timingSafeEqual,
} from "node:crypto";
import {
  type CommerceProvider,
  type CommerceSignatureMode,
  normalizedCommerceEventSchema,
  type NormalizedCommerceEvent,
} from "@/lib/commerce/model";

type FieldMap = Readonly<Record<string, string>>;

export class CommerceProviderPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CommerceProviderPayloadError";
  }
}

function safeEqualHex(actual: string | null, expected: string) {
  if (!actual || !/^[a-f0-9]+$/i.test(actual)) return false;
  const actualBuffer = Buffer.from(actual.toLowerCase(), "hex");
  const expectedBuffer = Buffer.from(expected.toLowerCase(), "hex");
  return actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer);
}

function normalizeSignature(value: string | null) {
  if (!value) return null;
  return value.trim().replace(/^(?:sha256|sha512)=/i, "");
}

const SIGNATURE_HEADERS: Record<CommerceProvider, readonly string[]> = {
  digistore24: ["x-digistore24-signature", "x-digistore-signature"],
  ablefy: ["x-ablefy-signature", "x-elopage-signature"],
  copecart: ["x-copecart-signature"],
};

function firstHeader(headers: Headers, names: readonly string[]) {
  for (const name of names) {
    const value = headers.get(name);
    if (value) return value;
  }
  return null;
}

export function verifyCommerceProviderSignature(input: {
  provider: CommerceProvider;
  mode: CommerceSignatureMode;
  secret: string;
  headers: Headers;
  rawBody: string;
  fields: FieldMap;
}) {
  if (input.mode === "shared_token") {
    const actual = firstHeader(input.headers, [
      "x-commerce-token",
      "x-webhook-token",
    ]);
    const actualDigest = createHash("sha256").update(actual ?? "").digest();
    const expectedDigest = createHash("sha256").update(input.secret).digest();
    return timingSafeEqual(actualDigest, expectedDigest);
  }
  if (input.mode === "digistore_sha512") {
    if (input.provider !== "digistore24") return false;
    const signature = normalizeSignature(input.fields.sha_sign ?? null);
    const canonical = Object.entries(input.fields)
      .filter(([key]) => key !== "sha_sign" && key !== "sha_signature")
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([, value]) => value)
      .join("");
    const expected = createHash("sha512")
      .update(canonical)
      .update(input.secret)
      .digest("hex");
    return safeEqualHex(signature, expected);
  }
  const signature = normalizeSignature(
    firstHeader(input.headers, [
      ...SIGNATURE_HEADERS[input.provider],
      "x-commerce-signature",
    ]),
  );
  const expected = createHmac("sha256", input.secret)
    .update(input.rawBody)
    .digest("hex");
  return safeEqualHex(signature, expected);
}

function field(fields: FieldMap, names: readonly string[]): string;
function field(
  fields: FieldMap,
  names: readonly string[],
  required: true,
): string;
function field(
  fields: FieldMap,
  names: readonly string[],
  required: false,
): string | null;
function field(fields: FieldMap, names: readonly string[], required = true) {
  for (const name of names) {
    const value = fields[name]?.trim();
    if (value) return value;
  }
  if (!required) return null;
  throw new CommerceProviderPayloadError(`Pflichtfeld fehlt: ${names[0]}`);
}

function eventType(provider: CommerceProvider, raw: string) {
  const value = raw.trim().toLowerCase().replace(/[. -]+/g, "_");
  const aliases: Record<string, NormalizedCommerceEvent["type"]> = {
    order_created: "order_created",
    order_paid: "order_created",
    payment: "order_created",
    purchase: "order_created",
    purchase_created: "order_created",
    subscription_created: "subscription_activated",
    subscription_active: "subscription_activated",
    subscription_activated: "subscription_activated",
    rebill: "subscription_activated",
    payment_failed: "payment_failed",
    payment_denied: "payment_failed",
    rebill_failed: "payment_failed",
    subscription_cancelled: "subscription_cancelled",
    subscription_canceled: "subscription_cancelled",
    cancellation: "subscription_cancelled",
    subscription_expired: "subscription_expired",
    access_ended: "subscription_expired",
    refund: "refunded",
    refunded: "refunded",
    order_refunded: "refunded",
  };
  const normalized = aliases[value];
  if (!normalized) {
    throw new CommerceProviderPayloadError(
      `${provider}: unbekannter Ereignistyp '${raw}'.`,
    );
  }
  return normalized;
}

function parseMinorAmount(raw: string | null, alreadyMinor: boolean) {
  if (!raw) return null;
  if (/^\d+$/.test(raw)) {
    const numeric = Number(raw);
    return alreadyMinor ? numeric : numeric * 100;
  }
  if (/^\d+(?:[.,]\d{1,2})?$/.test(raw)) {
    return Math.round(Number(raw.replace(",", ".")) * 100);
  }
  throw new CommerceProviderPayloadError("Ungueltiger Geldbetrag.");
}

function parseOptionalDate(raw: string | null) {
  if (!raw) return null;
  const numeric = /^\d{10,13}$/.test(raw) ? Number(raw) : null;
  const date = numeric === null
    ? new Date(raw)
    : new Date(raw.length === 10 ? numeric * 1000 : numeric);
  if (Number.isNaN(date.getTime())) {
    throw new CommerceProviderPayloadError("Ungueltiger Zeitstempel.");
  }
  return date.toISOString();
}

export function normalizeCommerceProviderEvent(
  provider: CommerceProvider,
  fields: FieldMap,
) {
  const rawType = field(fields, [
    "event",
    "event_type",
    "type",
    "event_name",
    "transaction_type",
  ]);
  const externalOrderId = field(fields, [
    "order_id",
    "orderId",
    "purchase_id",
    "transaction_id",
    "invoice_id",
  ]);
  const suppliedEventId = field(
    fields,
    ["event_id", "eventId", "ipn_id", "webhook_id"],
    false,
  );
  const externalEventId = suppliedEventId ?? `synthetic:${createHash("sha256")
    .update(rawType)
    .update("\0")
    .update(externalOrderId)
    .update("\0")
    .update(field(fields, ["timestamp", "created_at", "event_time"], false) ?? "0")
    .digest("hex")}`;
  const amountIsMinor = Boolean(fields.amount_minor || fields.total_minor);
  return normalizedCommerceEventSchema.parse({
    externalEventId,
    type: eventType(provider, rawType),
    externalOrderId,
    externalSubscriptionId: field(
      fields,
      ["subscription_id", "subscriptionId", "billing_id"],
      false,
    ),
    providerProductId: field(fields, [
      "product_id",
      "productId",
      "product",
      "item_id",
    ]),
    providerVariantId: field(
      fields,
      ["variant_id", "product_variant_id", "price_id"],
      false,
    ),
    customerEmail: field(fields, [
      "email",
      "customer_email",
      "buyer_email",
    ]),
    customerFirstName:
      field(fields, ["first_name", "customer_first_name"], false) ?? "Mitglied",
    customerLastName:
      field(fields, ["last_name", "customer_last_name"], false) ?? "",
    currency: field(fields, ["currency", "currency_code"], false),
    totalMinor: parseMinorAmount(
      field(
        fields,
        amountIsMinor
          ? ["amount_minor", "total_minor"]
          : ["amount", "total", "price"],
        false,
      ),
      amountIsMinor,
    ),
    occurredAt: parseOptionalDate(
      field(fields, ["occurred_at", "created_at", "timestamp", "event_time"], false),
    ),
    accessUntil: parseOptionalDate(
      field(fields, ["access_until", "period_end", "paid_until", "next_billing_at"], false),
    ),
  });
}

export function parseProviderBody(rawBody: string, contentType: string | null) {
  if (contentType?.toLowerCase().includes("application/json")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      throw new CommerceProviderPayloadError("Ungueltiger JSON-Body.");
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new CommerceProviderPayloadError("Der Payload muss ein Objekt sein.");
    }
    return Object.fromEntries(
      Object.entries(parsed).flatMap(([key, value]) =>
        typeof value === "string" || typeof value === "number" || typeof value === "boolean"
          ? [[key, String(value)]]
          : [],
      ),
    );
  }
  return Object.fromEntries(new URLSearchParams(rawBody));
}
