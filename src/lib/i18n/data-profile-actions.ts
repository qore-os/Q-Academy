import type { AppLocale } from "@/lib/i18n/model";

export type DataProfileMessageCode =
  | "invalidProfile"
  | "invalidMember"
  | "memberNotFound"
  | "definitionNotFound"
  | "definitionRestricted"
  | "duplicateName"
  | "profileCreated"
  | "profileNotFound"
  | "profileActivated"
  | "activeProfileArchiveDenied"
  | "profileArchived"
  | "invalidFieldValue"
  | "mediaUnavailable"
  | "fieldsSaved"
  | "failed";

export type DataProfileMessageParams = Record<
  string,
  string | number | boolean
>;

type MessageRenderer = (params: DataProfileMessageParams) => string;
type DataProfileActionCopy = Record<DataProfileMessageCode, MessageRenderer>;

function text(params: DataProfileMessageParams, key: string) {
  const value = params[key];
  return typeof value === "string" ? value : "";
}

function flag(params: DataProfileMessageParams, key: string) {
  return params[key] === true;
}

const dictionaries: Record<AppLocale, DataProfileActionCopy> = {
  de: {
    invalidProfile: () => "Bitte das Datenprofil prüfen.",
    invalidMember: () => "Ungültiges Mitglied.",
    memberNotFound: () => "Mitglied wurde nicht gefunden.",
    definitionNotFound: () => "Profilvorlage wurde nicht gefunden.",
    definitionRestricted: () => "Diese Profilvorlage ist nur für Admins.",
    duplicateName: () => "Ein Profil mit diesem Namen existiert bereits.",
    profileCreated: (params) => `${text(params, "name")} wurde angelegt.`,
    profileNotFound: () => "Datenprofil wurde nicht gefunden.",
    profileActivated: (params) =>
      `${text(params, "name")} ist jetzt das aktive Profil.`,
    activeProfileArchiveDenied: () =>
      "Das aktive Profil kann nicht archiviert werden.",
    profileArchived: (params) => `${text(params, "name")} wurde archiviert.`,
    invalidFieldValue: (params) =>
      `Bitte den Wert für „${text(params, "label")}“ prüfen${flag(params, "required") ? " (Pflichtfeld)" : ""}.`,
    mediaUnavailable: () =>
      "Ein Profilmedium ist nicht bereit oder gehört zu einem anderen Mitglied.",
    fieldsSaved: () => "Profilfelder wurden gespeichert.",
    failed: () => "Die Datenprofil-Aktion konnte nicht ausgeführt werden.",
  },
  en: {
    invalidProfile: () => "Check the data profile.",
    invalidMember: () => "The member is invalid.",
    memberNotFound: () => "The member was not found.",
    definitionNotFound: () => "The profile template was not found.",
    definitionRestricted: () => "Only administrators can use this profile template.",
    duplicateName: () => "A profile with this name already exists.",
    profileCreated: (params) => `${text(params, "name")} was created.`,
    profileNotFound: () => "The data profile was not found.",
    profileActivated: (params) =>
      `${text(params, "name")} is now the active profile.`,
    activeProfileArchiveDenied: () => "The active profile cannot be archived.",
    profileArchived: (params) => `${text(params, "name")} was archived.`,
    invalidFieldValue: (params) =>
      `Check the value for “${text(params, "label")}”${flag(params, "required") ? " (required)" : ""}.`,
    mediaUnavailable: () =>
      "A profile media item is not ready or belongs to another member.",
    fieldsSaved: () => "Profile fields were saved.",
    failed: () => "The data profile action could not be completed.",
  },
  it: {
    invalidProfile: () => "Controlla il profilo dati.",
    invalidMember: () => "Il membro non è valido.",
    memberNotFound: () => "Il membro non è stato trovato.",
    definitionNotFound: () => "Il modello di profilo non è stato trovato.",
    definitionRestricted: () =>
      "Solo gli amministratori possono usare questo modello di profilo.",
    duplicateName: () => "Esiste già un profilo con questo nome.",
    profileCreated: (params) => `${text(params, "name")} è stato creato.`,
    profileNotFound: () => "Il profilo dati non è stato trovato.",
    profileActivated: (params) =>
      `${text(params, "name")} è ora il profilo attivo.`,
    activeProfileArchiveDenied: () =>
      "Il profilo attivo non può essere archiviato.",
    profileArchived: (params) => `${text(params, "name")} è stato archiviato.`,
    invalidFieldValue: (params) =>
      `Controlla il valore di “${text(params, "label")}”${flag(params, "required") ? " (obbligatorio)" : ""}.`,
    mediaUnavailable: () =>
      "Un contenuto multimediale del profilo non è pronto o appartiene a un altro membro.",
    fieldsSaved: () => "I campi del profilo sono stati salvati.",
    failed: () => "Non è stato possibile completare l'azione sul profilo dati.",
  },
  es: {
    invalidProfile: () => "Comprueba el perfil de datos.",
    invalidMember: () => "El miembro no es válido.",
    memberNotFound: () => "No se encontró el miembro.",
    definitionNotFound: () => "No se encontró la plantilla de perfil.",
    definitionRestricted: () =>
      "Solo los administradores pueden usar esta plantilla de perfil.",
    duplicateName: () => "Ya existe un perfil con este nombre.",
    profileCreated: (params) => `Se creó ${text(params, "name")}.`,
    profileNotFound: () => "No se encontró el perfil de datos.",
    profileActivated: (params) =>
      `${text(params, "name")} es ahora el perfil activo.`,
    activeProfileArchiveDenied: () =>
      "El perfil activo no se puede archivar.",
    profileArchived: (params) => `Se archivó ${text(params, "name")}.`,
    invalidFieldValue: (params) =>
      `Comprueba el valor de “${text(params, "label")}”${flag(params, "required") ? " (obligatorio)" : ""}.`,
    mediaUnavailable: () =>
      "Un elemento multimedia del perfil no está listo o pertenece a otro miembro.",
    fieldsSaved: () => "Se guardaron los campos del perfil.",
    failed: () => "No se pudo completar la acción del perfil de datos.",
  },
  fr: {
    invalidProfile: () => "Vérifiez le profil de données.",
    invalidMember: () => "Le membre n'est pas valide.",
    memberNotFound: () => "Le membre est introuvable.",
    definitionNotFound: () => "Le modèle de profil est introuvable.",
    definitionRestricted: () =>
      "Seuls les administrateurs peuvent utiliser ce modèle de profil.",
    duplicateName: () => "Un profil portant ce nom existe déjà.",
    profileCreated: (params) => `${text(params, "name")} a été créé.`,
    profileNotFound: () => "Le profil de données est introuvable.",
    profileActivated: (params) =>
      `${text(params, "name")} est maintenant le profil actif.`,
    activeProfileArchiveDenied: () =>
      "Le profil actif ne peut pas être archivé.",
    profileArchived: (params) => `${text(params, "name")} a été archivé.`,
    invalidFieldValue: (params) =>
      `Vérifiez la valeur de « ${text(params, "label")} »${flag(params, "required") ? " (obligatoire)" : ""}.`,
    mediaUnavailable: () =>
      "Un média de profil n'est pas prêt ou appartient à un autre membre.",
    fieldsSaved: () => "Les champs du profil ont été enregistrés.",
    failed: () => "L'action sur le profil de données n'a pas pu être effectuée.",
  },
};

export function getDataProfileActionCopy(locale: AppLocale) {
  return dictionaries[locale] ?? dictionaries.de;
}

export function dataProfileActionMessage(
  locale: AppLocale,
  code: DataProfileMessageCode | null | undefined,
  params: DataProfileMessageParams = {},
) {
  return getDataProfileActionCopy(locale)[code ?? "failed"](params);
}
