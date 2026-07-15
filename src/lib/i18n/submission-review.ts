import type { SubmissionReviewMessageCode } from "@/lib/actions";
import { intlLocale, type AppLocale } from "@/lib/i18n/model";
import { PLATFORM_TIME_ZONE } from "@/lib/utils";

export type SubmissionReviewStatus =
  | "open"
  | "in_review"
  | "revision"
  | "approved";

type Copy = {
  center: {
    search: string;
    all: string;
    statuses: Record<SubmissionReviewStatus, string>;
    attempt: (number: number) => string;
    attemptSubmitted: (number: number, date: string) => string;
    noMatches: string;
    currentAnswer: string;
    noText: string;
    history: (count: number) => string;
    approvedDecision: string;
    revisionDecision: string;
    staffAccount: string;
    trainerReview: string;
    result: string;
    approve: string;
    requestRevision: string;
    points: string;
    feedback: string;
    feedbackPlaceholder: string;
    saving: string;
    saveReview: string;
    immutable: string;
    approvedAttempt: string;
    waitingRevision: string;
    historyRetained: string;
    selectSubmission: string;
  };
  annotations: {
    noSelection: string;
    invalidSelection: string;
    mediaNotReady: string;
    invalidTimestamp: string;
    enterComment: string;
    limitReached: string;
    duplicate: string;
    formattedAnswer: string;
    textProjection: string;
    submittedAnswer: string;
    commentSelection: string;
    commentTimestamp: string;
    timestamp: string;
    videoAttachment: (name: string) => string;
    audioAttachment: (name: string) => string;
    selectedText: string;
    timestampAt: (time: string) => string;
    discard: string;
    comment: string;
    applyComment: string;
    comments: (count: number) => string;
    textRange: (start: number, end: number) => string;
    removeComment: string;
  };
  notification: {
    approvedTitle: string;
    revisionTitle: string;
    approvedBody: (courseTitle: string, attempt: number, score: string) => string;
    revisionBody: (courseTitle: string, attempt: number) => string;
  };
  messages: Record<SubmissionReviewMessageCode, string>;
};

const copy: Record<AppLocale, Copy> = {
  de: {
    center: { search: "Abgaben durchsuchen", all: "Alle", statuses: { open: "Offen", in_review: "In Pruefung", revision: "Ueberarbeitung", approved: "Bewertet" }, attempt: (number) => `Versuch ${number}`, attemptSubmitted: (number, date) => `Versuch ${number} eingereicht ${date}`, noMatches: "Keine passenden Abgaben.", currentAnswer: "Aktuelle Antwort", noText: "Keine Textantwort hinterlegt.", history: (count) => `Versuchshistorie (${count})`, approvedDecision: "Freigegeben", revisionDecision: "Ueberarbeitung", staffAccount: "Staff-Konto", trainerReview: "Trainer-Bewertung", result: "Ergebnis", approve: "Freigeben", requestRevision: "Ueberarbeitung anfordern", points: "Punkte", feedback: "Feedback", feedbackPlaceholder: "Konkretes, hilfreiches Feedback...", saving: "Wird gespeichert", saveReview: "Bewertung speichern", immutable: "Die Bewertung ist danach unveraenderlich", approvedAttempt: "Versuch freigegeben", waitingRevision: "Wartet auf Ueberarbeitung", historyRetained: "Die gespeicherte Bewertung bleibt in der Versuchshistorie erhalten.", selectSubmission: "Waehle eine Abgabe aus." },
    annotations: { noSelection: "Keine Textstelle markiert.", invalidSelection: "Die markierte Textstelle ist ungueltig.", mediaNotReady: "Die Medienmetadaten sind noch nicht abspielbereit.", invalidTimestamp: "Die aktuelle Zeitmarke liegt ausserhalb des Mediums.", enterComment: "Bitte einen Kommentar eingeben.", limitReached: "Maximal 100 Kommentare pro Bewertung.", duplicate: "Dieser Kommentar ist bereits vorhanden.", formattedAnswer: "Formatierte Antwort", textProjection: "Textfassung zum Markieren", submittedAnswer: "Eingereichte Antwort", commentSelection: "Textstelle kommentieren", commentTimestamp: "Aktuelle Zeitmarke kommentieren", timestamp: "Zeitmarke", videoAttachment: (name) => `Videoanhang ${name}`, audioAttachment: (name) => `Audioanhang ${name}`, selectedText: "Markierte Textstelle", timestampAt: (time) => `Zeitmarke ${time}`, discard: "Kommentar verwerfen", comment: "Kommentar", applyComment: "Kommentar uebernehmen", comments: (count) => `Kommentare (${count})`, textRange: (start, end) => `Text ${start}-${end}`, removeComment: "Kommentar entfernen" },
    notification: { approvedTitle: "Abgabe freigegeben", revisionTitle: "Ueberarbeitung angefordert", approvedBody: (courseTitle, attempt, score) => `${courseTitle}: Versuch ${attempt} wurde mit ${score} freigegeben.`, revisionBody: (courseTitle, attempt) => `${courseTitle}: Bitte ueberarbeite Versuch ${attempt}.` },
    messages: { invalid_annotations: "Die Review-Kommentare sind ungueltig.", invalid_input: "Bitte pruefe Feedback, Punkte und Kommentare.", forbidden: "Diese Abgabe ist nicht fuer dich freigegeben.", approved: "Abgabe freigegeben.", revision_requested: "Ueberarbeitung angefordert.", save_failed: "Die Bewertung konnte nicht gespeichert werden." },
  },
  en: {
    center: { search: "Search submissions", all: "All", statuses: { open: "Open", in_review: "In review", revision: "Revision", approved: "Reviewed" }, attempt: (number) => `Attempt ${number}`, attemptSubmitted: (number, date) => `Attempt ${number} submitted ${date}`, noMatches: "No matching submissions.", currentAnswer: "Current answer", noText: "No text answer was provided.", history: (count) => `Attempt history (${count})`, approvedDecision: "Approved", revisionDecision: "Revision", staffAccount: "Staff account", trainerReview: "Trainer review", result: "Result", approve: "Approve", requestRevision: "Request revision", points: "Score", feedback: "Feedback", feedbackPlaceholder: "Specific, constructive feedback...", saving: "Saving", saveReview: "Save review", immutable: "The review cannot be changed afterwards", approvedAttempt: "Attempt approved", waitingRevision: "Awaiting revision", historyRetained: "The saved review remains in the attempt history.", selectSubmission: "Select a submission." },
    annotations: { noSelection: "No text is selected.", invalidSelection: "The selected text is invalid.", mediaNotReady: "The media metadata is not ready for playback yet.", invalidTimestamp: "The current timestamp is outside the media.", enterComment: "Enter a comment.", limitReached: "A review can contain up to 100 comments.", duplicate: "This comment already exists.", formattedAnswer: "Formatted answer", textProjection: "Text version for selection", submittedAnswer: "Submitted answer", commentSelection: "Comment on selection", commentTimestamp: "Comment at current timestamp", timestamp: "Timestamp", videoAttachment: (name) => `Video attachment ${name}`, audioAttachment: (name) => `Audio attachment ${name}`, selectedText: "Selected text", timestampAt: (time) => `Timestamp ${time}`, discard: "Discard comment", comment: "Comment", applyComment: "Add comment", comments: (count) => `Comments (${count})`, textRange: (start, end) => `Text ${start}-${end}`, removeComment: "Remove comment" },
    notification: { approvedTitle: "Submission approved", revisionTitle: "Revision requested", approvedBody: (courseTitle, attempt, score) => `${courseTitle}: Attempt ${attempt} was approved with a score of ${score}.`, revisionBody: (courseTitle, attempt) => `${courseTitle}: Please revise attempt ${attempt}.` },
    messages: { invalid_annotations: "The review comments are invalid.", invalid_input: "Check the feedback, score and comments.", forbidden: "This submission is not assigned to you.", approved: "Submission approved.", revision_requested: "Revision requested.", save_failed: "The review could not be saved." },
  },
  it: {
    center: { search: "Cerca consegne", all: "Tutte", statuses: { open: "Aperta", in_review: "In revisione", revision: "Da rivedere", approved: "Valutata" }, attempt: (number) => `Tentativo ${number}`, attemptSubmitted: (number, date) => `Tentativo ${number} inviato ${date}`, noMatches: "Nessuna consegna corrispondente.", currentAnswer: "Risposta attuale", noText: "Nessuna risposta testuale.", history: (count) => `Cronologia tentativi (${count})`, approvedDecision: "Approvato", revisionDecision: "Revisione", staffAccount: "Account staff", trainerReview: "Valutazione del formatore", result: "Esito", approve: "Approva", requestRevision: "Richiedi revisione", points: "Punti", feedback: "Feedback", feedbackPlaceholder: "Feedback specifico e utile...", saving: "Salvataggio", saveReview: "Salva valutazione", immutable: "La valutazione non potra essere modificata", approvedAttempt: "Tentativo approvato", waitingRevision: "In attesa di revisione", historyRetained: "La valutazione salvata resta nella cronologia dei tentativi.", selectSubmission: "Seleziona una consegna." },
    annotations: { noSelection: "Nessun testo selezionato.", invalidSelection: "Il testo selezionato non e valido.", mediaNotReady: "I metadati multimediali non sono ancora pronti.", invalidTimestamp: "La posizione corrente e fuori dal contenuto.", enterComment: "Inserisci un commento.", limitReached: "Massimo 100 commenti per valutazione.", duplicate: "Questo commento esiste gia.", formattedAnswer: "Risposta formattata", textProjection: "Versione testuale da selezionare", submittedAnswer: "Risposta inviata", commentSelection: "Commenta selezione", commentTimestamp: "Commenta posizione attuale", timestamp: "Posizione", videoAttachment: (name) => `Allegato video ${name}`, audioAttachment: (name) => `Allegato audio ${name}`, selectedText: "Testo selezionato", timestampAt: (time) => `Posizione ${time}`, discard: "Scarta commento", comment: "Commento", applyComment: "Aggiungi commento", comments: (count) => `Commenti (${count})`, textRange: (start, end) => `Testo ${start}-${end}`, removeComment: "Rimuovi commento" },
    notification: { approvedTitle: "Consegna approvata", revisionTitle: "Revisione richiesta", approvedBody: (courseTitle, attempt, score) => `${courseTitle}: il tentativo ${attempt} e stato approvato con un punteggio di ${score}.`, revisionBody: (courseTitle, attempt) => `${courseTitle}: rivedi il tentativo ${attempt}.` },
    messages: { invalid_annotations: "I commenti della valutazione non sono validi.", invalid_input: "Controlla feedback, punti e commenti.", forbidden: "Questa consegna non ti e assegnata.", approved: "Consegna approvata.", revision_requested: "Revisione richiesta.", save_failed: "Non e stato possibile salvare la valutazione." },
  },
  es: {
    center: { search: "Buscar entregas", all: "Todas", statuses: { open: "Abierta", in_review: "En revision", revision: "Revision", approved: "Evaluada" }, attempt: (number) => `Intento ${number}`, attemptSubmitted: (number, date) => `Intento ${number} enviado ${date}`, noMatches: "No hay entregas coincidentes.", currentAnswer: "Respuesta actual", noText: "No se proporciono respuesta de texto.", history: (count) => `Historial de intentos (${count})`, approvedDecision: "Aprobada", revisionDecision: "Revision", staffAccount: "Cuenta del equipo", trainerReview: "Evaluacion del formador", result: "Resultado", approve: "Aprobar", requestRevision: "Solicitar revision", points: "Puntos", feedback: "Comentarios", feedbackPlaceholder: "Comentarios concretos y utiles...", saving: "Guardando", saveReview: "Guardar evaluacion", immutable: "La evaluacion no podra modificarse despues", approvedAttempt: "Intento aprobado", waitingRevision: "Esperando revision", historyRetained: "La evaluacion guardada permanece en el historial de intentos.", selectSubmission: "Selecciona una entrega." },
    annotations: { noSelection: "No hay texto seleccionado.", invalidSelection: "El texto seleccionado no es valido.", mediaNotReady: "Los metadatos multimedia aun no estan listos.", invalidTimestamp: "La posicion actual esta fuera del contenido.", enterComment: "Introduce un comentario.", limitReached: "Maximo 100 comentarios por evaluacion.", duplicate: "Este comentario ya existe.", formattedAnswer: "Respuesta con formato", textProjection: "Version de texto para seleccionar", submittedAnswer: "Respuesta enviada", commentSelection: "Comentar seleccion", commentTimestamp: "Comentar posicion actual", timestamp: "Posicion", videoAttachment: (name) => `Adjunto de video ${name}`, audioAttachment: (name) => `Adjunto de audio ${name}`, selectedText: "Texto seleccionado", timestampAt: (time) => `Posicion ${time}`, discard: "Descartar comentario", comment: "Comentario", applyComment: "Anadir comentario", comments: (count) => `Comentarios (${count})`, textRange: (start, end) => `Texto ${start}-${end}`, removeComment: "Eliminar comentario" },
    notification: { approvedTitle: "Entrega aprobada", revisionTitle: "Revision solicitada", approvedBody: (courseTitle, attempt, score) => `${courseTitle}: el intento ${attempt} se aprobo con una puntuacion de ${score}.`, revisionBody: (courseTitle, attempt) => `${courseTitle}: revisa el intento ${attempt}.` },
    messages: { invalid_annotations: "Los comentarios de revision no son validos.", invalid_input: "Revisa los comentarios, puntos y anotaciones.", forbidden: "Esta entrega no esta asignada a ti.", approved: "Entrega aprobada.", revision_requested: "Revision solicitada.", save_failed: "No se pudo guardar la evaluacion." },
  },
  fr: {
    center: { search: "Rechercher des travaux", all: "Tous", statuses: { open: "Ouvert", in_review: "En evaluation", revision: "A revoir", approved: "Evalue" }, attempt: (number) => `Tentative ${number}`, attemptSubmitted: (number, date) => `Tentative ${number} envoyee ${date}`, noMatches: "Aucun travail correspondant.", currentAnswer: "Reponse actuelle", noText: "Aucune reponse textuelle.", history: (count) => `Historique des tentatives (${count})`, approvedDecision: "Approuve", revisionDecision: "Revision", staffAccount: "Compte equipe", trainerReview: "Evaluation du formateur", result: "Resultat", approve: "Approuver", requestRevision: "Demander une revision", points: "Points", feedback: "Commentaire", feedbackPlaceholder: "Un commentaire precis et utile...", saving: "Enregistrement", saveReview: "Enregistrer l'evaluation", immutable: "L'evaluation ne pourra plus etre modifiee", approvedAttempt: "Tentative approuvee", waitingRevision: "En attente de revision", historyRetained: "L'evaluation enregistree reste dans l'historique des tentatives.", selectSubmission: "Selectionnez un travail." },
    annotations: { noSelection: "Aucun texte selectionne.", invalidSelection: "Le texte selectionne n'est pas valide.", mediaNotReady: "Les metadonnees du media ne sont pas encore pretes.", invalidTimestamp: "La position actuelle est hors du media.", enterComment: "Saisissez un commentaire.", limitReached: "Maximum 100 commentaires par evaluation.", duplicate: "Ce commentaire existe deja.", formattedAnswer: "Reponse mise en forme", textProjection: "Version texte a selectionner", submittedAnswer: "Reponse envoyee", commentSelection: "Commenter la selection", commentTimestamp: "Commenter la position actuelle", timestamp: "Position", videoAttachment: (name) => `Piece jointe video ${name}`, audioAttachment: (name) => `Piece jointe audio ${name}`, selectedText: "Texte selectionne", timestampAt: (time) => `Position ${time}`, discard: "Annuler le commentaire", comment: "Commentaire", applyComment: "Ajouter le commentaire", comments: (count) => `Commentaires (${count})`, textRange: (start, end) => `Texte ${start}-${end}`, removeComment: "Supprimer le commentaire" },
    notification: { approvedTitle: "Travail approuve", revisionTitle: "Revision demandee", approvedBody: (courseTitle, attempt, score) => `${courseTitle} : la tentative ${attempt} a ete approuvee avec un score de ${score}.`, revisionBody: (courseTitle, attempt) => `${courseTitle} : veuillez revoir la tentative ${attempt}.` },
    messages: { invalid_annotations: "Les commentaires d'evaluation ne sont pas valides.", invalid_input: "Verifiez le commentaire, les points et les annotations.", forbidden: "Ce travail ne vous est pas attribue.", approved: "Travail approuve.", revision_requested: "Revision demandee.", save_failed: "L'evaluation n'a pas pu etre enregistree." },
  },
};

export function getSubmissionReviewCopy(locale: AppLocale) {
  return copy[locale];
}

export function resolveSubmissionReviewMessage(
  locale: AppLocale,
  code: SubmissionReviewMessageCode | undefined,
) {
  return copy[locale].messages[code ?? "save_failed"];
}

export function formatSubmissionReviewTime(locale: AppLocale, date: Date) {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    timeStyle: "short",
    timeZone: PLATFORM_TIME_ZONE,
  }).format(date);
}

export function formatSubmissionReviewScore(locale: AppLocale, score: number) {
  return new Intl.NumberFormat(intlLocale(locale), {
    style: "percent",
    maximumFractionDigits: 0,
  }).format(score / 100);
}
