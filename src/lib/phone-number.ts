import { z } from "zod";

const PHONE_INPUT_MAX_LENGTH = 64;
const E164_PHONE_PATTERN = /^\+[1-9][0-9]{6,14}$/;

export function normalizeOptionalPhone(value: string | null | undefined) {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > PHONE_INPUT_MAX_LENGTH) return trimmed;

  const international = trimmed.startsWith("00")
    ? `+${trimmed.slice(2)}`
    : trimmed;
  return international.replace(/[\s().-]/g, "");
}

export const optionalPhoneSchema = z.preprocess(
  (value) =>
    typeof value === "string" || value === null || value === undefined
      ? normalizeOptionalPhone(value)
      : value,
  z
    .string()
    .regex(
      E164_PHONE_PATTERN,
      "Die Telefonnummer muss im internationalen Format beginnen, zum Beispiel +491701234567.",
    )
    .max(16)
    .nullable(),
);

