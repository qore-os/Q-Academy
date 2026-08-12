import type { AppLocale } from "@/lib/i18n/model";

type MediaUploadCopy = {
  transferring: string;
  dropActiveSingle: string;
  dropActiveMultiple: string;
};

const copy: Record<AppLocale, MediaUploadCopy> = {
  de: {
    transferring: "Datei wird übertragen",
    dropActiveSingle: "Datei hier ablegen",
    dropActiveMultiple: "Dateien hier ablegen",
  },
  en: {
    transferring: "Transferring file",
    dropActiveSingle: "Drop file here",
    dropActiveMultiple: "Drop files here",
  },
  it: {
    transferring: "Trasferimento del file",
    dropActiveSingle: "Rilascia il file qui",
    dropActiveMultiple: "Rilascia i file qui",
  },
  es: {
    transferring: "Transfiriendo archivo",
    dropActiveSingle: "Suelta el archivo aquí",
    dropActiveMultiple: "Suelta los archivos aquí",
  },
  fr: {
    transferring: "Transfert du fichier",
    dropActiveSingle: "Déposer le fichier ici",
    dropActiveMultiple: "Déposer les fichiers ici",
  },
};

export function getMediaUploadCopy(locale: AppLocale) {
  return copy[locale];
}
