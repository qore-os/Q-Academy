import { z } from "zod";

import type { HubLayout, HubLayoutWidget } from "@/db/schema";
import { HUB_CUSTOM_CODE_MAX_LENGTH } from "@/lib/hub-custom-code-policy";
import { safeHubEmbedUrl } from "@/lib/hub-embed-policy";

const uuidSchema = z.string().uuid();
const widgetTypes = new Set([
  "link",
  "text",
  "contact",
  "stat",
  "event",
  "data_form",
  "ai_agent",
  "embed",
  "code",
]);

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function optionalText(value: unknown, maxLength: number) {
  return typeof value === "string" && value.length <= maxLength
    ? value
    : undefined;
}

function safeHref(value: unknown) {
  if (typeof value !== "string" || value.length > 2000) return undefined;
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

function publicWidget(value: unknown): HubLayoutWidget | null {
  const candidate = record(value);
  if (!candidate || !widgetTypes.has(candidate.type as string)) return null;
  if (
    typeof candidate.title !== "string" ||
    !candidate.title.trim() ||
    candidate.title.length > 180
  ) {
    return null;
  }
  const description = optionalText(
    candidate.description,
    candidate.type === "code" ? HUB_CUSTOM_CODE_MAX_LENGTH : 2000,
  );
  const base = {
    title: candidate.title.trim(),
    ...(description !== undefined ? { description } : {}),
    ...(optionalText(candidate.color, 20) !== undefined
      ? { color: optionalText(candidate.color, 20) }
      : {}),
  };

  if (candidate.type === "ai_agent") {
    const agentId = uuidSchema.safeParse(candidate.agentId);
    return agentId.success
      ? { ...base, type: "ai_agent", agentId: agentId.data }
      : null;
  }
  if (candidate.type === "data_form") {
    const formId = uuidSchema.safeParse(candidate.formId);
    return formId.success
      ? { ...base, type: "data_form", formId: formId.data }
      : null;
  }
  if (candidate.type === "embed") {
    const href = safeHubEmbedUrl(candidate.href);
    return href ? { ...base, type: "embed", href } : null;
  }
  if (candidate.type === "code") {
    return description?.trim() ? { ...base, type: "code" } : null;
  }
  const type = candidate.type as Exclude<
    HubLayoutWidget["type"],
    "ai_agent" | "data_form" | "embed" | "code"
  >;
  const href = safeHref(candidate.href);
  return { ...base, type, ...(href ? { href } : {}) };
}

export function publicHubLayout(value: unknown): HubLayout {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 30).flatMap((rawRow) => {
    const row = record(rawRow);
    if (
      !row ||
      typeof row.id !== "string" ||
      !row.id ||
      row.id.length > 120 ||
      !Array.isArray(row.columns)
    ) {
      return [];
    }
    return [
      {
        id: row.id,
        ...(typeof row.category === "string" && row.category.trim()
          ? { category: row.category.trim().slice(0, 80) }
          : {}),
        columns: row.columns
          .slice(0, 12)
          .map(publicWidget)
          .filter((widget): widget is HubLayoutWidget => Boolean(widget)),
      },
    ];
  });
}

export function hubLayoutAiAgentIds(layout: unknown) {
  return [
    ...new Set(
      publicHubLayout(layout).flatMap((row) =>
        row.columns.flatMap((widget) =>
          widget.type === "ai_agent" ? [widget.agentId] : [],
        ),
      ),
    ),
  ];
}

export function publicHubRecord<T extends { layout: unknown }>(hub: T) {
  return { ...hub, layout: publicHubLayout(hub.layout) };
}
