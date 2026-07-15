import { intlLocale, type AppLocale } from "@/lib/i18n/model";
import { PLATFORM_TIME_ZONE } from "@/lib/utils";

export type AiAdminMessageCode =
  | "invalidAgent"
  | "agentMissing"
  | "lastActivePause"
  | "unpublishedActivate"
  | "agentStatusChanged"
  | "agentStatusFailed"
  | "invalidConfirmation"
  | "confirmationMismatch"
  | "agentInUse"
  | "publishedDelete"
  | "lastActiveDelete"
  | "agentDeleted"
  | "agentDeleteFailed"
  | "invalidConfiguration"
  | "draftSaved"
  | "draftSaveFailed"
  | "publishInvalid"
  | "published"
  | "publishFailed"
  | "rollbackInvalid"
  | "rolledBack"
  | "rollbackFailed"
  | "previewInvalid"
  | "previewBusy"
  | "previewRateLimited"
  | "previewFailed"
  | "policyInvalid"
  | "policySaved"
  | "policyUnchanged"
  | "policySaveFailed"
  | "decisionReasonRequired"
  | "decisionInvalid"
  | "decisionApproved"
  | "decisionRejected"
  | "decisionFailed";

export type AiAdminMessageState = {
  ok: boolean | null;
  messageCode?: AiAdminMessageCode;
  messageParams?: Record<string, string | number | boolean>;
};

const de = {
  page: {
    metadataTitle: "KI-Agenten",
    eyebrow: "KI-gestütztes Lernen",
    title: "KI-Agenten",
    description:
      "Konfiguriere Assistenten für Coaching, Prompt-Feedback und geführte Formulare.",
  },
  common: {
    save: "Speichern",
    cancel: "Abbrechen",
    version: "Version",
  },
  policy: {
    title: "KI-Policy und Credits",
    monthUsage: "Verbrauch im aktuellen Kalendermonat",
    consumedCredits: "Verbrauchte KI-Credits",
    reset: (date: string) => `Neustart ${date}`,
    invalid:
      "Die gespeicherte Policy ist ungültig. KI-Anfragen sind bis zum erneuten Speichern gesperrt.",
    enable: "KI-Agenten freigeben",
    enableHint: "Gilt sofort für alle Mitglieder und Integrationen.",
    monthlyCredits: "Credits pro Monat",
    hourlyLimit: "Stundenlimit pro Mitglied",
    hourlyCredits: "Credits pro Mitglied und Stunde",
    changedAt: (date: string) => `Zuletzt geändert ${date}`,
    defaultActive: "Standardpolicy aktiv",
    usage: "Nutzung",
    range: (from: string, to: string) => `${from} bis ${to}`,
    periodAria: "Nutzungszeitraum",
    periods: {
      currentMonth: "Dieser Monat",
      sevenDays: "7 Tage",
      thirtyDays: "30 Tage",
      ninetyDays: "90 Tage",
    },
    conversations: "Konversationen",
    activeUsers: "Aktive Nutzer",
    messages: "Nachrichten",
    inputTokens: "Input-Tokens",
    outputTokens: "Output-Tokens",
    agent: "Agent",
    chats: "Chats",
    users: "Nutzer",
    input: "Input",
    output: "Output",
    empty: "Keine Nutzung in diesem Zeitraum.",
  },
  review: {
    statuses: {
      pending: "Offen",
      approved: "Freigegeben",
      rejected: "Abgelehnt",
      cancelled: "Abgebrochen",
      expired: "Abgelaufen",
    },
    approve: "Freigeben",
    reject: "Ablehnen",
    reason: "Begründung",
    approveEnrollment:
      "Die Freigabe schreibt den Kurszugriff atomar und verhindert unbeabsichtigte Doppelaktionen.",
    approveUnenrollment:
      "Die Freigabe entfernt ausschließlich direkte Kursfreigaben. Zugriffe aus Gruppen oder Bundles bleiben erhalten.",
    approveAssignment:
      "Die Freigabe erstellt die Zuweisung mit eindeutiger KI-Herkunft. Vorhandene manuelle oder Commerce-Zuweisungen werden nicht übernommen.",
    approveRemoval:
      "Die Freigabe entfernt nur eine aktive Zuweisung, die derselbe KI-Agent zuvor erzeugt hat. Manuelle und Commerce-Zuweisungen bleiben erhalten.",
    confirmAssignment: "Ich habe Mitglied, Ziel und Zuweisungsart geprüft.",
    confirmRemoval:
      "Ich habe Mitglied, Ziel und die nachweisbare KI-Herkunft geprüft.",
    confirmReason: "Ich habe die Begründung geprüft.",
    saveDecision: "Entscheidung speichern",
    missingTarget: "Nicht mehr verfügbares Ziel",
    agentVersion: (name: string, version: number) =>
      `${name}, Version ${version}`,
    decisionReason: (note: string) => `Begründung: ${note}`,
    title: "Aktionsfreigaben",
    description:
      "Explizite Entscheidungen für Agentenaktionen mit unveränderlichem Verlauf.",
    pendingCount: (count: number) => `${count} offen`,
    empty: "Keine offenen Aktionsanfragen.",
    recent: "Letzte Entscheidungen",
  },
  messages: {
    genericSuccess: "Änderung gespeichert.",
    genericError: "Die Änderung konnte nicht gespeichert werden.",
    invalidAgent: "Der KI-Agent ist ungültig.",
    agentMissing: "Der KI-Agent wurde nicht gefunden.",
    lastActivePause:
      "Der letzte aktive KI-Agent kann nicht pausiert werden. Aktiviere zuerst eine Alternative.",
    unpublishedActivate:
      "Veröffentliche zuerst eine Agentenversion, bevor du den Agenten aktivierst.",
    agentStatusChanged: (name: string, active: boolean) =>
      `KI-Agent „${name}“ ${active ? "aktiviert" : "pausiert"}.`,
    agentStatusFailed:
      "Der Status des KI-Agenten konnte nicht geändert werden.",
    invalidConfirmation: "Die Bestätigung ist ungültig.",
    confirmationMismatch:
      "Der eingegebene Name stimmt nicht mit dem KI-Agenten überein.",
    agentInUse: (count: number) =>
      `Der KI-Agent hat ${count} gespeicherte ${count === 1 ? "Konversation" : "Konversationen"} und kann nicht gelöscht werden. Pausiere ihn stattdessen.`,
    publishedDelete:
      "Veröffentlichte KI-Agenten bleiben für Audit und bestehende Chats erhalten. Pausiere ihn stattdessen.",
    lastActiveDelete:
      "Der letzte aktive KI-Agent kann nicht gelöscht werden. Aktiviere zuerst eine Alternative.",
    agentDeleted: (name: string) => `KI-Agent „${name}“ gelöscht.`,
    agentDeleteFailed: "Der KI-Agent konnte nicht gelöscht werden.",
    invalidConfiguration: "Bitte prüfe die Agenten-Konfiguration.",
    draftSaved: "Agentenentwurf gespeichert.",
    draftSaveFailed: "Der Agentenentwurf konnte nicht gespeichert werden.",
    publishInvalid: "Die Veröffentlichung wurde nicht bestätigt oder ist ungültig.",
    published: (version: number) => `Version ${version} ist jetzt live.`,
    publishFailed: "Der Agentenentwurf konnte nicht veröffentlicht werden.",
    rollbackInvalid: "Das Zurücksetzen wurde nicht bestätigt oder ist ungültig.",
    rolledBack: (version: number) => `Version ${version} ist wieder live.`,
    rollbackFailed: "Die Live-Version konnte nicht zurückgesetzt werden.",
    previewInvalid: "Die Mitgliedsvorschau ist ungültig.",
    previewBusy: "Eine andere Vorschau wird noch erstellt. Bitte warte kurz.",
    previewRateLimited:
      "Das Vorschau-Limit ist erreicht. Bitte versuche es später erneut.",
    previewFailed: "Die Mitgliedsvorschau konnte nicht erstellt werden.",
    policyInvalid: "Bitte prüfe die KI-Creditlimits.",
    policySaved: "KI-Policy gespeichert.",
    policyUnchanged: "Die KI-Policy ist bereits aktuell.",
    policySaveFailed: "Die KI-Policy konnte nicht gespeichert werden.",
    decisionReasonRequired: "Bitte begründe die Ablehnung.",
    decisionInvalid: "Die Entscheidung ist ungültig.",
    decisionApproved: "Aktion freigegeben.",
    decisionRejected: "Aktionsanfrage abgelehnt.",
    decisionFailed: "Die Aktionsanfrage konnte nicht entschieden werden.",
  },
};

type WidenCopy<T> = T extends (...args: infer Args) => string
  ? (...args: Args) => string
  : T extends string
    ? string
    : { readonly [Key in keyof T]: WidenCopy<T[Key]> };

export type AiAdminCopy = WidenCopy<typeof de>;

const en: AiAdminCopy = {
  page: { metadataTitle: "AI agents", eyebrow: "AI-assisted learning", title: "AI agents", description: "Configure assistants for coaching, prompt feedback and guided forms." },
  common: { save: "Save", cancel: "Cancel", version: "Version" },
  policy: { title: "AI policy and credits", monthUsage: "Usage in the current calendar month", consumedCredits: "AI credits used", reset: (date) => `Resets ${date}`, invalid: "The saved policy is invalid. AI requests are blocked until it is saved again.", enable: "Enable AI agents", enableHint: "Takes effect immediately for all members and integrations.", monthlyCredits: "Credits per month", hourlyLimit: "Hourly limit per member", hourlyCredits: "Credits per member per hour", changedAt: (date) => `Last changed ${date}`, defaultActive: "Default policy active", usage: "Usage", range: (from, to) => `${from} to ${to}`, periodAria: "Usage period", periods: { currentMonth: "This month", sevenDays: "7 days", thirtyDays: "30 days", ninetyDays: "90 days" }, conversations: "Conversations", activeUsers: "Active users", messages: "Messages", inputTokens: "Input tokens", outputTokens: "Output tokens", agent: "Agent", chats: "Chats", users: "Users", input: "Input", output: "Output", empty: "No usage in this period." },
  review: { statuses: { pending: "Pending", approved: "Approved", rejected: "Rejected", cancelled: "Cancelled", expired: "Expired" }, approve: "Approve", reject: "Reject", reason: "Reason", approveEnrollment: "Approval grants course access atomically and prevents unintended duplicate actions.", approveUnenrollment: "Approval removes direct course access only. Access through groups or bundles remains intact.", approveAssignment: "Approval creates the assignment with explicit AI provenance. Existing manual or commerce assignments are not adopted.", approveRemoval: "Approval removes only an active assignment previously created by the same AI agent. Manual and commerce assignments remain intact.", confirmAssignment: "I have checked the member, target and assignment type.", confirmRemoval: "I have checked the member, target and verifiable AI provenance.", confirmReason: "I have checked the reason.", saveDecision: "Save decision", missingTarget: "Target no longer available", agentVersion: (name, version) => `${name}, version ${version}`, decisionReason: (note) => `Reason: ${note}`, title: "Action approvals", description: "Explicit decisions for agent actions with an immutable history.", pendingCount: (count) => `${count} pending`, empty: "No pending action requests.", recent: "Recent decisions" },
  messages: { genericSuccess: "Change saved.", genericError: "The change could not be saved.", invalidAgent: "The AI agent is invalid.", agentMissing: "The AI agent was not found.", lastActivePause: "The last active AI agent cannot be paused. Activate an alternative first.", unpublishedActivate: "Publish an agent version before activating the agent.", agentStatusChanged: (name, active) => `AI agent “${name}” ${active ? "activated" : "paused"}.`, agentStatusFailed: "The AI agent status could not be changed.", invalidConfirmation: "The confirmation is invalid.", confirmationMismatch: "The entered name does not match the AI agent.", agentInUse: (count) => `The AI agent has ${count} saved ${count === 1 ? "conversation" : "conversations"} and cannot be deleted. Pause it instead.`, publishedDelete: "Published AI agents are retained for audits and existing chats. Pause it instead.", lastActiveDelete: "The last active AI agent cannot be deleted. Activate an alternative first.", agentDeleted: (name) => `AI agent “${name}” deleted.`, agentDeleteFailed: "The AI agent could not be deleted.", invalidConfiguration: "Check the agent configuration.", draftSaved: "Agent draft saved.", draftSaveFailed: "The agent draft could not be saved.", publishInvalid: "Publication was not confirmed or is invalid.", published: (version) => `Version ${version} is now live.`, publishFailed: "The agent draft could not be published.", rollbackInvalid: "The rollback was not confirmed or is invalid.", rolledBack: (version) => `Version ${version} is live again.`, rollbackFailed: "The live version could not be rolled back.", previewInvalid: "The member preview is invalid.", previewBusy: "Another preview is still being created. Please wait a moment.", previewRateLimited: "The preview limit has been reached. Please try again later.", previewFailed: "The member preview could not be created.", policyInvalid: "Check the AI credit limits.", policySaved: "AI policy saved.", policyUnchanged: "The AI policy is already up to date.", policySaveFailed: "The AI policy could not be saved.", decisionReasonRequired: "Provide a reason for the rejection.", decisionInvalid: "The decision is invalid.", decisionApproved: "Action approved.", decisionRejected: "Action request rejected.", decisionFailed: "The action request could not be decided." },
};

const it: AiAdminCopy = {
  page: { metadataTitle: "Agenti IA", eyebrow: "Apprendimento assistito dall'IA", title: "Agenti IA", description: "Configura assistenti per coaching, feedback sui prompt e moduli guidati." },
  common: { save: "Salva", cancel: "Annulla", version: "Versione" },
  policy: { title: "Policy IA e crediti", monthUsage: "Utilizzo nel mese di calendario corrente", consumedCredits: "Crediti IA utilizzati", reset: (date) => `Ripristino ${date}`, invalid: "La policy salvata non è valida. Le richieste IA sono bloccate finché non viene salvata di nuovo.", enable: "Abilita agenti IA", enableHint: "Ha effetto immediato per tutti i membri e le integrazioni.", monthlyCredits: "Crediti al mese", hourlyLimit: "Limite orario per membro", hourlyCredits: "Crediti per membro e ora", changedAt: (date) => `Ultima modifica ${date}`, defaultActive: "Policy predefinita attiva", usage: "Utilizzo", range: (from, to) => `${from} - ${to}`, periodAria: "Periodo di utilizzo", periods: { currentMonth: "Questo mese", sevenDays: "7 giorni", thirtyDays: "30 giorni", ninetyDays: "90 giorni" }, conversations: "Conversazioni", activeUsers: "Utenti attivi", messages: "Messaggi", inputTokens: "Token di input", outputTokens: "Token di output", agent: "Agente", chats: "Chat", users: "Utenti", input: "Input", output: "Output", empty: "Nessun utilizzo in questo periodo." },
  review: { statuses: { pending: "In attesa", approved: "Approvata", rejected: "Rifiutata", cancelled: "Annullata", expired: "Scaduta" }, approve: "Approva", reject: "Rifiuta", reason: "Motivazione", approveEnrollment: "L'approvazione concede l'accesso al corso in modo atomico ed evita azioni duplicate involontarie.", approveUnenrollment: "L'approvazione rimuove solo l'accesso diretto al corso. L'accesso tramite gruppi o bundle rimane invariato.", approveAssignment: "L'approvazione crea l'assegnazione con provenienza IA esplicita. Le assegnazioni manuali o commerciali esistenti non vengono acquisite.", approveRemoval: "L'approvazione rimuove solo un'assegnazione attiva creata in precedenza dallo stesso agente IA. Le assegnazioni manuali e commerciali restano invariate.", confirmAssignment: "Ho verificato il membro, la destinazione e il tipo di assegnazione.", confirmRemoval: "Ho verificato il membro, la destinazione e la provenienza IA dimostrabile.", confirmReason: "Ho verificato la motivazione.", saveDecision: "Salva decisione", missingTarget: "Destinazione non più disponibile", agentVersion: (name, version) => `${name}, versione ${version}`, decisionReason: (note) => `Motivazione: ${note}`, title: "Approvazioni delle azioni", description: "Decisioni esplicite per le azioni degli agenti con cronologia immutabile.", pendingCount: (count) => `${count} in attesa`, empty: "Nessuna richiesta di azione in attesa.", recent: "Decisioni recenti" },
  messages: { genericSuccess: "Modifica salvata.", genericError: "Non è stato possibile salvare la modifica.", invalidAgent: "L'agente IA non è valido.", agentMissing: "L'agente IA non è stato trovato.", lastActivePause: "L'ultimo agente IA attivo non può essere sospeso. Attiva prima un'alternativa.", unpublishedActivate: "Pubblica una versione dell'agente prima di attivarlo.", agentStatusChanged: (name, active) => `Agente IA “${name}” ${active ? "attivato" : "sospeso"}.`, agentStatusFailed: "Non è stato possibile modificare lo stato dell'agente IA.", invalidConfirmation: "La conferma non è valida.", confirmationMismatch: "Il nome inserito non corrisponde all'agente IA.", agentInUse: (count) => `L'agente IA ha ${count} ${count === 1 ? "conversazione salvata" : "conversazioni salvate"} e non può essere eliminato. Sospendilo invece.`, publishedDelete: "Gli agenti IA pubblicati vengono conservati per gli audit e le chat esistenti. Sospendilo invece.", lastActiveDelete: "L'ultimo agente IA attivo non può essere eliminato. Attiva prima un'alternativa.", agentDeleted: (name) => `Agente IA “${name}” eliminato.`, agentDeleteFailed: "Non è stato possibile eliminare l'agente IA.", invalidConfiguration: "Controlla la configurazione dell'agente.", draftSaved: "Bozza dell'agente salvata.", draftSaveFailed: "Non è stato possibile salvare la bozza dell'agente.", publishInvalid: "La pubblicazione non è stata confermata o non è valida.", published: (version) => `La versione ${version} è ora attiva.`, publishFailed: "Non è stato possibile pubblicare la bozza dell'agente.", rollbackInvalid: "Il ripristino non è stato confermato o non è valido.", rolledBack: (version) => `La versione ${version} è di nuovo attiva.`, rollbackFailed: "Non è stato possibile ripristinare la versione attiva.", previewInvalid: "L'anteprima membro non è valida.", previewBusy: "È ancora in creazione un'altra anteprima. Attendi un momento.", previewRateLimited: "Il limite di anteprime è stato raggiunto. Riprova più tardi.", previewFailed: "Non è stato possibile creare l'anteprima membro.", policyInvalid: "Controlla i limiti dei crediti IA.", policySaved: "Policy IA salvata.", policyUnchanged: "La policy IA è già aggiornata.", policySaveFailed: "Non è stato possibile salvare la policy IA.", decisionReasonRequired: "Fornisci una motivazione per il rifiuto.", decisionInvalid: "La decisione non è valida.", decisionApproved: "Azione approvata.", decisionRejected: "Richiesta di azione rifiutata.", decisionFailed: "Non è stato possibile decidere la richiesta di azione." },
};

const es: AiAdminCopy = {
  page: { metadataTitle: "Agentes de IA", eyebrow: "Aprendizaje asistido por IA", title: "Agentes de IA", description: "Configura asistentes para coaching, comentarios sobre prompts y formularios guiados." },
  common: { save: "Guardar", cancel: "Cancelar", version: "Versión" },
  policy: { title: "Política de IA y créditos", monthUsage: "Uso en el mes natural actual", consumedCredits: "Créditos de IA utilizados", reset: (date) => `Reinicio ${date}`, invalid: "La política guardada no es válida. Las solicitudes de IA están bloqueadas hasta que se vuelva a guardar.", enable: "Activar agentes de IA", enableHint: "Se aplica inmediatamente a todos los miembros e integraciones.", monthlyCredits: "Créditos al mes", hourlyLimit: "Límite por hora y miembro", hourlyCredits: "Créditos por miembro y hora", changedAt: (date) => `Último cambio ${date}`, defaultActive: "Política predeterminada activa", usage: "Uso", range: (from, to) => `${from} a ${to}`, periodAria: "Periodo de uso", periods: { currentMonth: "Este mes", sevenDays: "7 días", thirtyDays: "30 días", ninetyDays: "90 días" }, conversations: "Conversaciones", activeUsers: "Usuarios activos", messages: "Mensajes", inputTokens: "Tokens de entrada", outputTokens: "Tokens de salida", agent: "Agente", chats: "Chats", users: "Usuarios", input: "Entrada", output: "Salida", empty: "No hay uso en este periodo." },
  review: { statuses: { pending: "Pendiente", approved: "Aprobada", rejected: "Rechazada", cancelled: "Cancelada", expired: "Caducada" }, approve: "Aprobar", reject: "Rechazar", reason: "Motivo", approveEnrollment: "La aprobación concede el acceso al curso de forma atómica y evita acciones duplicadas involuntarias.", approveUnenrollment: "La aprobación elimina solo el acceso directo al curso. El acceso mediante grupos o paquetes se mantiene.", approveAssignment: "La aprobación crea la asignación con procedencia de IA explícita. Las asignaciones manuales o comerciales existentes no se adoptan.", approveRemoval: "La aprobación elimina solo una asignación activa creada anteriormente por el mismo agente de IA. Las asignaciones manuales y comerciales se mantienen.", confirmAssignment: "He comprobado el miembro, el destino y el tipo de asignación.", confirmRemoval: "He comprobado el miembro, el destino y la procedencia de IA verificable.", confirmReason: "He comprobado el motivo.", saveDecision: "Guardar decisión", missingTarget: "El destino ya no está disponible", agentVersion: (name, version) => `${name}, versión ${version}`, decisionReason: (note) => `Motivo: ${note}`, title: "Aprobaciones de acciones", description: "Decisiones explícitas para las acciones de agentes con historial inmutable.", pendingCount: (count) => `${count} pendientes`, empty: "No hay solicitudes de acción pendientes.", recent: "Decisiones recientes" },
  messages: { genericSuccess: "Cambio guardado.", genericError: "No se pudo guardar el cambio.", invalidAgent: "El agente de IA no es válido.", agentMissing: "No se encontró el agente de IA.", lastActivePause: "El último agente de IA activo no se puede pausar. Activa antes una alternativa.", unpublishedActivate: "Publica una versión del agente antes de activarlo.", agentStatusChanged: (name, active) => `Agente de IA “${name}” ${active ? "activado" : "pausado"}.`, agentStatusFailed: "No se pudo cambiar el estado del agente de IA.", invalidConfirmation: "La confirmación no es válida.", confirmationMismatch: "El nombre introducido no coincide con el agente de IA.", agentInUse: (count) => `El agente de IA tiene ${count} ${count === 1 ? "conversación guardada" : "conversaciones guardadas"} y no se puede eliminar. Páusalo en su lugar.`, publishedDelete: "Los agentes de IA publicados se conservan para auditorías y chats existentes. Páusalo en su lugar.", lastActiveDelete: "El último agente de IA activo no se puede eliminar. Activa antes una alternativa.", agentDeleted: (name) => `Agente de IA “${name}” eliminado.`, agentDeleteFailed: "No se pudo eliminar el agente de IA.", invalidConfiguration: "Comprueba la configuración del agente.", draftSaved: "Borrador del agente guardado.", draftSaveFailed: "No se pudo guardar el borrador del agente.", publishInvalid: "La publicación no se confirmó o no es válida.", published: (version) => `La versión ${version} ya está activa.`, publishFailed: "No se pudo publicar el borrador del agente.", rollbackInvalid: "La reversión no se confirmó o no es válida.", rolledBack: (version) => `La versión ${version} vuelve a estar activa.`, rollbackFailed: "No se pudo revertir la versión activa.", previewInvalid: "La vista previa del miembro no es válida.", previewBusy: "Todavía se está creando otra vista previa. Espera un momento.", previewRateLimited: "Se ha alcanzado el límite de vistas previas. Inténtalo de nuevo más tarde.", previewFailed: "No se pudo crear la vista previa del miembro.", policyInvalid: "Comprueba los límites de créditos de IA.", policySaved: "Política de IA guardada.", policyUnchanged: "La política de IA ya está actualizada.", policySaveFailed: "No se pudo guardar la política de IA.", decisionReasonRequired: "Indica un motivo para el rechazo.", decisionInvalid: "La decisión no es válida.", decisionApproved: "Acción aprobada.", decisionRejected: "Solicitud de acción rechazada.", decisionFailed: "No se pudo decidir la solicitud de acción." },
};

const fr: AiAdminCopy = {
  page: { metadataTitle: "Agents IA", eyebrow: "Apprentissage assisté par IA", title: "Agents IA", description: "Configurez des assistants pour le coaching, le retour sur les prompts et les formulaires guidés." },
  common: { save: "Enregistrer", cancel: "Annuler", version: "Version" },
  policy: { title: "Politique IA et crédits", monthUsage: "Utilisation pendant le mois civil en cours", consumedCredits: "Crédits IA utilisés", reset: (date) => `Réinitialisation ${date}`, invalid: "La politique enregistrée n'est pas valide. Les requêtes IA sont bloquées jusqu'à son prochain enregistrement.", enable: "Activer les agents IA", enableHint: "Prend effet immédiatement pour tous les membres et toutes les intégrations.", monthlyCredits: "Crédits par mois", hourlyLimit: "Limite horaire par membre", hourlyCredits: "Crédits par membre et par heure", changedAt: (date) => `Dernière modification ${date}`, defaultActive: "Politique par défaut active", usage: "Utilisation", range: (from, to) => `${from} au ${to}`, periodAria: "Période d'utilisation", periods: { currentMonth: "Ce mois-ci", sevenDays: "7 jours", thirtyDays: "30 jours", ninetyDays: "90 jours" }, conversations: "Conversations", activeUsers: "Utilisateurs actifs", messages: "Messages", inputTokens: "Jetons d'entrée", outputTokens: "Jetons de sortie", agent: "Agent", chats: "Chats", users: "Utilisateurs", input: "Entrée", output: "Sortie", empty: "Aucune utilisation pendant cette période." },
  review: { statuses: { pending: "En attente", approved: "Approuvée", rejected: "Refusée", cancelled: "Annulée", expired: "Expirée" }, approve: "Approuver", reject: "Refuser", reason: "Motif", approveEnrollment: "L'approbation accorde l'accès au cours de manière atomique et évite les actions en double involontaires.", approveUnenrollment: "L'approbation supprime uniquement l'accès direct au cours. Les accès via les groupes ou les offres groupées restent intacts.", approveAssignment: "L'approbation crée l'attribution avec une provenance IA explicite. Les attributions manuelles ou commerciales existantes ne sont pas reprises.", approveRemoval: "L'approbation supprime uniquement une attribution active créée auparavant par le même agent IA. Les attributions manuelles et commerciales restent intactes.", confirmAssignment: "J'ai vérifié le membre, la cible et le type d'attribution.", confirmRemoval: "J'ai vérifié le membre, la cible et la provenance IA vérifiable.", confirmReason: "J'ai vérifié le motif.", saveDecision: "Enregistrer la décision", missingTarget: "La cible n'est plus disponible", agentVersion: (name, version) => `${name}, version ${version}`, decisionReason: (note) => `Motif : ${note}`, title: "Approbations d'actions", description: "Décisions explicites pour les actions des agents avec un historique immuable.", pendingCount: (count) => `${count} en attente`, empty: "Aucune demande d'action en attente.", recent: "Décisions récentes" },
  messages: { genericSuccess: "Modification enregistrée.", genericError: "La modification n'a pas pu être enregistrée.", invalidAgent: "L'agent IA n'est pas valide.", agentMissing: "L'agent IA est introuvable.", lastActivePause: "Le dernier agent IA actif ne peut pas être mis en pause. Activez d'abord une autre option.", unpublishedActivate: "Publiez une version de l'agent avant de l'activer.", agentStatusChanged: (name, active) => `Agent IA « ${name} » ${active ? "activé" : "mis en pause"}.`, agentStatusFailed: "Le statut de l'agent IA n'a pas pu être modifié.", invalidConfirmation: "La confirmation n'est pas valide.", confirmationMismatch: "Le nom saisi ne correspond pas à l'agent IA.", agentInUse: (count) => `L'agent IA possède ${count} ${count === 1 ? "conversation enregistrée" : "conversations enregistrées"} et ne peut pas être supprimé. Mettez-le plutôt en pause.`, publishedDelete: "Les agents IA publiés sont conservés pour les audits et les chats existants. Mettez-le plutôt en pause.", lastActiveDelete: "Le dernier agent IA actif ne peut pas être supprimé. Activez d'abord une autre option.", agentDeleted: (name) => `Agent IA « ${name} » supprimé.`, agentDeleteFailed: "L'agent IA n'a pas pu être supprimé.", invalidConfiguration: "Vérifiez la configuration de l'agent.", draftSaved: "Brouillon de l'agent enregistré.", draftSaveFailed: "Le brouillon de l'agent n'a pas pu être enregistré.", publishInvalid: "La publication n'a pas été confirmée ou n'est pas valide.", published: (version) => `La version ${version} est maintenant active.`, publishFailed: "Le brouillon de l'agent n'a pas pu être publié.", rollbackInvalid: "Le retour arrière n'a pas été confirmé ou n'est pas valide.", rolledBack: (version) => `La version ${version} est de nouveau active.`, rollbackFailed: "La version active n'a pas pu être restaurée.", previewInvalid: "L'aperçu membre n'est pas valide.", previewBusy: "Un autre aperçu est encore en cours de création. Patientez un instant.", previewRateLimited: "La limite d'aperçus a été atteinte. Réessayez plus tard.", previewFailed: "L'aperçu membre n'a pas pu être créé.", policyInvalid: "Vérifiez les limites de crédits IA.", policySaved: "Politique IA enregistrée.", policyUnchanged: "La politique IA est déjà à jour.", policySaveFailed: "La politique IA n'a pas pu être enregistrée.", decisionReasonRequired: "Indiquez un motif de refus.", decisionInvalid: "La décision n'est pas valide.", decisionApproved: "Action approuvée.", decisionRejected: "Demande d'action refusée.", decisionFailed: "La demande d'action n'a pas pu être traitée." },
};

const dictionaries: Record<AppLocale, AiAdminCopy> = { de, en, it, es, fr };

export function getAiAdminCopy(locale: AppLocale) {
  return dictionaries[locale];
}

function stringParam(
  params: AiAdminMessageState["messageParams"],
  key: string,
) {
  const value = params?.[key];
  return typeof value === "string" ? value : "";
}

function numberParam(
  params: AiAdminMessageState["messageParams"],
  key: string,
) {
  const value = params?.[key];
  return typeof value === "number" ? value : 0;
}

export function localizeAiAdminMessage(
  locale: AppLocale,
  state: AiAdminMessageState,
) {
  if (state.ok === null) return "";
  const copy = getAiAdminCopy(locale).messages;
  switch (state.messageCode) {
    case "agentStatusChanged":
      return copy.agentStatusChanged(
        stringParam(state.messageParams, "name"),
        state.messageParams?.active === true,
      );
    case "agentInUse":
      return copy.agentInUse(numberParam(state.messageParams, "count"));
    case "agentDeleted":
      return copy.agentDeleted(stringParam(state.messageParams, "name"));
    case "published":
      return copy.published(numberParam(state.messageParams, "version"));
    case "rolledBack":
      return copy.rolledBack(numberParam(state.messageParams, "version"));
    case undefined:
      return state.ok ? copy.genericSuccess : copy.genericError;
    default:
      return copy[state.messageCode];
  }
}

export function formatAiAdminNumber(value: number, locale: AppLocale) {
  return new Intl.NumberFormat(intlLocale(locale)).format(value);
}

export function formatAiAdminDate(
  value: Date | string | null,
  locale: AppLocale,
) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(intlLocale(locale), {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: PLATFORM_TIME_ZONE,
  }).format(date);
}

export function formatAiAdminDateTime(
  value: Date | string | null,
  locale: AppLocale,
) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(intlLocale(locale), {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: PLATFORM_TIME_ZONE,
  }).format(date);
}
