import type { AppLocale } from "@/lib/i18n/model";

export type PlatformCustomCodeMessageCode =
  | "invalid"
  | "changed"
  | "saved"
  | "failed";

type Copy = {
  title: string;
  description: string;
  ownerOnly: string;
  enabled: string;
  header: string;
  footer: string;
  code: string;
  height: string;
  hiddenHeight: string;
  origins: string;
  originsPlaceholder: string;
  isolation: string;
  preview: string;
  save: string;
  saving: string;
  messages: Record<PlatformCustomCodeMessageCode, string>;
};

const dictionaries: Record<AppLocale, Copy> = {
  de: {
    title: "Header- und Footer-Code",
    description: "Eigene Widgets und Tracking-Skripte in isolierten Plattform-Slots.",
    ownerOnly: "Nur Owner können Plattform-Code ändern.",
    enabled: "Plattform-Code aktiv",
    header: "Header-Slot",
    footer: "Footer-Slot",
    code: "HTML, CSS und JavaScript",
    height: "Slot-Höhe in Pixeln",
    hiddenHeight: "0 blendet den Slot aus, führt den Code aber weiterhin aus.",
    origins: "Erlaubte Netzwerk-Origins",
    originsPlaceholder: "https://www.googletagmanager.com\nhttps://www.google-analytics.com",
    isolation: "Der Code läuft ohne Academy-Cookies, Formulare, Pop-ups oder Zugriff auf die Plattform. Netzwerkzugriffe sind standardmäßig gesperrt und nur für die eingetragenen HTTPS-Origins möglich.",
    preview: "Isolierte Vorschau",
    save: "Plattform-Code speichern",
    saving: "Wird gespeichert",
    messages: {
      invalid: "Bitte den Plattform-Code und die Netzwerk-Origins prüfen.",
      changed: "Die Konfiguration wurde parallel geändert. Lade die Seite neu.",
      saved: "Plattform-Code gespeichert.",
      failed: "Der Plattform-Code konnte nicht gespeichert werden.",
    },
  },
  en: {
    title: "Header and footer code",
    description: "Custom widgets and tracking scripts in isolated platform slots.",
    ownerOnly: "Only owners can change platform code.",
    enabled: "Platform code active",
    header: "Header slot",
    footer: "Footer slot",
    code: "HTML, CSS and JavaScript",
    height: "Slot height in pixels",
    hiddenHeight: "A height of 0 hides the slot while still running its code.",
    origins: "Allowed network origins",
    originsPlaceholder: "https://www.googletagmanager.com\nhttps://www.google-analytics.com",
    isolation: "Code runs without Academy cookies, forms, pop-ups or platform access. Network access is blocked by default and limited to the listed HTTPS origins.",
    preview: "Isolated preview",
    save: "Save platform code",
    saving: "Saving",
    messages: {
      invalid: "Check the platform code and network origins.",
      changed: "The configuration changed concurrently. Reload the page.",
      saved: "Platform code saved.",
      failed: "The platform code could not be saved.",
    },
  },
  it: {
    title: "Codice header e footer",
    description: "Widget e script di tracciamento personalizzati in slot isolati.",
    ownerOnly: "Solo i proprietari possono modificare il codice della piattaforma.",
    enabled: "Codice della piattaforma attivo",
    header: "Slot header",
    footer: "Slot footer",
    code: "HTML, CSS e JavaScript",
    height: "Altezza dello slot in pixel",
    hiddenHeight: "L'altezza 0 nasconde lo slot ma continua a eseguire il codice.",
    origins: "Origin di rete consentite",
    originsPlaceholder: "https://www.googletagmanager.com\nhttps://www.google-analytics.com",
    isolation: "Il codice viene eseguito senza cookie dell'academy, moduli, pop-up o accesso alla piattaforma. La rete è bloccata per impostazione predefinita e limitata alle origin HTTPS elencate.",
    preview: "Anteprima isolata",
    save: "Salva codice piattaforma",
    saving: "Salvataggio",
    messages: {
      invalid: "Controlla il codice della piattaforma e le origin di rete.",
      changed: "La configurazione è stata modificata in parallelo. Ricarica la pagina.",
      saved: "Codice della piattaforma salvato.",
      failed: "Non è stato possibile salvare il codice della piattaforma.",
    },
  },
  es: {
    title: "Código de cabecera y pie",
    description: "Widgets y scripts de seguimiento personalizados en espacios aislados.",
    ownerOnly: "Solo los propietarios pueden cambiar el código de la plataforma.",
    enabled: "Código de plataforma activo",
    header: "Espacio de cabecera",
    footer: "Espacio de pie",
    code: "HTML, CSS y JavaScript",
    height: "Altura del espacio en píxeles",
    hiddenHeight: "La altura 0 oculta el espacio, pero sigue ejecutando el código.",
    origins: "Orígenes de red permitidos",
    originsPlaceholder: "https://www.googletagmanager.com\nhttps://www.google-analytics.com",
    isolation: "El código se ejecuta sin cookies de la academy, formularios, ventanas emergentes ni acceso a la plataforma. La red está bloqueada de forma predeterminada y limitada a los orígenes HTTPS indicados.",
    preview: "Vista previa aislada",
    save: "Guardar código de plataforma",
    saving: "Guardando",
    messages: {
      invalid: "Comprueba el código de la plataforma y los orígenes de red.",
      changed: "La configuración cambió en paralelo. Vuelve a cargar la página.",
      saved: "Código de la plataforma guardado.",
      failed: "No se pudo guardar el código de la plataforma.",
    },
  },
  fr: {
    title: "Code d'en-tête et de pied de page",
    description: "Widgets et scripts de suivi personnalisés dans des emplacements isolés.",
    ownerOnly: "Seuls les propriétaires peuvent modifier le code de la plateforme.",
    enabled: "Code de plateforme actif",
    header: "Emplacement d'en-tête",
    footer: "Emplacement de pied de page",
    code: "HTML, CSS et JavaScript",
    height: "Hauteur de l'emplacement en pixels",
    hiddenHeight: "Une hauteur de 0 masque l'emplacement tout en exécutant son code.",
    origins: "Origines réseau autorisées",
    originsPlaceholder: "https://www.googletagmanager.com\nhttps://www.google-analytics.com",
    isolation: "Le code s'exécute sans cookies de l'academy, formulaires, fenêtres contextuelles ni accès à la plateforme. Le réseau est bloqué par défaut et limité aux origines HTTPS indiquées.",
    preview: "Aperçu isolé",
    save: "Enregistrer le code de plateforme",
    saving: "Enregistrement",
    messages: {
      invalid: "Vérifiez le code de la plateforme et les origines réseau.",
      changed: "La configuration a été modifiée en parallèle. Rechargez la page.",
      saved: "Code de plateforme enregistré.",
      failed: "Le code de plateforme n'a pas pu être enregistré.",
    },
  },
};

export function getPlatformCustomCodeCopy(locale: AppLocale) {
  return dictionaries[locale] ?? dictionaries.de;
}
