import { createHash, createHmac } from "node:crypto";

import {
  commerceSignatureModeIsSupported,
  type CommerceProvider,
  type CommerceSignatureMode,
} from "@/lib/commerce/model";
import {
  normalizeCommerceProviderEvent,
  parseProviderBody,
  verifyCommerceProviderSignature,
} from "@/lib/commerce/provider-adapters";

export class CommerceProviderPreflightError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CommerceProviderPreflightError";
  }
}

const PROVIDER_SIGNATURE_HEADERS: Record<CommerceProvider, string> = {
  digistore24: "x-digistore24-signature",
  ablefy: "x-ablefy-signature",
  copecart: "x-copecart-signature",
};

function fixtureFields(
  provider: CommerceProvider,
  providerProductId: string,
): Record<string, string> {
  if (provider === "ablefy") {
    return {
      event_type: "purchase",
      eventId: "q-academy-preflight-ablefy-v1",
      orderId: "q-academy-preflight-order",
      productId: providerProductId,
      customer_email: "provider-preflight@example.invalid",
      first_name: "Provider",
      last_name: "Preflight",
      currency_code: "EUR",
      amount_minor: "100",
      occurred_at: "2026-01-01T00:00:00.000Z",
    };
  }
  if (provider === "copecart") {
    return {
      transaction_type: "payment",
      webhook_id: "q-academy-preflight-copecart-v1",
      transaction_id: "q-academy-preflight-order",
      item_id: providerProductId,
      buyer_email: "provider-preflight@example.invalid",
      customer_first_name: "Provider",
      customer_last_name: "Preflight",
      currency: "EUR",
      total: "1.00",
      event_time: "2026-01-01T00:00:00.000Z",
    };
  }
  return {
    event: "order_paid",
    ipn_id: "q-academy-preflight-digistore24-v1",
    order_id: "q-academy-preflight-order",
    product_id: providerProductId,
    email: "provider-preflight@example.invalid",
    first_name: "Provider",
    last_name: "Preflight",
    currency: "EUR",
    amount: "1.00",
    timestamp: "2026-01-01T00:00:00.000Z",
  };
}

function digistoreSignature(fields: Readonly<Record<string, string>>, secret: string) {
  const canonical = Object.entries(fields)
    .filter(([key]) => key !== "sha_sign" && key !== "sha_signature")
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, value]) => value)
    .join("");
  return createHash("sha512").update(canonical).update(secret).digest("hex");
}

export function runCommerceProviderAdapterPreflight(input: {
  provider: CommerceProvider;
  signatureMode: CommerceSignatureMode;
  signingSecret: string;
  providerProductId: string;
}) {
  if (
    input.signingSecret.length < 16 ||
    input.signingSecret.length > 4_096
  ) {
    throw new CommerceProviderPreflightError(
      "Das gespeicherte Signaturgeheimnis hat eine ungueltige Laenge.",
    );
  }
  if (
    !commerceSignatureModeIsSupported(input.provider, input.signatureMode)
  ) {
    throw new CommerceProviderPreflightError(
      "Der Signaturmodus ist mit dem Provider nicht kompatibel.",
    );
  }
  if (!input.providerProductId.trim() || input.providerProductId.length > 240) {
    throw new CommerceProviderPreflightError(
      "Fuer den Adapter-Preflight fehlt eine gueltige Produktzuordnung.",
    );
  }

  const fields = fixtureFields(input.provider, input.providerProductId);
  if (input.signatureMode === "digistore_sha512") {
    fields.sha_sign = digistoreSignature(fields, input.signingSecret);
  }
  const rawBody = new URLSearchParams(fields).toString();
  const parsedFields = parseProviderBody(
    rawBody,
    "application/x-www-form-urlencoded",
  );
  const headers = new Headers({
    "content-type": "application/x-www-form-urlencoded",
  });
  if (input.signatureMode === "shared_token") {
    headers.set("x-commerce-token", input.signingSecret);
  } else if (input.signatureMode === "hmac_sha256") {
    headers.set(
      PROVIDER_SIGNATURE_HEADERS[input.provider],
      createHmac("sha256", input.signingSecret).update(rawBody).digest("hex"),
    );
  }

  if (
    !verifyCommerceProviderSignature({
      provider: input.provider,
      mode: input.signatureMode,
      secret: input.signingSecret,
      headers,
      rawBody,
      fields: parsedFields,
    })
  ) {
    throw new CommerceProviderPreflightError(
      "Der lokale Signaturadapter konnte sein Testereignis nicht verifizieren.",
    );
  }
  const event = normalizeCommerceProviderEvent(input.provider, parsedFields);
  if (
    event.type !== "order_created" ||
    event.providerProductId !== input.providerProductId ||
    event.customerEmail !== "provider-preflight@example.invalid"
  ) {
    throw new CommerceProviderPreflightError(
      "Der Provideradapter hat das Testereignis unerwartet normalisiert.",
    );
  }

  return {
    provider: input.provider,
    signatureMode: input.signatureMode,
    signatureVerified: true as const,
    eventType: event.type,
    externalEventId: event.externalEventId,
    providerProductId: event.providerProductId,
    payloadSha256: createHash("sha256").update(rawBody).digest("hex"),
  };
}
