export const MAX_WEBHOOK_DELIVERY_ATTEMPTS = 6;

export type WebhookDeliveryStatus =
  | "pending"
  | "processing"
  | "delivered"
  | "failed"
  | "retrying";

export type WebhookDeliveryFailureKind =
  | "http"
  | "timeout"
  | "dns"
  | "tls"
  | "connection"
  | "configuration"
  | "unknown";

export type WebhookDeliveryPayloadSummary = {
  id: string | null;
  type: string | null;
  createdAt: string | null;
  dataKeys: string[];
};

export type WebhookDeliveryAttempt = {
  id: string;
  replayGeneration: number;
  attempt: number;
  outcome: "delivered" | "retrying" | "failed";
  responseStatus: number | null;
  responseBodyRedacted: boolean;
  failureKind: WebhookDeliveryFailureKind | null;
  durationMs: number;
  startedAt: string;
  completedAt: string;
};

export type WebhookDeliverySummary = {
  id: string;
  webhookId: string;
  webhookName: string;
  event: string;
  status: WebhookDeliveryStatus;
  attempt: number;
  maxAttempts: number;
  responseStatus: number | null;
  responseSummary: string | null;
  responseBodyRedacted: boolean;
  failureKind: WebhookDeliveryFailureKind | null;
  durationMs: number | null;
  nextRetryAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
  updatedAt: string;
  replayable: boolean;
};

export type WebhookDeliveryDetail = WebhookDeliverySummary & {
  payload: WebhookDeliveryPayloadSummary;
  attempts: WebhookDeliveryAttempt[];
};

type DeliveryForPresentation = {
  id: string;
  webhookId: string;
  webhookName: string;
  event: string;
  payload: Record<string, unknown>;
  status: WebhookDeliveryStatus;
  attempt: number;
  responseStatus: number | null;
  responseBody: string | null;
  durationMs: number | null;
  nextRetryAt: Date | null;
  deliveredAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

function readPayloadString(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  return typeof value === "string" ? value.slice(0, 240) : null;
}

function readPayloadDateTime(payload: Record<string, unknown>, key: string) {
  const value = readPayloadString(payload, key);
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function summarizeWebhookDeliveryPayload(
  payload: Record<string, unknown>,
): WebhookDeliveryPayloadSummary {
  const data = payload.data;
  const dataKeys =
    typeof data === "object" && data !== null && !Array.isArray(data)
      ? Object.keys(data).slice(0, 20)
      : [];
  return {
    id: readPayloadString(payload, "id"),
    type: readPayloadString(payload, "type"),
    createdAt: readPayloadDateTime(payload, "createdAt"),
    dataKeys,
  };
}

export function describeWebhookDeliveryResponse(input: {
  responseStatus: number | null;
  responseBody: string | null;
}): {
  summary: string | null;
  bodyRedacted: boolean;
  failureKind: WebhookDeliveryFailureKind | null;
} {
  if (input.responseStatus !== null) {
    return {
      summary: `Das Zielsystem antwortete mit HTTP ${input.responseStatus}. Der Antwortinhalt wird aus Sicherheitsgruenden nicht angezeigt.`,
      bodyRedacted: Boolean(input.responseBody),
      failureKind:
        input.responseStatus >= 200 && input.responseStatus < 300
          ? null
          : "http",
    };
  }
  if (!input.responseBody) {
    return { summary: null, bodyRedacted: false, failureKind: null };
  }

  const message = input.responseBody.toLowerCase();
  if (
    message.includes("zeitlimit") ||
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("etimedout")
  ) {
    return {
      summary: "Das Zeitlimit fuer die Verbindung zum Zielsystem wurde ueberschritten.",
      bodyRedacted: true,
      failureKind: "timeout",
    };
  }
  if (message.includes("enotfound") || message.includes("getaddrinfo") || message.includes("dns")) {
    return {
      summary: "Die DNS-Aufloesung des Zielsystems ist fehlgeschlagen.",
      bodyRedacted: true,
      failureKind: "dns",
    };
  }
  if (
    message.includes("certificate") ||
    message.includes("tls") ||
    message.includes("ssl")
  ) {
    return {
      summary: "Die sichere TLS-Verbindung zum Zielsystem ist fehlgeschlagen.",
      bodyRedacted: true,
      failureKind: "tls",
    };
  }
  if (
    message.includes("deaktiviert") ||
    message.includes("keine sichere adresse") ||
    message.includes("nicht erlaubt")
  ) {
    return {
      summary: "Die Webhook-Konfiguration verhindert derzeit eine Zustellung.",
      bodyRedacted: true,
      failureKind: "configuration",
    };
  }
  if (
    message.includes("econnrefused") ||
    message.includes("econnreset") ||
    message.includes("socket") ||
    message.includes("verbindung")
  ) {
    return {
      summary: "Die Verbindung zum Zielsystem ist fehlgeschlagen.",
      bodyRedacted: true,
      failureKind: "connection",
    };
  }
  return {
    summary: "Die Zustellung ist fehlgeschlagen. Technische Antwortdetails wurden aus Sicherheitsgruenden ausgeblendet.",
    bodyRedacted: true,
    failureKind: "unknown",
  };
}

export function presentWebhookDelivery(
  delivery: DeliveryForPresentation,
  attempts: WebhookDeliveryAttempt[] = [],
): WebhookDeliveryDetail {
  const response = describeWebhookDeliveryResponse(delivery);
  return {
    id: delivery.id,
    webhookId: delivery.webhookId,
    webhookName: delivery.webhookName,
    event: delivery.event,
    status: delivery.status,
    attempt: delivery.attempt,
    maxAttempts: MAX_WEBHOOK_DELIVERY_ATTEMPTS,
    responseStatus: delivery.responseStatus,
    responseSummary: response.summary,
    responseBodyRedacted: response.bodyRedacted,
    failureKind: response.failureKind,
    durationMs: delivery.durationMs,
    nextRetryAt: delivery.nextRetryAt?.toISOString() ?? null,
    deliveredAt: delivery.deliveredAt?.toISOString() ?? null,
    createdAt: delivery.createdAt.toISOString(),
    updatedAt: delivery.updatedAt.toISOString(),
    replayable: delivery.status === "failed",
    payload: summarizeWebhookDeliveryPayload(delivery.payload),
    attempts,
  };
}

export function toWebhookDeliverySummary(
  detail: WebhookDeliveryDetail,
): WebhookDeliverySummary {
  const { payload, attempts, ...summary } = detail;
  void payload;
  void attempts;
  return summary;
}
