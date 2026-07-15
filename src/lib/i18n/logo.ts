import type { AppLocale } from "@/lib/i18n/model";

const de = {
  home: (platformName: string) => `${platformName} Startseite`,
  logoAlt: (platformName: string) => `${platformName}-Logo`,
  tagline: "Lernplattform",
};

export type LogoCopy = typeof de;

export const logoDictionaries: Record<AppLocale, LogoCopy> = {
  de,
  en: {
    home: (platformName) => `${platformName} home`,
    logoAlt: (platformName) => `${platformName} logo`,
    tagline: "Learning hub",
  },
  it: {
    home: (platformName) => `Pagina iniziale di ${platformName}`,
    logoAlt: (platformName) => `Logo ${platformName}`,
    tagline: "Hub di apprendimento",
  },
  es: {
    home: (platformName) => `Pagina de inicio de ${platformName}`,
    logoAlt: (platformName) => `Logo de ${platformName}`,
    tagline: "Centro de aprendizaje",
  },
  fr: {
    home: (platformName) => `Accueil ${platformName}`,
    logoAlt: (platformName) => `Logo ${platformName}`,
    tagline: "Espace d'apprentissage",
  },
};

export function getLogoCopy(locale: AppLocale): LogoCopy {
  return logoDictionaries[locale];
}
