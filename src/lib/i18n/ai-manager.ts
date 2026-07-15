import type { AppLocale } from "@/lib/i18n/model";

const de = {
  icons: {
    sparkles: "Funkeln",
    promptReview: "Prompt-Review",
    learningPath: "Lernpfad",
    wand: "Zauberstab",
    bot: "Bot",
  },
  agentTypes: {
    learningCoach: "Lerncoach",
    knowledgeAssistant: "Wissensassistent",
    formAssistant: "Formularassistent",
  },
  knowledgeModes: {
    allCourses: "Alle zugänglichen Kurse",
    selectedSources: "Ausgewählte Quellen",
  },
  accessModes: {
    open: "Offen für alle Mitglieder",
    restricted: "Auf Zielgruppen beschränkt",
  },
  roles: {
    owner: "Owner",
    admin: "Administratoren",
    trainer: "Trainer",
    member: "Mitglieder",
  },
  common: {
    draftOnly: "Nur Entwurf",
    liveActive: "Live und aktiv",
    livePaused: "Live, pausiert",
    dialogClose: "Dialog schließen",
    label: "Beschriftung",
    description: "Beschreibung",
    published: "Veröffentlicht",
    version: "Version",
    cancel: "Abbrechen",
    open: "Offen",
    restricted: "Eingeschränkt",
  },
  preview: {
    defaultQuestion: "Was sollte ich als Nächstes lernen?",
    title: "Vorschau als Mitglied",
    draftMeta: (version: number, revision: number) =>
      `Entwurf v${version}, Revision ${revision}`,
    member: "Mitglied",
    noMembers: "Keine aktiven Mitglieder",
    testQuestion: "Testfrage",
    allowed: "Zugriff erlaubt",
    denied: "Zugriff verweigert",
    checking: "Prüft",
    run: "Vorschau",
    courses: "Kurse",
    manual: "Manuell",
    media: "Medien",
    web: "Web",
    references: "Referenzen",
    unavailable: "Nicht sichtbar",
  },
  editor: {
    editAria: (name: string) => `${name} bearbeiten`,
    draftMeta: (version: number, revision: number) =>
      `Entwurf v${version} - Revision ${revision}`,
    configure: (name: string) => `${name} konfigurieren`,
    basics: "Basisdaten",
    basicsHint: "Identität und Verhalten des Agentenentwurfs.",
    name: "Name",
    agentType: "Agententyp",
    symbol: "Symbol",
    systemPrompt: "Systemanweisung",
    color: "Farbe",
    knowledge: "Wissensbasis",
    knowledgeHint: "Inhalte, die dieser Agent bei Antworten berücksichtigt.",
    knowledgeMode: "Wissensmodus",
    publishedCourses: "Veröffentlichte Kurse",
    currentCourseVersion: "Aktuell veröffentlichte Kursversion",
    noCourses: "Keine veröffentlichten Kurse verfügbar.",
    manualSources: "Manuelle Textquellen",
    addTextSource: "Textquelle",
    sourceTitle: (index: number) => `Titel ${index}`,
    curatedText: "Kuratierter Text",
    removeTextSourceAria: (index: number) => `Textquelle ${index} entfernen`,
    removeTextSource: "Textquelle entfernen",
    noManualSources: "Keine manuellen Textquellen ausgewählt.",
    mediaSources: "Medien mit kuratiertem Text",
    mediaHint:
      "Der Text wird serverseitig aus dem geprüften Dokument extrahiert, gehasht und mit der Agentenversion eingefroren.",
    noMedia: "Keine verarbeiteten Medien verfügbar.",
    webSnapshots: "Web-Snapshots",
    addWebSource: "Webquelle",
    webAddress: (index: number) => `Webadresse ${index}`,
    removeWebSourceAria: (index: number) => `Webquelle ${index} entfernen`,
    removeWebSource: "Webquelle entfernen",
    savedSnapshot: "Gespeicherter Snapshot",
    noWebSnapshots: "Keine Web-Snapshots ausgewählt.",
    allCoursesHint:
      "Der Agent nutzt die für das jeweilige Mitglied zugänglichen, veröffentlichten Kurse.",
    personalization: "Personalisierung",
    personalizationTitle: "Personalisierung und Zusatz-Prompts",
    personalizationHint:
      "Nur explizit ausgewählte, für das Mitglied sichtbare Profilfelder werden als nicht vertrauenswürdiger Kontext verwendet.",
    profileFields: "Freigegebene Profilfelder",
    noProfileFields:
      "Keine für Mitglieder sichtbaren Profilfelder vorhanden.",
    guidelines: "Zusätzliche Leitlinien",
    addPrompt: "Prompt",
    promptLabel: (index: number) => `Bezeichnung ${index}`,
    guideline: "Leitlinie",
    removePromptAria: (index: number) => `Zusatz-Prompt ${index} entfernen`,
    removePrompt: "Zusatz-Prompt entfernen",
    noGuidelines: "Keine zusätzlichen Leitlinien konfiguriert.",
    access: "Zugriff",
    accessHint: "Sichtbarkeit der veröffentlichten Version.",
    accessMode: "Zugriffsmodus",
    roles: "Rollen",
    groups: "Gruppen",
    noGroups: "Keine Gruppen.",
    members: "Mitglieder",
    bundles: "Bundles",
    noBundles: "Keine Bundles.",
    openAccessHint:
      "Offene Agenten benötigen und speichern keine Zielgruppenfreigaben.",
    actions: "Freigabepflichtige Aktionen",
    actionsHint:
      "Mitglieder dürfen Kurszugriff sowie Gruppen- und Bundle-Zuweisungen beantragen. Entfernungen bleiben auf direkte Kursfreigaben beziehungsweise nachweisbar durch denselben KI-Agenten erzeugte Zuweisungen begrenzt.",
    grantAccess: "Zugriff erteilen",
    requestCourseAccess: "Aktion: Kurszugriff anfragen",
    noCourseTargets:
      "Keine veröffentlichten Kurse als Aktionsziel verfügbar.",
    revokeDirectAccess: "Direkten Zugriff entziehen",
    removeCourseAccess: "Aktion: Direkte Kursfreigaben entfernen",
    assignGroup: "Gruppe zuweisen",
    removeAiGroup: "KI-erzeugte Gruppenzuweisung entfernen",
    noGroupTargets: "Keine Gruppen als Aktionsziel verfügbar.",
    assignBundle: "Bundle zuweisen",
    removeAiBundle: "KI-erzeugte Bundle-Zuweisung entfernen",
    noBundleTargets: "Keine aktiven Bundles als Aktionsziel verfügbar.",
    history: "Veröffentlichte Versionen",
    historyHint:
      "Frühere Live-Stände können gezielt wiederhergestellt werden.",
    currentLive: "Aktuell live",
    restore: "Wiederherstellen",
    noVersions: "Noch keine Version veröffentlicht.",
    saving: "Wird gespeichert",
    saveDraft: "Entwurf speichern",
    requestCourseLabel: (name: string) => `Zugriff auf ${name} anfragen`,
    requestCourseDescription:
      "Sendet eine freigabepflichtige Kursanfrage an die Administration.",
    removeCourseLabel: (name: string) =>
      `Direkten Zugriff auf ${name} entfernen`,
    removeCourseDescription:
      "Sendet eine freigabepflichtige Anfrage zum Entfernen direkter Kursfreigaben.",
    joinGroupLabel: (name: string) => `Gruppe ${name} beitreten`,
    joinGroupDescription:
      "Sendet eine freigabepflichtige Anfrage für die Gruppenzuweisung.",
    leaveGroupLabel: (name: string) => `Gruppe ${name} verlassen`,
    leaveGroupDescription:
      "Entfernt nur eine durch diesen KI-Agenten erzeugte Gruppenzuweisung.",
    assignBundleLabel: (name: string) => `Bundle ${name} zuweisen`,
    assignBundleDescription:
      "Sendet eine freigabepflichtige Anfrage für die Bundle-Zuweisung.",
    removeBundleLabel: (name: string) => `Bundle ${name} entfernen`,
    removeBundleDescription:
      "Entfernt nur eine durch diesen KI-Agenten erzeugte Bundle-Zuweisung.",
  },
  publish: {
    aria: "Agentenentwurf veröffentlichen",
    eyebrow: "Live-Version",
    title: (version: number) => `Version ${version} veröffentlichen`,
    description:
      "Der aktuelle Entwurf wird als unveränderlicher Live-Stand publiziert. Anschließend entsteht automatisch der nächste Entwurf.",
    confirm: (version: number) =>
      `Ich bestätige die Veröffentlichung von Version ${version}.`,
    pending: "Wird veröffentlicht",
    submit: "Jetzt veröffentlichen",
  },
  rollback: {
    aria: "Live-Version wiederherstellen",
    eyebrow: "Rollback",
    title: (version: number) => `Version ${version} wiederherstellen`,
    description: (version: number) =>
      `Version ${version} ersetzt den aktuellen Live-Stand. Der vorhandene Entwurf bleibt dabei erhalten.`,
    confirm: (version: number) =>
      `Ich bestätige den Wechsel auf Version ${version}.`,
    pending: "Wird gewechselt",
    submit: "Version wiederherstellen",
  },
  deletion: {
    aria: "KI-Agent löschen",
    eyebrow: "Dauerhafte Aktion",
    title: "KI-Agent löschen",
    description: (name: string) =>
      `${name} wird dauerhaft entfernt. Agenten mit gespeicherten Konversationen können nicht gelöscht werden.`,
    confirmation: "Agentenname zur Bestätigung",
    pending: "Wird gelöscht",
    submit: "Dauerhaft löschen",
  },
  row: {
    edit: "Bearbeiten",
    publish: "Veröffentlichen",
    editAria: (name: string) => `${name} bearbeiten`,
    publishAria: (name: string) => `${name} veröffentlichen`,
    toggleAria: (name: string, active: boolean) =>
      `${name} ${active ? "pausieren" : "aktivieren"}`,
    unavailableToggleAria: (name: string) =>
      `${name} kann ohne Live-Version nicht aktiviert werden`,
    pause: "Pausieren",
    activate: "Aktivieren",
    publishFirst: "Zuerst veröffentlichen",
    deleteAria: (name: string) => `${name} löschen`,
    delete: "Löschen",
    openAccess: "Offener Zugriff",
    restricted: "Eingeschränkt",
    draft: "Entwurf",
    revision: (revision: number, date: string) =>
      `Revision ${revision} - ${date}`,
    live: "Live",
    notPublished: "Noch nicht veröffentlicht",
    conversations: "Konversationen",
    chats: (count: number) => `${count} Chats`,
    messages: "Nachrichten",
    messageCount: (count: number) => `${count} Nachrichten`,
    users: "Nutzende",
    userCount: (count: number) => `${count} Nutzende`,
    lastActivity: "Letzte Aktivität",
    noUsage: "Noch keine Nutzung",
  },
  studio: {
    title: "Agent-Studio",
    count: (count: number) =>
      `${count} ${count === 1 ? "Agent" : "Agenten"} - Entwurf und Live-Stand getrennt`,
    empty: "Noch keine KI-Agenten",
  },
  create: {
    button: "Neuer Agent",
    title: "KI-Agent erstellen",
    eyebrow: "KI-Konfiguration",
    name: "Name",
    namePlaceholder: "z. B. Transfer-Coach",
    descriptionPlaceholder: "Aufgabe und Einsatzbereich des Agenten",
    systemPrompt: "Systemanweisung",
    systemPlaceholder: "Du bist ein Lerncoach und ...",
    symbol: "Symbol",
    color: "Farbe",
    accent: "Akzentfarbe",
    info: "Der Agent wird als Entwurf angelegt. Zugriff und Quellen werden vor der Veröffentlichung im Agent Studio festgelegt.",
    success: "Erfolgreich erstellt",
    successMessage: "Der Agentenentwurf wurde erstellt.",
    done: "Fertig",
    creating: "Wird erstellt",
    submit: "Erstellen",
    error: "Der Agentenentwurf konnte nicht erstellt werden.",
  },
};

type WidenCopy<T> = T extends (...args: infer Args) => string
  ? (...args: Args) => string
  : T extends string
    ? string
    : { readonly [Key in keyof T]: WidenCopy<T[Key]> };

export type AiManagerCopy = WidenCopy<typeof de>;

const en: AiManagerCopy = {
  icons: { sparkles: "Sparkles", promptReview: "Prompt review", learningPath: "Learning path", wand: "Magic wand", bot: "Bot" },
  agentTypes: { learningCoach: "Learning coach", knowledgeAssistant: "Knowledge assistant", formAssistant: "Form assistant" },
  knowledgeModes: { allCourses: "All accessible courses", selectedSources: "Selected sources" },
  accessModes: { open: "Open to all members", restricted: "Restricted to target groups" },
  roles: { owner: "Owner", admin: "Administrators", trainer: "Trainers", member: "Members" },
  common: { draftOnly: "Draft only", liveActive: "Live and active", livePaused: "Live, paused", dialogClose: "Close dialog", label: "Label", description: "Description", published: "Published", version: "Version", cancel: "Cancel", open: "Open", restricted: "Restricted" },
  preview: { defaultQuestion: "What should I learn next?", title: "Preview as member", draftMeta: (version, revision) => `Draft v${version}, revision ${revision}`, member: "Member", noMembers: "No active members", testQuestion: "Test question", allowed: "Access allowed", denied: "Access denied", checking: "Checking", run: "Preview", courses: "Courses", manual: "Manual", media: "Media", web: "Web", references: "References", unavailable: "Not visible" },
  editor: { editAria: (name) => `Edit ${name}`, draftMeta: (version, revision) => `Draft v${version} - revision ${revision}`, configure: (name) => `Configure ${name}`, basics: "Basics", basicsHint: "Identity and behaviour of the agent draft.", name: "Name", agentType: "Agent type", symbol: "Icon", systemPrompt: "System instruction", color: "Colour", knowledge: "Knowledge base", knowledgeHint: "Content this agent considers in its responses.", knowledgeMode: "Knowledge mode", publishedCourses: "Published courses", currentCourseVersion: "Currently published course version", noCourses: "No published courses available.", manualSources: "Manual text sources", addTextSource: "Text source", sourceTitle: (index) => `Title ${index}`, curatedText: "Curated text", removeTextSourceAria: (index) => `Remove text source ${index}`, removeTextSource: "Remove text source", noManualSources: "No manual text sources selected.", mediaSources: "Media with curated text", mediaHint: "The text is extracted from the verified document on the server, hashed and frozen with the agent version.", noMedia: "No processed media available.", webSnapshots: "Web snapshots", addWebSource: "Web source", webAddress: (index) => `Web address ${index}`, removeWebSourceAria: (index) => `Remove web source ${index}`, removeWebSource: "Remove web source", savedSnapshot: "Saved snapshot", noWebSnapshots: "No web snapshots selected.", allCoursesHint: "The agent uses published courses accessible to each member.", personalization: "Personalisation", personalizationTitle: "Personalisation and additional prompts", personalizationHint: "Only explicitly selected profile fields visible to the member are used as untrusted context.", profileFields: "Approved profile fields", noProfileFields: "No member-visible profile fields available.", guidelines: "Additional guidelines", addPrompt: "Prompt", promptLabel: (index) => `Label ${index}`, guideline: "Guideline", removePromptAria: (index) => `Remove additional prompt ${index}`, removePrompt: "Remove additional prompt", noGuidelines: "No additional guidelines configured.", access: "Access", accessHint: "Visibility of the published version.", accessMode: "Access mode", roles: "Roles", groups: "Groups", noGroups: "No groups.", members: "Members", bundles: "Bundles", noBundles: "No bundles.", openAccessHint: "Open agents do not require or store target-group grants.", actions: "Actions requiring approval", actionsHint: "Members may request course access and group or bundle assignments. Removals are limited to direct course grants or assignments demonstrably created by the same AI agent.", grantAccess: "Grant access", requestCourseAccess: "Action: request course access", noCourseTargets: "No published courses available as action targets.", revokeDirectAccess: "Revoke direct access", removeCourseAccess: "Action: remove direct course access", assignGroup: "Assign group", removeAiGroup: "Remove AI-created group assignment", noGroupTargets: "No groups available as action targets.", assignBundle: "Assign bundle", removeAiBundle: "Remove AI-created bundle assignment", noBundleTargets: "No active bundles available as action targets.", history: "Published versions", historyHint: "Previous live states can be restored selectively.", currentLive: "Currently live", restore: "Restore", noVersions: "No version published yet.", saving: "Saving", saveDraft: "Save draft", requestCourseLabel: (name) => `Request access to ${name}`, requestCourseDescription: "Sends a course request requiring administrative approval.", removeCourseLabel: (name) => `Remove direct access to ${name}`, removeCourseDescription: "Sends a request requiring approval to remove direct course access.", joinGroupLabel: (name) => `Join group ${name}`, joinGroupDescription: "Sends a request requiring approval for the group assignment.", leaveGroupLabel: (name) => `Leave group ${name}`, leaveGroupDescription: "Removes only a group assignment created by this AI agent.", assignBundleLabel: (name) => `Assign bundle ${name}`, assignBundleDescription: "Sends a request requiring approval for the bundle assignment.", removeBundleLabel: (name) => `Remove bundle ${name}`, removeBundleDescription: "Removes only a bundle assignment created by this AI agent." },
  publish: { aria: "Publish agent draft", eyebrow: "Live version", title: (version) => `Publish version ${version}`, description: "The current draft is published as an immutable live state. The next draft is then created automatically.", confirm: (version) => `I confirm publication of version ${version}.`, pending: "Publishing", submit: "Publish now" },
  rollback: { aria: "Restore live version", eyebrow: "Rollback", title: (version) => `Restore version ${version}`, description: (version) => `Version ${version} replaces the current live state. The existing draft remains unchanged.`, confirm: (version) => `I confirm switching to version ${version}.`, pending: "Switching", submit: "Restore version" },
  deletion: { aria: "Delete AI agent", eyebrow: "Permanent action", title: "Delete AI agent", description: (name) => `${name} will be permanently removed. Agents with saved conversations cannot be deleted.`, confirmation: "Agent name for confirmation", pending: "Deleting", submit: "Delete permanently" },
  row: { edit: "Edit", publish: "Publish", editAria: (name) => `Edit ${name}`, publishAria: (name) => `Publish ${name}`, toggleAria: (name, active) => `${active ? "Pause" : "Activate"} ${name}`, unavailableToggleAria: (name) => `${name} cannot be activated without a live version`, pause: "Pause", activate: "Activate", publishFirst: "Publish first", deleteAria: (name) => `Delete ${name}`, delete: "Delete", openAccess: "Open access", restricted: "Restricted", draft: "Draft", revision: (revision, date) => `Revision ${revision} - ${date}`, live: "Live", notPublished: "Not published yet", conversations: "Conversations", chats: (count) => `${count} chats`, messages: "Messages", messageCount: (count) => `${count} messages`, users: "Users", userCount: (count) => `${count} users`, lastActivity: "Last activity", noUsage: "No usage yet" },
  studio: { title: "Agent Studio", count: (count) => `${count} ${count === 1 ? "agent" : "agents"} - draft and live state separated`, empty: "No AI agents yet" },
  create: { button: "New agent", title: "Create AI agent", eyebrow: "AI configuration", name: "Name", namePlaceholder: "e.g. Transfer Coach", descriptionPlaceholder: "Purpose and use of the agent", systemPrompt: "System instruction", systemPlaceholder: "You are a learning coach and ...", symbol: "Icon", color: "Colour", accent: "Accent colour", info: "The agent is created as a draft. Access and sources are configured in Agent Studio before publication.", success: "Created successfully", successMessage: "The agent draft has been created.", done: "Done", creating: "Creating", submit: "Create", error: "The agent draft could not be created." },
};

const it: AiManagerCopy = {
  ...en,
  icons: { sparkles: "Scintille", promptReview: "Revisione prompt", learningPath: "Percorso di apprendimento", wand: "Bacchetta magica", bot: "Bot" },
  agentTypes: { learningCoach: "Coach di apprendimento", knowledgeAssistant: "Assistente alla conoscenza", formAssistant: "Assistente ai moduli" },
  knowledgeModes: { allCourses: "Tutti i corsi accessibili", selectedSources: "Fonti selezionate" },
  accessModes: { open: "Aperto a tutti i membri", restricted: "Limitato ai gruppi destinatari" },
  roles: { owner: "Owner", admin: "Amministratori", trainer: "Formatori", member: "Membri" },
  common: { draftOnly: "Solo bozza", liveActive: "Attivo e online", livePaused: "Online, sospeso", dialogClose: "Chiudi finestra", label: "Etichetta", description: "Descrizione", published: "Pubblicata", version: "Versione", cancel: "Annulla", open: "Aperto", restricted: "Limitato" },
  preview: { defaultQuestion: "Cosa dovrei imparare dopo?", title: "Anteprima come membro", draftMeta: (version, revision) => `Bozza v${version}, revisione ${revision}`, member: "Membro", noMembers: "Nessun membro attivo", testQuestion: "Domanda di prova", allowed: "Accesso consentito", denied: "Accesso negato", checking: "Verifica", run: "Anteprima", courses: "Corsi", manual: "Manuale", media: "Media", web: "Web", references: "Riferimenti", unavailable: "Non visibile" },
  publish: { aria: "Pubblica bozza agente", eyebrow: "Versione attiva", title: (version) => `Pubblica versione ${version}`, description: "La bozza corrente viene pubblicata come stato attivo immutabile. La bozza successiva viene poi creata automaticamente.", confirm: (version) => `Confermo la pubblicazione della versione ${version}.`, pending: "Pubblicazione", submit: "Pubblica ora" },
  rollback: { aria: "Ripristina versione attiva", eyebrow: "Ripristino", title: (version) => `Ripristina versione ${version}`, description: (version) => `La versione ${version} sostituisce lo stato attivo corrente. La bozza esistente rimane invariata.`, confirm: (version) => `Confermo il passaggio alla versione ${version}.`, pending: "Cambio in corso", submit: "Ripristina versione" },
  deletion: { aria: "Elimina agente IA", eyebrow: "Azione permanente", title: "Elimina agente IA", description: (name) => `${name} verrà rimosso definitivamente. Gli agenti con conversazioni salvate non possono essere eliminati.`, confirmation: "Nome agente per conferma", pending: "Eliminazione", submit: "Elimina definitivamente" },
  row: { edit: "Modifica", publish: "Pubblica", editAria: (name) => `Modifica ${name}`, publishAria: (name) => `Pubblica ${name}`, toggleAria: (name, active) => `${active ? "Sospendi" : "Attiva"} ${name}`, unavailableToggleAria: (name) => `${name} non può essere attivato senza una versione online`, pause: "Sospendi", activate: "Attiva", publishFirst: "Pubblica prima", deleteAria: (name) => `Elimina ${name}`, delete: "Elimina", openAccess: "Accesso aperto", restricted: "Limitato", draft: "Bozza", revision: (revision, date) => `Revisione ${revision} - ${date}`, live: "Online", notPublished: "Non ancora pubblicata", conversations: "Conversazioni", chats: (count) => `${count} chat`, messages: "Messaggi", messageCount: (count) => `${count} messaggi`, users: "Utenti", userCount: (count) => `${count} utenti`, lastActivity: "Ultima attività", noUsage: "Ancora nessun utilizzo" },
  studio: { title: "Studio agenti", count: (count) => `${count} ${count === 1 ? "agente" : "agenti"} - bozza e stato attivo separati`, empty: "Ancora nessun agente IA" },
  create: { button: "Nuovo agente", title: "Crea agente IA", eyebrow: "Configurazione IA", name: "Nome", namePlaceholder: "es. Coach di trasferimento", descriptionPlaceholder: "Scopo e utilizzo dell'agente", systemPrompt: "Istruzione di sistema", systemPlaceholder: "Sei un coach di apprendimento e ...", symbol: "Icona", color: "Colore", accent: "Colore di accento", info: "L'agente viene creato come bozza. Accesso e fonti vengono configurati nello Studio agenti prima della pubblicazione.", success: "Creato correttamente", successMessage: "La bozza dell'agente è stata creata.", done: "Fine", creating: "Creazione", submit: "Crea", error: "Non è stato possibile creare la bozza dell'agente." },
  editor: {
    ...en.editor,
    editAria: (name) => `Modifica ${name}`,
    draftMeta: (version, revision) => `Bozza v${version} - revisione ${revision}`,
    configure: (name) => `Configura ${name}`,
    basics: "Dati di base", basicsHint: "Identità e comportamento della bozza dell'agente.", name: "Nome", agentType: "Tipo di agente", symbol: "Icona", systemPrompt: "Istruzione di sistema", color: "Colore", knowledge: "Base di conoscenza", knowledgeHint: "Contenuti considerati dall'agente nelle risposte.", knowledgeMode: "Modalità conoscenza", publishedCourses: "Corsi pubblicati", currentCourseVersion: "Versione del corso attualmente pubblicata", noCourses: "Nessun corso pubblicato disponibile.", manualSources: "Fonti di testo manuali", addTextSource: "Fonte testuale", sourceTitle: (index) => `Titolo ${index}`, curatedText: "Testo curato", removeTextSourceAria: (index) => `Rimuovi fonte testuale ${index}`, removeTextSource: "Rimuovi fonte testuale", noManualSources: "Nessuna fonte di testo manuale selezionata.", mediaSources: "Media con testo curato", mediaHint: "Il testo viene estratto dal documento verificato sul server, sottoposto a hash e fissato con la versione dell'agente.", noMedia: "Nessun media elaborato disponibile.", webSnapshots: "Snapshot web", addWebSource: "Fonte web", webAddress: (index) => `Indirizzo web ${index}`, removeWebSourceAria: (index) => `Rimuovi fonte web ${index}`, removeWebSource: "Rimuovi fonte web", savedSnapshot: "Snapshot salvato", noWebSnapshots: "Nessuno snapshot web selezionato.", allCoursesHint: "L'agente usa i corsi pubblicati accessibili al singolo membro.", personalization: "Personalizzazione", personalizationTitle: "Personalizzazione e prompt aggiuntivi", personalizationHint: "Solo i campi profilo esplicitamente selezionati e visibili al membro vengono usati come contesto non attendibile.", profileFields: "Campi profilo autorizzati", noProfileFields: "Nessun campo profilo visibile ai membri disponibile.", guidelines: "Linee guida aggiuntive", addPrompt: "Prompt", promptLabel: (index) => `Etichetta ${index}`, guideline: "Linea guida", removePromptAria: (index) => `Rimuovi prompt aggiuntivo ${index}`, removePrompt: "Rimuovi prompt aggiuntivo", noGuidelines: "Nessuna linea guida aggiuntiva configurata.", access: "Accesso", accessHint: "Visibilità della versione pubblicata.", accessMode: "Modalità di accesso", roles: "Ruoli", groups: "Gruppi", noGroups: "Nessun gruppo.", members: "Membri", bundles: "Bundle", noBundles: "Nessun bundle.", openAccessHint: "Gli agenti aperti non richiedono né salvano autorizzazioni per gruppi destinatari.", actions: "Azioni soggette ad approvazione", actionsHint: "I membri possono richiedere l'accesso ai corsi e assegnazioni a gruppi o bundle. Le rimozioni sono limitate agli accessi diretti o alle assegnazioni dimostrabilmente create dallo stesso agente IA.", grantAccess: "Concedi accesso", requestCourseAccess: "Azione: richiedi accesso al corso", noCourseTargets: "Nessun corso pubblicato disponibile come destinazione.", revokeDirectAccess: "Revoca accesso diretto", removeCourseAccess: "Azione: rimuovi accesso diretto al corso", assignGroup: "Assegna gruppo", removeAiGroup: "Rimuovi assegnazione gruppo creata dall'IA", noGroupTargets: "Nessun gruppo disponibile come destinazione.", assignBundle: "Assegna bundle", removeAiBundle: "Rimuovi assegnazione bundle creata dall'IA", noBundleTargets: "Nessun bundle attivo disponibile come destinazione.", history: "Versioni pubblicate", historyHint: "Gli stati attivi precedenti possono essere ripristinati in modo selettivo.", currentLive: "Attualmente attiva", restore: "Ripristina", noVersions: "Ancora nessuna versione pubblicata.", saving: "Salvataggio", saveDraft: "Salva bozza", requestCourseLabel: (name) => `Richiedi accesso a ${name}`, requestCourseDescription: "Invia una richiesta corso soggetta ad approvazione amministrativa.", removeCourseLabel: (name) => `Rimuovi accesso diretto a ${name}`, removeCourseDescription: "Invia una richiesta soggetta ad approvazione per rimuovere l'accesso diretto.", joinGroupLabel: (name) => `Unisciti al gruppo ${name}`, joinGroupDescription: "Invia una richiesta soggetta ad approvazione per l'assegnazione al gruppo.", leaveGroupLabel: (name) => `Lascia il gruppo ${name}`, leaveGroupDescription: "Rimuove solo un'assegnazione al gruppo creata da questo agente IA.", assignBundleLabel: (name) => `Assegna bundle ${name}`, assignBundleDescription: "Invia una richiesta soggetta ad approvazione per l'assegnazione del bundle.", removeBundleLabel: (name) => `Rimuovi bundle ${name}`, removeBundleDescription: "Rimuove solo un'assegnazione bundle creata da questo agente IA."
  },
};

const es: AiManagerCopy = {
  ...en,
  icons: { sparkles: "Destellos", promptReview: "Revisión de prompts", learningPath: "Ruta de aprendizaje", wand: "Varita mágica", bot: "Bot" },
  agentTypes: { learningCoach: "Coach de aprendizaje", knowledgeAssistant: "Asistente de conocimiento", formAssistant: "Asistente de formularios" },
  knowledgeModes: { allCourses: "Todos los cursos accesibles", selectedSources: "Fuentes seleccionadas" },
  accessModes: { open: "Abierto a todos los miembros", restricted: "Limitado a grupos destinatarios" },
  roles: { owner: "Owner", admin: "Administradores", trainer: "Formadores", member: "Miembros" },
  common: { draftOnly: "Solo borrador", liveActive: "Activo y publicado", livePaused: "Publicado, pausado", dialogClose: "Cerrar diálogo", label: "Etiqueta", description: "Descripción", published: "Publicada", version: "Versión", cancel: "Cancelar", open: "Abierto", restricted: "Limitado" },
  preview: { defaultQuestion: "¿Qué debería aprender a continuación?", title: "Vista previa como miembro", draftMeta: (version, revision) => `Borrador v${version}, revisión ${revision}`, member: "Miembro", noMembers: "No hay miembros activos", testQuestion: "Pregunta de prueba", allowed: "Acceso permitido", denied: "Acceso denegado", checking: "Comprobando", run: "Vista previa", courses: "Cursos", manual: "Manual", media: "Medios", web: "Web", references: "Referencias", unavailable: "No visible" },
  publish: { aria: "Publicar borrador del agente", eyebrow: "Versión activa", title: (version) => `Publicar versión ${version}`, description: "El borrador actual se publica como estado activo inmutable. Después se crea automáticamente el siguiente borrador.", confirm: (version) => `Confirmo la publicación de la versión ${version}.`, pending: "Publicando", submit: "Publicar ahora" },
  rollback: { aria: "Restaurar versión activa", eyebrow: "Reversión", title: (version) => `Restaurar versión ${version}`, description: (version) => `La versión ${version} sustituye al estado activo actual. El borrador existente permanece intacto.`, confirm: (version) => `Confirmo el cambio a la versión ${version}.`, pending: "Cambiando", submit: "Restaurar versión" },
  deletion: { aria: "Eliminar agente de IA", eyebrow: "Acción permanente", title: "Eliminar agente de IA", description: (name) => `${name} se eliminará permanentemente. Los agentes con conversaciones guardadas no se pueden eliminar.`, confirmation: "Nombre del agente para confirmar", pending: "Eliminando", submit: "Eliminar permanentemente" },
  row: { edit: "Editar", publish: "Publicar", editAria: (name) => `Editar ${name}`, publishAria: (name) => `Publicar ${name}`, toggleAria: (name, active) => `${active ? "Pausar" : "Activar"} ${name}`, unavailableToggleAria: (name) => `${name} no se puede activar sin una versión publicada`, pause: "Pausar", activate: "Activar", publishFirst: "Publicar primero", deleteAria: (name) => `Eliminar ${name}`, delete: "Eliminar", openAccess: "Acceso abierto", restricted: "Limitado", draft: "Borrador", revision: (revision, date) => `Revisión ${revision} - ${date}`, live: "Publicada", notPublished: "Aún no publicada", conversations: "Conversaciones", chats: (count) => `${count} chats`, messages: "Mensajes", messageCount: (count) => `${count} mensajes`, users: "Usuarios", userCount: (count) => `${count} usuarios`, lastActivity: "Última actividad", noUsage: "Aún sin uso" },
  studio: { title: "Estudio de agentes", count: (count) => `${count} ${count === 1 ? "agente" : "agentes"} - borrador y estado publicado separados`, empty: "Aún no hay agentes de IA" },
  create: { button: "Nuevo agente", title: "Crear agente de IA", eyebrow: "Configuración de IA", name: "Nombre", namePlaceholder: "p. ej. Coach de transferencia", descriptionPlaceholder: "Objetivo y uso del agente", systemPrompt: "Instrucción del sistema", systemPlaceholder: "Eres un coach de aprendizaje y ...", symbol: "Icono", color: "Color", accent: "Color de acento", info: "El agente se crea como borrador. El acceso y las fuentes se configuran en el Estudio de agentes antes de publicarlo.", success: "Creado correctamente", successMessage: "Se ha creado el borrador del agente.", done: "Hecho", creating: "Creando", submit: "Crear", error: "No se pudo crear el borrador del agente." },
  editor: {
    ...en.editor,
    editAria: (name) => `Editar ${name}`, draftMeta: (version, revision) => `Borrador v${version} - revisión ${revision}`, configure: (name) => `Configurar ${name}`, basics: "Datos básicos", basicsHint: "Identidad y comportamiento del borrador del agente.", name: "Nombre", agentType: "Tipo de agente", symbol: "Icono", systemPrompt: "Instrucción del sistema", color: "Color", knowledge: "Base de conocimiento", knowledgeHint: "Contenido que el agente tiene en cuenta al responder.", knowledgeMode: "Modo de conocimiento", publishedCourses: "Cursos publicados", currentCourseVersion: "Versión del curso publicada actualmente", noCourses: "No hay cursos publicados disponibles.", manualSources: "Fuentes de texto manuales", addTextSource: "Fuente de texto", sourceTitle: (index) => `Título ${index}`, curatedText: "Texto seleccionado", removeTextSourceAria: (index) => `Eliminar fuente de texto ${index}`, removeTextSource: "Eliminar fuente de texto", noManualSources: "No hay fuentes de texto manuales seleccionadas.", mediaSources: "Medios con texto seleccionado", mediaHint: "El texto se extrae del documento verificado en el servidor, se cifra y se fija con la versión del agente.", noMedia: "No hay medios procesados disponibles.", webSnapshots: "Instantáneas web", addWebSource: "Fuente web", webAddress: (index) => `Dirección web ${index}`, removeWebSourceAria: (index) => `Eliminar fuente web ${index}`, removeWebSource: "Eliminar fuente web", savedSnapshot: "Instantánea guardada", noWebSnapshots: "No hay instantáneas web seleccionadas.", allCoursesHint: "El agente utiliza los cursos publicados accesibles para cada miembro.", personalization: "Personalización", personalizationTitle: "Personalización y prompts adicionales", personalizationHint: "Solo los campos de perfil seleccionados explícitamente y visibles para el miembro se utilizan como contexto no fiable.", profileFields: "Campos de perfil autorizados", noProfileFields: "No hay campos de perfil visibles para miembros.", guidelines: "Directrices adicionales", addPrompt: "Prompt", promptLabel: (index) => `Etiqueta ${index}`, guideline: "Directriz", removePromptAria: (index) => `Eliminar prompt adicional ${index}`, removePrompt: "Eliminar prompt adicional", noGuidelines: "No hay directrices adicionales configuradas.", access: "Acceso", accessHint: "Visibilidad de la versión publicada.", accessMode: "Modo de acceso", roles: "Roles", groups: "Grupos", noGroups: "No hay grupos.", members: "Miembros", bundles: "Paquetes", noBundles: "No hay paquetes.", openAccessHint: "Los agentes abiertos no necesitan ni guardan permisos de grupos destinatarios.", actions: "Acciones que requieren aprobación", actionsHint: "Los miembros pueden solicitar acceso a cursos y asignaciones de grupos o paquetes. Las eliminaciones se limitan a accesos directos o asignaciones creadas de forma demostrable por el mismo agente de IA.", grantAccess: "Conceder acceso", requestCourseAccess: "Acción: solicitar acceso al curso", noCourseTargets: "No hay cursos publicados disponibles como destino.", revokeDirectAccess: "Revocar acceso directo", removeCourseAccess: "Acción: eliminar acceso directo al curso", assignGroup: "Asignar grupo", removeAiGroup: "Eliminar asignación de grupo creada por IA", noGroupTargets: "No hay grupos disponibles como destino.", assignBundle: "Asignar paquete", removeAiBundle: "Eliminar asignación de paquete creada por IA", noBundleTargets: "No hay paquetes activos disponibles como destino.", history: "Versiones publicadas", historyHint: "Los estados publicados anteriores se pueden restaurar de forma selectiva.", currentLive: "Publicada actualmente", restore: "Restaurar", noVersions: "Aún no hay versiones publicadas.", saving: "Guardando", saveDraft: "Guardar borrador", requestCourseLabel: (name) => `Solicitar acceso a ${name}`, requestCourseDescription: "Envía una solicitud de curso que requiere aprobación administrativa.", removeCourseLabel: (name) => `Eliminar acceso directo a ${name}`, removeCourseDescription: "Envía una solicitud que requiere aprobación para eliminar el acceso directo.", joinGroupLabel: (name) => `Unirse al grupo ${name}`, joinGroupDescription: "Envía una solicitud que requiere aprobación para la asignación de grupo.", leaveGroupLabel: (name) => `Salir del grupo ${name}`, leaveGroupDescription: "Elimina solo una asignación de grupo creada por este agente de IA.", assignBundleLabel: (name) => `Asignar paquete ${name}`, assignBundleDescription: "Envía una solicitud que requiere aprobación para la asignación del paquete.", removeBundleLabel: (name) => `Eliminar paquete ${name}`, removeBundleDescription: "Elimina solo una asignación de paquete creada por este agente de IA."
  },
};

const fr: AiManagerCopy = {
  ...en,
  icons: { sparkles: "Étincelles", promptReview: "Révision des prompts", learningPath: "Parcours d'apprentissage", wand: "Baguette magique", bot: "Bot" },
  agentTypes: { learningCoach: "Coach d'apprentissage", knowledgeAssistant: "Assistant de connaissances", formAssistant: "Assistant de formulaires" },
  knowledgeModes: { allCourses: "Tous les cours accessibles", selectedSources: "Sources sélectionnées" },
  accessModes: { open: "Ouvert à tous les membres", restricted: "Limité aux groupes cibles" },
  roles: { owner: "Owner", admin: "Administrateurs", trainer: "Formateurs", member: "Membres" },
  common: { draftOnly: "Brouillon uniquement", liveActive: "Actif et en ligne", livePaused: "En ligne, en pause", dialogClose: "Fermer la fenêtre", label: "Libellé", description: "Description", published: "Publiée", version: "Version", cancel: "Annuler", open: "Ouvert", restricted: "Limité" },
  preview: { defaultQuestion: "Que devrais-je apprendre ensuite ?", title: "Aperçu en tant que membre", draftMeta: (version, revision) => `Brouillon v${version}, révision ${revision}`, member: "Membre", noMembers: "Aucun membre actif", testQuestion: "Question test", allowed: "Accès autorisé", denied: "Accès refusé", checking: "Vérification", run: "Aperçu", courses: "Cours", manual: "Manuel", media: "Médias", web: "Web", references: "Références", unavailable: "Non visible" },
  publish: { aria: "Publier le brouillon de l'agent", eyebrow: "Version active", title: (version) => `Publier la version ${version}`, description: "Le brouillon actuel est publié comme état actif immuable. Le brouillon suivant est ensuite créé automatiquement.", confirm: (version) => `Je confirme la publication de la version ${version}.`, pending: "Publication", submit: "Publier maintenant" },
  rollback: { aria: "Restaurer la version active", eyebrow: "Retour arrière", title: (version) => `Restaurer la version ${version}`, description: (version) => `La version ${version} remplace l'état actif actuel. Le brouillon existant reste inchangé.`, confirm: (version) => `Je confirme le passage à la version ${version}.`, pending: "Changement", submit: "Restaurer la version" },
  deletion: { aria: "Supprimer l'agent IA", eyebrow: "Action définitive", title: "Supprimer l'agent IA", description: (name) => `${name} sera supprimé définitivement. Les agents avec des conversations enregistrées ne peuvent pas être supprimés.`, confirmation: "Nom de l'agent pour confirmation", pending: "Suppression", submit: "Supprimer définitivement" },
  row: { edit: "Modifier", publish: "Publier", editAria: (name) => `Modifier ${name}`, publishAria: (name) => `Publier ${name}`, toggleAria: (name, active) => `${active ? "Mettre en pause" : "Activer"} ${name}`, unavailableToggleAria: (name) => `${name} ne peut pas être activé sans version en ligne`, pause: "Mettre en pause", activate: "Activer", publishFirst: "Publier d'abord", deleteAria: (name) => `Supprimer ${name}`, delete: "Supprimer", openAccess: "Accès ouvert", restricted: "Limité", draft: "Brouillon", revision: (revision, date) => `Révision ${revision} - ${date}`, live: "En ligne", notPublished: "Pas encore publiée", conversations: "Conversations", chats: (count) => `${count} chats`, messages: "Messages", messageCount: (count) => `${count} messages`, users: "Utilisateurs", userCount: (count) => `${count} utilisateurs`, lastActivity: "Dernière activité", noUsage: "Aucune utilisation" },
  studio: { title: "Studio d'agents", count: (count) => `${count} ${count === 1 ? "agent" : "agents"} - brouillon et état actif séparés`, empty: "Aucun agent IA" },
  create: { button: "Nouvel agent", title: "Créer un agent IA", eyebrow: "Configuration IA", name: "Nom", namePlaceholder: "p. ex. Coach de transfert", descriptionPlaceholder: "Objectif et utilisation de l'agent", systemPrompt: "Instruction système", systemPlaceholder: "Vous êtes un coach d'apprentissage et ...", symbol: "Icône", color: "Couleur", accent: "Couleur d'accent", info: "L'agent est créé comme brouillon. L'accès et les sources sont configurés dans le Studio d'agents avant publication.", success: "Création réussie", successMessage: "Le brouillon de l'agent a été créé.", done: "Terminé", creating: "Création", submit: "Créer", error: "Le brouillon de l'agent n'a pas pu être créé." },
  editor: {
    ...en.editor,
    editAria: (name) => `Modifier ${name}`, draftMeta: (version, revision) => `Brouillon v${version} - révision ${revision}`, configure: (name) => `Configurer ${name}`, basics: "Données de base", basicsHint: "Identité et comportement du brouillon de l'agent.", name: "Nom", agentType: "Type d'agent", symbol: "Icône", systemPrompt: "Instruction système", color: "Couleur", knowledge: "Base de connaissances", knowledgeHint: "Contenu pris en compte par cet agent dans ses réponses.", knowledgeMode: "Mode de connaissances", publishedCourses: "Cours publiés", currentCourseVersion: "Version du cours actuellement publiée", noCourses: "Aucun cours publié disponible.", manualSources: "Sources de texte manuelles", addTextSource: "Source textuelle", sourceTitle: (index) => `Titre ${index}`, curatedText: "Texte sélectionné", removeTextSourceAria: (index) => `Supprimer la source textuelle ${index}`, removeTextSource: "Supprimer la source textuelle", noManualSources: "Aucune source de texte manuelle sélectionnée.", mediaSources: "Médias avec texte sélectionné", mediaHint: "Le texte est extrait du document vérifié sur le serveur, haché et figé avec la version de l'agent.", noMedia: "Aucun média traité disponible.", webSnapshots: "Instantanés web", addWebSource: "Source web", webAddress: (index) => `Adresse web ${index}`, removeWebSourceAria: (index) => `Supprimer la source web ${index}`, removeWebSource: "Supprimer la source web", savedSnapshot: "Instantané enregistré", noWebSnapshots: "Aucun instantané web sélectionné.", allCoursesHint: "L'agent utilise les cours publiés accessibles à chaque membre.", personalization: "Personnalisation", personalizationTitle: "Personnalisation et prompts supplémentaires", personalizationHint: "Seuls les champs de profil explicitement sélectionnés et visibles par le membre sont utilisés comme contexte non fiable.", profileFields: "Champs de profil autorisés", noProfileFields: "Aucun champ de profil visible par les membres disponible.", guidelines: "Directives supplémentaires", addPrompt: "Prompt", promptLabel: (index) => `Libellé ${index}`, guideline: "Directive", removePromptAria: (index) => `Supprimer le prompt supplémentaire ${index}`, removePrompt: "Supprimer le prompt supplémentaire", noGuidelines: "Aucune directive supplémentaire configurée.", access: "Accès", accessHint: "Visibilité de la version publiée.", accessMode: "Mode d'accès", roles: "Rôles", groups: "Groupes", noGroups: "Aucun groupe.", members: "Membres", bundles: "Offres groupées", noBundles: "Aucune offre groupée.", openAccessHint: "Les agents ouverts ne nécessitent ni ne stockent d'autorisations de groupes cibles.", actions: "Actions soumises à approbation", actionsHint: "Les membres peuvent demander l'accès aux cours et des attributions à des groupes ou offres groupées. Les suppressions sont limitées aux accès directs ou aux attributions créées de façon démontrable par le même agent IA.", grantAccess: "Accorder l'accès", requestCourseAccess: "Action : demander l'accès au cours", noCourseTargets: "Aucun cours publié disponible comme cible.", revokeDirectAccess: "Révoquer l'accès direct", removeCourseAccess: "Action : supprimer l'accès direct au cours", assignGroup: "Attribuer un groupe", removeAiGroup: "Supprimer l'attribution de groupe créée par l'IA", noGroupTargets: "Aucun groupe disponible comme cible.", assignBundle: "Attribuer une offre groupée", removeAiBundle: "Supprimer l'attribution d'offre créée par l'IA", noBundleTargets: "Aucune offre groupée active disponible comme cible.", history: "Versions publiées", historyHint: "Les états actifs précédents peuvent être restaurés de manière sélective.", currentLive: "Actuellement active", restore: "Restaurer", noVersions: "Aucune version publiée.", saving: "Enregistrement", saveDraft: "Enregistrer le brouillon", requestCourseLabel: (name) => `Demander l'accès à ${name}`, requestCourseDescription: "Envoie une demande de cours soumise à approbation administrative.", removeCourseLabel: (name) => `Supprimer l'accès direct à ${name}`, removeCourseDescription: "Envoie une demande soumise à approbation pour supprimer l'accès direct.", joinGroupLabel: (name) => `Rejoindre le groupe ${name}`, joinGroupDescription: "Envoie une demande soumise à approbation pour l'attribution au groupe.", leaveGroupLabel: (name) => `Quitter le groupe ${name}`, leaveGroupDescription: "Supprime uniquement une attribution de groupe créée par cet agent IA.", assignBundleLabel: (name) => `Attribuer l'offre ${name}`, assignBundleDescription: "Envoie une demande soumise à approbation pour l'attribution de l'offre.", removeBundleLabel: (name) => `Supprimer l'offre ${name}`, removeBundleDescription: "Supprime uniquement une attribution d'offre créée par cet agent IA."
  },
};

const dictionaries: Record<AppLocale, AiManagerCopy> = { de, en, it, es, fr };

export function getAiManagerCopy(locale: AppLocale) {
  return dictionaries[locale];
}
