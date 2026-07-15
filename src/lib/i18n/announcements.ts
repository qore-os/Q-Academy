import type { AppLocale } from "@/lib/i18n/model";

export type AnnouncementTemplateKey =
  | "welcome"
  | "event"
  | "maintenance"
  | "learning";

type WidenCopy<T> = T extends (...args: infer Args) => string
  ? (...args: Args) => string
  : T extends string
    ? string
    : { readonly [Key in keyof T]: WidenCopy<T[Key]> };

const de = {
  page: {
    metadataTitle: "Ankuendigungen",
    eyebrow: "Mitglieder-Erlebnis",
    title: "Ankuendigungen",
    description:
      "Steuere zeitgesteuerte Banner und Modals mit praezisen Zielgruppenregeln.",
  },
  manager: {
    search: "Ankuendigungen durchsuchen",
    create: "Neue Ankuendigung",
    empty: "Keine passenden Ankuendigungen",
    confirmDelete: "Wirklich loeschen?",
    delete: "Loeschen",
    cancel: "Abbrechen",
    activate: "Aktivieren",
    deactivate: "Deaktivieren",
    editAnnouncement: "Ankuendigung bearbeiten",
    edit: "Bearbeiten",
    deleteAnnouncement: "Ankuendigung loeschen",
  },
  status: {
    live: "Live",
    scheduled: "Geplant",
    ended: "Beendet",
    inactive: "Inaktiv",
  },
  placement: {
    banner: "Banner",
    modal: "Modal",
    bannerDescription: "Banner im Inhalt",
    modalDescription: "Modal beim Oeffnen",
  },
  audience: {
    all: "Alle Mitglieder",
    group: "Bestimmte Gruppe",
    user: "Einzelnes Mitglied",
    groupShort: "Gruppe",
    userShort: "Ein Mitglied",
  },
  metrics: {
    impressions: "Einblendungen",
    impressionsAria: (count: string) => `${count} Einblendungen`,
    clicks: "Klicks",
    clicksAria: (count: string) => `${count} Klicks`,
    dismissals: "Geschlossen",
    dismissalsAria: (count: string) => `${count} geschlossen`,
    clickRate: (rate: string) => `${rate} Klickrate`,
    rules: (count: string) => `${count} Regeln`,
  },
  editor: {
    eyebrow: "Mitglieder-Kommunikation",
    editTitle: "Ankuendigung bearbeiten",
    createTitle: "Neue Ankuendigung",
    close: "Editor schliessen",
    template: "Vorlage",
    templateAria: "Ankuendigungsvorlage",
    applyTemplate: "Vorlage uebernehmen",
    title: "Titel",
    placement: "Darstellung",
    tone: "Tonalitaet",
    audience: "Zielgruppe",
    recipient: "Empfaenger",
    allRecipients: "Alle",
    selectRecipient: "Bitte auswaehlen",
    start: "Start",
    endOptional: "Ende (optional)",
    active: "Aktiv ausspielen",
    dismissible: "Darf geschlossen werden",
    cancel: "Abbrechen",
    saving: "Wird gespeichert",
    save: "Ankuendigung speichern",
  },
  tone: {
    info: "Information",
    success: "Erfolg",
    warning: "Hinweis",
    critical: "Wichtig",
  },
  templates: {
    welcome: {
      label: "Willkommen",
      title: "Willkommen in deiner Academy",
      body: "Schoen, dass du da bist. Entdecke jetzt deine freigeschalteten Lerninhalte und starte mit deinem ersten Kurs.",
      placement: "modal",
      tone: "success",
      href: "/academy/courses",
      actionLabel: "Kurse entdecken",
    },
    event: {
      label: "Event-Hinweis",
      title: "Naechster Live-Termin",
      body: "Ein neuer Live-Termin steht bevor. Sichere dir deinen Platz und fuege den Termin direkt deinem Kalender hinzu.",
      placement: "banner",
      tone: "info",
      href: "/academy/events",
      actionLabel: "Termin ansehen",
    },
    maintenance: {
      label: "Wartung",
      title: "Geplante Wartungsarbeiten",
      body: "Die Academy ist im angekuendigten Zeitraum kurzzeitig nicht erreichbar. Bereits gespeicherte Lernfortschritte bleiben erhalten.",
      placement: "banner",
      tone: "warning",
      href: "",
      actionLabel: "",
    },
    learning: {
      label: "Lernimpuls",
      title: "Setze deinen Lernpfad fort",
      body: "Dein naechster Lernschritt wartet auf dich. Oeffne deine Kurse und setze dort fort, wo du zuletzt aufgehoert hast.",
      placement: "modal",
      tone: "info",
      href: "/academy/courses",
      actionLabel: "Weiterlernen",
    },
  },
  targetRules: {
    title: "Zielgruppenregeln",
    conjunction: "UND",
    conditions: (count: string) => `${count} Bedingungen`,
    add: "Regel",
    empty: "Keine zusaetzlichen Regeln",
    previewTitle: "Zielgruppenvorschau",
    matchingMembers: (count: string) => `${count} passende Mitglieder`,
    noMatches: "Keine Treffer",
    calculating: "Wird berechnet",
    calculate: "Vorschau berechnen",
    ruleType: (index: number) => `Regeltyp ${index}`,
    role: (index: number) => `Rolle ${index}`,
    group: (index: number) => `Gruppe ${index}`,
    groupMatch: (index: number) => `Gruppenabgleich ${index}`,
    bundle: (index: number) => `Bundle ${index}`,
    bundleMatch: (index: number) => `Bundleabgleich ${index}`,
    course: (index: number) => `Kurs ${index}`,
    courseAccess: (index: number) => `Kurszugriff ${index}`,
    progressCourse: (index: number) => `Fortschrittskurs ${index}`,
    progressComparison: (index: number) => `Fortschrittsvergleich ${index}`,
    progressValue: (index: number) => `Fortschrittswert ${index}`,
    progressMaximum: (index: number) => `Fortschrittsobergrenze ${index}`,
    remove: (index: number) => `Regel ${index} entfernen`,
    removeTitle: "Regel entfernen",
    types: {
      role: "Rolle",
      group: "Gruppe",
      bundle: "Bundle",
      courseAccess: "Kurszugriff",
      courseProgress: "Kursfortschritt",
    },
    roles: {
      member: "Mitglied",
      trainer: "Trainer",
      admin: "Admin",
      owner: "Owner",
    },
    groupMatches: {
      member: "ist Mitglied",
      notMember: "ist kein Mitglied",
    },
    bundleMatches: {
      member: "hat Bundle",
      notMember: "hat Bundle nicht",
    },
    access: {
      granted: "Zugriff vorhanden",
      notGranted: "Kein Zugriff",
    },
    comparison: {
      atLeast: "mindestens",
      atMost: "hoechstens",
      between: "zwischen",
    },
  },
  blocks: {
    title: "Inhaltsbloecke",
    count: (count: string, maximum: string) =>
      `${count} von ${maximum} Bloecken`,
    addText: "Text",
    addCallout: "Hinweis",
    addDivider: "Linie",
    addButton: "Button",
    labels: {
      richText: "Rich-Text",
      callout: "Hinweis",
      divider: "Trennlinie",
      cta: "Button",
    },
    moveUp: (index: number) => `Block ${index} nach oben`,
    moveDown: (index: number) => `Block ${index} nach unten`,
    remove: (index: number) => `Block ${index} entfernen`,
    moveUpTitle: "Nach oben",
    moveDownTitle: "Nach unten",
    removeTitle: "Entfernen",
    richTextAria: (index: number) => `Rich-Text Block ${index}`,
    richTextPlaceholder: "Nachricht eingeben",
    tone: "Tonalitaet",
    heading: "Ueberschrift",
    text: "Text",
    dividerStyle: "Linienstil",
    dividerStyles: {
      solid: "Durchgezogen",
      dashed: "Gestrichelt",
      dotted: "Gepunktet",
    },
    label: "Beschriftung",
    target: "Ziel",
    appearance: "Darstellung",
    appearances: {
      primary: "Primaer",
      secondary: "Sekundaer",
    },
    empty: "Noch keine Inhaltsbloecke",
    variables: "Sichere Variablen",
    variablesRegion: "Scrollbare Liste sicherer Variablen",
    previewAria: "Inhaltsvorschau",
    preview: "Vorschau",
    defaults: {
      richText: "Neuer Inhalt",
      calloutTitle: "Hinweis",
      calloutBody: "Wichtige Information",
      ctaLabel: "Mehr erfahren",
    },
  },
  layer: {
    announcements: "Ankuendigungen",
    closeAnnouncement: "Ankuendigung schliessen",
    close: "Schliessen",
    modalEyebrow: "Neu in deiner Academy",
  },
  variables: {
    firstName: "Mitglied: Vorname",
    lastName: "Mitglied: Nachname",
    fullName: "Mitglied: Voller Name",
  },
  actionMessages: {
    invalidAnnouncement: "Die Ankuendigung ist ungueltig.",
    invalidRules: "Die Zielgruppenregeln sind ungueltig.",
    invalidContent: "Die Inhaltsbloecke sind ungueltig.",
    invalidEntries: "Bitte pruefe die Eingaben.",
    invalidVariables: "Mindestens eine Variable ist in diesem Kontext ungueltig.",
    unavailableReference: "Mindestens eine Zielgruppe ist nicht mehr verfuegbar.",
    invalidConfiguration: "Bitte pruefe Zeitraum, Darstellung und Aktion.",
    updated: "Ankuendigung aktualisiert.",
    created: "Ankuendigung erstellt.",
    saveFailed: "Die Ankuendigung konnte nicht gespeichert werden.",
    previewInvalid: "Bitte pruefe die Zielgruppe und ihre Regeln.",
    previewFailed: "Die Vorschau konnte nicht berechnet werden.",
  },
} as const;

export type AnnouncementCopy = WidenCopy<typeof de>;

const en: AnnouncementCopy = {
  page: { metadataTitle: "Announcements", eyebrow: "Member experience", title: "Announcements", description: "Manage scheduled banners and modals with precise audience rules." },
  manager: { search: "Search announcements", create: "New announcement", empty: "No matching announcements", confirmDelete: "Delete this announcement?", delete: "Delete", cancel: "Cancel", activate: "Activate", deactivate: "Deactivate", editAnnouncement: "Edit announcement", edit: "Edit", deleteAnnouncement: "Delete announcement" },
  status: { live: "Live", scheduled: "Scheduled", ended: "Ended", inactive: "Inactive" },
  placement: { banner: "Banner", modal: "Modal", bannerDescription: "Banner in content", modalDescription: "Modal when opening" },
  audience: { all: "All members", group: "Specific group", user: "Individual member", groupShort: "Group", userShort: "One member" },
  metrics: { impressions: "Impressions", impressionsAria: (count) => `${count} impressions`, clicks: "Clicks", clicksAria: (count) => `${count} clicks`, dismissals: "Dismissed", dismissalsAria: (count) => `${count} dismissed`, clickRate: (rate) => `${rate} click rate`, rules: (count) => `${count} rules` },
  editor: { eyebrow: "Member communication", editTitle: "Edit announcement", createTitle: "New announcement", close: "Close editor", template: "Template", templateAria: "Announcement template", applyTemplate: "Apply template", title: "Title", placement: "Placement", tone: "Tone", audience: "Audience", recipient: "Recipient", allRecipients: "All", selectRecipient: "Select a recipient", start: "Start", endOptional: "End (optional)", active: "Deliver while active", dismissible: "Can be dismissed", cancel: "Cancel", saving: "Saving", save: "Save announcement" },
  tone: { info: "Information", success: "Success", warning: "Notice", critical: "Critical" },
  templates: {
    welcome: { label: "Welcome", title: "Welcome to your Academy", body: "It is great to have you here. Explore your available learning content and start your first course.", placement: "modal", tone: "success", href: "/academy/courses", actionLabel: "Explore courses" },
    event: { label: "Event notice", title: "Next live session", body: "A new live session is coming up. Reserve your place and add the session directly to your calendar.", placement: "banner", tone: "info", href: "/academy/events", actionLabel: "View session" },
    maintenance: { label: "Maintenance", title: "Scheduled maintenance", body: "The Academy will be briefly unavailable during the announced period. Saved learning progress will remain intact.", placement: "banner", tone: "warning", href: "", actionLabel: "" },
    learning: { label: "Learning prompt", title: "Continue your learning path", body: "Your next learning step is waiting. Open your courses and continue where you left off.", placement: "modal", tone: "info", href: "/academy/courses", actionLabel: "Continue learning" },
  },
  targetRules: {
    title: "Audience rules", conjunction: "AND", conditions: (count) => `${count} conditions`, add: "Rule", empty: "No additional rules", previewTitle: "Audience preview", matchingMembers: (count) => `${count} matching members`, noMatches: "No matches", calculating: "Calculating", calculate: "Calculate preview",
    ruleType: (index) => `Rule type ${index}`, role: (index) => `Role ${index}`, group: (index) => `Group ${index}`, groupMatch: (index) => `Group match ${index}`, bundle: (index) => `Bundle ${index}`, bundleMatch: (index) => `Bundle match ${index}`, course: (index) => `Course ${index}`, courseAccess: (index) => `Course access ${index}`, progressCourse: (index) => `Progress course ${index}`, progressComparison: (index) => `Progress comparison ${index}`, progressValue: (index) => `Progress value ${index}`, progressMaximum: (index) => `Progress maximum ${index}`, remove: (index) => `Remove rule ${index}`, removeTitle: "Remove rule",
    types: { role: "Role", group: "Group", bundle: "Bundle", courseAccess: "Course access", courseProgress: "Course progress" }, roles: { member: "Member", trainer: "Trainer", admin: "Admin", owner: "Owner" }, groupMatches: { member: "is a member", notMember: "is not a member" }, bundleMatches: { member: "has bundle", notMember: "does not have bundle" }, access: { granted: "Has access", notGranted: "No access" }, comparison: { atLeast: "at least", atMost: "at most", between: "between" },
  },
  blocks: {
    title: "Content blocks", count: (count, maximum) => `${count} of ${maximum} blocks`, addText: "Text", addCallout: "Notice", addDivider: "Line", addButton: "Button", labels: { richText: "Rich text", callout: "Notice", divider: "Divider", cta: "Button" }, moveUp: (index) => `Move block ${index} up`, moveDown: (index) => `Move block ${index} down`, remove: (index) => `Remove block ${index}`, moveUpTitle: "Move up", moveDownTitle: "Move down", removeTitle: "Remove", richTextAria: (index) => `Rich text block ${index}`, richTextPlaceholder: "Enter message", tone: "Tone", heading: "Heading", text: "Text", dividerStyle: "Line style", dividerStyles: { solid: "Solid", dashed: "Dashed", dotted: "Dotted" }, label: "Label", target: "Destination", appearance: "Appearance", appearances: { primary: "Primary", secondary: "Secondary" }, empty: "No content blocks yet", variables: "Safe variables", variablesRegion: "Scrollable list of safe variables", previewAria: "Content preview", preview: "Preview", defaults: { richText: "New content", calloutTitle: "Notice", calloutBody: "Important information", ctaLabel: "Learn more" },
  },
  layer: { announcements: "Announcements", closeAnnouncement: "Close announcement", close: "Close", modalEyebrow: "New in your Academy" },
  variables: { firstName: "Member: first name", lastName: "Member: last name", fullName: "Member: full name" },
  actionMessages: { invalidAnnouncement: "The announcement is invalid.", invalidRules: "The audience rules are invalid.", invalidContent: "The content blocks are invalid.", invalidEntries: "Check the form entries.", invalidVariables: "At least one variable is invalid in this context.", unavailableReference: "At least one audience reference is no longer available.", invalidConfiguration: "Check the schedule, placement and action.", updated: "Announcement updated.", created: "Announcement created.", saveFailed: "The announcement could not be saved.", previewInvalid: "Check the audience and its rules.", previewFailed: "The preview could not be calculated." },
};

const it: AnnouncementCopy = {
  page: { metadataTitle: "Annunci", eyebrow: "Esperienza dei membri", title: "Annunci", description: "Gestisci banner e finestre programmate con regole precise per il pubblico." },
  manager: { search: "Cerca annunci", create: "Nuovo annuncio", empty: "Nessun annuncio corrispondente", confirmDelete: "Eliminare questo annuncio?", delete: "Elimina", cancel: "Annulla", activate: "Attiva", deactivate: "Disattiva", editAnnouncement: "Modifica annuncio", edit: "Modifica", deleteAnnouncement: "Elimina annuncio" },
  status: { live: "Attivo", scheduled: "Programmato", ended: "Terminato", inactive: "Inattivo" },
  placement: { banner: "Banner", modal: "Finestra", bannerDescription: "Banner nel contenuto", modalDescription: "Finestra all'apertura" },
  audience: { all: "Tutti i membri", group: "Gruppo specifico", user: "Singolo membro", groupShort: "Gruppo", userShort: "Un membro" },
  metrics: { impressions: "Visualizzazioni", impressionsAria: (count) => `${count} visualizzazioni`, clicks: "Clic", clicksAria: (count) => `${count} clic`, dismissals: "Chiusi", dismissalsAria: (count) => `${count} chiusi`, clickRate: (rate) => `${rate} tasso di clic`, rules: (count) => `${count} regole` },
  editor: { eyebrow: "Comunicazione ai membri", editTitle: "Modifica annuncio", createTitle: "Nuovo annuncio", close: "Chiudi editor", template: "Modello", templateAria: "Modello di annuncio", applyTemplate: "Applica modello", title: "Titolo", placement: "Posizione", tone: "Tono", audience: "Pubblico", recipient: "Destinatario", allRecipients: "Tutti", selectRecipient: "Seleziona un destinatario", start: "Inizio", endOptional: "Fine (facoltativa)", active: "Distribuisci quando attivo", dismissible: "Puo essere chiuso", cancel: "Annulla", saving: "Salvataggio", save: "Salva annuncio" },
  tone: { info: "Informazione", success: "Successo", warning: "Avviso", critical: "Critico" },
  templates: {
    welcome: { label: "Benvenuto", title: "Benvenuto nella tua Academy", body: "Siamo felici che tu sia qui. Esplora i contenuti disponibili e inizia il tuo primo corso.", placement: "modal", tone: "success", href: "/academy/courses", actionLabel: "Esplora i corsi" },
    event: { label: "Avviso evento", title: "Prossima sessione dal vivo", body: "Una nuova sessione dal vivo sta per iniziare. Prenota il tuo posto e aggiungila direttamente al calendario.", placement: "banner", tone: "info", href: "/academy/events", actionLabel: "Vedi sessione" },
    maintenance: { label: "Manutenzione", title: "Manutenzione programmata", body: "L'Academy non sara disponibile per un breve periodo. I progressi di apprendimento salvati resteranno invariati.", placement: "banner", tone: "warning", href: "", actionLabel: "" },
    learning: { label: "Stimolo didattico", title: "Continua il tuo percorso", body: "Il prossimo passo ti aspetta. Apri i corsi e continua da dove avevi interrotto.", placement: "modal", tone: "info", href: "/academy/courses", actionLabel: "Continua a imparare" },
  },
  targetRules: {
    title: "Regole del pubblico", conjunction: "E", conditions: (count) => `${count} condizioni`, add: "Regola", empty: "Nessuna regola aggiuntiva", previewTitle: "Anteprima del pubblico", matchingMembers: (count) => `${count} membri corrispondenti`, noMatches: "Nessun risultato", calculating: "Calcolo", calculate: "Calcola anteprima",
    ruleType: (index) => `Tipo di regola ${index}`, role: (index) => `Ruolo ${index}`, group: (index) => `Gruppo ${index}`, groupMatch: (index) => `Corrispondenza gruppo ${index}`, bundle: (index) => `Pacchetto ${index}`, bundleMatch: (index) => `Corrispondenza pacchetto ${index}`, course: (index) => `Corso ${index}`, courseAccess: (index) => `Accesso corso ${index}`, progressCourse: (index) => `Corso di avanzamento ${index}`, progressComparison: (index) => `Confronto avanzamento ${index}`, progressValue: (index) => `Valore avanzamento ${index}`, progressMaximum: (index) => `Massimo avanzamento ${index}`, remove: (index) => `Rimuovi regola ${index}`, removeTitle: "Rimuovi regola",
    types: { role: "Ruolo", group: "Gruppo", bundle: "Pacchetto", courseAccess: "Accesso al corso", courseProgress: "Avanzamento corso" }, roles: { member: "Membro", trainer: "Formatore", admin: "Amministratore", owner: "Proprietario" }, groupMatches: { member: "e membro", notMember: "non e membro" }, bundleMatches: { member: "ha il pacchetto", notMember: "non ha il pacchetto" }, access: { granted: "Ha accesso", notGranted: "Nessun accesso" }, comparison: { atLeast: "almeno", atMost: "al massimo", between: "tra" },
  },
  blocks: {
    title: "Blocchi di contenuto", count: (count, maximum) => `${count} di ${maximum} blocchi`, addText: "Testo", addCallout: "Avviso", addDivider: "Linea", addButton: "Pulsante", labels: { richText: "Testo ricco", callout: "Avviso", divider: "Separatore", cta: "Pulsante" }, moveUp: (index) => `Sposta il blocco ${index} in alto`, moveDown: (index) => `Sposta il blocco ${index} in basso`, remove: (index) => `Rimuovi il blocco ${index}`, moveUpTitle: "Sposta in alto", moveDownTitle: "Sposta in basso", removeTitle: "Rimuovi", richTextAria: (index) => `Blocco di testo ricco ${index}`, richTextPlaceholder: "Inserisci messaggio", tone: "Tono", heading: "Titolo", text: "Testo", dividerStyle: "Stile linea", dividerStyles: { solid: "Continua", dashed: "Tratteggiata", dotted: "Puntinata" }, label: "Etichetta", target: "Destinazione", appearance: "Aspetto", appearances: { primary: "Primario", secondary: "Secondario" }, empty: "Nessun blocco di contenuto", variables: "Variabili sicure", variablesRegion: "Elenco scorrevole delle variabili sicure", previewAria: "Anteprima contenuto", preview: "Anteprima", defaults: { richText: "Nuovo contenuto", calloutTitle: "Avviso", calloutBody: "Informazione importante", ctaLabel: "Scopri di piu" },
  },
  layer: { announcements: "Annunci", closeAnnouncement: "Chiudi annuncio", close: "Chiudi", modalEyebrow: "Novita nella tua Academy" },
  variables: { firstName: "Membro: nome", lastName: "Membro: cognome", fullName: "Membro: nome completo" },
  actionMessages: { invalidAnnouncement: "L'annuncio non e valido.", invalidRules: "Le regole del pubblico non sono valide.", invalidContent: "I blocchi di contenuto non sono validi.", invalidEntries: "Controlla i dati inseriti.", invalidVariables: "Almeno una variabile non e valida in questo contesto.", unavailableReference: "Almeno un riferimento al pubblico non e piu disponibile.", invalidConfiguration: "Controlla programmazione, posizione e azione.", updated: "Annuncio aggiornato.", created: "Annuncio creato.", saveFailed: "Non e stato possibile salvare l'annuncio.", previewInvalid: "Controlla il pubblico e le relative regole.", previewFailed: "Non e stato possibile calcolare l'anteprima." },
};

const es: AnnouncementCopy = {
  page: { metadataTitle: "Anuncios", eyebrow: "Experiencia de miembros", title: "Anuncios", description: "Gestiona banners y ventanas programadas con reglas precisas de audiencia." },
  manager: { search: "Buscar anuncios", create: "Nuevo anuncio", empty: "No hay anuncios coincidentes", confirmDelete: "Eliminar este anuncio?", delete: "Eliminar", cancel: "Cancelar", activate: "Activar", deactivate: "Desactivar", editAnnouncement: "Editar anuncio", edit: "Editar", deleteAnnouncement: "Eliminar anuncio" },
  status: { live: "Activo", scheduled: "Programado", ended: "Finalizado", inactive: "Inactivo" },
  placement: { banner: "Banner", modal: "Ventana", bannerDescription: "Banner en el contenido", modalDescription: "Ventana al abrir" },
  audience: { all: "Todos los miembros", group: "Grupo especifico", user: "Miembro individual", groupShort: "Grupo", userShort: "Un miembro" },
  metrics: { impressions: "Impresiones", impressionsAria: (count) => `${count} impresiones`, clicks: "Clics", clicksAria: (count) => `${count} clics`, dismissals: "Cerrados", dismissalsAria: (count) => `${count} cerrados`, clickRate: (rate) => `${rate} tasa de clics`, rules: (count) => `${count} reglas` },
  editor: { eyebrow: "Comunicacion con miembros", editTitle: "Editar anuncio", createTitle: "Nuevo anuncio", close: "Cerrar editor", template: "Plantilla", templateAria: "Plantilla de anuncio", applyTemplate: "Aplicar plantilla", title: "Titulo", placement: "Ubicacion", tone: "Tono", audience: "Audiencia", recipient: "Destinatario", allRecipients: "Todos", selectRecipient: "Selecciona un destinatario", start: "Inicio", endOptional: "Fin (opcional)", active: "Mostrar mientras este activo", dismissible: "Se puede cerrar", cancel: "Cancelar", saving: "Guardando", save: "Guardar anuncio" },
  tone: { info: "Informacion", success: "Exito", warning: "Aviso", critical: "Critico" },
  templates: {
    welcome: { label: "Bienvenida", title: "Te damos la bienvenida a tu Academy", body: "Nos alegra tenerte aqui. Explora el contenido disponible y comienza tu primer curso.", placement: "modal", tone: "success", href: "/academy/courses", actionLabel: "Explorar cursos" },
    event: { label: "Aviso de evento", title: "Proxima sesion en directo", body: "Se acerca una nueva sesion en directo. Reserva tu plaza y anadela directamente a tu calendario.", placement: "banner", tone: "info", href: "/academy/events", actionLabel: "Ver sesion" },
    maintenance: { label: "Mantenimiento", title: "Mantenimiento programado", body: "La Academy no estara disponible durante un breve periodo. El progreso guardado se mantendra intacto.", placement: "banner", tone: "warning", href: "", actionLabel: "" },
    learning: { label: "Impulso formativo", title: "Continua tu itinerario", body: "Tu siguiente paso te espera. Abre tus cursos y continua donde lo dejaste.", placement: "modal", tone: "info", href: "/academy/courses", actionLabel: "Seguir aprendiendo" },
  },
  targetRules: {
    title: "Reglas de audiencia", conjunction: "Y", conditions: (count) => `${count} condiciones`, add: "Regla", empty: "No hay reglas adicionales", previewTitle: "Vista previa de audiencia", matchingMembers: (count) => `${count} miembros coincidentes`, noMatches: "Sin resultados", calculating: "Calculando", calculate: "Calcular vista previa",
    ruleType: (index) => `Tipo de regla ${index}`, role: (index) => `Rol ${index}`, group: (index) => `Grupo ${index}`, groupMatch: (index) => `Coincidencia de grupo ${index}`, bundle: (index) => `Paquete ${index}`, bundleMatch: (index) => `Coincidencia de paquete ${index}`, course: (index) => `Curso ${index}`, courseAccess: (index) => `Acceso al curso ${index}`, progressCourse: (index) => `Curso de progreso ${index}`, progressComparison: (index) => `Comparacion de progreso ${index}`, progressValue: (index) => `Valor de progreso ${index}`, progressMaximum: (index) => `Maximo de progreso ${index}`, remove: (index) => `Quitar regla ${index}`, removeTitle: "Quitar regla",
    types: { role: "Rol", group: "Grupo", bundle: "Paquete", courseAccess: "Acceso al curso", courseProgress: "Progreso del curso" }, roles: { member: "Miembro", trainer: "Formador", admin: "Administrador", owner: "Propietario" }, groupMatches: { member: "es miembro", notMember: "no es miembro" }, bundleMatches: { member: "tiene el paquete", notMember: "no tiene el paquete" }, access: { granted: "Tiene acceso", notGranted: "Sin acceso" }, comparison: { atLeast: "al menos", atMost: "como maximo", between: "entre" },
  },
  blocks: {
    title: "Bloques de contenido", count: (count, maximum) => `${count} de ${maximum} bloques`, addText: "Texto", addCallout: "Aviso", addDivider: "Linea", addButton: "Boton", labels: { richText: "Texto enriquecido", callout: "Aviso", divider: "Separador", cta: "Boton" }, moveUp: (index) => `Subir bloque ${index}`, moveDown: (index) => `Bajar bloque ${index}`, remove: (index) => `Quitar bloque ${index}`, moveUpTitle: "Subir", moveDownTitle: "Bajar", removeTitle: "Quitar", richTextAria: (index) => `Bloque de texto enriquecido ${index}`, richTextPlaceholder: "Escribe el mensaje", tone: "Tono", heading: "Encabezado", text: "Texto", dividerStyle: "Estilo de linea", dividerStyles: { solid: "Continua", dashed: "Discontinua", dotted: "Punteada" }, label: "Etiqueta", target: "Destino", appearance: "Aspecto", appearances: { primary: "Principal", secondary: "Secundario" }, empty: "Aun no hay bloques de contenido", variables: "Variables seguras", variablesRegion: "Lista desplazable de variables seguras", previewAria: "Vista previa del contenido", preview: "Vista previa", defaults: { richText: "Nuevo contenido", calloutTitle: "Aviso", calloutBody: "Informacion importante", ctaLabel: "Mas informacion" },
  },
  layer: { announcements: "Anuncios", closeAnnouncement: "Cerrar anuncio", close: "Cerrar", modalEyebrow: "Novedades en tu Academy" },
  variables: { firstName: "Miembro: nombre", lastName: "Miembro: apellidos", fullName: "Miembro: nombre completo" },
  actionMessages: { invalidAnnouncement: "El anuncio no es valido.", invalidRules: "Las reglas de audiencia no son validas.", invalidContent: "Los bloques de contenido no son validos.", invalidEntries: "Comprueba los datos introducidos.", invalidVariables: "Al menos una variable no es valida en este contexto.", unavailableReference: "Al menos una referencia de audiencia ya no esta disponible.", invalidConfiguration: "Comprueba la programacion, ubicacion y accion.", updated: "Anuncio actualizado.", created: "Anuncio creado.", saveFailed: "No se pudo guardar el anuncio.", previewInvalid: "Comprueba la audiencia y sus reglas.", previewFailed: "No se pudo calcular la vista previa." },
};

const fr: AnnouncementCopy = {
  page: { metadataTitle: "Annonces", eyebrow: "Experience membre", title: "Annonces", description: "Gerez les bannieres et fenetres programmees avec des regles d'audience precises." },
  manager: { search: "Rechercher des annonces", create: "Nouvelle annonce", empty: "Aucune annonce correspondante", confirmDelete: "Supprimer cette annonce ?", delete: "Supprimer", cancel: "Annuler", activate: "Activer", deactivate: "Desactiver", editAnnouncement: "Modifier l'annonce", edit: "Modifier", deleteAnnouncement: "Supprimer l'annonce" },
  status: { live: "En ligne", scheduled: "Programmee", ended: "Terminee", inactive: "Inactive" },
  placement: { banner: "Banniere", modal: "Fenetre", bannerDescription: "Banniere dans le contenu", modalDescription: "Fenetre a l'ouverture" },
  audience: { all: "Tous les membres", group: "Groupe specifique", user: "Membre individuel", groupShort: "Groupe", userShort: "Un membre" },
  metrics: { impressions: "Affichages", impressionsAria: (count) => `${count} affichages`, clicks: "Clics", clicksAria: (count) => `${count} clics`, dismissals: "Fermees", dismissalsAria: (count) => `${count} fermees`, clickRate: (rate) => `${rate} taux de clics`, rules: (count) => `${count} regles` },
  editor: { eyebrow: "Communication aux membres", editTitle: "Modifier l'annonce", createTitle: "Nouvelle annonce", close: "Fermer l'editeur", template: "Modele", templateAria: "Modele d'annonce", applyTemplate: "Appliquer le modele", title: "Titre", placement: "Emplacement", tone: "Ton", audience: "Audience", recipient: "Destinataire", allRecipients: "Tous", selectRecipient: "Selectionnez un destinataire", start: "Debut", endOptional: "Fin (facultative)", active: "Diffuser lorsque active", dismissible: "Peut etre fermee", cancel: "Annuler", saving: "Enregistrement", save: "Enregistrer l'annonce" },
  tone: { info: "Information", success: "Succes", warning: "Avis", critical: "Critique" },
  templates: {
    welcome: { label: "Bienvenue", title: "Bienvenue dans votre Academy", body: "Nous sommes ravis de vous accueillir. Explorez vos contenus disponibles et commencez votre premier cours.", placement: "modal", tone: "success", href: "/academy/courses", actionLabel: "Explorer les cours" },
    event: { label: "Avis d'evenement", title: "Prochaine session en direct", body: "Une nouvelle session en direct approche. Reservez votre place et ajoutez-la directement a votre calendrier.", placement: "banner", tone: "info", href: "/academy/events", actionLabel: "Voir la session" },
    maintenance: { label: "Maintenance", title: "Maintenance programmee", body: "L'Academy sera brievement indisponible pendant la periode annoncee. Votre progression enregistree restera intacte.", placement: "banner", tone: "warning", href: "", actionLabel: "" },
    learning: { label: "Impulsion d'apprentissage", title: "Poursuivez votre parcours", body: "Votre prochaine etape vous attend. Ouvrez vos cours et reprenez la ou vous vous etiez arrete.", placement: "modal", tone: "info", href: "/academy/courses", actionLabel: "Continuer a apprendre" },
  },
  targetRules: {
    title: "Regles d'audience", conjunction: "ET", conditions: (count) => `${count} conditions`, add: "Regle", empty: "Aucune regle supplementaire", previewTitle: "Apercu de l'audience", matchingMembers: (count) => `${count} membres correspondants`, noMatches: "Aucun resultat", calculating: "Calcul en cours", calculate: "Calculer l'apercu",
    ruleType: (index) => `Type de regle ${index}`, role: (index) => `Role ${index}`, group: (index) => `Groupe ${index}`, groupMatch: (index) => `Correspondance de groupe ${index}`, bundle: (index) => `Pack ${index}`, bundleMatch: (index) => `Correspondance de pack ${index}`, course: (index) => `Cours ${index}`, courseAccess: (index) => `Acces au cours ${index}`, progressCourse: (index) => `Cours de progression ${index}`, progressComparison: (index) => `Comparaison de progression ${index}`, progressValue: (index) => `Valeur de progression ${index}`, progressMaximum: (index) => `Maximum de progression ${index}`, remove: (index) => `Retirer la regle ${index}`, removeTitle: "Retirer la regle",
    types: { role: "Role", group: "Groupe", bundle: "Pack", courseAccess: "Acces au cours", courseProgress: "Progression du cours" }, roles: { member: "Membre", trainer: "Formateur", admin: "Administrateur", owner: "Proprietaire" }, groupMatches: { member: "est membre", notMember: "n'est pas membre" }, bundleMatches: { member: "possede le pack", notMember: "ne possede pas le pack" }, access: { granted: "Dispose d'un acces", notGranted: "Aucun acces" }, comparison: { atLeast: "au moins", atMost: "au plus", between: "entre" },
  },
  blocks: {
    title: "Blocs de contenu", count: (count, maximum) => `${count} sur ${maximum} blocs`, addText: "Texte", addCallout: "Avis", addDivider: "Ligne", addButton: "Bouton", labels: { richText: "Texte enrichi", callout: "Avis", divider: "Separateur", cta: "Bouton" }, moveUp: (index) => `Monter le bloc ${index}`, moveDown: (index) => `Descendre le bloc ${index}`, remove: (index) => `Retirer le bloc ${index}`, moveUpTitle: "Monter", moveDownTitle: "Descendre", removeTitle: "Retirer", richTextAria: (index) => `Bloc de texte enrichi ${index}`, richTextPlaceholder: "Saisissez le message", tone: "Ton", heading: "Titre", text: "Texte", dividerStyle: "Style de ligne", dividerStyles: { solid: "Continue", dashed: "Tirets", dotted: "Pointillee" }, label: "Libelle", target: "Destination", appearance: "Apparence", appearances: { primary: "Principale", secondary: "Secondaire" }, empty: "Aucun bloc de contenu", variables: "Variables securisees", variablesRegion: "Liste defilable des variables securisees", previewAria: "Apercu du contenu", preview: "Apercu", defaults: { richText: "Nouveau contenu", calloutTitle: "Avis", calloutBody: "Information importante", ctaLabel: "En savoir plus" },
  },
  layer: { announcements: "Annonces", closeAnnouncement: "Fermer l'annonce", close: "Fermer", modalEyebrow: "Nouveau dans votre Academy" },
  variables: { firstName: "Membre : prenom", lastName: "Membre : nom", fullName: "Membre : nom complet" },
  actionMessages: { invalidAnnouncement: "L'annonce n'est pas valide.", invalidRules: "Les regles d'audience ne sont pas valides.", invalidContent: "Les blocs de contenu ne sont pas valides.", invalidEntries: "Verifiez les informations saisies.", invalidVariables: "Au moins une variable n'est pas valide dans ce contexte.", unavailableReference: "Au moins une reference d'audience n'est plus disponible.", invalidConfiguration: "Verifiez la programmation, l'emplacement et l'action.", updated: "Annonce mise a jour.", created: "Annonce creee.", saveFailed: "L'annonce n'a pas pu etre enregistree.", previewInvalid: "Verifiez l'audience et ses regles.", previewFailed: "L'apercu n'a pas pu etre calcule." },
};

const catalogs = { de, en, it, es, fr } satisfies Record<
  AppLocale,
  AnnouncementCopy
>;

export function getAnnouncementCopy(locale: AppLocale): AnnouncementCopy {
  return catalogs[locale];
}
