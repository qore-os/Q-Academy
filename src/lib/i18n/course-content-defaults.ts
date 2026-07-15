import type { AppLocale } from "@/lib/i18n/model";

type CourseContentDefaults = {
  aiAgentTitle: string;
  headingText: string;
  paragraph: string;
  richTextTitle: string;
  buttonLabel: string;
  galleryTitle: string;
  downloadTitle: string;
  formTitle: string;
  infoTitle: string;
  infoBody: string;
  checklistTitle: string;
  checklistItems: string[];
  imageTitle: string;
  imageCaption: string;
  videoTitle: string;
  audioTitle: string;
  fileTitle: string;
  fileName: string;
  embedTitle: string;
  multipleChoice: { title: string; prompt: string; options: string[] };
  trueFalse: { title: string; prompt: string; options: string[] };
  multiSelect: { title: string; prompt: string; options: string[] };
  fillBlank: { title: string; prompt: string; answer: string };
  ordering: { title: string; prompt: string; options: string[] };
  submission: { title: string; prompt: string };
};

const defaultsByLocale = {
  de: {
    aiAgentTitle: "KI-Agent",
    headingText: "Neue Ueberschrift",
    paragraph: "Beschreibe hier den naechsten Lernimpuls.",
    richTextTitle: "Rich-Text",
    buttonLabel: "Mehr erfahren",
    galleryTitle: "Galerie",
    downloadTitle: "Download",
    formTitle: "Formular",
    infoTitle: "Hinweis",
    infoBody: "Ergaenze einen wichtigen Praxishinweis.",
    checklistTitle: "Checkliste",
    checklistItems: ["Erster Schritt", "Zweiter Schritt"],
    imageTitle: "Bild",
    imageCaption: "Bildbeschreibung ergaenzen",
    videoTitle: "Video",
    audioTitle: "Audio",
    fileTitle: "Download",
    fileName: "Kursmaterial",
    embedTitle: "Einbettung",
    multipleChoice: {
      title: "Wissenscheck",
      prompt: "Welche Antwort ist richtig?",
      options: ["Option A", "Option B", "Option C"],
    },
    trueFalse: {
      title: "Wahr oder falsch",
      prompt: "Ist diese Aussage richtig?",
      options: ["Richtig", "Falsch"],
    },
    multiSelect: {
      title: "Mehrfachauswahl",
      prompt: "Welche Antworten sind richtig?",
      options: ["Option A", "Option B", "Option C"],
    },
    fillBlank: {
      title: "Lueckentext",
      prompt: "Ergaenze den fehlenden Begriff.",
      answer: "Musterantwort",
    },
    ordering: {
      title: "Sortieraufgabe",
      prompt: "Bringe die Schritte in die richtige Reihenfolge.",
      options: ["Erster Schritt", "Zweiter Schritt", "Dritter Schritt"],
    },
    submission: {
      title: "Abgabe",
      prompt: "Beschreibe deine Loesung und den Transfer in deinen Alltag.",
    },
  },
  en: {
    aiAgentTitle: "AI agent",
    headingText: "New heading",
    paragraph: "Describe the next learning prompt here.",
    richTextTitle: "Rich text",
    buttonLabel: "Learn more",
    galleryTitle: "Gallery",
    downloadTitle: "Download",
    formTitle: "Form",
    infoTitle: "Note",
    infoBody: "Add an important practical note.",
    checklistTitle: "Checklist",
    checklistItems: ["First step", "Second step"],
    imageTitle: "Image",
    imageCaption: "Add an image description",
    videoTitle: "Video",
    audioTitle: "Audio",
    fileTitle: "Download",
    fileName: "Course material",
    embedTitle: "Embed",
    multipleChoice: {
      title: "Knowledge check",
      prompt: "Which answer is correct?",
      options: ["Option A", "Option B", "Option C"],
    },
    trueFalse: {
      title: "True or false",
      prompt: "Is this statement correct?",
      options: ["True", "False"],
    },
    multiSelect: {
      title: "Multiple selection",
      prompt: "Which answers are correct?",
      options: ["Option A", "Option B", "Option C"],
    },
    fillBlank: {
      title: "Fill in the blank",
      prompt: "Enter the missing term.",
      answer: "Sample answer",
    },
    ordering: {
      title: "Ordering task",
      prompt: "Put the steps in the correct order.",
      options: ["First step", "Second step", "Third step"],
    },
    submission: {
      title: "Submission",
      prompt: "Describe your solution and how you will apply it in daily life.",
    },
  },
  it: {
    aiAgentTitle: "Agente IA",
    headingText: "Nuovo titolo",
    paragraph: "Descrivi qui il prossimo spunto di apprendimento.",
    richTextTitle: "Testo ricco",
    buttonLabel: "Scopri di piu",
    galleryTitle: "Galleria",
    downloadTitle: "Download",
    formTitle: "Modulo",
    infoTitle: "Nota",
    infoBody: "Aggiungi un'importante nota pratica.",
    checklistTitle: "Elenco di controllo",
    checklistItems: ["Primo passaggio", "Secondo passaggio"],
    imageTitle: "Immagine",
    imageCaption: "Aggiungi una descrizione dell'immagine",
    videoTitle: "Video",
    audioTitle: "Audio",
    fileTitle: "Download",
    fileName: "Materiale del corso",
    embedTitle: "Incorporamento",
    multipleChoice: {
      title: "Verifica delle conoscenze",
      prompt: "Quale risposta e corretta?",
      options: ["Opzione A", "Opzione B", "Opzione C"],
    },
    trueFalse: {
      title: "Vero o falso",
      prompt: "Questa affermazione e corretta?",
      options: ["Vero", "Falso"],
    },
    multiSelect: {
      title: "Selezione multipla",
      prompt: "Quali risposte sono corrette?",
      options: ["Opzione A", "Opzione B", "Opzione C"],
    },
    fillBlank: {
      title: "Testo da completare",
      prompt: "Inserisci il termine mancante.",
      answer: "Risposta di esempio",
    },
    ordering: {
      title: "Attivita di ordinamento",
      prompt: "Metti i passaggi nell'ordine corretto.",
      options: ["Primo passaggio", "Secondo passaggio", "Terzo passaggio"],
    },
    submission: {
      title: "Consegna",
      prompt: "Descrivi la soluzione e come la applicherai nella vita quotidiana.",
    },
  },
  es: {
    aiAgentTitle: "Agente de IA",
    headingText: "Nuevo titulo",
    paragraph: "Describe aqui el siguiente impulso de aprendizaje.",
    richTextTitle: "Texto enriquecido",
    buttonLabel: "Mas informacion",
    galleryTitle: "Galeria",
    downloadTitle: "Descarga",
    formTitle: "Formulario",
    infoTitle: "Nota",
    infoBody: "Anade una nota practica importante.",
    checklistTitle: "Lista de comprobacion",
    checklistItems: ["Primer paso", "Segundo paso"],
    imageTitle: "Imagen",
    imageCaption: "Anade una descripcion de la imagen",
    videoTitle: "Video",
    audioTitle: "Audio",
    fileTitle: "Descarga",
    fileName: "Material del curso",
    embedTitle: "Contenido incrustado",
    multipleChoice: {
      title: "Comprobacion de conocimientos",
      prompt: "Que respuesta es correcta?",
      options: ["Opcion A", "Opcion B", "Opcion C"],
    },
    trueFalse: {
      title: "Verdadero o falso",
      prompt: "Es correcta esta afirmacion?",
      options: ["Verdadero", "Falso"],
    },
    multiSelect: {
      title: "Seleccion multiple",
      prompt: "Que respuestas son correctas?",
      options: ["Opcion A", "Opcion B", "Opcion C"],
    },
    fillBlank: {
      title: "Completar hueco",
      prompt: "Introduce el termino que falta.",
      answer: "Respuesta de ejemplo",
    },
    ordering: {
      title: "Tarea de ordenacion",
      prompt: "Pon los pasos en el orden correcto.",
      options: ["Primer paso", "Segundo paso", "Tercer paso"],
    },
    submission: {
      title: "Entrega",
      prompt: "Describe tu solucion y como la aplicaras en tu vida diaria.",
    },
  },
  fr: {
    aiAgentTitle: "Agent IA",
    headingText: "Nouveau titre",
    paragraph: "Decrivez ici la prochaine impulsion d'apprentissage.",
    richTextTitle: "Texte riche",
    buttonLabel: "En savoir plus",
    galleryTitle: "Galerie",
    downloadTitle: "Telechargement",
    formTitle: "Formulaire",
    infoTitle: "Remarque",
    infoBody: "Ajoutez une remarque pratique importante.",
    checklistTitle: "Liste de controle",
    checklistItems: ["Premiere etape", "Deuxieme etape"],
    imageTitle: "Image",
    imageCaption: "Ajoutez une description de l'image",
    videoTitle: "Video",
    audioTitle: "Audio",
    fileTitle: "Telechargement",
    fileName: "Support de cours",
    embedTitle: "Integration",
    multipleChoice: {
      title: "Controle des connaissances",
      prompt: "Quelle reponse est correcte?",
      options: ["Option A", "Option B", "Option C"],
    },
    trueFalse: {
      title: "Vrai ou faux",
      prompt: "Cette affirmation est-elle correcte?",
      options: ["Vrai", "Faux"],
    },
    multiSelect: {
      title: "Selection multiple",
      prompt: "Quelles reponses sont correctes?",
      options: ["Option A", "Option B", "Option C"],
    },
    fillBlank: {
      title: "Texte a trous",
      prompt: "Saisissez le terme manquant.",
      answer: "Exemple de reponse",
    },
    ordering: {
      title: "Exercice de classement",
      prompt: "Placez les etapes dans le bon ordre.",
      options: ["Premiere etape", "Deuxieme etape", "Troisieme etape"],
    },
    submission: {
      title: "Remise",
      prompt: "Decrivez votre solution et son application dans votre quotidien.",
    },
  },
} satisfies Record<AppLocale, CourseContentDefaults>;

export function getCourseContentDefaults(locale: AppLocale) {
  return defaultsByLocale[locale];
}
