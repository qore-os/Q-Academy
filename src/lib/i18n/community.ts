import type { AppLocale } from "@/lib/i18n/model";
import type { CommunityModerationReason } from "@/lib/community-moderation-lifecycle-core";

export type CommunityUiCopy = {
  common: {
    community: string;
    allAreas: string;
    badges: string;
    close: string;
    closeDialog: string;
    cancel: string;
    retry: string;
    post: string;
    answer: string;
    course: string;
    feed: string;
    discussion: string;
    announcement: string;
    highlight: string;
  };
  profile: {
    completionTitle: string;
    openFields: string;
    goToProfile: string;
    completeProfile: string;
    postRequirement: string;
    replyRequirement: string;
    profileOf: (name: string) => string;
  };
  reactions: {
    groupLabel: string;
    commentGroupLabel: string;
    commentSaveFailed: string;
    remove: (label: string) => string;
    options: Record<"like" | "celebrate" | "insightful" | "question", string>;
  };
  votes: {
    up: string;
    removeUp: string;
    down: string;
    removeDown: string;
  };
  comments: {
    threadPlaceholder: string;
    answerPlaceholder: string;
    cancelThreadReply: string;
    publishAnswer: string;
    reply: string;
    replyTo: (name: string) => string;
    editOwn: string;
    edit: string;
    deleteOwn: string;
    delete: string;
    report: string;
    alreadyReported: string;
    reported: string;
    loadingAnswers: string;
    loadAnswers: string;
    loadMoreAnswers: string;
    loadingComments: string;
    loadMoreComments: string;
    loadedAnswers: (visible: number, total: number) => string;
    invalidResponse: string;
    loadCommentsFailed: string;
    loadAnswersFailed: string;
  };
  feedReasons: {
    followedAuthor: string;
    followedSpace: string;
    recent: string;
    activeDiscussion: string;
    popular: string;
    engaged: string;
    sameGroup: string;
    announcement: string;
    pinned: string;
    recommended: string;
  };
  follow: {
    author: (name: string) => string;
    unfollowAuthor: (name: string) => string;
    space: (name: string) => string;
    unfollowSpace: (name: string) => string;
    loadFailed: string;
    saveFollowFailed: string;
    saveUnfollowFailed: string;
  };
  report: {
    moderation: string;
    title: (target: string) => string;
    reason: string;
    selectReason: string;
    reasons: Record<
      | "spam"
      | "harassment"
      | "hate_speech"
      | "misinformation"
      | "privacy"
      | "other",
      string
    >;
    detailsOptional: string;
    submit: string;
    post: string;
    postAlreadyReported: string;
    answer: string;
    answerAlreadyReported: string;
  };
  ownContent: {
    eyebrow: string;
    editTitle: (target: string) => string;
    deleteTitle: (target: string) => string;
    contentPlaceholder: string;
    saveChanges: string;
    deleteAction: string;
    deletePostWarning: string;
    deleteAnswerWarning: string;
    editOwnPost: string;
    editPost: string;
    deleteOwnPost: string;
    deletePost: string;
  };
  feed: {
    filters: Record<"all" | "discussion" | "announcement" | "highlights", string>;
    memberFallback: string;
    repliesLocked: string;
    emptyView: string;
    topFive: string;
    pointsAbbreviation: string;
  };
  personalized: {
    modes: Record<"for_you" | "following" | "latest", string>;
    invalidResponse: string;
    loadFailed: string;
    loadingLabel: string;
    heading: string;
    modeLabel: string;
    reload: string;
    loading: string;
    loadMore: string;
    empty: Record<"for_you" | "following" | "latest", string>;
  };
  attachments: {
    title: string;
    chooseFile: string;
    dropHint: string;
    uploadFailed: string;
    maximumFiles: (count: number) => string;
    invalidFile: string;
    removeFailed: string;
    retry: (name: string) => string;
    retryAttachment: string;
    preparing: string;
    uploading: (progress: number) => string;
    securityCheck: string;
    ready: (size: string) => string;
    remove: (name: string) => string;
    removeAttachment: string;
    open: (name: string) => string;
    video: (name: string) => string;
    audio: (name: string) => string;
  };
  spaces: {
    title: string;
    protected: string;
    noDescription: string;
    empty: string;
  };
  submissions: {
    title: string;
    empty: string;
    status: Record<
      | "awaiting_review"
      | "in_review"
      | "appeal_pending"
      | "published"
      | "held"
      | "rejected"
      | "appeal_upheld"
      | "appeal_accepted"
      | "unavailable",
      string
    >;
    reasons: Record<CommunityModerationReason, string>;
    postFallback: string;
    answerFallback: string;
    unavailableContent: string;
    submittedOn: (date: string) => string;
    appealStatement: string;
    appeal: string;
    sending: string;
    sendAppeal: string;
    deadline: (date: string) => string;
    appealSubmitted: (date: string) => string;
    appealAccepted: string;
    decisionConfirmed: string;
  };
  actions: {
    postSubmitted: string;
    postCreateFailed: string;
    answerCreateFailed: string;
    postSaved: string;
    answerSaved: string;
    changeSubmitted: string;
    postSaveFailed: string;
    answerSaveFailed: string;
    postDeleted: string;
    answerDeleted: string;
    postDeleteFailed: string;
    answerDeleteFailed: string;
    reportSent: string;
    reportFailed: string;
    appealFailed: string;
  };
  editor: {
    contentFormat: string;
  };
};

const de: CommunityUiCopy = {
  common: { community: "Community", allAreas: "Alle Bereiche", badges: "Badges", close: "Schliessen", closeDialog: "Dialog schliessen", cancel: "Abbrechen", retry: "Erneut versuchen", post: "Beitrag", answer: "Antwort", course: "Kurs", feed: "Feed", discussion: "Diskussion", announcement: "Ankuendigung", highlight: "Highlight" },
  profile: { completionTitle: "Community-Profil vervollstaendigen", openFields: "Offen", goToProfile: "Zum Profil", completeProfile: "Profil vervollstaendigen", postRequirement: "Profil vervollstaendigen, um zu posten", replyRequirement: "Profil vervollstaendigen, um zu antworten.", profileOf: (name) => `Community-Profil von ${name}` },
  reactions: { groupLabel: "Reaktionen", commentGroupLabel: "Kommentarreaktionen", commentSaveFailed: "Die Kommentarreaktion konnte nicht gespeichert werden.", remove: (label) => `${label} entfernen`, options: { like: "Gefaellt mir", celebrate: "Feiern", insightful: "Hilfreich", question: "Frage" } },
  votes: { up: "Positiv voten", removeUp: "Positiven Vote entfernen", down: "Negativ voten", removeDown: "Negativen Vote entfernen" },
  comments: { threadPlaceholder: "Im Thread antworten...", answerPlaceholder: "Antwort schreiben...", cancelThreadReply: "Thread-Antwort abbrechen", publishAnswer: "Antwort veroeffentlichen", reply: "Antworten", replyTo: (name) => `Auf Antwort von ${name} antworten`, editOwn: "Eigene Antwort bearbeiten", edit: "Antwort bearbeiten", deleteOwn: "Eigene Antwort loeschen", delete: "Antwort loeschen", report: "Antwort melden", alreadyReported: "Antwort bereits gemeldet", reported: "Bereits gemeldet", loadingAnswers: "Antworten werden geladen", loadAnswers: "Antworten laden", loadMoreAnswers: "Weitere Antworten laden", loadingComments: "Kommentare werden geladen", loadMoreComments: "Weitere Kommentare laden", loadedAnswers: (visible, total) => `${visible} von ${total} Antworten geladen.`, invalidResponse: "Die Antworten haben ein ungueltiges Format.", loadCommentsFailed: "Weitere Kommentare konnten nicht geladen werden.", loadAnswersFailed: "Weitere Antworten konnten nicht geladen werden." },
  feedReasons: { followedAuthor: "Du folgst dieser Person", followedSpace: "Du folgst diesem Bereich", recent: "Neu in deiner Community", activeDiscussion: "Aktive Diskussion", popular: "Gerade viel diskutiert", engaged: "Passt zu deinen Aktivitaeten", sameGroup: "Aus deinem Lernumfeld", announcement: "Ankuendigung deiner Academy", pinned: "Von der Academy hervorgehoben", recommended: "Empfohlen vom Academy-Team" },
  follow: { author: (name) => `${name} folgen`, unfollowAuthor: (name) => `${name} nicht mehr folgen`, space: (name) => `${name} folgen`, unfollowSpace: (name) => `${name} nicht mehr folgen`, loadFailed: "Follows konnten nicht geladen werden.", saveFollowFailed: "Das Folgen konnte nicht gespeichert werden.", saveUnfollowFailed: "Das Entfolgen konnte nicht gespeichert werden." },
  report: { moderation: "Moderation", title: (target) => `${target} melden`, reason: "Grund", selectReason: "Grund auswaehlen", reasons: { spam: "Spam oder Werbung", harassment: "Belaestigung", hate_speech: "Hassrede", misinformation: "Irrefuehrender Inhalt", privacy: "Persoenliche Daten", other: "Anderer Grund" }, detailsOptional: "Beschreibung (optional)", submit: "Meldung senden", post: "Beitrag melden", postAlreadyReported: "Beitrag bereits gemeldet", answer: "Antwort melden", answerAlreadyReported: "Antwort bereits gemeldet" },
  ownContent: { eyebrow: "Dein Community-Inhalt", editTitle: (target) => `${target} bearbeiten`, deleteTitle: (target) => `${target} loeschen`, contentPlaceholder: "Inhalt", saveChanges: "Aenderungen speichern", deleteAction: "Loeschen", deletePostWarning: "Der Beitrag, seine Anhaenge und alle zugehoerigen Antworten und Reaktionen werden dauerhaft geloescht.", deleteAnswerWarning: "Die Antwort und ihre Anhaenge werden dauerhaft aus dem Beitrag entfernt.", editOwnPost: "Eigenen Beitrag bearbeiten", editPost: "Beitrag bearbeiten", deleteOwnPost: "Eigenen Beitrag loeschen", deletePost: "Beitrag loeschen" },
  feed: { filters: { all: "Alle", discussion: "Diskussionen", announcement: "Ankuendigungen", highlights: "Highlights" }, memberFallback: "Q-Academy Mitglied", repliesLocked: "Antworten gesperrt", emptyView: "In dieser Ansicht gibt es noch keine Beitraege.", topFive: "Top 5", pointsAbbreviation: "P" },
  personalized: { modes: { for_you: "Fuer dich", following: "Folge ich", latest: "Neueste" }, invalidResponse: "Der Feed hat ein ungueltiges Antwortformat geliefert.", loadFailed: "Der Community-Feed konnte nicht geladen werden.", loadingLabel: "Feed wird geladen", heading: "Persoenlicher Community-Feed", modeLabel: "Feedmodus", reload: "Erneut laden", loading: "Wird geladen", loadMore: "Weitere Beitraege", empty: { for_you: "Noch keine passenden Beitraege fuer dich.", following: "Folge Personen oder Bereichen, um hier ihre Beitraege zu sehen.", latest: "In deiner Community wurden noch keine Beitraege veroeffentlicht." } },
  attachments: { title: "Anhaenge", chooseFile: "Datei auswaehlen", dropHint: "Bilder, Videos, Audio oder Dokumente hier ablegen.", uploadFailed: "Upload fehlgeschlagen.", maximumFiles: (count) => `Maximal ${count} Dateien sind hier moeglich.`, invalidFile: "Dateityp oder Dateigroesse ist ungueltig.", removeFailed: "Die Datei konnte nicht entfernt werden.", retry: (name) => `Upload fuer ${name} fortsetzen`, retryAttachment: "Upload fortsetzen", preparing: "Wird vorbereitet", uploading: (progress) => `Upload ${progress} %`, securityCheck: "Sicherheitspruefung", ready: (size) => `Bereit | ${size}`, remove: (name) => `${name} entfernen`, removeAttachment: "Anhang entfernen", open: (name) => `${name} oeffnen`, video: (name) => `Video ${name}`, audio: (name) => `Audio ${name}` },
  spaces: { title: "Bereiche", protected: "Geschuetzt", noDescription: "Keine Beschreibung", empty: "Noch keine Bereiche eingerichtet." },
  submissions: { title: "Meine Einreichungen", empty: "Keine Einreichungen in Moderationspruefung.", status: { awaiting_review: "Wartet auf Pruefung", in_review: "In Pruefung", appeal_pending: "Einspruch in Pruefung", published: "Freigegeben", held: "Zurueckgehalten", rejected: "Abgelehnt", appeal_upheld: "Einspruch abgelehnt", appeal_accepted: "Einspruch angenommen", unavailable: "Nicht mehr verfuegbar" }, reasons: { approval_required: "Freigabe erforderlich", report_threshold: "Community-Pruefung erforderlich", duplicate: "Aehnlicher Inhalt wird geprueft", link_limit: "Linklimit des Bereichs ueberschritten", manual: "Manuelle Pruefung erforderlich" }, postFallback: "Community-Beitrag", answerFallback: "Community-Antwort", unavailableContent: "Der Inhalt ist nicht mehr verfuegbar.", submittedOn: (date) => `Eingereicht am ${date}`, appealStatement: "Begruendung des Einspruchs", appeal: "Einspruch einlegen", sending: "Wird gesendet", sendAppeal: "Einspruch senden", deadline: (date) => `Einspruchsfrist bis ${date}`, appealSubmitted: (date) => `Einspruch eingereicht am ${date}.`, appealAccepted: "Deinem Einspruch wurde stattgegeben.", decisionConfirmed: "Die urspruengliche Entscheidung wurde bestaetigt." },
  actions: { postSubmitted: "Beitrag wurde eingereicht.", postCreateFailed: "Der Beitrag konnte nicht veroeffentlicht werden.", answerCreateFailed: "Die Antwort konnte nicht veroeffentlicht werden.", postSaved: "Beitrag gespeichert.", answerSaved: "Antwort gespeichert.", changeSubmitted: "Aenderung wurde zur Pruefung eingereicht.", postSaveFailed: "Der Beitrag konnte nicht gespeichert werden.", answerSaveFailed: "Die Antwort konnte nicht gespeichert werden.", postDeleted: "Beitrag geloescht.", answerDeleted: "Antwort geloescht.", postDeleteFailed: "Der Beitrag konnte nicht geloescht werden.", answerDeleteFailed: "Die Antwort konnte nicht geloescht werden.", reportSent: "Meldung wurde vertraulich gesendet.", reportFailed: "Die Meldung konnte nicht gesendet werden.", appealFailed: "Der Einspruch konnte nicht eingereicht werden." },
  editor: { contentFormat: "Inhaltsformat" },
};

const en: CommunityUiCopy = {
  common: { community: "Community", allAreas: "All areas", badges: "Badges", close: "Close", closeDialog: "Close dialog", cancel: "Cancel", retry: "Try again", post: "Post", answer: "Reply", course: "Course", feed: "Feed", discussion: "Discussion", announcement: "Announcement", highlight: "Highlight" },
  profile: { completionTitle: "Complete your community profile", openFields: "Missing", goToProfile: "Open profile", completeProfile: "Complete profile", postRequirement: "Complete your profile to post", replyRequirement: "Complete your profile to reply.", profileOf: (name) => `Community profile of ${name}` },
  reactions: { groupLabel: "Reactions", commentGroupLabel: "Comment reactions", commentSaveFailed: "The comment reaction could not be saved.", remove: (label) => `Remove ${label}`, options: { like: "Like", celebrate: "Celebrate", insightful: "Helpful", question: "Question" } },
  votes: { up: "Upvote", removeUp: "Remove upvote", down: "Downvote", removeDown: "Remove downvote" },
  comments: { threadPlaceholder: "Reply in thread...", answerPlaceholder: "Write a reply...", cancelThreadReply: "Cancel thread reply", publishAnswer: "Publish reply", reply: "Reply", replyTo: (name) => `Reply to ${name}`, editOwn: "Edit your reply", edit: "Edit reply", deleteOwn: "Delete your reply", delete: "Delete reply", report: "Report reply", alreadyReported: "Reply already reported", reported: "Already reported", loadingAnswers: "Loading replies", loadAnswers: "Load replies", loadMoreAnswers: "Load more replies", loadingComments: "Loading comments", loadMoreComments: "Load more comments", loadedAnswers: (visible, total) => `${visible} of ${total} replies loaded.`, invalidResponse: "The replies returned an invalid response.", loadCommentsFailed: "More comments could not be loaded.", loadAnswersFailed: "More replies could not be loaded." },
  feedReasons: { followedAuthor: "You follow this person", followedSpace: "You follow this space", recent: "New in your community", activeDiscussion: "Active discussion", popular: "Popular discussion", engaged: "Matches your activity", sameGroup: "From your learning network", announcement: "Announcement from your academy", pinned: "Highlighted by the academy", recommended: "Recommended by the academy team" },
  follow: { author: (name) => `Follow ${name}`, unfollowAuthor: (name) => `Unfollow ${name}`, space: (name) => `Follow ${name}`, unfollowSpace: (name) => `Unfollow ${name}`, loadFailed: "Follows could not be loaded.", saveFollowFailed: "Following could not be saved.", saveUnfollowFailed: "Unfollowing could not be saved." },
  report: { moderation: "Moderation", title: (target) => `Report ${target.toLowerCase()}`, reason: "Reason", selectReason: "Select a reason", reasons: { spam: "Spam or advertising", harassment: "Harassment", hate_speech: "Hate speech", misinformation: "Misleading content", privacy: "Personal information", other: "Other reason" }, detailsOptional: "Description (optional)", submit: "Submit report", post: "Report post", postAlreadyReported: "Post already reported", answer: "Report reply", answerAlreadyReported: "Reply already reported" },
  ownContent: { eyebrow: "Your community content", editTitle: (target) => `Edit ${target.toLowerCase()}`, deleteTitle: (target) => `Delete ${target.toLowerCase()}`, contentPlaceholder: "Content", saveChanges: "Save changes", deleteAction: "Delete", deletePostWarning: "The post, its attachments and all related replies and reactions will be permanently deleted.", deleteAnswerWarning: "The reply and its attachments will be permanently removed from the post.", editOwnPost: "Edit your post", editPost: "Edit post", deleteOwnPost: "Delete your post", deletePost: "Delete post" },
  feed: { filters: { all: "All", discussion: "Discussions", announcement: "Announcements", highlights: "Highlights" }, memberFallback: "Q-Academy member", repliesLocked: "Replies locked", emptyView: "There are no posts in this view yet.", topFive: "Top 5", pointsAbbreviation: "pts" },
  personalized: { modes: { for_you: "For you", following: "Following", latest: "Latest" }, invalidResponse: "The feed returned an invalid response.", loadFailed: "The community feed could not be loaded.", loadingLabel: "Loading feed", heading: "Personal community feed", modeLabel: "Feed mode", reload: "Reload", loading: "Loading", loadMore: "More posts", empty: { for_you: "There are no matching posts for you yet.", following: "Follow people or spaces to see their posts here.", latest: "No posts have been published in your community yet." } },
  attachments: { title: "Attachments", chooseFile: "Choose file", dropHint: "Drop images, videos, audio or documents here.", uploadFailed: "Upload failed.", maximumFiles: (count) => `You can add up to ${count} files here.`, invalidFile: "The file type or size is invalid.", removeFailed: "The file could not be removed.", retry: (name) => `Resume upload for ${name}`, retryAttachment: "Resume upload", preparing: "Preparing", uploading: (progress) => `Upload ${progress}%`, securityCheck: "Security check", ready: (size) => `Ready | ${size}`, remove: (name) => `Remove ${name}`, removeAttachment: "Remove attachment", open: (name) => `Open ${name}`, video: (name) => `Video ${name}`, audio: (name) => `Audio ${name}` },
  spaces: { title: "Spaces", protected: "Protected", noDescription: "No description", empty: "No spaces have been set up yet." },
  submissions: { title: "My submissions", empty: "No submissions are under moderation review.", status: { awaiting_review: "Awaiting review", in_review: "In review", appeal_pending: "Appeal in review", published: "Published", held: "Held", rejected: "Rejected", appeal_upheld: "Appeal rejected", appeal_accepted: "Appeal accepted", unavailable: "No longer available" }, reasons: { approval_required: "Approval required", report_threshold: "Community review required", duplicate: "Similar content is being reviewed", link_limit: "Space link limit exceeded", manual: "Manual review required" }, postFallback: "Community post", answerFallback: "Community reply", unavailableContent: "The content is no longer available.", submittedOn: (date) => `Submitted on ${date}`, appealStatement: "Reason for the appeal", appeal: "Submit appeal", sending: "Sending", sendAppeal: "Send appeal", deadline: (date) => `Appeal deadline: ${date}`, appealSubmitted: (date) => `Appeal submitted on ${date}.`, appealAccepted: "Your appeal was accepted.", decisionConfirmed: "The original decision was confirmed." },
  actions: { postSubmitted: "Post submitted.", postCreateFailed: "The post could not be published.", answerCreateFailed: "The reply could not be published.", postSaved: "Post saved.", answerSaved: "Reply saved.", changeSubmitted: "The change was submitted for review.", postSaveFailed: "The post could not be saved.", answerSaveFailed: "The reply could not be saved.", postDeleted: "Post deleted.", answerDeleted: "Reply deleted.", postDeleteFailed: "The post could not be deleted.", answerDeleteFailed: "The reply could not be deleted.", reportSent: "The report was sent confidentially.", reportFailed: "The report could not be sent.", appealFailed: "The appeal could not be submitted." },
  editor: { contentFormat: "Content format" },
};

const it: CommunityUiCopy = {
  common: { community: "Community", allAreas: "Tutte le aree", badges: "Badge", close: "Chiudi", closeDialog: "Chiudi finestra", cancel: "Annulla", retry: "Riprova", post: "Post", answer: "Risposta", course: "Corso", feed: "Feed", discussion: "Discussione", announcement: "Annuncio", highlight: "In evidenza" },
  profile: { completionTitle: "Completa il profilo community", openFields: "Mancanti", goToProfile: "Vai al profilo", completeProfile: "Completa il profilo", postRequirement: "Completa il profilo per pubblicare", replyRequirement: "Completa il profilo per rispondere.", profileOf: (name) => `Profilo community di ${name}` },
  reactions: { groupLabel: "Reazioni", commentGroupLabel: "Reazioni al commento", commentSaveFailed: "Impossibile salvare la reazione al commento.", remove: (label) => `Rimuovi ${label}`, options: { like: "Mi piace", celebrate: "Festeggia", insightful: "Utile", question: "Domanda" } },
  votes: { up: "Voto positivo", removeUp: "Rimuovi voto positivo", down: "Voto negativo", removeDown: "Rimuovi voto negativo" },
  comments: { threadPlaceholder: "Rispondi nella discussione...", answerPlaceholder: "Scrivi una risposta...", cancelThreadReply: "Annulla risposta nella discussione", publishAnswer: "Pubblica risposta", reply: "Rispondi", replyTo: (name) => `Rispondi a ${name}`, editOwn: "Modifica la tua risposta", edit: "Modifica risposta", deleteOwn: "Elimina la tua risposta", delete: "Elimina risposta", report: "Segnala risposta", alreadyReported: "Risposta già segnalata", reported: "Già segnalata", loadingAnswers: "Caricamento risposte", loadAnswers: "Carica risposte", loadMoreAnswers: "Carica altre risposte", loadingComments: "Caricamento commenti", loadMoreComments: "Carica altri commenti", loadedAnswers: (visible, total) => `${visible} di ${total} risposte caricate.`, invalidResponse: "Le risposte hanno restituito un formato non valido.", loadCommentsFailed: "Impossibile caricare altri commenti.", loadAnswersFailed: "Impossibile caricare altre risposte." },
  feedReasons: { followedAuthor: "Segui questa persona", followedSpace: "Segui questo spazio", recent: "Novità nella tua community", activeDiscussion: "Discussione attiva", popular: "Discussione popolare", engaged: "In linea con le tue attività", sameGroup: "Dalla tua rete di apprendimento", announcement: "Annuncio della tua academy", pinned: "In evidenza per l'academy", recommended: "Consigliato dal team dell'academy" },
  follow: { author: (name) => `Segui ${name}`, unfollowAuthor: (name) => `Smetti di seguire ${name}`, space: (name) => `Segui ${name}`, unfollowSpace: (name) => `Smetti di seguire ${name}`, loadFailed: "Impossibile caricare gli elementi seguiti.", saveFollowFailed: "Impossibile salvare il follow.", saveUnfollowFailed: "Impossibile smettere di seguire." },
  report: { moderation: "Moderazione", title: (target) => `Segnala ${target.toLowerCase()}`, reason: "Motivo", selectReason: "Seleziona un motivo", reasons: { spam: "Spam o pubblicità", harassment: "Molestie", hate_speech: "Incitamento all'odio", misinformation: "Contenuto fuorviante", privacy: "Dati personali", other: "Altro motivo" }, detailsOptional: "Descrizione (facoltativa)", submit: "Invia segnalazione", post: "Segnala post", postAlreadyReported: "Post già segnalato", answer: "Segnala risposta", answerAlreadyReported: "Risposta già segnalata" },
  ownContent: { eyebrow: "Il tuo contenuto community", editTitle: (target) => `Modifica ${target.toLowerCase()}`, deleteTitle: (target) => `Elimina ${target.toLowerCase()}`, contentPlaceholder: "Contenuto", saveChanges: "Salva modifiche", deleteAction: "Elimina", deletePostWarning: "Il post, i suoi allegati e tutte le risposte e reazioni correlate verranno eliminati definitivamente.", deleteAnswerWarning: "La risposta e i suoi allegati verranno rimossi definitivamente dal post.", editOwnPost: "Modifica il tuo post", editPost: "Modifica post", deleteOwnPost: "Elimina il tuo post", deletePost: "Elimina post" },
  feed: { filters: { all: "Tutti", discussion: "Discussioni", announcement: "Annunci", highlights: "In evidenza" }, memberFallback: "Membro Q-Academy", repliesLocked: "Risposte bloccate", emptyView: "Non ci sono ancora post in questa vista.", topFive: "Top 5", pointsAbbreviation: "pt" },
  personalized: { modes: { for_you: "Per te", following: "Seguiti", latest: "Più recenti" }, invalidResponse: "Il feed ha restituito una risposta non valida.", loadFailed: "Impossibile caricare il feed della community.", loadingLabel: "Caricamento feed", heading: "Feed personale della community", modeLabel: "Modalità feed", reload: "Ricarica", loading: "Caricamento", loadMore: "Altri post", empty: { for_you: "Non ci sono ancora post adatti a te.", following: "Segui persone o spazi per vedere qui i loro post.", latest: "Non sono ancora stati pubblicati post nella tua community." } },
  attachments: { title: "Allegati", chooseFile: "Scegli file", dropHint: "Trascina qui immagini, video, audio o documenti.", uploadFailed: "Caricamento non riuscito.", maximumFiles: (count) => `Puoi aggiungere al massimo ${count} file.`, invalidFile: "Il tipo o la dimensione del file non è valida.", removeFailed: "Impossibile rimuovere il file.", retry: (name) => `Riprendi il caricamento di ${name}`, retryAttachment: "Riprendi il caricamento", preparing: "Preparazione", uploading: (progress) => `Caricamento ${progress}%`, securityCheck: "Controllo di sicurezza", ready: (size) => `Pronto | ${size}`, remove: (name) => `Rimuovi ${name}`, removeAttachment: "Rimuovi allegato", open: (name) => `Apri ${name}`, video: (name) => `Video ${name}`, audio: (name) => `Audio ${name}` },
  spaces: { title: "Spazi", protected: "Protetto", noDescription: "Nessuna descrizione", empty: "Non è stato ancora configurato alcuno spazio." },
  submissions: { title: "Le mie pubblicazioni", empty: "Nessuna pubblicazione è in revisione.", status: { awaiting_review: "In attesa di revisione", in_review: "In revisione", appeal_pending: "Ricorso in revisione", published: "Pubblicato", held: "Trattenuto", rejected: "Rifiutato", appeal_upheld: "Ricorso respinto", appeal_accepted: "Ricorso accolto", unavailable: "Non più disponibile" }, reasons: { approval_required: "Approvazione richiesta", report_threshold: "Revisione della community richiesta", duplicate: "Contenuto simile in revisione", link_limit: "Limite di link dello spazio superato", manual: "Revisione manuale richiesta" }, postFallback: "Post della community", answerFallback: "Risposta della community", unavailableContent: "Il contenuto non è più disponibile.", submittedOn: (date) => `Inviato il ${date}`, appealStatement: "Motivazione del ricorso", appeal: "Presenta ricorso", sending: "Invio", sendAppeal: "Invia ricorso", deadline: (date) => `Termine per il ricorso: ${date}`, appealSubmitted: (date) => `Ricorso inviato il ${date}.`, appealAccepted: "Il tuo ricorso è stato accolto.", decisionConfirmed: "La decisione originale è stata confermata." },
  actions: { postSubmitted: "Post inviato.", postCreateFailed: "Impossibile pubblicare il post.", answerCreateFailed: "Impossibile pubblicare la risposta.", postSaved: "Post salvato.", answerSaved: "Risposta salvata.", changeSubmitted: "La modifica è stata inviata per la revisione.", postSaveFailed: "Impossibile salvare il post.", answerSaveFailed: "Impossibile salvare la risposta.", postDeleted: "Post eliminato.", answerDeleted: "Risposta eliminata.", postDeleteFailed: "Impossibile eliminare il post.", answerDeleteFailed: "Impossibile eliminare la risposta.", reportSent: "La segnalazione è stata inviata in modo riservato.", reportFailed: "Impossibile inviare la segnalazione.", appealFailed: "Impossibile inviare il ricorso." },
  editor: { contentFormat: "Formato del contenuto" },
};

const es: CommunityUiCopy = {
  common: { community: "Comunidad", allAreas: "Todas las áreas", badges: "Insignias", close: "Cerrar", closeDialog: "Cerrar diálogo", cancel: "Cancelar", retry: "Intentar de nuevo", post: "Publicación", answer: "Respuesta", course: "Curso", feed: "Feed", discussion: "Debate", announcement: "Anuncio", highlight: "Destacado" },
  profile: { completionTitle: "Completa tu perfil de comunidad", openFields: "Pendientes", goToProfile: "Ir al perfil", completeProfile: "Completar perfil", postRequirement: "Completa tu perfil para publicar", replyRequirement: "Completa tu perfil para responder.", profileOf: (name) => `Perfil de comunidad de ${name}` },
  reactions: { groupLabel: "Reacciones", commentGroupLabel: "Reacciones al comentario", commentSaveFailed: "No se pudo guardar la reacción al comentario.", remove: (label) => `Quitar ${label}`, options: { like: "Me gusta", celebrate: "Celebrar", insightful: "Útil", question: "Pregunta" } },
  votes: { up: "Voto positivo", removeUp: "Quitar voto positivo", down: "Voto negativo", removeDown: "Quitar voto negativo" },
  comments: { threadPlaceholder: "Responder en el hilo...", answerPlaceholder: "Escribir una respuesta...", cancelThreadReply: "Cancelar respuesta del hilo", publishAnswer: "Publicar respuesta", reply: "Responder", replyTo: (name) => `Responder a ${name}`, editOwn: "Editar tu respuesta", edit: "Editar respuesta", deleteOwn: "Eliminar tu respuesta", delete: "Eliminar respuesta", report: "Denunciar respuesta", alreadyReported: "Respuesta ya denunciada", reported: "Ya denunciada", loadingAnswers: "Cargando respuestas", loadAnswers: "Cargar respuestas", loadMoreAnswers: "Cargar más respuestas", loadingComments: "Cargando comentarios", loadMoreComments: "Cargar más comentarios", loadedAnswers: (visible, total) => `${visible} de ${total} respuestas cargadas.`, invalidResponse: "Las respuestas tienen un formato no válido.", loadCommentsFailed: "No se pudieron cargar más comentarios.", loadAnswersFailed: "No se pudieron cargar más respuestas." },
  feedReasons: { followedAuthor: "Sigues a esta persona", followedSpace: "Sigues este espacio", recent: "Novedad en tu comunidad", activeDiscussion: "Debate activo", popular: "Debate popular", engaged: "Coincide con tu actividad", sameGroup: "De tu entorno de aprendizaje", announcement: "Anuncio de tu academy", pinned: "Destacado por la academy", recommended: "Recomendado por el equipo de la academy" },
  follow: { author: (name) => `Seguir a ${name}`, unfollowAuthor: (name) => `Dejar de seguir a ${name}`, space: (name) => `Seguir ${name}`, unfollowSpace: (name) => `Dejar de seguir ${name}`, loadFailed: "No se pudieron cargar los seguimientos.", saveFollowFailed: "No se pudo guardar el seguimiento.", saveUnfollowFailed: "No se pudo dejar de seguir." },
  report: { moderation: "Moderación", title: (target) => `Denunciar ${target.toLowerCase()}`, reason: "Motivo", selectReason: "Seleccionar motivo", reasons: { spam: "Spam o publicidad", harassment: "Acoso", hate_speech: "Discurso de odio", misinformation: "Contenido engañoso", privacy: "Datos personales", other: "Otro motivo" }, detailsOptional: "Descripción (opcional)", submit: "Enviar denuncia", post: "Denunciar publicación", postAlreadyReported: "Publicación ya denunciada", answer: "Denunciar respuesta", answerAlreadyReported: "Respuesta ya denunciada" },
  ownContent: { eyebrow: "Tu contenido de comunidad", editTitle: (target) => `Editar ${target.toLowerCase()}`, deleteTitle: (target) => `Eliminar ${target.toLowerCase()}`, contentPlaceholder: "Contenido", saveChanges: "Guardar cambios", deleteAction: "Eliminar", deletePostWarning: "La publicación, sus archivos adjuntos y todas sus respuestas y reacciones se eliminarán permanentemente.", deleteAnswerWarning: "La respuesta y sus archivos adjuntos se eliminarán permanentemente de la publicación.", editOwnPost: "Editar tu publicación", editPost: "Editar publicación", deleteOwnPost: "Eliminar tu publicación", deletePost: "Eliminar publicación" },
  feed: { filters: { all: "Todo", discussion: "Debates", announcement: "Anuncios", highlights: "Destacados" }, memberFallback: "Miembro de Q-Academy", repliesLocked: "Respuestas bloqueadas", emptyView: "Aún no hay publicaciones en esta vista.", topFive: "Top 5", pointsAbbreviation: "pts" },
  personalized: { modes: { for_you: "Para ti", following: "Siguiendo", latest: "Recientes" }, invalidResponse: "El feed ha devuelto una respuesta no válida.", loadFailed: "No se pudo cargar el feed de la comunidad.", loadingLabel: "Cargando feed", heading: "Feed personal de la comunidad", modeLabel: "Modo del feed", reload: "Recargar", loading: "Cargando", loadMore: "Más publicaciones", empty: { for_you: "Aún no hay publicaciones adecuadas para ti.", following: "Sigue a personas o espacios para ver aquí sus publicaciones.", latest: "Aún no se han publicado contenidos en tu comunidad." } },
  attachments: { title: "Archivos adjuntos", chooseFile: "Elegir archivo", dropHint: "Suelta aquí imágenes, vídeos, audio o documentos.", uploadFailed: "Error al subir el archivo.", maximumFiles: (count) => `Puedes añadir un máximo de ${count} archivos.`, invalidFile: "El tipo o tamaño del archivo no es válido.", removeFailed: "No se pudo eliminar el archivo.", retry: (name) => `Reanudar la carga de ${name}`, retryAttachment: "Reanudar la carga", preparing: "Preparando", uploading: (progress) => `Subiendo ${progress}%`, securityCheck: "Comprobación de seguridad", ready: (size) => `Listo | ${size}`, remove: (name) => `Quitar ${name}`, removeAttachment: "Quitar archivo adjunto", open: (name) => `Abrir ${name}`, video: (name) => `Vídeo ${name}`, audio: (name) => `Audio ${name}` },
  spaces: { title: "Espacios", protected: "Protegido", noDescription: "Sin descripción", empty: "Aún no se ha configurado ningún espacio." },
  submissions: { title: "Mis envíos", empty: "No hay envíos en revisión de moderación.", status: { awaiting_review: "Pendiente de revisión", in_review: "En revisión", appeal_pending: "Recurso en revisión", published: "Publicado", held: "Retenido", rejected: "Rechazado", appeal_upheld: "Recurso rechazado", appeal_accepted: "Recurso aceptado", unavailable: "Ya no está disponible" }, reasons: { approval_required: "Aprobación necesaria", report_threshold: "Revisión de la comunidad necesaria", duplicate: "Se está revisando contenido similar", link_limit: "Se ha superado el límite de enlaces del espacio", manual: "Revisión manual necesaria" }, postFallback: "Publicación de la comunidad", answerFallback: "Respuesta de la comunidad", unavailableContent: "El contenido ya no está disponible.", submittedOn: (date) => `Enviado el ${date}`, appealStatement: "Motivo del recurso", appeal: "Presentar recurso", sending: "Enviando", sendAppeal: "Enviar recurso", deadline: (date) => `Plazo del recurso: ${date}`, appealSubmitted: (date) => `Recurso enviado el ${date}.`, appealAccepted: "Tu recurso ha sido aceptado.", decisionConfirmed: "Se ha confirmado la decisión original." },
  actions: { postSubmitted: "Publicación enviada.", postCreateFailed: "No se pudo publicar el contenido.", answerCreateFailed: "No se pudo publicar la respuesta.", postSaved: "Publicación guardada.", answerSaved: "Respuesta guardada.", changeSubmitted: "El cambio se ha enviado a revisión.", postSaveFailed: "No se pudo guardar la publicación.", answerSaveFailed: "No se pudo guardar la respuesta.", postDeleted: "Publicación eliminada.", answerDeleted: "Respuesta eliminada.", postDeleteFailed: "No se pudo eliminar la publicación.", answerDeleteFailed: "No se pudo eliminar la respuesta.", reportSent: "La denuncia se ha enviado de forma confidencial.", reportFailed: "No se pudo enviar la denuncia.", appealFailed: "No se pudo presentar el recurso." },
  editor: { contentFormat: "Formato del contenido" },
};

const fr: CommunityUiCopy = {
  common: { community: "Communauté", allAreas: "Tous les espaces", badges: "Badges", close: "Fermer", closeDialog: "Fermer la fenêtre", cancel: "Annuler", retry: "Réessayer", post: "Publication", answer: "Réponse", course: "Cours", feed: "Fil", discussion: "Discussion", announcement: "Annonce", highlight: "À la une" },
  profile: { completionTitle: "Complétez votre profil communautaire", openFields: "Manquants", goToProfile: "Voir le profil", completeProfile: "Compléter le profil", postRequirement: "Complétez votre profil pour publier", replyRequirement: "Complétez votre profil pour répondre.", profileOf: (name) => `Profil communautaire de ${name}` },
  reactions: { groupLabel: "Réactions", commentGroupLabel: "Réactions au commentaire", commentSaveFailed: "Impossible d'enregistrer la réaction au commentaire.", remove: (label) => `Retirer ${label}`, options: { like: "J'aime", celebrate: "Célébrer", insightful: "Utile", question: "Question" } },
  votes: { up: "Vote positif", removeUp: "Retirer le vote positif", down: "Vote négatif", removeDown: "Retirer le vote négatif" },
  comments: { threadPlaceholder: "Répondre dans le fil...", answerPlaceholder: "Écrire une réponse...", cancelThreadReply: "Annuler la réponse dans le fil", publishAnswer: "Publier la réponse", reply: "Répondre", replyTo: (name) => `Répondre à ${name}`, editOwn: "Modifier votre réponse", edit: "Modifier la réponse", deleteOwn: "Supprimer votre réponse", delete: "Supprimer la réponse", report: "Signaler la réponse", alreadyReported: "Réponse déjà signalée", reported: "Déjà signalée", loadingAnswers: "Chargement des réponses", loadAnswers: "Charger les réponses", loadMoreAnswers: "Charger plus de réponses", loadingComments: "Chargement des commentaires", loadMoreComments: "Charger plus de commentaires", loadedAnswers: (visible, total) => `${visible} réponses sur ${total} chargées.`, invalidResponse: "Les réponses ont un format non valide.", loadCommentsFailed: "Impossible de charger plus de commentaires.", loadAnswersFailed: "Impossible de charger plus de réponses." },
  feedReasons: { followedAuthor: "Vous suivez cette personne", followedSpace: "Vous suivez cet espace", recent: "Nouveau dans votre communauté", activeDiscussion: "Discussion active", popular: "Discussion populaire", engaged: "Correspond à votre activité", sameGroup: "De votre réseau d'apprentissage", announcement: "Annonce de votre academy", pinned: "Mis en avant par l'academy", recommended: "Recommandé par l'équipe de l'academy" },
  follow: { author: (name) => `Suivre ${name}`, unfollowAuthor: (name) => `Ne plus suivre ${name}`, space: (name) => `Suivre ${name}`, unfollowSpace: (name) => `Ne plus suivre ${name}`, loadFailed: "Impossible de charger les suivis.", saveFollowFailed: "Impossible d'enregistrer le suivi.", saveUnfollowFailed: "Impossible d'arrêter le suivi." },
  report: { moderation: "Modération", title: (target) => `Signaler ${target.toLowerCase()}`, reason: "Motif", selectReason: "Sélectionner un motif", reasons: { spam: "Spam ou publicité", harassment: "Harcèlement", hate_speech: "Discours haineux", misinformation: "Contenu trompeur", privacy: "Données personnelles", other: "Autre motif" }, detailsOptional: "Description (facultative)", submit: "Envoyer le signalement", post: "Signaler la publication", postAlreadyReported: "Publication déjà signalée", answer: "Signaler la réponse", answerAlreadyReported: "Réponse déjà signalée" },
  ownContent: { eyebrow: "Votre contenu communautaire", editTitle: (target) => `Modifier ${target.toLowerCase()}`, deleteTitle: (target) => `Supprimer ${target.toLowerCase()}`, contentPlaceholder: "Contenu", saveChanges: "Enregistrer les modifications", deleteAction: "Supprimer", deletePostWarning: "La publication, ses pièces jointes ainsi que toutes les réponses et réactions associées seront définitivement supprimées.", deleteAnswerWarning: "La réponse et ses pièces jointes seront définitivement retirées de la publication.", editOwnPost: "Modifier votre publication", editPost: "Modifier la publication", deleteOwnPost: "Supprimer votre publication", deletePost: "Supprimer la publication" },
  feed: { filters: { all: "Tout", discussion: "Discussions", announcement: "Annonces", highlights: "À la une" }, memberFallback: "Membre Q-Academy", repliesLocked: "Réponses verrouillées", emptyView: "Aucune publication dans cette vue pour le moment.", topFive: "Top 5", pointsAbbreviation: "pts" },
  personalized: { modes: { for_you: "Pour vous", following: "Abonnements", latest: "Récentes" }, invalidResponse: "Le fil a renvoyé une réponse non valide.", loadFailed: "Impossible de charger le fil de la communauté.", loadingLabel: "Chargement du fil", heading: "Fil communautaire personnel", modeLabel: "Mode du fil", reload: "Recharger", loading: "Chargement", loadMore: "Plus de publications", empty: { for_you: "Aucune publication adaptée pour le moment.", following: "Suivez des personnes ou des espaces pour voir leurs publications ici.", latest: "Aucune publication n'a encore été publiée dans votre communauté." } },
  attachments: { title: "Pièces jointes", chooseFile: "Choisir un fichier", dropHint: "Déposez ici des images, vidéos, fichiers audio ou documents.", uploadFailed: "Échec du téléversement.", maximumFiles: (count) => `Vous pouvez ajouter jusqu'à ${count} fichiers.`, invalidFile: "Le type ou la taille du fichier n'est pas valide.", removeFailed: "Impossible de supprimer le fichier.", retry: (name) => `Reprendre le téléversement de ${name}`, retryAttachment: "Reprendre le téléversement", preparing: "Préparation", uploading: (progress) => `Téléversement ${progress}%`, securityCheck: "Contrôle de sécurité", ready: (size) => `Prêt | ${size}`, remove: (name) => `Retirer ${name}`, removeAttachment: "Retirer la pièce jointe", open: (name) => `Ouvrir ${name}`, video: (name) => `Vidéo ${name}`, audio: (name) => `Audio ${name}` },
  spaces: { title: "Espaces", protected: "Protégé", noDescription: "Aucune description", empty: "Aucun espace n'a encore été configuré." },
  submissions: { title: "Mes publications", empty: "Aucune publication n'est en cours de modération.", status: { awaiting_review: "En attente d'examen", in_review: "En cours d'examen", appeal_pending: "Recours en cours d'examen", published: "Publié", held: "Retenu", rejected: "Rejeté", appeal_upheld: "Recours rejeté", appeal_accepted: "Recours accepté", unavailable: "Plus disponible" }, reasons: { approval_required: "Approbation requise", report_threshold: "Examen communautaire requis", duplicate: "Un contenu similaire est en cours d'examen", link_limit: "Limite de liens de l'espace dépassée", manual: "Examen manuel requis" }, postFallback: "Publication communautaire", answerFallback: "Réponse communautaire", unavailableContent: "Le contenu n'est plus disponible.", submittedOn: (date) => `Envoyé le ${date}`, appealStatement: "Motif du recours", appeal: "Déposer un recours", sending: "Envoi", sendAppeal: "Envoyer le recours", deadline: (date) => `Date limite du recours : ${date}`, appealSubmitted: (date) => `Recours envoyé le ${date}.`, appealAccepted: "Votre recours a été accepté.", decisionConfirmed: "La décision initiale a été confirmée." },
  actions: { postSubmitted: "Publication envoyée.", postCreateFailed: "Impossible de publier le contenu.", answerCreateFailed: "Impossible de publier la réponse.", postSaved: "Publication enregistrée.", answerSaved: "Réponse enregistrée.", changeSubmitted: "La modification a été envoyée pour examen.", postSaveFailed: "Impossible d'enregistrer la publication.", answerSaveFailed: "Impossible d'enregistrer la réponse.", postDeleted: "Publication supprimée.", answerDeleted: "Réponse supprimée.", postDeleteFailed: "Impossible de supprimer la publication.", answerDeleteFailed: "Impossible de supprimer la réponse.", reportSent: "Le signalement a été envoyé de manière confidentielle.", reportFailed: "Impossible d'envoyer le signalement.", appealFailed: "Impossible de déposer le recours." },
  editor: { contentFormat: "Format du contenu" },
};

const communityUiDictionaries: Record<AppLocale, CommunityUiCopy> = {
  de,
  en,
  it,
  es,
  fr,
};

export function getCommunityUiCopy(locale: AppLocale) {
  return communityUiDictionaries[locale];
}
