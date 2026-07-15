import type { AppLocale } from "@/lib/i18n/model";

type CourseIntegrationCopy = {
  provider: string;
  providerHint: string;
  layout: string;
  layouts: Record<"video" | "standard" | "form", string>;
  consentTitle: (provider: string) => string;
  consentDescription: (provider: string) => string;
  loadContent: string;
};

const dictionaries: Record<AppLocale, CourseIntegrationCopy> = {
  de: {
    provider: "Integrationsanbieter",
    providerHint:
      "Die URL muss zum ausgewaehlten, freigegebenen Anbieter passen.",
    layout: "Rahmenformat",
    layouts: {
      video: "Video 16:9",
      standard: "Standard 4:3",
      form: "Langes Formular",
    },
    consentTitle: (provider) => `${provider}-Inhalt laden`,
    consentDescription: (provider) =>
      `Beim Laden wird eine Verbindung zu ${provider} hergestellt. Dabei koennen personenbezogene Daten an den Anbieter uebertragen werden.`,
    loadContent: "Inhalt laden",
  },
  en: {
    provider: "Integration provider",
    providerHint: "The URL must match the selected approved provider.",
    layout: "Frame layout",
    layouts: {
      video: "Video 16:9",
      standard: "Standard 4:3",
      form: "Long form",
    },
    consentTitle: (provider) => `Load ${provider} content`,
    consentDescription: (provider) =>
      `Loading connects to ${provider}. Personal data may be transferred to the provider.`,
    loadContent: "Load content",
  },
  it: {
    provider: "Provider di integrazione",
    providerHint: "L'URL deve corrispondere al provider approvato selezionato.",
    layout: "Formato del riquadro",
    layouts: {
      video: "Video 16:9",
      standard: "Standard 4:3",
      form: "Modulo lungo",
    },
    consentTitle: (provider) => `Carica contenuto ${provider}`,
    consentDescription: (provider) =>
      `Il caricamento stabilisce una connessione con ${provider}. I dati personali possono essere trasmessi al provider.`,
    loadContent: "Carica contenuto",
  },
  es: {
    provider: "Proveedor de integracion",
    providerHint:
      "La URL debe coincidir con el proveedor aprobado seleccionado.",
    layout: "Formato del marco",
    layouts: {
      video: "Video 16:9",
      standard: "Estandar 4:3",
      form: "Formulario largo",
    },
    consentTitle: (provider) => `Cargar contenido de ${provider}`,
    consentDescription: (provider) =>
      `Al cargarlo se establece una conexion con ${provider}. Es posible que se transfieran datos personales al proveedor.`,
    loadContent: "Cargar contenido",
  },
  fr: {
    provider: "Fournisseur d'integration",
    providerHint:
      "L'URL doit correspondre au fournisseur approuve selectionne.",
    layout: "Format du cadre",
    layouts: {
      video: "Video 16:9",
      standard: "Standard 4:3",
      form: "Formulaire long",
    },
    consentTitle: (provider) => `Charger le contenu ${provider}`,
    consentDescription: (provider) =>
      `Le chargement etablit une connexion avec ${provider}. Des donnees personnelles peuvent etre transmises au fournisseur.`,
    loadContent: "Charger le contenu",
  },
};

export function getCourseIntegrationCopy(locale: AppLocale) {
  return dictionaries[locale];
}
