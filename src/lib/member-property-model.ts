import { z } from "zod";

import type { CustomFieldType, CustomFieldValue } from "@/lib/custom-fields";

export const PERSONALIZABLE_CUSTOM_FIELD_TYPES = [
  "text",
  "number",
  "boolean",
  "date",
  "select",
  "multiselect",
] as const satisfies readonly CustomFieldType[];

export const MEMBER_PROPERTY_FILTER_OPERATORS = [
  "is_set",
  "is_not_set",
  "equals",
  "not_equals",
  "contains",
] as const;

export type MemberPropertyFilterOperator =
  (typeof MEMBER_PROPERTY_FILTER_OPERATORS)[number];

export const memberPropertyAnalyticsQuerySchema = z
  .object({
    fieldId: z.string().uuid().optional(),
    profileDefinitionId: z.string().uuid().optional(),
    operator: z.enum(MEMBER_PROPERTY_FILTER_OPERATORS).default("is_set"),
    value: z.string().trim().max(500).optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if (
      ["equals", "not_equals", "contains"].includes(input.operator) &&
      !input.value
    ) {
      context.addIssue({
        code: "custom",
        path: ["value"],
        message: "Dieser Filter benoetigt einen Vergleichswert.",
      });
    }
  });

export type MemberPropertyAnalyticsQuery = z.infer<
  typeof memberPropertyAnalyticsQuerySchema
>;

export type MemberPropertyVariableDescriptor = {
  token: string;
  emailToken: string;
  label: string;
  fieldId: string;
  fieldKey: string;
  fieldType: CustomFieldType;
  profileDefinitionId: string;
  profileDefinitionKey: string;
  profileDefinitionName: string;
};

const TEMPLATE_TOKEN_PATTERN = /\{\{\s*([A-Za-z][A-Za-z0-9_.]*)\s*\}\}/g;
const PROFILE_TOKEN_PATTERN = /^profile\.([a-z][a-z0-9_]*)\.([a-z][a-z0-9_]*)$/;
const EMAIL_PROFILE_TOKEN_PATTERN = /^profile_([a-z][a-z0-9_]*)_([a-z][a-z0-9_]*)$/;

export function memberPropertyTemplateToken(
  profileDefinitionKey: string,
  fieldKey: string,
) {
  return `profile.${profileDefinitionKey}.${fieldKey}`;
}

export function memberPropertyEmailToken(
  profileDefinitionKey: string,
  fieldKey: string,
) {
  return `profile_${profileDefinitionKey}_${fieldKey}`;
}

export function extractTemplateTokens(value: string) {
  return [...value.matchAll(TEMPLATE_TOKEN_PATTERN)].flatMap((match) =>
    match[1] ? [match[1]] : [],
  );
}

export function validatePersonalizedTemplateText(input: {
  value: string;
  allowedTokens: readonly string[];
  staticTokens?: readonly string[];
  maxPlaceholders?: number;
}) {
  const tokens = extractTemplateTokens(input.value);
  const remainder = input.value.replace(TEMPLATE_TOKEN_PATTERN, "");
  if (remainder.includes("{{") || remainder.includes("}}")) {
    return "Die Vorlage enthaelt eine ungueltige Variable.";
  }
  if (tokens.length > (input.maxPlaceholders ?? 30)) {
    return "Die Vorlage enthaelt zu viele Variablen.";
  }
  const allowed = new Set([
    ...(input.staticTokens ?? []),
    ...input.allowedTokens,
  ]);
  const unknown = tokens.find((token) => !allowed.has(token));
  return unknown
    ? `Die Variable {{${unknown}}} ist in diesem Kontext nicht freigegeben.`
    : null;
}

export function isMemberPropertyTemplateToken(value: string) {
  return PROFILE_TOKEN_PATTERN.test(value);
}

export function isMemberPropertyEmailToken(value: string) {
  return EMAIL_PROFILE_TOKEN_PATTERN.test(value);
}

export function renderPersonalizedTemplateText(
  template: string,
  variables: Readonly<Record<string, string>>,
) {
  return template.replace(
    TEMPLATE_TOKEN_PATTERN,
    (placeholder, token: string) => {
      if (Object.hasOwn(variables, token)) return variables[token]!;
      return isMemberPropertyTemplateToken(token) ? "" : placeholder;
    },
  );
}

function localizedBoolean(value: boolean, locale: string) {
  if (locale === "en") return value ? "Yes" : "No";
  if (locale === "it") return value ? "Si" : "No";
  if (locale === "es") return value ? "Si" : "No";
  if (locale === "fr") return value ? "Oui" : "Non";
  return value ? "Ja" : "Nein";
}

export function presentMemberPropertyValue(
  value: CustomFieldValue,
  type: CustomFieldType,
  locale = "de",
) {
  if (value === null) return "";
  if (type === "boolean" && typeof value === "boolean") {
    return localizedBoolean(value, locale);
  }
  if (Array.isArray(value)) return value.join(", ");
  return String(value)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .trim()
    .slice(0, 1_000);
}

export function memberPropertyValueMatches(input: {
  value: CustomFieldValue;
  operator: MemberPropertyFilterOperator;
  expected?: string;
}) {
  const values = Array.isArray(input.value)
    ? input.value.map(String)
    : input.value === null
      ? []
      : [String(input.value)];
  if (input.operator === "is_set") return values.some((value) => value.trim());
  if (input.operator === "is_not_set") {
    return values.length === 0 || values.every((value) => !value.trim());
  }
  const expected = (input.expected ?? "").trim().toLocaleLowerCase("de");
  const normalized = values.map((value) =>
    value.trim().toLocaleLowerCase("de"),
  );
  if (input.operator === "equals") return normalized.includes(expected);
  if (input.operator === "not_equals") return !normalized.includes(expected);
  return normalized.some((value) => value.includes(expected));
}

export function csvCell(value: unknown) {
  let normalized = String(value ?? "").replace(/\r\n?/g, "\n");
  if (/^[=+\-@\t\r]/.test(normalized)) normalized = `'${normalized}`;
  return `"${normalized.replaceAll('"', '""')}"`;
}
