import { intlLocale, type AppLocale } from "@/lib/i18n/model";
import { PLATFORM_TIME_ZONE } from "@/lib/utils";

export type CommunityAdminActionCode =
  | "accessSaveFailed"
  | "accessSaved"
  | "spaceSaveFailed"
  | "spaceSaved"
  | "spaceMoveFailed"
  | "spaceMoved"
  | "spaceDeleteFailed"
  | "spaceDeleted"
  | "areaCreateFailed"
  | "areaCreated"
  | "areaSaveFailed"
  | "areaSaved"
  | "areaMoveFailed"
  | "areaMoved"
  | "areaDeleteFailed"
  | "areaDeleted"
  | "profileSaveFailed"
  | "profileSaved"
  | "badgeGroupSaveFailed"
  | "badgeGroupSaved"
  | "badgeSaveFailed"
  | "badgeSaved"
  | "badgeAssignmentFailed"
  | "badgeAwarded"
  | "badgeRevoked"
  | "moderationPolicySaveFailed"
  | "moderationPolicySaved"
  | "levelsSaveFailed"
  | "levelsSaved"
  | "caseClaimFailed"
  | "caseClaimed"
  | "decisionFailed"
  | "contentRejected"
  | "contentRestored"
  | "contentApproved"
  | "appealFailed"
  | "appealOverturned"
  | "appealUpheld"
  | "reportDecisionFailed"
  | "postToggleFailed"
  | "postPinned"
  | "postUnpinned"
  | "postLocked"
  | "postUnlocked"
  | "postRejectFailed"
  | "postRejected"
  | "commentRejectFailed"
  | "commentRejected";

export type CommunityAdminMessageState = Readonly<{
  ok: boolean | null;
  messageCode?: CommunityAdminActionCode;
}>;

type CommunityAdminCopy = {
  common: {
    closeDialog: string;
    close: string;
    cancel: string;
    save: string;
    create: string;
    remove: string;
    delete: string;
    deletePermanent: string;
    edit: string;
    moveUp: string;
    moveDown: string;
    active: string;
    inactive: string;
    name: string;
    description: string;
    title: string;
    type: string;
    accentColor: string;
    actions: string;
    loading: string;
    retry: string;
    post: string;
    reply: string;
    feed: string;
    discussion: string;
    announcement: string;
    noDescription: string;
  };
  layout: {
    eyebrow: string;
    heading: string;
    newArea: string;
    newSpace: string;
    createSpaceTitle: string;
    createSpaceEyebrow: string;
    spaceTitlePlaceholder: string;
    spaceDescriptionPlaceholder: string;
    createSuccess: string;
    createError: string;
    area: string;
    areaNamePlaceholder: string;
    areaDescriptionPlaceholder: string;
    cancelAreaCreation: string;
    cancelAreaEdit: (name: string) => string;
    spaceCount: (count: string) => string;
    moveAreaUp: (name: string) => string;
    moveAreaDown: (name: string) => string;
    editArea: (name: string) => string;
    deleteArea: (name: string) => string;
    moveSpacesFirst: string;
    deleteEmptyArea: string;
    assignArea: (name: string) => string;
    moveSpaceUp: (name: string) => string;
    moveSpaceDown: (name: string) => string;
    editSpace: (name: string) => string;
    deleteSpace: (name: string) => string;
    confirmDelete: (name: string) => string;
    emptyArea: string;
    emptyLayout: string;
  };
  profile: {
    eyebrow: string;
    heading: string;
    revision: (revision: string) => string;
    gate: string;
    impact: (incomplete: string, total: string) => string;
    unsavedImpact: string;
    standardFields: Record<
      | "avatar"
      | "job_title"
      | "department"
      | "bio"
      | "community_points"
      | "badges",
      string
    >;
    fieldTypes: Record<
      "text" | "number" | "boolean" | "date" | "select" | "multiselect",
      string
    >;
    unknownField: string;
    standardField: string;
    customField: (type: string) => string;
    required: string;
    moveUp: (label: string) => string;
    moveDown: (label: string) => string;
    removeField: (label: string) => string;
    removeFieldTitle: string;
    empty: string;
    selectField: string;
    standardGroup: string;
    customGroup: string;
    add: string;
    requireOne: string;
    save: string;
  };
  access: {
    subjectTypes: Record<"role" | "user" | "group" | "bundle", string>;
    roles: Record<"member" | "trainer" | "admin" | "owner", string>;
    unavailable: string;
    targetType: string;
    targetTypeAria: string;
    target: string;
    selectTarget: (type: string) => string;
    permissions: string;
    read: string;
    contribute: string;
    comment: string;
    readDependency: string;
    removeRule: string;
    accessModeFor: (title: string) => string;
    open: string;
    restricted: string;
    openForAll: string;
    ruleCount: (count: string) => string;
    noRuleWarning: string;
    addRule: string;
    duplicate: string;
    invalidTarget: string;
    missingRead: string;
    save: string;
    heading: string;
    spaceCount: (count: string) => string;
    fallbackSpace: string;
    empty: string;
  };
  badge: {
    heading: string;
    groups: string;
    badges: string;
    manualAssignment: string;
    groupName: string;
    description: string;
    displayAll: string;
    displayHighest: string;
    sortOrder: string;
    active: string;
    save: string;
    badgeName: string;
    noGroup: string;
    pointsOptional: string;
    color: string;
    selectMember: string;
    selectBadge: string;
    award: string;
    automatic: string;
    revoke: string;
    revokeNamed: (name: string) => string;
  };
  boost: {
    strengths: Record<"light" | "medium" | "high", string>;
    views: Record<"active" | "scheduled" | "expired", string>;
    removeAria: string;
    removeTitle: string;
    removeDescription: (name: string) => string;
    selectPersonError: string;
    periodError: string;
    reasonError: string;
    saveFailed: string;
    saved: string;
    removeFailed: string;
    removed: string;
    invalidResponse: string;
    heading: string;
    description: string;
    person: string;
    selectPerson: string;
    strength: string;
    startsAt: string;
    endsAt: string;
    internalReason: string;
    reasonPlaceholder: string;
    reset: string;
    dateRange: (from: string, to: string) => string;
    editNamed: (name: string) => string;
    removeNamed: (name: string) => string;
    empty: (view: string) => string;
  };
  governance: {
    approvals: Record<"off" | "members" | "non_admins", string>;
    automations: Record<"off" | "observe" | "enforce", string>;
    posts: string;
    comments: string;
    automation: string;
    reportsUntilHold: string;
    disabled: string;
    duplicateWindow: string;
    maxLinks: string;
    saveRules: string;
    moderationHeading: string;
    spaceAria: string;
    emptySpaces: string;
    levelHeading: string;
    addLevel: string;
    newLevel: string;
    enabled: string;
    position: string;
    pointsFrom: string;
    icon: string;
    color: string;
    removeLevel: string;
    removeNamed: (name: string) => string;
    nameAndDescription: string;
    positionFor: (name: string) => string;
    levelName: string;
    descriptionFor: (name: string) => string;
    thresholdFor: (name: string) => string;
    iconFor: (name: string) => string;
    colorFor: (name: string) => string;
    activeNamed: (name: string) => string;
    emptyLevels: string;
    saveLevels: string;
  };
  queue: {
    reasons: Record<
      | "approval_required"
      | "report_threshold"
      | "duplicate"
      | "link_limit"
      | "manual",
      string
    >;
    states: Record<"pending" | "published" | "held" | "rejected", string>;
    decisionTitles: Record<
      "approve" | "reject" | "uphold" | "overturn",
      string
    >;
    missingContent: string;
    note: string;
    saveDecision: string;
    heading: string;
    openCount: (count: string) => string;
    appeal: string;
    reportCount: (count: string) => string;
    authorAppeal: string;
    claim: string;
    claimedByYou: string;
    inReview: string;
    uphold: string;
    overturn: string;
    approve: string;
    reject: string;
    empty: string;
  };
  moderation: {
    reportReasons: Record<
      | "spam"
      | "harassment"
      | "hate_speech"
      | "misinformation"
      | "privacy"
      | "other",
      string
    >;
    reportStatuses: Record<
      "open" | "reviewing" | "resolved" | "dismissed",
      string
    >;
    invalidPreview: string;
    loadMoreFailed: string;
    editSpaceTitle: string;
    editSpaceEyebrow: string;
    forumType: string;
    colorHint: string;
    saveChanges: string;
    deleteSpaceTitle: string;
    irreversible: string;
    deleteAllContent: string;
    deleteSpaceDetail: (posts: string, replies: string) => string;
    confirmSpaceName: (name: string) => string;
    confirmSpaceAria: string;
    rejectTitle: (kind: string) => string;
    moderationEyebrow: string;
    postRejectDetail: string;
    replyRejectDetail: string;
    removeContent: string;
    dismissReport: string;
    decisionEyebrow: string;
    contentBy: (kind: string, author: string) => string;
    internalReason: string;
    rejectReplyBy: (name: string) => string;
    rejectReply: string;
    commentSummary: (visible: string, total: string) => string;
    loadingReplies: string;
    loadReplies: string;
    loadMoreReplies: string;
    loadingComments: string;
    loadMoreComments: string;
    reportsHeading: string;
    openCases: (count: string) => string;
    reportView: string;
    openView: string;
    closedView: string;
    reportedBy: string;
    author: string;
    content: string;
    decision: string;
    startReview: string;
    dismiss: string;
    removeContentButton: string;
    noOpenReports: string;
    noClosedReports: string;
    spacesHeading: string;
    spacesDescription: string;
    postsCount: (count: string) => string;
    repliesCount: (count: string) => string;
    emptySpaces: string;
    feedHeading: string;
    loadedPosts: (count: string) => string;
    refreshing: string;
    pinned: string;
    locked: string;
    pin: string;
    unpin: string;
    lockReplies: string;
    unlockReplies: string;
    rejectPost: string;
    emptyPosts: string;
    morePosts: string;
  };
  actionFallback: { success: string; error: string };
  actions: Record<CommunityAdminActionCode, string>;
};

const de: CommunityAdminCopy = {
  common: {
    closeDialog: "Dialog schließen",
    close: "Schließen",
    cancel: "Abbrechen",
    save: "Speichern",
    create: "Erstellen",
    remove: "Entfernen",
    delete: "Löschen",
    deletePermanent: "Endgültig löschen",
    edit: "Bearbeiten",
    moveUp: "Nach oben",
    moveDown: "Nach unten",
    active: "Aktiv",
    inactive: "Inaktiv",
    name: "Name",
    description: "Beschreibung",
    title: "Titel",
    type: "Typ",
    accentColor: "Akzentfarbe",
    actions: "Aktionen",
    loading: "Wird geladen",
    retry: "Erneut versuchen",
    post: "Beitrag",
    reply: "Antwort",
    feed: "Feed",
    discussion: "Diskussion",
    announcement: "Ankündigung",
    noDescription: "Keine Beschreibung",
  },
  layout: {
    eyebrow: "Struktur",
    heading: "Areas und Bereiche",
    newArea: "Neue Area",
    newSpace: "Neuer Bereich",
    createSpaceTitle: "Community-Bereich erstellen",
    createSpaceEyebrow: "Soziales Lernen",
    spaceTitlePlaceholder: "z. B. Best Practices",
    spaceDescriptionPlaceholder: "Themen und Ziel dieses Community-Bereichs",
    createSuccess: "Community-Bereich erstellt.",
    createError: "Der Community-Bereich konnte nicht erstellt werden.",
    area: "Area",
    areaNamePlaceholder: "z. B. Austausch",
    areaDescriptionPlaceholder: "Themen dieser Area",
    cancelAreaCreation: "Area-Erstellung abbrechen",
    cancelAreaEdit: (name) => `${name} nicht weiter bearbeiten`,
    spaceCount: (count) => `${count} Bereiche`,
    moveAreaUp: (name) => `${name} nach oben verschieben`,
    moveAreaDown: (name) => `${name} nach unten verschieben`,
    editArea: (name) => `${name} bearbeiten`,
    deleteArea: (name) => `${name} löschen`,
    moveSpacesFirst: "Verschiebe zuerst alle Bereiche",
    deleteEmptyArea: "Leere Area dauerhaft löschen?",
    assignArea: (name) => `${name} einer Area zuordnen`,
    moveSpaceUp: (name) => `${name} nach oben verschieben`,
    moveSpaceDown: (name) => `${name} nach unten verschieben`,
    editSpace: (name) => `${name} bearbeiten`,
    deleteSpace: (name) => `${name} löschen`,
    confirmDelete: (name) => `Zum Löschen „${name}“ eingeben`,
    emptyArea: "Noch keine Bereiche in dieser Area.",
    emptyLayout: "Noch keine Community-Area eingerichtet.",
  },
  profile: {
    eyebrow: "Sichtbarkeit",
    heading: "Öffentliche Community-Profile",
    revision: (revision) => `Revision ${revision}`,
    gate: "Vollständiges Profil für Beiträge",
    impact: (incomplete, total) =>
      `Gespeichert: ${incomplete} von ${total} aktiven Mitgliedern würden blockiert`,
    unsavedImpact:
      "Ungespeicherte Änderungen: Auswirkung wird beim Speichern neu berechnet.",
    standardFields: {
      avatar: "Profilbild",
      job_title: "Position",
      department: "Abteilung",
      bio: "Kurzprofil",
      community_points: "Community-Punkte",
      badges: "Badges",
    },
    fieldTypes: {
      text: "Text",
      number: "Zahl",
      boolean: "Ja/Nein",
      date: "Datum",
      select: "Auswahl",
      multiselect: "Mehrfachauswahl",
    },
    unknownField: "Unbekanntes Feld",
    standardField: "Standardfeld",
    customField: (type) => `Custom Field | ${type}`,
    required: "Pflichtfeld",
    moveUp: (label) => `${label} nach oben verschieben`,
    moveDown: (label) => `${label} nach unten verschieben`,
    removeField: (label) => `${label} aus dem öffentlichen Profil entfernen`,
    removeFieldTitle: "Feld entfernen",
    empty: "Keine öffentlichen Profilfelder ausgewählt.",
    selectField: "Profilfeld auswählen",
    standardGroup: "Standardfelder",
    customGroup: "Custom Fields",
    add: "Hinzufügen",
    requireOne: "Wähle mindestens ein Pflichtfeld.",
    save: "Profilkonfiguration speichern",
  },
  access: {
    subjectTypes: {
      role: "Rolle",
      user: "Person",
      group: "Gruppe",
      bundle: "Lernpaket",
    },
    roles: {
      member: "Mitglied",
      trainer: "Trainer",
      admin: "Admin",
      owner: "Inhaber",
    },
    unavailable: "Nicht mehr verfügbar",
    targetType: "Zieltyp",
    targetTypeAria: "Zieltyp der Zugriffsregel",
    target: "Ziel",
    selectTarget: (type) => `${type} auswählen`,
    permissions: "Berechtigungen",
    read: "Lesen",
    contribute: "Beitragen",
    comment: "Kommentieren",
    readDependency:
      "Lesen bleibt aktiv, solange Beitragen oder Kommentieren aktiv ist.",
    removeRule: "Zugriffsregel entfernen",
    accessModeFor: (title) => `Zugriffsmodus für ${title}`,
    open: "Offen",
    restricted: "Eingeschränkt",
    openForAll: "Für alle aktiven Mitglieder",
    ruleCount: (count) =>
      `${count} individuelle ${count === "1" ? "Regel" : "Regeln"}`,
    noRuleWarning:
      "Ohne Regel bleibt dieser Bereich nur für Inhaber und Admins sichtbar.",
    addRule: "Regel hinzufügen",
    duplicate: "Jedes Ziel darf nur einmal vorkommen.",
    invalidTarget: "Eine Regel hat kein gültiges Ziel.",
    missingRead: "Jede Regel benötigt mindestens das Leserecht.",
    save: "Rechte speichern",
    heading: "Bereichszugriff",
    spaceCount: (count) => `${count} ${count === "1" ? "Bereich" : "Bereiche"}`,
    fallbackSpace: "Community-Bereich",
    empty: "Keine Community-Bereiche vorhanden.",
  },
  badge: {
    heading: "Badge-Gruppen & Auszeichnungen",
    groups: "Gruppen",
    badges: "Badges",
    manualAssignment: "Manuelle Vergabe",
    groupName: "Gruppenname",
    description: "Beschreibung",
    displayAll: "Alle anzeigen",
    displayHighest: "Nur höchsten",
    sortOrder: "Sortierung",
    active: "Aktiv",
    save: "Speichern",
    badgeName: "Badge-Name",
    noGroup: "Ohne Gruppe",
    pointsOptional: "Punkte optional",
    color: "Farbe",
    selectMember: "Mitglied wählen",
    selectBadge: "Badge wählen",
    award: "Vergeben",
    automatic: "Automatisch",
    revoke: "Badge entziehen",
    revokeNamed: (name) => `${name} entziehen`,
  },
  boost: {
    strengths: { light: "Leicht", medium: "Mittel", high: "Stark" },
    views: { active: "Aktiv", scheduled: "Geplant", expired: "Abgelaufen" },
    removeAria: "Reach-Boost entfernen",
    removeTitle: "Reach-Boost entfernen?",
    removeDescription: (name) =>
      `Die Empfehlung für ${name} wird sofort aus der Feed-Steuerung entfernt.`,
    selectPersonError: "Bitte eine Person auswählen.",
    periodError: "Der Zeitraum muss positiv und höchstens 90 Tage lang sein.",
    reasonError: "Bitte eine kurze interne Begründung angeben.",
    saveFailed: "Reach-Boost konnte nicht gespeichert werden.",
    saved: "Reach-Boost gespeichert.",
    removeFailed: "Reach-Boost konnte nicht entfernt werden.",
    removed: "Reach-Boost entfernt.",
    invalidResponse: "Der Reach-Boost konnte nicht gelesen werden.",
    heading: "Reach-Boosts",
    description:
      "Beiträge ausgewählter Personen zeitlich begrenzt im persönlichen Feed empfehlen.",
    person: "Person",
    selectPerson: "Person auswählen",
    strength: "Stufe",
    startsAt: "Beginn",
    endsAt: "Ende",
    internalReason: "Interne Begründung",
    reasonPlaceholder: "Warum soll diese Person empfohlen werden?",
    reset: "Zurücksetzen",
    dateRange: (from, to) => `${from} bis ${to}`,
    editNamed: (name) => `Reach-Boost für ${name} bearbeiten`,
    removeNamed: (name) => `Reach-Boost für ${name} entfernen`,
    empty: (view) => `Keine Reach-Boosts mit Status „${view}“.`,
  },
  governance: {
    approvals: {
      off: "Ohne Freigabe",
      members: "Mitglieder prüfen",
      non_admins: "Alle außer Admins prüfen",
    },
    automations: {
      off: "Aus",
      observe: "Nur markieren",
      enforce: "Automatisch zurückhalten",
    },
    posts: "Beiträge",
    comments: "Kommentare",
    automation: "Automatik",
    reportsUntilHold: "Meldungen bis Hold",
    disabled: "Deaktiviert",
    duplicateWindow: "Duplikatfenster (Min.)",
    maxLinks: "Maximale Links",
    saveRules: "Regeln speichern",
    moderationHeading: "Freigabe & Automatik",
    spaceAria: "Community-Bereich",
    emptySpaces: "Keine Community-Bereiche vorhanden.",
    levelHeading: "Community-Level",
    addLevel: "Level hinzufügen",
    newLevel: "Neues Level",
    enabled: "Levelsystem aktiv",
    position: "Position",
    pointsFrom: "Ab Punkten",
    icon: "Icon",
    color: "Farbe",
    removeLevel: "Level entfernen",
    removeNamed: (name) => `${name} entfernen`,
    nameAndDescription: "Name / Beschreibung",
    positionFor: (name) => `Position für ${name}`,
    levelName: "Levelname",
    descriptionFor: (name) => `Beschreibung für ${name}`,
    thresholdFor: (name) => `Punkteschwelle für ${name}`,
    iconFor: (name) => `Icon für ${name}`,
    colorFor: (name) => `Farbe für ${name}`,
    activeNamed: (name) => `${name} aktiv`,
    emptyLevels: "Keine Level definiert.",
    saveLevels: "Level speichern",
  },
  queue: {
    reasons: {
      approval_required: "Freigabe erforderlich",
      report_threshold: "Meldeschwelle erreicht",
      duplicate: "Mögliches Duplikat",
      link_limit: "Linklimit überschritten",
      manual: "Manuelle Prüfung",
    },
    states: {
      pending: "Wartet",
      published: "Sichtbar",
      held: "Zurückgehalten",
      rejected: "Abgelehnt",
    },
    decisionTitles: {
      approve: "Inhalt freigeben",
      reject: "Inhalt ablehnen",
      uphold: "Entscheidung bestätigen",
      overturn: "Einspruch annehmen",
    },
    missingContent: "Inhalt nicht mehr vorhanden.",
    note: "Begründung",
    saveDecision: "Entscheidung speichern",
    heading: "Moderationsfälle",
    openCount: (count) => `${count} offen`,
    appeal: "Einspruch",
    reportCount: (count) =>
      `${count} ${count === "1" ? "Meldung" : "Meldungen"}`,
    authorAppeal: "Einspruch des Autors",
    claim: "Übernehmen",
    claimedByYou: "Bei dir",
    inReview: "In Prüfung",
    uphold: "Bestätigen",
    overturn: "Annehmen",
    approve: "Freigeben",
    reject: "Ablehnen",
    empty: "Keine offenen Moderationsfälle.",
  },
  moderation: {
    reportReasons: {
      spam: "Spam oder Werbung",
      harassment: "Belästigung",
      hate_speech: "Hassrede",
      misinformation: "Irreführender Inhalt",
      privacy: "Persönliche Daten",
      other: "Anderer Grund",
    },
    reportStatuses: {
      open: "Offen",
      reviewing: "In Prüfung",
      resolved: "Inhalt entfernt",
      dismissed: "Abgewiesen",
    },
    invalidPreview: "Die Moderationsvorschau hat ein ungültiges Format.",
    loadMoreFailed: "Weitere Beiträge konnten nicht geladen werden.",
    editSpaceTitle: "Community-Bereich bearbeiten",
    editSpaceEyebrow: "Bereichseinstellungen",
    forumType: "Forumtyp",
    colorHint: "Kennzeichnet den Bereich im Feed",
    saveChanges: "Änderungen speichern",
    deleteSpaceTitle: "Bereich und Inhalte löschen",
    irreversible: "Unwiderrufliche Aktion",
    deleteAllContent: "Alle Inhalte werden ebenfalls gelöscht.",
    deleteSpaceDetail: (posts, replies) =>
      `Der Bereich enthält ${posts} Beiträge und ${replies} Antworten. Likes und alle weiteren Verknüpfungen werden kaskadierend entfernt.`,
    confirmSpaceName: (name) => `Zur Bestätigung „${name}“ eingeben`,
    confirmSpaceAria: "Bereichsname bestätigen",
    rejectTitle: (kind) => `${kind} ablehnen`,
    moderationEyebrow: "Community-Moderation",
    postRejectDetail:
      "Der Beitrag wird abgelehnt und für Mitglieder verborgen. Inhalt, Antworten und Anhänge bleiben für Audit und einen möglichen Einspruch erhalten. Der Autor erhält eine Benachrichtigung.",
    replyRejectDetail:
      "Die Antwort wird abgelehnt und für Mitglieder verborgen. Inhalt und Anhänge bleiben für Audit und einen möglichen Einspruch erhalten. Der Autor erhält eine Benachrichtigung.",
    removeContent: "Inhalt entfernen",
    dismissReport: "Meldung abweisen",
    decisionEyebrow: "Moderationsentscheidung",
    contentBy: (kind, author) => `${kind} von ${author}`,
    internalReason: "Interne Begründung",
    rejectReplyBy: (name) => `Antwort von ${name} ablehnen`,
    rejectReply: "Antwort ablehnen",
    commentSummary: (visible, total) =>
      `${visible} von ${total} Antworten in der Moderationsvorschau`,
    loadingReplies: "Antworten werden geladen",
    loadReplies: "Antworten laden",
    loadMoreReplies: "Weitere Antworten laden",
    loadingComments: "Kommentare werden geladen",
    loadMoreComments: "Weitere Kommentare laden",
    reportsHeading: "Moderationsmeldungen",
    openCases: (count) => `${count} offene Fälle`,
    reportView: "Meldungsansicht",
    openView: "Offen",
    closedView: "Abgeschlossen",
    reportedBy: "Gemeldet von",
    author: "Autor",
    content: "Inhalt",
    decision: "Entscheidung",
    startReview: "Prüfung starten",
    dismiss: "Abweisen",
    removeContentButton: "Entfernen",
    noOpenReports: "Keine offenen Meldungen.",
    noClosedReports: "Noch keine abgeschlossenen Meldungen.",
    spacesHeading: "Bereiche verwalten",
    spacesDescription:
      "Titel, Beschreibung und Kennfarbe bearbeiten oder Bereiche samt Inhalten entfernen.",
    postsCount: (count) => `${count} Beiträge`,
    repliesCount: (count) => `${count} Antworten`,
    emptySpaces: "Noch keine Community-Bereiche eingerichtet.",
    feedHeading: "Neueste Beiträge moderieren",
    loadedPosts: (count) =>
      `${count} geladene Beiträge als paginierte Moderationsvorschau`,
    refreshing: "Feed wird nach einer Aktualisierung neu geladen",
    pinned: "Fixiert",
    locked: "Gesperrt",
    pin: "Beitrag fixieren",
    unpin: "Fixierung aufheben",
    lockReplies: "Antworten sperren",
    unlockReplies: "Antworten freigeben",
    rejectPost: "Beitrag ablehnen",
    emptyPosts: "Noch keine Beiträge vorhanden.",
    morePosts: "Weitere Beiträge",
  },
  actionFallback: {
    success: "Änderung gespeichert.",
    error: "Die Änderung konnte nicht gespeichert werden.",
  },
  actions: {
    accessSaveFailed: "Die Zugriffsregeln konnten nicht gespeichert werden.",
    accessSaved: "Community-Zugriffsregeln gespeichert.",
    spaceSaveFailed: "Der Community-Bereich konnte nicht gespeichert werden.",
    spaceSaved: "Community-Bereich gespeichert.",
    spaceMoveFailed: "Der Community-Bereich konnte nicht verschoben werden.",
    spaceMoved: "Community-Bereich verschoben.",
    spaceDeleteFailed: "Der Community-Bereich konnte nicht gelöscht werden.",
    spaceDeleted:
      "Community-Bereich und alle enthaltenen Inhalte wurden gelöscht.",
    areaCreateFailed: "Die Community-Area konnte nicht erstellt werden.",
    areaCreated: "Community-Area erstellt.",
    areaSaveFailed: "Die Community-Area konnte nicht gespeichert werden.",
    areaSaved: "Community-Area gespeichert.",
    areaMoveFailed: "Die Community-Area konnte nicht verschoben werden.",
    areaMoved: "Community-Area verschoben.",
    areaDeleteFailed: "Die Community-Area konnte nicht gelöscht werden.",
    areaDeleted: "Community-Area gelöscht.",
    profileSaveFailed:
      "Die Community-Profilkonfiguration konnte nicht gespeichert werden.",
    profileSaved: "Community-Profilkonfiguration gespeichert.",
    badgeGroupSaveFailed: "Die Badge-Gruppe konnte nicht gespeichert werden.",
    badgeGroupSaved: "Badge-Gruppe gespeichert.",
    badgeSaveFailed: "Der Badge konnte nicht gespeichert werden.",
    badgeSaved: "Badge gespeichert.",
    badgeAssignmentFailed: "Die Badge-Zuweisung konnte nicht geändert werden.",
    badgeAwarded: "Badge vergeben.",
    badgeRevoked: "Badge entzogen.",
    moderationPolicySaveFailed:
      "Die Moderationsregeln konnten nicht gespeichert werden.",
    moderationPolicySaved: "Moderationsregeln gespeichert.",
    levelsSaveFailed: "Die Levelkonfiguration konnte nicht gespeichert werden.",
    levelsSaved: "Community-Level gespeichert.",
    caseClaimFailed: "Der Fall konnte nicht übernommen werden.",
    caseClaimed: "Moderationsfall übernommen.",
    decisionFailed: "Die Entscheidung konnte nicht gespeichert werden.",
    contentRejected: "Inhalt wurde abgelehnt und verborgen.",
    contentRestored: "Inhalt wurde wiederhergestellt.",
    contentApproved: "Inhalt wurde freigegeben.",
    appealFailed: "Der Einspruch konnte nicht entschieden werden.",
    appealOverturned: "Einspruch angenommen und Inhalt wiederhergestellt.",
    appealUpheld: "Einspruch geprüft und Entscheidung bestätigt.",
    reportDecisionFailed:
      "Die Moderationsentscheidung konnte nicht gespeichert werden.",
    postToggleFailed: "Der Beitragsstatus konnte nicht geändert werden.",
    postPinned: "Beitrag fixiert.",
    postUnpinned: "Fixierung aufgehoben.",
    postLocked: "Antworten gesperrt.",
    postUnlocked: "Antworten freigegeben.",
    postRejectFailed: "Der Beitrag konnte nicht moderiert werden.",
    postRejected: "Beitrag wurde abgelehnt und verborgen.",
    commentRejectFailed: "Die Antwort konnte nicht moderiert werden.",
    commentRejected: "Antwort wurde abgelehnt und verborgen.",
  },
};

const en: CommunityAdminCopy = {
  common: {
    closeDialog: "Close dialog",
    close: "Close",
    cancel: "Cancel",
    save: "Save",
    create: "Create",
    remove: "Remove",
    delete: "Delete",
    deletePermanent: "Delete permanently",
    edit: "Edit",
    moveUp: "Move up",
    moveDown: "Move down",
    active: "Active",
    inactive: "Inactive",
    name: "Name",
    description: "Description",
    title: "Title",
    type: "Type",
    accentColor: "Accent colour",
    actions: "Actions",
    loading: "Loading",
    retry: "Try again",
    post: "Post",
    reply: "Reply",
    feed: "Feed",
    discussion: "Discussion",
    announcement: "Announcement",
    noDescription: "No description",
  },
  layout: {
    eyebrow: "Structure",
    heading: "Areas and spaces",
    newArea: "New area",
    newSpace: "New space",
    createSpaceTitle: "Create community space",
    createSpaceEyebrow: "Social learning",
    spaceTitlePlaceholder: "e.g. Best practices",
    spaceDescriptionPlaceholder: "Topics and purpose of this community space",
    createSuccess: "Community space created.",
    createError: "The community space could not be created.",
    area: "Area",
    areaNamePlaceholder: "e.g. Exchange",
    areaDescriptionPlaceholder: "Topics in this area",
    cancelAreaCreation: "Cancel area creation",
    cancelAreaEdit: (name) => `Stop editing ${name}`,
    spaceCount: (count) => `${count} spaces`,
    moveAreaUp: (name) => `Move ${name} up`,
    moveAreaDown: (name) => `Move ${name} down`,
    editArea: (name) => `Edit ${name}`,
    deleteArea: (name) => `Delete ${name}`,
    moveSpacesFirst: "Move all spaces first",
    deleteEmptyArea: "Delete empty area permanently?",
    assignArea: (name) => `Assign ${name} to an area`,
    moveSpaceUp: (name) => `Move ${name} up`,
    moveSpaceDown: (name) => `Move ${name} down`,
    editSpace: (name) => `Edit ${name}`,
    deleteSpace: (name) => `Delete ${name}`,
    confirmDelete: (name) => `Enter “${name}” to delete`,
    emptyArea: "No spaces in this area yet.",
    emptyLayout: "No community area has been set up yet.",
  },
  profile: {
    eyebrow: "Visibility",
    heading: "Public community profiles",
    revision: (revision) => `Revision ${revision}`,
    gate: "Complete profile required for posts",
    impact: (incomplete, total) =>
      `Saved: ${incomplete} of ${total} active members would be blocked`,
    unsavedImpact: "Unsaved changes: the impact is recalculated when you save.",
    standardFields: {
      avatar: "Profile picture",
      job_title: "Job title",
      department: "Department",
      bio: "Short profile",
      community_points: "Community points",
      badges: "Badges",
    },
    fieldTypes: {
      text: "Text",
      number: "Number",
      boolean: "Yes/No",
      date: "Date",
      select: "Selection",
      multiselect: "Multiple selection",
    },
    unknownField: "Unknown field",
    standardField: "Standard field",
    customField: (type) => `Custom field | ${type}`,
    required: "Required field",
    moveUp: (label) => `Move ${label} up`,
    moveDown: (label) => `Move ${label} down`,
    removeField: (label) => `Remove ${label} from the public profile`,
    removeFieldTitle: "Remove field",
    empty: "No public profile fields selected.",
    selectField: "Select profile field",
    standardGroup: "Standard fields",
    customGroup: "Custom fields",
    add: "Add",
    requireOne: "Select at least one required field.",
    save: "Save profile configuration",
  },
  access: {
    subjectTypes: {
      role: "Role",
      user: "Person",
      group: "Group",
      bundle: "Bundle",
    },
    roles: {
      member: "Member",
      trainer: "Trainer",
      admin: "Admin",
      owner: "Owner",
    },
    unavailable: "No longer available",
    targetType: "Target type",
    targetTypeAria: "Access rule target type",
    target: "Target",
    selectTarget: (type) => `Select ${type.toLowerCase()}`,
    permissions: "Permissions",
    read: "Read",
    contribute: "Contribute",
    comment: "Comment",
    readDependency:
      "Read remains enabled while Contribute or Comment is enabled.",
    removeRule: "Remove access rule",
    accessModeFor: (title) => `Access mode for ${title}`,
    open: "Open",
    restricted: "Restricted",
    openForAll: "For all active members",
    ruleCount: (count) =>
      `${count} individual ${count === "1" ? "rule" : "rules"}`,
    noRuleWarning:
      "Without a rule, this space remains visible only to owners and admins.",
    addRule: "Add rule",
    duplicate: "Each target can appear only once.",
    invalidTarget: "A rule has no valid target.",
    missingRead: "Every rule requires at least read permission.",
    save: "Save permissions",
    heading: "Space access",
    spaceCount: (count) => `${count} ${count === "1" ? "space" : "spaces"}`,
    fallbackSpace: "Community space",
    empty: "No community spaces available.",
  },
  badge: {
    heading: "Badge groups and awards",
    groups: "Groups",
    badges: "Badges",
    manualAssignment: "Manual assignment",
    groupName: "Group name",
    description: "Description",
    displayAll: "Show all",
    displayHighest: "Highest only",
    sortOrder: "Sort order",
    active: "Active",
    save: "Save",
    badgeName: "Badge name",
    noGroup: "No group",
    pointsOptional: "Points optional",
    color: "Colour",
    selectMember: "Select member",
    selectBadge: "Select badge",
    award: "Award",
    automatic: "Automatic",
    revoke: "Revoke badge",
    revokeNamed: (name) => `Revoke ${name}`,
  },
  boost: {
    strengths: { light: "Light", medium: "Medium", high: "High" },
    views: { active: "Active", scheduled: "Scheduled", expired: "Expired" },
    removeAria: "Remove reach boost",
    removeTitle: "Remove reach boost?",
    removeDescription: (name) =>
      `The recommendation for ${name} is removed from feed control immediately.`,
    selectPersonError: "Select a person.",
    periodError: "The period must be positive and no longer than 90 days.",
    reasonError: "Provide a short internal reason.",
    saveFailed: "The reach boost could not be saved.",
    saved: "Reach boost saved.",
    removeFailed: "The reach boost could not be removed.",
    removed: "Reach boost removed.",
    invalidResponse: "The reach boost response could not be read.",
    heading: "Reach boosts",
    description:
      "Recommend posts from selected people in the personal feed for a limited time.",
    person: "Person",
    selectPerson: "Select person",
    strength: "Strength",
    startsAt: "Start",
    endsAt: "End",
    internalReason: "Internal reason",
    reasonPlaceholder: "Why should this person be recommended?",
    reset: "Reset",
    dateRange: (from, to) => `${from} to ${to}`,
    editNamed: (name) => `Edit reach boost for ${name}`,
    removeNamed: (name) => `Remove reach boost for ${name}`,
    empty: (view) => `No reach boosts with status “${view}”.`,
  },
  governance: {
    approvals: {
      off: "No approval",
      members: "Review members",
      non_admins: "Review everyone except admins",
    },
    automations: {
      off: "Off",
      observe: "Flag only",
      enforce: "Hold automatically",
    },
    posts: "Posts",
    comments: "Comments",
    automation: "Automation",
    reportsUntilHold: "Reports until hold",
    disabled: "Disabled",
    duplicateWindow: "Duplicate window (min.)",
    maxLinks: "Maximum links",
    saveRules: "Save rules",
    moderationHeading: "Approval and automation",
    spaceAria: "Community space",
    emptySpaces: "No community spaces available.",
    levelHeading: "Community levels",
    addLevel: "Add level",
    newLevel: "New level",
    enabled: "Level system active",
    position: "Position",
    pointsFrom: "Points from",
    icon: "Icon",
    color: "Colour",
    removeLevel: "Remove level",
    removeNamed: (name) => `Remove ${name}`,
    nameAndDescription: "Name / description",
    positionFor: (name) => `Position for ${name}`,
    levelName: "Level name",
    descriptionFor: (name) => `Description for ${name}`,
    thresholdFor: (name) => `Point threshold for ${name}`,
    iconFor: (name) => `Icon for ${name}`,
    colorFor: (name) => `Colour for ${name}`,
    activeNamed: (name) => `${name} active`,
    emptyLevels: "No levels defined.",
    saveLevels: "Save levels",
  },
  queue: {
    reasons: {
      approval_required: "Approval required",
      report_threshold: "Report threshold reached",
      duplicate: "Possible duplicate",
      link_limit: "Link limit exceeded",
      manual: "Manual review",
    },
    states: {
      pending: "Waiting",
      published: "Visible",
      held: "Held",
      rejected: "Rejected",
    },
    decisionTitles: {
      approve: "Approve content",
      reject: "Reject content",
      uphold: "Confirm decision",
      overturn: "Accept appeal",
    },
    missingContent: "Content no longer available.",
    note: "Reason",
    saveDecision: "Save decision",
    heading: "Moderation cases",
    openCount: (count) => `${count} open`,
    appeal: "Appeal",
    reportCount: (count) => `${count} ${count === "1" ? "report" : "reports"}`,
    authorAppeal: "Author's appeal",
    claim: "Claim",
    claimedByYou: "Assigned to you",
    inReview: "In review",
    uphold: "Confirm",
    overturn: "Accept",
    approve: "Approve",
    reject: "Reject",
    empty: "No open moderation cases.",
  },
  moderation: {
    reportReasons: {
      spam: "Spam or advertising",
      harassment: "Harassment",
      hate_speech: "Hate speech",
      misinformation: "Misleading content",
      privacy: "Personal information",
      other: "Other reason",
    },
    reportStatuses: {
      open: "Open",
      reviewing: "In review",
      resolved: "Content removed",
      dismissed: "Dismissed",
    },
    invalidPreview: "The moderation preview returned an invalid response.",
    loadMoreFailed: "More posts could not be loaded.",
    editSpaceTitle: "Edit community space",
    editSpaceEyebrow: "Space settings",
    forumType: "Forum type",
    colorHint: "Identifies the space in the feed",
    saveChanges: "Save changes",
    deleteSpaceTitle: "Delete space and content",
    irreversible: "Irreversible action",
    deleteAllContent: "All content will also be deleted.",
    deleteSpaceDetail: (posts, replies) =>
      `The space contains ${posts} posts and ${replies} replies. Likes and all other links are removed as well.`,
    confirmSpaceName: (name) => `Enter “${name}” to confirm`,
    confirmSpaceAria: "Confirm space name",
    rejectTitle: (kind) => `Reject ${kind.toLowerCase()}`,
    moderationEyebrow: "Community moderation",
    postRejectDetail:
      "The post is rejected and hidden from members. Content, replies and attachments are retained for audit and a possible appeal. The author receives a notification.",
    replyRejectDetail:
      "The reply is rejected and hidden from members. Content and attachments are retained for audit and a possible appeal. The author receives a notification.",
    removeContent: "Remove content",
    dismissReport: "Dismiss report",
    decisionEyebrow: "Moderation decision",
    contentBy: (kind, author) => `${kind} by ${author}`,
    internalReason: "Internal reason",
    rejectReplyBy: (name) => `Reject reply by ${name}`,
    rejectReply: "Reject reply",
    commentSummary: (visible, total) =>
      `${visible} of ${total} replies in the moderation preview`,
    loadingReplies: "Loading replies",
    loadReplies: "Load replies",
    loadMoreReplies: "Load more replies",
    loadingComments: "Loading comments",
    loadMoreComments: "Load more comments",
    reportsHeading: "Moderation reports",
    openCases: (count) => `${count} open cases`,
    reportView: "Report view",
    openView: "Open",
    closedView: "Closed",
    reportedBy: "Reported by",
    author: "Author",
    content: "Content",
    decision: "Decision",
    startReview: "Start review",
    dismiss: "Dismiss",
    removeContentButton: "Remove",
    noOpenReports: "No open reports.",
    noClosedReports: "No closed reports yet.",
    spacesHeading: "Manage spaces",
    spacesDescription:
      "Edit titles, descriptions and colours, or remove spaces and their content.",
    postsCount: (count) => `${count} posts`,
    repliesCount: (count) => `${count} replies`,
    emptySpaces: "No community spaces have been set up yet.",
    feedHeading: "Moderate latest posts",
    loadedPosts: (count) =>
      `${count} loaded posts in the paginated moderation preview`,
    refreshing: "The feed is reloading after an update",
    pinned: "Pinned",
    locked: "Locked",
    pin: "Pin post",
    unpin: "Unpin post",
    lockReplies: "Lock replies",
    unlockReplies: "Unlock replies",
    rejectPost: "Reject post",
    emptyPosts: "No posts yet.",
    morePosts: "More posts",
  },
  actionFallback: {
    success: "Change saved.",
    error: "The change could not be saved.",
  },
  actions: {
    accessSaveFailed: "The access rules could not be saved.",
    accessSaved: "Community access rules saved.",
    spaceSaveFailed: "The community space could not be saved.",
    spaceSaved: "Community space saved.",
    spaceMoveFailed: "The community space could not be moved.",
    spaceMoved: "Community space moved.",
    spaceDeleteFailed: "The community space could not be deleted.",
    spaceDeleted: "The community space and all its content were deleted.",
    areaCreateFailed: "The community area could not be created.",
    areaCreated: "Community area created.",
    areaSaveFailed: "The community area could not be saved.",
    areaSaved: "Community area saved.",
    areaMoveFailed: "The community area could not be moved.",
    areaMoved: "Community area moved.",
    areaDeleteFailed: "The community area could not be deleted.",
    areaDeleted: "Community area deleted.",
    profileSaveFailed:
      "The community profile configuration could not be saved.",
    profileSaved: "Community profile configuration saved.",
    badgeGroupSaveFailed: "The badge group could not be saved.",
    badgeGroupSaved: "Badge group saved.",
    badgeSaveFailed: "The badge could not be saved.",
    badgeSaved: "Badge saved.",
    badgeAssignmentFailed: "The badge assignment could not be changed.",
    badgeAwarded: "Badge awarded.",
    badgeRevoked: "Badge revoked.",
    moderationPolicySaveFailed: "The moderation rules could not be saved.",
    moderationPolicySaved: "Moderation rules saved.",
    levelsSaveFailed: "The level configuration could not be saved.",
    levelsSaved: "Community levels saved.",
    caseClaimFailed: "The case could not be claimed.",
    caseClaimed: "Moderation case claimed.",
    decisionFailed: "The decision could not be saved.",
    contentRejected: "Content rejected and hidden.",
    contentRestored: "Content restored.",
    contentApproved: "Content approved.",
    appealFailed: "The appeal could not be decided.",
    appealOverturned: "Appeal accepted and content restored.",
    appealUpheld: "Appeal reviewed and decision confirmed.",
    reportDecisionFailed: "The moderation decision could not be saved.",
    postToggleFailed: "The post status could not be changed.",
    postPinned: "Post pinned.",
    postUnpinned: "Post unpinned.",
    postLocked: "Replies locked.",
    postUnlocked: "Replies unlocked.",
    postRejectFailed: "The post could not be moderated.",
    postRejected: "Post rejected and hidden.",
    commentRejectFailed: "The reply could not be moderated.",
    commentRejected: "Reply rejected and hidden.",
  },
};

const it: CommunityAdminCopy = {
  ...en,
  common: {
    closeDialog: "Chiudi finestra",
    close: "Chiudi",
    cancel: "Annulla",
    save: "Salva",
    create: "Crea",
    remove: "Rimuovi",
    delete: "Elimina",
    deletePermanent: "Elimina definitivamente",
    edit: "Modifica",
    moveUp: "Sposta su",
    moveDown: "Sposta giù",
    active: "Attivo",
    inactive: "Inattivo",
    name: "Nome",
    description: "Descrizione",
    title: "Titolo",
    type: "Tipo",
    accentColor: "Colore di accento",
    actions: "Azioni",
    loading: "Caricamento",
    retry: "Riprova",
    post: "Post",
    reply: "Risposta",
    feed: "Feed",
    discussion: "Discussione",
    announcement: "Annuncio",
    noDescription: "Nessuna descrizione",
  },
  layout: {
    eyebrow: "Struttura",
    heading: "Aree e spazi",
    newArea: "Nuova area",
    newSpace: "Nuovo spazio",
    createSpaceTitle: "Crea spazio community",
    createSpaceEyebrow: "Apprendimento sociale",
    spaceTitlePlaceholder: "es. Buone pratiche",
    spaceDescriptionPlaceholder: "Argomenti e obiettivo di questo spazio",
    createSuccess: "Spazio community creato.",
    createError: "Non è stato possibile creare lo spazio community.",
    area: "Area",
    areaNamePlaceholder: "es. Scambio",
    areaDescriptionPlaceholder: "Argomenti di quest'area",
    cancelAreaCreation: "Annulla creazione area",
    cancelAreaEdit: (name) => `Interrompi modifica di ${name}`,
    spaceCount: (count) => `${count} spazi`,
    moveAreaUp: (name) => `Sposta ${name} in alto`,
    moveAreaDown: (name) => `Sposta ${name} in basso`,
    editArea: (name) => `Modifica ${name}`,
    deleteArea: (name) => `Elimina ${name}`,
    moveSpacesFirst: "Sposta prima tutti gli spazi",
    deleteEmptyArea: "Eliminare definitivamente l'area vuota?",
    assignArea: (name) => `Assegna ${name} a un'area`,
    moveSpaceUp: (name) => `Sposta ${name} in alto`,
    moveSpaceDown: (name) => `Sposta ${name} in basso`,
    editSpace: (name) => `Modifica ${name}`,
    deleteSpace: (name) => `Elimina ${name}`,
    confirmDelete: (name) => `Inserisci “${name}” per eliminare`,
    emptyArea: "Non ci sono ancora spazi in quest'area.",
    emptyLayout: "Non è stata ancora configurata alcuna area community.",
  },
  profile: {
    eyebrow: "Visibilità",
    heading: "Profili community pubblici",
    revision: (revision) => `Revisione ${revision}`,
    gate: "Profilo completo richiesto per pubblicare",
    impact: (incomplete, total) =>
      `Salvato: ${incomplete} di ${total} membri attivi verrebbero bloccati`,
    unsavedImpact:
      "Modifiche non salvate: l'impatto verrà ricalcolato al salvataggio.",
    standardFields: {
      avatar: "Immagine del profilo",
      job_title: "Ruolo",
      department: "Reparto",
      bio: "Profilo breve",
      community_points: "Punti community",
      badges: "Badge",
    },
    fieldTypes: {
      text: "Testo",
      number: "Numero",
      boolean: "Sì/No",
      date: "Data",
      select: "Selezione",
      multiselect: "Selezione multipla",
    },
    unknownField: "Campo sconosciuto",
    standardField: "Campo standard",
    customField: (type) => `Campo personalizzato | ${type}`,
    required: "Campo obbligatorio",
    moveUp: (label) => `Sposta ${label} in alto`,
    moveDown: (label) => `Sposta ${label} in basso`,
    removeField: (label) => `Rimuovi ${label} dal profilo pubblico`,
    removeFieldTitle: "Rimuovi campo",
    empty: "Nessun campo del profilo pubblico selezionato.",
    selectField: "Seleziona campo del profilo",
    standardGroup: "Campi standard",
    customGroup: "Campi personalizzati",
    add: "Aggiungi",
    requireOne: "Seleziona almeno un campo obbligatorio.",
    save: "Salva configurazione profilo",
  },
  access: {
    subjectTypes: {
      role: "Ruolo",
      user: "Persona",
      group: "Gruppo",
      bundle: "Pacchetto",
    },
    roles: {
      member: "Membro",
      trainer: "Formatore",
      admin: "Admin",
      owner: "Titolare",
    },
    unavailable: "Non più disponibile",
    targetType: "Tipo di destinatario",
    targetTypeAria: "Tipo di destinatario della regola",
    target: "Destinatario",
    selectTarget: (type) => `Seleziona ${type.toLowerCase()}`,
    permissions: "Permessi",
    read: "Lettura",
    contribute: "Pubblicazione",
    comment: "Commento",
    readDependency:
      "La lettura resta attiva finché Pubblicazione o Commento è attivo.",
    removeRule: "Rimuovi regola di accesso",
    accessModeFor: (title) => `Modalità di accesso per ${title}`,
    open: "Aperto",
    restricted: "Limitato",
    openForAll: "Per tutti i membri attivi",
    ruleCount: (count) =>
      `${count} ${count === "1" ? "regola individuale" : "regole individuali"}`,
    noRuleWarning:
      "Senza regole, questo spazio resta visibile solo a titolari e admin.",
    addRule: "Aggiungi regola",
    duplicate: "Ogni destinatario può comparire una sola volta.",
    invalidTarget: "Una regola non ha un destinatario valido.",
    missingRead: "Ogni regola richiede almeno il permesso di lettura.",
    save: "Salva permessi",
    heading: "Accesso agli spazi",
    spaceCount: (count) => `${count} ${count === "1" ? "spazio" : "spazi"}`,
    fallbackSpace: "Spazio community",
    empty: "Nessuno spazio community disponibile.",
  },
  badge: {
    heading: "Gruppi badge e riconoscimenti",
    groups: "Gruppi",
    badges: "Badge",
    manualAssignment: "Assegnazione manuale",
    groupName: "Nome del gruppo",
    description: "Descrizione",
    displayAll: "Mostra tutti",
    displayHighest: "Solo il più alto",
    sortOrder: "Ordinamento",
    active: "Attivo",
    save: "Salva",
    badgeName: "Nome badge",
    noGroup: "Senza gruppo",
    pointsOptional: "Punti facoltativi",
    color: "Colore",
    selectMember: "Seleziona membro",
    selectBadge: "Seleziona badge",
    award: "Assegna",
    automatic: "Automatico",
    revoke: "Revoca badge",
    revokeNamed: (name) => `Revoca ${name}`,
  },
  boost: {
    strengths: { light: "Leggero", medium: "Medio", high: "Alto" },
    views: { active: "Attivo", scheduled: "Programmato", expired: "Scaduto" },
    removeAria: "Rimuovi boost di portata",
    removeTitle: "Rimuovere il boost di portata?",
    removeDescription: (name) =>
      `La raccomandazione per ${name} viene rimossa subito dal controllo del feed.`,
    selectPersonError: "Seleziona una persona.",
    periodError: "Il periodo deve essere positivo e non superare 90 giorni.",
    reasonError: "Inserisci una breve motivazione interna.",
    saveFailed: "Non è stato possibile salvare il boost di portata.",
    saved: "Boost di portata salvato.",
    removeFailed: "Non è stato possibile rimuovere il boost di portata.",
    removed: "Boost di portata rimosso.",
    invalidResponse: "Non è stato possibile leggere la risposta del boost.",
    heading: "Boost di portata",
    description:
      "Consiglia per un periodo limitato i post di persone selezionate nel feed personale.",
    person: "Persona",
    selectPerson: "Seleziona persona",
    strength: "Intensità",
    startsAt: "Inizio",
    endsAt: "Fine",
    internalReason: "Motivazione interna",
    reasonPlaceholder: "Perché consigliare questa persona?",
    reset: "Reimposta",
    dateRange: (from, to) => `${from} - ${to}`,
    editNamed: (name) => `Modifica boost per ${name}`,
    removeNamed: (name) => `Rimuovi boost per ${name}`,
    empty: (view) => `Nessun boost con stato “${view}”.`,
  },
  governance: {
    approvals: {
      off: "Nessuna approvazione",
      members: "Controlla i membri",
      non_admins: "Controlla tutti tranne gli admin",
    },
    automations: {
      off: "Disattivata",
      observe: "Solo segnalazione",
      enforce: "Trattieni automaticamente",
    },
    posts: "Post",
    comments: "Commenti",
    automation: "Automazione",
    reportsUntilHold: "Segnalazioni prima del blocco",
    disabled: "Disattivato",
    duplicateWindow: "Finestra duplicati (min.)",
    maxLinks: "Link massimi",
    saveRules: "Salva regole",
    moderationHeading: "Approvazione e automazione",
    spaceAria: "Spazio community",
    emptySpaces: "Nessuno spazio community disponibile.",
    levelHeading: "Livelli community",
    addLevel: "Aggiungi livello",
    newLevel: "Nuovo livello",
    enabled: "Sistema di livelli attivo",
    position: "Posizione",
    pointsFrom: "Punti da",
    icon: "Icona",
    color: "Colore",
    removeLevel: "Rimuovi livello",
    removeNamed: (name) => `Rimuovi ${name}`,
    nameAndDescription: "Nome / descrizione",
    positionFor: (name) => `Posizione per ${name}`,
    levelName: "Nome livello",
    descriptionFor: (name) => `Descrizione per ${name}`,
    thresholdFor: (name) => `Soglia punti per ${name}`,
    iconFor: (name) => `Icona per ${name}`,
    colorFor: (name) => `Colore per ${name}`,
    activeNamed: (name) => `${name} attivo`,
    emptyLevels: "Nessun livello definito.",
    saveLevels: "Salva livelli",
  },
  queue: {
    reasons: {
      approval_required: "Approvazione richiesta",
      report_threshold: "Soglia segnalazioni raggiunta",
      duplicate: "Possibile duplicato",
      link_limit: "Limite link superato",
      manual: "Controllo manuale",
    },
    states: {
      pending: "In attesa",
      published: "Visibile",
      held: "Trattenuto",
      rejected: "Rifiutato",
    },
    decisionTitles: {
      approve: "Approva contenuto",
      reject: "Rifiuta contenuto",
      uphold: "Conferma decisione",
      overturn: "Accetta ricorso",
    },
    missingContent: "Contenuto non più disponibile.",
    note: "Motivazione",
    saveDecision: "Salva decisione",
    heading: "Casi di moderazione",
    openCount: (count) => `${count} aperti`,
    appeal: "Ricorso",
    reportCount: (count) =>
      `${count} ${count === "1" ? "segnalazione" : "segnalazioni"}`,
    authorAppeal: "Ricorso dell'autore",
    claim: "Prendi in carico",
    claimedByYou: "Assegnato a te",
    inReview: "In revisione",
    uphold: "Conferma",
    overturn: "Accetta",
    approve: "Approva",
    reject: "Rifiuta",
    empty: "Nessun caso di moderazione aperto.",
  },
  moderation: {
    ...en.moderation,
    reportReasons: {
      spam: "Spam o pubblicità",
      harassment: "Molestie",
      hate_speech: "Incitamento all'odio",
      misinformation: "Contenuto fuorviante",
      privacy: "Dati personali",
      other: "Altro motivo",
    },
    reportStatuses: {
      open: "Aperta",
      reviewing: "In revisione",
      resolved: "Contenuto rimosso",
      dismissed: "Respinta",
    },
    invalidPreview:
      "L'anteprima di moderazione ha restituito una risposta non valida.",
    loadMoreFailed: "Non è stato possibile caricare altri post.",
    editSpaceTitle: "Modifica spazio community",
    editSpaceEyebrow: "Impostazioni spazio",
    forumType: "Tipo di forum",
    colorHint: "Identifica lo spazio nel feed",
    saveChanges: "Salva modifiche",
    deleteSpaceTitle: "Elimina spazio e contenuti",
    irreversible: "Azione irreversibile",
    deleteAllContent: "Verranno eliminati anche tutti i contenuti.",
    deleteSpaceDetail: (posts, replies) =>
      `Lo spazio contiene ${posts} post e ${replies} risposte. Verranno rimossi anche i Mi piace e tutti gli altri collegamenti.`,
    confirmSpaceName: (name) => `Inserisci “${name}” per confermare`,
    confirmSpaceAria: "Conferma nome spazio",
    rejectTitle: (kind) => `Rifiuta ${kind.toLowerCase()}`,
    moderationEyebrow: "Moderazione community",
    postRejectDetail:
      "Il post viene rifiutato e nascosto ai membri. Contenuto, risposte e allegati vengono conservati per audit e possibili ricorsi. L'autore riceve una notifica.",
    replyRejectDetail:
      "La risposta viene rifiutata e nascosta ai membri. Contenuto e allegati vengono conservati per audit e possibili ricorsi. L'autore riceve una notifica.",
    removeContent: "Rimuovi contenuto",
    dismissReport: "Respingi segnalazione",
    decisionEyebrow: "Decisione di moderazione",
    contentBy: (kind, author) => `${kind} di ${author}`,
    internalReason: "Motivazione interna",
    rejectReplyBy: (name) => `Rifiuta risposta di ${name}`,
    rejectReply: "Rifiuta risposta",
    commentSummary: (visible, total) =>
      `${visible} di ${total} risposte nell'anteprima`,
    loadingReplies: "Caricamento risposte",
    loadReplies: "Carica risposte",
    loadMoreReplies: "Carica altre risposte",
    loadingComments: "Caricamento commenti",
    loadMoreComments: "Carica altri commenti",
    reportsHeading: "Segnalazioni di moderazione",
    openCases: (count) => `${count} casi aperti`,
    reportView: "Vista segnalazioni",
    openView: "Aperte",
    closedView: "Chiuse",
    reportedBy: "Segnalato da",
    author: "Autore",
    content: "Contenuto",
    decision: "Decisione",
    startReview: "Avvia revisione",
    dismiss: "Respingi",
    removeContentButton: "Rimuovi",
    noOpenReports: "Nessuna segnalazione aperta.",
    noClosedReports: "Nessuna segnalazione chiusa.",
    spacesHeading: "Gestisci spazi",
    spacesDescription:
      "Modifica titoli, descrizioni e colori oppure elimina spazi e contenuti.",
    postsCount: (count) => `${count} post`,
    repliesCount: (count) => `${count} risposte`,
    emptySpaces: "Nessuno spazio community configurato.",
    feedHeading: "Modera gli ultimi post",
    loadedPosts: (count) => `${count} post caricati nell'anteprima paginata`,
    refreshing: "Il feed si sta ricaricando dopo un aggiornamento",
    pinned: "Fissato",
    locked: "Bloccato",
    pin: "Fissa post",
    unpin: "Rimuovi fissaggio",
    lockReplies: "Blocca risposte",
    unlockReplies: "Sblocca risposte",
    rejectPost: "Rifiuta post",
    emptyPosts: "Nessun post.",
    morePosts: "Altri post",
  },
  actionFallback: {
    success: "Modifica salvata.",
    error: "Non è stato possibile salvare la modifica.",
  },
  actions: Object.fromEntries(
    Object.keys(en.actions).map((key) => [
      key,
      (
        {
          accessSaveFailed:
            "Non è stato possibile salvare le regole di accesso.",
          accessSaved: "Regole di accesso salvate.",
          spaceSaveFailed: "Non è stato possibile salvare lo spazio community.",
          spaceSaved: "Spazio community salvato.",
          spaceMoveFailed:
            "Non è stato possibile spostare lo spazio community.",
          spaceMoved: "Spazio community spostato.",
          spaceDeleteFailed:
            "Non è stato possibile eliminare lo spazio community.",
          spaceDeleted:
            "Lo spazio community e tutti i contenuti sono stati eliminati.",
          areaCreateFailed: "Non è stato possibile creare l'area community.",
          areaCreated: "Area community creata.",
          areaSaveFailed: "Non è stato possibile salvare l'area community.",
          areaSaved: "Area community salvata.",
          areaMoveFailed: "Non è stato possibile spostare l'area community.",
          areaMoved: "Area community spostata.",
          areaDeleteFailed: "Non è stato possibile eliminare l'area community.",
          areaDeleted: "Area community eliminata.",
          profileSaveFailed:
            "Non è stato possibile salvare la configurazione del profilo.",
          profileSaved: "Configurazione del profilo salvata.",
          badgeGroupSaveFailed:
            "Non è stato possibile salvare il gruppo badge.",
          badgeGroupSaved: "Gruppo badge salvato.",
          badgeSaveFailed: "Non è stato possibile salvare il badge.",
          badgeSaved: "Badge salvato.",
          badgeAssignmentFailed:
            "Non è stato possibile modificare l'assegnazione del badge.",
          badgeAwarded: "Badge assegnato.",
          badgeRevoked: "Badge revocato.",
          moderationPolicySaveFailed:
            "Non è stato possibile salvare le regole di moderazione.",
          moderationPolicySaved: "Regole di moderazione salvate.",
          levelsSaveFailed: "Non è stato possibile salvare i livelli.",
          levelsSaved: "Livelli community salvati.",
          caseClaimFailed: "Non è stato possibile prendere in carico il caso.",
          caseClaimed: "Caso di moderazione preso in carico.",
          decisionFailed: "Non è stato possibile salvare la decisione.",
          contentRejected: "Contenuto rifiutato e nascosto.",
          contentRestored: "Contenuto ripristinato.",
          contentApproved: "Contenuto approvato.",
          appealFailed: "Non è stato possibile decidere il ricorso.",
          appealOverturned: "Ricorso accettato e contenuto ripristinato.",
          appealUpheld: "Ricorso esaminato e decisione confermata.",
          reportDecisionFailed:
            "Non è stato possibile salvare la decisione di moderazione.",
          postToggleFailed:
            "Non è stato possibile modificare lo stato del post.",
          postPinned: "Post fissato.",
          postUnpinned: "Post non più fissato.",
          postLocked: "Risposte bloccate.",
          postUnlocked: "Risposte sbloccate.",
          postRejectFailed: "Non è stato possibile moderare il post.",
          postRejected: "Post rifiutato e nascosto.",
          commentRejectFailed: "Non è stato possibile moderare la risposta.",
          commentRejected: "Risposta rifiutata e nascosta.",
        } as Record<CommunityAdminActionCode, string>
      )[key as CommunityAdminActionCode],
    ]),
  ) as Record<CommunityAdminActionCode, string>,
};

const es: CommunityAdminCopy = {
  ...it,
  common: {
    closeDialog: "Cerrar diálogo",
    close: "Cerrar",
    cancel: "Cancelar",
    save: "Guardar",
    create: "Crear",
    remove: "Eliminar",
    delete: "Eliminar",
    deletePermanent: "Eliminar definitivamente",
    edit: "Editar",
    moveUp: "Subir",
    moveDown: "Bajar",
    active: "Activo",
    inactive: "Inactivo",
    name: "Nombre",
    description: "Descripción",
    title: "Título",
    type: "Tipo",
    accentColor: "Color de acento",
    actions: "Acciones",
    loading: "Cargando",
    retry: "Reintentar",
    post: "Publicación",
    reply: "Respuesta",
    feed: "Feed",
    discussion: "Debate",
    announcement: "Anuncio",
    noDescription: "Sin descripción",
  },
  layout: {
    eyebrow: "Estructura",
    heading: "Áreas y espacios",
    newArea: "Nueva área",
    newSpace: "Nuevo espacio",
    createSpaceTitle: "Crear espacio de comunidad",
    createSpaceEyebrow: "Aprendizaje social",
    spaceTitlePlaceholder: "p. ej. Buenas prácticas",
    spaceDescriptionPlaceholder: "Temas y objetivo de este espacio",
    createSuccess: "Espacio de comunidad creado.",
    createError: "No se pudo crear el espacio de comunidad.",
    area: "Área",
    areaNamePlaceholder: "p. ej. Intercambio",
    areaDescriptionPlaceholder: "Temas de esta área",
    cancelAreaCreation: "Cancelar creación del área",
    cancelAreaEdit: (name) => `Dejar de editar ${name}`,
    spaceCount: (count) => `${count} espacios`,
    moveAreaUp: (name) => `Subir ${name}`,
    moveAreaDown: (name) => `Bajar ${name}`,
    editArea: (name) => `Editar ${name}`,
    deleteArea: (name) => `Eliminar ${name}`,
    moveSpacesFirst: "Mueve primero todos los espacios",
    deleteEmptyArea: "¿Eliminar definitivamente el área vacía?",
    assignArea: (name) => `Asignar ${name} a un área`,
    moveSpaceUp: (name) => `Subir ${name}`,
    moveSpaceDown: (name) => `Bajar ${name}`,
    editSpace: (name) => `Editar ${name}`,
    deleteSpace: (name) => `Eliminar ${name}`,
    confirmDelete: (name) => `Escribe “${name}” para eliminar`,
    emptyArea: "Todavía no hay espacios en esta área.",
    emptyLayout: "Todavía no se ha configurado ningún área de comunidad.",
  },
  profile: {
    ...it.profile,
    eyebrow: "Visibilidad",
    heading: "Perfiles públicos de la comunidad",
    revision: (revision) => `Revisión ${revision}`,
    gate: "Perfil completo obligatorio para publicar",
    impact: (incomplete, total) =>
      `Guardado: se bloquearían ${incomplete} de ${total} miembros activos`,
    unsavedImpact: "Cambios sin guardar: el impacto se recalculará al guardar.",
    standardFields: {
      avatar: "Imagen de perfil",
      job_title: "Puesto",
      department: "Departamento",
      bio: "Perfil breve",
      community_points: "Puntos de comunidad",
      badges: "Insignias",
    },
    fieldTypes: {
      text: "Texto",
      number: "Número",
      boolean: "Sí/No",
      date: "Fecha",
      select: "Selección",
      multiselect: "Selección múltiple",
    },
    unknownField: "Campo desconocido",
    standardField: "Campo estándar",
    customField: (type) => `Campo personalizado | ${type}`,
    required: "Campo obligatorio",
    moveUp: (label) => `Subir ${label}`,
    moveDown: (label) => `Bajar ${label}`,
    removeField: (label) => `Eliminar ${label} del perfil público`,
    removeFieldTitle: "Eliminar campo",
    empty: "No hay campos de perfil público seleccionados.",
    selectField: "Seleccionar campo de perfil",
    standardGroup: "Campos estándar",
    customGroup: "Campos personalizados",
    add: "Añadir",
    requireOne: "Selecciona al menos un campo obligatorio.",
    save: "Guardar configuración del perfil",
  },
  access: {
    ...it.access,
    subjectTypes: {
      role: "Rol",
      user: "Persona",
      group: "Grupo",
      bundle: "Paquete",
    },
    roles: {
      member: "Miembro",
      trainer: "Formador",
      admin: "Admin",
      owner: "Propietario",
    },
    unavailable: "Ya no está disponible",
    targetType: "Tipo de destino",
    targetTypeAria: "Tipo de destino de la regla",
    target: "Destino",
    selectTarget: (type) => `Seleccionar ${type.toLowerCase()}`,
    permissions: "Permisos",
    read: "Leer",
    contribute: "Publicar",
    comment: "Comentar",
    readDependency:
      "Leer permanece activo mientras Publicar o Comentar esté activo.",
    removeRule: "Eliminar regla de acceso",
    accessModeFor: (title) => `Modo de acceso para ${title}`,
    open: "Abierto",
    restricted: "Restringido",
    openForAll: "Para todos los miembros activos",
    ruleCount: (count) =>
      `${count} ${count === "1" ? "regla individual" : "reglas individuales"}`,
    noRuleWarning:
      "Sin reglas, este espacio solo será visible para propietarios y administradores.",
    addRule: "Añadir regla",
    duplicate: "Cada destino solo puede aparecer una vez.",
    invalidTarget: "Una regla no tiene un destino válido.",
    missingRead: "Cada regla necesita al menos permiso de lectura.",
    save: "Guardar permisos",
    heading: "Acceso a espacios",
    spaceCount: (count) => `${count} ${count === "1" ? "espacio" : "espacios"}`,
    fallbackSpace: "Espacio de comunidad",
    empty: "No hay espacios de comunidad.",
  },
  badge: {
    heading: "Grupos de insignias y premios",
    groups: "Grupos",
    badges: "Insignias",
    manualAssignment: "Asignación manual",
    groupName: "Nombre del grupo",
    description: "Descripción",
    displayAll: "Mostrar todas",
    displayHighest: "Solo la más alta",
    sortOrder: "Orden",
    active: "Activo",
    save: "Guardar",
    badgeName: "Nombre de la insignia",
    noGroup: "Sin grupo",
    pointsOptional: "Puntos opcionales",
    color: "Color",
    selectMember: "Seleccionar miembro",
    selectBadge: "Seleccionar insignia",
    award: "Conceder",
    automatic: "Automática",
    revoke: "Revocar insignia",
    revokeNamed: (name) => `Revocar ${name}`,
  },
  boost: {
    strengths: { light: "Ligero", medium: "Medio", high: "Alto" },
    views: { active: "Activo", scheduled: "Programado", expired: "Caducado" },
    removeAria: "Eliminar impulso de alcance",
    removeTitle: "¿Eliminar impulso de alcance?",
    removeDescription: (name) =>
      `La recomendación para ${name} se elimina de inmediato del control del feed.`,
    selectPersonError: "Selecciona una persona.",
    periodError: "El periodo debe ser positivo y no superar 90 días.",
    reasonError: "Indica un breve motivo interno.",
    saveFailed: "No se pudo guardar el impulso de alcance.",
    saved: "Impulso de alcance guardado.",
    removeFailed: "No se pudo eliminar el impulso de alcance.",
    removed: "Impulso de alcance eliminado.",
    invalidResponse: "No se pudo leer la respuesta del impulso.",
    heading: "Impulsos de alcance",
    description:
      "Recomienda durante un tiempo limitado publicaciones de personas seleccionadas en el feed personal.",
    person: "Persona",
    selectPerson: "Seleccionar persona",
    strength: "Intensidad",
    startsAt: "Inicio",
    endsAt: "Fin",
    internalReason: "Motivo interno",
    reasonPlaceholder: "¿Por qué se debe recomendar a esta persona?",
    reset: "Restablecer",
    dateRange: (from, to) => `${from} a ${to}`,
    editNamed: (name) => `Editar impulso para ${name}`,
    removeNamed: (name) => `Eliminar impulso para ${name}`,
    empty: (view) => `No hay impulsos con estado “${view}”.`,
  },
  governance: {
    ...it.governance,
    approvals: {
      off: "Sin aprobación",
      members: "Revisar miembros",
      non_admins: "Revisar a todos excepto administradores",
    },
    automations: {
      off: "Desactivada",
      observe: "Solo marcar",
      enforce: "Retener automáticamente",
    },
    posts: "Publicaciones",
    comments: "Comentarios",
    automation: "Automatización",
    reportsUntilHold: "Denuncias hasta retención",
    disabled: "Desactivado",
    duplicateWindow: "Ventana de duplicados (min.)",
    maxLinks: "Enlaces máximos",
    saveRules: "Guardar reglas",
    moderationHeading: "Aprobación y automatización",
    spaceAria: "Espacio de comunidad",
    emptySpaces: "No hay espacios de comunidad.",
    levelHeading: "Niveles de comunidad",
    addLevel: "Añadir nivel",
    newLevel: "Nuevo nivel",
    enabled: "Sistema de niveles activo",
    position: "Posición",
    pointsFrom: "Desde puntos",
    icon: "Icono",
    color: "Color",
    removeLevel: "Eliminar nivel",
    removeNamed: (name) => `Eliminar ${name}`,
    nameAndDescription: "Nombre / descripción",
    positionFor: (name) => `Posición de ${name}`,
    levelName: "Nombre del nivel",
    descriptionFor: (name) => `Descripción de ${name}`,
    thresholdFor: (name) => `Umbral de puntos de ${name}`,
    iconFor: (name) => `Icono de ${name}`,
    colorFor: (name) => `Color de ${name}`,
    activeNamed: (name) => `${name} activo`,
    emptyLevels: "No hay niveles definidos.",
    saveLevels: "Guardar niveles",
  },
  queue: {
    ...it.queue,
    reasons: {
      approval_required: "Aprobación necesaria",
      report_threshold: "Umbral de denuncias alcanzado",
      duplicate: "Posible duplicado",
      link_limit: "Límite de enlaces superado",
      manual: "Revisión manual",
    },
    states: {
      pending: "En espera",
      published: "Visible",
      held: "Retenido",
      rejected: "Rechazado",
    },
    decisionTitles: {
      approve: "Aprobar contenido",
      reject: "Rechazar contenido",
      uphold: "Confirmar decisión",
      overturn: "Aceptar recurso",
    },
    missingContent: "El contenido ya no está disponible.",
    note: "Motivo",
    saveDecision: "Guardar decisión",
    heading: "Casos de moderación",
    openCount: (count) => `${count} abiertos`,
    appeal: "Recurso",
    reportCount: (count) =>
      `${count} ${count === "1" ? "denuncia" : "denuncias"}`,
    authorAppeal: "Recurso del autor",
    claim: "Asumir",
    claimedByYou: "Asignado a ti",
    inReview: "En revisión",
    uphold: "Confirmar",
    overturn: "Aceptar",
    approve: "Aprobar",
    reject: "Rechazar",
    empty: "No hay casos de moderación abiertos.",
  },
  moderation: {
    ...it.moderation,
    reportReasons: {
      spam: "Spam o publicidad",
      harassment: "Acoso",
      hate_speech: "Discurso de odio",
      misinformation: "Contenido engañoso",
      privacy: "Datos personales",
      other: "Otro motivo",
    },
    reportStatuses: {
      open: "Abierta",
      reviewing: "En revisión",
      resolved: "Contenido eliminado",
      dismissed: "Desestimada",
    },
    invalidPreview:
      "La vista previa de moderación devolvió una respuesta no válida.",
    loadMoreFailed: "No se pudieron cargar más publicaciones.",
    editSpaceTitle: "Editar espacio de comunidad",
    editSpaceEyebrow: "Configuración del espacio",
    forumType: "Tipo de foro",
    colorHint: "Identifica el espacio en el feed",
    saveChanges: "Guardar cambios",
    deleteSpaceTitle: "Eliminar espacio y contenido",
    irreversible: "Acción irreversible",
    deleteAllContent: "También se eliminará todo el contenido.",
    deleteSpaceDetail: (posts, replies) =>
      `El espacio contiene ${posts} publicaciones y ${replies} respuestas. También se eliminarán los Me gusta y todos los vínculos.`,
    confirmSpaceName: (name) => `Escribe “${name}” para confirmar`,
    confirmSpaceAria: "Confirmar nombre del espacio",
    rejectTitle: (kind) => `Rechazar ${kind.toLowerCase()}`,
    moderationEyebrow: "Moderación de la comunidad",
    postRejectDetail:
      "La publicación se rechaza y se oculta a los miembros. El contenido, las respuestas y los archivos se conservan para auditoría y posibles recursos. El autor recibe una notificación.",
    replyRejectDetail:
      "La respuesta se rechaza y se oculta a los miembros. El contenido y los archivos se conservan para auditoría y posibles recursos. El autor recibe una notificación.",
    removeContent: "Eliminar contenido",
    dismissReport: "Desestimar denuncia",
    decisionEyebrow: "Decisión de moderación",
    contentBy: (kind, author) => `${kind} de ${author}`,
    internalReason: "Motivo interno",
    rejectReplyBy: (name) => `Rechazar respuesta de ${name}`,
    rejectReply: "Rechazar respuesta",
    commentSummary: (visible, total) =>
      `${visible} de ${total} respuestas en la vista previa`,
    loadingReplies: "Cargando respuestas",
    loadReplies: "Cargar respuestas",
    loadMoreReplies: "Cargar más respuestas",
    loadingComments: "Cargando comentarios",
    loadMoreComments: "Cargar más comentarios",
    reportsHeading: "Denuncias de moderación",
    openCases: (count) => `${count} casos abiertos`,
    reportView: "Vista de denuncias",
    openView: "Abiertas",
    closedView: "Cerradas",
    reportedBy: "Denunciado por",
    author: "Autor",
    content: "Contenido",
    decision: "Decisión",
    startReview: "Iniciar revisión",
    dismiss: "Desestimar",
    removeContentButton: "Eliminar",
    noOpenReports: "No hay denuncias abiertas.",
    noClosedReports: "Aún no hay denuncias cerradas.",
    spacesHeading: "Gestionar espacios",
    spacesDescription:
      "Edita títulos, descripciones y colores o elimina espacios y su contenido.",
    postsCount: (count) => `${count} publicaciones`,
    repliesCount: (count) => `${count} respuestas`,
    emptySpaces: "No hay espacios de comunidad configurados.",
    feedHeading: "Moderar últimas publicaciones",
    loadedPosts: (count) =>
      `${count} publicaciones cargadas en la vista previa paginada`,
    refreshing: "El feed se está recargando tras una actualización",
    pinned: "Fijada",
    locked: "Bloqueada",
    pin: "Fijar publicación",
    unpin: "Desfijar publicación",
    lockReplies: "Bloquear respuestas",
    unlockReplies: "Desbloquear respuestas",
    rejectPost: "Rechazar publicación",
    emptyPosts: "No hay publicaciones.",
    morePosts: "Más publicaciones",
  },
  actionFallback: {
    success: "Cambio guardado.",
    error: "No se pudo guardar el cambio.",
  },
  actions: Object.fromEntries(
    Object.keys(en.actions).map((key) => [
      key,
      (
        {
          accessSaveFailed: "No se pudieron guardar las reglas de acceso.",
          accessSaved: "Reglas de acceso guardadas.",
          spaceSaveFailed: "No se pudo guardar el espacio de comunidad.",
          spaceSaved: "Espacio de comunidad guardado.",
          spaceMoveFailed: "No se pudo mover el espacio de comunidad.",
          spaceMoved: "Espacio de comunidad movido.",
          spaceDeleteFailed: "No se pudo eliminar el espacio de comunidad.",
          spaceDeleted:
            "El espacio de comunidad y todo su contenido se eliminaron.",
          areaCreateFailed: "No se pudo crear el área de comunidad.",
          areaCreated: "Área de comunidad creada.",
          areaSaveFailed: "No se pudo guardar el área de comunidad.",
          areaSaved: "Área de comunidad guardada.",
          areaMoveFailed: "No se pudo mover el área de comunidad.",
          areaMoved: "Área de comunidad movida.",
          areaDeleteFailed: "No se pudo eliminar el área de comunidad.",
          areaDeleted: "Área de comunidad eliminada.",
          profileSaveFailed: "No se pudo guardar la configuración del perfil.",
          profileSaved: "Configuración del perfil guardada.",
          badgeGroupSaveFailed: "No se pudo guardar el grupo de insignias.",
          badgeGroupSaved: "Grupo de insignias guardado.",
          badgeSaveFailed: "No se pudo guardar la insignia.",
          badgeSaved: "Insignia guardada.",
          badgeAssignmentFailed:
            "No se pudo cambiar la asignación de la insignia.",
          badgeAwarded: "Insignia concedida.",
          badgeRevoked: "Insignia revocada.",
          moderationPolicySaveFailed:
            "No se pudieron guardar las reglas de moderación.",
          moderationPolicySaved: "Reglas de moderación guardadas.",
          levelsSaveFailed: "No se pudo guardar la configuración de niveles.",
          levelsSaved: "Niveles de comunidad guardados.",
          caseClaimFailed: "No se pudo asumir el caso.",
          caseClaimed: "Caso de moderación asumido.",
          decisionFailed: "No se pudo guardar la decisión.",
          contentRejected: "Contenido rechazado y oculto.",
          contentRestored: "Contenido restaurado.",
          contentApproved: "Contenido aprobado.",
          appealFailed: "No se pudo decidir el recurso.",
          appealOverturned: "Recurso aceptado y contenido restaurado.",
          appealUpheld: "Recurso revisado y decisión confirmada.",
          reportDecisionFailed: "No se pudo guardar la decisión de moderación.",
          postToggleFailed: "No se pudo cambiar el estado de la publicación.",
          postPinned: "Publicación fijada.",
          postUnpinned: "Publicación desfijada.",
          postLocked: "Respuestas bloqueadas.",
          postUnlocked: "Respuestas desbloqueadas.",
          postRejectFailed: "No se pudo moderar la publicación.",
          postRejected: "Publicación rechazada y oculta.",
          commentRejectFailed: "No se pudo moderar la respuesta.",
          commentRejected: "Respuesta rechazada y oculta.",
        } as Record<CommunityAdminActionCode, string>
      )[key as CommunityAdminActionCode],
    ]),
  ) as Record<CommunityAdminActionCode, string>,
};

const fr: CommunityAdminCopy = {
  ...es,
  common: {
    closeDialog: "Fermer la boîte de dialogue",
    close: "Fermer",
    cancel: "Annuler",
    save: "Enregistrer",
    create: "Créer",
    remove: "Supprimer",
    delete: "Supprimer",
    deletePermanent: "Supprimer définitivement",
    edit: "Modifier",
    moveUp: "Monter",
    moveDown: "Descendre",
    active: "Actif",
    inactive: "Inactif",
    name: "Nom",
    description: "Description",
    title: "Titre",
    type: "Type",
    accentColor: "Couleur d'accent",
    actions: "Actions",
    loading: "Chargement",
    retry: "Réessayer",
    post: "Publication",
    reply: "Réponse",
    feed: "Fil",
    discussion: "Discussion",
    announcement: "Annonce",
    noDescription: "Aucune description",
  },
  layout: {
    eyebrow: "Structure",
    heading: "Zones et espaces",
    newArea: "Nouvelle zone",
    newSpace: "Nouvel espace",
    createSpaceTitle: "Créer un espace de communauté",
    createSpaceEyebrow: "Apprentissage social",
    spaceTitlePlaceholder: "p. ex. Bonnes pratiques",
    spaceDescriptionPlaceholder: "Thèmes et objectif de cet espace",
    createSuccess: "Espace de communauté créé.",
    createError: "L'espace de communauté n'a pas pu être créé.",
    area: "Zone",
    areaNamePlaceholder: "p. ex. Échanges",
    areaDescriptionPlaceholder: "Thèmes de cette zone",
    cancelAreaCreation: "Annuler la création de la zone",
    cancelAreaEdit: (name) => `Arrêter de modifier ${name}`,
    spaceCount: (count) => `${count} espaces`,
    moveAreaUp: (name) => `Monter ${name}`,
    moveAreaDown: (name) => `Descendre ${name}`,
    editArea: (name) => `Modifier ${name}`,
    deleteArea: (name) => `Supprimer ${name}`,
    moveSpacesFirst: "Déplacez d'abord tous les espaces",
    deleteEmptyArea: "Supprimer définitivement la zone vide ?",
    assignArea: (name) => `Affecter ${name} à une zone`,
    moveSpaceUp: (name) => `Monter ${name}`,
    moveSpaceDown: (name) => `Descendre ${name}`,
    editSpace: (name) => `Modifier ${name}`,
    deleteSpace: (name) => `Supprimer ${name}`,
    confirmDelete: (name) => `Saisissez « ${name} » pour supprimer`,
    emptyArea: "Aucun espace dans cette zone.",
    emptyLayout: "Aucune zone de communauté n'a encore été configurée.",
  },
  profile: {
    ...es.profile,
    eyebrow: "Visibilité",
    heading: "Profils publics de la communauté",
    revision: (revision) => `Révision ${revision}`,
    gate: "Profil complet requis pour publier",
    impact: (incomplete, total) =>
      `Enregistré : ${incomplete} membres actifs sur ${total} seraient bloqués`,
    unsavedImpact:
      "Modifications non enregistrées : l'impact sera recalculé lors de l'enregistrement.",
    standardFields: {
      avatar: "Photo de profil",
      job_title: "Fonction",
      department: "Service",
      bio: "Profil court",
      community_points: "Points de communauté",
      badges: "Badges",
    },
    fieldTypes: {
      text: "Texte",
      number: "Nombre",
      boolean: "Oui/Non",
      date: "Date",
      select: "Sélection",
      multiselect: "Sélection multiple",
    },
    unknownField: "Champ inconnu",
    standardField: "Champ standard",
    customField: (type) => `Champ personnalisé | ${type}`,
    required: "Champ obligatoire",
    moveUp: (label) => `Monter ${label}`,
    moveDown: (label) => `Descendre ${label}`,
    removeField: (label) => `Supprimer ${label} du profil public`,
    removeFieldTitle: "Supprimer le champ",
    empty: "Aucun champ de profil public sélectionné.",
    selectField: "Sélectionner un champ de profil",
    standardGroup: "Champs standard",
    customGroup: "Champs personnalisés",
    add: "Ajouter",
    requireOne: "Sélectionnez au moins un champ obligatoire.",
    save: "Enregistrer la configuration du profil",
  },
  access: {
    ...es.access,
    subjectTypes: {
      role: "Rôle",
      user: "Personne",
      group: "Groupe",
      bundle: "Offre groupée",
    },
    roles: {
      member: "Membre",
      trainer: "Formateur",
      admin: "Admin",
      owner: "Propriétaire",
    },
    unavailable: "Plus disponible",
    targetType: "Type de cible",
    targetTypeAria: "Type de cible de la règle",
    target: "Cible",
    selectTarget: (type) => `Sélectionner ${type.toLowerCase()}`,
    permissions: "Autorisations",
    read: "Lire",
    contribute: "Publier",
    comment: "Commenter",
    readDependency: "Lire reste actif tant que Publier ou Commenter est actif.",
    removeRule: "Supprimer la règle d'accès",
    accessModeFor: (title) => `Mode d'accès pour ${title}`,
    open: "Ouvert",
    restricted: "Restreint",
    openForAll: "Pour tous les membres actifs",
    ruleCount: (count) =>
      `${count} ${count === "1" ? "règle individuelle" : "règles individuelles"}`,
    noRuleWarning:
      "Sans règle, cet espace reste visible uniquement pour les propriétaires et les admins.",
    addRule: "Ajouter une règle",
    duplicate: "Chaque cible ne peut apparaître qu'une fois.",
    invalidTarget: "Une règle n'a pas de cible valide.",
    missingRead: "Chaque règle requiert au moins l'autorisation de lecture.",
    save: "Enregistrer les autorisations",
    heading: "Accès aux espaces",
    spaceCount: (count) => `${count} ${count === "1" ? "espace" : "espaces"}`,
    fallbackSpace: "Espace de communauté",
    empty: "Aucun espace de communauté disponible.",
  },
  badge: {
    heading: "Groupes de badges et récompenses",
    groups: "Groupes",
    badges: "Badges",
    manualAssignment: "Attribution manuelle",
    groupName: "Nom du groupe",
    description: "Description",
    displayAll: "Tout afficher",
    displayHighest: "Le plus élevé seulement",
    sortOrder: "Ordre",
    active: "Actif",
    save: "Enregistrer",
    badgeName: "Nom du badge",
    noGroup: "Sans groupe",
    pointsOptional: "Points facultatifs",
    color: "Couleur",
    selectMember: "Sélectionner un membre",
    selectBadge: "Sélectionner un badge",
    award: "Attribuer",
    automatic: "Automatique",
    revoke: "Retirer le badge",
    revokeNamed: (name) => `Retirer ${name}`,
  },
  boost: {
    strengths: { light: "Léger", medium: "Moyen", high: "Élevé" },
    views: { active: "Actif", scheduled: "Planifié", expired: "Expiré" },
    removeAria: "Supprimer la mise en avant",
    removeTitle: "Supprimer la mise en avant ?",
    removeDescription: (name) =>
      `La recommandation de ${name} est immédiatement retirée du contrôle du fil.`,
    selectPersonError: "Sélectionnez une personne.",
    periodError: "La période doit être positive et ne pas dépasser 90 jours.",
    reasonError: "Indiquez un court motif interne.",
    saveFailed: "La mise en avant n'a pas pu être enregistrée.",
    saved: "Mise en avant enregistrée.",
    removeFailed: "La mise en avant n'a pas pu être supprimée.",
    removed: "Mise en avant supprimée.",
    invalidResponse: "La réponse de mise en avant n'a pas pu être lue.",
    heading: "Mises en avant",
    description:
      "Recommandez pendant une durée limitée les publications de personnes sélectionnées dans le fil personnel.",
    person: "Personne",
    selectPerson: "Sélectionner une personne",
    strength: "Intensité",
    startsAt: "Début",
    endsAt: "Fin",
    internalReason: "Motif interne",
    reasonPlaceholder: "Pourquoi recommander cette personne ?",
    reset: "Réinitialiser",
    dateRange: (from, to) => `${from} au ${to}`,
    editNamed: (name) => `Modifier la mise en avant de ${name}`,
    removeNamed: (name) => `Supprimer la mise en avant de ${name}`,
    empty: (view) => `Aucune mise en avant avec le statut « ${view} ».`,
  },
  governance: {
    ...es.governance,
    approvals: {
      off: "Sans approbation",
      members: "Examiner les membres",
      non_admins: "Examiner tout le monde sauf les admins",
    },
    automations: {
      off: "Désactivée",
      observe: "Signaler seulement",
      enforce: "Retenir automatiquement",
    },
    posts: "Publications",
    comments: "Commentaires",
    automation: "Automatisation",
    reportsUntilHold: "Signalements avant retenue",
    disabled: "Désactivé",
    duplicateWindow: "Fenêtre de doublons (min.)",
    maxLinks: "Liens maximum",
    saveRules: "Enregistrer les règles",
    moderationHeading: "Approbation et automatisation",
    spaceAria: "Espace de communauté",
    emptySpaces: "Aucun espace de communauté disponible.",
    levelHeading: "Niveaux de communauté",
    addLevel: "Ajouter un niveau",
    newLevel: "Nouveau niveau",
    enabled: "Système de niveaux actif",
    position: "Position",
    pointsFrom: "À partir de points",
    icon: "Icône",
    color: "Couleur",
    removeLevel: "Supprimer le niveau",
    removeNamed: (name) => `Supprimer ${name}`,
    nameAndDescription: "Nom / description",
    positionFor: (name) => `Position de ${name}`,
    levelName: "Nom du niveau",
    descriptionFor: (name) => `Description de ${name}`,
    thresholdFor: (name) => `Seuil de points de ${name}`,
    iconFor: (name) => `Icône de ${name}`,
    colorFor: (name) => `Couleur de ${name}`,
    activeNamed: (name) => `${name} actif`,
    emptyLevels: "Aucun niveau défini.",
    saveLevels: "Enregistrer les niveaux",
  },
  queue: {
    ...es.queue,
    reasons: {
      approval_required: "Approbation requise",
      report_threshold: "Seuil de signalements atteint",
      duplicate: "Doublon possible",
      link_limit: "Limite de liens dépassée",
      manual: "Examen manuel",
    },
    states: {
      pending: "En attente",
      published: "Visible",
      held: "Retenu",
      rejected: "Refusé",
    },
    decisionTitles: {
      approve: "Approuver le contenu",
      reject: "Refuser le contenu",
      uphold: "Confirmer la décision",
      overturn: "Accepter le recours",
    },
    missingContent: "Le contenu n'est plus disponible.",
    note: "Motif",
    saveDecision: "Enregistrer la décision",
    heading: "Cas de modération",
    openCount: (count) => `${count} ouverts`,
    appeal: "Recours",
    reportCount: (count) =>
      `${count} ${count === "1" ? "signalement" : "signalements"}`,
    authorAppeal: "Recours de l'auteur",
    claim: "Prendre en charge",
    claimedByYou: "Assigné à vous",
    inReview: "En examen",
    uphold: "Confirmer",
    overturn: "Accepter",
    approve: "Approuver",
    reject: "Refuser",
    empty: "Aucun cas de modération ouvert.",
  },
  moderation: {
    ...es.moderation,
    reportReasons: {
      spam: "Spam ou publicité",
      harassment: "Harcèlement",
      hate_speech: "Discours haineux",
      misinformation: "Contenu trompeur",
      privacy: "Données personnelles",
      other: "Autre motif",
    },
    reportStatuses: {
      open: "Ouvert",
      reviewing: "En examen",
      resolved: "Contenu supprimé",
      dismissed: "Rejeté",
    },
    invalidPreview: "L'aperçu de modération a renvoyé une réponse non valide.",
    loadMoreFailed: "D'autres publications n'ont pas pu être chargées.",
    editSpaceTitle: "Modifier l'espace de communauté",
    editSpaceEyebrow: "Paramètres de l'espace",
    forumType: "Type de forum",
    colorHint: "Identifie l'espace dans le fil",
    saveChanges: "Enregistrer les modifications",
    deleteSpaceTitle: "Supprimer l'espace et le contenu",
    irreversible: "Action irréversible",
    deleteAllContent: "Tout le contenu sera également supprimé.",
    deleteSpaceDetail: (posts, replies) =>
      `L'espace contient ${posts} publications et ${replies} réponses. Les mentions J'aime et tous les autres liens seront aussi supprimés.`,
    confirmSpaceName: (name) => `Saisissez « ${name} » pour confirmer`,
    confirmSpaceAria: "Confirmer le nom de l'espace",
    rejectTitle: (kind) => `Refuser ${kind.toLowerCase()}`,
    moderationEyebrow: "Modération de la communauté",
    postRejectDetail:
      "La publication est refusée et masquée aux membres. Le contenu, les réponses et les pièces jointes sont conservés pour l'audit et un éventuel recours. L'auteur reçoit une notification.",
    replyRejectDetail:
      "La réponse est refusée et masquée aux membres. Le contenu et les pièces jointes sont conservés pour l'audit et un éventuel recours. L'auteur reçoit une notification.",
    removeContent: "Supprimer le contenu",
    dismissReport: "Rejeter le signalement",
    decisionEyebrow: "Décision de modération",
    contentBy: (kind, author) => `${kind} de ${author}`,
    internalReason: "Motif interne",
    rejectReplyBy: (name) => `Refuser la réponse de ${name}`,
    rejectReply: "Refuser la réponse",
    commentSummary: (visible, total) =>
      `${visible} réponses sur ${total} dans l'aperçu`,
    loadingReplies: "Chargement des réponses",
    loadReplies: "Charger les réponses",
    loadMoreReplies: "Charger plus de réponses",
    loadingComments: "Chargement des commentaires",
    loadMoreComments: "Charger plus de commentaires",
    reportsHeading: "Signalements de modération",
    openCases: (count) => `${count} cas ouverts`,
    reportView: "Vue des signalements",
    openView: "Ouverts",
    closedView: "Fermés",
    reportedBy: "Signalé par",
    author: "Auteur",
    content: "Contenu",
    decision: "Décision",
    startReview: "Commencer l'examen",
    dismiss: "Rejeter",
    removeContentButton: "Supprimer",
    noOpenReports: "Aucun signalement ouvert.",
    noClosedReports: "Aucun signalement fermé.",
    spacesHeading: "Gérer les espaces",
    spacesDescription:
      "Modifiez les titres, descriptions et couleurs, ou supprimez les espaces et leur contenu.",
    postsCount: (count) => `${count} publications`,
    repliesCount: (count) => `${count} réponses`,
    emptySpaces: "Aucun espace de communauté configuré.",
    feedHeading: "Modérer les dernières publications",
    loadedPosts: (count) =>
      `${count} publications chargées dans l'aperçu paginé`,
    refreshing: "Le fil se recharge après une mise à jour",
    pinned: "Épinglé",
    locked: "Verrouillé",
    pin: "Épingler la publication",
    unpin: "Désépingler la publication",
    lockReplies: "Verrouiller les réponses",
    unlockReplies: "Déverrouiller les réponses",
    rejectPost: "Refuser la publication",
    emptyPosts: "Aucune publication.",
    morePosts: "Plus de publications",
  },
  actionFallback: {
    success: "Modification enregistrée.",
    error: "La modification n'a pas pu être enregistrée.",
  },
  actions: Object.fromEntries(
    Object.keys(en.actions).map((key) => [
      key,
      (
        {
          accessSaveFailed:
            "Les règles d'accès n'ont pas pu être enregistrées.",
          accessSaved: "Règles d'accès enregistrées.",
          spaceSaveFailed: "L'espace de communauté n'a pas pu être enregistré.",
          spaceSaved: "Espace de communauté enregistré.",
          spaceMoveFailed: "L'espace de communauté n'a pas pu être déplacé.",
          spaceMoved: "Espace de communauté déplacé.",
          spaceDeleteFailed: "L'espace de communauté n'a pas pu être supprimé.",
          spaceDeleted:
            "L'espace de communauté et tout son contenu ont été supprimés.",
          areaCreateFailed: "La zone de communauté n'a pas pu être créée.",
          areaCreated: "Zone de communauté créée.",
          areaSaveFailed: "La zone de communauté n'a pas pu être enregistrée.",
          areaSaved: "Zone de communauté enregistrée.",
          areaMoveFailed: "La zone de communauté n'a pas pu être déplacée.",
          areaMoved: "Zone de communauté déplacée.",
          areaDeleteFailed: "La zone de communauté n'a pas pu être supprimée.",
          areaDeleted: "Zone de communauté supprimée.",
          profileSaveFailed:
            "La configuration du profil n'a pas pu être enregistrée.",
          profileSaved: "Configuration du profil enregistrée.",
          badgeGroupSaveFailed:
            "Le groupe de badges n'a pas pu être enregistré.",
          badgeGroupSaved: "Groupe de badges enregistré.",
          badgeSaveFailed: "Le badge n'a pas pu être enregistré.",
          badgeSaved: "Badge enregistré.",
          badgeAssignmentFailed:
            "L'attribution du badge n'a pas pu être modifiée.",
          badgeAwarded: "Badge attribué.",
          badgeRevoked: "Badge retiré.",
          moderationPolicySaveFailed:
            "Les règles de modération n'ont pas pu être enregistrées.",
          moderationPolicySaved: "Règles de modération enregistrées.",
          levelsSaveFailed:
            "La configuration des niveaux n'a pas pu être enregistrée.",
          levelsSaved: "Niveaux de communauté enregistrés.",
          caseClaimFailed: "Le cas n'a pas pu être pris en charge.",
          caseClaimed: "Cas de modération pris en charge.",
          decisionFailed: "La décision n'a pas pu être enregistrée.",
          contentRejected: "Contenu refusé et masqué.",
          contentRestored: "Contenu restauré.",
          contentApproved: "Contenu approuvé.",
          appealFailed: "Le recours n'a pas pu être tranché.",
          appealOverturned: "Recours accepté et contenu restauré.",
          appealUpheld: "Recours examiné et décision confirmée.",
          reportDecisionFailed:
            "La décision de modération n'a pas pu être enregistrée.",
          postToggleFailed:
            "Le statut de la publication n'a pas pu être modifié.",
          postPinned: "Publication épinglée.",
          postUnpinned: "Publication désépinglée.",
          postLocked: "Réponses verrouillées.",
          postUnlocked: "Réponses déverrouillées.",
          postRejectFailed: "La publication n'a pas pu être modérée.",
          postRejected: "Publication refusée et masquée.",
          commentRejectFailed: "La réponse n'a pas pu être modérée.",
          commentRejected: "Réponse refusée et masquée.",
        } as Record<CommunityAdminActionCode, string>
      )[key as CommunityAdminActionCode],
    ]),
  ) as Record<CommunityAdminActionCode, string>,
};

const dictionaries: Record<AppLocale, CommunityAdminCopy> = {
  de,
  en,
  it,
  es,
  fr,
};

export function getCommunityAdminCopy(locale: AppLocale) {
  return dictionaries[locale];
}

export function localizeCommunityAdminAction(
  locale: AppLocale,
  state: CommunityAdminMessageState,
) {
  if (state.ok === null) return "";
  const copy = getCommunityAdminCopy(locale);
  return state.messageCode
    ? copy.actions[state.messageCode]
    : state.ok
      ? copy.actionFallback.success
      : copy.actionFallback.error;
}

export function formatCommunityAdminNumber(value: number, locale: AppLocale) {
  return new Intl.NumberFormat(intlLocale(locale)).format(value);
}

export function formatCommunityAdminDateTime(
  value: Date | string | null,
  locale: AppLocale,
  timeZone: string = PLATFORM_TIME_ZONE,
) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(intlLocale(locale), {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(date);
}
