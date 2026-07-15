import type { AppLocale } from "@/lib/i18n/model";

export type ImageLightboxCopy = {
  dialogTitle: string;
  close: string;
  previous: string;
  next: string;
  thumbnails: string;
  openOriginal: string;
  galleryLabel: string;
  emptyGallery: string;
  position: (current: string, total: string) => string;
  openImage: (name: string) => string;
  selectImage: (position: string, name: string) => string;
};

const dictionaries: Record<AppLocale, ImageLightboxCopy> = {
  de: {
    dialogTitle: "Bildansicht",
    close: "Bildansicht schließen",
    previous: "Vorheriges Bild",
    next: "Nächstes Bild",
    thumbnails: "Bildauswahl",
    openOriginal: "Originalbild öffnen",
    galleryLabel: "Bildergalerie",
    emptyGallery: "Bilder zur Galerie hinzufügen",
    position: (current, total) => `${current} von ${total}`,
    openImage: (name) => `${name} in der Bildansicht öffnen`,
    selectImage: (position, name) => `${position}: ${name} anzeigen`,
  },
  en: {
    dialogTitle: "Image viewer",
    close: "Close image viewer",
    previous: "Previous image",
    next: "Next image",
    thumbnails: "Image selection",
    openOriginal: "Open original image",
    galleryLabel: "Image gallery",
    emptyGallery: "Add images to the gallery",
    position: (current, total) => `${current} of ${total}`,
    openImage: (name) => `Open ${name} in the image viewer`,
    selectImage: (position, name) => `${position}: show ${name}`,
  },
  it: {
    dialogTitle: "Visualizzatore immagini",
    close: "Chiudi il visualizzatore immagini",
    previous: "Immagine precedente",
    next: "Immagine successiva",
    thumbnails: "Selezione immagini",
    openOriginal: "Apri l'immagine originale",
    galleryLabel: "Galleria di immagini",
    emptyGallery: "Aggiungi immagini alla galleria",
    position: (current, total) => `${current} di ${total}`,
    openImage: (name) => `Apri ${name} nel visualizzatore immagini`,
    selectImage: (position, name) => `${position}: mostra ${name}`,
  },
  es: {
    dialogTitle: "Visor de imágenes",
    close: "Cerrar el visor de imágenes",
    previous: "Imagen anterior",
    next: "Imagen siguiente",
    thumbnails: "Selección de imágenes",
    openOriginal: "Abrir imagen original",
    galleryLabel: "Galería de imágenes",
    emptyGallery: "Añade imágenes a la galería",
    position: (current, total) => `${current} de ${total}`,
    openImage: (name) => `Abrir ${name} en el visor de imágenes`,
    selectImage: (position, name) => `${position}: mostrar ${name}`,
  },
  fr: {
    dialogTitle: "Visionneuse d'images",
    close: "Fermer la visionneuse d'images",
    previous: "Image précédente",
    next: "Image suivante",
    thumbnails: "Sélection d'images",
    openOriginal: "Ouvrir l'image d'origine",
    galleryLabel: "Galerie d'images",
    emptyGallery: "Ajouter des images à la galerie",
    position: (current, total) => `${current} sur ${total}`,
    openImage: (name) => `Ouvrir ${name} dans la visionneuse d'images`,
    selectImage: (position, name) => `${position} : afficher ${name}`,
  },
};

export function getImageLightboxCopy(locale: AppLocale) {
  return dictionaries[locale];
}
