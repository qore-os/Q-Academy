import type { ApiScope } from "@/lib/api/scopes";
import type {
  ApiAdminActionMessage,
  ApiAdminActionMessageKey,
} from "@/lib/api/admin-actions";
import { intlLocale, type AppLocale } from "@/lib/i18n/model";
import { PLATFORM_TIME_ZONE } from "@/lib/utils";

type StandardApiScope = Exclude<ApiScope, "*">;
type ScopeBaseOf<T extends string> = T extends `${infer Base}:${string}`
  ? Base
  : never;

export type ApiScopeBase = ScopeBaseOf<StandardApiScope>;

const scopeGroupByBase = {
  organization: "platform",
  authentication: "security",
  courses: "learning",
  assessments: "learning",
  modules: "learning",
  members: "access",
  team_roles: "security",
  custom_fields: "access",
  groups: "access",
  bundles: "access",
  submissions: "coaching",
  feedback: "coaching",
  community: "community",
  events: "experience",
  notifications: "experience",
  email: "communication",
  search: "platform",
  hubs: "experience",
  agents: "ai",
  analytics: "analytics",
  commerce: "commerce",
  automations: "commerce",
  webhooks: "integrations",
  api_keys: "security",
  audit: "security",
  privacy: "security",
} as const satisfies Record<ApiScopeBase, string>;

type ApiScopeGroup = (typeof scopeGroupByBase)[ApiScopeBase];
type ActionMessageValues = ApiAdminActionMessage["values"];

function actionName(values: ActionMessageValues) {
  return typeof values?.name === "string" ? values.name : "";
}

const de = {
  page: {
    metadataTitle: "API & Webhooks",
    eyebrow: "Developer Platform",
    title: "API & Webhooks",
    description:
      "Verwalte maschinelle Zugriffe, integriere Drittsysteme und analysiere API-Aufrufe deiner Organisation.",
  },
  common: {
    closeDialog: "Dialog schliessen",
    cancel: "Abbrechen",
    working: "Wird ausgefuehrt",
    done: "Fertig",
    copy: "Kopieren",
    copied: "Kopiert",
    copyFailed: "Nicht kopiert",
    retry: "Erneut laden",
    readOnly: "Nur Lesen",
    never: "Noch nie",
    error: "Fehler",
    unknown: "Unbekannt",
    noHttpStatus: "Kein HTTP-Status",
    manage: (name: string) => `${name} verwalten`,
  },
  tabs: {
    ariaLabel: "API-Konsole Bereiche",
    access: "Zugriff",
    endpoints: "Endpoints",
    webhooks: "Webhooks",
    requests: "Request-Log",
  },
  header: {
    eyebrow: "Developer Platform",
    title: "API-Konsole",
    production: "Produktion",
    sandbox: "Sandbox",
    development: "Entwicklung",
    copyBaseUrl: "Basis-URL kopieren",
    documentation: "Dokumentation",
    apiKey: "API-Schluessel",
    activeKeys: "Aktive Keys",
    endpoints: "Endpoints",
    healthyWebhooks: "Webhooks gesund",
    errorRate: "Fehlerrate",
  },
  secret: {
    apiKey: "API-Schluessel",
    webhook: "Webhook-Secret",
    once: "Nur einmal sichtbar",
    description:
      "Dieser Wert wird nicht im Klartext gespeichert und kann nach dem Schliessen nicht erneut angezeigt werden.",
    copy: (kind: string) => `${kind} kopieren`,
  },
  createKey: {
    title: "API-Schluessel erstellen",
    eyebrow: "Maschinenzugriff",
    name: "Name",
    namePlaceholder: "z. B. CRM-Synchronisation",
    expiration: "Ablaufdatum",
    scopes: "Scopes",
    scopesHint: "Nur die fuer diese Integration erforderlichen Rechte auswaehlen.",
    otherCategory: "Weitere",
    passwordLabel: "Aktuelles Passwort",
    oidcDescription:
      "Diese Owner-Aktion erfordert eine aktuelle Bestaetigung beim Identity Provider.",
    oidcButton: "Owner per SSO bestaetigen",
    oidcError: "Unternehmens-Login konnte nicht gestartet werden.",
    submit: "Schluessel erstellen",
    submitting: "Wird erstellt",
  },
  createWebhook: {
    title: "Webhook erstellen",
    eyebrow: "Event-Ziel",
    name: "Name",
    namePlaceholder: "z. B. Mitglieder-Sync",
    target: "HTTPS-Ziel",
    targetPlaceholder: "https://example.com/webhooks",
    events: "Events",
    eventsHint: "Events auswaehlen, die an dieses Ziel zugestellt werden.",
    submit: "Webhook erstellen",
    submitting: "Wird erstellt",
  },
  confirm: { eyebrow: "Bestaetigung" },
  keyActions: {
    revoke: "API-Schluessel widerrufen",
    revokeDescription: (name: string) =>
      `Der Zugriff von "${name}" wird sofort und dauerhaft beendet.`,
    confirmRevoke: "Widerrufen",
  },
  webhookActions: {
    activate: "Webhook aktivieren",
    deactivate: "Webhook deaktivieren",
    rotate: "Secret rotieren",
    delete: "Webhook loeschen",
    deleteDescription: (name: string) =>
      `"${name}" und die zugehoerige Zustellhistorie werden dauerhaft geloescht.`,
    rotatedTitle: "Neues Webhook-Secret",
    rotatedEyebrow: "Secret rotiert",
    failed: "Die Webhook-Aktion konnte nicht ausgefuehrt werden.",
  },
  access: {
    title: "API-Schluessel",
    description: "Zugriff getrennt nach Anwendung und Umgebung steuern.",
    search: "Keys durchsuchen",
    filterAria: "Nach Scope filtern",
    allScopes: "Alle Scopes",
    columns: {
      key: "Schluessel",
      scopes: "Scopes",
      usage: "Nutzung",
      created: "Erstellt",
      status: "Status",
      action: "Aktion",
    },
    requests: (count: string) => `${count} Requests`,
    lastUsed: (date: string) => `Zuletzt ${date}`,
    validUntil: (date: string) => `Gueltig bis ${date}`,
    unlimited: "Unbefristet",
    active: "Aktiv",
    expired: "Abgelaufen",
    revoked: "Widerrufen",
    emptyTitle: "Keine passenden Schluessel",
    emptyDescription:
      "Passe Suche oder Scope-Filter an, um weitere API-Schluessel zu sehen.",
    catalogTitle: "Scope-Katalog",
    catalogDescription: "Scopes folgen dem Prinzip der minimalen Berechtigung.",
    read: "Lesen",
    write: "Schreiben",
    admin: "Admin",
    noScopesTitle: "Keine Scopes",
    noScopesDescription:
      "Fuer diese API wurden noch keine Berechtigungen definiert.",
  },
  endpoints: {
    search: "Endpoint oder Pfad suchen",
    filterAria: "Endpoints nach Scope filtern",
    allScopes: "Alle Scopes",
    emptyTitle: "Keine Endpoints",
    emptyDescription:
      "Keine Route entspricht der aktuellen Suche und dem Scope-Filter.",
    stable: "Stable",
    beta: "Beta",
    deprecated: "Veraltet",
    copyPath: "Pfad kopieren",
    requiredScopes: "Benoetigte Scopes",
    public: "Oeffentlich",
    requestContract: "Request-Vertrag",
    parameter: "Parameter",
    location: "Ort",
    type: "Typ",
    description: "Beschreibung",
    example: (value: string) => `z. B. ${value}`,
    noParameters: "Dieser Endpoint erwartet keine Parameter.",
    responses: "Responses",
    codeLanguageAria: "Codebeispiel Sprache",
    copyCode: "Code kopieren",
    responseExample: "Response-Beispiel",
    copyResponse: "Response kopieren",
    codeExampleTitle: "Beispiel",
    selectTitle: "Endpoint auswaehlen",
    selectDescription:
      "Waehle links einen Endpoint, um Vertrag und Codebeispiele zu sehen.",
    requestBodyFallback: "JSON-Request-Body.",
    parameterFallback: "OpenAPI-Parameter.",
    responseFallback: "API-Response.",
    contractFallback: (title: string) =>
      `${title}. Vertrag und Parameter stammen aus der aktuellen OpenAPI-Spezifikation.`,
  },
  webhooks: {
    title: "Webhook-Ziele",
    description: "Signierte Events in Echtzeit an angebundene Systeme senden.",
    search: "Webhooks durchsuchen",
    columns: {
      target: "Ziel",
      events: "Events",
      lastDelivery: "Letzte Zustellung",
      successRate: "Erfolgsquote",
      status: "Status",
      actions: "Aktionen",
    },
    copyUrl: "Webhook-URL kopieren",
    signature: (hint: string) => `Signatur: ${hint}`,
    active: "Aktiv",
    failing: "Fehler",
    paused: "Pausiert",
    noRate: "Keine Quote",
    successfulRate: (rate: string) => `${rate} erfolgreich`,
    emptyTitle: "Keine passenden Webhooks",
    emptyDescription:
      "Lege ein Ziel an oder passe die Suche an, um Webhooks zu sehen.",
  },
  deadLetters: {
    title: "Fehlgeschlagene Zustellungen",
    description:
      "Dead-Letter-Queue fuer endgueltig fehlgeschlagene Webhook-Events.",
    search: "Zustellungen durchsuchen",
    refresh: "Zustellungen aktualisieren",
    refreshing: "Zustellungen werden aktualisiert",
    columns: {
      targetEvent: "Ziel und Event",
      error: "Fehler",
      attempt: "Versuch",
      time: "Zeitpunkt",
      details: "Details",
    },
    showDetails: "Zustellungsdetails anzeigen",
    noMatchesTitle: "Keine passenden Zustellungen",
    noMatchesDescription:
      "Passe die Suche an, um weitere fehlgeschlagene Zustellungen zu sehen.",
    emptyTitle: "Keine Dead Letters",
    emptyDescription:
      "Aktuell wartet keine endgueltig fehlgeschlagene Zustellung auf Bearbeitung.",
    detailEyebrow: "Zustellungsdetails",
    loadingDetails: "Details werden geladen",
    failed: "Fehlgeschlagen",
    event: "Event",
    attempts: "Versuche",
    attemptOf: (current: number, total: number) => `${current} von ${total}`,
    runtime: "Laufzeit",
    httpStatus: "HTTP-Status",
    lastAttempt: "Letzter Versuch",
    deliveryError: "Zustellungsfehler",
    history: "Versuchshistorie",
    entries: (count: number) => `${count} Eintraege`,
    runAttempt: (run: number, attempt: number) =>
      `Lauf ${run}, Versuch ${attempt}`,
    responseRedacted:
      "Antwortinhalt aus Sicherheitsgruenden ausgeblendet.",
    noAttemptHistory:
      "Fuer diese historische Zustellung liegt kein einzelner Versuchseintrag vor.",
    safePayload: "Sichere Payload-Uebersicht",
    payloadId: "Payload-ID",
    payloadType: "Payload-Typ",
    dataFields: "Enthaltene Datenfelder",
    close: "Schliessen",
    queueing: "Wird eingeplant",
    requeue: "Erneut einplanen",
    loadFailed:
      "Die fehlgeschlagenen Zustellungen konnten nicht geladen werden.",
    detailLoadFailed: "Die Zustellungsdetails konnten nicht geladen werden.",
    requeueFailed: "Die Zustellung konnte nicht erneut eingeplant werden.",
    failureKinds: {
      http: "HTTP-Fehler",
      timeout: "Zeitlimit",
      dns: "DNS",
      tls: "TLS",
      connection: "Verbindung",
      configuration: "Konfiguration",
      unknown: "Unbekannt",
    },
    responseSummaries: {
      http: (status: number) =>
        `Das Zielsystem antwortete mit HTTP ${status}. Der Antwortinhalt wird aus Sicherheitsgruenden nicht angezeigt.`,
      timeout:
        "Das Zeitlimit fuer die Verbindung zum Zielsystem wurde ueberschritten.",
      dns: "Die DNS-Aufloesung des Zielsystems ist fehlgeschlagen.",
      tls: "Die sichere TLS-Verbindung zum Zielsystem ist fehlgeschlagen.",
      configuration:
        "Die Webhook-Konfiguration verhindert derzeit eine Zustellung.",
      connection: "Die Verbindung zum Zielsystem ist fehlgeschlagen.",
      unknown:
        "Die Zustellung ist fehlgeschlagen. Technische Antwortdetails wurden aus Sicherheitsgruenden ausgeblendet.",
    },
    outcomes: {
      delivered: "Zugestellt",
      retrying: "Wiederholung geplant",
      failed: "Endgueltig fehlgeschlagen",
    },
  },
  requests: {
    title: "Request-Log",
    description: "Die letzten API-Aufrufe fuer Diagnose und Audit.",
    search: "Pfad, Status oder Request-ID",
    columns: {
      time: "Zeitpunkt",
      request: "Request",
      status: "Status",
      latency: "Latenz",
      apiKey: "API-Key",
      requestId: "Request-ID",
      response: "Antwort",
    },
    copyRequestId: "Request-ID kopieren",
    emptyTitle: "Keine passenden Requests",
    emptyDescription:
      "Fuer die aktuelle Suche sind keine API-Aufrufe vorhanden.",
    shown: (visible: number, total: number) => `${visible} von ${total} Requests`,
    errorRate: (rate: string) => `Fehlerrate ${rate}`,
  },
  actionMessages: {
    "validation.invalidInput": () => "Bitte pruefe die Eingaben.",
    "validation.nameTooShort": () => "Der Name muss mindestens zwei Zeichen enthalten.",
    "validation.nameTooLong": () => "Der Name darf hoechstens 160 Zeichen enthalten.",
    "validation.apiScopesRequired": () => "Waehle mindestens einen Scope.",
    "validation.apiScopesTooMany": () => "Es wurden zu viele Scopes ausgewaehlt.",
    "validation.apiScopesDuplicate": () => "Scopes duerfen nicht doppelt vorkommen.",
    "validation.expirationDateInvalid": () => "Das Ablaufdatum ist ungueltig.",
    "validation.currentPasswordTooLong": () => "Das aktuelle Passwort ist zu lang.",
    "validation.webhookUrlInvalid": () => "Die Webhook-URL ist ungueltig.",
    "validation.webhookHttpsRequired": () => "Webhook-Ziele muessen HTTPS verwenden.",
    "validation.webhookEventsRequired": () => "Waehle mindestens ein Event.",
    "validation.webhookEventsTooMany": () => "Es wurden zu viele Events ausgewaehlt.",
    "validation.webhookEventsDuplicate": () => "Events duerfen nicht doppelt vorkommen.",
    "apiKey.ownerScopeRequiresOwner": () => "Owner-gebundene Scopes koennen nur von einem Owner erstellt werden.",
    "apiKey.expirationDateMustBeFuture": () => "Das Ablaufdatum muss in der Zukunft liegen.",
    "apiKey.ownerVerificationInvalidPassword": () => "Das aktuelle Passwort ist nicht korrekt.",
    "apiKey.ownerVerificationRateLimited": () => "Zu viele Bestaetigungsversuche. Bitte versuche es spaeter erneut.",
    "apiKey.ownerVerificationOwnerRequired": () => "Diese Aktion ist nur fuer Owner verfuegbar.",
    "apiKey.ownerVerificationReauthenticationRequired": () => "Bitte bestaetige deine Identitaet erneut.",
    "apiKey.created": () => "API-Schluessel erstellt.",
    "apiKey.createFailed": () => "Der API-Schluessel konnte nicht erstellt werden.",
    "apiKey.invalid": () => "Der API-Schluessel ist ungueltig.",
    "apiKey.notFoundOrRevoked": () => "Der API-Schluessel wurde nicht gefunden oder bereits widerrufen.",
    "apiKey.revoked": (values) => `API-Schluessel "${actionName(values)}" widerrufen.`,
    "apiKey.revokeFailed": () => "Der API-Schluessel konnte nicht widerrufen werden.",
    "webhook.created": () => "Webhook erstellt.",
    "webhook.createFailed": () => "Der Webhook konnte nicht erstellt werden.",
    "webhook.invalid": () => "Der Webhook ist ungueltig.",
    "webhook.notFound": () => "Der Webhook wurde nicht gefunden.",
    "webhook.activated": (values) => `Webhook "${actionName(values)}" aktiviert.`,
    "webhook.deactivated": (values) => `Webhook "${actionName(values)}" deaktiviert.`,
    "webhook.statusChangeFailed": () => "Der Webhook-Status konnte nicht geaendert werden.",
    "webhook.secretRotated": (values) => `Signatur-Secret fuer "${actionName(values)}" rotiert.`,
    "webhook.secretRotationFailed": () => "Das Webhook-Secret konnte nicht rotiert werden.",
    "webhook.deleted": (values) => `Webhook "${actionName(values)}" geloescht.`,
    "webhook.deleteFailed": () => "Der Webhook konnte nicht geloescht werden.",
    "webhookDelivery.failedListLoaded": () => "Fehlgeschlagene Zustellungen aktualisiert.",
    "webhookDelivery.failedListLoadFailed": () => "Die fehlgeschlagenen Zustellungen konnten nicht geladen werden.",
    "webhookDelivery.invalid": () => "Die Webhook-Zustellung ist ungueltig.",
    "webhookDelivery.notFound": () => "Die Webhook-Zustellung wurde nicht gefunden.",
    "webhookDelivery.loaded": () => "Webhook-Zustellung geladen.",
    "webhookDelivery.loadFailed": () => "Die Webhook-Zustellung konnte nicht geladen werden.",
    "webhookDelivery.notReplayable": () => "Diese Zustellung ist nicht mehr fehlgeschlagen und kann nicht erneut eingeplant werden.",
    "webhookDelivery.requeued": (values) => `Zustellung an "${actionName(values)}" wurde erneut eingeplant.`,
    "webhookDelivery.replayFailed": () => "Die Webhook-Zustellung konnte nicht erneut eingeplant werden.",
  } satisfies Record<
    ApiAdminActionMessageKey,
    (values?: ActionMessageValues) => string
  >,
  scopes: {
    fullAccessLabel: "Vollzugriff ohne Owner-Rechte",
    fullAccessDescription:
      "Zugriff auf aktuelle und zukuenftige Standardressourcen. Owner-gebundene Sicherheits-Scopes muessen immer explizit vergeben werden.",
    readLabel: (resource: string) => `${resource} lesen`,
    writeLabel: (resource: string) => `${resource} verwalten`,
    readDescription: (resource: string) => `Lesezugriff auf ${resource}.`,
    writeDescription: (resource: string) => `Schreibzugriff auf ${resource}.`,
    resources: {
      organization: "Organisation",
      authentication: "Authentifizierung",
      courses: "Kurse",
      assessments: "Pruefungen",
      modules: "Module und Lektionen",
      members: "Mitglieder",
      team_roles: "Team-Rollen",
      custom_fields: "Profilfelder",
      groups: "Gruppen",
      bundles: "Bundles",
      submissions: "Abgaben",
      feedback: "Feedback",
      community: "Community",
      events: "Events",
      notifications: "Benachrichtigungen",
      email: "E-Mail-Center",
      search: "Globale Suche",
      hubs: "Hubs",
      agents: "KI-Agenten",
      analytics: "Statistiken",
      commerce: "Commerce",
      automations: "Automationen",
      webhooks: "Webhooks",
      api_keys: "API-Schluessel",
      audit: "Audit-Log",
      privacy: "Datenschutz",
    },
    groups: {
      platform: "Plattform",
      security: "Sicherheit",
      learning: "Lerninhalte",
      access: "Zugriff",
      coaching: "Coaching",
      community: "Community",
      experience: "Erlebnis",
      communication: "Kommunikation",
      ai: "Kuenstliche Intelligenz",
      analytics: "Analyse",
      commerce: "Commerce",
      integrations: "Integrationen",
    },
  },
};

type WidenCopy<T> = T extends (...args: infer Args) => string
  ? (...args: Args) => string
  : T extends string
    ? string
    : { readonly [Key in keyof T]: WidenCopy<T[Key]> };

export type ApiConsoleCopy = WidenCopy<typeof de>;

const en: ApiConsoleCopy = {
  page: { metadataTitle: "API & webhooks", eyebrow: "Developer platform", title: "API & webhooks", description: "Manage machine access, integrate external systems and analyse your organisation's API calls." },
  common: { closeDialog: "Close dialog", cancel: "Cancel", working: "Working", done: "Done", copy: "Copy", copied: "Copied", copyFailed: "Not copied", retry: "Try again", readOnly: "Read only", never: "Never", error: "Error", unknown: "Unknown", noHttpStatus: "No HTTP status", manage: (name) => `Manage ${name}` },
  tabs: { ariaLabel: "API console sections", access: "Access", endpoints: "Endpoints", webhooks: "Webhooks", requests: "Request log" },
  header: { eyebrow: "Developer platform", title: "API console", production: "Production", sandbox: "Sandbox", development: "Development", copyBaseUrl: "Copy base URL", documentation: "Documentation", apiKey: "API key", activeKeys: "Active keys", endpoints: "Endpoints", healthyWebhooks: "Healthy webhooks", errorRate: "Error rate" },
  secret: { apiKey: "API key", webhook: "Webhook secret", once: "Visible once", description: "This value is not stored in plain text and cannot be shown again after closing.", copy: (kind) => `Copy ${kind}` },
  createKey: { title: "Create API key", eyebrow: "Machine access", name: "Name", namePlaceholder: "e.g. CRM synchronisation", expiration: "Expiry date", scopes: "Scopes", scopesHint: "Select only the permissions required by this integration.", otherCategory: "Other", passwordLabel: "Current password", oidcDescription: "This owner action requires a current confirmation from the identity provider.", oidcButton: "Confirm owner via SSO", oidcError: "The corporate login could not be started.", submit: "Create key", submitting: "Creating" },
  createWebhook: { title: "Create webhook", eyebrow: "Event destination", name: "Name", namePlaceholder: "e.g. member sync", target: "HTTPS destination", targetPlaceholder: "https://example.com/webhooks", events: "Events", eventsHint: "Select the events to deliver to this destination.", submit: "Create webhook", submitting: "Creating" },
  confirm: { eyebrow: "Confirmation" },
  keyActions: { revoke: "Revoke API key", revokeDescription: (name) => `Access for "${name}" will end immediately and permanently.`, confirmRevoke: "Revoke" },
  webhookActions: { activate: "Activate webhook", deactivate: "Deactivate webhook", rotate: "Rotate secret", delete: "Delete webhook", deleteDescription: (name) => `"${name}" and its delivery history will be permanently deleted.`, rotatedTitle: "New webhook secret", rotatedEyebrow: "Secret rotated", failed: "The webhook action could not be completed." },
  access: { title: "API keys", description: "Control access separately for each application and environment.", search: "Search keys", filterAria: "Filter by scope", allScopes: "All scopes", columns: { key: "Key", scopes: "Scopes", usage: "Usage", created: "Created", status: "Status", action: "Action" }, requests: (count) => `${count} requests`, lastUsed: (date) => `Last used ${date}`, validUntil: (date) => `Valid until ${date}`, unlimited: "No expiry", active: "Active", expired: "Expired", revoked: "Revoked", emptyTitle: "No matching keys", emptyDescription: "Adjust the search or scope filter to see more API keys.", catalogTitle: "Scope catalogue", catalogDescription: "Scopes follow the principle of least privilege.", read: "Read", write: "Write", admin: "Admin", noScopesTitle: "No scopes", noScopesDescription: "No permissions have been defined for this API yet." },
  endpoints: { search: "Search endpoint or path", filterAria: "Filter endpoints by scope", allScopes: "All scopes", emptyTitle: "No endpoints", emptyDescription: "No route matches the current search and scope filter.", stable: "Stable", beta: "Beta", deprecated: "Deprecated", copyPath: "Copy path", requiredScopes: "Required scopes", public: "Public", requestContract: "Request contract", parameter: "Parameter", location: "Location", type: "Type", description: "Description", example: (value) => `e.g. ${value}`, noParameters: "This endpoint does not expect any parameters.", responses: "Responses", codeLanguageAria: "Code example language", copyCode: "Copy code", responseExample: "Response example", copyResponse: "Copy response", codeExampleTitle: "Example", selectTitle: "Select an endpoint", selectDescription: "Select an endpoint on the left to inspect its contract and code examples.", requestBodyFallback: "JSON request body.", parameterFallback: "OpenAPI parameter.", responseFallback: "API response.", contractFallback: (title) => `${title}. The contract and parameters come from the current OpenAPI specification.` },
  webhooks: { title: "Webhook destinations", description: "Send signed events to connected systems in real time.", search: "Search webhooks", columns: { target: "Destination", events: "Events", lastDelivery: "Last delivery", successRate: "Success rate", status: "Status", actions: "Actions" }, copyUrl: "Copy webhook URL", signature: (hint) => `Signature: ${hint}`, active: "Active", failing: "Failing", paused: "Paused", noRate: "No rate", successfulRate: (rate) => `${rate} successful`, emptyTitle: "No matching webhooks", emptyDescription: "Create a destination or adjust the search to see webhooks." },
  deadLetters: { title: "Failed deliveries", description: "Dead-letter queue for webhook events that permanently failed.", search: "Search deliveries", refresh: "Refresh deliveries", refreshing: "Refreshing deliveries", columns: { targetEvent: "Destination and event", error: "Error", attempt: "Attempt", time: "Time", details: "Details" }, showDetails: "Show delivery details", noMatchesTitle: "No matching deliveries", noMatchesDescription: "Adjust the search to see more failed deliveries.", emptyTitle: "No dead letters", emptyDescription: "No permanently failed delivery currently requires attention.", detailEyebrow: "Delivery details", loadingDetails: "Loading details", failed: "Failed", event: "Event", attempts: "Attempts", attemptOf: (current, total) => `${current} of ${total}`, runtime: "Duration", httpStatus: "HTTP status", lastAttempt: "Last attempt", deliveryError: "Delivery error", history: "Attempt history", entries: (count) => `${count} entries`, runAttempt: (run, attempt) => `Run ${run}, attempt ${attempt}`, responseRedacted: "Response content hidden for security reasons.", noAttemptHistory: "No individual attempt record exists for this historical delivery.", safePayload: "Safe payload overview", payloadId: "Payload ID", payloadType: "Payload type", dataFields: "Included data fields", close: "Close", queueing: "Queueing", requeue: "Queue again", loadFailed: "The failed deliveries could not be loaded.", detailLoadFailed: "The delivery details could not be loaded.", requeueFailed: "The delivery could not be queued again.", failureKinds: { http: "HTTP error", timeout: "Timeout", dns: "DNS", tls: "TLS", connection: "Connection", configuration: "Configuration", unknown: "Unknown" }, responseSummaries: { http: (status) => `The destination responded with HTTP ${status}. Response content is hidden for security reasons.`, timeout: "The connection to the destination timed out.", dns: "DNS resolution for the destination failed.", tls: "The secure TLS connection to the destination failed.", configuration: "The webhook configuration currently prevents delivery.", connection: "The connection to the destination failed.", unknown: "Delivery failed. Technical response details were hidden for security reasons." }, outcomes: { delivered: "Delivered", retrying: "Retry scheduled", failed: "Permanently failed" } },
  requests: { title: "Request log", description: "The latest API calls for diagnostics and auditing.", search: "Path, status or request ID", columns: { time: "Time", request: "Request", status: "Status", latency: "Latency", apiKey: "API key", requestId: "Request ID", response: "Response" }, copyRequestId: "Copy request ID", emptyTitle: "No matching requests", emptyDescription: "No API calls match the current search.", shown: (visible, total) => `${visible} of ${total} requests`, errorRate: (rate) => `Error rate ${rate}` },
  actionMessages: {
    "validation.invalidInput": () => "Check the form entries.", "validation.nameTooShort": () => "The name must contain at least two characters.", "validation.nameTooLong": () => "The name must not exceed 160 characters.", "validation.apiScopesRequired": () => "Select at least one scope.", "validation.apiScopesTooMany": () => "Too many scopes were selected.", "validation.apiScopesDuplicate": () => "Scopes must not be duplicated.", "validation.expirationDateInvalid": () => "The expiry date is invalid.", "validation.currentPasswordTooLong": () => "The current password is too long.", "validation.webhookUrlInvalid": () => "The webhook URL is invalid.", "validation.webhookHttpsRequired": () => "Webhook destinations must use HTTPS.", "validation.webhookEventsRequired": () => "Select at least one event.", "validation.webhookEventsTooMany": () => "Too many events were selected.", "validation.webhookEventsDuplicate": () => "Events must not be duplicated.",
    "apiKey.ownerScopeRequiresOwner": () => "Owner-bound scopes can only be created by an owner.", "apiKey.expirationDateMustBeFuture": () => "The expiry date must be in the future.", "apiKey.ownerVerificationInvalidPassword": () => "The current password is incorrect.", "apiKey.ownerVerificationRateLimited": () => "Too many confirmation attempts. Try again later.", "apiKey.ownerVerificationOwnerRequired": () => "This action is only available to owners.", "apiKey.ownerVerificationReauthenticationRequired": () => "Confirm your identity again.", "apiKey.created": () => "API key created.", "apiKey.createFailed": () => "The API key could not be created.", "apiKey.invalid": () => "The API key is invalid.", "apiKey.notFoundOrRevoked": () => "The API key was not found or has already been revoked.", "apiKey.revoked": (values) => `API key "${actionName(values)}" revoked.`, "apiKey.revokeFailed": () => "The API key could not be revoked.",
    "webhook.created": () => "Webhook created.", "webhook.createFailed": () => "The webhook could not be created.", "webhook.invalid": () => "The webhook is invalid.", "webhook.notFound": () => "The webhook was not found.", "webhook.activated": (values) => `Webhook "${actionName(values)}" activated.`, "webhook.deactivated": (values) => `Webhook "${actionName(values)}" deactivated.`, "webhook.statusChangeFailed": () => "The webhook status could not be changed.", "webhook.secretRotated": (values) => `Signing secret for "${actionName(values)}" rotated.`, "webhook.secretRotationFailed": () => "The webhook secret could not be rotated.", "webhook.deleted": (values) => `Webhook "${actionName(values)}" deleted.`, "webhook.deleteFailed": () => "The webhook could not be deleted.",
    "webhookDelivery.failedListLoaded": () => "Failed deliveries refreshed.", "webhookDelivery.failedListLoadFailed": () => "The failed deliveries could not be loaded.", "webhookDelivery.invalid": () => "The webhook delivery is invalid.", "webhookDelivery.notFound": () => "The webhook delivery was not found.", "webhookDelivery.loaded": () => "Webhook delivery loaded.", "webhookDelivery.loadFailed": () => "The webhook delivery could not be loaded.", "webhookDelivery.notReplayable": () => "This delivery is no longer failed and cannot be queued again.", "webhookDelivery.requeued": (values) => `Delivery to "${actionName(values)}" queued again.`, "webhookDelivery.replayFailed": () => "The webhook delivery could not be queued again.",
  },
  scopes: { fullAccessLabel: "Full access without owner permissions", fullAccessDescription: "Access current and future standard resources. Owner-bound security scopes must always be granted explicitly.", readLabel: (resource) => `Read ${resource}`, writeLabel: (resource) => `Manage ${resource}`, readDescription: (resource) => `Read access to ${resource}.`, writeDescription: (resource) => `Write access to ${resource}.`, resources: { organization: "organisation", authentication: "authentication", courses: "courses", assessments: "assessments", modules: "modules and lessons", members: "members", team_roles: "team roles", custom_fields: "profile fields", groups: "groups", bundles: "bundles", submissions: "submissions", feedback: "feedback", community: "community", events: "events", notifications: "notifications", email: "email centre", search: "global search", hubs: "hubs", agents: "AI agents", analytics: "analytics", commerce: "commerce", automations: "automations", webhooks: "webhooks", api_keys: "API keys", audit: "audit log", privacy: "privacy" }, groups: { platform: "Platform", security: "Security", learning: "Learning content", access: "Access", coaching: "Coaching", community: "Community", experience: "Experience", communication: "Communication", ai: "Artificial intelligence", analytics: "Analytics", commerce: "Commerce", integrations: "Integrations" } },
};

const it: ApiConsoleCopy = {
  ...en,
  page: { metadataTitle: "API e webhook", eyebrow: "Piattaforma sviluppatori", title: "API e webhook", description: "Gestisci gli accessi automatici, integra sistemi esterni e analizza le chiamate API della tua organizzazione." },
  common: { closeDialog: "Chiudi finestra", cancel: "Annulla", working: "Operazione in corso", done: "Fatto", copy: "Copia", copied: "Copiato", copyFailed: "Non copiato", retry: "Riprova", readOnly: "Sola lettura", never: "Mai", error: "Errore", unknown: "Sconosciuto", noHttpStatus: "Nessuno stato HTTP", manage: (name) => `Gestisci ${name}` },
  tabs: { ariaLabel: "Sezioni della console API", access: "Accesso", endpoints: "Endpoint", webhooks: "Webhook", requests: "Registro richieste" },
  header: { eyebrow: "Piattaforma sviluppatori", title: "Console API", production: "Produzione", sandbox: "Sandbox", development: "Sviluppo", copyBaseUrl: "Copia URL di base", documentation: "Documentazione", apiKey: "Chiave API", activeKeys: "Chiavi attive", endpoints: "Endpoint", healthyWebhooks: "Webhook integri", errorRate: "Tasso di errore" },
  secret: { apiKey: "Chiave API", webhook: "Segreto webhook", once: "Visibile una sola volta", description: "Questo valore non viene salvato in chiaro e non potrà essere mostrato di nuovo dopo la chiusura.", copy: (kind) => `Copia ${kind}` },
  createKey: { title: "Crea chiave API", eyebrow: "Accesso automatico", name: "Nome", namePlaceholder: "es. sincronizzazione CRM", expiration: "Data di scadenza", scopes: "Scope", scopesHint: "Seleziona solo le autorizzazioni necessarie per questa integrazione.", otherCategory: "Altro", passwordLabel: "Password attuale", oidcDescription: "Questa azione del proprietario richiede una conferma aggiornata dal provider di identità.", oidcButton: "Conferma proprietario tramite SSO", oidcError: "Non è stato possibile avviare l'accesso aziendale.", submit: "Crea chiave", submitting: "Creazione" },
  createWebhook: { title: "Crea webhook", eyebrow: "Destinazione eventi", name: "Nome", namePlaceholder: "es. sincronizzazione membri", target: "Destinazione HTTPS", targetPlaceholder: "https://example.com/webhooks", events: "Eventi", eventsHint: "Seleziona gli eventi da inviare a questa destinazione.", submit: "Crea webhook", submitting: "Creazione" },
  confirm: { eyebrow: "Conferma" },
  keyActions: { revoke: "Revoca chiave API", revokeDescription: (name) => `L'accesso di "${name}" terminerà immediatamente e definitivamente.`, confirmRevoke: "Revoca" },
  webhookActions: { activate: "Attiva webhook", deactivate: "Disattiva webhook", rotate: "Ruota segreto", delete: "Elimina webhook", deleteDescription: (name) => `"${name}" e la relativa cronologia di consegna saranno eliminati definitivamente.`, rotatedTitle: "Nuovo segreto webhook", rotatedEyebrow: "Segreto ruotato", failed: "Non è stato possibile completare l'azione sul webhook." },
  access: { title: "Chiavi API", description: "Controlla separatamente l'accesso per applicazione e ambiente.", search: "Cerca chiavi", filterAria: "Filtra per scope", allScopes: "Tutti gli scope", columns: { key: "Chiave", scopes: "Scope", usage: "Utilizzo", created: "Creata", status: "Stato", action: "Azione" }, requests: (count) => `${count} richieste`, lastUsed: (date) => `Ultimo utilizzo ${date}`, validUntil: (date) => `Valida fino al ${date}`, unlimited: "Senza scadenza", active: "Attiva", expired: "Scaduta", revoked: "Revocata", emptyTitle: "Nessuna chiave corrispondente", emptyDescription: "Modifica la ricerca o il filtro scope per vedere altre chiavi API.", catalogTitle: "Catalogo scope", catalogDescription: "Gli scope seguono il principio del privilegio minimo.", read: "Lettura", write: "Scrittura", admin: "Admin", noScopesTitle: "Nessuno scope", noScopesDescription: "Non sono ancora state definite autorizzazioni per questa API." },
  endpoints: { search: "Cerca endpoint o percorso", filterAria: "Filtra endpoint per scope", allScopes: "Tutti gli scope", emptyTitle: "Nessun endpoint", emptyDescription: "Nessun percorso corrisponde alla ricerca e al filtro attuali.", stable: "Stabile", beta: "Beta", deprecated: "Obsoleto", copyPath: "Copia percorso", requiredScopes: "Scope richiesti", public: "Pubblico", requestContract: "Contratto richiesta", parameter: "Parametro", location: "Posizione", type: "Tipo", description: "Descrizione", example: (value) => `es. ${value}`, noParameters: "Questo endpoint non richiede parametri.", responses: "Risposte", codeLanguageAria: "Linguaggio dell'esempio di codice", copyCode: "Copia codice", responseExample: "Esempio di risposta", copyResponse: "Copia risposta", codeExampleTitle: "Esempio", selectTitle: "Seleziona un endpoint", selectDescription: "Seleziona un endpoint a sinistra per vedere contratto ed esempi di codice.", requestBodyFallback: "Corpo richiesta JSON.", parameterFallback: "Parametro OpenAPI.", responseFallback: "Risposta API.", contractFallback: (title) => `${title}. Contratto e parametri provengono dalla specifica OpenAPI attuale.` },
  webhooks: { title: "Destinazioni webhook", description: "Invia eventi firmati in tempo reale ai sistemi collegati.", search: "Cerca webhook", columns: { target: "Destinazione", events: "Eventi", lastDelivery: "Ultima consegna", successRate: "Tasso di successo", status: "Stato", actions: "Azioni" }, copyUrl: "Copia URL webhook", signature: (hint) => `Firma: ${hint}`, active: "Attivo", failing: "Errore", paused: "In pausa", noRate: "Nessun tasso", successfulRate: (rate) => `${rate} riuscite`, emptyTitle: "Nessun webhook corrispondente", emptyDescription: "Crea una destinazione o modifica la ricerca per vedere i webhook." },
  deadLetters: { title: "Consegne non riuscite", description: "Coda dead-letter per eventi webhook non riusciti definitivamente.", search: "Cerca consegne", refresh: "Aggiorna consegne", refreshing: "Aggiornamento consegne", columns: { targetEvent: "Destinazione ed evento", error: "Errore", attempt: "Tentativo", time: "Data e ora", details: "Dettagli" }, showDetails: "Mostra dettagli consegna", noMatchesTitle: "Nessuna consegna corrispondente", noMatchesDescription: "Modifica la ricerca per vedere altre consegne non riuscite.", emptyTitle: "Nessuna dead letter", emptyDescription: "Nessuna consegna definitivamente fallita richiede attenzione.", detailEyebrow: "Dettagli consegna", loadingDetails: "Caricamento dettagli", failed: "Non riuscita", event: "Evento", attempts: "Tentativi", attemptOf: (current, total) => `${current} di ${total}`, runtime: "Durata", httpStatus: "Stato HTTP", lastAttempt: "Ultimo tentativo", deliveryError: "Errore di consegna", history: "Cronologia tentativi", entries: (count) => `${count} voci`, runAttempt: (run, attempt) => `Esecuzione ${run}, tentativo ${attempt}`, responseRedacted: "Contenuto della risposta nascosto per motivi di sicurezza.", noAttemptHistory: "Non è disponibile un singolo record di tentativo per questa consegna storica.", safePayload: "Panoramica sicura del payload", payloadId: "ID payload", payloadType: "Tipo payload", dataFields: "Campi dati inclusi", close: "Chiudi", queueing: "Messa in coda", requeue: "Rimetti in coda", loadFailed: "Non è stato possibile caricare le consegne non riuscite.", detailLoadFailed: "Non è stato possibile caricare i dettagli della consegna.", requeueFailed: "Non è stato possibile rimettere in coda la consegna.", failureKinds: { http: "Errore HTTP", timeout: "Timeout", dns: "DNS", tls: "TLS", connection: "Connessione", configuration: "Configurazione", unknown: "Sconosciuto" }, responseSummaries: { http: (status) => `Il sistema di destinazione ha risposto con HTTP ${status}. Il contenuto della risposta è nascosto per motivi di sicurezza.`, timeout: "La connessione al sistema di destinazione ha superato il tempo limite.", dns: "La risoluzione DNS del sistema di destinazione non è riuscita.", tls: "La connessione TLS sicura al sistema di destinazione non è riuscita.", configuration: "La configurazione del webhook impedisce attualmente la consegna.", connection: "La connessione al sistema di destinazione non è riuscita.", unknown: "La consegna non è riuscita. I dettagli tecnici della risposta sono stati nascosti per motivi di sicurezza." }, outcomes: { delivered: "Consegnata", retrying: "Nuovo tentativo pianificato", failed: "Fallita definitivamente" } },
  requests: { title: "Registro richieste", description: "Le ultime chiamate API per diagnostica e audit.", search: "Percorso, stato o ID richiesta", columns: { time: "Data e ora", request: "Richiesta", status: "Stato", latency: "Latenza", apiKey: "Chiave API", requestId: "ID richiesta", response: "Risposta" }, copyRequestId: "Copia ID richiesta", emptyTitle: "Nessuna richiesta corrispondente", emptyDescription: "Nessuna chiamata API corrisponde alla ricerca attuale.", shown: (visible, total) => `${visible} di ${total} richieste`, errorRate: (rate) => `Tasso di errore ${rate}` },
  actionMessages: {
    ...en.actionMessages,
    "validation.invalidInput": () => "Controlla i dati inseriti.", "validation.nameTooShort": () => "Il nome deve contenere almeno due caratteri.", "validation.nameTooLong": () => "Il nome non può superare 160 caratteri.", "validation.apiScopesRequired": () => "Seleziona almeno uno scope.", "validation.apiScopesTooMany": () => "Sono stati selezionati troppi scope.", "validation.apiScopesDuplicate": () => "Gli scope non possono essere duplicati.", "validation.expirationDateInvalid": () => "La data di scadenza non è valida.", "validation.currentPasswordTooLong": () => "La password attuale è troppo lunga.", "validation.webhookUrlInvalid": () => "L'URL del webhook non è valido.", "validation.webhookHttpsRequired": () => "Le destinazioni webhook devono usare HTTPS.", "validation.webhookEventsRequired": () => "Seleziona almeno un evento.", "validation.webhookEventsTooMany": () => "Sono stati selezionati troppi eventi.", "validation.webhookEventsDuplicate": () => "Gli eventi non possono essere duplicati.",
    "apiKey.ownerScopeRequiresOwner": () => "Gli scope legati al proprietario possono essere creati solo da un proprietario.", "apiKey.expirationDateMustBeFuture": () => "La data di scadenza deve essere futura.", "apiKey.ownerVerificationInvalidPassword": () => "La password attuale non è corretta.", "apiKey.ownerVerificationRateLimited": () => "Troppi tentativi di conferma. Riprova più tardi.", "apiKey.ownerVerificationOwnerRequired": () => "Questa azione è disponibile solo per i proprietari.", "apiKey.ownerVerificationReauthenticationRequired": () => "Conferma nuovamente la tua identità.", "apiKey.created": () => "Chiave API creata.", "apiKey.createFailed": () => "Non è stato possibile creare la chiave API.", "apiKey.invalid": () => "La chiave API non è valida.", "apiKey.notFoundOrRevoked": () => "La chiave API non è stata trovata o è già stata revocata.", "apiKey.revoked": (values) => `Chiave API "${actionName(values)}" revocata.`, "apiKey.revokeFailed": () => "Non è stato possibile revocare la chiave API.",
    "webhook.created": () => "Webhook creato.", "webhook.createFailed": () => "Non è stato possibile creare il webhook.", "webhook.invalid": () => "Il webhook non è valido.", "webhook.notFound": () => "Il webhook non è stato trovato.", "webhook.activated": (values) => `Webhook "${actionName(values)}" attivato.`, "webhook.deactivated": (values) => `Webhook "${actionName(values)}" disattivato.`, "webhook.statusChangeFailed": () => "Non è stato possibile cambiare lo stato del webhook.", "webhook.secretRotated": (values) => `Segreto di firma per "${actionName(values)}" ruotato.`, "webhook.secretRotationFailed": () => "Non è stato possibile ruotare il segreto del webhook.", "webhook.deleted": (values) => `Webhook "${actionName(values)}" eliminato.`, "webhook.deleteFailed": () => "Non è stato possibile eliminare il webhook.",
    "webhookDelivery.failedListLoaded": () => "Consegne non riuscite aggiornate.", "webhookDelivery.failedListLoadFailed": () => "Non è stato possibile caricare le consegne non riuscite.", "webhookDelivery.invalid": () => "La consegna webhook non è valida.", "webhookDelivery.notFound": () => "La consegna webhook non è stata trovata.", "webhookDelivery.loaded": () => "Consegna webhook caricata.", "webhookDelivery.loadFailed": () => "Non è stato possibile caricare la consegna webhook.", "webhookDelivery.notReplayable": () => "Questa consegna non è più fallita e non può essere rimessa in coda.", "webhookDelivery.requeued": (values) => `Consegna a "${actionName(values)}" rimessa in coda.`, "webhookDelivery.replayFailed": () => "Non è stato possibile rimettere in coda la consegna webhook.",
  },
  scopes: { fullAccessLabel: "Accesso completo senza permessi proprietario", fullAccessDescription: "Accesso alle risorse standard attuali e future. Gli scope di sicurezza legati al proprietario devono essere assegnati esplicitamente.", readLabel: (resource) => `Leggi ${resource}`, writeLabel: (resource) => `Gestisci ${resource}`, readDescription: (resource) => `Accesso in lettura a ${resource}.`, writeDescription: (resource) => `Accesso in scrittura a ${resource}.`, resources: { organization: "organizzazione", authentication: "autenticazione", courses: "corsi", assessments: "valutazioni", modules: "moduli e lezioni", members: "membri", team_roles: "ruoli del team", custom_fields: "campi profilo", groups: "gruppi", bundles: "pacchetti", submissions: "consegne", feedback: "feedback", community: "community", events: "eventi", notifications: "notifiche", email: "centro email", search: "ricerca globale", hubs: "hub", agents: "agenti IA", analytics: "statistiche", commerce: "commercio", automations: "automazioni", webhooks: "webhook", api_keys: "chiavi API", audit: "registro audit", privacy: "privacy" }, groups: { platform: "Piattaforma", security: "Sicurezza", learning: "Contenuti didattici", access: "Accesso", coaching: "Coaching", community: "Community", experience: "Esperienza", communication: "Comunicazione", ai: "Intelligenza artificiale", analytics: "Analisi", commerce: "Commercio", integrations: "Integrazioni" } },
};

const es: ApiConsoleCopy = {
  ...en,
  page: { metadataTitle: "API y webhooks", eyebrow: "Plataforma para desarrolladores", title: "API y webhooks", description: "Gestiona accesos automáticos, integra sistemas externos y analiza las llamadas API de tu organización." },
  common: { closeDialog: "Cerrar diálogo", cancel: "Cancelar", working: "Procesando", done: "Listo", copy: "Copiar", copied: "Copiado", copyFailed: "No se ha copiado", retry: "Reintentar", readOnly: "Solo lectura", never: "Nunca", error: "Error", unknown: "Desconocido", noHttpStatus: "Sin estado HTTP", manage: (name) => `Gestionar ${name}` },
  tabs: { ariaLabel: "Secciones de la consola API", access: "Acceso", endpoints: "Endpoints", webhooks: "Webhooks", requests: "Registro de solicitudes" },
  header: { eyebrow: "Plataforma para desarrolladores", title: "Consola API", production: "Producción", sandbox: "Sandbox", development: "Desarrollo", copyBaseUrl: "Copiar URL base", documentation: "Documentación", apiKey: "Clave API", activeKeys: "Claves activas", endpoints: "Endpoints", healthyWebhooks: "Webhooks correctos", errorRate: "Tasa de errores" },
  secret: { apiKey: "Clave API", webhook: "Secreto del webhook", once: "Visible una sola vez", description: "Este valor no se guarda como texto sin cifrar y no podrá volver a mostrarse después de cerrar.", copy: (kind) => `Copiar ${kind}` },
  createKey: { title: "Crear clave API", eyebrow: "Acceso automático", name: "Nombre", namePlaceholder: "p. ej., sincronización CRM", expiration: "Fecha de caducidad", scopes: "Scopes", scopesHint: "Selecciona solo los permisos necesarios para esta integración.", otherCategory: "Otros", passwordLabel: "Contraseña actual", oidcDescription: "Esta acción del propietario requiere una confirmación actual del proveedor de identidad.", oidcButton: "Confirmar propietario mediante SSO", oidcError: "No se pudo iniciar el acceso corporativo.", submit: "Crear clave", submitting: "Creando" },
  createWebhook: { title: "Crear webhook", eyebrow: "Destino de eventos", name: "Nombre", namePlaceholder: "p. ej., sincronización de miembros", target: "Destino HTTPS", targetPlaceholder: "https://example.com/webhooks", events: "Eventos", eventsHint: "Selecciona los eventos que se enviarán a este destino.", submit: "Crear webhook", submitting: "Creando" },
  confirm: { eyebrow: "Confirmación" },
  keyActions: { revoke: "Revocar clave API", revokeDescription: (name) => `El acceso de "${name}" finalizará inmediatamente y de forma permanente.`, confirmRevoke: "Revocar" },
  webhookActions: { activate: "Activar webhook", deactivate: "Desactivar webhook", rotate: "Rotar secreto", delete: "Eliminar webhook", deleteDescription: (name) => `"${name}" y su historial de entregas se eliminarán permanentemente.`, rotatedTitle: "Nuevo secreto de webhook", rotatedEyebrow: "Secreto rotado", failed: "No se pudo completar la acción del webhook." },
  access: { title: "Claves API", description: "Controla el acceso por separado para cada aplicación y entorno.", search: "Buscar claves", filterAria: "Filtrar por scope", allScopes: "Todos los scopes", columns: { key: "Clave", scopes: "Scopes", usage: "Uso", created: "Creada", status: "Estado", action: "Acción" }, requests: (count) => `${count} solicitudes`, lastUsed: (date) => `Último uso ${date}`, validUntil: (date) => `Válida hasta ${date}`, unlimited: "Sin caducidad", active: "Activa", expired: "Caducada", revoked: "Revocada", emptyTitle: "No hay claves coincidentes", emptyDescription: "Ajusta la búsqueda o el filtro de scope para ver más claves API.", catalogTitle: "Catálogo de scopes", catalogDescription: "Los scopes siguen el principio de privilegio mínimo.", read: "Lectura", write: "Escritura", admin: "Admin", noScopesTitle: "Sin scopes", noScopesDescription: "Todavía no se han definido permisos para esta API." },
  endpoints: { search: "Buscar endpoint o ruta", filterAria: "Filtrar endpoints por scope", allScopes: "Todos los scopes", emptyTitle: "No hay endpoints", emptyDescription: "Ninguna ruta coincide con la búsqueda y el filtro actuales.", stable: "Estable", beta: "Beta", deprecated: "Obsoleto", copyPath: "Copiar ruta", requiredScopes: "Scopes necesarios", public: "Público", requestContract: "Contrato de solicitud", parameter: "Parámetro", location: "Ubicación", type: "Tipo", description: "Descripción", example: (value) => `p. ej., ${value}`, noParameters: "Este endpoint no espera parámetros.", responses: "Respuestas", codeLanguageAria: "Lenguaje del ejemplo de código", copyCode: "Copiar código", responseExample: "Ejemplo de respuesta", copyResponse: "Copiar respuesta", codeExampleTitle: "Ejemplo", selectTitle: "Selecciona un endpoint", selectDescription: "Selecciona un endpoint a la izquierda para ver su contrato y ejemplos de código.", requestBodyFallback: "Cuerpo de solicitud JSON.", parameterFallback: "Parámetro OpenAPI.", responseFallback: "Respuesta API.", contractFallback: (title) => `${title}. El contrato y los parámetros proceden de la especificación OpenAPI actual.` },
  webhooks: { title: "Destinos de webhook", description: "Envía eventos firmados en tiempo real a los sistemas conectados.", search: "Buscar webhooks", columns: { target: "Destino", events: "Eventos", lastDelivery: "Última entrega", successRate: "Tasa de éxito", status: "Estado", actions: "Acciones" }, copyUrl: "Copiar URL del webhook", signature: (hint) => `Firma: ${hint}`, active: "Activo", failing: "Con errores", paused: "En pausa", noRate: "Sin tasa", successfulRate: (rate) => `${rate} correctas`, emptyTitle: "No hay webhooks coincidentes", emptyDescription: "Crea un destino o ajusta la búsqueda para ver webhooks." },
  deadLetters: { title: "Entregas fallidas", description: "Cola de mensajes fallidos para eventos de webhook que han fallado definitivamente.", search: "Buscar entregas", refresh: "Actualizar entregas", refreshing: "Actualizando entregas", columns: { targetEvent: "Destino y evento", error: "Error", attempt: "Intento", time: "Fecha y hora", details: "Detalles" }, showDetails: "Mostrar detalles de la entrega", noMatchesTitle: "No hay entregas coincidentes", noMatchesDescription: "Ajusta la búsqueda para ver más entregas fallidas.", emptyTitle: "Sin mensajes fallidos", emptyDescription: "Ninguna entrega fallida definitivamente requiere atención.", detailEyebrow: "Detalles de la entrega", loadingDetails: "Cargando detalles", failed: "Fallida", event: "Evento", attempts: "Intentos", attemptOf: (current, total) => `${current} de ${total}`, runtime: "Duración", httpStatus: "Estado HTTP", lastAttempt: "Último intento", deliveryError: "Error de entrega", history: "Historial de intentos", entries: (count) => `${count} entradas`, runAttempt: (run, attempt) => `Ejecución ${run}, intento ${attempt}`, responseRedacted: "Contenido de la respuesta oculto por motivos de seguridad.", noAttemptHistory: "No existe un registro individual de intento para esta entrega histórica.", safePayload: "Resumen seguro de la carga útil", payloadId: "ID de carga útil", payloadType: "Tipo de carga útil", dataFields: "Campos de datos incluidos", close: "Cerrar", queueing: "Poniendo en cola", requeue: "Volver a poner en cola", loadFailed: "No se pudieron cargar las entregas fallidas.", detailLoadFailed: "No se pudieron cargar los detalles de la entrega.", requeueFailed: "No se pudo volver a poner en cola la entrega.", failureKinds: { http: "Error HTTP", timeout: "Tiempo agotado", dns: "DNS", tls: "TLS", connection: "Conexión", configuration: "Configuración", unknown: "Desconocido" }, responseSummaries: { http: (status) => `El sistema de destino respondió con HTTP ${status}. El contenido de la respuesta se oculta por motivos de seguridad.`, timeout: "Se agotó el tiempo de conexión con el sistema de destino.", dns: "La resolución DNS del sistema de destino ha fallado.", tls: "La conexión TLS segura con el sistema de destino ha fallado.", configuration: "La configuración del webhook impide actualmente la entrega.", connection: "La conexión con el sistema de destino ha fallado.", unknown: "La entrega ha fallado. Los detalles técnicos de la respuesta se ocultaron por motivos de seguridad." }, outcomes: { delivered: "Entregada", retrying: "Reintento programado", failed: "Fallida definitivamente" } },
  requests: { title: "Registro de solicitudes", description: "Las últimas llamadas API para diagnóstico y auditoría.", search: "Ruta, estado o ID de solicitud", columns: { time: "Fecha y hora", request: "Solicitud", status: "Estado", latency: "Latencia", apiKey: "Clave API", requestId: "ID de solicitud", response: "Respuesta" }, copyRequestId: "Copiar ID de solicitud", emptyTitle: "No hay solicitudes coincidentes", emptyDescription: "Ninguna llamada API coincide con la búsqueda actual.", shown: (visible, total) => `${visible} de ${total} solicitudes`, errorRate: (rate) => `Tasa de errores ${rate}` },
  actionMessages: {
    ...en.actionMessages,
    "validation.invalidInput": () => "Revisa los datos introducidos.", "validation.nameTooShort": () => "El nombre debe contener al menos dos caracteres.", "validation.nameTooLong": () => "El nombre no puede superar los 160 caracteres.", "validation.apiScopesRequired": () => "Selecciona al menos un scope.", "validation.apiScopesTooMany": () => "Se han seleccionado demasiados scopes.", "validation.apiScopesDuplicate": () => "Los scopes no pueden repetirse.", "validation.expirationDateInvalid": () => "La fecha de caducidad no es válida.", "validation.currentPasswordTooLong": () => "La contraseña actual es demasiado larga.", "validation.webhookUrlInvalid": () => "La URL del webhook no es válida.", "validation.webhookHttpsRequired": () => "Los destinos de webhook deben usar HTTPS.", "validation.webhookEventsRequired": () => "Selecciona al menos un evento.", "validation.webhookEventsTooMany": () => "Se han seleccionado demasiados eventos.", "validation.webhookEventsDuplicate": () => "Los eventos no pueden repetirse.",
    "apiKey.ownerScopeRequiresOwner": () => "Los scopes ligados al propietario solo puede crearlos un propietario.", "apiKey.expirationDateMustBeFuture": () => "La fecha de caducidad debe estar en el futuro.", "apiKey.ownerVerificationInvalidPassword": () => "La contraseña actual no es correcta.", "apiKey.ownerVerificationRateLimited": () => "Demasiados intentos de confirmación. Vuelve a intentarlo más tarde.", "apiKey.ownerVerificationOwnerRequired": () => "Esta acción solo está disponible para propietarios.", "apiKey.ownerVerificationReauthenticationRequired": () => "Confirma de nuevo tu identidad.", "apiKey.created": () => "Clave API creada.", "apiKey.createFailed": () => "No se pudo crear la clave API.", "apiKey.invalid": () => "La clave API no es válida.", "apiKey.notFoundOrRevoked": () => "La clave API no se encontró o ya ha sido revocada.", "apiKey.revoked": (values) => `Clave API "${actionName(values)}" revocada.`, "apiKey.revokeFailed": () => "No se pudo revocar la clave API.",
    "webhook.created": () => "Webhook creado.", "webhook.createFailed": () => "No se pudo crear el webhook.", "webhook.invalid": () => "El webhook no es válido.", "webhook.notFound": () => "No se encontró el webhook.", "webhook.activated": (values) => `Webhook "${actionName(values)}" activado.`, "webhook.deactivated": (values) => `Webhook "${actionName(values)}" desactivado.`, "webhook.statusChangeFailed": () => "No se pudo cambiar el estado del webhook.", "webhook.secretRotated": (values) => `Secreto de firma de "${actionName(values)}" rotado.`, "webhook.secretRotationFailed": () => "No se pudo rotar el secreto del webhook.", "webhook.deleted": (values) => `Webhook "${actionName(values)}" eliminado.`, "webhook.deleteFailed": () => "No se pudo eliminar el webhook.",
    "webhookDelivery.failedListLoaded": () => "Entregas fallidas actualizadas.", "webhookDelivery.failedListLoadFailed": () => "No se pudieron cargar las entregas fallidas.", "webhookDelivery.invalid": () => "La entrega del webhook no es válida.", "webhookDelivery.notFound": () => "No se encontró la entrega del webhook.", "webhookDelivery.loaded": () => "Entrega del webhook cargada.", "webhookDelivery.loadFailed": () => "No se pudo cargar la entrega del webhook.", "webhookDelivery.notReplayable": () => "Esta entrega ya no está fallida y no puede volver a ponerse en cola.", "webhookDelivery.requeued": (values) => `Entrega a "${actionName(values)}" puesta de nuevo en cola.`, "webhookDelivery.replayFailed": () => "No se pudo volver a poner en cola la entrega del webhook.",
  },
  scopes: { fullAccessLabel: "Acceso completo sin permisos de propietario", fullAccessDescription: "Acceso a los recursos estándar actuales y futuros. Los scopes de seguridad ligados al propietario deben concederse explícitamente.", readLabel: (resource) => `Leer ${resource}`, writeLabel: (resource) => `Gestionar ${resource}`, readDescription: (resource) => `Acceso de lectura a ${resource}.`, writeDescription: (resource) => `Acceso de escritura a ${resource}.`, resources: { organization: "organización", authentication: "autenticación", courses: "cursos", assessments: "evaluaciones", modules: "módulos y lecciones", members: "miembros", team_roles: "roles de equipo", custom_fields: "campos de perfil", groups: "grupos", bundles: "paquetes", submissions: "entregas", feedback: "comentarios", community: "comunidad", events: "eventos", notifications: "notificaciones", email: "centro de correo", search: "búsqueda global", hubs: "hubs", agents: "agentes de IA", analytics: "estadísticas", commerce: "comercio", automations: "automatizaciones", webhooks: "webhooks", api_keys: "claves API", audit: "registro de auditoría", privacy: "privacidad" }, groups: { platform: "Plataforma", security: "Seguridad", learning: "Contenido formativo", access: "Acceso", coaching: "Coaching", community: "Comunidad", experience: "Experiencia", communication: "Comunicación", ai: "Inteligencia artificial", analytics: "Análisis", commerce: "Comercio", integrations: "Integraciones" } },
};

const fr: ApiConsoleCopy = {
  ...en,
  page: { metadataTitle: "API et webhooks", eyebrow: "Plateforme développeurs", title: "API et webhooks", description: "Gérez les accès automatisés, intégrez des systèmes externes et analysez les appels API de votre organisation." },
  common: { closeDialog: "Fermer la boîte de dialogue", cancel: "Annuler", working: "Traitement en cours", done: "Terminé", copy: "Copier", copied: "Copié", copyFailed: "Non copié", retry: "Réessayer", readOnly: "Lecture seule", never: "Jamais", error: "Erreur", unknown: "Inconnu", noHttpStatus: "Aucun statut HTTP", manage: (name) => `Gérer ${name}` },
  tabs: { ariaLabel: "Sections de la console API", access: "Accès", endpoints: "Endpoints", webhooks: "Webhooks", requests: "Journal des requêtes" },
  header: { eyebrow: "Plateforme développeurs", title: "Console API", production: "Production", sandbox: "Bac à sable", development: "Développement", copyBaseUrl: "Copier l'URL de base", documentation: "Documentation", apiKey: "Clé API", activeKeys: "Clés actives", endpoints: "Endpoints", healthyWebhooks: "Webhooks opérationnels", errorRate: "Taux d'erreur" },
  secret: { apiKey: "Clé API", webhook: "Secret du webhook", once: "Visible une seule fois", description: "Cette valeur n'est pas stockée en clair et ne pourra plus être affichée après la fermeture.", copy: (kind) => `Copier ${kind}` },
  createKey: { title: "Créer une clé API", eyebrow: "Accès automatisé", name: "Nom", namePlaceholder: "p. ex. synchronisation CRM", expiration: "Date d'expiration", scopes: "Scopes", scopesHint: "Sélectionnez uniquement les autorisations nécessaires à cette intégration.", otherCategory: "Autres", passwordLabel: "Mot de passe actuel", oidcDescription: "Cette action du propriétaire nécessite une confirmation récente auprès du fournisseur d'identité.", oidcButton: "Confirmer le propriétaire via SSO", oidcError: "La connexion d'entreprise n'a pas pu être démarrée.", submit: "Créer la clé", submitting: "Création" },
  createWebhook: { title: "Créer un webhook", eyebrow: "Destination d'événement", name: "Nom", namePlaceholder: "p. ex. synchronisation des membres", target: "Destination HTTPS", targetPlaceholder: "https://example.com/webhooks", events: "Événements", eventsHint: "Sélectionnez les événements à envoyer vers cette destination.", submit: "Créer le webhook", submitting: "Création" },
  confirm: { eyebrow: "Confirmation" },
  keyActions: { revoke: "Révoquer la clé API", revokeDescription: (name) => `L'accès de « ${name} » sera immédiatement et définitivement interrompu.`, confirmRevoke: "Révoquer" },
  webhookActions: { activate: "Activer le webhook", deactivate: "Désactiver le webhook", rotate: "Renouveler le secret", delete: "Supprimer le webhook", deleteDescription: (name) => `« ${name} » et son historique de livraison seront définitivement supprimés.`, rotatedTitle: "Nouveau secret de webhook", rotatedEyebrow: "Secret renouvelé", failed: "L'action sur le webhook n'a pas pu être effectuée." },
  access: { title: "Clés API", description: "Contrôlez séparément l'accès pour chaque application et environnement.", search: "Rechercher des clés", filterAria: "Filtrer par scope", allScopes: "Tous les scopes", columns: { key: "Clé", scopes: "Scopes", usage: "Utilisation", created: "Créée", status: "Statut", action: "Action" }, requests: (count) => `${count} requêtes`, lastUsed: (date) => `Dernière utilisation ${date}`, validUntil: (date) => `Valide jusqu'au ${date}`, unlimited: "Sans expiration", active: "Active", expired: "Expirée", revoked: "Révoquée", emptyTitle: "Aucune clé correspondante", emptyDescription: "Modifiez la recherche ou le filtre de scope pour voir d'autres clés API.", catalogTitle: "Catalogue des scopes", catalogDescription: "Les scopes suivent le principe du moindre privilège.", read: "Lecture", write: "Écriture", admin: "Admin", noScopesTitle: "Aucun scope", noScopesDescription: "Aucune autorisation n'a encore été définie pour cette API." },
  endpoints: { search: "Rechercher un endpoint ou un chemin", filterAria: "Filtrer les endpoints par scope", allScopes: "Tous les scopes", emptyTitle: "Aucun endpoint", emptyDescription: "Aucune route ne correspond à la recherche et au filtre actuels.", stable: "Stable", beta: "Bêta", deprecated: "Obsolète", copyPath: "Copier le chemin", requiredScopes: "Scopes requis", public: "Public", requestContract: "Contrat de requête", parameter: "Paramètre", location: "Emplacement", type: "Type", description: "Description", example: (value) => `p. ex. ${value}`, noParameters: "Cet endpoint n'attend aucun paramètre.", responses: "Réponses", codeLanguageAria: "Langage de l'exemple de code", copyCode: "Copier le code", responseExample: "Exemple de réponse", copyResponse: "Copier la réponse", codeExampleTitle: "Exemple", selectTitle: "Sélectionner un endpoint", selectDescription: "Sélectionnez un endpoint à gauche pour voir son contrat et ses exemples de code.", requestBodyFallback: "Corps de requête JSON.", parameterFallback: "Paramètre OpenAPI.", responseFallback: "Réponse API.", contractFallback: (title) => `${title}. Le contrat et les paramètres proviennent de la spécification OpenAPI actuelle.` },
  webhooks: { title: "Destinations des webhooks", description: "Envoyez des événements signés en temps réel aux systèmes connectés.", search: "Rechercher des webhooks", columns: { target: "Destination", events: "Événements", lastDelivery: "Dernière livraison", successRate: "Taux de réussite", status: "Statut", actions: "Actions" }, copyUrl: "Copier l'URL du webhook", signature: (hint) => `Signature : ${hint}`, active: "Actif", failing: "En échec", paused: "En pause", noRate: "Aucun taux", successfulRate: (rate) => `${rate} réussies`, emptyTitle: "Aucun webhook correspondant", emptyDescription: "Créez une destination ou modifiez la recherche pour voir des webhooks." },
  deadLetters: { title: "Livraisons échouées", description: "File de lettres mortes pour les événements webhook définitivement échoués.", search: "Rechercher des livraisons", refresh: "Actualiser les livraisons", refreshing: "Actualisation des livraisons", columns: { targetEvent: "Destination et événement", error: "Erreur", attempt: "Tentative", time: "Date et heure", details: "Détails" }, showDetails: "Afficher les détails de la livraison", noMatchesTitle: "Aucune livraison correspondante", noMatchesDescription: "Modifiez la recherche pour voir d'autres livraisons échouées.", emptyTitle: "Aucune lettre morte", emptyDescription: "Aucune livraison définitivement échouée ne nécessite d'intervention.", detailEyebrow: "Détails de la livraison", loadingDetails: "Chargement des détails", failed: "Échouée", event: "Événement", attempts: "Tentatives", attemptOf: (current, total) => `${current} sur ${total}`, runtime: "Durée", httpStatus: "Statut HTTP", lastAttempt: "Dernière tentative", deliveryError: "Erreur de livraison", history: "Historique des tentatives", entries: (count) => `${count} entrées`, runAttempt: (run, attempt) => `Exécution ${run}, tentative ${attempt}`, responseRedacted: "Contenu de la réponse masqué pour des raisons de sécurité.", noAttemptHistory: "Aucun enregistrement de tentative individuel n'existe pour cette livraison historique.", safePayload: "Aperçu sécurisé de la charge utile", payloadId: "ID de charge utile", payloadType: "Type de charge utile", dataFields: "Champs de données inclus", close: "Fermer", queueing: "Mise en file", requeue: "Remettre en file", loadFailed: "Les livraisons échouées n'ont pas pu être chargées.", detailLoadFailed: "Les détails de la livraison n'ont pas pu être chargés.", requeueFailed: "La livraison n'a pas pu être remise en file.", failureKinds: { http: "Erreur HTTP", timeout: "Délai dépassé", dns: "DNS", tls: "TLS", connection: "Connexion", configuration: "Configuration", unknown: "Inconnu" }, responseSummaries: { http: (status) => `Le système cible a répondu avec le statut HTTP ${status}. Le contenu de la réponse est masqué pour des raisons de sécurité.`, timeout: "Le délai de connexion au système cible a été dépassé.", dns: "La résolution DNS du système cible a échoué.", tls: "La connexion TLS sécurisée au système cible a échoué.", configuration: "La configuration du webhook empêche actuellement la livraison.", connection: "La connexion au système cible a échoué.", unknown: "La livraison a échoué. Les détails techniques de la réponse ont été masqués pour des raisons de sécurité." }, outcomes: { delivered: "Livrée", retrying: "Nouvelle tentative planifiée", failed: "Échec définitif" } },
  requests: { title: "Journal des requêtes", description: "Les derniers appels API à des fins de diagnostic et d'audit.", search: "Chemin, statut ou ID de requête", columns: { time: "Date et heure", request: "Requête", status: "Statut", latency: "Latence", apiKey: "Clé API", requestId: "ID de requête", response: "Réponse" }, copyRequestId: "Copier l'ID de requête", emptyTitle: "Aucune requête correspondante", emptyDescription: "Aucun appel API ne correspond à la recherche actuelle.", shown: (visible, total) => `${visible} sur ${total} requêtes`, errorRate: (rate) => `Taux d'erreur ${rate}` },
  actionMessages: {
    ...en.actionMessages,
    "validation.invalidInput": () => "Vérifiez les informations saisies.", "validation.nameTooShort": () => "Le nom doit contenir au moins deux caractères.", "validation.nameTooLong": () => "Le nom ne doit pas dépasser 160 caractères.", "validation.apiScopesRequired": () => "Sélectionnez au moins un scope.", "validation.apiScopesTooMany": () => "Trop de scopes ont été sélectionnés.", "validation.apiScopesDuplicate": () => "Les scopes ne peuvent pas être dupliqués.", "validation.expirationDateInvalid": () => "La date d'expiration n'est pas valide.", "validation.currentPasswordTooLong": () => "Le mot de passe actuel est trop long.", "validation.webhookUrlInvalid": () => "L'URL du webhook n'est pas valide.", "validation.webhookHttpsRequired": () => "Les destinations des webhooks doivent utiliser HTTPS.", "validation.webhookEventsRequired": () => "Sélectionnez au moins un événement.", "validation.webhookEventsTooMany": () => "Trop d'événements ont été sélectionnés.", "validation.webhookEventsDuplicate": () => "Les événements ne peuvent pas être dupliqués.",
    "apiKey.ownerScopeRequiresOwner": () => "Les scopes liés au propriétaire ne peuvent être créés que par un propriétaire.", "apiKey.expirationDateMustBeFuture": () => "La date d'expiration doit être future.", "apiKey.ownerVerificationInvalidPassword": () => "Le mot de passe actuel est incorrect.", "apiKey.ownerVerificationRateLimited": () => "Trop de tentatives de confirmation. Réessayez plus tard.", "apiKey.ownerVerificationOwnerRequired": () => "Cette action est réservée aux propriétaires.", "apiKey.ownerVerificationReauthenticationRequired": () => "Confirmez de nouveau votre identité.", "apiKey.created": () => "Clé API créée.", "apiKey.createFailed": () => "La clé API n'a pas pu être créée.", "apiKey.invalid": () => "La clé API n'est pas valide.", "apiKey.notFoundOrRevoked": () => "La clé API est introuvable ou a déjà été révoquée.", "apiKey.revoked": (values) => `Clé API « ${actionName(values)} » révoquée.`, "apiKey.revokeFailed": () => "La clé API n'a pas pu être révoquée.",
    "webhook.created": () => "Webhook créé.", "webhook.createFailed": () => "Le webhook n'a pas pu être créé.", "webhook.invalid": () => "Le webhook n'est pas valide.", "webhook.notFound": () => "Le webhook est introuvable.", "webhook.activated": (values) => `Webhook « ${actionName(values)} » activé.`, "webhook.deactivated": (values) => `Webhook « ${actionName(values)} » désactivé.`, "webhook.statusChangeFailed": () => "Le statut du webhook n'a pas pu être modifié.", "webhook.secretRotated": (values) => `Secret de signature de « ${actionName(values)} » renouvelé.`, "webhook.secretRotationFailed": () => "Le secret du webhook n'a pas pu être renouvelé.", "webhook.deleted": (values) => `Webhook « ${actionName(values)} » supprimé.`, "webhook.deleteFailed": () => "Le webhook n'a pas pu être supprimé.",
    "webhookDelivery.failedListLoaded": () => "Livraisons échouées actualisées.", "webhookDelivery.failedListLoadFailed": () => "Les livraisons échouées n'ont pas pu être chargées.", "webhookDelivery.invalid": () => "La livraison du webhook n'est pas valide.", "webhookDelivery.notFound": () => "La livraison du webhook est introuvable.", "webhookDelivery.loaded": () => "Livraison du webhook chargée.", "webhookDelivery.loadFailed": () => "La livraison du webhook n'a pas pu être chargée.", "webhookDelivery.notReplayable": () => "Cette livraison n'est plus en échec et ne peut pas être remise en file.", "webhookDelivery.requeued": (values) => `Livraison vers « ${actionName(values)} » remise en file.`, "webhookDelivery.replayFailed": () => "La livraison du webhook n'a pas pu être remise en file.",
  },
  scopes: { fullAccessLabel: "Accès complet sans autorisations du propriétaire", fullAccessDescription: "Accès aux ressources standard actuelles et futures. Les scopes de sécurité liés au propriétaire doivent toujours être accordés explicitement.", readLabel: (resource) => `Lire ${resource}`, writeLabel: (resource) => `Gérer ${resource}`, readDescription: (resource) => `Accès en lecture à ${resource}.`, writeDescription: (resource) => `Accès en écriture à ${resource}.`, resources: { organization: "l'organisation", authentication: "l'authentification", courses: "les cours", assessments: "les évaluations", modules: "les modules et leçons", members: "les membres", team_roles: "les rôles d'équipe", custom_fields: "les champs de profil", groups: "les groupes", bundles: "les packs", submissions: "les travaux", feedback: "les avis", community: "la communauté", events: "les événements", notifications: "les notifications", email: "le centre e-mail", search: "la recherche globale", hubs: "les hubs", agents: "les agents IA", analytics: "les statistiques", commerce: "le commerce", automations: "les automatisations", webhooks: "les webhooks", api_keys: "les clés API", audit: "le journal d'audit", privacy: "la confidentialité" }, groups: { platform: "Plateforme", security: "Sécurité", learning: "Contenu pédagogique", access: "Accès", coaching: "Coaching", community: "Communauté", experience: "Expérience", communication: "Communication", ai: "Intelligence artificielle", analytics: "Analyse", commerce: "Commerce", integrations: "Intégrations" } },
};

const catalogs = { de, en, it, es, fr } satisfies Record<
  AppLocale,
  ApiConsoleCopy
>;

export function getApiConsoleCopy(locale: AppLocale): ApiConsoleCopy {
  return catalogs[locale];
}

export function formatApiConsoleDateTime(
  value: string | null | undefined,
  locale: AppLocale,
  emptyLabel = getApiConsoleCopy(locale).common.never,
) {
  if (!value) return emptyLabel;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(intlLocale(locale), {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: PLATFORM_TIME_ZONE,
  }).format(date);
}

export function formatApiConsoleNumber(value: number, locale: AppLocale) {
  return new Intl.NumberFormat(intlLocale(locale)).format(value);
}

export function formatApiConsolePercent(value: number, locale: AppLocale) {
  return new Intl.NumberFormat(intlLocale(locale), {
    style: "percent",
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value / 100);
}

export function formatApiConsoleBytes(
  value: number | undefined,
  locale: AppLocale,
) {
  if (value === undefined) return "-";
  const formatter = new Intl.NumberFormat(intlLocale(locale), {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  });
  if (value < 1024) return `${formatter.format(value)} B`;
  if (value < 1024 * 1024) return `${formatter.format(value / 1024)} KB`;
  return `${formatter.format(value / (1024 * 1024))} MB`;
}

export function getApiScopePresentation(
  locale: AppLocale,
  scope: ApiScope,
) {
  const copy = getApiConsoleCopy(locale).scopes;
  if (scope === "*") {
    return {
      label: copy.fullAccessLabel,
      category: copy.groups.security,
      description: copy.fullAccessDescription,
      access: "admin" as const,
    };
  }
  const [base, access] = scope.split(":") as [ApiScopeBase, "read" | "write"];
  const resource = copy.resources[base];
  return {
    label:
      access === "write" ? copy.writeLabel(resource) : copy.readLabel(resource),
    category: copy.groups[scopeGroupByBase[base]],
    description:
      access === "write"
        ? copy.writeDescription(resource)
        : copy.readDescription(resource),
    access,
  };
}

export function getApiEndpointGroupLabel(
  locale: AppLocale,
  scopeBase: string | undefined,
  fallback: string,
) {
  if (!scopeBase || !(scopeBase in scopeGroupByBase)) return fallback;
  return getApiConsoleCopy(locale).scopes.resources[scopeBase as ApiScopeBase];
}

export function resolveApiAdminActionMessage(
  locale: AppLocale,
  message: ApiAdminActionMessage,
) {
  return getApiConsoleCopy(locale).actionMessages[message.key](message.values);
}

export const API_CONSOLE_SCOPE_GROUPS: Readonly<
  Record<ApiScopeBase, ApiScopeGroup>
> = scopeGroupByBase;
