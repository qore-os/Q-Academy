import type { TranscriptWizardOperation } from "@/lib/ai/transcript-wizard-schema";
import type { AppLocale } from "@/lib/i18n/model";

type TranscriptWizardUiCopy = {
  operations: Record<TranscriptWizardOperation, string>;
  instructionLabel: string;
  instructionPlaceholder: string;
  instructionCount: (current: number, maximum: number) => string;
  responseLabel: string;
  copyResponse: string;
  responseCopied: string;
  responseCopyFailed: string;
};

const copyByLocale = {
  de: {
    operations: {
      mixed: "Zusammenfassung und Aufgaben",
      summary: "Zusammenfassung",
      multiple_choice: "Einfachauswahl aus dem Video",
      true_false: "Wahr/Falsch zum Video",
      multi_select: "Mehrfachauswahl aus dem Video",
      fill_blank: "Lueckentext",
      ordering: "Videoablauf sortieren",
    },
    instructionLabel: "Eigene Anweisung (optional)",
    instructionPlaceholder: "Zum Beispiel: Konzentriere dich auf die Qualitaetspruefung.",
    instructionCount: (current, maximum) => `${current}/${maximum} Zeichen`,
    responseLabel: "Erzeugte Antwort",
    copyResponse: "Antwort kopieren",
    responseCopied: "Antwort kopiert.",
    responseCopyFailed: "Die Antwort konnte nicht kopiert werden.",
  },
  en: {
    operations: {
      mixed: "Summary and activities",
      summary: "Summary",
      multiple_choice: "Single choice from the video",
      true_false: "True/false about the video",
      multi_select: "Multiple choice from the video",
      fill_blank: "Fill in the blank",
      ordering: "Order the video sequence",
    },
    instructionLabel: "Custom instruction (optional)",
    instructionPlaceholder: "For example: Focus on the quality review.",
    instructionCount: (current, maximum) => `${current}/${maximum} characters`,
    responseLabel: "Generated response",
    copyResponse: "Copy response",
    responseCopied: "Response copied.",
    responseCopyFailed: "The response could not be copied.",
  },
  it: {
    operations: {
      mixed: "Riepilogo e attivita",
      summary: "Riepilogo",
      multiple_choice: "Scelta singola dal video",
      true_false: "Vero/falso sul video",
      multi_select: "Scelta multipla dal video",
      fill_blank: "Testo con lacune",
      ordering: "Ordina la sequenza video",
    },
    instructionLabel: "Istruzione personalizzata (facoltativa)",
    instructionPlaceholder: "Ad esempio: concentrati sulla verifica della qualita.",
    instructionCount: (current, maximum) => `${current}/${maximum} caratteri`,
    responseLabel: "Risposta generata",
    copyResponse: "Copia risposta",
    responseCopied: "Risposta copiata.",
    responseCopyFailed: "Non e stato possibile copiare la risposta.",
  },
  es: {
    operations: {
      mixed: "Resumen y actividades",
      summary: "Resumen",
      multiple_choice: "Seleccion unica del video",
      true_false: "Verdadero/falso sobre el video",
      multi_select: "Seleccion multiple del video",
      fill_blank: "Texto con huecos",
      ordering: "Ordenar la secuencia del video",
    },
    instructionLabel: "Instruccion personalizada (opcional)",
    instructionPlaceholder: "Por ejemplo: centrate en la revision de calidad.",
    instructionCount: (current, maximum) => `${current}/${maximum} caracteres`,
    responseLabel: "Respuesta generada",
    copyResponse: "Copiar respuesta",
    responseCopied: "Respuesta copiada.",
    responseCopyFailed: "No se pudo copiar la respuesta.",
  },
  fr: {
    operations: {
      mixed: "Resume et activites",
      summary: "Resume",
      multiple_choice: "Choix unique depuis la video",
      true_false: "Vrai/faux sur la video",
      multi_select: "Choix multiple depuis la video",
      fill_blank: "Texte a trous",
      ordering: "Classer la sequence video",
    },
    instructionLabel: "Instruction personnalisee (facultative)",
    instructionPlaceholder: "Par exemple : concentrez-vous sur le controle qualite.",
    instructionCount: (current, maximum) => `${current}/${maximum} caracteres`,
    responseLabel: "Reponse generee",
    copyResponse: "Copier la reponse",
    responseCopied: "Reponse copiee.",
    responseCopyFailed: "La reponse n'a pas pu etre copiee.",
  },
} satisfies Record<AppLocale, TranscriptWizardUiCopy>;

export function getTranscriptWizardUiCopy(locale: AppLocale) {
  return copyByLocale[locale];
}
