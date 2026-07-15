import type { AppLocale } from "@/lib/i18n/model";

export type CourseBuilderCopy = {
  backToCourses: string;
  uncategorized: string;
  status: Record<"draft" | "published" | "archived", string>;
  modules: (count: number) => string;
  teamPermissions: string;
  moduleAccess: string;
  memberPreview: string;
  moveToDraft: string;
  tabs: Record<"content" | "information" | "widgets" | "access" | "analytics" | "submissions", string>;
  editorAreas: string;
  unpublishedChanges: (tab: string) => string;
  courseStructure: string;
  structureSummary: (modules: number, lessons: number) => string;
  createModule: string;
  preview: string;
  lesson: string;
  save: string;
  chooseLesson: string;
  common: {
    closeDialog: string;
    cancel: string;
    saving: string;
    delete: string;
    add: string;
    edit: string;
    module: string;
    section: string;
    lesson: string;
    page: string;
    pages: (count: number) => string;
    lessons: (count: number) => string;
    version: (version: number) => string;
    active: string;
    draft: string;
    archived: string;
    published: string;
    visible: string;
    hidden: string;
    comingSoon: string;
    available: string;
    readOnly: string;
    locked: string;
    noLimit: string;
    all: string;
    none: string;
  };
  palette: Record<
    | "ai_agent"
    | "eyebrow"
    | "heading"
    | "text"
    | "rich_text"
    | "button"
    | "gallery"
    | "callout"
    | "quote"
    | "divider"
    | "accordion"
    | "tabs"
    | "columns"
    | "code"
    | "table"
    | "download"
    | "data_form"
    | "info"
    | "checklist"
    | "image"
    | "video"
    | "audio"
    | "file"
    | "embed"
    | "multiple_choice"
    | "true_false"
    | "multi_select"
    | "fill_blank"
    | "ordering"
    | "submission",
    string
  >;
  block: {
    deleteDialogLabel: string;
    deleteTitle: string;
    deleteDescription: (title: string) => string;
    fallbackElement: string;
    optionA: string;
    optionB: string;
    option: (index: number) => string;
    agent: string;
    previousAgentUnavailable: string;
    noPublishedAgent: string;
    label: string;
    defaultLearnMore: string;
    linkTarget: string;
    linkHint: string;
    display: string;
    primaryButton: string;
    secondaryButton: string;
    textLink: string;
    defaultDownloadLabel: string;
    file: string;
    fileName: string;
    downloadAssetHint: string;
    download: string;
    defaultDownloadFileName: string;
    description: string;
    title: string;
    defaultForm: string;
    dataForm: string;
    noActiveForm: string;
    kicker: string;
    heading: string;
    text: string;
    defaultInfo: string;
    infoText: string;
    accentColor: string;
    teal: string;
    navy: string;
    coral: string;
    gold: string;
    defaultChecklist: string;
    checklistItems: string;
    oneItemPerLine: string;
    completionRequired: string;
    media: Record<"image" | "video" | "audio" | "file" | "embed", string>;
    embedUrl: string;
    httpLinksOnly: string;
    mediaSource: (label: string) => string;
    defaultCourseMaterial: string;
    imageCaption: string;
    defaultFillBlank: string;
    gapQuestion: string;
    acceptedAnswers: string;
    equivalentAnswerPerLine: string;
    caseSensitive: string;
    evaluationFeedback: string;
    feedbackSecurity: string;
    requiredToComplete: string;
    defaultOrdering: string;
    task: string;
    correctOrder: string;
    defaultMultiSelect: string;
    question: string;
    answerOptions: string;
    oneOptionPerLine: string;
    correctAnswers: string;
    true: string;
    false: string;
    defaultKnowledgeCheck: string;
    correctAnswer: string;
    feedbackPlaceholder: string;
    defaultSubmission: string;
    workAssignment: string;
    submissionRequired: string;
    required: string;
    feedbackPrefix: string;
    freeTextAnswer: string;
    acceptedAnswerCount: (count: number) => string;
    unavailableAgent: string;
    learningCoach: string;
    knowledgeAssistant: string;
    formAssistant: string;
    choosePublishedAgent: string;
    chooseDataForm: string;
    defaultCourseImage: string;
    missingImageUrl: string;
    missingVideoUrl: string;
    missingAudioUrl: string;
    linkedFile: string;
    missingFileUrl: string;
    embedPreview: string;
    missingEmbedUrl: string;
    move: string;
    duplicate: string;
  };
  structure: {
    pageTitle: string;
    pageNavigationHint: string;
    syncLessonTitle: string;
    moduleType: string;
    learningModule: string;
    exam: string;
    courseLink: string;
    targetCourse: string;
    targetCourseHint: string;
    chooseTargetCourse: string;
    linkTitle: string;
    moduleTitle: string;
    description: string;
    folder: string;
    defaultFolder: string;
    durationMinutes: string;
    reusableModule: string;
    agentsLoadError: string;
    saveError: string;
    sharedInCourses: (count: number) => string;
    reusable: string;
    level: (level: number) => string;
    outdent: string;
    indent: string;
    removeFromCourse: string;
    examSection: string;
    noSection: string;
    focusedExam: string;
    noModule: string;
    createFirstModule: string;
    editor: string;
    sharedModule: string;
    openTargetCourse: string;
    sharedModuleDescription: string;
    examNeedsTask: string;
    gradableTasks: (count: number) => string;
    allGradableRequired: string;
    examTitle: string;
    lessonTitle: string;
    lessonStatus: string;
    visibility: string;
    availableFrom: string;
    examSettings: string;
    activeAfterPublish: string;
    passingScore: string;
    maxAttempts: string;
    shuffleQuestions: string;
    examFlow: string;
    automaticQuestions: string;
    randomQuestions: (total: number) => string;
    timeLimitMinutes: string;
    resultRelease: string;
    immediate: string;
    afterDeadline: string;
    manual: string;
    reviewRelease: string;
    never: string;
    afterResult: string;
    contentAccess: string;
    allow: string;
    blockCourse: string;
    blockAcademy: string;
    reload: string;
    quickPageNavigation: string;
    mainContent: string;
    newPage: string;
    pageWidth: string;
    narrow: string;
    standard: string;
    wide: string;
    background: string;
    neutral: string;
    light: string;
    contrast: string;
    spacing: string;
    compact: string;
    comfortable: string;
    spacious: string;
    movePageUp: string;
    up: string;
    movePageDown: string;
    down: string;
    duplicatePage: string;
    hidePage: string;
    showPage: string;
    unsyncTitle: string;
    onlyFirstPageSync: string;
    emptyPage: string;
    emptyMainContent: string;
    addContentHint: string;
    linkModule: string;
    examBlocks: string;
    contentBlocks: string;
    noLearningContent: string;
    activeMainContent: string;
    pageArea: (title: string) => string;
    elementsInArea: (count: number) => string;
  };
  information: {
    title: string;
    description: string;
    courseTitle: string;
    category: string;
    shortDescription: string;
    longDescription: string;
    difficulty: string;
    estimatedDuration: string;
    coverUrl: string;
    certificateEnabled: string;
    featured: string;
    showInMemberOverview: string;
    showProgress: string;
    emailModuleReleases: string;
    scope: string;
    modules: string;
    lessons: string;
    lessonPages: string;
    duration: string;
    certificateOn: string;
    certificateOff: string;
  };
  access: {
    title: string;
    description: string;
    manageMembers: string;
    enrolled: string;
    activeAccess: (count: number) => string;
    inactive: string;
    progressPreserved: string;
    assignments: string;
    directAndGroups: (direct: number, groups: number) => string;
    viaBundles: string;
    activeBundlePaths: string;
    module: string;
    releaseMode: string;
    immediatelyVisible: string;
    afterPreviousModule: string;
    afterDays: string;
    dateWindow: string;
    releaseAfterDays: string;
    untilThen: string;
    showLocked: string;
    hide: string;
    outsideWindow: string;
    windowStart: string;
    windowEnd: string;
    insideWindow: string;
    requestable: string;
    linkNotProgress: string;
    requiredModule: string;
    status: string;
    visibility: string;
    lessonsInOrder: string;
  };
  analytics: {
    title: string;
    description: string;
    allAnalytics: string;
    activeLearners: string;
    totalEnrollments: (count: number) => string;
    average: string;
    activeProgressDetail: string;
    completed: string;
    currentlyInProgress: (count: number) => string;
    notStarted: string;
    inactiveAccess: (count: number) => string;
    distribution: string;
    inProgress: string;
    submissions: string;
    submissionSummary: (open: number, approved: number) => string;
    taskCenter: string;
  };
  submissionsView: {
    title: string;
    description: string;
    manageAll: string;
    submission: string;
    member: string;
    date: string;
    status: string;
    points: string;
    graded: string;
    revision: string;
    open: string;
    empty: string;
    emptyDescription: string;
  };
  dialogs: {
    createModule: string;
    existingModule: string;
    sharedContent: string;
    reusableModule: string;
    newModule: string;
    createSection: string;
    sectionTitle: string;
    createLesson: string;
    lessonTitle: string;
    type: string;
    quiz: string;
    submission: string;
    summary: string;
    createPage: string;
    embedAgent: string;
    agentStudio: string;
    agentsLoading: string;
    editBlock: string;
    saveChanges: string;
    blockWidth: string;
    contentWidth: string;
    fullWidth: string;
    alignment: string;
    left: string;
    centered: string;
    surface: string;
    borderless: string;
    bordered: string;
    muted: string;
  };
};

type CourseBuilderExtras = Pick<
  CourseBuilderCopy,
  | "common"
  | "palette"
  | "block"
  | "structure"
  | "information"
  | "access"
  | "analytics"
  | "submissionsView"
  | "dialogs"
>;

const deExtras: CourseBuilderExtras = {
  common: {
    closeDialog: "Dialog schliessen",
    cancel: "Abbrechen",
    saving: "Wird gespeichert",
    delete: "Loeschen",
    add: "Hinzufuegen",
    edit: "Bearbeiten",
    module: "Modul",
    section: "Sektion",
    lesson: "Lektion",
    page: "Seite",
    pages: (count) => `${count} ${count === 1 ? "Seite" : "Seiten"}`,
    lessons: (count) => `${count} Lektionen`,
    version: (version) => `Version ${version}`,
    active: "Aktiv",
    draft: "Entwurf",
    archived: "Archiviert",
    published: "Veroeffentlicht",
    visible: "Sichtbar",
    hidden: "Verborgen",
    comingSoon: "Erscheint bald",
    available: "Verfuegbar",
    readOnly: "Nur lesen",
    locked: "Gesperrt",
    noLimit: "Kein Limit",
    all: "Alle",
    none: "Ohne",
  },
  palette: {
    ai_agent: "KI-Agent",
    eyebrow: "Kicker",
    heading: "Ueberschrift",
    text: "Text",
    rich_text: "Rich-Text",
    button: "Button / Link",
    gallery: "Galerie",
    callout: "Callout",
    quote: "Zitat",
    divider: "Trenner",
    accordion: "Accordion",
    tabs: "Tabs",
    columns: "Spalten",
    code: "Code",
    table: "Tabelle",
    download: "Download",
    data_form: "Formular",
    info: "Hinweis",
    checklist: "Checkliste",
    image: "Bild",
    video: "Video",
    audio: "Audio",
    file: "Datei",
    embed: "Embed",
    multiple_choice: "Multiple Choice",
    true_false: "Wahr / Falsch",
    multi_select: "Mehrfachauswahl",
    fill_blank: "Lueckentext",
    ordering: "Sortieren",
    submission: "Abgabe",
  },
  block: {
    deleteDialogLabel: "Inhaltselement loeschen",
    deleteTitle: "Inhaltselement loeschen?",
    deleteDescription: (title) => `${title} wird dauerhaft aus der Lektion entfernt.`,
    fallbackElement: "Dieses Inhaltselement",
    optionA: "Option A",
    optionB: "Option B",
    option: (index) => `Option ${index}`,
    agent: "KI-Agent",
    previousAgentUnavailable: "Bisheriger Agent ist nicht mehr verfuegbar",
    noPublishedAgent: "Kein aktiv veroeffentlichter Agent",
    label: "Beschriftung",
    defaultLearnMore: "Mehr erfahren",
    linkTarget: "Link-Ziel",
    linkHint: "Erlaubt sind HTTP(S)-Links sowie interne Pfade und Sprungmarken.",
    display: "Darstellung",
    primaryButton: "Primaerer Button",
    secondaryButton: "Sekundaerer Button",
    textLink: "Textlink",
    defaultDownloadLabel: "Kursmaterial herunterladen",
    file: "Datei",
    fileName: "Dateiname",
    downloadAssetHint: "Downloads muessen als geprueftes Kurs-Asset hochgeladen werden.",
    download: "Download",
    defaultDownloadFileName: "Kursmaterial.pdf",
    description: "Beschreibung",
    title: "Titel",
    defaultForm: "Formular",
    dataForm: "Datenformular",
    noActiveForm: "Kein aktives Formular",
    kicker: "Kicker",
    heading: "Ueberschrift",
    text: "Text",
    defaultInfo: "Hinweis",
    infoText: "Hinweistext",
    accentColor: "Akzentfarbe",
    teal: "Tuerkis",
    navy: "Dunkelblau",
    coral: "Koralle",
    gold: "Gold",
    defaultChecklist: "Checkliste",
    checklistItems: "Checklistenpunkte",
    oneItemPerLine: "Ein Punkt pro Zeile.",
    completionRequired: "Bearbeitung ist verpflichtend",
    media: { image: "Bild", video: "Video", audio: "Audio", file: "Datei", embed: "Einbettung" },
    embedUrl: "Einbettung-URL",
    httpLinksOnly: "Nur HTTP(S)-Links sind erlaubt.",
    mediaSource: (label) => `${label}-Quelle`,
    defaultCourseMaterial: "Kursmaterial",
    imageCaption: "Bildunterschrift",
    defaultFillBlank: "Lueckentext",
    gapQuestion: "Frage mit Luecke",
    acceptedAnswers: "Akzeptierte Antworten",
    equivalentAnswerPerLine: "Eine gleichwertige Antwort pro Zeile.",
    caseSensitive: "Gross- und Kleinschreibung unterscheiden",
    evaluationFeedback: "Feedback nach der Abgabe",
    feedbackSecurity: "Wird niemals vor der serverseitigen Auswertung ausgeliefert.",
    requiredToComplete: "Muss zum Abschluss bestanden werden",
    defaultOrdering: "Sortieraufgabe",
    task: "Aufgabe",
    correctOrder: "Elemente in korrekter Reihenfolge",
    defaultMultiSelect: "Mehrfachauswahl",
    question: "Frage",
    answerOptions: "Antwortoptionen",
    oneOptionPerLine: "Eine Option pro Zeile.",
    correctAnswers: "Korrekte Antworten",
    true: "Richtig",
    false: "Falsch",
    defaultKnowledgeCheck: "Wissenscheck",
    correctAnswer: "Korrekte Antwort",
    feedbackPlaceholder: "Kurze Erklaerung zur richtigen Loesung",
    defaultSubmission: "Abgabe",
    workAssignment: "Arbeitsauftrag",
    submissionRequired: "Abgabe ist verpflichtend",
    required: "Pflicht",
    feedbackPrefix: "Feedback:",
    freeTextAnswer: "Freitextantwort",
    acceptedAnswerCount: (count) => `${count} akzeptierte Antwort(en)`,
    unavailableAgent: "KI-Agent nicht mehr verfuegbar",
    learningCoach: "Lerncoach",
    knowledgeAssistant: "Wissensassistent",
    formAssistant: "Formularassistent",
    choosePublishedAgent: "Bitte einen aktiv veroeffentlichten Agenten auswaehlen.",
    chooseDataForm: "Datenformular auswaehlen",
    defaultCourseImage: "Kursbild",
    missingImageUrl: "Bild-URL ergaenzen",
    missingVideoUrl: "Video-URL ergaenzen",
    missingAudioUrl: "Audio-URL ergaenzen",
    linkedFile: "Datei verknuepft",
    missingFileUrl: "Datei-URL ergaenzen",
    embedPreview: "Einbettung",
    missingEmbedUrl: "Embed-URL ergaenzen",
    move: "Inhaltselement verschieben",
    duplicate: "Inhaltselement duplizieren",
  },
  structure: {
    pageTitle: "Seitentitel",
    pageNavigationHint: "Mitglieder navigieren in dieser Reihenfolge durch die Lektionsseiten.",
    syncLessonTitle: "Mit Lektionstitel synchronisieren",
    moduleType: "Modultyp",
    learningModule: "Lernmodul",
    exam: "Pruefung",
    courseLink: "Kurs-Link",
    targetCourse: "Zielkurs",
    targetCourseHint: "Der Link uebernimmt keine Zugriffsrechte des Zielkurses.",
    chooseTargetCourse: "Zielkurs waehlen",
    linkTitle: "Linktitel",
    moduleTitle: "Modultitel",
    description: "Beschreibung",
    folder: "Ordner",
    defaultFolder: "Allgemein",
    durationMinutes: "Dauer (Minuten)",
    reusableModule: "Modul darf in weiteren Kursen verwendet werden",
    agentsLoadError: "KI-Agenten konnten nicht geladen werden.",
    saveError: "Die Aenderung konnte nicht gespeichert werden.",
    sharedInCourses: (count) => `In ${count} Kursen geteilt`,
    reusable: "Wiederverwendbar",
    level: (level) => `Ebene ${level}`,
    outdent: "Ausruecken",
    indent: "Einruecken",
    removeFromCourse: "Aus Kurs entfernen",
    examSection: "Pruefung",
    noSection: "Ohne Sektion",
    focusedExam: "Fokussierter Pruefungsaufbau",
    noModule: "Noch kein Modul",
    createFirstModule: "Erstes Modul anlegen",
    editor: "Editor",
    sharedModule: "Geteiltes Modul",
    openTargetCourse: "Zielkurs",
    sharedModuleDescription: "Aenderungen an diesem Modul erscheinen in allen Kursen, die es verwenden.",
    examNeedsTask: "Vor der Veroeffentlichung mindestens eine bewertbare Aufgabe hinzufuegen.",
    gradableTasks: (count) => `${count} bewertbare ${count === 1 ? "Aufgabe" : "Aufgaben"} im Pruefungsablauf.`,
    allGradableRequired: "Alle bewertbaren Aufgaben muessen verpflichtend sein.",
    examTitle: "Pruefungstitel",
    lessonTitle: "Lektionstitel",
    lessonStatus: "Lektionsstatus",
    visibility: "Sichtbarkeit",
    availableFrom: "Verfuegbar ab",
    examSettings: "Pruefungseinstellungen",
    activeAfterPublish: "Werden erst mit der naechsten Veroeffentlichung aktiv.",
    passingScore: "Bestehen ab (%)",
    maxAttempts: "Max. Versuche",
    shuffleQuestions: "Fragen je Versuch mischen",
    examFlow: "Pruefungsablauf",
    automaticQuestions: "automatische Fragen",
    randomQuestions: (total) => `Zufallsfragen (von ${total})`,
    timeLimitMinutes: "Zeitlimit (Minuten)",
    resultRelease: "Ergebnisfreigabe",
    immediate: "Sofort",
    afterDeadline: "Nach Zeitablauf",
    manual: "Manuell",
    reviewRelease: "Einsicht",
    never: "Nie",
    afterResult: "Nach Ergebnisfreigabe",
    contentAccess: "Inhaltszugriff",
    allow: "Erlauben",
    blockCourse: "Kurs blockieren",
    blockAcademy: "Academy blockieren",
    reload: "Neu laden",
    quickPageNavigation: "Schnellnavigation zu einer Lektionsseite",
    mainContent: "Hauptinhalt",
    newPage: "Neue Seite",
    pageWidth: "Seitenbreite",
    narrow: "Schmal",
    standard: "Standard",
    wide: "Breit",
    background: "Hintergrund",
    neutral: "Neutral",
    light: "Leicht",
    contrast: "Kontrast",
    spacing: "Abstand",
    compact: "Kompakt",
    comfortable: "Komfortabel",
    spacious: "Grosszuegig",
    movePageUp: "Seite nach oben verschieben",
    up: "Nach oben",
    movePageDown: "Seite nach unten verschieben",
    down: "Nach unten",
    duplicatePage: "Seite duplizieren",
    hidePage: "Seite ausblenden",
    showPage: "Seite einblenden",
    unsyncTitle: "Titelsynchronisierung aufheben",
    onlyFirstPageSync: "Nur die erste Seite kann synchronisiert werden",
    emptyPage: "Diese Seite ist noch leer",
    emptyMainContent: "Der Hauptinhalt ist noch leer",
    addContentHint: "Fuege rechts ein Inhaltselement hinzu.",
    linkModule: "Link-Modul",
    examBlocks: "Pruefungsbausteine",
    contentBlocks: "Inhaltselemente",
    noLearningContent: "Keine Lerninhalte",
    activeMainContent: "Aktiver Bereich: Hauptinhalt",
    pageArea: (title) => `Seite: ${title}`,
    elementsInArea: (count) => `${count} Elemente in diesem Bereich`,
  },
  information: {
    title: "Kursinformationen",
    description: "Diese Angaben erscheinen im Kurskatalog und Mitgliederbereich.",
    courseTitle: "Titel",
    category: "Kategorie",
    shortDescription: "Kurzbeschreibung",
    longDescription: "Ausfuehrliche Beschreibung",
    difficulty: "Schwierigkeitsgrad",
    estimatedDuration: "Geschaetzte Dauer (Minuten)",
    coverUrl: "Titelbild-URL",
    certificateEnabled: "Zertifikat aktivieren",
    featured: "Im Katalog hervorheben",
    showInMemberOverview: "In Mitglieder-Kursuebersicht anzeigen",
    showProgress: "Prozentualen Fortschritt anzeigen",
    emailModuleReleases: "Bei neuen Modulfreigaben automatisch per E-Mail informieren",
    scope: "Kursumfang",
    modules: "Module",
    lessons: "Lektionen",
    lessonPages: "Lektionsseiten",
    duration: "Dauer",
    certificateOn: "Nach erfolgreichem Abschluss wird ein Zertifikat ausgestellt.",
    certificateOff: "Fuer diesen Kurs ist kein Zertifikat aktiviert.",
  },
  access: {
    title: "Zugang und Freischaltung",
    description: "Pflichtmodule und zeitversetzte Freigaben gelten nur in diesem Kurs.",
    manageMembers: "Mitglieder verwalten",
    enrolled: "Eingeschrieben",
    activeAccess: (count) => `${count} mit aktivem Zugang`,
    inactive: "Inaktiv",
    progressPreserved: "Fortschritt bleibt erhalten",
    assignments: "Zuweisungen",
    directAndGroups: (direct, groups) => `${direct} direkt | ${groups} Gruppen`,
    viaBundles: "Ueber Bundles",
    activeBundlePaths: "Aktive Bundle-Zugriffswege",
    module: "Modul",
    releaseMode: "Freigabemodus",
    immediatelyVisible: "Sofort sichtbar",
    afterPreviousModule: "Nach vorherigem Modul",
    afterDays: "Nach Tagen",
    dateWindow: "Datumsfenster",
    releaseAfterDays: "Freigabe nach Tagen",
    untilThen: "Bis dahin",
    showLocked: "Gesperrt anzeigen",
    hide: "Verbergen",
    outsideWindow: "Ausserhalb Zeitraum",
    windowStart: "Zeitraum ab",
    windowEnd: "Zeitraum bis",
    insideWindow: "Innerhalb Zeitraum",
    requestable: "Zugriff anfragbar",
    linkNotProgress: "Link-Module zaehlen nicht zum Kursfortschritt.",
    requiredModule: "Pflichtmodul",
    status: "Status",
    visibility: "Sichtbarkeit",
    lessonsInOrder: "Lektionen der Reihe nach",
  },
  analytics: {
    title: "Kursstatistik",
    description: "Live-Werte aus Einschreibungen und Lernfortschritt.",
    allAnalytics: "Alle Analysen",
    activeLearners: "Aktive Lernende",
    totalEnrollments: (count) => `${count} Einschreibungen gesamt`,
    average: "Durchschnitt",
    activeProgressDetail: "Fortschritt aktiver Lernender",
    completed: "Abgeschlossen",
    currentlyInProgress: (count) => `${count} aktuell in Bearbeitung`,
    notStarted: "Noch nicht begonnen",
    inactiveAccess: (count) => `${count} Zugriffe inaktiv`,
    distribution: "Fortschrittsverteilung",
    inProgress: "In Bearbeitung",
    submissions: "Abgaben",
    submissionSummary: (open, approved) => `${open} offen | ${approved} bewertet`,
    taskCenter: "Zum Aufgaben-Center",
  },
  submissionsView: {
    title: "Letzte Abgaben",
    description: "Die neuesten Einreichungen in diesem Kurs.",
    manageAll: "Alle Abgaben bearbeiten",
    submission: "Abgabe",
    member: "Mitglied",
    date: "Datum",
    status: "Status",
    points: "Punkte",
    graded: "Bewertet",
    revision: "Ueberarbeitung",
    open: "Offen",
    empty: "Noch keine Abgaben",
    emptyDescription: "Abgaben aus diesem Kurs erscheinen hier automatisch.",
  },
  dialogs: {
    createModule: "Modul anlegen",
    existingModule: "Vorhandenes Modul verwenden",
    sharedContent: "Inhalte bleiben in allen Kursen synchron.",
    reusableModule: "Wiederverwendbares Modul",
    newModule: "Neues Modul",
    createSection: "Sektion anlegen",
    sectionTitle: "Sektionstitel",
    createLesson: "Lektion anlegen",
    lessonTitle: "Lektionstitel",
    type: "Typ",
    quiz: "Quiz",
    submission: "Abgabe",
    summary: "Zusammenfassung",
    createPage: "Lektionsseite anlegen",
    embedAgent: "KI-Agent einbetten",
    agentStudio: "Agent Studio",
    agentsLoading: "Agenten werden geladen",
    editBlock: "Inhaltselement bearbeiten",
    saveChanges: "Aenderungen speichern",
    blockWidth: "Blockbreite",
    contentWidth: "Inhaltsbreite",
    fullWidth: "Volle Breite",
    alignment: "Ausrichtung",
    left: "Links",
    centered: "Zentriert",
    surface: "Flaeche",
    borderless: "Ohne",
    bordered: "Umrandet",
    muted: "Hinterlegt",
  },
};

const enExtras: CourseBuilderExtras = {
  common: {
    closeDialog: "Close dialog",
    cancel: "Cancel",
    saving: "Saving",
    delete: "Delete",
    add: "Add",
    edit: "Edit",
    module: "Module",
    section: "Section",
    lesson: "Lesson",
    page: "Page",
    pages: (count) => `${count} ${count === 1 ? "page" : "pages"}`,
    lessons: (count) => `${count} lessons`,
    version: (version) => `Version ${version}`,
    active: "Active",
    draft: "Draft",
    archived: "Archived",
    published: "Published",
    visible: "Visible",
    hidden: "Hidden",
    comingSoon: "Coming soon",
    available: "Available",
    readOnly: "Read only",
    locked: "Locked",
    noLimit: "No limit",
    all: "All",
    none: "None",
  },
  palette: {
    ai_agent: "AI agent",
    eyebrow: "Eyebrow",
    heading: "Heading",
    text: "Text",
    rich_text: "Rich text",
    button: "Button / link",
    gallery: "Gallery",
    callout: "Callout",
    quote: "Quote",
    divider: "Divider",
    accordion: "Accordion",
    tabs: "Tabs",
    columns: "Columns",
    code: "Code",
    table: "Table",
    download: "Download",
    data_form: "Form",
    info: "Information",
    checklist: "Checklist",
    image: "Image",
    video: "Video",
    audio: "Audio",
    file: "File",
    embed: "Embed",
    multiple_choice: "Multiple choice",
    true_false: "True / false",
    multi_select: "Multiple selection",
    fill_blank: "Fill in the blank",
    ordering: "Ordering",
    submission: "Submission",
  },
  block: {
    deleteDialogLabel: "Delete content block",
    deleteTitle: "Delete content block?",
    deleteDescription: (title) => `${title} will be permanently removed from the lesson.`,
    fallbackElement: "This content block",
    optionA: "Option A",
    optionB: "Option B",
    option: (index) => `Option ${index}`,
    agent: "AI agent",
    previousAgentUnavailable: "The previous agent is no longer available",
    noPublishedAgent: "No active published agent",
    label: "Label",
    defaultLearnMore: "Learn more",
    linkTarget: "Link target",
    linkHint: "HTTP(S) links, internal paths and anchors are allowed.",
    display: "Appearance",
    primaryButton: "Primary button",
    secondaryButton: "Secondary button",
    textLink: "Text link",
    defaultDownloadLabel: "Download course material",
    file: "File",
    fileName: "File name",
    downloadAssetHint: "Downloads must be uploaded as a verified course asset.",
    download: "Download",
    defaultDownloadFileName: "course-material.pdf",
    description: "Description",
    title: "Title",
    defaultForm: "Form",
    dataForm: "Data form",
    noActiveForm: "No active form",
    kicker: "Eyebrow",
    heading: "Heading",
    text: "Text",
    defaultInfo: "Information",
    infoText: "Information text",
    accentColor: "Accent colour",
    teal: "Teal",
    navy: "Navy",
    coral: "Coral",
    gold: "Gold",
    defaultChecklist: "Checklist",
    checklistItems: "Checklist items",
    oneItemPerLine: "One item per line.",
    completionRequired: "Completion is required",
    media: { image: "Image", video: "Video", audio: "Audio", file: "File", embed: "Embed" },
    embedUrl: "Embed URL",
    httpLinksOnly: "Only HTTP(S) links are allowed.",
    mediaSource: (label) => `${label} source`,
    defaultCourseMaterial: "Course material",
    imageCaption: "Image caption",
    defaultFillBlank: "Fill in the blank",
    gapQuestion: "Question with blank",
    acceptedAnswers: "Accepted answers",
    equivalentAnswerPerLine: "One equivalent answer per line.",
    caseSensitive: "Match upper and lower case",
    evaluationFeedback: "Feedback after submission",
    feedbackSecurity: "Never shown before server-side evaluation.",
    requiredToComplete: "Must be passed to complete",
    defaultOrdering: "Ordering task",
    task: "Task",
    correctOrder: "Items in the correct order",
    defaultMultiSelect: "Multiple selection",
    question: "Question",
    answerOptions: "Answer options",
    oneOptionPerLine: "One option per line.",
    correctAnswers: "Correct answers",
    true: "True",
    false: "False",
    defaultKnowledgeCheck: "Knowledge check",
    correctAnswer: "Correct answer",
    feedbackPlaceholder: "Brief explanation of the correct solution",
    defaultSubmission: "Submission",
    workAssignment: "Assignment",
    submissionRequired: "Submission is required",
    required: "Required",
    feedbackPrefix: "Feedback:",
    freeTextAnswer: "Free-text answer",
    acceptedAnswerCount: (count) => `${count} accepted answer(s)`,
    unavailableAgent: "AI agent is no longer available",
    learningCoach: "Learning coach",
    knowledgeAssistant: "Knowledge assistant",
    formAssistant: "Form assistant",
    choosePublishedAgent: "Select an active published agent.",
    chooseDataForm: "Select a data form",
    defaultCourseImage: "Course image",
    missingImageUrl: "Add an image URL",
    missingVideoUrl: "Add a video URL",
    missingAudioUrl: "Add an audio URL",
    linkedFile: "File linked",
    missingFileUrl: "Add a file URL",
    embedPreview: "Embed",
    missingEmbedUrl: "Add an embed URL",
    move: "Move content block",
    duplicate: "Duplicate content block",
  },
  structure: {
    pageTitle: "Page title",
    pageNavigationHint: "Members navigate lesson pages in this order.",
    syncLessonTitle: "Sync with lesson title",
    moduleType: "Module type",
    learningModule: "Learning module",
    exam: "Exam",
    courseLink: "Course link",
    targetCourse: "Target course",
    targetCourseHint: "The link does not inherit access rights from the target course.",
    chooseTargetCourse: "Select target course",
    linkTitle: "Link title",
    moduleTitle: "Module title",
    description: "Description",
    folder: "Folder",
    defaultFolder: "General",
    durationMinutes: "Duration (minutes)",
    reusableModule: "Module may be used in other courses",
    agentsLoadError: "AI agents could not be loaded.",
    saveError: "The change could not be saved.",
    sharedInCourses: (count) => `Shared in ${count} courses`,
    reusable: "Reusable",
    level: (level) => `Level ${level}`,
    outdent: "Outdent",
    indent: "Indent",
    removeFromCourse: "Remove from course",
    examSection: "Exam",
    noSection: "No section",
    focusedExam: "Focused exam structure",
    noModule: "No module yet",
    createFirstModule: "Create first module",
    editor: "Editor",
    sharedModule: "Shared module",
    openTargetCourse: "Target course",
    sharedModuleDescription: "Changes to this module appear in every course that uses it.",
    examNeedsTask: "Add at least one graded task before publishing.",
    gradableTasks: (count) => `${count} graded ${count === 1 ? "task" : "tasks"} in the exam flow.`,
    allGradableRequired: "All graded tasks must be required.",
    examTitle: "Exam title",
    lessonTitle: "Lesson title",
    lessonStatus: "Lesson status",
    visibility: "Visibility",
    availableFrom: "Available from",
    examSettings: "Exam settings",
    activeAfterPublish: "Take effect with the next publication.",
    passingScore: "Pass mark (%)",
    maxAttempts: "Maximum attempts",
    shuffleQuestions: "Shuffle questions per attempt",
    examFlow: "Exam flow",
    automaticQuestions: "automatic questions",
    randomQuestions: (total) => `Random questions (of ${total})`,
    timeLimitMinutes: "Time limit (minutes)",
    resultRelease: "Result release",
    immediate: "Immediately",
    afterDeadline: "After time expires",
    manual: "Manual",
    reviewRelease: "Review access",
    never: "Never",
    afterResult: "After result release",
    contentAccess: "Content access",
    allow: "Allow",
    blockCourse: "Block course",
    blockAcademy: "Block academy",
    reload: "Reload",
    quickPageNavigation: "Quick navigation to a lesson page",
    mainContent: "Main content",
    newPage: "New page",
    pageWidth: "Page width",
    narrow: "Narrow",
    standard: "Standard",
    wide: "Wide",
    background: "Background",
    neutral: "Neutral",
    light: "Light",
    contrast: "Contrast",
    spacing: "Spacing",
    compact: "Compact",
    comfortable: "Comfortable",
    spacious: "Spacious",
    movePageUp: "Move page up",
    up: "Up",
    movePageDown: "Move page down",
    down: "Down",
    duplicatePage: "Duplicate page",
    hidePage: "Hide page",
    showPage: "Show page",
    unsyncTitle: "Stop syncing title",
    onlyFirstPageSync: "Only the first page can be synced",
    emptyPage: "This page is empty",
    emptyMainContent: "The main content is empty",
    addContentHint: "Add a content block from the right.",
    linkModule: "Link module",
    examBlocks: "Exam blocks",
    contentBlocks: "Content blocks",
    noLearningContent: "No learning content",
    activeMainContent: "Active area: main content",
    pageArea: (title) => `Page: ${title}`,
    elementsInArea: (count) => `${count} elements in this area`,
  },
  information: {
    title: "Course information",
    description: "These details appear in the course catalogue and member area.",
    courseTitle: "Title",
    category: "Category",
    shortDescription: "Short description",
    longDescription: "Full description",
    difficulty: "Difficulty",
    estimatedDuration: "Estimated duration (minutes)",
    coverUrl: "Cover image URL",
    certificateEnabled: "Enable certificate",
    featured: "Feature in catalogue",
    showInMemberOverview: "Show in member course overview",
    showProgress: "Show percentage progress",
    emailModuleReleases: "Automatically email new module releases",
    scope: "Course scope",
    modules: "Modules",
    lessons: "Lessons",
    lessonPages: "Lesson pages",
    duration: "Duration",
    certificateOn: "A certificate is issued after successful completion.",
    certificateOff: "No certificate is enabled for this course.",
  },
  access: {
    title: "Access and release",
    description: "Required modules and delayed releases apply only within this course.",
    manageMembers: "Manage members",
    enrolled: "Enrolled",
    activeAccess: (count) => `${count} with active access`,
    inactive: "Inactive",
    progressPreserved: "Progress is preserved",
    assignments: "Assignments",
    directAndGroups: (direct, groups) => `${direct} direct | ${groups} groups`,
    viaBundles: "Via bundles",
    activeBundlePaths: "Active bundle access paths",
    module: "Module",
    releaseMode: "Release mode",
    immediatelyVisible: "Visible immediately",
    afterPreviousModule: "After previous module",
    afterDays: "After days",
    dateWindow: "Date window",
    releaseAfterDays: "Release after days",
    untilThen: "Until then",
    showLocked: "Show as locked",
    hide: "Hide",
    outsideWindow: "Outside window",
    windowStart: "Window starts",
    windowEnd: "Window ends",
    insideWindow: "Inside window",
    requestable: "Access can be requested",
    linkNotProgress: "Link modules do not count towards course progress.",
    requiredModule: "Required module",
    status: "Status",
    visibility: "Visibility",
    lessonsInOrder: "Lessons in sequence",
  },
  analytics: {
    title: "Course analytics",
    description: "Live values from enrolments and learning progress.",
    allAnalytics: "All analytics",
    activeLearners: "Active learners",
    totalEnrollments: (count) => `${count} enrolments in total`,
    average: "Average",
    activeProgressDetail: "Progress of active learners",
    completed: "Completed",
    currentlyInProgress: (count) => `${count} currently in progress`,
    notStarted: "Not started",
    inactiveAccess: (count) => `${count} inactive access records`,
    distribution: "Progress distribution",
    inProgress: "In progress",
    submissions: "Submissions",
    submissionSummary: (open, approved) => `${open} open | ${approved} graded`,
    taskCenter: "Go to task centre",
  },
  submissionsView: {
    title: "Latest submissions",
    description: "The latest submissions in this course.",
    manageAll: "Manage all submissions",
    submission: "Submission",
    member: "Member",
    date: "Date",
    status: "Status",
    points: "Points",
    graded: "Graded",
    revision: "Revision",
    open: "Open",
    empty: "No submissions yet",
    emptyDescription: "Submissions from this course will appear here automatically.",
  },
  dialogs: {
    createModule: "Create module",
    existingModule: "Use existing module",
    sharedContent: "Content stays synchronised across all courses.",
    reusableModule: "Reusable module",
    newModule: "New module",
    createSection: "Create section",
    sectionTitle: "Section title",
    createLesson: "Create lesson",
    lessonTitle: "Lesson title",
    type: "Type",
    quiz: "Quiz",
    submission: "Submission",
    summary: "Summary",
    createPage: "Create lesson page",
    embedAgent: "Embed AI agent",
    agentStudio: "Agent Studio",
    agentsLoading: "Loading agents",
    editBlock: "Edit content block",
    saveChanges: "Save changes",
    blockWidth: "Block width",
    contentWidth: "Content width",
    fullWidth: "Full width",
    alignment: "Alignment",
    left: "Left",
    centered: "Centred",
    surface: "Surface",
    borderless: "None",
    bordered: "Bordered",
    muted: "Muted",
  },
};

const itExtras: CourseBuilderExtras = {
  common: {
    closeDialog: "Chiudi finestra", cancel: "Annulla", saving: "Salvataggio", delete: "Elimina", add: "Aggiungi", edit: "Modifica", module: "Modulo", section: "Sezione", lesson: "Lezione", page: "Pagina", pages: (count) => `${count} ${count === 1 ? "pagina" : "pagine"}`, lessons: (count) => `${count} lezioni`, version: (version) => `Versione ${version}`, active: "Attivo", draft: "Bozza", archived: "Archiviato", published: "Pubblicato", visible: "Visibile", hidden: "Nascosto", comingSoon: "Prossimamente", available: "Disponibile", readOnly: "Sola lettura", locked: "Bloccato", noLimit: "Nessun limite", all: "Tutte", none: "Nessuno",
  },
  palette: {
    ai_agent: "Agente IA", eyebrow: "Occhiello", heading: "Titolo", text: "Testo", rich_text: "Rich text", button: "Pulsante / link", gallery: "Galleria", callout: "Riquadro", quote: "Citazione", divider: "Separatore", accordion: "Fisarmonica", tabs: "Schede", columns: "Colonne", code: "Codice", table: "Tabella", download: "Download", data_form: "Modulo dati", info: "Informazione", checklist: "Checklist", image: "Immagine", video: "Video", audio: "Audio", file: "File", embed: "Contenuto incorporato", multiple_choice: "Scelta multipla", true_false: "Vero / falso", multi_select: "Selezione multipla", fill_blank: "Testo con lacune", ordering: "Ordinamento", submission: "Consegna",
  },
  block: {
    deleteDialogLabel: "Elimina blocco di contenuto", deleteTitle: "Eliminare il blocco di contenuto?", deleteDescription: (title) => `${title} verrà rimosso definitivamente dalla lezione.`, fallbackElement: "Questo blocco di contenuto", optionA: "Opzione A", optionB: "Opzione B", option: (index) => `Opzione ${index}`, agent: "Agente IA", previousAgentUnavailable: "L'agente precedente non è più disponibile", noPublishedAgent: "Nessun agente attivo pubblicato", label: "Etichetta", defaultLearnMore: "Scopri di più", linkTarget: "Destinazione del link", linkHint: "Sono consentiti link HTTP(S), percorsi interni e ancore.", display: "Aspetto", primaryButton: "Pulsante primario", secondaryButton: "Pulsante secondario", textLink: "Link di testo", defaultDownloadLabel: "Scarica il materiale del corso", file: "File", fileName: "Nome file", downloadAssetHint: "I download devono essere caricati come asset del corso verificati.", download: "Download", defaultDownloadFileName: "materiale-corso.pdf", description: "Descrizione", title: "Titolo", defaultForm: "Modulo", dataForm: "Modulo dati", noActiveForm: "Nessun modulo attivo", kicker: "Occhiello", heading: "Titolo", text: "Testo", defaultInfo: "Informazione", infoText: "Testo informativo", accentColor: "Colore principale", teal: "Turchese", navy: "Blu scuro", coral: "Corallo", gold: "Oro", defaultChecklist: "Checklist", checklistItems: "Elementi della checklist", oneItemPerLine: "Un elemento per riga.", completionRequired: "Il completamento è obbligatorio", media: { image: "Immagine", video: "Video", audio: "Audio", file: "File", embed: "Contenuto incorporato" }, embedUrl: "URL incorporamento", httpLinksOnly: "Sono consentiti solo link HTTP(S).", mediaSource: (label) => `Origine ${label}`, defaultCourseMaterial: "Materiale del corso", imageCaption: "Didascalia immagine", defaultFillBlank: "Testo con lacune", gapQuestion: "Domanda con lacuna", acceptedAnswers: "Risposte accettate", equivalentAnswerPerLine: "Una risposta equivalente per riga.", caseSensitive: "Distingui maiuscole e minuscole", evaluationFeedback: "Feedback dopo la consegna", feedbackSecurity: "Non viene mai mostrato prima della valutazione lato server.", requiredToComplete: "Deve essere superato per completare", defaultOrdering: "Attività di ordinamento", task: "Attività", correctOrder: "Elementi nell'ordine corretto", defaultMultiSelect: "Selezione multipla", question: "Domanda", answerOptions: "Opzioni di risposta", oneOptionPerLine: "Un'opzione per riga.", correctAnswers: "Risposte corrette", true: "Vero", false: "Falso", defaultKnowledgeCheck: "Verifica delle conoscenze", correctAnswer: "Risposta corretta", feedbackPlaceholder: "Breve spiegazione della soluzione corretta", defaultSubmission: "Consegna", workAssignment: "Istruzioni dell'attività", submissionRequired: "La consegna è obbligatoria", required: "Obbligatorio", feedbackPrefix: "Feedback:", freeTextAnswer: "Risposta libera", acceptedAnswerCount: (count) => `${count} risposte accettate`, unavailableAgent: "L'agente IA non è più disponibile", learningCoach: "Coach didattico", knowledgeAssistant: "Assistente della conoscenza", formAssistant: "Assistente per moduli", choosePublishedAgent: "Seleziona un agente attivo pubblicato.", chooseDataForm: "Seleziona un modulo dati", defaultCourseImage: "Immagine del corso", missingImageUrl: "Aggiungi un URL immagine", missingVideoUrl: "Aggiungi un URL video", missingAudioUrl: "Aggiungi un URL audio", linkedFile: "File collegato", missingFileUrl: "Aggiungi un URL file", embedPreview: "Contenuto incorporato", missingEmbedUrl: "Aggiungi un URL da incorporare", move: "Sposta blocco di contenuto", duplicate: "Duplica blocco di contenuto",
  },
  structure: {
    pageTitle: "Titolo pagina", pageNavigationHint: "I membri navigano le pagine della lezione in questo ordine.", syncLessonTitle: "Sincronizza con il titolo della lezione", moduleType: "Tipo di modulo", learningModule: "Modulo didattico", exam: "Esame", courseLink: "Link al corso", targetCourse: "Corso di destinazione", targetCourseHint: "Il link non eredita i diritti di accesso del corso di destinazione.", chooseTargetCourse: "Seleziona corso di destinazione", linkTitle: "Titolo del link", moduleTitle: "Titolo del modulo", description: "Descrizione", folder: "Cartella", defaultFolder: "Generale", durationMinutes: "Durata (minuti)", reusableModule: "Il modulo può essere usato in altri corsi", agentsLoadError: "Impossibile caricare gli agenti IA.", saveError: "Impossibile salvare la modifica.", sharedInCourses: (count) => `Condiviso in ${count} corsi`, reusable: "Riutilizzabile", level: (level) => `Livello ${level}`, outdent: "Riduci rientro", indent: "Aumenta rientro", removeFromCourse: "Rimuovi dal corso", examSection: "Esame", noSection: "Nessuna sezione", focusedExam: "Struttura d'esame focalizzata", noModule: "Nessun modulo", createFirstModule: "Crea il primo modulo", editor: "Editor", sharedModule: "Modulo condiviso", openTargetCourse: "Corso di destinazione", sharedModuleDescription: "Le modifiche a questo modulo appaiono in tutti i corsi che lo utilizzano.", examNeedsTask: "Aggiungi almeno un'attività valutata prima della pubblicazione.", gradableTasks: (count) => `${count} ${count === 1 ? "attività valutata" : "attività valutate"} nel flusso d'esame.`, allGradableRequired: "Tutte le attività valutate devono essere obbligatorie.", examTitle: "Titolo dell'esame", lessonTitle: "Titolo della lezione", lessonStatus: "Stato della lezione", visibility: "Visibilità", availableFrom: "Disponibile dal", examSettings: "Impostazioni esame", activeAfterPublish: "Entrano in vigore con la prossima pubblicazione.", passingScore: "Soglia di superamento (%)", maxAttempts: "Tentativi massimi", shuffleQuestions: "Mescola le domande per tentativo", examFlow: "Flusso d'esame", automaticQuestions: "domande automatiche", randomQuestions: (total) => `Domande casuali (su ${total})`, timeLimitMinutes: "Limite di tempo (minuti)", resultRelease: "Pubblicazione risultato", immediate: "Immediata", afterDeadline: "Dopo la scadenza del tempo", manual: "Manuale", reviewRelease: "Accesso alla revisione", never: "Mai", afterResult: "Dopo la pubblicazione del risultato", contentAccess: "Accesso ai contenuti", allow: "Consenti", blockCourse: "Blocca il corso", blockAcademy: "Blocca l'academy", reload: "Ricarica", quickPageNavigation: "Navigazione rapida a una pagina della lezione", mainContent: "Contenuto principale", newPage: "Nuova pagina", pageWidth: "Larghezza pagina", narrow: "Stretta", standard: "Standard", wide: "Ampia", background: "Sfondo", neutral: "Neutro", light: "Leggero", contrast: "Contrasto", spacing: "Spaziatura", compact: "Compatta", comfortable: "Comoda", spacious: "Ampia", movePageUp: "Sposta pagina in alto", up: "Su", movePageDown: "Sposta pagina in basso", down: "Giù", duplicatePage: "Duplica pagina", hidePage: "Nascondi pagina", showPage: "Mostra pagina", unsyncTitle: "Interrompi sincronizzazione titolo", onlyFirstPageSync: "Solo la prima pagina può essere sincronizzata", emptyPage: "Questa pagina è vuota", emptyMainContent: "Il contenuto principale è vuoto", addContentHint: "Aggiungi un blocco di contenuto da destra.", linkModule: "Modulo link", examBlocks: "Blocchi d'esame", contentBlocks: "Blocchi di contenuto", noLearningContent: "Nessun contenuto didattico", activeMainContent: "Area attiva: contenuto principale", pageArea: (title) => `Pagina: ${title}`, elementsInArea: (count) => `${count} elementi in quest'area`,
  },
  information: {
    title: "Informazioni sul corso", description: "Questi dati appaiono nel catalogo corsi e nell'area membri.", courseTitle: "Titolo", category: "Categoria", shortDescription: "Descrizione breve", longDescription: "Descrizione completa", difficulty: "Difficoltà", estimatedDuration: "Durata stimata (minuti)", coverUrl: "URL immagine di copertina", certificateEnabled: "Abilita certificato", featured: "Metti in evidenza nel catalogo", showInMemberOverview: "Mostra nella panoramica corsi dei membri", showProgress: "Mostra progresso percentuale", emailModuleReleases: "Invia automaticamente un'email per i nuovi moduli", scope: "Ambito del corso", modules: "Moduli", lessons: "Lezioni", lessonPages: "Pagine delle lezioni", duration: "Durata", certificateOn: "Al completamento viene emesso un certificato.", certificateOff: "Nessun certificato è attivo per questo corso.",
  },
  access: {
    title: "Accesso e pubblicazione", description: "I moduli obbligatori e le pubblicazioni ritardate si applicano solo a questo corso.", manageMembers: "Gestisci membri", enrolled: "Iscritti", activeAccess: (count) => `${count} con accesso attivo`, inactive: "Inattivi", progressPreserved: "Il progresso viene conservato", assignments: "Assegnazioni", directAndGroups: (direct, groups) => `${direct} dirette | ${groups} gruppi`, viaBundles: "Tramite bundle", activeBundlePaths: "Percorsi di accesso bundle attivi", module: "Modulo", releaseMode: "Modalità di pubblicazione", immediatelyVisible: "Visibile subito", afterPreviousModule: "Dopo il modulo precedente", afterDays: "Dopo un numero di giorni", dateWindow: "Intervallo di date", releaseAfterDays: "Pubblica dopo giorni", untilThen: "Fino ad allora", showLocked: "Mostra come bloccato", hide: "Nascondi", outsideWindow: "Fuori dall'intervallo", windowStart: "Inizio intervallo", windowEnd: "Fine intervallo", insideWindow: "Dentro l'intervallo", requestable: "Accesso richiedibile", linkNotProgress: "I moduli link non contano per il progresso del corso.", requiredModule: "Modulo obbligatorio", status: "Stato", visibility: "Visibilità", lessonsInOrder: "Lezioni in sequenza",
  },
  analytics: {
    title: "Statistiche del corso", description: "Valori in tempo reale da iscrizioni e progresso.", allAnalytics: "Tutte le statistiche", activeLearners: "Partecipanti attivi", totalEnrollments: (count) => `${count} iscrizioni totali`, average: "Media", activeProgressDetail: "Progresso dei partecipanti attivi", completed: "Completato", currentlyInProgress: (count) => `${count} attualmente in corso`, notStarted: "Non iniziato", inactiveAccess: (count) => `${count} accessi inattivi`, distribution: "Distribuzione del progresso", inProgress: "In corso", submissions: "Consegne", submissionSummary: (open, approved) => `${open} aperte | ${approved} valutate`, taskCenter: "Vai al centro attività",
  },
  submissionsView: {
    title: "Ultime consegne", description: "Le consegne più recenti di questo corso.", manageAll: "Gestisci tutte le consegne", submission: "Consegna", member: "Membro", date: "Data", status: "Stato", points: "Punti", graded: "Valutata", revision: "Revisione", open: "Aperta", empty: "Nessuna consegna", emptyDescription: "Le consegne di questo corso appariranno qui automaticamente.",
  },
  dialogs: {
    createModule: "Crea modulo", existingModule: "Usa modulo esistente", sharedContent: "I contenuti restano sincronizzati in tutti i corsi.", reusableModule: "Modulo riutilizzabile", newModule: "Nuovo modulo", createSection: "Crea sezione", sectionTitle: "Titolo della sezione", createLesson: "Crea lezione", lessonTitle: "Titolo della lezione", type: "Tipo", quiz: "Quiz", submission: "Consegna", summary: "Riepilogo", createPage: "Crea pagina della lezione", embedAgent: "Incorpora agente IA", agentStudio: "Agent Studio", agentsLoading: "Caricamento agenti", editBlock: "Modifica blocco di contenuto", saveChanges: "Salva modifiche", blockWidth: "Larghezza blocco", contentWidth: "Larghezza contenuto", fullWidth: "Larghezza piena", alignment: "Allineamento", left: "Sinistra", centered: "Centrato", surface: "Superficie", borderless: "Nessuna", bordered: "Con bordo", muted: "Attenuata",
  },
};

const esExtras: CourseBuilderExtras = {
  common: {
    closeDialog: "Cerrar diálogo", cancel: "Cancelar", saving: "Guardando", delete: "Eliminar", add: "Añadir", edit: "Editar", module: "Módulo", section: "Sección", lesson: "Lección", page: "Página", pages: (count) => `${count} ${count === 1 ? "página" : "páginas"}`, lessons: (count) => `${count} lecciones`, version: (version) => `Versión ${version}`, active: "Activo", draft: "Borrador", archived: "Archivado", published: "Publicado", visible: "Visible", hidden: "Oculto", comingSoon: "Próximamente", available: "Disponible", readOnly: "Solo lectura", locked: "Bloqueado", noLimit: "Sin límite", all: "Todas", none: "Ninguno",
  },
  palette: {
    ai_agent: "Agente de IA", eyebrow: "Antetítulo", heading: "Encabezado", text: "Texto", rich_text: "Texto enriquecido", button: "Botón / enlace", gallery: "Galería", callout: "Destacado", quote: "Cita", divider: "Separador", accordion: "Acordeón", tabs: "Pestañas", columns: "Columnas", code: "Código", table: "Tabla", download: "Descarga", data_form: "Formulario", info: "Información", checklist: "Lista de control", image: "Imagen", video: "Vídeo", audio: "Audio", file: "Archivo", embed: "Contenido insertado", multiple_choice: "Opción múltiple", true_false: "Verdadero / falso", multi_select: "Selección múltiple", fill_blank: "Completar huecos", ordering: "Ordenar", submission: "Entrega",
  },
  block: {
    deleteDialogLabel: "Eliminar bloque de contenido", deleteTitle: "¿Eliminar el bloque de contenido?", deleteDescription: (title) => `${title} se eliminará definitivamente de la lección.`, fallbackElement: "Este bloque de contenido", optionA: "Opción A", optionB: "Opción B", option: (index) => `Opción ${index}`, agent: "Agente de IA", previousAgentUnavailable: "El agente anterior ya no está disponible", noPublishedAgent: "No hay ningún agente activo publicado", label: "Etiqueta", defaultLearnMore: "Más información", linkTarget: "Destino del enlace", linkHint: "Se permiten enlaces HTTP(S), rutas internas y anclas.", display: "Apariencia", primaryButton: "Botón principal", secondaryButton: "Botón secundario", textLink: "Enlace de texto", defaultDownloadLabel: "Descargar material del curso", file: "Archivo", fileName: "Nombre del archivo", downloadAssetHint: "Las descargas deben cargarse como recursos de curso verificados.", download: "Descarga", defaultDownloadFileName: "material-del-curso.pdf", description: "Descripción", title: "Título", defaultForm: "Formulario", dataForm: "Formulario de datos", noActiveForm: "No hay formularios activos", kicker: "Antetítulo", heading: "Encabezado", text: "Texto", defaultInfo: "Información", infoText: "Texto informativo", accentColor: "Color de énfasis", teal: "Turquesa", navy: "Azul oscuro", coral: "Coral", gold: "Dorado", defaultChecklist: "Lista de control", checklistItems: "Elementos de la lista", oneItemPerLine: "Un elemento por línea.", completionRequired: "Es obligatorio completarlo", media: { image: "Imagen", video: "Vídeo", audio: "Audio", file: "Archivo", embed: "Contenido insertado" }, embedUrl: "URL insertada", httpLinksOnly: "Solo se permiten enlaces HTTP(S).", mediaSource: (label) => `Origen de ${label}`, defaultCourseMaterial: "Material del curso", imageCaption: "Pie de imagen", defaultFillBlank: "Completar huecos", gapQuestion: "Pregunta con hueco", acceptedAnswers: "Respuestas aceptadas", equivalentAnswerPerLine: "Una respuesta equivalente por línea.", caseSensitive: "Distinguir mayúsculas y minúsculas", evaluationFeedback: "Comentarios tras la entrega", feedbackSecurity: "Nunca se muestra antes de la evaluación en el servidor.", requiredToComplete: "Debe aprobarse para completar", defaultOrdering: "Tarea de ordenación", task: "Tarea", correctOrder: "Elementos en el orden correcto", defaultMultiSelect: "Selección múltiple", question: "Pregunta", answerOptions: "Opciones de respuesta", oneOptionPerLine: "Una opción por línea.", correctAnswers: "Respuestas correctas", true: "Verdadero", false: "Falso", defaultKnowledgeCheck: "Comprobación de conocimientos", correctAnswer: "Respuesta correcta", feedbackPlaceholder: "Breve explicación de la solución correcta", defaultSubmission: "Entrega", workAssignment: "Instrucciones de la tarea", submissionRequired: "La entrega es obligatoria", required: "Obligatorio", feedbackPrefix: "Comentarios:", freeTextAnswer: "Respuesta de texto libre", acceptedAnswerCount: (count) => `${count} respuestas aceptadas`, unavailableAgent: "El agente de IA ya no está disponible", learningCoach: "Tutor de aprendizaje", knowledgeAssistant: "Asistente de conocimiento", formAssistant: "Asistente de formularios", choosePublishedAgent: "Selecciona un agente activo publicado.", chooseDataForm: "Selecciona un formulario de datos", defaultCourseImage: "Imagen del curso", missingImageUrl: "Añade una URL de imagen", missingVideoUrl: "Añade una URL de vídeo", missingAudioUrl: "Añade una URL de audio", linkedFile: "Archivo vinculado", missingFileUrl: "Añade una URL de archivo", embedPreview: "Contenido insertado", missingEmbedUrl: "Añade una URL para insertar", move: "Mover bloque de contenido", duplicate: "Duplicar bloque de contenido",
  },
  structure: {
    pageTitle: "Título de página", pageNavigationHint: "Los miembros recorren las páginas de la lección en este orden.", syncLessonTitle: "Sincronizar con el título de la lección", moduleType: "Tipo de módulo", learningModule: "Módulo de aprendizaje", exam: "Examen", courseLink: "Enlace a curso", targetCourse: "Curso de destino", targetCourseHint: "El enlace no hereda los permisos de acceso del curso de destino.", chooseTargetCourse: "Seleccionar curso de destino", linkTitle: "Título del enlace", moduleTitle: "Título del módulo", description: "Descripción", folder: "Carpeta", defaultFolder: "General", durationMinutes: "Duración (minutos)", reusableModule: "El módulo puede usarse en otros cursos", agentsLoadError: "No se pudieron cargar los agentes de IA.", saveError: "No se pudo guardar el cambio.", sharedInCourses: (count) => `Compartido en ${count} cursos`, reusable: "Reutilizable", level: (level) => `Nivel ${level}`, outdent: "Reducir sangría", indent: "Aumentar sangría", removeFromCourse: "Quitar del curso", examSection: "Examen", noSection: "Sin sección", focusedExam: "Estructura de examen enfocada", noModule: "Aún no hay módulos", createFirstModule: "Crear primer módulo", editor: "Editor", sharedModule: "Módulo compartido", openTargetCourse: "Curso de destino", sharedModuleDescription: "Los cambios de este módulo aparecen en todos los cursos que lo usan.", examNeedsTask: "Añade al menos una tarea evaluada antes de publicar.", gradableTasks: (count) => `${count} ${count === 1 ? "tarea evaluada" : "tareas evaluadas"} en el flujo del examen.`, allGradableRequired: "Todas las tareas evaluadas deben ser obligatorias.", examTitle: "Título del examen", lessonTitle: "Título de la lección", lessonStatus: "Estado de la lección", visibility: "Visibilidad", availableFrom: "Disponible desde", examSettings: "Ajustes del examen", activeAfterPublish: "Se aplican con la próxima publicación.", passingScore: "Nota de aprobación (%)", maxAttempts: "Intentos máximos", shuffleQuestions: "Mezclar preguntas en cada intento", examFlow: "Flujo del examen", automaticQuestions: "preguntas automáticas", randomQuestions: (total) => `Preguntas aleatorias (de ${total})`, timeLimitMinutes: "Límite de tiempo (minutos)", resultRelease: "Publicación del resultado", immediate: "Inmediata", afterDeadline: "Al terminar el tiempo", manual: "Manual", reviewRelease: "Acceso a revisión", never: "Nunca", afterResult: "Tras publicar el resultado", contentAccess: "Acceso al contenido", allow: "Permitir", blockCourse: "Bloquear curso", blockAcademy: "Bloquear academy", reload: "Recargar", quickPageNavigation: "Navegación rápida a una página de la lección", mainContent: "Contenido principal", newPage: "Nueva página", pageWidth: "Ancho de página", narrow: "Estrecho", standard: "Estándar", wide: "Ancho", background: "Fondo", neutral: "Neutro", light: "Claro", contrast: "Contraste", spacing: "Espaciado", compact: "Compacto", comfortable: "Cómodo", spacious: "Amplio", movePageUp: "Mover página arriba", up: "Arriba", movePageDown: "Mover página abajo", down: "Abajo", duplicatePage: "Duplicar página", hidePage: "Ocultar página", showPage: "Mostrar página", unsyncTitle: "Dejar de sincronizar el título", onlyFirstPageSync: "Solo puede sincronizarse la primera página", emptyPage: "Esta página está vacía", emptyMainContent: "El contenido principal está vacío", addContentHint: "Añade un bloque de contenido desde la derecha.", linkModule: "Módulo de enlace", examBlocks: "Bloques de examen", contentBlocks: "Bloques de contenido", noLearningContent: "Sin contenido formativo", activeMainContent: "Área activa: contenido principal", pageArea: (title) => `Página: ${title}`, elementsInArea: (count) => `${count} elementos en esta área`,
  },
  information: {
    title: "Información del curso", description: "Estos datos aparecen en el catálogo de cursos y el área de miembros.", courseTitle: "Título", category: "Categoría", shortDescription: "Descripción breve", longDescription: "Descripción completa", difficulty: "Dificultad", estimatedDuration: "Duración estimada (minutos)", coverUrl: "URL de imagen de portada", certificateEnabled: "Activar certificado", featured: "Destacar en el catálogo", showInMemberOverview: "Mostrar en la vista de cursos de miembros", showProgress: "Mostrar progreso porcentual", emailModuleReleases: "Enviar automáticamente un correo al publicar módulos", scope: "Alcance del curso", modules: "Módulos", lessons: "Lecciones", lessonPages: "Páginas de lección", duration: "Duración", certificateOn: "Se emite un certificado tras completar el curso.", certificateOff: "Este curso no tiene certificado activado.",
  },
  access: {
    title: "Acceso y publicación", description: "Los módulos obligatorios y las publicaciones retrasadas solo se aplican a este curso.", manageMembers: "Gestionar miembros", enrolled: "Inscritos", activeAccess: (count) => `${count} con acceso activo`, inactive: "Inactivos", progressPreserved: "El progreso se conserva", assignments: "Asignaciones", directAndGroups: (direct, groups) => `${direct} directas | ${groups} grupos`, viaBundles: "Mediante paquetes", activeBundlePaths: "Rutas activas de acceso por paquete", module: "Módulo", releaseMode: "Modo de publicación", immediatelyVisible: "Visible inmediatamente", afterPreviousModule: "Después del módulo anterior", afterDays: "Después de unos días", dateWindow: "Intervalo de fechas", releaseAfterDays: "Publicar después de días", untilThen: "Hasta entonces", showLocked: "Mostrar bloqueado", hide: "Ocultar", outsideWindow: "Fuera del intervalo", windowStart: "Inicio del intervalo", windowEnd: "Fin del intervalo", insideWindow: "Dentro del intervalo", requestable: "Se puede solicitar acceso", linkNotProgress: "Los módulos de enlace no cuentan para el progreso del curso.", requiredModule: "Módulo obligatorio", status: "Estado", visibility: "Visibilidad", lessonsInOrder: "Lecciones en secuencia",
  },
  analytics: {
    title: "Estadísticas del curso", description: "Valores en directo de inscripciones y progreso.", allAnalytics: "Todas las estadísticas", activeLearners: "Participantes activos", totalEnrollments: (count) => `${count} inscripciones en total`, average: "Promedio", activeProgressDetail: "Progreso de participantes activos", completed: "Completado", currentlyInProgress: (count) => `${count} actualmente en curso`, notStarted: "No empezado", inactiveAccess: (count) => `${count} accesos inactivos`, distribution: "Distribución del progreso", inProgress: "En curso", submissions: "Entregas", submissionSummary: (open, approved) => `${open} abiertas | ${approved} evaluadas`, taskCenter: "Ir al centro de tareas",
  },
  submissionsView: {
    title: "Últimas entregas", description: "Las entregas más recientes de este curso.", manageAll: "Gestionar todas las entregas", submission: "Entrega", member: "Miembro", date: "Fecha", status: "Estado", points: "Puntos", graded: "Evaluada", revision: "Revisión", open: "Abierta", empty: "Aún no hay entregas", emptyDescription: "Las entregas de este curso aparecerán aquí automáticamente.",
  },
  dialogs: {
    createModule: "Crear módulo", existingModule: "Usar módulo existente", sharedContent: "El contenido se mantiene sincronizado en todos los cursos.", reusableModule: "Módulo reutilizable", newModule: "Nuevo módulo", createSection: "Crear sección", sectionTitle: "Título de la sección", createLesson: "Crear lección", lessonTitle: "Título de la lección", type: "Tipo", quiz: "Cuestionario", submission: "Entrega", summary: "Resumen", createPage: "Crear página de lección", embedAgent: "Insertar agente de IA", agentStudio: "Agent Studio", agentsLoading: "Cargando agentes", editBlock: "Editar bloque de contenido", saveChanges: "Guardar cambios", blockWidth: "Ancho del bloque", contentWidth: "Ancho del contenido", fullWidth: "Ancho completo", alignment: "Alineación", left: "Izquierda", centered: "Centrado", surface: "Superficie", borderless: "Ninguna", bordered: "Con borde", muted: "Atenuada",
  },
};

const frExtras: CourseBuilderExtras = {
  common: {
    closeDialog: "Fermer la fenêtre", cancel: "Annuler", saving: "Enregistrement", delete: "Supprimer", add: "Ajouter", edit: "Modifier", module: "Module", section: "Section", lesson: "Leçon", page: "Page", pages: (count) => `${count} ${count === 1 ? "page" : "pages"}`, lessons: (count) => `${count} leçons`, version: (version) => `Version ${version}`, active: "Actif", draft: "Brouillon", archived: "Archivé", published: "Publié", visible: "Visible", hidden: "Masqué", comingSoon: "Bientôt disponible", available: "Disponible", readOnly: "Lecture seule", locked: "Verrouillé", noLimit: "Aucune limite", all: "Toutes", none: "Aucun",
  },
  palette: {
    ai_agent: "Agent IA", eyebrow: "Surtitre", heading: "Titre", text: "Texte", rich_text: "Texte enrichi", button: "Bouton / lien", gallery: "Galerie", callout: "Encadré", quote: "Citation", divider: "Séparateur", accordion: "Accordéon", tabs: "Onglets", columns: "Colonnes", code: "Code", table: "Tableau", download: "Téléchargement", data_form: "Formulaire", info: "Information", checklist: "Liste de contrôle", image: "Image", video: "Vidéo", audio: "Audio", file: "Fichier", embed: "Contenu intégré", multiple_choice: "Choix multiple", true_false: "Vrai / faux", multi_select: "Sélection multiple", fill_blank: "Texte à trous", ordering: "Classement", submission: "Travail",
  },
  block: {
    deleteDialogLabel: "Supprimer le bloc de contenu", deleteTitle: "Supprimer le bloc de contenu ?", deleteDescription: (title) => `${title} sera définitivement supprimé de la leçon.`, fallbackElement: "Ce bloc de contenu", optionA: "Option A", optionB: "Option B", option: (index) => `Option ${index}`, agent: "Agent IA", previousAgentUnavailable: "L'agent précédent n'est plus disponible", noPublishedAgent: "Aucun agent actif publié", label: "Libellé", defaultLearnMore: "En savoir plus", linkTarget: "Cible du lien", linkHint: "Les liens HTTP(S), chemins internes et ancres sont autorisés.", display: "Apparence", primaryButton: "Bouton principal", secondaryButton: "Bouton secondaire", textLink: "Lien texte", defaultDownloadLabel: "Télécharger le matériel du cours", file: "Fichier", fileName: "Nom du fichier", downloadAssetHint: "Les téléchargements doivent être chargés comme ressources de cours vérifiées.", download: "Téléchargement", defaultDownloadFileName: "materiel-du-cours.pdf", description: "Description", title: "Titre", defaultForm: "Formulaire", dataForm: "Formulaire de données", noActiveForm: "Aucun formulaire actif", kicker: "Surtitre", heading: "Titre", text: "Texte", defaultInfo: "Information", infoText: "Texte d'information", accentColor: "Couleur d'accent", teal: "Turquoise", navy: "Bleu foncé", coral: "Corail", gold: "Or", defaultChecklist: "Liste de contrôle", checklistItems: "Éléments de la liste", oneItemPerLine: "Un élément par ligne.", completionRequired: "Le traitement est obligatoire", media: { image: "Image", video: "Vidéo", audio: "Audio", file: "Fichier", embed: "Contenu intégré" }, embedUrl: "URL d'intégration", httpLinksOnly: "Seuls les liens HTTP(S) sont autorisés.", mediaSource: (label) => `Source ${label}`, defaultCourseMaterial: "Matériel du cours", imageCaption: "Légende de l'image", defaultFillBlank: "Texte à trous", gapQuestion: "Question à trou", acceptedAnswers: "Réponses acceptées", equivalentAnswerPerLine: "Une réponse équivalente par ligne.", caseSensitive: "Respecter les majuscules et minuscules", evaluationFeedback: "Retour après envoi", feedbackSecurity: "Jamais affiché avant l'évaluation côté serveur.", requiredToComplete: "Doit être réussi pour terminer", defaultOrdering: "Exercice de classement", task: "Exercice", correctOrder: "Éléments dans le bon ordre", defaultMultiSelect: "Sélection multiple", question: "Question", answerOptions: "Choix de réponse", oneOptionPerLine: "Une option par ligne.", correctAnswers: "Réponses correctes", true: "Vrai", false: "Faux", defaultKnowledgeCheck: "Contrôle des connaissances", correctAnswer: "Réponse correcte", feedbackPlaceholder: "Brève explication de la bonne solution", defaultSubmission: "Travail", workAssignment: "Consigne", submissionRequired: "Le travail est obligatoire", required: "Obligatoire", feedbackPrefix: "Retour :", freeTextAnswer: "Réponse libre", acceptedAnswerCount: (count) => `${count} réponses acceptées`, unavailableAgent: "L'agent IA n'est plus disponible", learningCoach: "Coach d'apprentissage", knowledgeAssistant: "Assistant de connaissances", formAssistant: "Assistant de formulaire", choosePublishedAgent: "Sélectionnez un agent actif publié.", chooseDataForm: "Sélectionner un formulaire de données", defaultCourseImage: "Image du cours", missingImageUrl: "Ajouter une URL d'image", missingVideoUrl: "Ajouter une URL de vidéo", missingAudioUrl: "Ajouter une URL audio", linkedFile: "Fichier lié", missingFileUrl: "Ajouter une URL de fichier", embedPreview: "Contenu intégré", missingEmbedUrl: "Ajouter une URL d'intégration", move: "Déplacer le bloc de contenu", duplicate: "Dupliquer le bloc de contenu",
  },
  structure: {
    pageTitle: "Titre de la page", pageNavigationHint: "Les membres parcourent les pages de la leçon dans cet ordre.", syncLessonTitle: "Synchroniser avec le titre de la leçon", moduleType: "Type de module", learningModule: "Module d'apprentissage", exam: "Examen", courseLink: "Lien vers un cours", targetCourse: "Cours cible", targetCourseHint: "Le lien n'hérite pas des droits d'accès du cours cible.", chooseTargetCourse: "Sélectionner le cours cible", linkTitle: "Titre du lien", moduleTitle: "Titre du module", description: "Description", folder: "Dossier", defaultFolder: "Général", durationMinutes: "Durée (minutes)", reusableModule: "Le module peut être utilisé dans d'autres cours", agentsLoadError: "Impossible de charger les agents IA.", saveError: "Impossible d'enregistrer la modification.", sharedInCourses: (count) => `Partagé dans ${count} cours`, reusable: "Réutilisable", level: (level) => `Niveau ${level}`, outdent: "Réduire le retrait", indent: "Augmenter le retrait", removeFromCourse: "Retirer du cours", examSection: "Examen", noSection: "Sans section", focusedExam: "Structure d'examen ciblée", noModule: "Aucun module", createFirstModule: "Créer le premier module", editor: "Éditeur", sharedModule: "Module partagé", openTargetCourse: "Cours cible", sharedModuleDescription: "Les modifications de ce module apparaissent dans tous les cours qui l'utilisent.", examNeedsTask: "Ajoutez au moins un exercice évalué avant de publier.", gradableTasks: (count) => `${count} ${count === 1 ? "exercice évalué" : "exercices évalués"} dans le parcours d'examen.`, allGradableRequired: "Tous les exercices évalués doivent être obligatoires.", examTitle: "Titre de l'examen", lessonTitle: "Titre de la leçon", lessonStatus: "Statut de la leçon", visibility: "Visibilité", availableFrom: "Disponible à partir du", examSettings: "Paramètres de l'examen", activeAfterPublish: "S'appliquent à la prochaine publication.", passingScore: "Seuil de réussite (%)", maxAttempts: "Nombre maximal de tentatives", shuffleQuestions: "Mélanger les questions à chaque tentative", examFlow: "Parcours de l'examen", automaticQuestions: "questions automatiques", randomQuestions: (total) => `Questions aléatoires (sur ${total})`, timeLimitMinutes: "Limite de temps (minutes)", resultRelease: "Publication du résultat", immediate: "Immédiate", afterDeadline: "À l'expiration du délai", manual: "Manuelle", reviewRelease: "Accès à la correction", never: "Jamais", afterResult: "Après la publication du résultat", contentAccess: "Accès au contenu", allow: "Autoriser", blockCourse: "Bloquer le cours", blockAcademy: "Bloquer l'academy", reload: "Recharger", quickPageNavigation: "Navigation rapide vers une page de leçon", mainContent: "Contenu principal", newPage: "Nouvelle page", pageWidth: "Largeur de page", narrow: "Étroite", standard: "Standard", wide: "Large", background: "Arrière-plan", neutral: "Neutre", light: "Clair", contrast: "Contraste", spacing: "Espacement", compact: "Compact", comfortable: "Confortable", spacious: "Spacieux", movePageUp: "Déplacer la page vers le haut", up: "Vers le haut", movePageDown: "Déplacer la page vers le bas", down: "Vers le bas", duplicatePage: "Dupliquer la page", hidePage: "Masquer la page", showPage: "Afficher la page", unsyncTitle: "Arrêter la synchronisation du titre", onlyFirstPageSync: "Seule la première page peut être synchronisée", emptyPage: "Cette page est vide", emptyMainContent: "Le contenu principal est vide", addContentHint: "Ajoutez un bloc de contenu depuis la droite.", linkModule: "Module de lien", examBlocks: "Blocs d'examen", contentBlocks: "Blocs de contenu", noLearningContent: "Aucun contenu pédagogique", activeMainContent: "Zone active : contenu principal", pageArea: (title) => `Page : ${title}`, elementsInArea: (count) => `${count} éléments dans cette zone`,
  },
  information: {
    title: "Informations du cours", description: "Ces informations apparaissent dans le catalogue et l'espace membre.", courseTitle: "Titre", category: "Catégorie", shortDescription: "Description courte", longDescription: "Description complète", difficulty: "Difficulté", estimatedDuration: "Durée estimée (minutes)", coverUrl: "URL de l'image de couverture", certificateEnabled: "Activer le certificat", featured: "Mettre en avant dans le catalogue", showInMemberOverview: "Afficher dans la vue des cours des membres", showProgress: "Afficher la progression en pourcentage", emailModuleReleases: "Envoyer automatiquement un e-mail lors des publications de modules", scope: "Étendue du cours", modules: "Modules", lessons: "Leçons", lessonPages: "Pages de leçon", duration: "Durée", certificateOn: "Un certificat est délivré après la réussite du cours.", certificateOff: "Aucun certificat n'est activé pour ce cours.",
  },
  access: {
    title: "Accès et publication", description: "Les modules obligatoires et les publications différées ne s'appliquent qu'à ce cours.", manageMembers: "Gérer les membres", enrolled: "Inscrits", activeAccess: (count) => `${count} avec accès actif`, inactive: "Inactifs", progressPreserved: "La progression est conservée", assignments: "Attributions", directAndGroups: (direct, groups) => `${direct} directes | ${groups} groupes`, viaBundles: "Via des bundles", activeBundlePaths: "Chemins d'accès actifs par bundle", module: "Module", releaseMode: "Mode de publication", immediatelyVisible: "Visible immédiatement", afterPreviousModule: "Après le module précédent", afterDays: "Après un nombre de jours", dateWindow: "Plage de dates", releaseAfterDays: "Publier après plusieurs jours", untilThen: "D'ici là", showLocked: "Afficher comme verrouillé", hide: "Masquer", outsideWindow: "Hors de la plage", windowStart: "Début de la plage", windowEnd: "Fin de la plage", insideWindow: "Dans la plage", requestable: "Accès sur demande", linkNotProgress: "Les modules de lien ne comptent pas dans la progression du cours.", requiredModule: "Module obligatoire", status: "Statut", visibility: "Visibilité", lessonsInOrder: "Leçons dans l'ordre",
  },
  analytics: {
    title: "Statistiques du cours", description: "Valeurs en direct des inscriptions et de la progression.", allAnalytics: "Toutes les statistiques", activeLearners: "Participants actifs", totalEnrollments: (count) => `${count} inscriptions au total`, average: "Moyenne", activeProgressDetail: "Progression des participants actifs", completed: "Terminé", currentlyInProgress: (count) => `${count} actuellement en cours`, notStarted: "Non commencé", inactiveAccess: (count) => `${count} accès inactifs`, distribution: "Répartition de la progression", inProgress: "En cours", submissions: "Travaux", submissionSummary: (open, approved) => `${open} ouverts | ${approved} évalués`, taskCenter: "Accéder au centre des tâches",
  },
  submissionsView: {
    title: "Derniers travaux", description: "Les derniers travaux envoyés dans ce cours.", manageAll: "Gérer tous les travaux", submission: "Travail", member: "Membre", date: "Date", status: "Statut", points: "Points", graded: "Évalué", revision: "Révision", open: "Ouvert", empty: "Aucun travail", emptyDescription: "Les travaux de ce cours apparaîtront automatiquement ici.",
  },
  dialogs: {
    createModule: "Créer un module", existingModule: "Utiliser un module existant", sharedContent: "Le contenu reste synchronisé dans tous les cours.", reusableModule: "Module réutilisable", newModule: "Nouveau module", createSection: "Créer une section", sectionTitle: "Titre de la section", createLesson: "Créer une leçon", lessonTitle: "Titre de la leçon", type: "Type", quiz: "Quiz", submission: "Travail", summary: "Résumé", createPage: "Créer une page de leçon", embedAgent: "Intégrer un agent IA", agentStudio: "Agent Studio", agentsLoading: "Chargement des agents", editBlock: "Modifier le bloc de contenu", saveChanges: "Enregistrer les modifications", blockWidth: "Largeur du bloc", contentWidth: "Largeur du contenu", fullWidth: "Pleine largeur", alignment: "Alignement", left: "Gauche", centered: "Centré", surface: "Surface", borderless: "Aucune", bordered: "Avec bordure", muted: "Atténuée",
  },
};

const dictionaries: Record<AppLocale, CourseBuilderCopy> = {
  de: {
    ...deExtras,
    backToCourses: "Zurueck zu Kursen", uncategorized: "Ohne Kategorie", status: { draft: "Entwurf", published: "Live", archived: "Archiviert" }, modules: (count) => `${count} Module`, teamPermissions: "Teamrechte", moduleAccess: "Modulzugriffe", memberPreview: "Mitglieder-Vorschau", moveToDraft: "Als Entwurf setzen", tabs: { content: "Inhalte", information: "Informationen", widgets: "Widgets", access: "Zugriff", analytics: "Statistiken", submissions: "Abgaben" }, editorAreas: "Kurseditor-Bereiche", unpublishedChanges: (tab) => `${tab} enthaelt unveroeffentlichte Aenderungen`, courseStructure: "Kursstruktur", structureSummary: (modules, lessons) => `${modules} Module | ${lessons} Lektionen`, createModule: "Modul anlegen", preview: "Vorschau", lesson: "Lektion", save: "Speichern", chooseLesson: "Waehle eine Lektion aus",
  },
  en: {
    ...enExtras,
    backToCourses: "Back to courses", uncategorized: "Uncategorised", status: { draft: "Draft", published: "Live", archived: "Archived" }, modules: (count) => `${count} modules`, teamPermissions: "Team permissions", moduleAccess: "Module access", memberPreview: "Member preview", moveToDraft: "Move to draft", tabs: { content: "Content", information: "Information", widgets: "Widgets", access: "Access", analytics: "Analytics", submissions: "Submissions" }, editorAreas: "Course editor areas", unpublishedChanges: (tab) => `${tab} contains unpublished changes`, courseStructure: "Course structure", structureSummary: (modules, lessons) => `${modules} modules | ${lessons} lessons`, createModule: "Create module", preview: "Preview", lesson: "Lesson", save: "Save", chooseLesson: "Select a lesson",
  },
  it: {
    ...itExtras,
    backToCourses: "Torna ai corsi", uncategorized: "Senza categoria", status: { draft: "Bozza", published: "Pubblicato", archived: "Archiviato" }, modules: (count) => `${count} moduli`, teamPermissions: "Permessi del team", moduleAccess: "Accesso ai moduli", memberPreview: "Anteprima membro", moveToDraft: "Sposta in bozza", tabs: { content: "Contenuti", information: "Informazioni", widgets: "Widget", access: "Accesso", analytics: "Statistiche", submissions: "Consegne" }, editorAreas: "Aree dell'editor corso", unpublishedChanges: (tab) => `${tab} contiene modifiche non pubblicate`, courseStructure: "Struttura del corso", structureSummary: (modules, lessons) => `${modules} moduli | ${lessons} lezioni`, createModule: "Crea modulo", preview: "Anteprima", lesson: "Lezione", save: "Salva", chooseLesson: "Seleziona una lezione",
  },
  es: {
    ...esExtras,
    backToCourses: "Volver a cursos", uncategorized: "Sin categoria", status: { draft: "Borrador", published: "Publicado", archived: "Archivado" }, modules: (count) => `${count} modulos`, teamPermissions: "Permisos del equipo", moduleAccess: "Acceso a modulos", memberPreview: "Vista de miembro", moveToDraft: "Mover a borrador", tabs: { content: "Contenidos", information: "Informacion", widgets: "Widgets", access: "Acceso", analytics: "Estadisticas", submissions: "Entregas" }, editorAreas: "Areas del editor de cursos", unpublishedChanges: (tab) => `${tab} contiene cambios sin publicar`, courseStructure: "Estructura del curso", structureSummary: (modules, lessons) => `${modules} modulos | ${lessons} lecciones`, createModule: "Crear modulo", preview: "Vista previa", lesson: "Leccion", save: "Guardar", chooseLesson: "Selecciona una leccion",
  },
  fr: {
    ...frExtras,
    backToCourses: "Retour aux cours", uncategorized: "Sans categorie", status: { draft: "Brouillon", published: "Publie", archived: "Archive" }, modules: (count) => `${count} modules`, teamPermissions: "Droits de l'equipe", moduleAccess: "Acces aux modules", memberPreview: "Apercu membre", moveToDraft: "Passer en brouillon", tabs: { content: "Contenus", information: "Informations", widgets: "Widgets", access: "Acces", analytics: "Statistiques", submissions: "Travaux" }, editorAreas: "Zones de l'editeur de cours", unpublishedChanges: (tab) => `${tab} contient des modifications non publiees`, courseStructure: "Structure du cours", structureSummary: (modules, lessons) => `${modules} modules | ${lessons} lecons`, createModule: "Creer un module", preview: "Apercu", lesson: "Lecon", save: "Enregistrer", chooseLesson: "Selectionnez une lecon",
  },
};

export function getCourseBuilderCopy(locale: AppLocale): CourseBuilderCopy {
  return dictionaries[locale] ?? dictionaries.de;
}
