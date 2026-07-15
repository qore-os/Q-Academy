import type { AppLocale } from "@/lib/i18n/model";

type VideoCutsCopy = {
  title: string;
  add: string;
  start: string;
  end: string;
  remove: (number: number) => string;
  empty: string;
  summary: (count: number, seconds: string) => string;
  invalid: string;
};

const copy: Record<AppLocale, VideoCutsCopy> = {
  de: {
    title: "Entfernte Bereiche",
    add: "Schnittbereich hinzufuegen",
    start: "Start (Sek.)",
    end: "Ende (Sek.)",
    remove: (number) => `Schnittbereich ${number} entfernen`,
    empty: "Keine Bereiche entfernt.",
    summary: (count, seconds) =>
      `${count} ${count === 1 ? "Bereich" : "Bereiche"}, ${seconds} s entfernt`,
    invalid:
      "Schnittbereiche duerfen sich nicht ueberlappen und muessen innerhalb des Videoausschnitts liegen.",
  },
  en: {
    title: "Removed segments",
    add: "Add cut segment",
    start: "Start (seconds)",
    end: "End (seconds)",
    remove: (number) => `Remove cut segment ${number}`,
    empty: "No segments removed.",
    summary: (count, seconds) =>
      `${count} ${count === 1 ? "segment" : "segments"}, ${seconds}s removed`,
    invalid: "Cut segments must not overlap and must stay within the video clip.",
  },
  it: {
    title: "Segmenti rimossi",
    add: "Aggiungi segmento di taglio",
    start: "Inizio (secondi)",
    end: "Fine (secondi)",
    remove: (number) => `Rimuovi segmento ${number}`,
    empty: "Nessun segmento rimosso.",
    summary: (count, seconds) =>
      `${count} ${count === 1 ? "segmento" : "segmenti"}, ${seconds}s rimossi`,
    invalid:
      "I segmenti non devono sovrapporsi e devono rimanere entro il video.",
  },
  es: {
    title: "Segmentos eliminados",
    add: "Anadir segmento de corte",
    start: "Inicio (segundos)",
    end: "Fin (segundos)",
    remove: (number) => `Eliminar segmento ${number}`,
    empty: "No hay segmentos eliminados.",
    summary: (count, seconds) =>
      `${count} ${count === 1 ? "segmento" : "segmentos"}, ${seconds}s eliminados`,
    invalid:
      "Los segmentos no pueden solaparse y deben estar dentro del video.",
  },
  fr: {
    title: "Segments supprimes",
    add: "Ajouter un segment de coupe",
    start: "Debut (secondes)",
    end: "Fin (secondes)",
    remove: (number) => `Supprimer le segment ${number}`,
    empty: "Aucun segment supprime.",
    summary: (count, seconds) =>
      `${count} ${count === 1 ? "segment" : "segments"}, ${seconds}s supprimees`,
    invalid:
      "Les segments ne doivent pas se chevaucher et doivent rester dans l'extrait video.",
  },
};

export function getVideoCutsCopy(locale: AppLocale) {
  return copy[locale];
}
