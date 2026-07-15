import type { TeamRoleMessageCode } from "@/lib/admin/team-role-actions";
import type { AppLocale } from "@/lib/i18n/model";
import type { TeamPermissionKey } from "@/lib/team-permission-policy";

type PermissionGroup =
  | "members"
  | "courses"
  | "community"
  | "events"
  | "analytics"
  | "settings"
  | "integrations"
  | "ai";

type TeamRoleCopy = {
  page: {
    metadataTitle: string;
    eyebrow: string;
    title: string;
    description: string;
  };
  manager: {
    createTitle: string;
    createDescription: string;
    name: string;
    description: string;
    color: string;
    create: string;
    assignmentsAndRevision: (assignments: number, revision: number) => string;
    active: string;
    save: string;
    removeAssignmentsFirst: string;
    deleteRole: string;
    delete: string;
    administrator: string;
    trainer: string;
    selectRole: string;
    assignRole: string;
    removeRole: string;
    restoreDefaults: string;
    existing: string;
    noRoles: string;
    assignments: string;
    assignmentDescription: string;
    noStaff: string;
  };
  permissions: {
    groups: Record<PermissionGroup, string>;
    view: string;
    manage: string;
    apiView: string;
    apiManage: string;
    descriptions: Record<TeamPermissionKey, string>;
  };
  messages: Record<TeamRoleMessageCode, string>;
};

const copy: Record<AppLocale, TeamRoleCopy> = {
  de: {
    page: { metadataTitle: "Rollen & Rechte", eyebrow: "Zugriffssteuerung", title: "Rollen & Rechte", description: "Definiere mandantenspezifische Team-Rollen und weise sie aktiven Administratoren oder Trainern zu." },
    manager: { createTitle: "Neue Team-Rolle", createDescription: "Berechtigungen werden serverseitig bei jeder Anfrage ausgewertet.", name: "Name", description: "Beschreibung", color: "Farbe", create: "Rolle erstellen", assignmentsAndRevision: (assignments, revision) => `${assignments} Zuweisungen | Revision ${revision}`, active: "Aktiv", save: "Speichern", removeAssignmentsFirst: "Zuweisungen zuerst entfernen", deleteRole: "Rolle loeschen", delete: "Loeschen", administrator: "Administrator", trainer: "Trainer", selectRole: "Custom-Rolle waehlen", assignRole: "Rolle zuweisen", removeRole: "Custom-Rolle entfernen", restoreDefaults: "Standardrechte wiederherstellen", existing: "Vorhandene Rollen", noRoles: "Noch keine Custom-Rolle vorhanden.", assignments: "Zuweisungen", assignmentDescription: "Owner bleiben unveraenderlich. Trainerrechte werden auf ihre Basisrolle begrenzt.", noStaff: "Keine aktiven Admin- oder Trainerkonten vorhanden." },
    permissions: {
      groups: { members: "Mitglieder", courses: "Kurse", community: "Community", events: "Events", analytics: "Analytics", settings: "Einstellungen", integrations: "Integrationen", ai: "KI" },
      view: "Ansehen", manage: "Verwalten", apiView: "API ansehen", apiManage: "API verwalten",
      descriptions: {
        "members.view": "Mitglieder, Gruppen, Bundles und Zertifikate anzeigen.", "members.manage": "Mitglieder einladen, importieren und ihren Status verwalten.",
        "courses.view": "Kurse und zugewiesene Kursinhalte anzeigen.", "courses.manage": "Kurse erstellen und im Rahmen der Kursfreigaben bearbeiten.",
        "community.view": "Community-Verwaltung und Moderationsstatus anzeigen.", "community.manage": "Bereiche, Regeln und Moderationsentscheidungen verwalten.",
        "events.view": "Events und Teilnehmerlisten anzeigen.", "events.manage": "Events, Zielgruppen und Teilnahmen verwalten.",
        "analytics.view": "Lernfortschritt und aggregierte Auswertungen anzeigen.",
        "settings.view": "Mandantenkonfiguration und Profilstrukturen anzeigen.", "settings.manage": "Delegierbare Mandanten- und Profileinstellungen bearbeiten.",
        "integrations.view": "Provider, Produkte, Automationen und Supportkonfiguration anzeigen.", "integrations.manage": "Provider, Produktzuordnungen und Automationen bearbeiten.",
        "api.view": "API-Schluessel, Webhooks und Requesthistorie anzeigen.", "api.manage": "Delegierbare API-Schluessel und Webhooks verwalten.",
        "ai.view": "KI-Agenten, Nutzung und Freigaben anzeigen.", "ai.manage": "KI-Agenten konfigurieren, testen und veroeffentlichen.",
      },
    },
    messages: { created: "Team-Rolle wurde erstellt.", create_failed: "Die Team-Rolle konnte nicht erstellt werden.", updated: "Team-Rolle wurde aktualisiert.", update_failed: "Die Team-Rolle konnte nicht aktualisiert werden.", deleted: "Team-Rolle wurde geloescht.", delete_failed: "Die Team-Rolle konnte nicht geloescht werden.", assigned: "Team-Rolle wurde zugewiesen.", assign_failed: "Die Team-Rolle konnte nicht zugewiesen werden.", unassigned: "Die Standardrechte gelten wieder.", unassign_failed: "Die Zuweisung konnte nicht entfernt werden.", validation_failed: "Bitte pruefe die Rollenangaben." },
  },
  en: {
    page: { metadataTitle: "Roles & permissions", eyebrow: "Access control", title: "Roles & permissions", description: "Define tenant-specific team roles and assign them to active administrators or trainers." },
    manager: { createTitle: "New team role", createDescription: "Permissions are evaluated on the server for every request.", name: "Name", description: "Description", color: "Colour", create: "Create role", assignmentsAndRevision: (assignments, revision) => `${assignments} assignments | Revision ${revision}`, active: "Active", save: "Save", removeAssignmentsFirst: "Remove assignments first", deleteRole: "Delete role", delete: "Delete", administrator: "Administrator", trainer: "Trainer", selectRole: "Select custom role", assignRole: "Assign role", removeRole: "Remove custom role", restoreDefaults: "Restore default permissions", existing: "Existing roles", noRoles: "No custom role yet.", assignments: "Assignments", assignmentDescription: "Owner permissions remain fixed. Trainer permissions are limited by their base role.", noStaff: "No active administrator or trainer accounts." },
    permissions: {
      groups: { members: "Members", courses: "Courses", community: "Community", events: "Events", analytics: "Analytics", settings: "Settings", integrations: "Integrations", ai: "AI" },
      view: "View", manage: "Manage", apiView: "View API", apiManage: "Manage API",
      descriptions: {
        "members.view": "View members, groups, bundles and certificates.", "members.manage": "Invite and import members and manage their status.",
        "courses.view": "View courses and assigned course content.", "courses.manage": "Create courses and edit them within course permissions.",
        "community.view": "View community administration and moderation status.", "community.manage": "Manage spaces, rules and moderation decisions.",
        "events.view": "View events and attendee lists.", "events.manage": "Manage events, audiences and attendance.",
        "analytics.view": "View learning progress and aggregated analytics.",
        "settings.view": "View tenant configuration and profile structures.", "settings.manage": "Edit delegable tenant and profile settings.",
        "integrations.view": "View providers, products, automations and support configuration.", "integrations.manage": "Edit providers, product mappings and automations.",
        "api.view": "View API keys, webhooks and request history.", "api.manage": "Manage delegable API keys and webhooks.",
        "ai.view": "View AI agents, usage and approvals.", "ai.manage": "Configure, test and publish AI agents.",
      },
    },
    messages: { created: "Team role created.", create_failed: "The team role could not be created.", updated: "Team role updated.", update_failed: "The team role could not be updated.", deleted: "Team role deleted.", delete_failed: "The team role could not be deleted.", assigned: "Team role assigned.", assign_failed: "The team role could not be assigned.", unassigned: "Default permissions apply again.", unassign_failed: "The assignment could not be removed.", validation_failed: "Check the role details." },
  },
  it: {
    page: { metadataTitle: "Ruoli e autorizzazioni", eyebrow: "Controllo accessi", title: "Ruoli e autorizzazioni", description: "Definisci ruoli del team specifici per il tenant e assegnali ad amministratori o formatori attivi." },
    manager: { createTitle: "Nuovo ruolo del team", createDescription: "Le autorizzazioni vengono verificate dal server a ogni richiesta.", name: "Nome", description: "Descrizione", color: "Colore", create: "Crea ruolo", assignmentsAndRevision: (assignments, revision) => `${assignments} assegnazioni | Revisione ${revision}`, active: "Attivo", save: "Salva", removeAssignmentsFirst: "Rimuovi prima le assegnazioni", deleteRole: "Elimina ruolo", delete: "Elimina", administrator: "Amministratore", trainer: "Formatore", selectRole: "Seleziona ruolo personalizzato", assignRole: "Assegna ruolo", removeRole: "Rimuovi ruolo personalizzato", restoreDefaults: "Ripristina autorizzazioni predefinite", existing: "Ruoli esistenti", noRoles: "Nessun ruolo personalizzato.", assignments: "Assegnazioni", assignmentDescription: "Le autorizzazioni dei proprietari restano invariate. Quelle dei formatori sono limitate dal ruolo di base.", noStaff: "Nessun account amministratore o formatore attivo." },
    permissions: {
      groups: { members: "Membri", courses: "Corsi", community: "Community", events: "Eventi", analytics: "Analisi", settings: "Impostazioni", integrations: "Integrazioni", ai: "IA" },
      view: "Visualizza", manage: "Gestisci", apiView: "Visualizza API", apiManage: "Gestisci API",
      descriptions: {
        "members.view": "Visualizza membri, gruppi, pacchetti e certificati.", "members.manage": "Invita e importa membri e gestiscine lo stato.",
        "courses.view": "Visualizza corsi e contenuti assegnati.", "courses.manage": "Crea corsi e modificali entro le autorizzazioni.",
        "community.view": "Visualizza amministrazione e moderazione della community.", "community.manage": "Gestisci spazi, regole e decisioni di moderazione.",
        "events.view": "Visualizza eventi ed elenchi partecipanti.", "events.manage": "Gestisci eventi, destinatari e partecipazioni.",
        "analytics.view": "Visualizza progresso e analisi aggregate.",
        "settings.view": "Visualizza configurazione tenant e strutture profilo.", "settings.manage": "Modifica impostazioni delegabili del tenant e dei profili.",
        "integrations.view": "Visualizza provider, prodotti, automazioni e supporto.", "integrations.manage": "Modifica provider, associazioni prodotto e automazioni.",
        "api.view": "Visualizza chiavi API, webhook e cronologia richieste.", "api.manage": "Gestisci chiavi API delegabili e webhook.",
        "ai.view": "Visualizza agenti IA, utilizzo e approvazioni.", "ai.manage": "Configura, testa e pubblica agenti IA.",
      },
    },
    messages: { created: "Ruolo del team creato.", create_failed: "Non e stato possibile creare il ruolo del team.", updated: "Ruolo del team aggiornato.", update_failed: "Non e stato possibile aggiornare il ruolo del team.", deleted: "Ruolo del team eliminato.", delete_failed: "Non e stato possibile eliminare il ruolo del team.", assigned: "Ruolo del team assegnato.", assign_failed: "Non e stato possibile assegnare il ruolo del team.", unassigned: "Si applicano di nuovo le autorizzazioni predefinite.", unassign_failed: "Non e stato possibile rimuovere l'assegnazione.", validation_failed: "Controlla i dati del ruolo." },
  },
  es: {
    page: { metadataTitle: "Roles y permisos", eyebrow: "Control de acceso", title: "Roles y permisos", description: "Define roles de equipo especificos del tenant y asignarlos a administradores o formadores activos." },
    manager: { createTitle: "Nuevo rol de equipo", createDescription: "Los permisos se evaluan en el servidor en cada solicitud.", name: "Nombre", description: "Descripcion", color: "Color", create: "Crear rol", assignmentsAndRevision: (assignments, revision) => `${assignments} asignaciones | Revision ${revision}`, active: "Activo", save: "Guardar", removeAssignmentsFirst: "Elimina primero las asignaciones", deleteRole: "Eliminar rol", delete: "Eliminar", administrator: "Administrador", trainer: "Formador", selectRole: "Seleccionar rol personalizado", assignRole: "Asignar rol", removeRole: "Eliminar rol personalizado", restoreDefaults: "Restaurar permisos predeterminados", existing: "Roles existentes", noRoles: "Aun no hay roles personalizados.", assignments: "Asignaciones", assignmentDescription: "Los permisos de propietarios no cambian. Los de formadores estan limitados por su rol base.", noStaff: "No hay cuentas activas de administrador o formador." },
    permissions: {
      groups: { members: "Miembros", courses: "Cursos", community: "Comunidad", events: "Eventos", analytics: "Analitica", settings: "Ajustes", integrations: "Integraciones", ai: "IA" },
      view: "Ver", manage: "Gestionar", apiView: "Ver API", apiManage: "Gestionar API",
      descriptions: {
        "members.view": "Ver miembros, grupos, paquetes y certificados.", "members.manage": "Invitar e importar miembros y gestionar su estado.",
        "courses.view": "Ver cursos y contenidos asignados.", "courses.manage": "Crear cursos y editarlos dentro de sus permisos.",
        "community.view": "Ver administracion y estado de moderacion de la comunidad.", "community.manage": "Gestionar espacios, reglas y decisiones de moderacion.",
        "events.view": "Ver eventos y listas de asistentes.", "events.manage": "Gestionar eventos, audiencias y asistencia.",
        "analytics.view": "Ver progreso y analitica agregada.",
        "settings.view": "Ver configuracion del tenant y estructuras de perfil.", "settings.manage": "Editar ajustes delegables del tenant y perfiles.",
        "integrations.view": "Ver proveedores, productos, automatizaciones y soporte.", "integrations.manage": "Editar proveedores, asociaciones y automatizaciones.",
        "api.view": "Ver claves API, webhooks e historial de solicitudes.", "api.manage": "Gestionar claves API delegables y webhooks.",
        "ai.view": "Ver agentes de IA, uso y aprobaciones.", "ai.manage": "Configurar, probar y publicar agentes de IA.",
      },
    },
    messages: { created: "Rol de equipo creado.", create_failed: "No se pudo crear el rol de equipo.", updated: "Rol de equipo actualizado.", update_failed: "No se pudo actualizar el rol de equipo.", deleted: "Rol de equipo eliminado.", delete_failed: "No se pudo eliminar el rol de equipo.", assigned: "Rol de equipo asignado.", assign_failed: "No se pudo asignar el rol de equipo.", unassigned: "Vuelven a aplicarse los permisos predeterminados.", unassign_failed: "No se pudo eliminar la asignacion.", validation_failed: "Revisa los datos del rol." },
  },
  fr: {
    page: { metadataTitle: "Roles et autorisations", eyebrow: "Controle d'acces", title: "Roles et autorisations", description: "Definissez des roles d'equipe propres au tenant et attribuez-les aux administrateurs ou formateurs actifs." },
    manager: { createTitle: "Nouveau role d'equipe", createDescription: "Les autorisations sont evaluees par le serveur a chaque requete.", name: "Nom", description: "Description", color: "Couleur", create: "Creer le role", assignmentsAndRevision: (assignments, revision) => `${assignments} attributions | Revision ${revision}`, active: "Actif", save: "Enregistrer", removeAssignmentsFirst: "Supprimez d'abord les attributions", deleteRole: "Supprimer le role", delete: "Supprimer", administrator: "Administrateur", trainer: "Formateur", selectRole: "Selectionner un role personnalise", assignRole: "Attribuer le role", removeRole: "Retirer le role personnalise", restoreDefaults: "Restaurer les autorisations par defaut", existing: "Roles existants", noRoles: "Aucun role personnalise.", assignments: "Attributions", assignmentDescription: "Les autorisations des proprietaires restent fixes. Celles des formateurs sont limitees par leur role de base.", noStaff: "Aucun compte administrateur ou formateur actif." },
    permissions: {
      groups: { members: "Membres", courses: "Cours", community: "Communaute", events: "Evenements", analytics: "Analyses", settings: "Parametres", integrations: "Integrations", ai: "IA" },
      view: "Voir", manage: "Gerer", apiView: "Voir l'API", apiManage: "Gerer l'API",
      descriptions: {
        "members.view": "Voir les membres, groupes, packs et certificats.", "members.manage": "Inviter et importer des membres et gerer leur statut.",
        "courses.view": "Voir les cours et contenus attribues.", "courses.manage": "Creer des cours et les modifier selon les autorisations.",
        "community.view": "Voir l'administration et la moderation de la communaute.", "community.manage": "Gerer les espaces, regles et decisions de moderation.",
        "events.view": "Voir les evenements et listes de participants.", "events.manage": "Gerer les evenements, publics et participations.",
        "analytics.view": "Voir la progression et les analyses agregees.",
        "settings.view": "Voir la configuration du tenant et les structures de profil.", "settings.manage": "Modifier les parametres delegables du tenant et des profils.",
        "integrations.view": "Voir les fournisseurs, produits, automatisations et le support.", "integrations.manage": "Modifier les fournisseurs, associations et automatisations.",
        "api.view": "Voir les cles API, webhooks et l'historique des requetes.", "api.manage": "Gerer les cles API delegables et les webhooks.",
        "ai.view": "Voir les agents IA, l'utilisation et les validations.", "ai.manage": "Configurer, tester et publier les agents IA.",
      },
    },
    messages: { created: "Role d'equipe cree.", create_failed: "Le role d'equipe n'a pas pu etre cree.", updated: "Role d'equipe mis a jour.", update_failed: "Le role d'equipe n'a pas pu etre mis a jour.", deleted: "Role d'equipe supprime.", delete_failed: "Le role d'equipe n'a pas pu etre supprime.", assigned: "Role d'equipe attribue.", assign_failed: "Le role d'equipe n'a pas pu etre attribue.", unassigned: "Les autorisations par defaut s'appliquent a nouveau.", unassign_failed: "L'attribution n'a pas pu etre retiree.", validation_failed: "Verifiez les informations du role." },
  },
};

function permissionGroup(key: TeamPermissionKey): PermissionGroup {
  const prefix = key.split(".")[0];
  if (prefix === "api" || prefix === "integrations") return "integrations";
  return prefix as PermissionGroup;
}

export function getTeamRoleCopy(locale: AppLocale) {
  return copy[locale];
}

export function getTeamPermissionCopy(locale: AppLocale, key: TeamPermissionKey) {
  const permissions = copy[locale].permissions;
  const isApi = key.startsWith("api.");
  const manage = key.endsWith(".manage");
  return {
    group: permissions.groups[permissionGroup(key)],
    label: isApi
      ? manage
        ? permissions.apiManage
        : permissions.apiView
      : manage
        ? permissions.manage
        : permissions.view,
    description: permissions.descriptions[key],
  };
}

export function resolveTeamRoleMessage(
  locale: AppLocale,
  code: TeamRoleMessageCode | undefined,
) {
  return copy[locale].messages[code ?? "validation_failed"];
}
