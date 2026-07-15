import type { AppLocale } from "@/lib/i18n/model";

export type StructuredContentCopy = {
  incomplete: string;
  tabsLabel: string;
  copyCode: string;
  copied: string;
  codeLanguage: (language: string) => string;
};

export const structuredContentDictionaries: Record<
  AppLocale,
  StructuredContentCopy
> = {
  de: {
    incomplete: "Inhalt vervollstaendigen",
    tabsLabel: "Inhaltsregister",
    copyCode: "Code kopieren",
    copied: "Kopiert",
    codeLanguage: (language) => `Code: ${language}`,
  },
  en: {
    incomplete: "Complete the content",
    tabsLabel: "Content tabs",
    copyCode: "Copy code",
    copied: "Copied",
    codeLanguage: (language) => `Code: ${language}`,
  },
  it: {
    incomplete: "Completa il contenuto",
    tabsLabel: "Schede dei contenuti",
    copyCode: "Copia codice",
    copied: "Copiato",
    codeLanguage: (language) => `Codice: ${language}`,
  },
  es: {
    incomplete: "Completa el contenido",
    tabsLabel: "Pestanas de contenido",
    copyCode: "Copiar codigo",
    copied: "Copiado",
    codeLanguage: (language) => `Codigo: ${language}`,
  },
  fr: {
    incomplete: "Completer le contenu",
    tabsLabel: "Onglets de contenu",
    copyCode: "Copier le code",
    copied: "Copie",
    codeLanguage: (language) => `Code : ${language}`,
  },
};

export function getStructuredContentCopy(locale: AppLocale) {
  return structuredContentDictionaries[locale];
}
