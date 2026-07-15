import type { AppLocale } from "@/lib/i18n/model";

export type CourseContentCopyActionCode =
  | "course_content_copy.invalid_input"
  | "course_content_copy.source_unavailable"
  | "course_content_copy.target_unavailable"
  | "course_content_copy.permission_denied"
  | "course_content_copy.reference_invalid"
  | "course_content_copy.failed"
  | "course_content_copy.lesson_copied"
  | "course_content_copy.section_copied";

type CourseContentCopyCopy = {
  copySection: string;
  copyLesson: string;
  sectionTitle: string;
  lessonTitle: string;
  source: string;
  targetCourse: string;
  targetModule: string;
  targetSection: string;
  noSection: string;
  noTargets: string;
  submit: string;
  action: Record<CourseContentCopyActionCode, string>;
};

const copy: Record<AppLocale, CourseContentCopyCopy> = {
  de: {
    copySection: "Sektion kopieren",
    copyLesson: "Lektion kopieren",
    sectionTitle: "Sektion kopieren nach",
    lessonTitle: "Lektion kopieren nach",
    source: "Quelle",
    targetCourse: "Zielkurs",
    targetModule: "Zielmodul",
    targetSection: "Zielsektion",
    noSection: "Ohne Sektion",
    noTargets: "Kein bearbeitbares Lernmodul als Ziel verfuegbar.",
    submit: "Kopie erstellen",
    action: {
      "course_content_copy.invalid_input": "Das Kopierziel ist ungueltig.",
      "course_content_copy.source_unavailable": "Der Quellinhalt ist nicht mehr verfuegbar.",
      "course_content_copy.target_unavailable": "Das Ziel ist nicht verfuegbar oder archiviert.",
      "course_content_copy.permission_denied": "Du darfst Quelle oder Ziel nicht bearbeiten.",
      "course_content_copy.reference_invalid": "Eine Medien-, Formular-, Agent- oder Pruefungsreferenz kann nicht sicher kopiert werden.",
      "course_content_copy.failed": "Der Inhalt konnte nicht kopiert werden.",
      "course_content_copy.lesson_copied": "Lektion samt Seiten und Inhalten kopiert.",
      "course_content_copy.section_copied": "Sektion samt Lektionen, Seiten und Inhalten kopiert.",
    },
  },
  en: {
    copySection: "Copy section",
    copyLesson: "Copy lesson",
    sectionTitle: "Copy section to",
    lessonTitle: "Copy lesson to",
    source: "Source",
    targetCourse: "Target course",
    targetModule: "Target module",
    targetSection: "Target section",
    noSection: "No section",
    noTargets: "No editable learning module is available as a target.",
    submit: "Create copy",
    action: {
      "course_content_copy.invalid_input": "The copy target is invalid.",
      "course_content_copy.source_unavailable": "The source content is no longer available.",
      "course_content_copy.target_unavailable": "The target is unavailable or archived.",
      "course_content_copy.permission_denied": "You cannot edit the source or target.",
      "course_content_copy.reference_invalid": "A media, form, agent or assessment reference cannot be copied safely.",
      "course_content_copy.failed": "The content could not be copied.",
      "course_content_copy.lesson_copied": "Lesson copied with all pages and content.",
      "course_content_copy.section_copied": "Section copied with all lessons, pages and content.",
    },
  },
  it: {
    copySection: "Copia sezione",
    copyLesson: "Copia lezione",
    sectionTitle: "Copia sezione in",
    lessonTitle: "Copia lezione in",
    source: "Origine",
    targetCourse: "Corso di destinazione",
    targetModule: "Modulo di destinazione",
    targetSection: "Sezione di destinazione",
    noSection: "Senza sezione",
    noTargets: "Nessun modulo didattico modificabile disponibile come destinazione.",
    submit: "Crea copia",
    action: {
      "course_content_copy.invalid_input": "La destinazione della copia non e valida.",
      "course_content_copy.source_unavailable": "Il contenuto di origine non e piu disponibile.",
      "course_content_copy.target_unavailable": "La destinazione non e disponibile o e archiviata.",
      "course_content_copy.permission_denied": "Non puoi modificare l'origine o la destinazione.",
      "course_content_copy.reference_invalid": "Un riferimento a media, modulo, agente o valutazione non puo essere copiato in modo sicuro.",
      "course_content_copy.failed": "Non e stato possibile copiare il contenuto.",
      "course_content_copy.lesson_copied": "Lezione copiata con tutte le pagine e i contenuti.",
      "course_content_copy.section_copied": "Sezione copiata con tutte le lezioni, pagine e contenuti.",
    },
  },
  es: {
    copySection: "Copiar seccion",
    copyLesson: "Copiar leccion",
    sectionTitle: "Copiar seccion a",
    lessonTitle: "Copiar leccion a",
    source: "Origen",
    targetCourse: "Curso de destino",
    targetModule: "Modulo de destino",
    targetSection: "Seccion de destino",
    noSection: "Sin seccion",
    noTargets: "No hay ningun modulo de aprendizaje editable disponible como destino.",
    submit: "Crear copia",
    action: {
      "course_content_copy.invalid_input": "El destino de copia no es valido.",
      "course_content_copy.source_unavailable": "El contenido de origen ya no esta disponible.",
      "course_content_copy.target_unavailable": "El destino no esta disponible o esta archivado.",
      "course_content_copy.permission_denied": "No puedes editar el origen o el destino.",
      "course_content_copy.reference_invalid": "No se puede copiar de forma segura una referencia de medios, formulario, agente o evaluacion.",
      "course_content_copy.failed": "No se pudo copiar el contenido.",
      "course_content_copy.lesson_copied": "Leccion copiada con todas las paginas y contenidos.",
      "course_content_copy.section_copied": "Seccion copiada con todas las lecciones, paginas y contenidos.",
    },
  },
  fr: {
    copySection: "Copier la section",
    copyLesson: "Copier la lecon",
    sectionTitle: "Copier la section vers",
    lessonTitle: "Copier la lecon vers",
    source: "Source",
    targetCourse: "Cours cible",
    targetModule: "Module cible",
    targetSection: "Section cible",
    noSection: "Sans section",
    noTargets: "Aucun module pedagogique modifiable n'est disponible comme cible.",
    submit: "Creer la copie",
    action: {
      "course_content_copy.invalid_input": "La cible de copie n'est pas valide.",
      "course_content_copy.source_unavailable": "Le contenu source n'est plus disponible.",
      "course_content_copy.target_unavailable": "La cible n'est pas disponible ou est archivee.",
      "course_content_copy.permission_denied": "Vous ne pouvez pas modifier la source ou la cible.",
      "course_content_copy.reference_invalid": "Une reference media, formulaire, agent ou evaluation ne peut pas etre copiee de maniere sure.",
      "course_content_copy.failed": "Le contenu n'a pas pu etre copie.",
      "course_content_copy.lesson_copied": "Lecon copiee avec toutes ses pages et tous ses contenus.",
      "course_content_copy.section_copied": "Section copiee avec toutes ses lecons, pages et tous ses contenus.",
    },
  },
};

export function getCourseContentCopyCopy(locale: AppLocale) {
  return copy[locale];
}
