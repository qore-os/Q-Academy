import type { AppLocale } from "@/lib/i18n/model";

export type CourseSupportCopy = {
  common: {
    backToCourse: string;
    cancel: string;
    save: string;
    delete: string;
    edit: string;
    closeDialog: string;
    moveUp: string;
    moveDown: string;
    active: string;
    invited: string;
    disabled: string;
    teamMember: string;
    required: string;
    live: string;
    draft: string;
    uncategorized: string;
    notAssigned: string;
    permission: Record<"none" | "view" | "edit" | "manage", string>;
    courseStatus: Record<"draft" | "published" | "archived", string>;
  };
  page: { metadataTitle: string };
  explorer: {
    search: string;
    filterCategory: string;
    allCategories: string;
    view: string;
    gridView: string;
    listView: string;
    newCourse: string;
    resultCount: (visible: string, total: string) => string;
    featured: string;
    courseAction: (title: string, action: string) => string;
    modules: (count: string) => string;
    learners: (count: string) => string;
    averageProgress: string;
    columns: {
      course: string;
      category: string;
      status: string;
      permission: string;
      members: string;
      progress: string;
      action: string;
    };
    viewCourse: string;
    editCourse: string;
    emptyTitle: string;
    emptyDescription: string;
  };
  creation: {
    eyebrow: string;
    title: string;
    close: string;
    mode: string;
    manual: string;
    aiAssistant: string;
    courseTitle: string;
    courseTitlePlaceholder: string;
    description: string;
    descriptionPlaceholder: string;
    category: string;
    noCategory: string;
    creating: string;
    createCourse: string;
    topic: string;
    topicPlaceholder: string;
    audience: string;
    audiencePlaceholder: string;
    learningGoal: string;
    learningGoalPlaceholder: string;
    level: string;
    levels: Record<"beginner" | "intermediate" | "advanced" | "mixed", string>;
    tone: string;
    tones: Record<"practical" | "professional" | "motivating" | "concise", string>;
    scope: string;
    scopes: Record<"compact" | "standard" | "intensive", string>;
    generating: string;
    generate: string;
  };
  team: {
    eyebrow: string;
    description: string;
    assigned: (count: string) => string;
    columns: { trainer: string; status: string; permission: string; action: string };
    permissionFor: (name: string) => string;
    save: string;
    emptyTitle: string;
    emptyDescription: string;
    manageMembers: string;
  };
  accessPage: {
    eyebrow: string;
    summary: (modules: string, members: string) => string;
    unpublishedNotice: string;
  };
  access: {
    title: string;
    openCount: (count: string) => string;
    openRequests: string;
    noMessage: string;
    noRequests: string;
    approvalNote: string;
    rejectionNote: string;
    accessUntil: string;
    approve: string;
    reject: string;
    setOverride: string;
    noLearners: string;
    learner: string;
    state: string;
    states: Record<"available" | "read_only" | "locked" | "hidden", string>;
    expiresAt: string;
    reason: string;
    saveOverride: string;
    activeOverrides: string;
    until: (date: string) => string;
    noExpiry: string;
    remove: string;
    noOverrides: string;
  };
  preview: {
    backToList: string;
    backToEditor: string;
    eyebrow: string;
    lessonCount: (count: string) => string;
    content: string;
    noProgress: string;
    structure: string;
    lessonPages: string;
    mainContent: string;
    emptyArea: string;
    noLessonsTitle: string;
    noLessonsDescription: string;
    fallbacks: {
      eyebrow: string;
      heading: string;
      text: string;
      form: string;
      formUnavailable: string;
      info: string;
      checklist: string;
      submission: string;
      contentElement: (type: string) => string;
    };
  };
  information: {
    goals: string;
    addGoal: string;
    goal: (number: string) => string;
    deleteGoal: (number: string) => string;
    authors: string;
    authorSelect: string;
    addAuthor: string;
    removeAuthor: (name: string) => string;
  };
  gallery: {
    display: string;
    grid: string;
    featured: string;
    image: (number: string) => string;
    remove: (label: string) => string;
    altText: string;
    caption: string;
    addImage: string;
  };
  widgets: {
    title: string;
    createAria: string;
    createTitle: string;
    types: Record<"author" | "info" | "image_link", string>;
    teamMember: string;
    noActiveMember: string;
    role: string;
    roleHint: string;
    rolePlaceholder: string;
    description: string;
    descriptionHint: string;
    titleField: string;
    text: string;
    optionalLink: string;
    internalLinkHint: string;
    imageSource: string;
    imageSourceHint: string;
    altText: string;
    link: string;
    authorFallback: string;
    cancel: string;
    create: string;
    saveChanges: string;
    saveFailed: string;
    moveUp: (type: string) => string;
    moveDown: (type: string) => string;
    editWidget: (type: string) => string;
    deleteWidget: (type: string) => string;
    confirmDelete: string;
    empty: string;
  };
  media: {
    selectFile: string;
    microphoneRecording: string;
    cameraRecording: string;
    recordingRejected: string;
    genericMedium: string;
    preparing: string;
    uploading: (progress: string) => string;
    processing: string;
    ready: string;
    retry: string;
    remove: (name: string) => string;
    source: (label: string) => string;
    upload: string;
    uploadLabel: (label: string) => string;
    library: string;
    useLibrary: string;
    searchLibrary: string;
    emptyLibrary: string;
    selectLibraryAsset: (name: string) => string;
    stock: string;
    useStock: string;
    url: string;
    externalUrl: (label: string) => string;
    urlLabel: (label: string) => string;
    searchStock: string;
    search: string;
    errors: {
      remove: string;
      invalidFile: string;
      wrongKind: string;
      upload: string;
      library: string;
      stockSearch: string;
      stockUnavailable: string;
      stockSelect: string;
    };
  };
  categories: {
    title: string;
    manageTitle: string;
    count: (count: string) => string;
    courseCount: (count: string) => string;
    create: string;
    createTitle: string;
    editTitle: string;
    close: string;
    name: string;
    description: string;
    color: string;
    colorAria: string;
    cancel: string;
    save: string;
    saving: string;
    edit: string;
    delete: string;
    moveUp: string;
    moveDown: string;
    empty: string;
    noDescription: string;
    confirmTitle: string;
    confirmQuestion: (name: string) => string;
    confirmUnused: string;
    confirmUsed: (count: string) => string;
    confirmDelete: string;
  };
  changes: {
    kind: Record<"added" | "updated" | "removed" | "moved", string>;
    publishing: string;
    publishCourse: string;
    publishVersion: string;
    unavailableTitle: string;
    unavailableDescription: string;
    noChangesTitle: string;
    noChangesDescription: string;
    total: (count: string) => string;
    newCount: (count: string) => string;
    updatedCount: (count: string) => string;
    removedCount: (count: string) => string;
    movedCount: (count: string) => string;
    emailPreview: string;
    emailSummary: (recipients: string, eligible: string, modules: string) => string;
    noNewModules: string;
    emailsDisabled: string;
    versionNote: string;
    versionPlaceholder: string;
    publishVisibility: string;
    publishPermission: string;
    noVersionsTitle: string;
    noVersionsDescription: string;
    version: (version: string) => string;
    published: string;
    saved: string;
    noVersionNote: string;
    current: string;
    viewChanges: string;
    comparisonUnavailable: string;
    updateCourse: string;
    publishChanges: string;
    versionHistory: string;
    eyebrow: string;
    dialogTitle: string;
    views: string;
  };
  actions: {
    course: {
      invalidTitle: string;
      invalidDescription: string;
      categoryUnavailable: string;
      createFailed: string;
      publishedFromAdmin: string;
      changesPublishedFromAdmin: string;
    };
    ai: {
      invalidBrief: string;
      categoryUnavailable: string;
      unavailable: string;
      inProgress: string;
      quota: (minutes: string) => string;
      authorizationChanged: string;
      saveFailed: string;
      notificationTitle: string;
      notificationBody: (title: string) => string;
      trueLabel: string;
      falseLabel: string;
    };
    category: {
      invalid: string;
      createSuccess: string;
      updateSuccess: string;
      deleteSuccess: string;
      usageLoaded: string;
      reorderSuccess: string;
      reorderInvalid: string;
      failed: string;
    };
    widget: {
      invalidCourse: string;
      invalidWidget: string;
      invalidOrder: string;
      createSuccess: string;
      updateSuccess: string;
      deleteSuccess: string;
      reorderSuccess: string;
      failed: string;
    };
    access: {
      learnerOnlyRequest: string;
      learnerOnlyWithdraw: string;
      invalidInput: string;
      invalidRequest: string;
      requestSent: string;
      requestFailed: string;
      requestWithdrawn: string;
      withdrawFailed: string;
      invalidDecision: string;
      staleRejected: string;
      approved: string;
      rejected: string;
      decisionFailed: string;
      invalidOverride: string;
      overrideSaved: string;
      overrideSaveFailed: string;
      overrideRemoved: string;
      overrideRemoveFailed: string;
    };
  };
  diff: {
    groups: Record<"course" | "goals" | "authors" | "widgets" | "modules" | "access" | "sections" | "lessons" | "pages" | "blocks", string>;
    blockTypes: Record<string, string>;
    fields: Record<string, string>;
    draftCreated: string;
    noPublishedVersion: string;
    changed: (label: string) => string;
    courseInformation: string;
    fallback: Record<"goal" | "author" | "authorWidget" | "widget" | "module" | "section" | "lesson" | "page" | "block", string>;
    details: Record<"goalRemoved" | "goalAdded" | "textChanged" | "orderChanged" | "authorRemoved" | "authorAdded" | "authorProfileChanged" | "widgetRemoved" | "widgetAdded" | "widgetContentChanged" | "moduleRemoved" | "moduleAdded" | "moduleContentChanged" | "moduleTypeChanged" | "linkedCourseChanged" | "orderAndIndentChanged" | "indentChanged" | "moduleAccessChanged" | "sectionSettingsChanged" | "lessonSettingsChanged" | "pageSettingsChanged", string>;
    from: (name: string) => string;
    in: (name: string) => string;
    on: (name: string) => string;
    blockRemoved: (location: string) => string;
    blockAdded: (location: string) => string;
    blockContentChanged: (location: string) => string;
  };
};

const de: CourseSupportCopy = {
  common: {
    backToCourse: "Zurück zum Kurs", cancel: "Abbrechen", save: "Speichern", delete: "Löschen", edit: "Bearbeiten", closeDialog: "Dialog schließen", moveUp: "Nach oben", moveDown: "Nach unten", active: "Aktiv", invited: "Eingeladen", disabled: "Deaktiviert", teamMember: "Teammitglied", required: "Pflicht", live: "Live", draft: "Entwurf", uncategorized: "Ohne Kategorie", notAssigned: "Nicht zugewiesen",
    permission: { none: "Kein Kurszugriff", view: "Ansehen", edit: "Bearbeiten", manage: "Veröffentlichen" },
    courseStatus: { draft: "Entwurf", published: "Veröffentlicht", archived: "Archiviert" },
  },
  page: { metadataTitle: "Kurse" },
  explorer: {
    search: "Kurse durchsuchen", filterCategory: "Kategorie filtern", allCategories: "Alle Kategorien", view: "Ansicht", gridView: "Rasteransicht", listView: "Listenansicht", newCourse: "Neuer Kurs", resultCount: (visible, total) => `${visible} von ${total} Kursen`, featured: "Empfohlen", courseAction: (title, action) => `${title} ${action}`, modules: (count) => `${count} Module`, learners: (count) => `${count} Mitglieder`, averageProgress: "Durchschnittlicher Fortschritt",
    columns: { course: "Kurs", category: "Kategorie", status: "Status", permission: "Kursrecht", members: "Mitglieder", progress: "Fortschritt", action: "Aktion" },
    viewCourse: "Ansehen", editCourse: "Bearbeiten", emptyTitle: "Keine passenden Kurse", emptyDescription: "Passe Suche oder Kategorie an.",
  },
  creation: {
    eyebrow: "Kursverwaltung", title: "Neuen Kurs anlegen", close: "Dialog schließen", mode: "Erstellungsmodus", manual: "Manuell", aiAssistant: "KI-Assistent", courseTitle: "Kurstitel", courseTitlePlaceholder: "z. B. KI für den Vertrieb", description: "Kurzbeschreibung", descriptionPlaceholder: "Was lernen Mitglieder in diesem Kurs?", category: "Kategorie", noCategory: "Ohne Kategorie", creating: "Wird angelegt", createCourse: "Kurs anlegen", topic: "Thema", topicPlaceholder: "z. B. Sicherer KI-Einsatz im Kundenservice", audience: "Zielgruppe", audiencePlaceholder: "z. B. Teamleitungen ohne KI-Erfahrung", learningGoal: "Lernziel", learningGoalPlaceholder: "Welches konkrete Ergebnis sollen Lernende erreichen?", level: "Niveau", levels: { beginner: "Grundlagen", intermediate: "Fortgeschritten", advanced: "Experte", mixed: "Gemischt" }, tone: "Tonalität", tones: { practical: "Praxisnah", professional: "Professionell", motivating: "Motivierend", concise: "Kompakt" }, scope: "Umfang", scopes: { compact: "Kompakt - 2 Module", standard: "Standard - 3 Module", intensive: "Intensiv - 4 Module" }, generating: "Entwurf wird erstellt", generate: "Entwurf erstellen",
  },
  team: {
    eyebrow: "Kursbezogene Teamrechte", description: "Owner und Admins besitzen immer volle Rechte. Hier werden nur explizite Trainerrechte verwaltet.", assigned: (count) => `${count} zugewiesen`, columns: { trainer: "Trainer", status: "Status", permission: "Kursrecht", action: "Aktion" }, permissionFor: (name) => `Kursrecht für ${name}`, save: "Speichern", emptyTitle: "Noch keine Trainer vorhanden", emptyDescription: "Lege zuerst ein Trainerkonto in der Mitgliederverwaltung an.", manageMembers: "Mitglieder verwalten",
  },
  accessPage: { eyebrow: "Modulzugriffe", summary: (modules, members) => `${modules} Module | ${members} aktive Einschreibungen`, unpublishedNotice: "Overrides können erst gegen eine veröffentlichte Kursversion gesetzt werden." },
  access: {
    title: "Individueller Modulzugriff", openCount: (count) => `${count} offen`, openRequests: "Offene Anfragen", noMessage: "Keine Nachricht.", noRequests: "Keine offenen Zugriffsanfragen.", approvalNote: "Begründung (optional)", rejectionNote: "Ablehnungsgrund", accessUntil: "Zugriff bis", approve: "Freigeben", reject: "Ablehnen", setOverride: "Override setzen", noLearners: "Keine aktiven Lernenden.", learner: "Lernende Person", state: "Zugriff", states: { available: "Verfügbar", read_only: "Nur Lesen", locked: "Gesperrt", hidden: "Ausgeblendet" }, expiresAt: "Ablaufdatum", reason: "Begründung", saveOverride: "Override speichern", activeOverrides: "Aktive Overrides", until: (date) => `bis ${date}`, noExpiry: "ohne Ablaufdatum", remove: "Entfernen", noOverrides: "Keine individuellen Overrides.",
  },
  preview: {
    backToList: "Zurück zur Kursliste", backToEditor: "Zurück zum Kurseditor", eyebrow: "Mitglieder-Vorschau", lessonCount: (count) => `${count} Lektionen`, content: "Kursinhalt", noProgress: "Ansicht ohne Lernfortschritt", structure: "Vorschau-Kursstruktur", lessonPages: "Lektionsseiten", mainContent: "Hauptinhalt", emptyArea: "Noch keine Inhalte in diesem Bereich", noLessonsTitle: "Dieser Kurs hat noch keine Lektionen", noLessonsDescription: "Lege im Editor das erste Modul und eine Lektion an.",
    fallbacks: { eyebrow: "Kicker", heading: "Überschrift", text: "Text", form: "Formular", formUnavailable: "Formular nicht verfügbar", info: "Hinweis", checklist: "Checkliste", submission: "Abgabe", contentElement: (type) => `Inhaltselement: ${type}` },
  },
  information: { goals: "Lernziele", addGoal: "Lernziel hinzufügen", goal: (number) => `Lernziel ${number}`, deleteGoal: (number) => `Lernziel ${number} löschen`, authors: "Kursautoren", authorSelect: "Teammitglied als Kursautor", addAuthor: "Kursautor hinzufügen", removeAuthor: (name) => `${name} als Kursautor entfernen` },
  gallery: { display: "Darstellung", grid: "Raster", featured: "Hervorgehoben", image: (number) => `Galeriebild ${number}`, remove: (label) => `${label} entfernen`, altText: "Alternativtext", caption: "Bildunterschrift", addImage: "Bild hinzufügen" },
  widgets: {
    title: "Kurs-Widgets", createAria: "Widget anlegen", createTitle: "Widget anlegen", types: { author: "Autor-Karte", info: "Info-Karte", image_link: "Bild-Karte" }, teamMember: "Teammitglied", noActiveMember: "Kein aktives Teammitglied", role: "Rolle", roleHint: "Leer lassen, um den Jobtitel zu verwenden.", rolePlaceholder: "Kursleitung", description: "Beschreibung", descriptionHint: "Leer lassen, um die Profilbeschreibung zu verwenden.", titleField: "Titel", text: "Text", optionalLink: "Link (optional)", internalLinkHint: "Interner Pfad oder HTTP(S)-URL.", imageSource: "Bildquelle", imageSourceHint: "Geprüftes Bild hochladen oder sicheren /images-Pfad bzw. HTTPS-URL verwenden.", altText: "Alternativtext", link: "Link", authorFallback: "Kursautor:in", cancel: "Abbrechen", create: "Widget anlegen", saveChanges: "Änderungen speichern", saveFailed: "Das Kurs-Widget konnte nicht gespeichert werden.", moveUp: (type) => `${type} nach oben`, moveDown: (type) => `${type} nach unten`, editWidget: (type) => `${type} bearbeiten`, deleteWidget: (type) => `${type} löschen`, confirmDelete: "Dieses Widget wirklich löschen?", empty: "Noch keine Kurs-Widgets",
  },
  media: {
    selectFile: "Datei auswählen", microphoneRecording: "Mikrofonaufnahme", cameraRecording: "Kamera oder Bildschirm aufnehmen", recordingRejected: "Die Aufnahme konnte nicht übernommen werden.", genericMedium: "Kursmedium", preparing: "Wird vorbereitet", uploading: (progress) => `Upload ${progress} %`, processing: "Sicherheitsprüfung", ready: "Geprüft und bereit", remove: (name) => `${name} entfernen`, source: (label) => `${label}-Quelle`, upload: "Upload", uploadLabel: (label) => `${label} hochladen`, library: "Mediathek", useLibrary: "Geprüftes Medium wiederverwenden", searchLibrary: "Mediathek durchsuchen", emptyLibrary: "Keine passenden geprüften Medien.", selectLibraryAsset: (name) => `${name} auswählen`, stock: "Stock", useStock: "Stockbild verwenden", url: "URL", externalUrl: (label) => `Externe ${label}-URL verwenden`, urlLabel: (label) => `${label}-URL`, searchStock: "Stockbilder suchen", search: "Suchen",
    retry: "Upload erneut versuchen",
    errors: { remove: "Das Medium konnte nicht entfernt werden.", invalidFile: "Dateityp oder Dateigröße ist ungültig.", wrongKind: "Die Datei passt nicht zum ausgewählten Blocktyp.", upload: "Upload fehlgeschlagen.", library: "Die Mediathek konnte nicht geladen werden.", stockSearch: "Stockbilder konnten nicht geladen werden.", stockUnavailable: "Stockbildsuche ist auf diesem System nicht konfiguriert.", stockSelect: "Stockbild konnte nicht ausgewählt werden." },
  },
  categories: {
    title: "Kategorien", manageTitle: "Kategorien verwalten", count: (count) => `${count} Kategorien`, courseCount: (count) => `${count} Kurse`, create: "Kategorie anlegen", createTitle: "Kategorie anlegen", editTitle: "Kategorie bearbeiten", close: "Dialog schließen", name: "Name", description: "Beschreibung", color: "Farbe", colorAria: "Kategoriefarbe", cancel: "Abbrechen", save: "Speichern", saving: "Wird gespeichert", edit: "Bearbeiten", delete: "Löschen", moveUp: "Nach oben", moveDown: "Nach unten", empty: "Noch keine Kategorien", noDescription: "Keine Beschreibung", confirmTitle: "Kategorie löschen", confirmQuestion: (name) => `${name} wirklich löschen?`, confirmUnused: "Diese Kategorie ist keinem Kurs zugeordnet.", confirmUsed: (count) => `${count} Kurse verwenden diese Kategorie. Sie werden ohne Kategorie weitergeführt.`, confirmDelete: "Endgültig löschen",
  },
  changes: {
    kind: { added: "Hinzugefügt", updated: "Geändert", removed: "Entfernt", moved: "Verschoben" }, publishing: "Wird veröffentlicht", publishCourse: "Kurs veröffentlichen", publishVersion: "Version veröffentlichen", unavailableTitle: "Vergleich derzeit nicht verfügbar", unavailableDescription: "Die aktuelle veröffentlichte Version konnte nicht sicher gelesen werden. Es wurde keine neue Version erzeugt.", noChangesTitle: "Keine offenen Änderungen", noChangesDescription: "Entwurf und aktuelle Version sind identisch.", total: (count) => `${count} Änderungen`, newCount: (count) => `${count} neu`, updatedCount: (count) => `${count} bearbeitet`, removedCount: (count) => `${count} entfernt`, movedCount: (count) => `${count} verschoben`, emailPreview: "Vorschau der Modulfreigabe-E-Mails", emailSummary: (recipients, eligible, modules) => `${recipients} von ${eligible} berechtigten Mitgliedern erhalten eine E-Mail zu ${modules} neu zugänglichen Modulen.`, noNewModules: "Diese Veröffentlichung gibt für berechtigte Mitglieder keine neuen Module frei.", emailsDisabled: "Automatische Release-E-Mails sind in den Kursinformationen deaktiviert.", versionNote: "Versionshinweis", versionPlaceholder: "Was wurde in dieser Version verbessert?", publishVisibility: "Erst die Veröffentlichung macht diese Änderungen für Mitglieder sichtbar.", publishPermission: "Nur mit Veröffentlichungsrecht", noVersionsTitle: "Noch keine Versionen", noVersionsDescription: "Die erste Veröffentlichung startet die Versionshistorie.", version: (version) => `Version ${version}`, published: "Veröffentlicht", saved: "Gespeichert", noVersionNote: "Kein Versionshinweis hinterlegt.", current: "Aktuell", viewChanges: "Änderungen ansehen", comparisonUnavailable: "Vergleich nicht verfügbar", updateCourse: "Kurs aktualisieren", publishChanges: "Änderungen veröffentlichen", versionHistory: "Versionshistorie", eyebrow: "Kurs-Changelog", dialogTitle: "Versionen und Änderungen", views: "Changelog-Ansichten",
  },
  actions: {
    course: { invalidTitle: "Der Kurstitel ist zu kurz.", invalidDescription: "Bitte eine kurze Beschreibung ergänzen.", categoryUnavailable: "Die gewählte Kategorie ist nicht verfügbar.", createFailed: "Der Kurs konnte nicht angelegt werden. Bitte erneut versuchen.", publishedFromAdmin: "Über die Admin-Oberfläche veröffentlicht.", changesPublishedFromAdmin: "Änderungen über die Admin-Oberfläche veröffentlicht." },
    ai: { invalidBrief: "Bitte die Angaben für den Kursentwurf prüfen.", categoryUnavailable: "Die gewählte Kategorie ist nicht verfügbar.", unavailable: "Die KI-Kurserstellung ist gerade nicht verfügbar. Bitte erneut versuchen.", inProgress: "Eine KI-Kurserstellung läuft bereits. Bitte warte, bis sie abgeschlossen ist.", quota: (minutes) => `Das KI-Kontingent ist erreicht. Bitte in ${minutes} Minuten erneut versuchen.`, authorizationChanged: "Deine Berechtigung zur Kurserstellung wurde geändert. Es wurde kein Entwurf gespeichert.", saveFailed: "Der Kursentwurf konnte nicht gespeichert werden. Bitte erneut versuchen.", notificationTitle: "KI-Kursentwurf erstellt", notificationBody: (title) => `Der Entwurf \"${title}\" ist bereit zur Prüfung.`, trueLabel: "Wahr", falseLabel: "Falsch" },
    category: { invalid: "Kategorie ist ungültig.", createSuccess: "Kategorie wurde angelegt.", updateSuccess: "Kategorie wurde gespeichert.", deleteSuccess: "Kategorie wurde gelöscht.", usageLoaded: "Aktuelle Kursbelegung geladen.", reorderSuccess: "Reihenfolge wurde gespeichert.", reorderInvalid: "Die Kategorienreihenfolge ist ungültig.", failed: "Die Kategorieaktion konnte nicht abgeschlossen werden." },
    widget: { invalidCourse: "Kurs ist ungültig.", invalidWidget: "Kurs-Widget ist ungültig.", invalidOrder: "Widget-Reihenfolge ist ungültig.", createSuccess: "Kurs-Widget angelegt.", updateSuccess: "Kurs-Widget gespeichert.", deleteSuccess: "Kurs-Widget gelöscht.", reorderSuccess: "Widget-Reihenfolge gespeichert.", failed: "Das Kurs-Widget konnte nicht gespeichert werden." },
    access: { learnerOnlyRequest: "Nur Lernende können einen Modulzugriff anfragen.", learnerOnlyWithdraw: "Nur Lernende können eine Anfrage zurückziehen.", invalidInput: "Eingaben prüfen.", invalidRequest: "Die Anfrage ist ungültig.", requestSent: "Zugriffsanfrage gesendet.", requestFailed: "Die Zugriffsanfrage konnte nicht gesendet werden.", requestWithdrawn: "Zugriffsanfrage zurückgezogen.", withdrawFailed: "Die Anfrage konnte nicht zurückgezogen werden.", invalidDecision: "Bitte prüfe Entscheidung und Ablaufdatum.", staleRejected: "Die veraltete Anfrage wurde sicher abgelehnt.", approved: "Modulzugriff freigegeben.", rejected: "Zugriffsanfrage abgelehnt.", decisionFailed: "Die Anfrage konnte nicht entschieden werden.", invalidOverride: "Bitte prüfe Status, Begründung und Ablaufdatum.", overrideSaved: "Individuellen Modulzugriff gespeichert.", overrideSaveFailed: "Der Modulzugriff konnte nicht gespeichert werden.", overrideRemoved: "Individuellen Modulzugriff entfernt.", overrideRemoveFailed: "Der Modulzugriff konnte nicht entfernt werden." },
  },
  diff: {
    groups: { course: "Kursinformation", goals: "Lernziele", authors: "Autoren", widgets: "Widgets", modules: "Module", access: "Zugriff", sections: "Sektionen", lessons: "Lektionen", pages: "Seiten", blocks: "Inhaltsblöcke" },
    blockTypes: { heading: "Überschrift", text: "Text", rich_text: "Rich-Text", button: "Button", gallery: "Galerie", callout: "Hinweisbox", quote: "Zitat", divider: "Trennlinie", accordion: "Akkordeon", tabs: "Tabs", columns: "Spalten", download: "Download", code: "Code", table: "Tabelle", data_form: "Formular", info: "Hinweis", checklist: "Checkliste", image: "Bild", video: "Video", audio: "Audio", file: "Datei", embed: "Embed", multiple_choice: "Multiple Choice", true_false: "Wahr/Falsch", multi_select: "Mehrfachauswahl", fill_blank: "Lückentext", ordering: "Sortierung", submission: "Abgabe" },
    fields: { categoryId: "Kategorie", title: "Kurstitel", slug: "Kursadresse", shortDescription: "Kurzbeschreibung", description: "Beschreibung", coverImage: "Titelbild", difficulty: "Schwierigkeitsgrad", estimatedMinutes: "Geschätzte Dauer", certificateEnabled: "Zertifikat", featured: "Hervorhebung", visibleInCatalog: "Katalogsichtbarkeit", showProgressPercentage: "Fortschrittsanzeige", notifyMembersOnModuleRelease: "E-Mail bei Modulfreigabe" },
    draftCreated: "Kursentwurf erstellt", noPublishedVersion: "Noch keine Version veröffentlicht", changed: (label) => `${label} geändert`, courseInformation: "Kursinformation", fallback: { goal: "Lernziel", author: "Autor", authorWidget: "Autoren-Widget", widget: "Widget", module: "Modul", section: "Sektion", lesson: "Lektion", page: "Seite", block: "Inhaltsblock" },
    details: { goalRemoved: "Lernziel entfernt", goalAdded: "Lernziel hinzugefügt", textChanged: "Text geändert", orderChanged: "Reihenfolge geändert", authorRemoved: "Autor entfernt", authorAdded: "Autor hinzugefügt", authorProfileChanged: "Autorenprofil geändert", widgetRemoved: "Widget entfernt", widgetAdded: "Widget hinzugefügt", widgetContentChanged: "Widget-Inhalt geändert", moduleRemoved: "Modul entfernt", moduleAdded: "Modul hinzugefügt", moduleContentChanged: "Modulinhalt geändert", moduleTypeChanged: "Modultyp geändert", linkedCourseChanged: "Verlinkter Zielkurs geändert", orderAndIndentChanged: "Reihenfolge und Einrückung geändert", indentChanged: "Einrückung geändert", moduleAccessChanged: "Modulzugriff geändert", sectionSettingsChanged: "Sektionseinstellungen geändert", lessonSettingsChanged: "Lektionseinstellungen geändert", pageSettingsChanged: "Seiteneinstellungen geändert" },
    from: (name) => `Aus ${name}`, in: (name) => `In ${name}`, on: (name) => `Auf ${name}`, blockRemoved: (location) => `${location} entfernt`, blockAdded: (location) => `${location} hinzugefügt`, blockContentChanged: (location) => `Inhalt geändert - ${location}`,
  },
};

const en: CourseSupportCopy = {
  common: {
    backToCourse: "Back to course", cancel: "Cancel", save: "Save", delete: "Delete", edit: "Edit", closeDialog: "Close dialog", moveUp: "Move up", moveDown: "Move down", active: "Active", invited: "Invited", disabled: "Disabled", teamMember: "Team member", required: "Required", live: "Live", draft: "Draft", uncategorized: "Uncategorized", notAssigned: "Not assigned",
    permission: { none: "No course access", view: "View", edit: "Edit", manage: "Publish" },
    courseStatus: { draft: "Draft", published: "Published", archived: "Archived" },
  },
  page: { metadataTitle: "Courses" },
  explorer: {
    search: "Search courses", filterCategory: "Filter by category", allCategories: "All categories", view: "View", gridView: "Grid view", listView: "List view", newCourse: "New course", resultCount: (visible, total) => `${visible} of ${total} courses`, featured: "Featured", courseAction: (title, action) => `${action} ${title}`, modules: (count) => `${count} modules`, learners: (count) => `${count} members`, averageProgress: "Average progress",
    columns: { course: "Course", category: "Category", status: "Status", permission: "Course permission", members: "Members", progress: "Progress", action: "Action" },
    viewCourse: "View", editCourse: "Edit", emptyTitle: "No matching courses", emptyDescription: "Adjust your search or category filter.",
  },
  creation: {
    eyebrow: "Course management", title: "Create a new course", close: "Close dialog", mode: "Creation mode", manual: "Manual", aiAssistant: "AI assistant", courseTitle: "Course title", courseTitlePlaceholder: "e.g. AI for sales", description: "Short description", descriptionPlaceholder: "What will members learn in this course?", category: "Category", noCategory: "No category", creating: "Creating", createCourse: "Create course", topic: "Topic", topicPlaceholder: "e.g. Safe AI use in customer service", audience: "Target audience", audiencePlaceholder: "e.g. Team leads with no AI experience", learningGoal: "Learning objective", learningGoalPlaceholder: "What specific outcome should learners achieve?", level: "Level", levels: { beginner: "Beginner", intermediate: "Intermediate", advanced: "Advanced", mixed: "Mixed" }, tone: "Tone", tones: { practical: "Practical", professional: "Professional", motivating: "Motivating", concise: "Concise" }, scope: "Scope", scopes: { compact: "Compact - 2 modules", standard: "Standard - 3 modules", intensive: "Intensive - 4 modules" }, generating: "Generating draft", generate: "Generate draft",
  },
  team: {
    eyebrow: "Course team permissions", description: "Owners and admins always have full access. Only explicit trainer permissions are managed here.", assigned: (count) => `${count} assigned`, columns: { trainer: "Trainer", status: "Status", permission: "Course permission", action: "Action" }, permissionFor: (name) => `Course permission for ${name}`, save: "Save", emptyTitle: "No trainers yet", emptyDescription: "Create a trainer account in member management first.", manageMembers: "Manage members",
  },
  accessPage: { eyebrow: "Module access", summary: (modules, members) => `${modules} modules | ${members} active enrolments`, unpublishedNotice: "Overrides can only be set against a published course version." },
  access: {
    title: "Individual module access", openCount: (count) => `${count} open`, openRequests: "Open requests", noMessage: "No message.", noRequests: "No open access requests.", approvalNote: "Reason (optional)", rejectionNote: "Reason for rejection", accessUntil: "Access until", approve: "Approve", reject: "Reject", setOverride: "Set override", noLearners: "No active learners.", learner: "Learner", state: "Access", states: { available: "Available", read_only: "Read only", locked: "Locked", hidden: "Hidden" }, expiresAt: "Expiry date", reason: "Reason", saveOverride: "Save override", activeOverrides: "Active overrides", until: (date) => `until ${date}`, noExpiry: "no expiry date", remove: "Remove", noOverrides: "No individual overrides.",
  },
  preview: {
    backToList: "Back to course list", backToEditor: "Back to course editor", eyebrow: "Member preview", lessonCount: (count) => `${count} lessons`, content: "Course content", noProgress: "View without learning progress", structure: "Preview course structure", lessonPages: "Lesson pages", mainContent: "Main content", emptyArea: "No content in this area yet", noLessonsTitle: "This course has no lessons yet", noLessonsDescription: "Create the first module and lesson in the editor.",
    fallbacks: { eyebrow: "Eyebrow", heading: "Heading", text: "Text", form: "Form", formUnavailable: "Form unavailable", info: "Note", checklist: "Checklist", submission: "Submission", contentElement: (type) => `Content element: ${type}` },
  },
  information: { goals: "Learning objectives", addGoal: "Add learning objective", goal: (number) => `Learning objective ${number}`, deleteGoal: (number) => `Delete learning objective ${number}`, authors: "Course authors", authorSelect: "Team member as course author", addAuthor: "Add course author", removeAuthor: (name) => `Remove ${name} as course author` },
  gallery: { display: "Display", grid: "Grid", featured: "Featured", image: (number) => `Gallery image ${number}`, remove: (label) => `Remove ${label}`, altText: "Alternative text", caption: "Caption", addImage: "Add image" },
  widgets: {
    title: "Course widgets", createAria: "Create widget", createTitle: "Create widget", types: { author: "Author card", info: "Information card", image_link: "Image card" }, teamMember: "Team member", noActiveMember: "No active team member", role: "Role", roleHint: "Leave blank to use the job title.", rolePlaceholder: "Course lead", description: "Description", descriptionHint: "Leave blank to use the profile description.", titleField: "Title", text: "Text", optionalLink: "Link (optional)", internalLinkHint: "Internal path or HTTP(S) URL.", imageSource: "Image source", imageSourceHint: "Upload a scanned image or use a safe /images path or HTTPS URL.", altText: "Alternative text", link: "Link", authorFallback: "Course author", cancel: "Cancel", create: "Create widget", saveChanges: "Save changes", saveFailed: "The course widget could not be saved.", moveUp: (type) => `Move ${type} up`, moveDown: (type) => `Move ${type} down`, editWidget: (type) => `Edit ${type}`, deleteWidget: (type) => `Delete ${type}`, confirmDelete: "Delete this widget?", empty: "No course widgets yet",
  },
  media: {
    selectFile: "Select file", microphoneRecording: "Microphone recording", cameraRecording: "Record camera or screen", recordingRejected: "The recording could not be accepted.", genericMedium: "Course media", preparing: "Preparing", uploading: (progress) => `Upload ${progress}%`, processing: "Security check", ready: "Checked and ready", remove: (name) => `Remove ${name}`, source: (label) => `${label} source`, upload: "Upload", uploadLabel: (label) => `Upload ${label}`, library: "Library", useLibrary: "Reuse checked media", searchLibrary: "Search media library", emptyLibrary: "No matching checked media.", selectLibraryAsset: (name) => `Select ${name}`, stock: "Stock", useStock: "Use stock image", url: "URL", externalUrl: (label) => `Use external ${label} URL`, urlLabel: (label) => `${label} URL`, searchStock: "Search stock images", search: "Search",
    retry: "Retry upload",
    errors: { remove: "The media could not be removed.", invalidFile: "The file type or size is invalid.", wrongKind: "The file does not match the selected block type.", upload: "Upload failed.", library: "The media library could not be loaded.", stockSearch: "Stock images could not be loaded.", stockUnavailable: "Stock image search is not configured on this system.", stockSelect: "The stock image could not be selected." },
  },
  categories: {
    title: "Categories", manageTitle: "Manage categories", count: (count) => `${count} categories`, courseCount: (count) => `${count} courses`, create: "Create category", createTitle: "Create category", editTitle: "Edit category", close: "Close dialog", name: "Name", description: "Description", color: "Colour", colorAria: "Category colour", cancel: "Cancel", save: "Save", saving: "Saving", edit: "Edit", delete: "Delete", moveUp: "Move up", moveDown: "Move down", empty: "No categories yet", noDescription: "No description", confirmTitle: "Delete category", confirmQuestion: (name) => `Delete ${name}?`, confirmUnused: "This category is not assigned to any course.", confirmUsed: (count) => `${count} courses use this category. They will continue without a category.`, confirmDelete: "Delete permanently",
  },
  changes: {
    kind: { added: "Added", updated: "Changed", removed: "Removed", moved: "Moved" }, publishing: "Publishing", publishCourse: "Publish course", publishVersion: "Publish version", unavailableTitle: "Comparison is currently unavailable", unavailableDescription: "The current published version could not be read reliably. No new version was created.", noChangesTitle: "No pending changes", noChangesDescription: "The draft and current version are identical.", total: (count) => `${count} changes`, newCount: (count) => `${count} new`, updatedCount: (count) => `${count} edited`, removedCount: (count) => `${count} removed`, movedCount: (count) => `${count} moved`, emailPreview: "Module release email preview", emailSummary: (recipients, eligible, modules) => `${recipients} of ${eligible} eligible members will receive an email about ${modules} newly available modules.`, noNewModules: "This publication does not release any new modules to eligible members.", emailsDisabled: "Automatic release emails are disabled in the course information.", versionNote: "Version note", versionPlaceholder: "What improved in this version?", publishVisibility: "Only publishing makes these changes visible to members.", publishPermission: "Publishing permission required", noVersionsTitle: "No versions yet", noVersionsDescription: "The first publication starts the version history.", version: (version) => `Version ${version}`, published: "Published", saved: "Saved", noVersionNote: "No version note provided.", current: "Current", viewChanges: "View changes", comparisonUnavailable: "Comparison unavailable", updateCourse: "Update course", publishChanges: "Publish changes", versionHistory: "Version history", eyebrow: "Course changelog", dialogTitle: "Versions and changes", views: "Changelog views",
  },
  actions: {
    course: { invalidTitle: "The course title is too short.", invalidDescription: "Add a short description.", categoryUnavailable: "The selected category is unavailable.", createFailed: "The course could not be created. Please try again.", publishedFromAdmin: "Published from the admin interface.", changesPublishedFromAdmin: "Changes published from the admin interface." },
    ai: { invalidBrief: "Check the details for the course draft.", categoryUnavailable: "The selected category is unavailable.", unavailable: "AI course creation is currently unavailable. Please try again.", inProgress: "An AI course is already being generated. Wait until it finishes.", quota: (minutes) => `The AI quota has been reached. Try again in ${minutes} minutes.`, authorizationChanged: "Your permission to create courses changed. No draft was saved.", saveFailed: "The course draft could not be saved. Please try again.", notificationTitle: "AI course draft created", notificationBody: (title) => `The draft \"${title}\" is ready for review.`, trueLabel: "True", falseLabel: "False" },
    category: { invalid: "The category is invalid.", createSuccess: "Category created.", updateSuccess: "Category saved.", deleteSuccess: "Category deleted.", usageLoaded: "Current course usage loaded.", reorderSuccess: "Order saved.", reorderInvalid: "The category order is invalid.", failed: "The category action could not be completed." },
    widget: { invalidCourse: "The course is invalid.", invalidWidget: "The course widget is invalid.", invalidOrder: "The widget order is invalid.", createSuccess: "Course widget created.", updateSuccess: "Course widget saved.", deleteSuccess: "Course widget deleted.", reorderSuccess: "Widget order saved.", failed: "The course widget could not be saved." },
    access: { learnerOnlyRequest: "Only learners can request module access.", learnerOnlyWithdraw: "Only learners can withdraw a request.", invalidInput: "Check your input.", invalidRequest: "The request is invalid.", requestSent: "Access request sent.", requestFailed: "The access request could not be sent.", requestWithdrawn: "Access request withdrawn.", withdrawFailed: "The request could not be withdrawn.", invalidDecision: "Check the decision and expiry date.", staleRejected: "The outdated request was rejected safely.", approved: "Module access approved.", rejected: "Access request rejected.", decisionFailed: "The request could not be decided.", invalidOverride: "Check the status, reason and expiry date.", overrideSaved: "Individual module access saved.", overrideSaveFailed: "The module access could not be saved.", overrideRemoved: "Individual module access removed.", overrideRemoveFailed: "The module access could not be removed." },
  },
  diff: {
    groups: { course: "Course information", goals: "Learning objectives", authors: "Authors", widgets: "Widgets", modules: "Modules", access: "Access", sections: "Sections", lessons: "Lessons", pages: "Pages", blocks: "Content blocks" },
    blockTypes: { heading: "Heading", text: "Text", rich_text: "Rich text", button: "Button", gallery: "Gallery", callout: "Callout", quote: "Quote", divider: "Divider", accordion: "Accordion", tabs: "Tabs", columns: "Columns", download: "Download", code: "Code", table: "Table", data_form: "Form", info: "Note", checklist: "Checklist", image: "Image", video: "Video", audio: "Audio", file: "File", embed: "Embed", multiple_choice: "Multiple choice", true_false: "True/false", multi_select: "Multiple selection", fill_blank: "Fill in the blank", ordering: "Ordering", submission: "Submission" },
    fields: { categoryId: "Category", title: "Course title", slug: "Course address", shortDescription: "Short description", description: "Description", coverImage: "Cover image", difficulty: "Difficulty", estimatedMinutes: "Estimated duration", certificateEnabled: "Certificate", featured: "Featured status", visibleInCatalog: "Catalogue visibility", showProgressPercentage: "Progress display", notifyMembersOnModuleRelease: "Module release email" },
    draftCreated: "Course draft created", noPublishedVersion: "No version published yet", changed: (label) => `${label} changed`, courseInformation: "Course information", fallback: { goal: "Learning objective", author: "Author", authorWidget: "Author widget", widget: "Widget", module: "Module", section: "Section", lesson: "Lesson", page: "Page", block: "Content block" },
    details: { goalRemoved: "Learning objective removed", goalAdded: "Learning objective added", textChanged: "Text changed", orderChanged: "Order changed", authorRemoved: "Author removed", authorAdded: "Author added", authorProfileChanged: "Author profile changed", widgetRemoved: "Widget removed", widgetAdded: "Widget added", widgetContentChanged: "Widget content changed", moduleRemoved: "Module removed", moduleAdded: "Module added", moduleContentChanged: "Module content changed", moduleTypeChanged: "Module type changed", linkedCourseChanged: "Linked target course changed", orderAndIndentChanged: "Order and indentation changed", indentChanged: "Indentation changed", moduleAccessChanged: "Module access changed", sectionSettingsChanged: "Section settings changed", lessonSettingsChanged: "Lesson settings changed", pageSettingsChanged: "Page settings changed" },
    from: (name) => `From ${name}`, in: (name) => `In ${name}`, on: (name) => `On ${name}`, blockRemoved: (location) => `Removed ${location}`, blockAdded: (location) => `Added ${location}`, blockContentChanged: (location) => `Content changed - ${location}`,
  },
};

const it: CourseSupportCopy = {
  common: {
    backToCourse: "Torna al corso", cancel: "Annulla", save: "Salva", delete: "Elimina", edit: "Modifica", closeDialog: "Chiudi finestra", moveUp: "Sposta su", moveDown: "Sposta giu", active: "Attivo", invited: "Invitato", disabled: "Disattivato", teamMember: "Membro del team", required: "Obbligatorio", live: "Online", draft: "Bozza", uncategorized: "Senza categoria", notAssigned: "Non assegnato",
    permission: { none: "Nessun accesso al corso", view: "Visualizza", edit: "Modifica", manage: "Pubblica" },
    courseStatus: { draft: "Bozza", published: "Pubblicato", archived: "Archiviato" },
  },
  page: { metadataTitle: "Corsi" },
  explorer: {
    search: "Cerca corsi", filterCategory: "Filtra per categoria", allCategories: "Tutte le categorie", view: "Visualizzazione", gridView: "Vista griglia", listView: "Vista elenco", newCourse: "Nuovo corso", resultCount: (visible, total) => `${visible} di ${total} corsi`, featured: "In evidenza", courseAction: (title, action) => `${action} ${title}`, modules: (count) => `${count} moduli`, learners: (count) => `${count} membri`, averageProgress: "Progresso medio",
    columns: { course: "Corso", category: "Categoria", status: "Stato", permission: "Permesso corso", members: "Membri", progress: "Progresso", action: "Azione" },
    viewCourse: "Visualizza", editCourse: "Modifica", emptyTitle: "Nessun corso corrispondente", emptyDescription: "Modifica la ricerca o il filtro categoria.",
  },
  creation: {
    eyebrow: "Gestione corsi", title: "Crea un nuovo corso", close: "Chiudi finestra", mode: "Modalita di creazione", manual: "Manuale", aiAssistant: "Assistente IA", courseTitle: "Titolo del corso", courseTitlePlaceholder: "es. IA per le vendite", description: "Descrizione breve", descriptionPlaceholder: "Cosa impareranno i membri in questo corso?", category: "Categoria", noCategory: "Senza categoria", creating: "Creazione", createCourse: "Crea corso", topic: "Argomento", topicPlaceholder: "es. Uso sicuro dell'IA nel servizio clienti", audience: "Destinatari", audiencePlaceholder: "es. Responsabili senza esperienza con l'IA", learningGoal: "Obiettivo didattico", learningGoalPlaceholder: "Quale risultato concreto devono raggiungere gli studenti?", level: "Livello", levels: { beginner: "Base", intermediate: "Intermedio", advanced: "Avanzato", mixed: "Misto" }, tone: "Tono", tones: { practical: "Pratico", professional: "Professionale", motivating: "Motivante", concise: "Sintetico" }, scope: "Ampiezza", scopes: { compact: "Compatto - 2 moduli", standard: "Standard - 3 moduli", intensive: "Intensivo - 4 moduli" }, generating: "Creazione bozza", generate: "Crea bozza",
  },
  team: {
    eyebrow: "Permessi del team del corso", description: "Proprietari e amministratori hanno sempre accesso completo. Qui vengono gestiti solo i permessi espliciti dei formatori.", assigned: (count) => `${count} assegnati`, columns: { trainer: "Formatore", status: "Stato", permission: "Permesso corso", action: "Azione" }, permissionFor: (name) => `Permesso corso per ${name}`, save: "Salva", emptyTitle: "Nessun formatore presente", emptyDescription: "Crea prima un account formatore nella gestione membri.", manageMembers: "Gestisci membri",
  },
  accessPage: { eyebrow: "Accesso ai moduli", summary: (modules, members) => `${modules} moduli | ${members} iscrizioni attive`, unpublishedNotice: "Le eccezioni possono essere impostate solo su una versione pubblicata del corso." },
  access: {
    title: "Accesso individuale al modulo", openCount: (count) => `${count} aperte`, openRequests: "Richieste aperte", noMessage: "Nessun messaggio.", noRequests: "Nessuna richiesta di accesso aperta.", approvalNote: "Motivazione (facoltativa)", rejectionNote: "Motivo del rifiuto", accessUntil: "Accesso fino al", approve: "Approva", reject: "Rifiuta", setOverride: "Imposta eccezione", noLearners: "Nessuno studente attivo.", learner: "Studente", state: "Accesso", states: { available: "Disponibile", read_only: "Sola lettura", locked: "Bloccato", hidden: "Nascosto" }, expiresAt: "Data di scadenza", reason: "Motivazione", saveOverride: "Salva eccezione", activeOverrides: "Eccezioni attive", until: (date) => `fino al ${date}`, noExpiry: "senza scadenza", remove: "Rimuovi", noOverrides: "Nessuna eccezione individuale.",
  },
  preview: {
    backToList: "Torna all'elenco corsi", backToEditor: "Torna all'editor del corso", eyebrow: "Anteprima membro", lessonCount: (count) => `${count} lezioni`, content: "Contenuto del corso", noProgress: "Vista senza progresso didattico", structure: "Struttura di anteprima del corso", lessonPages: "Pagine della lezione", mainContent: "Contenuto principale", emptyArea: "Nessun contenuto in questa area", noLessonsTitle: "Questo corso non contiene ancora lezioni", noLessonsDescription: "Crea il primo modulo e la prima lezione nell'editor.",
    fallbacks: { eyebrow: "Occhiello", heading: "Titolo", text: "Testo", form: "Modulo", formUnavailable: "Modulo non disponibile", info: "Nota", checklist: "Elenco di controllo", submission: "Consegna", contentElement: (type) => `Elemento contenuto: ${type}` },
  },
  information: { goals: "Obiettivi didattici", addGoal: "Aggiungi obiettivo", goal: (number) => `Obiettivo didattico ${number}`, deleteGoal: (number) => `Elimina obiettivo ${number}`, authors: "Autori del corso", authorSelect: "Membro del team come autore", addAuthor: "Aggiungi autore", removeAuthor: (name) => `Rimuovi ${name} dagli autori del corso` },
  gallery: { display: "Visualizzazione", grid: "Griglia", featured: "In evidenza", image: (number) => `Immagine galleria ${number}`, remove: (label) => `Rimuovi ${label}`, altText: "Testo alternativo", caption: "Didascalia", addImage: "Aggiungi immagine" },
  widgets: {
    title: "Widget del corso", createAria: "Crea widget", createTitle: "Crea widget", types: { author: "Scheda autore", info: "Scheda informativa", image_link: "Scheda immagine" }, teamMember: "Membro del team", noActiveMember: "Nessun membro attivo", role: "Ruolo", roleHint: "Lascia vuoto per usare la qualifica professionale.", rolePlaceholder: "Responsabile del corso", description: "Descrizione", descriptionHint: "Lascia vuoto per usare la descrizione del profilo.", titleField: "Titolo", text: "Testo", optionalLink: "Link (facoltativo)", internalLinkHint: "Percorso interno o URL HTTP(S).", imageSource: "Origine immagine", imageSourceHint: "Carica un'immagine verificata oppure usa un percorso /images sicuro o un URL HTTPS.", altText: "Testo alternativo", link: "Link", authorFallback: "Autore del corso", cancel: "Annulla", create: "Crea widget", saveChanges: "Salva modifiche", saveFailed: "Impossibile salvare il widget del corso.", moveUp: (type) => `Sposta ${type} su`, moveDown: (type) => `Sposta ${type} giu`, editWidget: (type) => `Modifica ${type}`, deleteWidget: (type) => `Elimina ${type}`, confirmDelete: "Eliminare questo widget?", empty: "Nessun widget del corso",
  },
  media: {
    selectFile: "Seleziona file", microphoneRecording: "Registrazione microfono", cameraRecording: "Registra fotocamera o schermo", recordingRejected: "Impossibile accettare la registrazione.", genericMedium: "Media del corso", preparing: "Preparazione", uploading: (progress) => `Caricamento ${progress}%`, processing: "Controllo di sicurezza", ready: "Controllato e pronto", remove: (name) => `Rimuovi ${name}`, source: (label) => `Origine ${label}`, upload: "Carica", uploadLabel: (label) => `Carica ${label}`, library: "Libreria", useLibrary: "Riutilizza media verificati", searchLibrary: "Cerca nella libreria media", emptyLibrary: "Nessun media verificato corrispondente.", selectLibraryAsset: (name) => `Seleziona ${name}`, stock: "Stock", useStock: "Usa immagine stock", url: "URL", externalUrl: (label) => `Usa URL esterno per ${label}`, urlLabel: (label) => `URL ${label}`, searchStock: "Cerca immagini stock", search: "Cerca",
    retry: "Riprova il caricamento",
    errors: { remove: "Impossibile rimuovere il media.", invalidFile: "Il tipo o la dimensione del file non sono validi.", wrongKind: "Il file non corrisponde al tipo di blocco selezionato.", upload: "Caricamento non riuscito.", library: "Impossibile caricare la libreria media.", stockSearch: "Impossibile caricare le immagini stock.", stockUnavailable: "La ricerca di immagini stock non e configurata su questo sistema.", stockSelect: "Impossibile selezionare l'immagine stock." },
  },
  categories: {
    title: "Categorie", manageTitle: "Gestisci categorie", count: (count) => `${count} categorie`, courseCount: (count) => `${count} corsi`, create: "Crea categoria", createTitle: "Crea categoria", editTitle: "Modifica categoria", close: "Chiudi finestra", name: "Nome", description: "Descrizione", color: "Colore", colorAria: "Colore categoria", cancel: "Annulla", save: "Salva", saving: "Salvataggio", edit: "Modifica", delete: "Elimina", moveUp: "Sposta su", moveDown: "Sposta giu", empty: "Nessuna categoria", noDescription: "Nessuna descrizione", confirmTitle: "Elimina categoria", confirmQuestion: (name) => `Eliminare ${name}?`, confirmUnused: "Questa categoria non e assegnata ad alcun corso.", confirmUsed: (count) => `${count} corsi usano questa categoria. Continueranno senza categoria.`, confirmDelete: "Elimina definitivamente",
  },
  changes: {
    kind: { added: "Aggiunto", updated: "Modificato", removed: "Rimosso", moved: "Spostato" }, publishing: "Pubblicazione", publishCourse: "Pubblica corso", publishVersion: "Pubblica versione", unavailableTitle: "Confronto non disponibile", unavailableDescription: "Non e stato possibile leggere in modo sicuro la versione pubblicata. Non e stata creata una nuova versione.", noChangesTitle: "Nessuna modifica in sospeso", noChangesDescription: "La bozza e la versione corrente sono identiche.", total: (count) => `${count} modifiche`, newCount: (count) => `${count} nuove`, updatedCount: (count) => `${count} modificate`, removedCount: (count) => `${count} rimosse`, movedCount: (count) => `${count} spostate`, emailPreview: "Anteprima email di rilascio moduli", emailSummary: (recipients, eligible, modules) => `${recipients} di ${eligible} membri idonei riceveranno un'email su ${modules} nuovi moduli disponibili.`, noNewModules: "Questa pubblicazione non rende disponibili nuovi moduli ai membri idonei.", emailsDisabled: "Le email automatiche di rilascio sono disattivate nelle informazioni del corso.", versionNote: "Nota versione", versionPlaceholder: "Cosa e stato migliorato in questa versione?", publishVisibility: "Solo la pubblicazione rende queste modifiche visibili ai membri.", publishPermission: "Richiesto il permesso di pubblicazione", noVersionsTitle: "Nessuna versione", noVersionsDescription: "La prima pubblicazione avvia la cronologia delle versioni.", version: (version) => `Versione ${version}`, published: "Pubblicata", saved: "Salvata", noVersionNote: "Nessuna nota di versione.", current: "Corrente", viewChanges: "Visualizza modifiche", comparisonUnavailable: "Confronto non disponibile", updateCourse: "Aggiorna corso", publishChanges: "Pubblica modifiche", versionHistory: "Cronologia versioni", eyebrow: "Registro modifiche corso", dialogTitle: "Versioni e modifiche", views: "Viste del registro modifiche",
  },
  actions: {
    course: { invalidTitle: "Il titolo del corso e troppo corto.", invalidDescription: "Aggiungi una breve descrizione.", categoryUnavailable: "La categoria selezionata non e disponibile.", createFailed: "Impossibile creare il corso. Riprova.", publishedFromAdmin: "Pubblicato dall'interfaccia di amministrazione.", changesPublishedFromAdmin: "Modifiche pubblicate dall'interfaccia di amministrazione." },
    ai: { invalidBrief: "Controlla i dati della bozza del corso.", categoryUnavailable: "La categoria selezionata non e disponibile.", unavailable: "La creazione di corsi con IA non e disponibile. Riprova.", inProgress: "E gia in corso la generazione di un corso con IA. Attendi il completamento.", quota: (minutes) => `La quota IA e stata raggiunta. Riprova tra ${minutes} minuti.`, authorizationChanged: "Il tuo permesso di creare corsi e cambiato. Nessuna bozza e stata salvata.", saveFailed: "Impossibile salvare la bozza del corso. Riprova.", notificationTitle: "Bozza corso IA creata", notificationBody: (title) => `La bozza \"${title}\" e pronta per la verifica.`, trueLabel: "Vero", falseLabel: "Falso" },
    category: { invalid: "La categoria non e valida.", createSuccess: "Categoria creata.", updateSuccess: "Categoria salvata.", deleteSuccess: "Categoria eliminata.", usageLoaded: "Utilizzo corrente dei corsi caricato.", reorderSuccess: "Ordine salvato.", reorderInvalid: "L'ordine delle categorie non e valido.", failed: "Impossibile completare l'azione sulla categoria." },
    widget: { invalidCourse: "Il corso non e valido.", invalidWidget: "Il widget del corso non e valido.", invalidOrder: "L'ordine dei widget non e valido.", createSuccess: "Widget del corso creato.", updateSuccess: "Widget del corso salvato.", deleteSuccess: "Widget del corso eliminato.", reorderSuccess: "Ordine widget salvato.", failed: "Impossibile salvare il widget del corso." },
    access: { learnerOnlyRequest: "Solo gli studenti possono richiedere l'accesso al modulo.", learnerOnlyWithdraw: "Solo gli studenti possono ritirare una richiesta.", invalidInput: "Controlla i dati inseriti.", invalidRequest: "La richiesta non e valida.", requestSent: "Richiesta di accesso inviata.", requestFailed: "Impossibile inviare la richiesta di accesso.", requestWithdrawn: "Richiesta di accesso ritirata.", withdrawFailed: "Impossibile ritirare la richiesta.", invalidDecision: "Controlla la decisione e la data di scadenza.", staleRejected: "La richiesta obsoleta e stata rifiutata in modo sicuro.", approved: "Accesso al modulo approvato.", rejected: "Richiesta di accesso rifiutata.", decisionFailed: "Impossibile decidere la richiesta.", invalidOverride: "Controlla stato, motivo e data di scadenza.", overrideSaved: "Accesso individuale al modulo salvato.", overrideSaveFailed: "Impossibile salvare l'accesso al modulo.", overrideRemoved: "Accesso individuale al modulo rimosso.", overrideRemoveFailed: "Impossibile rimuovere l'accesso al modulo." },
  },
  diff: {
    groups: { course: "Informazioni corso", goals: "Obiettivi didattici", authors: "Autori", widgets: "Widget", modules: "Moduli", access: "Accesso", sections: "Sezioni", lessons: "Lezioni", pages: "Pagine", blocks: "Blocchi di contenuto" },
    blockTypes: { heading: "Titolo", text: "Testo", rich_text: "Testo ricco", button: "Pulsante", gallery: "Galleria", callout: "Riquadro informativo", quote: "Citazione", divider: "Separatore", accordion: "Fisarmonica", tabs: "Schede", columns: "Colonne", download: "Download", code: "Codice", table: "Tabella", data_form: "Modulo", info: "Nota", checklist: "Elenco di controllo", image: "Immagine", video: "Video", audio: "Audio", file: "File", embed: "Incorporamento", multiple_choice: "Scelta multipla", true_false: "Vero/Falso", multi_select: "Selezione multipla", fill_blank: "Testo da completare", ordering: "Ordinamento", submission: "Consegna" },
    fields: { categoryId: "Categoria", title: "Titolo del corso", slug: "Indirizzo del corso", shortDescription: "Descrizione breve", description: "Descrizione", coverImage: "Immagine di copertina", difficulty: "Difficolta", estimatedMinutes: "Durata stimata", certificateEnabled: "Certificato", featured: "In evidenza", visibleInCatalog: "Visibilita catalogo", showProgressPercentage: "Visualizzazione progresso", notifyMembersOnModuleRelease: "Email di rilascio modulo" },
    draftCreated: "Bozza corso creata", noPublishedVersion: "Nessuna versione ancora pubblicata", changed: (label) => `${label} modificato`, courseInformation: "Informazioni corso", fallback: { goal: "Obiettivo didattico", author: "Autore", authorWidget: "Widget autore", widget: "Widget", module: "Modulo", section: "Sezione", lesson: "Lezione", page: "Pagina", block: "Blocco di contenuto" },
    details: { goalRemoved: "Obiettivo rimosso", goalAdded: "Obiettivo aggiunto", textChanged: "Testo modificato", orderChanged: "Ordine modificato", authorRemoved: "Autore rimosso", authorAdded: "Autore aggiunto", authorProfileChanged: "Profilo autore modificato", widgetRemoved: "Widget rimosso", widgetAdded: "Widget aggiunto", widgetContentChanged: "Contenuto widget modificato", moduleRemoved: "Modulo rimosso", moduleAdded: "Modulo aggiunto", moduleContentChanged: "Contenuto modulo modificato", moduleTypeChanged: "Tipo di modulo modificato", linkedCourseChanged: "Corso collegato modificato", orderAndIndentChanged: "Ordine e rientro modificati", indentChanged: "Rientro modificato", moduleAccessChanged: "Accesso al modulo modificato", sectionSettingsChanged: "Impostazioni sezione modificate", lessonSettingsChanged: "Impostazioni lezione modificate", pageSettingsChanged: "Impostazioni pagina modificate" },
    from: (name) => `Da ${name}`, in: (name) => `In ${name}`, on: (name) => `Su ${name}`, blockRemoved: (location) => `Rimosso ${location}`, blockAdded: (location) => `Aggiunto ${location}`, blockContentChanged: (location) => `Contenuto modificato - ${location}`,
  },
};

const es: CourseSupportCopy = {
  common: {
    backToCourse: "Volver al curso", cancel: "Cancelar", save: "Guardar", delete: "Eliminar", edit: "Editar", closeDialog: "Cerrar dialogo", moveUp: "Mover arriba", moveDown: "Mover abajo", active: "Activo", invited: "Invitado", disabled: "Desactivado", teamMember: "Miembro del equipo", required: "Obligatorio", live: "En linea", draft: "Borrador", uncategorized: "Sin categoria", notAssigned: "Sin asignar",
    permission: { none: "Sin acceso al curso", view: "Ver", edit: "Editar", manage: "Publicar" },
    courseStatus: { draft: "Borrador", published: "Publicado", archived: "Archivado" },
  },
  page: { metadataTitle: "Cursos" },
  explorer: {
    search: "Buscar cursos", filterCategory: "Filtrar por categoria", allCategories: "Todas las categorias", view: "Vista", gridView: "Vista de cuadricula", listView: "Vista de lista", newCourse: "Nuevo curso", resultCount: (visible, total) => `${visible} de ${total} cursos`, featured: "Destacado", courseAction: (title, action) => `${action} ${title}`, modules: (count) => `${count} modulos`, learners: (count) => `${count} miembros`, averageProgress: "Progreso medio",
    columns: { course: "Curso", category: "Categoria", status: "Estado", permission: "Permiso del curso", members: "Miembros", progress: "Progreso", action: "Accion" },
    viewCourse: "Ver", editCourse: "Editar", emptyTitle: "No hay cursos coincidentes", emptyDescription: "Ajusta la busqueda o el filtro de categoria.",
  },
  creation: {
    eyebrow: "Gestion de cursos", title: "Crear un curso nuevo", close: "Cerrar dialogo", mode: "Modo de creacion", manual: "Manual", aiAssistant: "Asistente de IA", courseTitle: "Titulo del curso", courseTitlePlaceholder: "p. ej., IA para ventas", description: "Descripcion breve", descriptionPlaceholder: "Que aprenderan los miembros en este curso?", category: "Categoria", noCategory: "Sin categoria", creating: "Creando", createCourse: "Crear curso", topic: "Tema", topicPlaceholder: "p. ej., Uso seguro de IA en atencion al cliente", audience: "Publico objetivo", audiencePlaceholder: "p. ej., Responsables sin experiencia en IA", learningGoal: "Objetivo de aprendizaje", learningGoalPlaceholder: "Que resultado concreto deben alcanzar los alumnos?", level: "Nivel", levels: { beginner: "Basico", intermediate: "Intermedio", advanced: "Avanzado", mixed: "Mixto" }, tone: "Tono", tones: { practical: "Practico", professional: "Profesional", motivating: "Motivador", concise: "Conciso" }, scope: "Alcance", scopes: { compact: "Compacto - 2 modulos", standard: "Estandar - 3 modulos", intensive: "Intensivo - 4 modulos" }, generating: "Generando borrador", generate: "Generar borrador",
  },
  team: {
    eyebrow: "Permisos del equipo del curso", description: "Propietarios y administradores siempre tienen acceso completo. Aqui solo se gestionan permisos explicitos de formadores.", assigned: (count) => `${count} asignados`, columns: { trainer: "Formador", status: "Estado", permission: "Permiso del curso", action: "Accion" }, permissionFor: (name) => `Permiso del curso para ${name}`, save: "Guardar", emptyTitle: "Aun no hay formadores", emptyDescription: "Crea primero una cuenta de formador en la gestion de miembros.", manageMembers: "Gestionar miembros",
  },
  accessPage: { eyebrow: "Acceso a modulos", summary: (modules, members) => `${modules} modulos | ${members} inscripciones activas`, unpublishedNotice: "Las excepciones solo se pueden definir sobre una version publicada del curso." },
  access: {
    title: "Acceso individual al modulo", openCount: (count) => `${count} abiertas`, openRequests: "Solicitudes abiertas", noMessage: "Sin mensaje.", noRequests: "No hay solicitudes de acceso abiertas.", approvalNote: "Motivo (opcional)", rejectionNote: "Motivo del rechazo", accessUntil: "Acceso hasta", approve: "Aprobar", reject: "Rechazar", setOverride: "Definir excepcion", noLearners: "No hay alumnos activos.", learner: "Alumno", state: "Acceso", states: { available: "Disponible", read_only: "Solo lectura", locked: "Bloqueado", hidden: "Oculto" }, expiresAt: "Fecha de caducidad", reason: "Motivo", saveOverride: "Guardar excepcion", activeOverrides: "Excepciones activas", until: (date) => `hasta ${date}`, noExpiry: "sin fecha de caducidad", remove: "Eliminar", noOverrides: "No hay excepciones individuales.",
  },
  preview: {
    backToList: "Volver a la lista de cursos", backToEditor: "Volver al editor del curso", eyebrow: "Vista previa de miembro", lessonCount: (count) => `${count} lecciones`, content: "Contenido del curso", noProgress: "Vista sin progreso de aprendizaje", structure: "Estructura de vista previa del curso", lessonPages: "Paginas de la leccion", mainContent: "Contenido principal", emptyArea: "Aun no hay contenido en esta zona", noLessonsTitle: "Este curso aun no tiene lecciones", noLessonsDescription: "Crea el primer modulo y la primera leccion en el editor.",
    fallbacks: { eyebrow: "Antetitulo", heading: "Titulo", text: "Texto", form: "Formulario", formUnavailable: "Formulario no disponible", info: "Nota", checklist: "Lista de comprobacion", submission: "Entrega", contentElement: (type) => `Elemento de contenido: ${type}` },
  },
  information: { goals: "Objetivos de aprendizaje", addGoal: "Agregar objetivo", goal: (number) => `Objetivo de aprendizaje ${number}`, deleteGoal: (number) => `Eliminar objetivo ${number}`, authors: "Autores del curso", authorSelect: "Miembro del equipo como autor", addAuthor: "Agregar autor", removeAuthor: (name) => `Eliminar a ${name} como autor del curso` },
  gallery: { display: "Presentacion", grid: "Cuadricula", featured: "Destacada", image: (number) => `Imagen de galeria ${number}`, remove: (label) => `Eliminar ${label}`, altText: "Texto alternativo", caption: "Pie de imagen", addImage: "Agregar imagen" },
  widgets: {
    title: "Widgets del curso", createAria: "Crear widget", createTitle: "Crear widget", types: { author: "Tarjeta de autor", info: "Tarjeta informativa", image_link: "Tarjeta de imagen" }, teamMember: "Miembro del equipo", noActiveMember: "No hay miembros activos", role: "Rol", roleHint: "Dejalo vacio para usar el puesto.", rolePlaceholder: "Responsable del curso", description: "Descripcion", descriptionHint: "Dejalo vacio para usar la descripcion del perfil.", titleField: "Titulo", text: "Texto", optionalLink: "Enlace (opcional)", internalLinkHint: "Ruta interna o URL HTTP(S).", imageSource: "Origen de imagen", imageSourceHint: "Sube una imagen verificada o usa una ruta /images segura o una URL HTTPS.", altText: "Texto alternativo", link: "Enlace", authorFallback: "Autor del curso", cancel: "Cancelar", create: "Crear widget", saveChanges: "Guardar cambios", saveFailed: "No se pudo guardar el widget del curso.", moveUp: (type) => `Mover ${type} arriba`, moveDown: (type) => `Mover ${type} abajo`, editWidget: (type) => `Editar ${type}`, deleteWidget: (type) => `Eliminar ${type}`, confirmDelete: "Eliminar este widget?", empty: "Aun no hay widgets del curso",
  },
  media: {
    selectFile: "Seleccionar archivo", microphoneRecording: "Grabacion de microfono", cameraRecording: "Grabar camara o pantalla", recordingRejected: "No se pudo aceptar la grabacion.", genericMedium: "Contenido multimedia del curso", preparing: "Preparando", uploading: (progress) => `Subida ${progress}%`, processing: "Comprobacion de seguridad", ready: "Comprobado y listo", remove: (name) => `Eliminar ${name}`, source: (label) => `Origen de ${label}`, upload: "Subir", uploadLabel: (label) => `Subir ${label}`, library: "Biblioteca", useLibrary: "Reutilizar contenido verificado", searchLibrary: "Buscar en la biblioteca multimedia", emptyLibrary: "No hay contenido verificado coincidente.", selectLibraryAsset: (name) => `Seleccionar ${name}`, stock: "Stock", useStock: "Usar imagen de stock", url: "URL", externalUrl: (label) => `Usar URL externa de ${label}`, urlLabel: (label) => `URL de ${label}`, searchStock: "Buscar imagenes de stock", search: "Buscar",
    retry: "Reintentar subida",
    errors: { remove: "No se pudo eliminar el contenido multimedia.", invalidFile: "El tipo o el tamano del archivo no es valido.", wrongKind: "El archivo no coincide con el tipo de bloque seleccionado.", upload: "La subida ha fallado.", library: "No se pudo cargar la biblioteca multimedia.", stockSearch: "No se pudieron cargar las imagenes de stock.", stockUnavailable: "La busqueda de imagenes de stock no esta configurada en este sistema.", stockSelect: "No se pudo seleccionar la imagen de stock." },
  },
  categories: {
    title: "Categorias", manageTitle: "Gestionar categorias", count: (count) => `${count} categorias`, courseCount: (count) => `${count} cursos`, create: "Crear categoria", createTitle: "Crear categoria", editTitle: "Editar categoria", close: "Cerrar dialogo", name: "Nombre", description: "Descripcion", color: "Color", colorAria: "Color de la categoria", cancel: "Cancelar", save: "Guardar", saving: "Guardando", edit: "Editar", delete: "Eliminar", moveUp: "Mover arriba", moveDown: "Mover abajo", empty: "Aun no hay categorias", noDescription: "Sin descripcion", confirmTitle: "Eliminar categoria", confirmQuestion: (name) => `Eliminar ${name}?`, confirmUnused: "Esta categoria no esta asignada a ningun curso.", confirmUsed: (count) => `${count} cursos usan esta categoria. Continuaran sin categoria.`, confirmDelete: "Eliminar definitivamente",
  },
  changes: {
    kind: { added: "Anadido", updated: "Modificado", removed: "Eliminado", moved: "Movido" }, publishing: "Publicando", publishCourse: "Publicar curso", publishVersion: "Publicar version", unavailableTitle: "La comparacion no esta disponible", unavailableDescription: "No se pudo leer con seguridad la version publicada. No se creo una version nueva.", noChangesTitle: "No hay cambios pendientes", noChangesDescription: "El borrador y la version actual son identicos.", total: (count) => `${count} cambios`, newCount: (count) => `${count} nuevos`, updatedCount: (count) => `${count} editados`, removedCount: (count) => `${count} eliminados`, movedCount: (count) => `${count} movidos`, emailPreview: "Vista previa del correo de publicacion de modulos", emailSummary: (recipients, eligible, modules) => `${recipients} de ${eligible} miembros aptos recibiran un correo sobre ${modules} modulos nuevos disponibles.`, noNewModules: "Esta publicacion no libera modulos nuevos para los miembros aptos.", emailsDisabled: "Los correos automaticos de publicacion estan desactivados en la informacion del curso.", versionNote: "Nota de version", versionPlaceholder: "Que se ha mejorado en esta version?", publishVisibility: "Solo la publicacion hace visibles estos cambios para los miembros.", publishPermission: "Se requiere permiso de publicacion", noVersionsTitle: "Aun no hay versiones", noVersionsDescription: "La primera publicacion inicia el historial de versiones.", version: (version) => `Version ${version}`, published: "Publicado", saved: "Guardado", noVersionNote: "No se ha indicado una nota de version.", current: "Actual", viewChanges: "Ver cambios", comparisonUnavailable: "Comparacion no disponible", updateCourse: "Actualizar curso", publishChanges: "Publicar cambios", versionHistory: "Historial de versiones", eyebrow: "Registro de cambios del curso", dialogTitle: "Versiones y cambios", views: "Vistas del registro de cambios",
  },
  actions: {
    course: { invalidTitle: "El titulo del curso es demasiado corto.", invalidDescription: "Agrega una descripcion breve.", categoryUnavailable: "La categoria seleccionada no esta disponible.", createFailed: "No se pudo crear el curso. Intentalo de nuevo.", publishedFromAdmin: "Publicado desde la interfaz de administracion.", changesPublishedFromAdmin: "Cambios publicados desde la interfaz de administracion." },
    ai: { invalidBrief: "Comprueba los datos del borrador del curso.", categoryUnavailable: "La categoria seleccionada no esta disponible.", unavailable: "La creacion de cursos con IA no esta disponible. Intentalo de nuevo.", inProgress: "Ya se esta generando un curso con IA. Espera a que termine.", quota: (minutes) => `Se ha alcanzado la cuota de IA. Intentalo de nuevo en ${minutes} minutos.`, authorizationChanged: "Tu permiso para crear cursos ha cambiado. No se guardo ningun borrador.", saveFailed: "No se pudo guardar el borrador del curso. Intentalo de nuevo.", notificationTitle: "Borrador de curso con IA creado", notificationBody: (title) => `El borrador \"${title}\" esta listo para revision.`, trueLabel: "Verdadero", falseLabel: "Falso" },
    category: { invalid: "La categoria no es valida.", createSuccess: "Categoria creada.", updateSuccess: "Categoria guardada.", deleteSuccess: "Categoria eliminada.", usageLoaded: "Uso actual de cursos cargado.", reorderSuccess: "Orden guardado.", reorderInvalid: "El orden de categorias no es valido.", failed: "No se pudo completar la accion de categoria." },
    widget: { invalidCourse: "El curso no es valido.", invalidWidget: "El widget del curso no es valido.", invalidOrder: "El orden de widgets no es valido.", createSuccess: "Widget del curso creado.", updateSuccess: "Widget del curso guardado.", deleteSuccess: "Widget del curso eliminado.", reorderSuccess: "Orden de widgets guardado.", failed: "No se pudo guardar el widget del curso." },
    access: { learnerOnlyRequest: "Solo los alumnos pueden solicitar acceso al modulo.", learnerOnlyWithdraw: "Solo los alumnos pueden retirar una solicitud.", invalidInput: "Comprueba los datos.", invalidRequest: "La solicitud no es valida.", requestSent: "Solicitud de acceso enviada.", requestFailed: "No se pudo enviar la solicitud de acceso.", requestWithdrawn: "Solicitud de acceso retirada.", withdrawFailed: "No se pudo retirar la solicitud.", invalidDecision: "Comprueba la decision y la fecha de caducidad.", staleRejected: "La solicitud obsoleta se rechazo de forma segura.", approved: "Acceso al modulo aprobado.", rejected: "Solicitud de acceso rechazada.", decisionFailed: "No se pudo decidir la solicitud.", invalidOverride: "Comprueba el estado, el motivo y la fecha de caducidad.", overrideSaved: "Acceso individual al modulo guardado.", overrideSaveFailed: "No se pudo guardar el acceso al modulo.", overrideRemoved: "Acceso individual al modulo eliminado.", overrideRemoveFailed: "No se pudo eliminar el acceso al modulo." },
  },
  diff: {
    groups: { course: "Informacion del curso", goals: "Objetivos de aprendizaje", authors: "Autores", widgets: "Widgets", modules: "Modulos", access: "Acceso", sections: "Secciones", lessons: "Lecciones", pages: "Paginas", blocks: "Bloques de contenido" },
    blockTypes: { heading: "Titulo", text: "Texto", rich_text: "Texto enriquecido", button: "Boton", gallery: "Galeria", callout: "Aviso destacado", quote: "Cita", divider: "Separador", accordion: "Acordeon", tabs: "Pestanas", columns: "Columnas", download: "Descarga", code: "Codigo", table: "Tabla", data_form: "Formulario", info: "Nota", checklist: "Lista de comprobacion", image: "Imagen", video: "Video", audio: "Audio", file: "Archivo", embed: "Contenido incrustado", multiple_choice: "Opcion multiple", true_false: "Verdadero/Falso", multi_select: "Seleccion multiple", fill_blank: "Completar hueco", ordering: "Ordenacion", submission: "Entrega" },
    fields: { categoryId: "Categoria", title: "Titulo del curso", slug: "Direccion del curso", shortDescription: "Descripcion breve", description: "Descripcion", coverImage: "Imagen de portada", difficulty: "Dificultad", estimatedMinutes: "Duracion estimada", certificateEnabled: "Certificado", featured: "Destacado", visibleInCatalog: "Visibilidad en catalogo", showProgressPercentage: "Indicador de progreso", notifyMembersOnModuleRelease: "Correo de publicacion de modulo" },
    draftCreated: "Borrador del curso creado", noPublishedVersion: "Aun no se ha publicado ninguna version", changed: (label) => `${label} modificado`, courseInformation: "Informacion del curso", fallback: { goal: "Objetivo de aprendizaje", author: "Autor", authorWidget: "Widget de autor", widget: "Widget", module: "Modulo", section: "Seccion", lesson: "Leccion", page: "Pagina", block: "Bloque de contenido" },
    details: { goalRemoved: "Objetivo eliminado", goalAdded: "Objetivo anadido", textChanged: "Texto modificado", orderChanged: "Orden modificado", authorRemoved: "Autor eliminado", authorAdded: "Autor anadido", authorProfileChanged: "Perfil del autor modificado", widgetRemoved: "Widget eliminado", widgetAdded: "Widget anadido", widgetContentChanged: "Contenido del widget modificado", moduleRemoved: "Modulo eliminado", moduleAdded: "Modulo anadido", moduleContentChanged: "Contenido del modulo modificado", moduleTypeChanged: "Tipo de modulo modificado", linkedCourseChanged: "Curso de destino enlazado modificado", orderAndIndentChanged: "Orden y sangria modificados", indentChanged: "Sangria modificada", moduleAccessChanged: "Acceso al modulo modificado", sectionSettingsChanged: "Ajustes de seccion modificados", lessonSettingsChanged: "Ajustes de leccion modificados", pageSettingsChanged: "Ajustes de pagina modificados" },
    from: (name) => `Desde ${name}`, in: (name) => `En ${name}`, on: (name) => `En ${name}`, blockRemoved: (location) => `Eliminado ${location}`, blockAdded: (location) => `Anadido ${location}`, blockContentChanged: (location) => `Contenido modificado - ${location}`,
  },
};

const fr: CourseSupportCopy = {
  common: {
    backToCourse: "Retour au cours", cancel: "Annuler", save: "Enregistrer", delete: "Supprimer", edit: "Modifier", closeDialog: "Fermer la fenetre", moveUp: "Monter", moveDown: "Descendre", active: "Actif", invited: "Invite", disabled: "Desactive", teamMember: "Membre de l'equipe", required: "Obligatoire", live: "En ligne", draft: "Brouillon", uncategorized: "Sans categorie", notAssigned: "Non attribue",
    permission: { none: "Aucun acces au cours", view: "Voir", edit: "Modifier", manage: "Publier" },
    courseStatus: { draft: "Brouillon", published: "Publie", archived: "Archive" },
  },
  page: { metadataTitle: "Cours" },
  explorer: {
    search: "Rechercher des cours", filterCategory: "Filtrer par categorie", allCategories: "Toutes les categories", view: "Affichage", gridView: "Vue en grille", listView: "Vue en liste", newCourse: "Nouveau cours", resultCount: (visible, total) => `${visible} sur ${total} cours`, featured: "En vedette", courseAction: (title, action) => `${action} ${title}`, modules: (count) => `${count} modules`, learners: (count) => `${count} membres`, averageProgress: "Progression moyenne",
    columns: { course: "Cours", category: "Categorie", status: "Statut", permission: "Droit sur le cours", members: "Membres", progress: "Progression", action: "Action" },
    viewCourse: "Voir", editCourse: "Modifier", emptyTitle: "Aucun cours correspondant", emptyDescription: "Modifiez la recherche ou le filtre de categorie.",
  },
  creation: {
    eyebrow: "Gestion des cours", title: "Creer un nouveau cours", close: "Fermer la fenetre", mode: "Mode de creation", manual: "Manuel", aiAssistant: "Assistant IA", courseTitle: "Titre du cours", courseTitlePlaceholder: "p. ex. L'IA pour la vente", description: "Description courte", descriptionPlaceholder: "Que vont apprendre les membres dans ce cours ?", category: "Categorie", noCategory: "Sans categorie", creating: "Creation", createCourse: "Creer le cours", topic: "Sujet", topicPlaceholder: "p. ex. Utilisation sure de l'IA au service client", audience: "Public cible", audiencePlaceholder: "p. ex. Responsables sans experience de l'IA", learningGoal: "Objectif pedagogique", learningGoalPlaceholder: "Quel resultat concret les apprenants doivent-ils atteindre ?", level: "Niveau", levels: { beginner: "Debutant", intermediate: "Intermediaire", advanced: "Avance", mixed: "Mixte" }, tone: "Ton", tones: { practical: "Pratique", professional: "Professionnel", motivating: "Motivant", concise: "Concis" }, scope: "Etendue", scopes: { compact: "Compact - 2 modules", standard: "Standard - 3 modules", intensive: "Intensif - 4 modules" }, generating: "Creation du brouillon", generate: "Creer le brouillon",
  },
  team: {
    eyebrow: "Droits de l'equipe du cours", description: "Les proprietaires et administrateurs disposent toujours de tous les droits. Seuls les droits explicites des formateurs sont geres ici.", assigned: (count) => `${count} attribues`, columns: { trainer: "Formateur", status: "Statut", permission: "Droit sur le cours", action: "Action" }, permissionFor: (name) => `Droit sur le cours pour ${name}`, save: "Enregistrer", emptyTitle: "Aucun formateur", emptyDescription: "Creez d'abord un compte formateur dans la gestion des membres.", manageMembers: "Gerer les membres",
  },
  accessPage: { eyebrow: "Acces aux modules", summary: (modules, members) => `${modules} modules | ${members} inscriptions actives`, unpublishedNotice: "Les exceptions ne peuvent etre definies que pour une version publiee du cours." },
  access: {
    title: "Acces individuel au module", openCount: (count) => `${count} ouvertes`, openRequests: "Demandes ouvertes", noMessage: "Aucun message.", noRequests: "Aucune demande d'acces ouverte.", approvalNote: "Motif (facultatif)", rejectionNote: "Motif du refus", accessUntil: "Acces jusqu'au", approve: "Approuver", reject: "Refuser", setOverride: "Definir une exception", noLearners: "Aucun apprenant actif.", learner: "Apprenant", state: "Acces", states: { available: "Disponible", read_only: "Lecture seule", locked: "Verrouille", hidden: "Masque" }, expiresAt: "Date d'expiration", reason: "Motif", saveOverride: "Enregistrer l'exception", activeOverrides: "Exceptions actives", until: (date) => `jusqu'au ${date}`, noExpiry: "sans date d'expiration", remove: "Supprimer", noOverrides: "Aucune exception individuelle.",
  },
  preview: {
    backToList: "Retour a la liste des cours", backToEditor: "Retour a l'editeur du cours", eyebrow: "Apercu membre", lessonCount: (count) => `${count} lecons`, content: "Contenu du cours", noProgress: "Vue sans progression pedagogique", structure: "Structure d'apercu du cours", lessonPages: "Pages de la lecon", mainContent: "Contenu principal", emptyArea: "Aucun contenu dans cette zone", noLessonsTitle: "Ce cours ne contient pas encore de lecons", noLessonsDescription: "Creez le premier module et la premiere lecon dans l'editeur.",
    fallbacks: { eyebrow: "Surtitre", heading: "Titre", text: "Texte", form: "Formulaire", formUnavailable: "Formulaire indisponible", info: "Remarque", checklist: "Liste de controle", submission: "Remise", contentElement: (type) => `Element de contenu : ${type}` },
  },
  information: { goals: "Objectifs pedagogiques", addGoal: "Ajouter un objectif", goal: (number) => `Objectif pedagogique ${number}`, deleteGoal: (number) => `Supprimer l'objectif ${number}`, authors: "Auteurs du cours", authorSelect: "Membre de l'equipe comme auteur", addAuthor: "Ajouter un auteur", removeAuthor: (name) => `Retirer ${name} des auteurs du cours` },
  gallery: { display: "Affichage", grid: "Grille", featured: "Mise en avant", image: (number) => `Image de galerie ${number}`, remove: (label) => `Supprimer ${label}`, altText: "Texte alternatif", caption: "Legende", addImage: "Ajouter une image" },
  widgets: {
    title: "Widgets du cours", createAria: "Creer un widget", createTitle: "Creer un widget", types: { author: "Carte auteur", info: "Carte d'information", image_link: "Carte image" }, teamMember: "Membre de l'equipe", noActiveMember: "Aucun membre actif", role: "Role", roleHint: "Laissez vide pour utiliser l'intitule du poste.", rolePlaceholder: "Responsable du cours", description: "Description", descriptionHint: "Laissez vide pour utiliser la description du profil.", titleField: "Titre", text: "Texte", optionalLink: "Lien (facultatif)", internalLinkHint: "Chemin interne ou URL HTTP(S).", imageSource: "Source de l'image", imageSourceHint: "Televersez une image verifiee ou utilisez un chemin /images sur ou une URL HTTPS.", altText: "Texte alternatif", link: "Lien", authorFallback: "Auteur du cours", cancel: "Annuler", create: "Creer le widget", saveChanges: "Enregistrer les modifications", saveFailed: "Le widget du cours n'a pas pu etre enregistre.", moveUp: (type) => `Monter ${type}`, moveDown: (type) => `Descendre ${type}`, editWidget: (type) => `Modifier ${type}`, deleteWidget: (type) => `Supprimer ${type}`, confirmDelete: "Supprimer ce widget ?", empty: "Aucun widget de cours",
  },
  media: {
    selectFile: "Selectionner un fichier", microphoneRecording: "Enregistrement du microphone", cameraRecording: "Enregistrer la camera ou l'ecran", recordingRejected: "L'enregistrement n'a pas pu etre accepte.", genericMedium: "Media du cours", preparing: "Preparation", uploading: (progress) => `Televersement ${progress}%`, processing: "Controle de securite", ready: "Controle et pret", remove: (name) => `Supprimer ${name}`, source: (label) => `Source de ${label}`, upload: "Televerser", uploadLabel: (label) => `Televerser ${label}`, library: "Mediatheque", useLibrary: "Reutiliser un media verifie", searchLibrary: "Rechercher dans la mediatheque", emptyLibrary: "Aucun media verifie correspondant.", selectLibraryAsset: (name) => `Selectionner ${name}`, stock: "Stock", useStock: "Utiliser une image de stock", url: "URL", externalUrl: (label) => `Utiliser une URL externe pour ${label}`, urlLabel: (label) => `URL de ${label}`, searchStock: "Rechercher des images de stock", search: "Rechercher",
    retry: "Reessayer le televersement",
    errors: { remove: "Le media n'a pas pu etre supprime.", invalidFile: "Le type ou la taille du fichier n'est pas valide.", wrongKind: "Le fichier ne correspond pas au type de bloc selectionne.", upload: "Echec du televersement.", library: "La mediatheque n'a pas pu etre chargee.", stockSearch: "Les images de stock n'ont pas pu etre chargees.", stockUnavailable: "La recherche d'images de stock n'est pas configuree sur ce systeme.", stockSelect: "L'image de stock n'a pas pu etre selectionnee." },
  },
  categories: {
    title: "Categories", manageTitle: "Gerer les categories", count: (count) => `${count} categories`, courseCount: (count) => `${count} cours`, create: "Creer une categorie", createTitle: "Creer une categorie", editTitle: "Modifier la categorie", close: "Fermer la fenetre", name: "Nom", description: "Description", color: "Couleur", colorAria: "Couleur de la categorie", cancel: "Annuler", save: "Enregistrer", saving: "Enregistrement", edit: "Modifier", delete: "Supprimer", moveUp: "Monter", moveDown: "Descendre", empty: "Aucune categorie", noDescription: "Aucune description", confirmTitle: "Supprimer la categorie", confirmQuestion: (name) => `Supprimer ${name} ?`, confirmUnused: "Cette categorie n'est attribuee a aucun cours.", confirmUsed: (count) => `${count} cours utilisent cette categorie. Ils continueront sans categorie.`, confirmDelete: "Supprimer definitivement",
  },
  changes: {
    kind: { added: "Ajoute", updated: "Modifie", removed: "Supprime", moved: "Deplace" }, publishing: "Publication", publishCourse: "Publier le cours", publishVersion: "Publier la version", unavailableTitle: "Comparaison indisponible", unavailableDescription: "La version publiee actuelle n'a pas pu etre lue de maniere sure. Aucune nouvelle version n'a ete creee.", noChangesTitle: "Aucune modification en attente", noChangesDescription: "Le brouillon et la version actuelle sont identiques.", total: (count) => `${count} modifications`, newCount: (count) => `${count} nouvelles`, updatedCount: (count) => `${count} modifiees`, removedCount: (count) => `${count} supprimees`, movedCount: (count) => `${count} deplacees`, emailPreview: "Apercu des e-mails de publication des modules", emailSummary: (recipients, eligible, modules) => `${recipients} membres sur ${eligible} recevront un e-mail concernant ${modules} nouveaux modules disponibles.`, noNewModules: "Cette publication ne rend aucun nouveau module accessible aux membres eligibles.", emailsDisabled: "Les e-mails automatiques de publication sont desactives dans les informations du cours.", versionNote: "Note de version", versionPlaceholder: "Qu'est-ce qui a ete ameliore dans cette version ?", publishVisibility: "Seule la publication rend ces modifications visibles aux membres.", publishPermission: "Droit de publication requis", noVersionsTitle: "Aucune version", noVersionsDescription: "La premiere publication demarre l'historique des versions.", version: (version) => `Version ${version}`, published: "Publiee", saved: "Enregistree", noVersionNote: "Aucune note de version.", current: "Actuelle", viewChanges: "Voir les modifications", comparisonUnavailable: "Comparaison indisponible", updateCourse: "Mettre a jour le cours", publishChanges: "Publier les modifications", versionHistory: "Historique des versions", eyebrow: "Journal des modifications", dialogTitle: "Versions et modifications", views: "Vues du journal des modifications",
  },
  actions: {
    course: { invalidTitle: "Le titre du cours est trop court.", invalidDescription: "Ajoutez une courte description.", categoryUnavailable: "La categorie selectionnee n'est pas disponible.", createFailed: "Le cours n'a pas pu etre cree. Reessayez.", publishedFromAdmin: "Publie depuis l'interface d'administration.", changesPublishedFromAdmin: "Modifications publiees depuis l'interface d'administration." },
    ai: { invalidBrief: "Verifiez les informations du brouillon du cours.", categoryUnavailable: "La categorie selectionnee n'est pas disponible.", unavailable: "La creation de cours par IA est indisponible. Reessayez.", inProgress: "Un cours est deja en cours de generation par IA. Attendez la fin.", quota: (minutes) => `Le quota IA est atteint. Reessayez dans ${minutes} minutes.`, authorizationChanged: "Votre droit de creer des cours a change. Aucun brouillon n'a ete enregistre.", saveFailed: "Le brouillon du cours n'a pas pu etre enregistre. Reessayez.", notificationTitle: "Brouillon de cours IA cree", notificationBody: (title) => `Le brouillon \"${title}\" est pret a etre verifie.`, trueLabel: "Vrai", falseLabel: "Faux" },
    category: { invalid: "La categorie n'est pas valide.", createSuccess: "Categorie creee.", updateSuccess: "Categorie enregistree.", deleteSuccess: "Categorie supprimee.", usageLoaded: "Utilisation actuelle des cours chargee.", reorderSuccess: "Ordre enregistre.", reorderInvalid: "L'ordre des categories n'est pas valide.", failed: "L'action sur la categorie n'a pas pu etre terminee." },
    widget: { invalidCourse: "Le cours n'est pas valide.", invalidWidget: "Le widget du cours n'est pas valide.", invalidOrder: "L'ordre des widgets n'est pas valide.", createSuccess: "Widget du cours cree.", updateSuccess: "Widget du cours enregistre.", deleteSuccess: "Widget du cours supprime.", reorderSuccess: "Ordre des widgets enregistre.", failed: "Le widget du cours n'a pas pu etre enregistre." },
    access: { learnerOnlyRequest: "Seuls les apprenants peuvent demander l'acces au module.", learnerOnlyWithdraw: "Seuls les apprenants peuvent retirer une demande.", invalidInput: "Verifiez les informations saisies.", invalidRequest: "La demande n'est pas valide.", requestSent: "Demande d'acces envoyee.", requestFailed: "La demande d'acces n'a pas pu etre envoyee.", requestWithdrawn: "Demande d'acces retiree.", withdrawFailed: "La demande n'a pas pu etre retiree.", invalidDecision: "Verifiez la decision et la date d'expiration.", staleRejected: "La demande obsolete a ete refusee en toute securite.", approved: "Acces au module approuve.", rejected: "Demande d'acces refusee.", decisionFailed: "La demande n'a pas pu etre traitee.", invalidOverride: "Verifiez le statut, le motif et la date d'expiration.", overrideSaved: "Acces individuel au module enregistre.", overrideSaveFailed: "L'acces au module n'a pas pu etre enregistre.", overrideRemoved: "Acces individuel au module supprime.", overrideRemoveFailed: "L'acces au module n'a pas pu etre supprime." },
  },
  diff: {
    groups: { course: "Informations du cours", goals: "Objectifs pedagogiques", authors: "Auteurs", widgets: "Widgets", modules: "Modules", access: "Acces", sections: "Sections", lessons: "Lecons", pages: "Pages", blocks: "Blocs de contenu" },
    blockTypes: { heading: "Titre", text: "Texte", rich_text: "Texte enrichi", button: "Bouton", gallery: "Galerie", callout: "Encadre", quote: "Citation", divider: "Separateur", accordion: "Accordeon", tabs: "Onglets", columns: "Colonnes", download: "Telechargement", code: "Code", table: "Tableau", data_form: "Formulaire", info: "Remarque", checklist: "Liste de controle", image: "Image", video: "Video", audio: "Audio", file: "Fichier", embed: "Integration", multiple_choice: "Choix multiple", true_false: "Vrai/Faux", multi_select: "Selection multiple", fill_blank: "Texte a trous", ordering: "Classement", submission: "Remise" },
    fields: { categoryId: "Categorie", title: "Titre du cours", slug: "Adresse du cours", shortDescription: "Description courte", description: "Description", coverImage: "Image de couverture", difficulty: "Difficulte", estimatedMinutes: "Duree estimee", certificateEnabled: "Certificat", featured: "Mise en avant", visibleInCatalog: "Visibilite dans le catalogue", showProgressPercentage: "Affichage de la progression", notifyMembersOnModuleRelease: "E-mail de publication du module" },
    draftCreated: "Brouillon du cours cree", noPublishedVersion: "Aucune version publiee", changed: (label) => `${label} modifie`, courseInformation: "Informations du cours", fallback: { goal: "Objectif pedagogique", author: "Auteur", authorWidget: "Widget auteur", widget: "Widget", module: "Module", section: "Section", lesson: "Lecon", page: "Page", block: "Bloc de contenu" },
    details: { goalRemoved: "Objectif supprime", goalAdded: "Objectif ajoute", textChanged: "Texte modifie", orderChanged: "Ordre modifie", authorRemoved: "Auteur supprime", authorAdded: "Auteur ajoute", authorProfileChanged: "Profil de l'auteur modifie", widgetRemoved: "Widget supprime", widgetAdded: "Widget ajoute", widgetContentChanged: "Contenu du widget modifie", moduleRemoved: "Module supprime", moduleAdded: "Module ajoute", moduleContentChanged: "Contenu du module modifie", moduleTypeChanged: "Type de module modifie", linkedCourseChanged: "Cours cible lie modifie", orderAndIndentChanged: "Ordre et retrait modifies", indentChanged: "Retrait modifie", moduleAccessChanged: "Acces au module modifie", sectionSettingsChanged: "Parametres de section modifies", lessonSettingsChanged: "Parametres de lecon modifies", pageSettingsChanged: "Parametres de page modifies" },
    from: (name) => `Depuis ${name}`, in: (name) => `Dans ${name}`, on: (name) => `Sur ${name}`, blockRemoved: (location) => `Supprime ${location}`, blockAdded: (location) => `Ajoute ${location}`, blockContentChanged: (location) => `Contenu modifie - ${location}`,
  },
};

const COURSE_SUPPORT_COPY: Record<AppLocale, CourseSupportCopy> = {
  de,
  en,
  it,
  es,
  fr,
};

export function getCourseSupportCopy(locale: AppLocale): CourseSupportCopy {
  return COURSE_SUPPORT_COPY[locale];
}

const CATEGORY_COLOR_COPY: Record<
  AppLocale,
  { picker: string; hex: string }
> = {
  de: {
    picker: "Kategoriefarbe auswählen",
    hex: "Kategoriefarbe als Hex-Wert",
  },
  en: { picker: "Select category colour", hex: "Category colour as hex" },
  it: {
    picker: "Seleziona il colore della categoria",
    hex: "Colore categoria in formato esadecimale",
  },
  es: {
    picker: "Seleccionar color de categoria",
    hex: "Color de categoria en formato hexadecimal",
  },
  fr: {
    picker: "Selectionner la couleur de la categorie",
    hex: "Couleur de categorie au format hexadecimal",
  },
};

export function getCourseCategoryColorCopy(locale: AppLocale) {
  return CATEGORY_COLOR_COPY[locale];
}

const CATEGORY_ACTION_COPY: Record<
  AppLocale,
  {
    moveUp: (name: string) => string;
    moveDown: (name: string) => string;
    edit: (name: string) => string;
    delete: (name: string) => string;
  }
> = {
  de: {
    moveUp: (name) => `${name} nach oben verschieben`,
    moveDown: (name) => `${name} nach unten verschieben`,
    edit: (name) => `${name} bearbeiten`,
    delete: (name) => `${name} löschen`,
  },
  en: {
    moveUp: (name) => `Move ${name} up`,
    moveDown: (name) => `Move ${name} down`,
    edit: (name) => `Edit ${name}`,
    delete: (name) => `Delete ${name}`,
  },
  it: {
    moveUp: (name) => `Sposta ${name} in alto`,
    moveDown: (name) => `Sposta ${name} in basso`,
    edit: (name) => `Modifica ${name}`,
    delete: (name) => `Elimina ${name}`,
  },
  es: {
    moveUp: (name) => `Mover ${name} arriba`,
    moveDown: (name) => `Mover ${name} abajo`,
    edit: (name) => `Editar ${name}`,
    delete: (name) => `Eliminar ${name}`,
  },
  fr: {
    moveUp: (name) => `Monter ${name}`,
    moveDown: (name) => `Descendre ${name}`,
    edit: (name) => `Modifier ${name}`,
    delete: (name) => `Supprimer ${name}`,
  },
};

export function getCourseCategoryActionCopy(locale: AppLocale) {
  return CATEGORY_ACTION_COPY[locale];
}

const CATEGORY_DELETION_USAGE_COPY: Record<
  AppLocale,
  (count: string) => string
> = {
  de: (count) =>
    `Die Kategorie ist ${count} ${count === "1" ? "Kurs" : "Kursen"} zugewiesen. Die Kurse bleiben vollstaendig erhalten und werden auf \"Ohne Kategorie\" gesetzt.`,
  en: (count) =>
    `${count} ${count === "1" ? "course uses" : "courses use"} this category. All courses remain intact and will be set to \"No category\".`,
  it: (count) =>
    `${count} ${count === "1" ? "corso usa" : "corsi usano"} questa categoria. Tutti i corsi restano invariati e passeranno a \"Senza categoria\".`,
  es: (count) =>
    `${count} ${count === "1" ? "curso usa" : "cursos usan"} esta categoria. Todos los cursos se conservan y pasaran a \"Sin categoria\".`,
  fr: (count) =>
    `${count} ${count === "1" ? "cours utilise" : "cours utilisent"} cette categorie. Tous les cours restent intacts et passeront a \"Sans categorie\".`,
};

export function getCourseCategoryDeletionUsageCopy(
  locale: AppLocale,
  count: string,
) {
  return CATEGORY_DELETION_USAGE_COPY[locale](count);
}

const AI_BRIEF_UNSAFE_INPUT_COPY: Record<AppLocale, string> = {
  de: "Bitte keine Steueranweisungen, Zugangsdaten oder Geheimnisse eingeben.",
  en: "Do not enter control instructions, credentials or secrets.",
  it: "Non inserire istruzioni di controllo, credenziali o segreti.",
  es: "No introduzcas instrucciones de control, credenciales ni secretos.",
  fr: "Ne saisissez pas d'instructions de controle, d'identifiants ou de secrets.",
};

export function getAiBriefUnsafeInputCopy(locale: AppLocale) {
  return AI_BRIEF_UNSAFE_INPUT_COPY[locale];
}

const AI_COURSE_DRAFT_FOLDER_COPY: Record<AppLocale, string> = {
  de: "KI-Kursentwuerfe",
  en: "AI course drafts",
  it: "Bozze di corsi IA",
  es: "Borradores de cursos de IA",
  fr: "Brouillons de cours IA",
};

export function getAiCourseDraftFolderCopy(locale: AppLocale) {
  return AI_COURSE_DRAFT_FOLDER_COPY[locale];
}
