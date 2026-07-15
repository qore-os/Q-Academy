import { z } from "zod";

function normalizedHttpsUrl(value: string) {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      !url.hostname ||
      url.hostname === "localhost"
    ) {
      return null;
    }
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

export const tenantLegalUrlSchema = z
  .string()
  .trim()
  .max(2_000)
  .nullable()
  .refine(
    (value) => value === null || normalizedHttpsUrl(value) !== null,
    "Rechtliche Links muessen oeffentliche HTTPS-URLs ohne Zugangsdaten sein.",
  )
  .transform((value) => (value === null ? null : normalizedHttpsUrl(value)));

export function safeTenantLegalUrl(value: unknown) {
  const parsed = tenantLegalUrlSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
