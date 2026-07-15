export const customFieldTypes = [
  "text",
  "number",
  "boolean",
  "date",
  "select",
  "multiselect",
  "url",
  "media",
] as const;

export type CustomFieldType = (typeof customFieldTypes)[number];
export type CustomFieldValue = string | number | boolean | string[] | null;

export type CustomFieldValidationShape = {
  type: CustomFieldType;
  required: boolean;
  options: string[];
};

export const customFieldTypeLabels: Record<CustomFieldType, string> = {
  text: "Text",
  number: "Zahl",
  boolean: "Ja / Nein",
  date: "Datum",
  select: "Auswahl",
  multiselect: "Mehrfachauswahl",
  url: "URL",
  media: "Medium",
};

export function normalizeCustomFieldOptions(value: string) {
  return [
    ...new Set(
      value
        .split(/\r?\n/)
        .map((option) => option.trim())
        .filter(Boolean),
    ),
  ];
}

export function isValidCustomFieldValue(
  field: CustomFieldValidationShape,
  value: CustomFieldValue,
) {
  if (value === null) return !field.required;

  switch (field.type) {
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "boolean":
      return typeof value === "boolean";
    case "multiselect":
      return (
        Array.isArray(value) &&
        value.every((option) => field.options.includes(option)) &&
        new Set(value).size === value.length &&
        (!field.required || value.length > 0)
      );
    case "select":
      return typeof value === "string" && field.options.includes(value);
    case "date":
      if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return false;
      }
      const date = new Date(`${value}T00:00:00Z`);
      return (
        !Number.isNaN(date.getTime()) &&
        date.toISOString().slice(0, 10) === value
      );
    case "url":
      if (typeof value !== "string" || value.length > 2_000) return false;
      try {
        const url = new URL(value);
        return url.protocol === "http:" || url.protocol === "https:";
      } catch {
        return false;
      }
    case "media":
      return (
        typeof value === "string" &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          value,
        )
      );
    case "text":
      return (
        typeof value === "string" &&
        value.length <= 10_000 &&
        (!field.required || value.trim().length > 0)
      );
  }
}
