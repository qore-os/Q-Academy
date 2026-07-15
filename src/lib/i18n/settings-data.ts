import type { AppLocale } from "@/lib/i18n/model";

const de = {
  common: {
    close: "Schließen",
    closeDialog: "Dialog schließen",
    cancel: "Abbrechen",
    save: "Speichern",
    edit: "Bearbeiten",
    delete: "Löschen",
    active: "Aktiv",
    inactive: "Inaktiv",
    technicalKey: "Technischer Key",
    name: "Name",
    description: "Beschreibung",
    order: "Reihenfolge",
    fields: (count: string) => `${count} Felder`,
    options: (count: string) => `${count} Optionen`,
    editNamed: (name: string) => `${name} bearbeiten`,
    deleteNamed: (name: string) => `${name} löschen`,
    toggleNamed: (name: string, active: boolean) =>
      `${name} ${active ? "deaktivieren" : "aktivieren"}`,
  },
  types: {
    text: "Text",
    number: "Zahl",
    boolean: "Ja / Nein",
    date: "Datum",
    select: "Auswahl",
    multiselect: "Mehrfachauswahl",
    url: "URL",
    media: "Medium",
  },
  visibility: { member: "Mitglied", trainer: "Trainer", admin: "Admin" },
  field: {
    eyebrow: "Mitgliederprofil",
    editTitle: "Profilfeld bearbeiten",
    createTitle: "Profilfeld anlegen",
    label: "Bezeichnung",
    labelPlaceholder: "z. B. Standort",
    keyPlaceholder: "standort",
    descriptionPlaceholder: "Interner Hinweis zur Verwendung des Feldes",
    fieldType: "Feldtyp",
    category: "Kategorie",
    defaultCategory: "Profil",
    visibleFor: "Sichtbar für",
    options: "Optionen",
    optionsPlaceholder: "Eine Option pro Zeile\nBerlin\nHamburg",
    optionsHint: "Eine Option pro Zeile, maximal 50.",
    required: "Pflichtfeld",
    requiredHint: "Muss beim Speichern befüllt sein.",
    personalization: "Personalisierung",
    personalizationHint:
      "Gibt das Feld als sichere Variable für eigene Mitgliedertexte frei.",
    activeHint: "Wird in Mitgliederprofilen angezeigt.",
    saving: "Wird gespeichert",
    saveChanges: "Änderungen speichern",
    deleteTitle: "Profilfeld löschen?",
    deleteBody: (name: string) =>
      `${name} und alle dazu gespeicherten Mitgliederwerte werden dauerhaft gelöscht.`,
    deletePermanently: "Endgültig löschen",
    managerTitle: "Benutzerdefinierte Profilfelder",
    activeCount: (count: string) => `${count} aktiv`,
    managerDescription:
      "Erweitere Mitgliederprofile um strukturierte Academy-Daten.",
    requiredBadge: "Pflicht",
    optionalBadge: "Optional",
    variableBadge: "Variable",
    columnField: "Feld",
    columnCategory: "Kategorie",
    columnType: "Typ",
    columnProperties: "Eigenschaften",
    columnActive: "Aktiv",
    columnActions: "Aktionen",
    emptyTitle: "Noch keine Profilfelder",
    emptyDescription:
      "Lege das erste Feld an, um Mitgliederprofile strukturiert zu erweitern.",
    validationHint:
      "Typen und Auswahlwerte werden beim Speichern serverseitig validiert.",
  },
  structure: {
    profileFields: "Profilfelder",
    editDefinition: "Profilvorlage bearbeiten",
    createDefinition: "Profilvorlage anlegen",
    allowMemberCreation: "Mitglied darf anlegen",
    editForm: "Formular bearbeiten",
    createForm: "Formular anlegen",
    profileDefinition: "Profilvorlage",
    buttonLabel: "Buttontext",
    defaultSubmitLabel: "Angaben speichern",
    definitionsTitle: "Profilvorlagen",
    addDefinition: "Profilvorlage",
    selfService: "Self-Service",
    formsTitle: "Formulare",
    addForm: "Formular",
  },
  messages: {
    fieldInvalid: "Bitte prüfe die Felddefinition.",
    fieldDuplicate: "Dieser technische Key wird bereits verwendet.",
    fieldNotFound: "Das Profilfeld wurde nicht gefunden.",
    fieldFormConflict:
      "Das Feld wird in einem aktiven Mitgliederformular verwendet.",
    fieldCommunityConflict:
      "Das Feld wird im öffentlichen Community-Profil verwendet.",
    fieldMediaConflict:
      "Ein bestehendes Feld mit Werten kann nicht direkt in ein Medienfeld umgewandelt werden.",
    fieldCreated: "Profilfeld wurde angelegt.",
    fieldSaved: "Profilfeld wurde gespeichert.",
    fieldSavedRemoved: (count: string) =>
      `Profilfeld gespeichert. ${count} nicht mehr passende Werte wurden entfernt.`,
    fieldActivated: (name: string) => `${name} wurde aktiviert.`,
    fieldDeactivated: (name: string) => `${name} wurde deaktiviert.`,
    fieldDeleted: (name: string) => `${name} wurde dauerhaft gelöscht.`,
    fieldToggleFailed: "Der Feldstatus konnte nicht geändert werden.",
    fieldDeleteFailed: "Das Profilfeld konnte nicht gelöscht werden.",
    definitionInvalid: "Bitte prüfe die Profilvorlage.",
    definitionFieldInvalid: "Mindestens ein Profilfeld ist ungültig.",
    definitionDuplicate: "Dieser Vorlagen-Key wird bereits verwendet.",
    definitionNotFound: "Die Profilvorlage wurde nicht gefunden.",
    definitionConflict:
      "Aktive Formulare verwenden mindestens ein entferntes Profilfeld.",
    definitionCreated: "Profilvorlage wurde angelegt.",
    definitionSaved: "Profilvorlage wurde gespeichert.",
    formInvalid: "Bitte prüfe das Formular.",
    formDefinitionMissing: "Die Profilvorlage wurde nicht gefunden.",
    formFieldsInvalid:
      "Formulare benötigen sichtbare Felder der Profilvorlage.",
    formFieldsChanged:
      "Formularfelder oder Sichtbarkeit sind nicht mehr gültig.",
    formDuplicate: "Dieser Formular-Key wird bereits verwendet.",
    formNotFound: "Das Formular wurde nicht gefunden.",
    formReferenced: "Das Formular wird in einem Kurs oder Hub verwendet.",
    formCreated: "Formular wurde angelegt.",
    formSaved: "Formular wurde gespeichert.",
    formActivated: (name: string) => `${name} wurde aktiviert.`,
    formDeactivated: (name: string) => `${name} wurde deaktiviert.`,
  },
};

type WidenCopy<T> = T extends (...args: infer Args) => string
  ? (...args: Args) => string
  : T extends string
    ? string
    : { readonly [Key in keyof T]: WidenCopy<T[Key]> };

export type SettingsDataCopy = WidenCopy<typeof de>;

const en: SettingsDataCopy = {
  common: { close: "Close", closeDialog: "Close dialog", cancel: "Cancel", save: "Save", edit: "Edit", delete: "Delete", active: "Active", inactive: "Inactive", technicalKey: "Technical key", name: "Name", description: "Description", order: "Order", fields: (count) => `${count} fields`, options: (count) => `${count} options`, editNamed: (name) => `Edit ${name}`, deleteNamed: (name) => `Delete ${name}`, toggleNamed: (name, active) => `${active ? "Deactivate" : "Activate"} ${name}` },
  types: { text: "Text", number: "Number", boolean: "Yes / No", date: "Date", select: "Selection", multiselect: "Multiple selection", url: "URL", media: "Media" },
  visibility: { member: "Member", trainer: "Trainer", admin: "Admin" },
  field: { eyebrow: "Member profile", editTitle: "Edit profile field", createTitle: "Create profile field", label: "Label", labelPlaceholder: "e.g. Location", keyPlaceholder: "location", descriptionPlaceholder: "Internal note about how this field is used", fieldType: "Field type", category: "Category", defaultCategory: "Profile", visibleFor: "Visible to", options: "Options", optionsPlaceholder: "One option per line\nLondon\nManchester", optionsHint: "One option per line, up to 50.", required: "Required field", requiredHint: "Must have a value when saved.", personalization: "Personalization", personalizationHint: "Makes the field available as a safe variable for custom member copy.", activeHint: "Shown in member profiles.", saving: "Saving", saveChanges: "Save changes", deleteTitle: "Delete profile field?", deleteBody: (name) => `${name} and all stored member values will be permanently deleted.`, deletePermanently: "Delete permanently", managerTitle: "Custom profile fields", activeCount: (count) => `${count} active`, managerDescription: "Extend member profiles with structured Academy data.", requiredBadge: "Required", optionalBadge: "Optional", variableBadge: "Variable", columnField: "Field", columnCategory: "Category", columnType: "Type", columnProperties: "Properties", columnActive: "Active", columnActions: "Actions", emptyTitle: "No profile fields yet", emptyDescription: "Create the first field to extend member profiles with structured data.", validationHint: "Types and selection values are validated on the server when saved." },
  structure: { profileFields: "Profile fields", editDefinition: "Edit profile template", createDefinition: "Create profile template", allowMemberCreation: "Member may create", editForm: "Edit form", createForm: "Create form", profileDefinition: "Profile template", buttonLabel: "Button label", defaultSubmitLabel: "Save details", definitionsTitle: "Profile templates", addDefinition: "Profile template", selfService: "Self-service", formsTitle: "Forms", addForm: "Form" },
  messages: { fieldInvalid: "Check the field definition.", fieldDuplicate: "This technical key is already in use.", fieldNotFound: "The profile field was not found.", fieldFormConflict: "The field is used in an active member form.", fieldCommunityConflict: "The field is used in the public community profile.", fieldMediaConflict: "An existing field with values cannot be converted directly into a media field.", fieldCreated: "Profile field created.", fieldSaved: "Profile field saved.", fieldSavedRemoved: (count) => `Profile field saved. ${count} values that no longer matched were removed.`, fieldActivated: (name) => `${name} was activated.`, fieldDeactivated: (name) => `${name} was deactivated.`, fieldDeleted: (name) => `${name} was permanently deleted.`, fieldToggleFailed: "The field status could not be changed.", fieldDeleteFailed: "The profile field could not be deleted.", definitionInvalid: "Check the profile template.", definitionFieldInvalid: "At least one profile field is invalid.", definitionDuplicate: "This template key is already in use.", definitionNotFound: "The profile template was not found.", definitionConflict: "Active forms use at least one removed profile field.", definitionCreated: "Profile template created.", definitionSaved: "Profile template saved.", formInvalid: "Check the form.", formDefinitionMissing: "The profile template was not found.", formFieldsInvalid: "Forms require visible fields from the profile template.", formFieldsChanged: "The form fields or visibility are no longer valid.", formDuplicate: "This form key is already in use.", formNotFound: "The form was not found.", formReferenced: "The form is used in a course or hub.", formCreated: "Form created.", formSaved: "Form saved.", formActivated: (name) => `${name} was activated.`, formDeactivated: (name) => `${name} was deactivated.` },
};

const it: SettingsDataCopy = {
  common: { close: "Chiudi", closeDialog: "Chiudi finestra", cancel: "Annulla", save: "Salva", edit: "Modifica", delete: "Elimina", active: "Attivo", inactive: "Inattivo", technicalKey: "Chiave tecnica", name: "Nome", description: "Descrizione", order: "Ordine", fields: (count) => `${count} campi`, options: (count) => `${count} opzioni`, editNamed: (name) => `Modifica ${name}`, deleteNamed: (name) => `Elimina ${name}`, toggleNamed: (name, active) => `${active ? "Disattiva" : "Attiva"} ${name}` },
  types: { text: "Testo", number: "Numero", boolean: "Sì / No", date: "Data", select: "Selezione", multiselect: "Selezione multipla", url: "URL", media: "Media" },
  visibility: { member: "Membro", trainer: "Formatore", admin: "Admin" },
  field: { eyebrow: "Profilo membro", editTitle: "Modifica campo del profilo", createTitle: "Crea campo del profilo", label: "Etichetta", labelPlaceholder: "es. Sede", keyPlaceholder: "sede", descriptionPlaceholder: "Nota interna sull'utilizzo del campo", fieldType: "Tipo di campo", category: "Categoria", defaultCategory: "Profilo", visibleFor: "Visibile a", options: "Opzioni", optionsPlaceholder: "Un'opzione per riga\nRoma\nMilano", optionsHint: "Un'opzione per riga, massimo 50.", required: "Campo obbligatorio", requiredHint: "Deve avere un valore al salvataggio.", personalization: "Personalizzazione", personalizationHint: "Rende il campo disponibile come variabile sicura per i testi personalizzati dei membri.", activeHint: "Mostrato nei profili dei membri.", saving: "Salvataggio", saveChanges: "Salva modifiche", deleteTitle: "Eliminare il campo del profilo?", deleteBody: (name) => `${name} e tutti i valori dei membri memorizzati verranno eliminati definitivamente.`, deletePermanently: "Elimina definitivamente", managerTitle: "Campi del profilo personalizzati", activeCount: (count) => `${count} attivi`, managerDescription: "Estendi i profili dei membri con dati Academy strutturati.", requiredBadge: "Obbligatorio", optionalBadge: "Facoltativo", variableBadge: "Variabile", columnField: "Campo", columnCategory: "Categoria", columnType: "Tipo", columnProperties: "Proprietà", columnActive: "Attivo", columnActions: "Azioni", emptyTitle: "Nessun campo del profilo", emptyDescription: "Crea il primo campo per estendere i profili dei membri con dati strutturati.", validationHint: "I tipi e i valori di selezione vengono convalidati sul server al salvataggio." },
  structure: { profileFields: "Campi del profilo", editDefinition: "Modifica modello di profilo", createDefinition: "Crea modello di profilo", allowMemberCreation: "Il membro può creare", editForm: "Modifica modulo", createForm: "Crea modulo", profileDefinition: "Modello di profilo", buttonLabel: "Testo del pulsante", defaultSubmitLabel: "Salva dati", definitionsTitle: "Modelli di profilo", addDefinition: "Modello di profilo", selfService: "Self-service", formsTitle: "Moduli", addForm: "Modulo" },
  messages: { fieldInvalid: "Controlla la definizione del campo.", fieldDuplicate: "Questa chiave tecnica è già in uso.", fieldNotFound: "Il campo del profilo non è stato trovato.", fieldFormConflict: "Il campo è utilizzato in un modulo membro attivo.", fieldCommunityConflict: "Il campo è utilizzato nel profilo pubblico della community.", fieldMediaConflict: "Un campo esistente con valori non può essere convertito direttamente in un campo media.", fieldCreated: "Campo del profilo creato.", fieldSaved: "Campo del profilo salvato.", fieldSavedRemoved: (count) => `Campo del profilo salvato. Sono stati rimossi ${count} valori non più compatibili.`, fieldActivated: (name) => `${name} è stato attivato.`, fieldDeactivated: (name) => `${name} è stato disattivato.`, fieldDeleted: (name) => `${name} è stato eliminato definitivamente.`, fieldToggleFailed: "Non è stato possibile modificare lo stato del campo.", fieldDeleteFailed: "Non è stato possibile eliminare il campo del profilo.", definitionInvalid: "Controlla il modello di profilo.", definitionFieldInvalid: "Almeno un campo del profilo non è valido.", definitionDuplicate: "Questa chiave del modello è già in uso.", definitionNotFound: "Il modello di profilo non è stato trovato.", definitionConflict: "I moduli attivi utilizzano almeno un campo del profilo rimosso.", definitionCreated: "Modello di profilo creato.", definitionSaved: "Modello di profilo salvato.", formInvalid: "Controlla il modulo.", formDefinitionMissing: "Il modello di profilo non è stato trovato.", formFieldsInvalid: "I moduli richiedono campi visibili del modello di profilo.", formFieldsChanged: "I campi del modulo o la visibilità non sono più validi.", formDuplicate: "Questa chiave del modulo è già in uso.", formNotFound: "Il modulo non è stato trovato.", formReferenced: "Il modulo è utilizzato in un corso o hub.", formCreated: "Modulo creato.", formSaved: "Modulo salvato.", formActivated: (name) => `${name} è stato attivato.`, formDeactivated: (name) => `${name} è stato disattivato.` },
};

const es: SettingsDataCopy = {
  common: { close: "Cerrar", closeDialog: "Cerrar diálogo", cancel: "Cancelar", save: "Guardar", edit: "Editar", delete: "Eliminar", active: "Activo", inactive: "Inactivo", technicalKey: "Clave técnica", name: "Nombre", description: "Descripción", order: "Orden", fields: (count) => `${count} campos`, options: (count) => `${count} opciones`, editNamed: (name) => `Editar ${name}`, deleteNamed: (name) => `Eliminar ${name}`, toggleNamed: (name, active) => `${active ? "Desactivar" : "Activar"} ${name}` },
  types: { text: "Texto", number: "Número", boolean: "Sí / No", date: "Fecha", select: "Selección", multiselect: "Selección múltiple", url: "URL", media: "Multimedia" },
  visibility: { member: "Miembro", trainer: "Formador", admin: "Admin" },
  field: { eyebrow: "Perfil de miembro", editTitle: "Editar campo del perfil", createTitle: "Crear campo del perfil", label: "Etiqueta", labelPlaceholder: "p. ej. Ubicación", keyPlaceholder: "ubicacion", descriptionPlaceholder: "Nota interna sobre el uso del campo", fieldType: "Tipo de campo", category: "Categoría", defaultCategory: "Perfil", visibleFor: "Visible para", options: "Opciones", optionsPlaceholder: "Una opción por línea\nMadrid\nBarcelona", optionsHint: "Una opción por línea, hasta 50.", required: "Campo obligatorio", requiredHint: "Debe tener un valor al guardar.", personalization: "Personalización", personalizationHint: "Hace que el campo esté disponible como variable segura para textos personalizados de miembros.", activeHint: "Se muestra en los perfiles de miembros.", saving: "Guardando", saveChanges: "Guardar cambios", deleteTitle: "¿Eliminar el campo del perfil?", deleteBody: (name) => `${name} y todos los valores de miembros almacenados se eliminarán permanentemente.`, deletePermanently: "Eliminar permanentemente", managerTitle: "Campos de perfil personalizados", activeCount: (count) => `${count} activos`, managerDescription: "Amplía los perfiles de miembros con datos estructurados de Academy.", requiredBadge: "Obligatorio", optionalBadge: "Opcional", variableBadge: "Variable", columnField: "Campo", columnCategory: "Categoría", columnType: "Tipo", columnProperties: "Propiedades", columnActive: "Activo", columnActions: "Acciones", emptyTitle: "Aún no hay campos de perfil", emptyDescription: "Crea el primer campo para ampliar los perfiles de miembros con datos estructurados.", validationHint: "Los tipos y valores de selección se validan en el servidor al guardar." },
  structure: { profileFields: "Campos del perfil", editDefinition: "Editar plantilla de perfil", createDefinition: "Crear plantilla de perfil", allowMemberCreation: "El miembro puede crear", editForm: "Editar formulario", createForm: "Crear formulario", profileDefinition: "Plantilla de perfil", buttonLabel: "Texto del botón", defaultSubmitLabel: "Guardar datos", definitionsTitle: "Plantillas de perfil", addDefinition: "Plantilla de perfil", selfService: "Autoservicio", formsTitle: "Formularios", addForm: "Formulario" },
  messages: { fieldInvalid: "Comprueba la definición del campo.", fieldDuplicate: "Esta clave técnica ya está en uso.", fieldNotFound: "No se encontró el campo del perfil.", fieldFormConflict: "El campo se utiliza en un formulario de miembros activo.", fieldCommunityConflict: "El campo se utiliza en el perfil público de la comunidad.", fieldMediaConflict: "Un campo existente con valores no se puede convertir directamente en un campo multimedia.", fieldCreated: "Campo del perfil creado.", fieldSaved: "Campo del perfil guardado.", fieldSavedRemoved: (count) => `Campo del perfil guardado. Se eliminaron ${count} valores que ya no coincidían.`, fieldActivated: (name) => `${name} se activó.`, fieldDeactivated: (name) => `${name} se desactivó.`, fieldDeleted: (name) => `${name} se eliminó permanentemente.`, fieldToggleFailed: "No se pudo cambiar el estado del campo.", fieldDeleteFailed: "No se pudo eliminar el campo del perfil.", definitionInvalid: "Comprueba la plantilla de perfil.", definitionFieldInvalid: "Al menos un campo del perfil no es válido.", definitionDuplicate: "Esta clave de plantilla ya está en uso.", definitionNotFound: "No se encontró la plantilla de perfil.", definitionConflict: "Los formularios activos usan al menos un campo de perfil eliminado.", definitionCreated: "Plantilla de perfil creada.", definitionSaved: "Plantilla de perfil guardada.", formInvalid: "Comprueba el formulario.", formDefinitionMissing: "No se encontró la plantilla de perfil.", formFieldsInvalid: "Los formularios requieren campos visibles de la plantilla de perfil.", formFieldsChanged: "Los campos del formulario o la visibilidad ya no son válidos.", formDuplicate: "Esta clave de formulario ya está en uso.", formNotFound: "No se encontró el formulario.", formReferenced: "El formulario se utiliza en un curso o hub.", formCreated: "Formulario creado.", formSaved: "Formulario guardado.", formActivated: (name) => `${name} se activó.`, formDeactivated: (name) => `${name} se desactivó.` },
};

const fr: SettingsDataCopy = {
  common: { close: "Fermer", closeDialog: "Fermer la boîte de dialogue", cancel: "Annuler", save: "Enregistrer", edit: "Modifier", delete: "Supprimer", active: "Actif", inactive: "Inactif", technicalKey: "Clé technique", name: "Nom", description: "Description", order: "Ordre", fields: (count) => `${count} champs`, options: (count) => `${count} options`, editNamed: (name) => `Modifier ${name}`, deleteNamed: (name) => `Supprimer ${name}`, toggleNamed: (name, active) => `${active ? "Désactiver" : "Activer"} ${name}` },
  types: { text: "Texte", number: "Nombre", boolean: "Oui / Non", date: "Date", select: "Sélection", multiselect: "Sélection multiple", url: "URL", media: "Média" },
  visibility: { member: "Membre", trainer: "Formateur", admin: "Admin" },
  field: { eyebrow: "Profil membre", editTitle: "Modifier le champ de profil", createTitle: "Créer un champ de profil", label: "Libellé", labelPlaceholder: "p. ex. Lieu", keyPlaceholder: "lieu", descriptionPlaceholder: "Note interne sur l'utilisation du champ", fieldType: "Type de champ", category: "Catégorie", defaultCategory: "Profil", visibleFor: "Visible pour", options: "Options", optionsPlaceholder: "Une option par ligne\nParis\nLyon", optionsHint: "Une option par ligne, 50 au maximum.", required: "Champ obligatoire", requiredHint: "Doit contenir une valeur lors de l'enregistrement.", personalization: "Personnalisation", personalizationHint: "Rend le champ disponible comme variable sûre pour les textes personnalisés des membres.", activeHint: "Affiché dans les profils des membres.", saving: "Enregistrement", saveChanges: "Enregistrer les modifications", deleteTitle: "Supprimer le champ de profil ?", deleteBody: (name) => `${name} et toutes les valeurs de membres enregistrées seront définitivement supprimés.`, deletePermanently: "Supprimer définitivement", managerTitle: "Champs de profil personnalisés", activeCount: (count) => `${count} actifs`, managerDescription: "Enrichissez les profils des membres avec des données Academy structurées.", requiredBadge: "Obligatoire", optionalBadge: "Facultatif", variableBadge: "Variable", columnField: "Champ", columnCategory: "Catégorie", columnType: "Type", columnProperties: "Propriétés", columnActive: "Actif", columnActions: "Actions", emptyTitle: "Aucun champ de profil", emptyDescription: "Créez le premier champ pour enrichir les profils des membres avec des données structurées.", validationHint: "Les types et valeurs de sélection sont validés sur le serveur lors de l'enregistrement." },
  structure: { profileFields: "Champs de profil", editDefinition: "Modifier le modèle de profil", createDefinition: "Créer un modèle de profil", allowMemberCreation: "Le membre peut créer", editForm: "Modifier le formulaire", createForm: "Créer un formulaire", profileDefinition: "Modèle de profil", buttonLabel: "Texte du bouton", defaultSubmitLabel: "Enregistrer les informations", definitionsTitle: "Modèles de profil", addDefinition: "Modèle de profil", selfService: "Libre-service", formsTitle: "Formulaires", addForm: "Formulaire" },
  messages: { fieldInvalid: "Vérifiez la définition du champ.", fieldDuplicate: "Cette clé technique est déjà utilisée.", fieldNotFound: "Le champ de profil est introuvable.", fieldFormConflict: "Le champ est utilisé dans un formulaire membre actif.", fieldCommunityConflict: "Le champ est utilisé dans le profil public de la communauté.", fieldMediaConflict: "Un champ existant contenant des valeurs ne peut pas être converti directement en champ média.", fieldCreated: "Champ de profil créé.", fieldSaved: "Champ de profil enregistré.", fieldSavedRemoved: (count) => `Champ de profil enregistré. ${count} valeurs qui ne correspondaient plus ont été supprimées.`, fieldActivated: (name) => `${name} a été activé.`, fieldDeactivated: (name) => `${name} a été désactivé.`, fieldDeleted: (name) => `${name} a été définitivement supprimé.`, fieldToggleFailed: "Le statut du champ n'a pas pu être modifié.", fieldDeleteFailed: "Le champ de profil n'a pas pu être supprimé.", definitionInvalid: "Vérifiez le modèle de profil.", definitionFieldInvalid: "Au moins un champ de profil n'est pas valide.", definitionDuplicate: "Cette clé de modèle est déjà utilisée.", definitionNotFound: "Le modèle de profil est introuvable.", definitionConflict: "Les formulaires actifs utilisent au moins un champ de profil supprimé.", definitionCreated: "Modèle de profil créé.", definitionSaved: "Modèle de profil enregistré.", formInvalid: "Vérifiez le formulaire.", formDefinitionMissing: "Le modèle de profil est introuvable.", formFieldsInvalid: "Les formulaires nécessitent des champs visibles du modèle de profil.", formFieldsChanged: "Les champs du formulaire ou leur visibilité ne sont plus valides.", formDuplicate: "Cette clé de formulaire est déjà utilisée.", formNotFound: "Le formulaire est introuvable.", formReferenced: "Le formulaire est utilisé dans un cours ou un hub.", formCreated: "Formulaire créé.", formSaved: "Formulaire enregistré.", formActivated: (name) => `${name} a été activé.`, formDeactivated: (name) => `${name} a été désactivé.` },
};

const dictionaries = { de, en, it, es, fr } satisfies Record<
  AppLocale,
  SettingsDataCopy
>;

export function getSettingsDataCopy(locale: AppLocale) {
  return dictionaries[locale];
}

export { dictionaries as settingsDataDictionaries };
