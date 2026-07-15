import type { AppLocale } from "@/lib/i18n/model";

const copies = {
  de: {
    timezone: "Event-Zeitzone",
    timezoneHint: "Beginn und Ende werden in dieser Zeitzone eingegeben.",
    designTitle: "Kalender-Design",
    designDescription: "Gestaltung fuer den gesamten Event-Plan der Organisation.",
    presets: "Vorlagen",
    clear: "Klar",
    contrast: "Kontrast",
    warm: "Warm",
    background: "Hintergrund",
    surface: "Eventflaeche",
    border: "Rahmen",
    heading: "Ueberschriften",
    body: "Fliesstext",
    accent: "Akzent",
    live: "Live-Status",
    cancelled: "Absage-Status",
    density: "Dichte",
    comfortable: "Komfortabel",
    compact: "Kompakt",
    radius: "Kartenradius",
    preview: "Kalendervorschau",
    previewTitle: "Naechster Live-Termin",
    previewBody: "Vorschau fuer Farben, Dichte und Kartenform.",
    save: "Design speichern",
    saving: "Wird gespeichert",
    saved: "Kalender-Design gespeichert.",
    failed: "Das Kalender-Design konnte nicht gespeichert werden.",
    contrastError: "Text- und Statusfarben brauchen mindestens WCAG-AA-Kontrast.",
  },
  en: {
    timezone: "Event time zone", timezoneHint: "Start and end are entered in this time zone.", designTitle: "Calendar design", designDescription: "Design for the organisation's complete event plan.", presets: "Presets", clear: "Clear", contrast: "Contrast", warm: "Warm", background: "Background", surface: "Event surface", border: "Border", heading: "Headings", body: "Body text", accent: "Accent", live: "Live status", cancelled: "Cancellation status", density: "Density", comfortable: "Comfortable", compact: "Compact", radius: "Card radius", preview: "Calendar preview", previewTitle: "Next live event", previewBody: "Preview for colours, density and card shape.", save: "Save design", saving: "Saving", saved: "Calendar design saved.", failed: "Calendar design could not be saved.", contrastError: "Text and status colours need at least WCAG AA contrast.",
  },
  it: {
    timezone: "Fuso orario dell'evento", timezoneHint: "Inizio e fine vengono inseriti in questo fuso orario.", designTitle: "Design del calendario", designDescription: "Aspetto dell'intero piano eventi dell'organizzazione.", presets: "Modelli", clear: "Chiaro", contrast: "Contrasto", warm: "Caldo", background: "Sfondo", surface: "Superficie evento", border: "Bordo", heading: "Titoli", body: "Testo", accent: "Accento", live: "Stato live", cancelled: "Stato annullato", density: "Densita", comfortable: "Comoda", compact: "Compatta", radius: "Raggio scheda", preview: "Anteprima calendario", previewTitle: "Prossimo evento live", previewBody: "Anteprima di colori, densita e forma.", save: "Salva design", saving: "Salvataggio", saved: "Design del calendario salvato.", failed: "Impossibile salvare il design del calendario.", contrastError: "I colori di testo e stato richiedono almeno il contrasto WCAG AA.",
  },
  es: {
    timezone: "Zona horaria del evento", timezoneHint: "El inicio y el final se introducen en esta zona horaria.", designTitle: "Diseno del calendario", designDescription: "Aspecto de todo el plan de eventos de la organizacion.", presets: "Plantillas", clear: "Claro", contrast: "Contraste", warm: "Calido", background: "Fondo", surface: "Superficie del evento", border: "Borde", heading: "Titulos", body: "Texto", accent: "Acento", live: "Estado en directo", cancelled: "Estado cancelado", density: "Densidad", comfortable: "Comoda", compact: "Compacta", radius: "Radio de tarjeta", preview: "Vista previa", previewTitle: "Proximo evento en directo", previewBody: "Vista previa de colores, densidad y forma.", save: "Guardar diseno", saving: "Guardando", saved: "Diseno del calendario guardado.", failed: "No se pudo guardar el diseno del calendario.", contrastError: "Los colores de texto y estado necesitan al menos contraste WCAG AA.",
  },
  fr: {
    timezone: "Fuseau horaire de l'evenement", timezoneHint: "Le debut et la fin sont saisis dans ce fuseau horaire.", designTitle: "Design du calendrier", designDescription: "Aspect de l'ensemble du planning d'evenements de l'organisation.", presets: "Modeles", clear: "Clair", contrast: "Contraste", warm: "Chaleureux", background: "Arriere-plan", surface: "Surface de l'evenement", border: "Bordure", heading: "Titres", body: "Texte", accent: "Accent", live: "Statut en direct", cancelled: "Statut annule", density: "Densite", comfortable: "Confortable", compact: "Compacte", radius: "Rayon des cartes", preview: "Apercu du calendrier", previewTitle: "Prochain evenement en direct", previewBody: "Apercu des couleurs, de la densite et de la forme.", save: "Enregistrer le design", saving: "Enregistrement", saved: "Design du calendrier enregistre.", failed: "Le design du calendrier n'a pas pu etre enregistre.", contrastError: "Les couleurs de texte et d'etat exigent au moins un contraste WCAG AA.",
  },
} as const;

export function getEventCalendarCopy(locale: AppLocale) {
  return copies[locale];
}
