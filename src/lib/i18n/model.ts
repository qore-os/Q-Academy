export const SUPPORTED_LOCALES = ["de", "en", "it", "es", "fr"] as const;

export type AppLocale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: AppLocale = "de";

export const LOCALE_OPTIONS: ReadonlyArray<{
  value: AppLocale;
  label: string;
}> = [
  { value: "de", label: "Deutsch" },
  { value: "en", label: "English" },
  { value: "it", label: "Italiano" },
  { value: "es", label: "Español" },
  { value: "fr", label: "Français" },
];

export function isAppLocale(value: unknown): value is AppLocale {
  return (
    typeof value === "string" &&
    SUPPORTED_LOCALES.some((locale) => locale === value)
  );
}

export function normalizeLocale(
  value: unknown,
  fallback: AppLocale = DEFAULT_LOCALE,
): AppLocale {
  return isAppLocale(value) ? value : fallback;
}

export function effectiveLocale(input: {
  preferredLocale?: string | null;
  defaultLocale?: string | null;
}): AppLocale {
  return normalizeLocale(
    input.preferredLocale,
    normalizeLocale(input.defaultLocale),
  );
}

export function intlLocale(locale: AppLocale) {
  return {
    de: "de-DE",
    en: "en-GB",
    it: "it-IT",
    es: "es-ES",
    fr: "fr-FR",
  }[locale];
}

export function openGraphLocale(locale: AppLocale) {
  return intlLocale(locale).replace("-", "_");
}
