import type { AppLocale } from "@/lib/i18n/model";

export type MemberAdminActionCopy = {
  invite: {
    invalid: string;
    duplicate: string;
    capacity: (limit: number) => string;
    failed: string;
    created: string;
  };
  import: {
    fileRequired: string;
    csvRequired: string;
    fileTooLarge: string;
    invalidFile: string;
    invalidHeader: (expected: string) => string;
    noRows: string;
    tooManyRows: (limit: number) => string;
    parseFailed: string;
    invalidField: (field: string) => string;
    duplicateInFile: string;
    existingEmail: string;
    ownerForbidden: string;
    adminForbidden: string;
    invitedRequired: string;
    createdConcurrently: string;
    capacity: (limit: number) => string;
    recordFailed: string;
    complete: (imported: number, skipped: number, failed: number) => string;
    fields: Record<
      | "email"
      | "first_name"
      | "last_name"
      | "role"
      | "status"
      | "job_title"
      | "department"
      | "row",
      string
    >;
  };
  status: {
    invalid: string;
    notFound: string;
    selfDisable: string;
    ownerProtected: string;
    adminForbidden: string;
    unchanged: (name: string) => string;
    activated: (name: string) => string;
    disabled: (name: string) => string;
    capacity: (limit: number) => string;
    failed: string;
  };
};

const dictionaries: Record<AppLocale, MemberAdminActionCopy> = {
  de: {
    invite: {
      invalid: "Bitte alle Pflichtfelder korrekt ausfuellen.",
      duplicate: "Diese E-Mail-Adresse ist in dieser Academy bereits vorhanden.",
      capacity: (limit) => `Das Seat-Limit von ${limit} Konten ist erreicht.`,
      failed: "Die Einladung konnte nicht angelegt werden.",
      created: "Einladung wurde angelegt.",
    },
    import: {
      fileRequired: "Bitte eine nicht leere CSV-Datei auswaehlen.",
      csvRequired: "Die ausgewaehlte Datei muss die Endung .csv haben.",
      fileTooLarge: "Die CSV-Datei darf maximal 500 KB gross sein.",
      invalidFile: "Die CSV-Datei ist leer oder enthaelt ungueltige Zeichen.",
      invalidHeader: (expected) => `Ungueltige Kopfzeile. Erwartet: ${expected}.`,
      noRows: "Die CSV-Datei enthaelt keine Datenzeilen.",
      tooManyRows: (limit) => `Pro Import sind maximal ${limit} Datenzeilen erlaubt.`,
      parseFailed: "Die CSV-Datei konnte nicht sicher gelesen werden.",
      invalidField: (field) => `${field}: ungueltiger Wert.`,
      duplicateInFile: "E-Mail ist mehrfach in der CSV-Datei vorhanden.",
      existingEmail: "E-Mail existiert in dieser Academy bereits.",
      ownerForbidden: "Die Owner-Rolle kann nicht importiert werden.",
      adminForbidden: "Nur der Owner darf Admins importieren.",
      invitedRequired: "Neue Nutzer muessen den Status invited haben.",
      createdConcurrently: "E-Mail wurde parallel bereits angelegt.",
      capacity: (limit) => `Das Seat-Limit von ${limit} Konten ist erreicht.`,
      recordFailed: "Datensatz konnte nicht gespeichert werden.",
      complete: (imported, skipped, failed) =>
        `Import abgeschlossen: ${imported} eingeladen, ${skipped} uebersprungen, ${failed} fehlerhaft.`,
      fields: { email: "E-Mail", first_name: "Vorname", last_name: "Nachname", role: "Rolle", status: "Status", job_title: "Position", department: "Bereich", row: "Zeile" },
    },
    status: {
      invalid: "Ungueltige Mitglieder-Aktion.",
      notFound: "Mitglied wurde nicht gefunden.",
      selfDisable: "Der eigene Zugang kann hier nicht deaktiviert werden.",
      ownerProtected: "Der Organisationsinhaber kann nicht deaktiviert werden.",
      adminForbidden: "Nur der Owner darf den Status von Admins aendern.",
      unchanged: (name) => `${name} hat diesen Status bereits.`,
      activated: (name) => `${name} wurde aktiviert.`,
      disabled: (name) => `${name} wurde deaktiviert.`,
      capacity: (limit) => `Das Seat-Limit von ${limit} Konten ist erreicht.`,
      failed: "Der Mitgliederstatus konnte nicht geaendert werden.",
    },
  },
  en: {
    invite: {
      invalid: "Complete all required fields correctly.",
      duplicate: "This email address already exists in this academy.",
      capacity: (limit) => `The seat limit of ${limit} accounts has been reached.`,
      failed: "The invitation could not be created.",
      created: "Invitation created.",
    },
    import: {
      fileRequired: "Select a non-empty CSV file.",
      csvRequired: "The selected file must use the .csv extension.",
      fileTooLarge: "The CSV file must not exceed 500 KB.",
      invalidFile: "The CSV file is empty or contains invalid characters.",
      invalidHeader: (expected) => `Invalid header. Expected: ${expected}.`,
      noRows: "The CSV file does not contain any data rows.",
      tooManyRows: (limit) => `Each import may contain at most ${limit} data rows.`,
      parseFailed: "The CSV file could not be read safely.",
      invalidField: (field) => `${field}: invalid value.`,
      duplicateInFile: "The email occurs more than once in the CSV file.",
      existingEmail: "The email already exists in this academy.",
      ownerForbidden: "The owner role cannot be imported.",
      adminForbidden: "Only the owner can import administrators.",
      invitedRequired: "New users must have the invited status.",
      createdConcurrently: "The email was created concurrently.",
      capacity: (limit) => `The seat limit of ${limit} accounts has been reached.`,
      recordFailed: "The record could not be saved.",
      complete: (imported, skipped, failed) =>
        `Import complete: ${imported} invited, ${skipped} skipped, ${failed} failed.`,
      fields: { email: "Email", first_name: "First name", last_name: "Last name", role: "Role", status: "Status", job_title: "Job title", department: "Department", row: "Row" },
    },
    status: {
      invalid: "The member action is invalid.",
      notFound: "The member could not be found.",
      selfDisable: "You cannot disable your own access here.",
      ownerProtected: "The organisation owner cannot be disabled.",
      adminForbidden: "Only the owner can change an administrator's status.",
      unchanged: (name) => `${name} already has this status.`,
      activated: (name) => `${name} was activated.`,
      disabled: (name) => `${name} was disabled.`,
      capacity: (limit) => `The seat limit of ${limit} accounts has been reached.`,
      failed: "The member status could not be changed.",
    },
  },
  it: {
    invite: {
      invalid: "Compila correttamente tutti i campi obbligatori.",
      duplicate: "Questo indirizzo email esiste già nell'academy.",
      capacity: (limit) => `È stato raggiunto il limite di ${limit} account.`,
      failed: "Non è stato possibile creare l'invito.",
      created: "Invito creato.",
    },
    import: {
      fileRequired: "Seleziona un file CSV non vuoto.",
      csvRequired: "Il file selezionato deve avere estensione .csv.",
      fileTooLarge: "Il file CSV non può superare 500 KB.",
      invalidFile: "Il file CSV è vuoto o contiene caratteri non validi.",
      invalidHeader: (expected) => `Intestazione non valida. Prevista: ${expected}.`,
      noRows: "Il file CSV non contiene righe di dati.",
      tooManyRows: (limit) => `Ogni importazione può contenere al massimo ${limit} righe.`,
      parseFailed: "Non è stato possibile leggere il file CSV in modo sicuro.",
      invalidField: (field) => `${field}: valore non valido.`,
      duplicateInFile: "L'indirizzo email compare più volte nel file CSV.",
      existingEmail: "L'indirizzo email esiste già nell'academy.",
      ownerForbidden: "Il ruolo owner non può essere importato.",
      adminForbidden: "Solo l'owner può importare amministratori.",
      invitedRequired: "I nuovi utenti devono avere lo stato invited.",
      createdConcurrently: "L'indirizzo email è stato creato contemporaneamente.",
      capacity: (limit) => `È stato raggiunto il limite di ${limit} account.`,
      recordFailed: "Non è stato possibile salvare il record.",
      complete: (imported, skipped, failed) =>
        `Importazione completata: ${imported} invitati, ${skipped} ignorati, ${failed} non riusciti.`,
      fields: { email: "Email", first_name: "Nome", last_name: "Cognome", role: "Ruolo", status: "Stato", job_title: "Posizione", department: "Reparto", row: "Riga" },
    },
    status: {
      invalid: "L'azione sul membro non è valida.",
      notFound: "Il membro non è stato trovato.",
      selfDisable: "Non puoi disattivare qui il tuo accesso.",
      ownerProtected: "L'owner dell'organizzazione non può essere disattivato.",
      adminForbidden: "Solo l'owner può cambiare lo stato degli amministratori.",
      unchanged: (name) => `${name} ha già questo stato.`,
      activated: (name) => `${name} è stato attivato.`,
      disabled: (name) => `${name} è stato disattivato.`,
      capacity: (limit) => `È stato raggiunto il limite di ${limit} account.`,
      failed: "Non è stato possibile cambiare lo stato del membro.",
    },
  },
  es: {
    invite: {
      invalid: "Completa correctamente todos los campos obligatorios.",
      duplicate: "Esta dirección de correo ya existe en la academia.",
      capacity: (limit) => `Se ha alcanzado el límite de ${limit} cuentas.`,
      failed: "No se pudo crear la invitación.",
      created: "Invitación creada.",
    },
    import: {
      fileRequired: "Selecciona un archivo CSV que no esté vacío.",
      csvRequired: "El archivo seleccionado debe tener la extensión .csv.",
      fileTooLarge: "El archivo CSV no puede superar los 500 KB.",
      invalidFile: "El archivo CSV está vacío o contiene caracteres no válidos.",
      invalidHeader: (expected) => `Cabecera no válida. Se esperaba: ${expected}.`,
      noRows: "El archivo CSV no contiene filas de datos.",
      tooManyRows: (limit) => `Cada importación puede contener como máximo ${limit} filas.`,
      parseFailed: "El archivo CSV no se pudo leer de forma segura.",
      invalidField: (field) => `${field}: valor no válido.`,
      duplicateInFile: "El correo aparece más de una vez en el archivo CSV.",
      existingEmail: "El correo ya existe en la academia.",
      ownerForbidden: "El rol owner no se puede importar.",
      adminForbidden: "Solo el owner puede importar administradores.",
      invitedRequired: "Los nuevos usuarios deben tener el estado invited.",
      createdConcurrently: "El correo se creó de forma simultánea.",
      capacity: (limit) => `Se ha alcanzado el límite de ${limit} cuentas.`,
      recordFailed: "No se pudo guardar el registro.",
      complete: (imported, skipped, failed) =>
        `Importación completada: ${imported} invitados, ${skipped} omitidos, ${failed} fallidos.`,
      fields: { email: "Correo", first_name: "Nombre", last_name: "Apellidos", role: "Rol", status: "Estado", job_title: "Puesto", department: "Área", row: "Fila" },
    },
    status: {
      invalid: "La acción sobre el miembro no es válida.",
      notFound: "No se encontró al miembro.",
      selfDisable: "No puedes desactivar aquí tu propio acceso.",
      ownerProtected: "El owner de la organización no se puede desactivar.",
      adminForbidden: "Solo el owner puede cambiar el estado de administradores.",
      unchanged: (name) => `${name} ya tiene este estado.`,
      activated: (name) => `${name} se ha activado.`,
      disabled: (name) => `${name} se ha desactivado.`,
      capacity: (limit) => `Se ha alcanzado el límite de ${limit} cuentas.`,
      failed: "No se pudo cambiar el estado del miembro.",
    },
  },
  fr: {
    invite: {
      invalid: "Renseignez correctement tous les champs obligatoires.",
      duplicate: "Cette adresse e-mail existe déjà dans l'academy.",
      capacity: (limit) => `La limite de ${limit} comptes est atteinte.`,
      failed: "L'invitation n'a pas pu être créée.",
      created: "Invitation créée.",
    },
    import: {
      fileRequired: "Sélectionnez un fichier CSV non vide.",
      csvRequired: "Le fichier sélectionné doit porter l'extension .csv.",
      fileTooLarge: "Le fichier CSV ne doit pas dépasser 500 Ko.",
      invalidFile: "Le fichier CSV est vide ou contient des caractères non valides.",
      invalidHeader: (expected) => `En-tête non valide. Attendu : ${expected}.`,
      noRows: "Le fichier CSV ne contient aucune ligne de données.",
      tooManyRows: (limit) => `Chaque import peut contenir au maximum ${limit} lignes.`,
      parseFailed: "Le fichier CSV n'a pas pu être lu de manière sûre.",
      invalidField: (field) => `${field} : valeur non valide.`,
      duplicateInFile: "L'adresse e-mail apparaît plusieurs fois dans le fichier CSV.",
      existingEmail: "L'adresse e-mail existe déjà dans l'academy.",
      ownerForbidden: "Le rôle owner ne peut pas être importé.",
      adminForbidden: "Seul l'owner peut importer des administrateurs.",
      invitedRequired: "Les nouveaux utilisateurs doivent avoir le statut invited.",
      createdConcurrently: "L'adresse e-mail a été créée simultanément.",
      capacity: (limit) => `La limite de ${limit} comptes est atteinte.`,
      recordFailed: "L'enregistrement n'a pas pu être sauvegardé.",
      complete: (imported, skipped, failed) =>
        `Import terminé : ${imported} invités, ${skipped} ignorés, ${failed} en échec.`,
      fields: { email: "E-mail", first_name: "Prénom", last_name: "Nom", role: "Rôle", status: "Statut", job_title: "Poste", department: "Service", row: "Ligne" },
    },
    status: {
      invalid: "L'action sur le membre n'est pas valide.",
      notFound: "Le membre est introuvable.",
      selfDisable: "Vous ne pouvez pas désactiver votre propre accès ici.",
      ownerProtected: "L'owner de l'organisation ne peut pas être désactivé.",
      adminForbidden: "Seul l'owner peut modifier le statut des administrateurs.",
      unchanged: (name) => `${name} possède déjà ce statut.`,
      activated: (name) => `${name} a été activé.`,
      disabled: (name) => `${name} a été désactivé.`,
      capacity: (limit) => `La limite de ${limit} comptes est atteinte.`,
      failed: "Le statut du membre n'a pas pu être modifié.",
    },
  },
};

export function getMemberAdminActionCopy(locale: AppLocale) {
  return dictionaries[locale];
}
