import { intlLocale, type AppLocale } from "@/lib/i18n/model";
import { PLATFORM_TIME_ZONE } from "@/lib/utils";

const de = {
  page: { metadataTitle: "Q-Coach" },
  suggestions: {
    course: "Welcher Kurs passt zu mir?",
    plan: "Erstelle mir einen Lernplan",
    privacy: "Was gilt bei DSGVO und KI?",
  },
  common: {
    defaultAgent: "Q-Coach",
    defaultConversation: "Neue Konversation",
    noMessage: "Noch keine Nachricht",
    newConversation: "Neue Konversation",
    sendMessage: "Nachricht senden",
    send: "Senden",
    responseGenerating: "Antwort wird erstellt",
    archived: "Archiviert",
    curatedSource: "Kuratierte Wissensquelle",
  },
  workspace: {
    history: "Verlauf",
    conversationsAria: "KI-Konversationen",
    historyLoading: "Verlauf wird geladen",
    noConversations: "Noch keine Konversationen.",
    selectAgent: "KI-Agent auswählen",
    newChat: "Neuer Chat",
    conversationLog: "Konversationsverlauf",
    conversationLoading: "Konversation wird geladen",
    emptyPrompt: "Womit möchtest du starten?",
    archivedPlaceholder: "Diese Konversation ist archiviert",
    messagePlaceholder: "Nachricht an den Q-Coach",
  },
  concierge: {
    panelAria: "Q-Academy Lernbegleiter",
    title: "Dein Lernbegleiter",
    close: "Lernbegleiter schließen",
    open: "Lernbegleiter öffnen",
    closeShort: "Schließen",
    selectConversation: "Konversation auswählen",
    compactLog: "Kompakter Konversationsverlauf",
    historyLoading: "Verlauf wird geladen",
    emptyPrompt: "Womit möchtest du starten?",
    archivedPlaceholder: "Konversation archiviert",
    messagePlaceholder: "Frage zum Lernen stellen",
    messageAria: "Nachricht an den Lernbegleiter",
  },
  embedded: {
    loadingAria: "KI-Agent wird geladen",
    loading: "Lernbegleiter wird geladen",
    unavailable: "Dieser Lernbegleiter ist für dich derzeit nicht verfügbar.",
    conversationWith: (name: string) => `Konversation mit ${name}`,
    messageTo: (name: string) => `Nachricht an ${name}`,
    interactionLocked: "Interaktion ist derzeit gesperrt",
  },
  actions: {
    aria: "Freigabepflichtige Agentenaktionen",
    title: "Aktionen",
    approval: "Admin-Freigabe",
    target: "Ziel",
    request: "Anfragen",
    pending: "Offen",
    cancel: "Anfrage abbrechen",
    cancelNamed: (label: string) => `${label} abbrechen`,
    courseActive: "Zugriff aktiv",
    assignmentActive: "Zuweisung aktiv",
    courseRemoved: "Direkter Zugriff entfernt",
    assignmentRemoved: "KI-Zuweisung entfernt",
  },
  transparency: {
    privacy: "Datenschutzhinweis",
    aiPolicy: "KI-Transparenzseite",
    confirming: "Wird bestätigt",
    confirm: "Verstanden, Q-Coach starten",
  },
  errors: {
    historyLoad: "Der Verlauf konnte nicht geladen werden.",
    historyFormat: "Der Verlauf hatte ein unerwartetes Format.",
    messageProcess: "Die Nachricht konnte nicht verarbeitet werden.",
    responseFormat: "Die Antwort hatte ein unerwartetes Format.",
    transparency: "Der Transparenzhinweis konnte nicht bestätigt werden.",
    actionRequest: "Die Aktion konnte nicht angefragt werden.",
    actionCancel: "Die Anfrage konnte nicht abgebrochen werden.",
    signedOut: "Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.",
    unavailable: "Der Lernbegleiter ist für dich derzeit nicht verfügbar.",
    rateLimited: "Das KI-Limit ist erreicht. Bitte versuche es später erneut.",
    invalidRequest: "Die Anfrage ist ungültig. Bitte prüfe deine Eingabe.",
  },
};

type WidenCopy<T> = T extends (...args: infer Args) => string
  ? (...args: Args) => string
  : T extends string
    ? string
    : { readonly [Key in keyof T]: WidenCopy<T[Key]> };

export type AiMemberCopy = WidenCopy<typeof de>;

const en: AiMemberCopy = {
  page: { metadataTitle: "Q-Coach" },
  suggestions: { course: "Which course is right for me?", plan: "Create a learning plan for me", privacy: "What applies to privacy and AI?" },
  common: { defaultAgent: "Q-Coach", defaultConversation: "New conversation", noMessage: "No message yet", newConversation: "New conversation", sendMessage: "Send message", send: "Send", responseGenerating: "Creating response", archived: "Archived", curatedSource: "Curated knowledge source" },
  workspace: { history: "History", conversationsAria: "AI conversations", historyLoading: "Loading history", noConversations: "No conversations yet.", selectAgent: "Select AI agent", newChat: "New chat", conversationLog: "Conversation history", conversationLoading: "Loading conversation", emptyPrompt: "What would you like to start with?", archivedPlaceholder: "This conversation is archived", messagePlaceholder: "Message Q-Coach" },
  concierge: { panelAria: "Q-Academy learning assistant", title: "Your learning assistant", close: "Close learning assistant", open: "Open learning assistant", closeShort: "Close", selectConversation: "Select conversation", compactLog: "Compact conversation history", historyLoading: "Loading history", emptyPrompt: "What would you like to start with?", archivedPlaceholder: "Conversation archived", messagePlaceholder: "Ask a learning question", messageAria: "Message the learning assistant" },
  embedded: { loadingAria: "Loading AI agent", loading: "Loading learning assistant", unavailable: "This learning assistant is currently unavailable to you.", conversationWith: (name) => `Conversation with ${name}`, messageTo: (name) => `Message ${name}`, interactionLocked: "Interaction is currently disabled" },
  actions: { aria: "Agent actions requiring approval", title: "Actions", approval: "Admin approval", target: "Target", request: "Request", pending: "Pending", cancel: "Cancel request", cancelNamed: (label) => `Cancel ${label}`, courseActive: "Access active", assignmentActive: "Assignment active", courseRemoved: "Direct access removed", assignmentRemoved: "AI assignment removed" },
  transparency: { privacy: "Privacy notice", aiPolicy: "AI transparency page", confirming: "Confirming", confirm: "Understood, start Q-Coach" },
  errors: { historyLoad: "The history could not be loaded.", historyFormat: "The history had an unexpected format.", messageProcess: "The message could not be processed.", responseFormat: "The response had an unexpected format.", transparency: "The transparency notice could not be confirmed.", actionRequest: "The action could not be requested.", actionCancel: "The request could not be cancelled.", signedOut: "Your session has expired. Please sign in again.", unavailable: "The learning assistant is currently unavailable to you.", rateLimited: "The AI limit has been reached. Please try again later.", invalidRequest: "The request is invalid. Please check your input." },
};

const it: AiMemberCopy = {
  page: { metadataTitle: "Q-Coach" },
  suggestions: { course: "Quale corso è adatto a me?", plan: "Crea un piano di apprendimento per me", privacy: "Cosa si applica a privacy e IA?" },
  common: { defaultAgent: "Q-Coach", defaultConversation: "Nuova conversazione", noMessage: "Ancora nessun messaggio", newConversation: "Nuova conversazione", sendMessage: "Invia messaggio", send: "Invia", responseGenerating: "Creazione della risposta", archived: "Archiviata", curatedSource: "Fonte di conoscenza curata" },
  workspace: { history: "Cronologia", conversationsAria: "Conversazioni IA", historyLoading: "Caricamento cronologia", noConversations: "Ancora nessuna conversazione.", selectAgent: "Seleziona agente IA", newChat: "Nuova chat", conversationLog: "Cronologia conversazione", conversationLoading: "Caricamento conversazione", emptyPrompt: "Da cosa vuoi iniziare?", archivedPlaceholder: "Questa conversazione è archiviata", messagePlaceholder: "Messaggio a Q-Coach" },
  concierge: { panelAria: "Assistente di apprendimento Q-Academy", title: "Il tuo assistente di apprendimento", close: "Chiudi assistente di apprendimento", open: "Apri assistente di apprendimento", closeShort: "Chiudi", selectConversation: "Seleziona conversazione", compactLog: "Cronologia conversazione compatta", historyLoading: "Caricamento cronologia", emptyPrompt: "Da cosa vuoi iniziare?", archivedPlaceholder: "Conversazione archiviata", messagePlaceholder: "Fai una domanda sull'apprendimento", messageAria: "Messaggio all'assistente di apprendimento" },
  embedded: { loadingAria: "Caricamento agente IA", loading: "Caricamento assistente di apprendimento", unavailable: "Questo assistente di apprendimento non è attualmente disponibile per te.", conversationWith: (name) => `Conversazione con ${name}`, messageTo: (name) => `Messaggio a ${name}`, interactionLocked: "L'interazione è attualmente disattivata" },
  actions: { aria: "Azioni dell'agente soggette ad approvazione", title: "Azioni", approval: "Approvazione admin", target: "Destinazione", request: "Richiedi", pending: "In attesa", cancel: "Annulla richiesta", cancelNamed: (label) => `Annulla ${label}`, courseActive: "Accesso attivo", assignmentActive: "Assegnazione attiva", courseRemoved: "Accesso diretto rimosso", assignmentRemoved: "Assegnazione IA rimossa" },
  transparency: { privacy: "Informativa sulla privacy", aiPolicy: "Pagina di trasparenza IA", confirming: "Conferma in corso", confirm: "Ho capito, avvia Q-Coach" },
  errors: { historyLoad: "Non è stato possibile caricare la cronologia.", historyFormat: "La cronologia aveva un formato imprevisto.", messageProcess: "Non è stato possibile elaborare il messaggio.", responseFormat: "La risposta aveva un formato imprevisto.", transparency: "Non è stato possibile confermare l'informativa sulla trasparenza.", actionRequest: "Non è stato possibile richiedere l'azione.", actionCancel: "Non è stato possibile annullare la richiesta.", signedOut: "La sessione è scaduta. Accedi di nuovo.", unavailable: "L'assistente di apprendimento non è attualmente disponibile per te.", rateLimited: "Il limite IA è stato raggiunto. Riprova più tardi.", invalidRequest: "La richiesta non è valida. Controlla i dati inseriti." },
};

const es: AiMemberCopy = {
  page: { metadataTitle: "Q-Coach" },
  suggestions: { course: "¿Qué curso es adecuado para mí?", plan: "Crea un plan de aprendizaje para mí", privacy: "¿Qué se aplica a privacidad e IA?" },
  common: { defaultAgent: "Q-Coach", defaultConversation: "Nueva conversación", noMessage: "Aún no hay mensajes", newConversation: "Nueva conversación", sendMessage: "Enviar mensaje", send: "Enviar", responseGenerating: "Creando respuesta", archived: "Archivada", curatedSource: "Fuente de conocimiento seleccionada" },
  workspace: { history: "Historial", conversationsAria: "Conversaciones de IA", historyLoading: "Cargando historial", noConversations: "Aún no hay conversaciones.", selectAgent: "Seleccionar agente de IA", newChat: "Nuevo chat", conversationLog: "Historial de conversación", conversationLoading: "Cargando conversación", emptyPrompt: "¿Con qué te gustaría empezar?", archivedPlaceholder: "Esta conversación está archivada", messagePlaceholder: "Mensaje a Q-Coach" },
  concierge: { panelAria: "Asistente de aprendizaje de Q-Academy", title: "Tu asistente de aprendizaje", close: "Cerrar asistente de aprendizaje", open: "Abrir asistente de aprendizaje", closeShort: "Cerrar", selectConversation: "Seleccionar conversación", compactLog: "Historial de conversación compacto", historyLoading: "Cargando historial", emptyPrompt: "¿Con qué te gustaría empezar?", archivedPlaceholder: "Conversación archivada", messagePlaceholder: "Haz una pregunta de aprendizaje", messageAria: "Mensaje al asistente de aprendizaje" },
  embedded: { loadingAria: "Cargando agente de IA", loading: "Cargando asistente de aprendizaje", unavailable: "Este asistente de aprendizaje no está disponible actualmente para ti.", conversationWith: (name) => `Conversación con ${name}`, messageTo: (name) => `Mensaje a ${name}`, interactionLocked: "La interacción está desactivada actualmente" },
  actions: { aria: "Acciones del agente que requieren aprobación", title: "Acciones", approval: "Aprobación de admin", target: "Destino", request: "Solicitar", pending: "Pendiente", cancel: "Cancelar solicitud", cancelNamed: (label) => `Cancelar ${label}`, courseActive: "Acceso activo", assignmentActive: "Asignación activa", courseRemoved: "Acceso directo eliminado", assignmentRemoved: "Asignación de IA eliminada" },
  transparency: { privacy: "Aviso de privacidad", aiPolicy: "Página de transparencia de IA", confirming: "Confirmando", confirm: "Entendido, iniciar Q-Coach" },
  errors: { historyLoad: "No se pudo cargar el historial.", historyFormat: "El historial tenía un formato inesperado.", messageProcess: "No se pudo procesar el mensaje.", responseFormat: "La respuesta tenía un formato inesperado.", transparency: "No se pudo confirmar el aviso de transparencia.", actionRequest: "No se pudo solicitar la acción.", actionCancel: "No se pudo cancelar la solicitud.", signedOut: "Tu sesión ha caducado. Vuelve a iniciar sesión.", unavailable: "El asistente de aprendizaje no está disponible actualmente para ti.", rateLimited: "Se ha alcanzado el límite de IA. Inténtalo de nuevo más tarde.", invalidRequest: "La solicitud no es válida. Revisa los datos introducidos." },
};

const fr: AiMemberCopy = {
  page: { metadataTitle: "Q-Coach" },
  suggestions: { course: "Quel cours me convient ?", plan: "Crée-moi un plan d'apprentissage", privacy: "Quelles règles s'appliquent à la confidentialité et à l'IA ?" },
  common: { defaultAgent: "Q-Coach", defaultConversation: "Nouvelle conversation", noMessage: "Aucun message pour l'instant", newConversation: "Nouvelle conversation", sendMessage: "Envoyer le message", send: "Envoyer", responseGenerating: "Création de la réponse", archived: "Archivée", curatedSource: "Source de connaissances sélectionnée" },
  workspace: { history: "Historique", conversationsAria: "Conversations IA", historyLoading: "Chargement de l'historique", noConversations: "Aucune conversation pour l'instant.", selectAgent: "Sélectionner un agent IA", newChat: "Nouveau chat", conversationLog: "Historique de la conversation", conversationLoading: "Chargement de la conversation", emptyPrompt: "Par quoi souhaitez-vous commencer ?", archivedPlaceholder: "Cette conversation est archivée", messagePlaceholder: "Message à Q-Coach" },
  concierge: { panelAria: "Assistant d'apprentissage Q-Academy", title: "Votre assistant d'apprentissage", close: "Fermer l'assistant d'apprentissage", open: "Ouvrir l'assistant d'apprentissage", closeShort: "Fermer", selectConversation: "Sélectionner une conversation", compactLog: "Historique compact de la conversation", historyLoading: "Chargement de l'historique", emptyPrompt: "Par quoi souhaitez-vous commencer ?", archivedPlaceholder: "Conversation archivée", messagePlaceholder: "Poser une question d'apprentissage", messageAria: "Message à l'assistant d'apprentissage" },
  embedded: { loadingAria: "Chargement de l'agent IA", loading: "Chargement de l'assistant d'apprentissage", unavailable: "Cet assistant d'apprentissage n'est pas disponible actuellement pour vous.", conversationWith: (name) => `Conversation avec ${name}`, messageTo: (name) => `Message à ${name}`, interactionLocked: "L'interaction est actuellement désactivée" },
  actions: { aria: "Actions de l'agent soumises à approbation", title: "Actions", approval: "Approbation admin", target: "Cible", request: "Demander", pending: "En attente", cancel: "Annuler la demande", cancelNamed: (label) => `Annuler ${label}`, courseActive: "Accès actif", assignmentActive: "Attribution active", courseRemoved: "Accès direct supprimé", assignmentRemoved: "Attribution IA supprimée" },
  transparency: { privacy: "Avis de confidentialité", aiPolicy: "Page de transparence IA", confirming: "Confirmation", confirm: "Compris, démarrer Q-Coach" },
  errors: { historyLoad: "L'historique n'a pas pu être chargé.", historyFormat: "L'historique avait un format inattendu.", messageProcess: "Le message n'a pas pu être traité.", responseFormat: "La réponse avait un format inattendu.", transparency: "L'avis de transparence n'a pas pu être confirmé.", actionRequest: "L'action n'a pas pu être demandée.", actionCancel: "La demande n'a pas pu être annulée.", signedOut: "Votre session a expiré. Veuillez vous reconnecter.", unavailable: "L'assistant d'apprentissage n'est pas disponible actuellement pour vous.", rateLimited: "La limite d'IA est atteinte. Veuillez réessayer plus tard.", invalidRequest: "La demande n'est pas valide. Vérifiez votre saisie." },
};

const dictionaries: Record<AppLocale, AiMemberCopy> = { de, en, it, es, fr };

export function getAiMemberCopy(locale: AppLocale): AiMemberCopy {
  return dictionaries[locale];
}

export function getAiInitialSuggestions(locale: AppLocale) {
  const copy = getAiMemberCopy(locale).suggestions;
  return [copy.course, copy.plan, copy.privacy];
}

export function formatAiConversationDate(
  value: string | null,
  locale: AppLocale,
  timeZone: string = PLATFORM_TIME_ZONE,
) {
  const copy = getAiMemberCopy(locale);
  if (!value) return copy.common.noMessage;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(intlLocale(locale), {
    day: "2-digit",
    month: "short",
    timeZone,
  }).format(date);
}

export function resolveAiMemberApiError(
  response: Pick<Response, "status">,
  copy: AiMemberCopy,
  fallback: string,
) {
  if (response.status === 401) return copy.errors.signedOut;
  if (response.status === 403 || response.status === 404) {
    return copy.errors.unavailable;
  }
  if (response.status === 429) return copy.errors.rateLimited;
  if (response.status >= 400 && response.status < 500) {
    return copy.errors.invalidRequest;
  }
  return fallback;
}
