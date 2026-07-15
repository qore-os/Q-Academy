import { z } from "zod";

export const TEAM_PERMISSION_KEYS = [
  "members.view",
  "members.manage",
  "courses.view",
  "courses.manage",
  "community.view",
  "community.manage",
  "events.view",
  "events.manage",
  "analytics.view",
  "settings.view",
  "settings.manage",
  "integrations.view",
  "integrations.manage",
  "api.view",
  "api.manage",
  "ai.view",
  "ai.manage",
] as const;

export type TeamPermissionKey = (typeof TEAM_PERMISSION_KEYS)[number];
export type TeamBaseRole = "owner" | "admin" | "trainer" | "member";

export const TEAM_PERMISSION_DETAILS: ReadonlyArray<{
  key: TeamPermissionKey;
  group: string;
  label: string;
  description: string;
}> = [
  { key: "members.view", group: "Mitglieder", label: "Ansehen", description: "Mitglieder, Gruppen, Bundles und Zertifikate anzeigen." },
  { key: "members.manage", group: "Mitglieder", label: "Verwalten", description: "Mitglieder einladen, importieren und ihren Status verwalten." },
  { key: "courses.view", group: "Kurse", label: "Ansehen", description: "Kurse und zugewiesene Kursinhalte anzeigen." },
  { key: "courses.manage", group: "Kurse", label: "Verwalten", description: "Kurse erstellen und im Rahmen der Kursfreigaben bearbeiten." },
  { key: "community.view", group: "Community", label: "Ansehen", description: "Community-Verwaltung und Moderationsstatus anzeigen." },
  { key: "community.manage", group: "Community", label: "Verwalten", description: "Bereiche, Regeln und Moderationsentscheidungen verwalten." },
  { key: "events.view", group: "Events", label: "Ansehen", description: "Events und Teilnehmerlisten anzeigen." },
  { key: "events.manage", group: "Events", label: "Verwalten", description: "Events, Zielgruppen und Teilnahmen verwalten." },
  { key: "analytics.view", group: "Analytics", label: "Ansehen", description: "Lernfortschritt und aggregierte Auswertungen anzeigen." },
  { key: "settings.view", group: "Einstellungen", label: "Ansehen", description: "Mandantenkonfiguration und Profilstrukturen anzeigen." },
  { key: "settings.manage", group: "Einstellungen", label: "Verwalten", description: "Delegierbare Mandanten- und Profileinstellungen bearbeiten." },
  { key: "integrations.view", group: "Integrationen", label: "Ansehen", description: "Provider, Produkte, Automationen und Supportkonfiguration anzeigen." },
  { key: "integrations.manage", group: "Integrationen", label: "Verwalten", description: "Provider, Produktzuordnungen und Automationen bearbeiten." },
  { key: "api.view", group: "Integrationen", label: "API ansehen", description: "API-Schluessel, Webhooks und Requesthistorie anzeigen." },
  { key: "api.manage", group: "Integrationen", label: "API verwalten", description: "Delegierbare API-Schluessel und Webhooks verwalten." },
  { key: "ai.view", group: "KI", label: "Ansehen", description: "KI-Agenten, Nutzung und Freigaben anzeigen." },
  { key: "ai.manage", group: "KI", label: "Verwalten", description: "KI-Agenten konfigurieren, testen und veroeffentlichen." },
] as const;

const permissionSet = new Set<string>(TEAM_PERMISSION_KEYS);

const ADMIN_DEFAULT_PERMISSIONS = TEAM_PERMISSION_KEYS.filter(
  (permission) => !permission.startsWith("integrations."),
);

const TRAINER_DEFAULT_PERMISSIONS = [
  "members.view",
  "courses.view",
  "courses.manage",
  "events.view",
  "events.manage",
  "analytics.view",
] as const satisfies readonly TeamPermissionKey[];

export const teamPermissionKeySchema = z.enum(TEAM_PERMISSION_KEYS);

export const teamRoleCreateSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    description: z.string().trim().max(500).nullable().default(null),
    color: z.string().regex(/^#[0-9a-f]{6}$/i).default("#2b9188"),
    permissions: z
      .array(teamPermissionKeySchema)
      .max(TEAM_PERMISSION_KEYS.length)
      .refine(
        (permissions) => new Set(permissions).size === permissions.length,
        "Berechtigungen duerfen nicht doppelt vorkommen.",
      ),
  })
  .strict();

export const teamRoleUpdateSchema = teamRoleCreateSchema
  .partial()
  .extend({
    active: z.boolean().optional(),
    revision: z.number().int().positive(),
  })
  .refine(
    (input) => Object.keys(input).some((key) => key !== "revision"),
    "Mindestens ein Rollenfeld muss geaendert werden.",
  );

export const teamRoleAssignmentSchema = z
  .object({ userId: z.string().uuid() })
  .strict();

export function isTeamPermissionKey(value: unknown): value is TeamPermissionKey {
  return typeof value === "string" && permissionSet.has(value);
}

export function defaultTeamPermissions(role: TeamBaseRole): TeamPermissionKey[] {
  if (role === "owner") return [...TEAM_PERMISSION_KEYS];
  if (role === "admin") return [...ADMIN_DEFAULT_PERMISSIONS];
  if (role === "trainer") return [...TRAINER_DEFAULT_PERMISSIONS];
  return [];
}

export function resolveTeamPermissions(input: Readonly<{
  baseRole: TeamBaseRole;
  assignmentExists: boolean;
  customRoleActive?: boolean | null;
  customPermissions?: readonly unknown[] | null;
}>): TeamPermissionKey[] {
  if (input.baseRole === "owner") return [...TEAM_PERMISSION_KEYS];
  if (input.baseRole === "member") return [];
  if (!input.assignmentExists) return defaultTeamPermissions(input.baseRole);
  if (input.customRoleActive !== true || !Array.isArray(input.customPermissions)) {
    return [];
  }
  if (
    input.customPermissions.some((permission) => !isTeamPermissionKey(permission))
  ) {
    return [];
  }
  const maximum = new Set<TeamPermissionKey>(
    input.baseRole === "admin"
      ? TEAM_PERMISSION_KEYS
      : TRAINER_DEFAULT_PERMISSIONS,
  );
  return TEAM_PERMISSION_KEYS.filter(
    (permission) =>
      maximum.has(permission) && input.customPermissions?.includes(permission),
  );
}

export function teamPermissionAllows(
  permissions: readonly TeamPermissionKey[],
  required: TeamPermissionKey,
) {
  if (permissions.includes(required)) return true;
  if (!required.endsWith(".view")) return false;
  const managePermission = required.replace(/\.view$/, ".manage");
  return isTeamPermissionKey(managePermission) && permissions.includes(managePermission);
}
