import type { AppLocale } from "@/lib/i18n/model";

const copies = {
  de: {
    title: "Audio-Mehrspur",
    addTrack: "Audiospur hinzufuegen",
    empty: "Keine zusaetzliche Audiospur",
    track: (index: number) => `Audiospur ${index}`,
    audioSource: "Audioquelle",
    timelineStart: "Start auf Timeline (Sek.)",
    sourceStart: "Quellstart (Sek.)",
    sourceEnd: "Quellende (Sek., optional)",
    volume: "Lautstaerke",
    remove: (index: number) => `Audiospur ${index} entfernen`,
    maxTracks: "Maximal 8 Audiospuren",
    invalid:
      "Bitte Quellen, Zeitbereiche und Lautstaerken aller Audiospuren pruefen.",
    playbackUnavailable:
      "Die gerenderte Mehrspur-Version ist derzeit nicht verfuegbar. Bitte versuche es spaeter erneut.",
  },
  en: {
    title: "Audio multitrack",
    addTrack: "Add audio track",
    empty: "No additional audio track",
    track: (index: number) => `Audio track ${index}`,
    audioSource: "Audio source",
    timelineStart: "Timeline start (seconds)",
    sourceStart: "Source start (seconds)",
    sourceEnd: "Source end (seconds, optional)",
    volume: "Volume",
    remove: (index: number) => `Remove audio track ${index}`,
    maxTracks: "Maximum 8 audio tracks",
    invalid: "Check the source, time range and volume of every audio track.",
    playbackUnavailable:
      "The rendered multitrack version is currently unavailable. Please try again later.",
  },
  it: {
    title: "Audio multitraccia",
    addTrack: "Aggiungi traccia audio",
    empty: "Nessuna traccia audio aggiuntiva",
    track: (index: number) => `Traccia audio ${index}`,
    audioSource: "Sorgente audio",
    timelineStart: "Inizio timeline (secondi)",
    sourceStart: "Inizio sorgente (secondi)",
    sourceEnd: "Fine sorgente (secondi, facoltativa)",
    volume: "Volume",
    remove: (index: number) => `Rimuovi traccia audio ${index}`,
    maxTracks: "Massimo 8 tracce audio",
    invalid: "Controlla sorgente, intervallo e volume di ogni traccia audio.",
    playbackUnavailable:
      "La versione multitraccia renderizzata non e al momento disponibile. Riprova piu tardi.",
  },
  es: {
    title: "Audio multipista",
    addTrack: "Anadir pista de audio",
    empty: "Sin pista de audio adicional",
    track: (index: number) => `Pista de audio ${index}`,
    audioSource: "Fuente de audio",
    timelineStart: "Inicio en la linea de tiempo (segundos)",
    sourceStart: "Inicio de la fuente (segundos)",
    sourceEnd: "Fin de la fuente (segundos, opcional)",
    volume: "Volumen",
    remove: (index: number) => `Eliminar pista de audio ${index}`,
    maxTracks: "Maximo 8 pistas de audio",
    invalid: "Comprueba la fuente, el intervalo y el volumen de cada pista.",
    playbackUnavailable:
      "La version multipista renderizada no esta disponible en este momento. Intentalo de nuevo mas tarde.",
  },
  fr: {
    title: "Audio multipiste",
    addTrack: "Ajouter une piste audio",
    empty: "Aucune piste audio supplementaire",
    track: (index: number) => `Piste audio ${index}`,
    audioSource: "Source audio",
    timelineStart: "Debut sur la chronologie (secondes)",
    sourceStart: "Debut de la source (secondes)",
    sourceEnd: "Fin de la source (secondes, facultative)",
    volume: "Volume",
    remove: (index: number) => `Supprimer la piste audio ${index}`,
    maxTracks: "Maximum 8 pistes audio",
    invalid: "Verifiez la source, la plage et le volume de chaque piste audio.",
    playbackUnavailable:
      "La version multipiste rendue est actuellement indisponible. Reessayez plus tard.",
  },
} as const;

export function getVideoCompositionCopy(locale: AppLocale) {
  return copies[locale] ?? copies.de;
}
