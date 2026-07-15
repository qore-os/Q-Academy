export const API_SCOPES = [
  "organization:read",
  "organization:write",
  "authentication:read",
  "authentication:write",
  "courses:read",
  "courses:write",
  "assessments:read",
  "assessments:write",
  "modules:read",
  "modules:write",
  "members:read",
  "members:write",
  "team_roles:read",
  "team_roles:write",
  "custom_fields:read",
  "custom_fields:write",
  "groups:read",
  "groups:write",
  "bundles:read",
  "bundles:write",
  "submissions:read",
  "submissions:write",
  "feedback:read",
  "feedback:write",
  "community:read",
  "community:write",
  "events:read",
  "events:write",
  "notifications:read",
  "notifications:write",
  "email:read",
  "email:write",
  "search:read",
  "hubs:read",
  "hubs:write",
  "agents:read",
  "agents:write",
  "analytics:read",
  "commerce:read",
  "commerce:write",
  "automations:write",
  "webhooks:read",
  "webhooks:write",
  "api_keys:read",
  "api_keys:write",
  "audit:read",
  "privacy:read",
  "privacy:write",
] as const;

export type ApiScope = (typeof API_SCOPES)[number] | "*";

export const PRIVACY_API_SCOPES = [
  "privacy:read",
  "privacy:write",
] as const satisfies readonly Exclude<ApiScope, "*">[];

export type PrivacyApiScope = (typeof PRIVACY_API_SCOPES)[number];

export function isPrivacyApiScope(scope: string): scope is PrivacyApiScope {
  return PRIVACY_API_SCOPES.some((privacyScope) => privacyScope === scope);
}

export const AUTHENTICATION_API_SCOPES = [
  "authentication:read",
  "authentication:write",
] as const satisfies readonly Exclude<ApiScope, "*">[];

export type AuthenticationApiScope =
  (typeof AUTHENTICATION_API_SCOPES)[number];

export function isAuthenticationApiScope(
  scope: string,
): scope is AuthenticationApiScope {
  return AUTHENTICATION_API_SCOPES.some(
    (authenticationScope) => authenticationScope === scope,
  );
}

export const OWNER_BOUND_API_SCOPES = [
  ...PRIVACY_API_SCOPES,
  ...AUTHENTICATION_API_SCOPES,
  "commerce:read",
  "commerce:write",
  "team_roles:read",
  "team_roles:write",
] as const;

export function isOwnerBoundApiScope(
  scope: string,
): scope is (typeof OWNER_BOUND_API_SCOPES)[number] {
  return OWNER_BOUND_API_SCOPES.some((ownerScope) => ownerScope === scope);
}

export const DELEGABLE_API_SCOPES = API_SCOPES.filter(
  (scope) => !isOwnerBoundApiScope(scope),
);

export function apiScopeIsGranted(
  grantedScopes: readonly string[],
  requiredScope: ApiScope,
) {
  if (grantedScopes.includes(requiredScope)) return true;
  return requiredScope !== "*" &&
    !isOwnerBoundApiScope(requiredScope) &&
    grantedScopes.includes("*");
}

export function missingApiScopes(
  grantedScopes: readonly string[],
  requiredScopes: readonly ApiScope[],
) {
  return requiredScopes.filter(
    (scope) => !apiScopeIsGranted(grantedScopes, scope),
  );
}

export function isEligibleOwnerBoundApiKeyOwner(
  keyOrganizationId: string,
  owner: Readonly<{
    organizationId: string | null;
    role: string | null;
    status: string | null;
  }>,
) {
  return owner.organizationId === keyOrganizationId &&
    owner.role === "owner" &&
    owner.status === "active";
}

export const isEligiblePrivacyApiKeyOwner =
  isEligibleOwnerBoundApiKeyOwner;

export const SCOPE_DETAILS: Record<
  Exclude<ApiScope, "*">,
  { label: string; group: string; description: string }
> = {
  "organization:read": {
    label: "Organisation lesen",
    group: "Plattform",
    description: "Mandantenprofil und Plattformkonfiguration lesen.",
  },
  "organization:write": {
    label: "Organisation schreiben",
    group: "Plattform",
    description:
      "Mandantenprofil, Branding und Plattformkonfiguration verwalten.",
  },
  "authentication:read": {
    label: "Authentifizierung lesen",
    group: "Sicherheit",
    description:
      "Maskierte Unternehmens-Login-Konfiguration und Login-Policy lesen.",
  },
  "authentication:write": {
    label: "Authentifizierung verwalten",
    group: "Sicherheit",
    description:
      "Unternehmens-Login und Login-Policy mit Owner-Bindung verwalten.",
  },
  "courses:read": {
    label: "Kurse lesen",
    group: "Lerninhalte",
    description: "Kurse, Kategorien und Kursstruktur lesen.",
  },
  "courses:write": {
    label: "Kurse schreiben",
    group: "Lerninhalte",
    description: "Kurse erstellen, aendern und archivieren.",
  },
  "assessments:read": {
    label: "Pruefungen lesen",
    group: "Lerninhalte",
    description: "Pruefungsversuche, Ergebnisse und Freigabestatus lesen.",
  },
  "assessments:write": {
    label: "Pruefungen bearbeiten",
    group: "Lerninhalte",
    description: "Pruefungsversuche starten, speichern und finalisieren.",
  },
  "modules:read": {
    label: "Module lesen",
    group: "Lerninhalte",
    description: "Wiederverwendbare Module, Lektionen und Bloecke lesen.",
  },
  "modules:write": {
    label: "Module schreiben",
    group: "Lerninhalte",
    description: "Module, Lektionen und Bloecke verwalten.",
  },
  "members:read": {
    label: "Mitglieder lesen",
    group: "Zugriff",
    description: "Mitglieder, Fortschritt und Einschreibungen lesen.",
  },
  "members:write": {
    label: "Mitglieder schreiben",
    group: "Zugriff",
    description: "Mitglieder und Einschreibungen verwalten.",
  },
  "team_roles:read": {
    label: "Team-Rollen lesen",
    group: "Sicherheit",
    description: "Custom-Rollen, Rechte und Zuweisungen des Mandanten lesen.",
  },
  "team_roles:write": {
    label: "Team-Rollen verwalten",
    group: "Sicherheit",
    description: "Custom-Rollen und Staff-Zuweisungen owner-gebunden verwalten.",
  },
  "custom_fields:read": {
    label: "Profilfelder lesen",
    group: "Zugriff",
    description: "Eigene Profilfelder und Mitgliedswerte lesen.",
  },
  "custom_fields:write": {
    label: "Profilfelder schreiben",
    group: "Zugriff",
    description: "Eigene Profilfelder und Mitgliedswerte verwalten.",
  },
  "groups:read": {
    label: "Gruppen lesen",
    group: "Zugriff",
    description: "Gruppen und Mitgliedschaften lesen.",
  },
  "groups:write": {
    label: "Gruppen schreiben",
    group: "Zugriff",
    description: "Gruppen und Mitgliedschaften verwalten.",
  },
  "bundles:read": {
    label: "Bundles lesen",
    group: "Zugriff",
    description: "Kurs-Bundles und Zuweisungen lesen.",
  },
  "bundles:write": {
    label: "Bundles schreiben",
    group: "Zugriff",
    description: "Kurs-Bundles verwalten.",
  },
  "submissions:read": {
    label: "Abgaben lesen",
    group: "Coaching",
    description: "Abgaben und Trainer-Feedback lesen.",
  },
  "submissions:write": {
    label: "Abgaben bewerten",
    group: "Coaching",
    description: "Abgaben bewerten und Feedback speichern.",
  },
  "feedback:read": {
    label: "Feedback lesen",
    group: "Coaching",
    description: "Kurs- und Plattformfeedback auswerten.",
  },
  "feedback:write": {
    label: "Feedback verwalten",
    group: "Coaching",
    description: "Feedback erfassen, pruefen und archivieren.",
  },
  "community:read": {
    label: "Community lesen",
    group: "Community",
    description: "Bereiche, Beitraege und Kommentare lesen.",
  },
  "community:write": {
    label: "Community schreiben",
    group: "Community",
    description: "Beitraege, Kommentare und Reaktionen verwalten.",
  },
  "events:read": {
    label: "Events lesen",
    group: "Erlebnis",
    description: "Events und Teilnahmen lesen.",
  },
  "events:write": {
    label: "Events schreiben",
    group: "Erlebnis",
    description: "Events und Teilnahmen verwalten.",
  },
  "notifications:read": {
    label: "Benachrichtigungen lesen",
    group: "Erlebnis",
    description: "Benachrichtigungen von Mitgliedern lesen.",
  },
  "notifications:write": {
    label: "Benachrichtigungen schreiben",
    group: "Erlebnis",
    description: "Benachrichtigungen als gelesen markieren oder loeschen.",
  },
  "email:read": {
    label: "E-Mail-Center lesen",
    group: "Kommunikation",
    description:
      "Maskierte Versandhistorie und streng redigierte Versanddetails lesen.",
  },
  "email:write": {
    label: "E-Mail-Center verwalten",
    group: "Kommunikation",
    description:
      "Vorlagen, sichere Testsendungen und fehlgeschlagene Zustellungen verwalten.",
  },
  "search:read": {
    label: "Globale Suche",
    group: "Plattform",
    description:
      "Mandanteninhalte und Mitglieder ressourcenuebergreifend durchsuchen.",
  },
  "hubs:read": {
    label: "Hubs lesen",
    group: "Erlebnis",
    description: "Hubs und Widget-Layouts lesen.",
  },
  "hubs:write": {
    label: "Hubs schreiben",
    group: "Erlebnis",
    description: "Hubs und Widget-Layouts verwalten.",
  },
  "agents:read": {
    label: "KI-Agenten lesen",
    group: "KI",
    description: "Agentenkonfiguration und Nutzung lesen.",
  },
  "agents:write": {
    label: "KI-Agenten schreiben",
    group: "KI",
    description: "Agentenkonfiguration verwalten.",
  },
  "analytics:read": {
    label: "Analytics lesen",
    group: "Auswertung",
    description: "Aggregierte Lern- und Aktivitaetsdaten lesen.",
  },
  "commerce:read": {
    label: "Verkauf lesen",
    group: "Integrationen",
    description: "Produkte, Bestellungen, Abonnements und Zugriffsrechte lesen.",
  },
  "commerce:write": {
    label: "Verkauf verwalten",
    group: "Integrationen",
    description: "Provider, Produktzuordnungen und Verkaufszugriffe verwalten.",
  },
  "automations:write": {
    label: "Automationen ausfuehren",
    group: "Integrationen",
    description: "Eingeschraenkte Zapier-/Make-Aktionen fuer Mitglieder und Zugriffe ausfuehren.",
  },
  "webhooks:read": {
    label: "Webhooks lesen",
    group: "Integrationen",
    description: "Abonnements und Auslieferungen lesen.",
  },
  "webhooks:write": {
    label: "Webhooks schreiben",
    group: "Integrationen",
    description: "Abonnements erstellen und verwalten.",
  },
  "api_keys:read": {
    label: "API-Schluessel lesen",
    group: "Integrationen",
    description: "Metadaten vorhandener API-Schluessel lesen.",
  },
  "api_keys:write": {
    label: "API-Schluessel schreiben",
    group: "Integrationen",
    description: "API-Schluessel erstellen und widerrufen.",
  },
  "audit:read": {
    label: "Audit-Log lesen",
    group: "Sicherheit",
    description: "API-Zugriffe und Mutationen nachvollziehen.",
  },
  "privacy:read": {
    label: "Datenschutzfaelle lesen",
    group: "Sicherheit",
    description: "DSAR-Faelle, Fristen, Status und Ereignisse lesen.",
  },
  "privacy:write": {
    label: "Datenschutzfaelle anlegen",
    group: "Sicherheit",
    description:
      "Neue DSAR-Faelle einreichen. Freigabe und Export bleiben dem Owner mit Passwortbestaetigung vorbehalten.",
  },
};

export const WEBHOOK_EVENTS = [
  "course.created",
  "course.updated",
  "course.published",
  "member.created",
  "member.updated",
  "enrollment.created",
  "lesson.completed",
  "submission.created",
  "submission.reviewed",
  "feedback.created",
  "feedback.reviewed",
  "feedback.replied",
  "lesson.availability.subscribed",
  "lesson.availability.unsubscribed",
  "lesson.available",
  "community.post.created",
  "community.comment.created",
  "event.created",
  "event.rescheduled",
  "event.cancelled",
  "event.attendance.updated",
  "hub.updated",
  "agent.updated",
  "agent.action.requested",
  "agent.action.approved",
  "agent.action.rejected",
  "agent.action.cancelled",
  "agent.action.expired",
  "announcement.created",
  "announcement.updated",
  "commerce.order.created",
  "commerce.subscription.activated",
  "commerce.subscription.payment_failed",
  "commerce.subscription.cancelled",
  "commerce.subscription.expired",
  "commerce.entitlement.granted",
  "commerce.entitlement.revoked",
  "automation.member.upserted",
  "automation.n8n.triggered",
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];
