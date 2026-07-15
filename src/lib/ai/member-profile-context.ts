import "server-only";

import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import {
  customFieldDefinitions,
  customFieldValues,
  dataProfileValues,
  memberDataProfiles,
} from "@/db/schema";
import { sanitizeAiReferenceText } from "@/lib/ai/grounding";

export type AiMemberProfileContextEntry = Readonly<{
  fieldId: string;
  label: string;
  value: string;
}>;

function safeProfileValue(type: string, value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  if (type === "media") return "Medienwert hinterlegt";
  if (type === "url") return "Link hinterlegt";
  if (typeof value === "boolean") return value ? "Ja" : "Nein";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (Array.isArray(value)) {
    const rendered = value
      .filter((entry): entry is string => typeof entry === "string")
      .slice(0, 20)
      .map((entry) => sanitizeAiReferenceText(entry, 120))
      .filter(Boolean)
      .join(", ");
    return rendered || null;
  }
  return typeof value === "string"
    ? sanitizeAiReferenceText(value, 300) || null
    : null;
}

export async function getAiMemberProfileContext(input: {
  organizationId: string;
  userId: string;
  fieldIds: readonly string[];
}): Promise<AiMemberProfileContextEntry[]> {
  const fieldIds = [...new Set(input.fieldIds)].slice(0, 25);
  if (!fieldIds.length) return [];

  const definitions = await db
    .select({
      id: customFieldDefinitions.id,
      label: customFieldDefinitions.label,
      type: customFieldDefinitions.type,
    })
    .from(customFieldDefinitions)
    .where(
      and(
        eq(customFieldDefinitions.organizationId, input.organizationId),
        eq(customFieldDefinitions.active, true),
        eq(customFieldDefinitions.visibility, "member"),
        inArray(customFieldDefinitions.id, fieldIds),
      ),
    );
  if (!definitions.length) return [];
  const allowedIds = definitions.map((field) => field.id);

  const [profileValues, legacyValues] = await Promise.all([
    db
      .select({ fieldId: dataProfileValues.fieldId, value: dataProfileValues.value })
      .from(dataProfileValues)
      .innerJoin(
        memberDataProfiles,
        and(
          eq(memberDataProfiles.id, dataProfileValues.profileId),
          eq(memberDataProfiles.organizationId, dataProfileValues.organizationId),
          eq(memberDataProfiles.userId, dataProfileValues.userId),
          eq(memberDataProfiles.active, true),
          eq(memberDataProfiles.isDefault, true),
        ),
      )
      .where(
        and(
          eq(dataProfileValues.organizationId, input.organizationId),
          eq(dataProfileValues.userId, input.userId),
          inArray(dataProfileValues.fieldId, allowedIds),
        ),
      ),
    db
      .select({ fieldId: customFieldValues.fieldId, value: customFieldValues.value })
      .from(customFieldValues)
      .where(
        and(
          eq(customFieldValues.organizationId, input.organizationId),
          eq(customFieldValues.userId, input.userId),
          inArray(customFieldValues.fieldId, allowedIds),
        ),
      ),
  ]);
  const values = new Map(legacyValues.map((entry) => [entry.fieldId, entry.value]));
  for (const entry of profileValues) values.set(entry.fieldId, entry.value);
  const definitionsById = new Map(definitions.map((field) => [field.id, field]));

  let totalCharacters = 0;
  return fieldIds.flatMap((fieldId) => {
    const field = definitionsById.get(fieldId);
    if (!field) return [];
    const value = safeProfileValue(field.type, values.get(fieldId));
    if (!value) return [];
    const label = sanitizeAiReferenceText(field.label, 160);
    if (!label || totalCharacters + label.length + value.length > 3_500) return [];
    totalCharacters += label.length + value.length;
    return [{ fieldId, label, value }];
  });
}

export function appendAiAgentAdditionalPrompts(
  systemPrompt: string,
  prompts: readonly { label: string; prompt: string }[],
) {
  const additions = prompts
    .slice(0, 20)
    .flatMap((entry) => {
      const label = sanitizeAiReferenceText(entry.label, 120);
      const prompt = sanitizeAiReferenceText(entry.prompt, 4_000);
      return label && prompt ? [`${label}: ${prompt}`] : [];
    });
  if (!additions.length) return systemPrompt;
  return `${systemPrompt}\n\nZusaetzliche, vom Academy-Admin konfigurierte Leitlinien:\n${additions
    .map((entry) => `- ${entry}`)
    .join("\n")}`;
}
