import type { ConfigurableNotificationCategory } from "@/lib/notification-preference-model";
import type { AppLocale } from "@/lib/i18n/model";

export type MemberExperienceCopy = {
  profile: {
    communityRequired: string;
    avatarPreview: string;
    personalDetails: string;
    saveProfile: string;
    firstName: string;
    lastName: string;
    jobTitle: string;
    department: string;
    phone: string;
    phonePlaceholder: string;
    avatar: string;
    bio: string;
    notifications: string;
    notificationHelp: string;
    saveNotifications: string;
    deliveryChannels: string;
    category: string;
    inApp: string;
    email: string;
    push: string;
    notificationCategories: Record<ConfigurableNotificationCategory, string>;
    channelLabel: (category: string, channel: string) => string;
    password: string;
    passwordHelp: string;
    currentPassword: string;
    newPassword: string;
    confirmPassword: string;
    changePassword: string;
    companyLogin: string;
    loginMode: string;
    ssoOnly: string;
    linkedIdentity: string;
    noLinkedIdentity: string;
    currentSession: string;
    signedInWithSso: string;
    existingSession: string;
    confirmedAt: (date: string) => string;
    lastProviderLogin: string;
    activeSessions: string;
    signedInDevices: (count: number) => string;
    unknownDevice: string;
    mobile: string;
    desktop: string;
    browserOnDevice: (browser: string, device: string) => string;
    current: string;
    passwordMethod: string;
    ipUnavailable: string;
    lastSeen: (date: string) => string;
    signOut: string;
    endSession: string;
    communityComplete: string;
    communityIncomplete: string;
    missing: string;
    openCommunity: string;
    myBadges: string;
  };
  courses: {
    filters: Record<"all" | "active" | "completed" | "locked", string>;
    search: string;
    filterLabel: string;
    status: Record<"upcoming" | "expired" | "unavailable" | "completed" | "new" | "inProgress", string>;
    availableAt: (date: string) => string;
    expiredAt: (date: string) => string;
    windowUnavailable: string;
    courseUnavailable: string;
    uncategorized: string;
    progress: string;
    emptyTitle: string;
    emptyDescription: string;
  };
  bookmarks: {
    metadataTitle: string;
    eyebrow: string;
    title: string;
    description: string;
    openCourse: string;
    minutes: (count: number) => string;
    emptyTitle: string;
    emptyDescription: string;
    courses: string;
  };
  media: {
    preview: (label: string) => string;
    currentImage: string;
    noImage: string;
    preparing: string;
    uploading: (progress: number) => string;
    securityCheck: string;
    ready: string;
    formats: string;
    upload: (label: string) => string;
    remove: (label: string) => string;
    invalidFile: string;
    imageRequired: string;
    uploadFailed: string;
    removeFailed: string;
  };
  customFields: {
    affirmative: string;
    select: string;
    emptyTitle: string;
    emptySelf: string;
    emptyAdmin: string;
    openSettings: string;
    title: string;
    selfDescription: string;
    adminDescription: string;
    saving: string;
    save: string;
    communityRequired: string;
    currentMedia: string;
    uploadAndCheck: string;
    ready: string;
    uploadFailed: string;
    viewMedia: string;
    noMedia: string;
    uploadMedia: string;
    removeMedia: string;
  };
  actions: {
    invalidProfile: string;
    invalidAvatar: string;
    avatarOwnership: string;
    profileSaved: string;
    notificationsUnchanged: string;
    notificationsSaved: string;
    passwordManagedByProvider: string;
    passwordMinLength: string;
    passwordLowercase: string;
    passwordUppercase: string;
    passwordNumber: string;
    passwordMismatch: string;
    passwordMustDiffer: string;
    invalidPassword: string;
    currentPasswordIncorrect: string;
    sessionExpired: string;
    passwordChanged: string;
    invalidCustomValue: (label: string, required: boolean) => string;
    invalidProfileMedia: string;
    customFieldsSaved: string;
    invalidSession: string;
    sessionNotFound: string;
    sessionEnded: string;
  };
};

const de: MemberExperienceCopy = {
  profile: {
    communityRequired: "Community-Pflichtfeld", avatarPreview: "Profilbild-Vorschau", personalDetails: "Persoenliche Angaben", saveProfile: "Profil speichern", firstName: "Vorname", lastName: "Nachname", jobTitle: "Position", department: "Abteilung", phone: "Telefonnummer", phonePlaceholder: "+49 170 1234567", avatar: "Profilbild", bio: "Kurzprofil",
    notifications: "Benachrichtigungen", notificationHelp: "Nachrichten im Benachrichtigungscenter bleiben immer aktiv.", saveNotifications: "Einstellungen speichern", deliveryChannels: "Zustellkanaele nach Kategorie", category: "Kategorie", inApp: "In-App", email: "E-Mail", push: "Push",
    notificationCategories: { learning: "Lernen und Kurse", community: "Community", events: "Events", feedback: "Feedback und Abgaben", announcements: "Ankuendigungen" }, channelLabel: (category, channel) => `${category} per ${channel}`,
    password: "Passwort", passwordHelp: "Andere Sitzungen enden nach dem Wechsel.", currentPassword: "Aktuelles Passwort", newPassword: "Neues Passwort", confirmPassword: "Passwort bestaetigen", changePassword: "Passwort aendern",
    companyLogin: "Unternehmens-Login", loginMode: "Anmeldemodus", ssoOnly: "Nur SSO", linkedIdentity: "Verknuepfte Identitaet", noLinkedIdentity: "Keine aktuelle Provider-Verknuepfung", currentSession: "Aktuelle Sitzung", signedInWithSso: "Mit SSO angemeldet", existingSession: "Bestehende Sitzung", confirmedAt: (date) => `Bestaetigt ${date}`, lastProviderLogin: "Letzter Provider-Login",
    activeSessions: "Aktive Sitzungen", signedInDevices: (count) => `${count} angemeldete Geraete`, unknownDevice: "Unbekanntes Geraet", mobile: "Mobil", desktop: "Desktop", browserOnDevice: (browser, device) => `${browser} auf ${device}`, current: "Aktuell", passwordMethod: "Passwort", ipUnavailable: "IP nicht erfasst", lastSeen: (date) => `Zuletzt ${date}`, signOut: "Abmelden", endSession: "Beenden",
    communityComplete: "Community-Profil vollstaendig", communityIncomplete: "Community-Profil vervollstaendigen", missing: "Offen:", openCommunity: "Zur Community", myBadges: "Meine Badges",
  },
  courses: {
    filters: { all: "Alle", active: "Aktiv", completed: "Abgeschlossen", locked: "Gesperrt" }, search: "Kurse durchsuchen", filterLabel: "Kursstatus filtern", status: { upcoming: "Noch nicht verfuegbar", expired: "Abgelaufen", unavailable: "Nicht verfuegbar", completed: "Abgeschlossen", new: "Neu", inProgress: "In Bearbeitung" }, availableAt: (date) => `Verfuegbar ab ${date}`, expiredAt: (date) => `Abgelaufen am ${date}`, windowUnavailable: "Das Freigabefenster ist nicht erreichbar.", courseUnavailable: "Dieser Kurs ist aktuell nicht verfuegbar.", uncategorized: "Ohne Kategorie", progress: "Fortschritt", emptyTitle: "Keine passenden Kurse", emptyDescription: "Passe Suche oder Statusfilter an.",
  },
  bookmarks: { metadataTitle: "Lesezeichen", eyebrow: "Deine Lernsammlung", title: "Lesezeichen", description: "Gemerkte Lektionen bleiben nach Kurs und Modul geordnet.", openCourse: "Kurs oeffnen", minutes: (count) => `${count} Min.`, emptyTitle: "Noch keine Lesezeichen", emptyDescription: "Merke eine Lektion direkt im Kurs, damit du sie hier schnell wiederfindest.", courses: "Zu meinen Kursen" },
  media: { preview: (label) => `${label} Vorschau`, currentImage: "Aktuelles Bild", noImage: "Kein Bild", preparing: "Wird vorbereitet", uploading: (progress) => `Upload ${progress} %`, securityCheck: "Sicherheitspruefung", ready: "Geprueft und bereit", formats: "JPEG, PNG, WebP oder AVIF", upload: (label) => `${label} hochladen`, remove: (label) => `${label} entfernen`, invalidFile: "Dateityp oder Dateigroesse ist ungueltig.", imageRequired: "Als Bild kann nur eine gepruefte Bilddatei verwendet werden.", uploadFailed: "Upload fehlgeschlagen.", removeFailed: "Das Bild konnte nicht entfernt werden." },
  customFields: { affirmative: "Ja, trifft zu", select: "Bitte auswaehlen", emptyTitle: "Keine aktiven Profilfelder", emptySelf: "Deine Academy verwendet derzeit keine zusaetzlichen Profilfelder.", emptyAdmin: "In den Einstellungen koennen Profilfelder fuer alle Mitglieder angelegt werden.", openSettings: "Zu den Profilfeldern", title: "Benutzerdefinierte Profilfelder", selfDescription: "Ergaenze die von deiner Academy benoetigten Angaben.", adminDescription: "Strukturierte Angaben fuer dieses Mitglied.", saving: "Wird gespeichert", save: "Profilfelder speichern", communityRequired: "Community-Pflichtfeld", currentMedia: "Aktuelles Medium", uploadAndCheck: "Upload und Sicherheitspruefung laufen", ready: "Geprueft und bereit", uploadFailed: "Upload fehlgeschlagen", viewMedia: "Profilmedium anzeigen", noMedia: "Kein Medium", uploadMedia: "Profilmedium hochladen", removeMedia: "Profilmedium entfernen" },
  actions: { invalidProfile: "Bitte pruefe deine Profildaten.", invalidAvatar: "Das Profilbild ist ungueltig.", avatarOwnership: "Das Profilbild ist nicht geprueft oder gehoert zu einem anderen Profil.", profileSaved: "Profil gespeichert.", notificationsUnchanged: "Keine Aenderungen an den Benachrichtigungen.", notificationsSaved: "Benachrichtigungen gespeichert.", passwordManagedByProvider: "Das Passwort wird fuer diese Organisation vom Identity Provider verwaltet.", passwordMinLength: "Das neue Passwort muss mindestens 10 Zeichen haben.", passwordLowercase: "Das neue Passwort muss einen Kleinbuchstaben enthalten.", passwordUppercase: "Das neue Passwort muss einen Grossbuchstaben enthalten.", passwordNumber: "Das neue Passwort muss eine Zahl enthalten.", passwordMismatch: "Die Passwortbestaetigung stimmt nicht ueberein.", passwordMustDiffer: "Das neue Passwort muss sich vom bisherigen unterscheiden.", invalidPassword: "Bitte pruefe die Passwortangaben.", currentPasswordIncorrect: "Das aktuelle Passwort ist nicht korrekt.", sessionExpired: "Die Sitzung ist nicht mehr aktiv.", passwordChanged: "Passwort geaendert. Andere Sitzungen wurden beendet.", invalidCustomValue: (label, required) => `Bitte den Wert fuer \"${label}\" pruefen${required ? " (Pflichtfeld)" : ""}.`, invalidProfileMedia: "Das Profilmedium ist nicht geprueft oder gehoert nicht zu deinem Profil.", customFieldsSaved: "Profilfelder gespeichert.", invalidSession: "Ungueltige Sitzung.", sessionNotFound: "Sitzung nicht gefunden.", sessionEnded: "Sitzung beendet." },
};

const en: MemberExperienceCopy = {
  profile: {
    communityRequired: "Required for the community", avatarPreview: "Profile image preview", personalDetails: "Personal details", saveProfile: "Save profile", firstName: "First name", lastName: "Last name", jobTitle: "Job title", department: "Department", phone: "Phone number", phonePlaceholder: "+44 7700 900123", avatar: "Profile image", bio: "Short profile",
    notifications: "Notifications", notificationHelp: "Messages in the notification centre always remain enabled.", saveNotifications: "Save settings", deliveryChannels: "Delivery channels by category", category: "Category", inApp: "In-app", email: "Email", push: "Push",
    notificationCategories: { learning: "Learning and courses", community: "Community", events: "Events", feedback: "Feedback and submissions", announcements: "Announcements" }, channelLabel: (category, channel) => `${category} via ${channel}`,
    password: "Password", passwordHelp: "Other sessions end after the change.", currentPassword: "Current password", newPassword: "New password", confirmPassword: "Confirm password", changePassword: "Change password",
    companyLogin: "Company login", loginMode: "Sign-in mode", ssoOnly: "SSO only", linkedIdentity: "Linked identity", noLinkedIdentity: "No current provider link", currentSession: "Current session", signedInWithSso: "Signed in with SSO", existingSession: "Existing session", confirmedAt: (date) => `Confirmed ${date}`, lastProviderLogin: "Last provider login",
    activeSessions: "Active sessions", signedInDevices: (count) => `${count} signed-in device${count === 1 ? "" : "s"}`, unknownDevice: "Unknown device", mobile: "Mobile", desktop: "Desktop", browserOnDevice: (browser, device) => `${browser} on ${device}`, current: "Current", passwordMethod: "Password", ipUnavailable: "IP not recorded", lastSeen: (date) => `Last seen ${date}`, signOut: "Sign out", endSession: "End session",
    communityComplete: "Community profile complete", communityIncomplete: "Complete your community profile", missing: "Missing:", openCommunity: "Open community", myBadges: "My badges",
  },
  courses: {
    filters: { all: "All", active: "Active", completed: "Completed", locked: "Locked" }, search: "Search courses", filterLabel: "Filter by course status", status: { upcoming: "Not available yet", expired: "Expired", unavailable: "Unavailable", completed: "Completed", new: "New", inProgress: "In progress" }, availableAt: (date) => `Available from ${date}`, expiredAt: (date) => `Expired on ${date}`, windowUnavailable: "The release window cannot be reached.", courseUnavailable: "This course is currently unavailable.", uncategorized: "Uncategorised", progress: "Progress", emptyTitle: "No matching courses", emptyDescription: "Adjust the search or status filter.",
  },
  bookmarks: { metadataTitle: "Bookmarks", eyebrow: "Your learning collection", title: "Bookmarks", description: "Saved lessons remain organised by course and module.", openCourse: "Open course", minutes: (count) => `${count} min`, emptyTitle: "No bookmarks yet", emptyDescription: "Save a lesson inside a course to find it here quickly.", courses: "Go to my courses" },
  media: { preview: (label) => `${label} preview`, currentImage: "Current image", noImage: "No image", preparing: "Preparing", uploading: (progress) => `Uploading ${progress}%`, securityCheck: "Security check", ready: "Checked and ready", formats: "JPEG, PNG, WebP or AVIF", upload: (label) => `Upload ${label}`, remove: (label) => `Remove ${label}`, invalidFile: "The file type or size is invalid.", imageRequired: "Only a verified image file can be used as an image.", uploadFailed: "Upload failed.", removeFailed: "The image could not be removed." },
  customFields: { affirmative: "Yes, this applies", select: "Select an option", emptyTitle: "No active profile fields", emptySelf: "Your academy currently uses no additional profile fields.", emptyAdmin: "Profile fields for all members can be created in settings.", openSettings: "Open profile fields", title: "Custom profile fields", selfDescription: "Add the details required by your academy.", adminDescription: "Structured details for this member.", saving: "Saving", save: "Save profile fields", communityRequired: "Required for the community", currentMedia: "Current media", uploadAndCheck: "Upload and security check in progress", ready: "Checked and ready", uploadFailed: "Upload failed", viewMedia: "View profile media", noMedia: "No media", uploadMedia: "Upload profile media", removeMedia: "Remove profile media" },
  actions: { invalidProfile: "Check your profile details.", invalidAvatar: "The profile image is invalid.", avatarOwnership: "The profile image is not verified or belongs to another profile.", profileSaved: "Profile saved.", notificationsUnchanged: "No notification settings changed.", notificationsSaved: "Notification settings saved.", passwordManagedByProvider: "The identity provider manages the password for this organisation.", passwordMinLength: "The new password must contain at least 10 characters.", passwordLowercase: "The new password must contain a lowercase letter.", passwordUppercase: "The new password must contain an uppercase letter.", passwordNumber: "The new password must contain a number.", passwordMismatch: "The password confirmation does not match.", passwordMustDiffer: "The new password must differ from the current password.", invalidPassword: "Check the password details.", currentPasswordIncorrect: "The current password is incorrect.", sessionExpired: "The session is no longer active.", passwordChanged: "Password changed. Other sessions were ended.", invalidCustomValue: (label, required) => `Check the value for \"${label}\"${required ? " (required)" : ""}.`, invalidProfileMedia: "The profile media is not verified or does not belong to your profile.", customFieldsSaved: "Profile fields saved.", invalidSession: "Invalid session.", sessionNotFound: "Session not found.", sessionEnded: "Session ended." },
};

const it: MemberExperienceCopy = {
  profile: {
    communityRequired: "Obbligatorio per la community", avatarPreview: "Anteprima immagine profilo", personalDetails: "Dati personali", saveProfile: "Salva profilo", firstName: "Nome", lastName: "Cognome", jobTitle: "Ruolo", department: "Reparto", phone: "Numero di telefono", phonePlaceholder: "+39 320 123 4567", avatar: "Immagine profilo", bio: "Profilo breve",
    notifications: "Notifiche", notificationHelp: "I messaggi nel centro notifiche rimangono sempre attivi.", saveNotifications: "Salva impostazioni", deliveryChannels: "Canali di consegna per categoria", category: "Categoria", inApp: "In-app", email: "Email", push: "Push",
    notificationCategories: { learning: "Apprendimento e corsi", community: "Community", events: "Eventi", feedback: "Feedback e consegne", announcements: "Annunci" }, channelLabel: (category, channel) => `${category} tramite ${channel}`,
    password: "Password", passwordHelp: "Le altre sessioni terminano dopo la modifica.", currentPassword: "Password attuale", newPassword: "Nuova password", confirmPassword: "Conferma password", changePassword: "Modifica password",
    companyLogin: "Accesso aziendale", loginMode: "Modalità di accesso", ssoOnly: "Solo SSO", linkedIdentity: "Identità collegata", noLinkedIdentity: "Nessun collegamento provider attuale", currentSession: "Sessione attuale", signedInWithSso: "Accesso tramite SSO", existingSession: "Sessione esistente", confirmedAt: (date) => `Confermata ${date}`, lastProviderLogin: "Ultimo accesso del provider",
    activeSessions: "Sessioni attive", signedInDevices: (count) => `${count} dispositiv${count === 1 ? "o connesso" : "i connessi"}`, unknownDevice: "Dispositivo sconosciuto", mobile: "Mobile", desktop: "Desktop", browserOnDevice: (browser, device) => `${browser} su ${device}`, current: "Attuale", passwordMethod: "Password", ipUnavailable: "IP non registrato", lastSeen: (date) => `Ultima attività ${date}`, signOut: "Esci", endSession: "Termina",
    communityComplete: "Profilo community completo", communityIncomplete: "Completa il profilo community", missing: "Mancano:", openCommunity: "Apri community", myBadges: "I miei badge",
  },
  courses: {
    filters: { all: "Tutti", active: "Attivi", completed: "Completati", locked: "Bloccati" }, search: "Cerca corsi", filterLabel: "Filtra per stato del corso", status: { upcoming: "Non ancora disponibile", expired: "Scaduto", unavailable: "Non disponibile", completed: "Completato", new: "Nuovo", inProgress: "In corso" }, availableAt: (date) => `Disponibile dal ${date}`, expiredAt: (date) => `Scaduto il ${date}`, windowUnavailable: "La finestra di pubblicazione non è raggiungibile.", courseUnavailable: "Questo corso non è al momento disponibile.", uncategorized: "Senza categoria", progress: "Progresso", emptyTitle: "Nessun corso corrispondente", emptyDescription: "Modifica la ricerca o il filtro di stato.",
  },
  bookmarks: { metadataTitle: "Segnalibri", eyebrow: "La tua raccolta didattica", title: "Segnalibri", description: "Le lezioni salvate restano ordinate per corso e modulo.", openCourse: "Apri corso", minutes: (count) => `${count} min`, emptyTitle: "Nessun segnalibro", emptyDescription: "Salva una lezione nel corso per ritrovarla rapidamente qui.", courses: "Vai ai miei corsi" },
  media: { preview: (label) => `Anteprima ${label}`, currentImage: "Immagine attuale", noImage: "Nessuna immagine", preparing: "Preparazione", uploading: (progress) => `Caricamento ${progress}%`, securityCheck: "Controllo di sicurezza", ready: "Verificata e pronta", formats: "JPEG, PNG, WebP o AVIF", upload: (label) => `Carica ${label}`, remove: (label) => `Rimuovi ${label}`, invalidFile: "Il tipo o la dimensione del file non è valido.", imageRequired: "È possibile utilizzare solo un file immagine verificato.", uploadFailed: "Caricamento non riuscito.", removeFailed: "Impossibile rimuovere l'immagine." },
  customFields: { affirmative: "Sì, è applicabile", select: "Seleziona un'opzione", emptyTitle: "Nessun campo profilo attivo", emptySelf: "La tua academy non utilizza attualmente campi profilo aggiuntivi.", emptyAdmin: "Nelle impostazioni puoi creare campi profilo per tutti i membri.", openSettings: "Apri campi profilo", title: "Campi profilo personalizzati", selfDescription: "Aggiungi i dati richiesti dalla tua academy.", adminDescription: "Dati strutturati per questo membro.", saving: "Salvataggio", save: "Salva campi profilo", communityRequired: "Obbligatorio per la community", currentMedia: "Contenuto attuale", uploadAndCheck: "Caricamento e controllo di sicurezza in corso", ready: "Verificato e pronto", uploadFailed: "Caricamento non riuscito", viewMedia: "Visualizza contenuto del profilo", noMedia: "Nessun contenuto", uploadMedia: "Carica contenuto del profilo", removeMedia: "Rimuovi contenuto del profilo" },
  actions: { invalidProfile: "Controlla i dati del profilo.", invalidAvatar: "L'immagine profilo non è valida.", avatarOwnership: "L'immagine profilo non è verificata o appartiene a un altro profilo.", profileSaved: "Profilo salvato.", notificationsUnchanged: "Nessuna impostazione di notifica modificata.", notificationsSaved: "Impostazioni di notifica salvate.", passwordManagedByProvider: "La password di questa organizzazione è gestita dall'Identity Provider.", passwordMinLength: "La nuova password deve contenere almeno 10 caratteri.", passwordLowercase: "La nuova password deve contenere una lettera minuscola.", passwordUppercase: "La nuova password deve contenere una lettera maiuscola.", passwordNumber: "La nuova password deve contenere un numero.", passwordMismatch: "La conferma della password non corrisponde.", passwordMustDiffer: "La nuova password deve essere diversa da quella attuale.", invalidPassword: "Controlla i dati della password.", currentPasswordIncorrect: "La password attuale non è corretta.", sessionExpired: "La sessione non è più attiva.", passwordChanged: "Password modificata. Le altre sessioni sono terminate.", invalidCustomValue: (label, required) => `Controlla il valore di \"${label}\"${required ? " (obbligatorio)" : ""}.`, invalidProfileMedia: "Il contenuto del profilo non è verificato o non appartiene al tuo profilo.", customFieldsSaved: "Campi del profilo salvati.", invalidSession: "Sessione non valida.", sessionNotFound: "Sessione non trovata.", sessionEnded: "Sessione terminata." },
};

const es: MemberExperienceCopy = {
  profile: {
    communityRequired: "Obligatorio para la comunidad", avatarPreview: "Vista previa de la imagen de perfil", personalDetails: "Datos personales", saveProfile: "Guardar perfil", firstName: "Nombre", lastName: "Apellidos", jobTitle: "Puesto", department: "Departamento", phone: "Número de teléfono", phonePlaceholder: "+34 612 34 56 78", avatar: "Imagen de perfil", bio: "Perfil breve",
    notifications: "Notificaciones", notificationHelp: "Los mensajes del centro de notificaciones permanecen siempre activos.", saveNotifications: "Guardar ajustes", deliveryChannels: "Canales de entrega por categoría", category: "Categoría", inApp: "En la aplicación", email: "Correo", push: "Push",
    notificationCategories: { learning: "Aprendizaje y cursos", community: "Comunidad", events: "Eventos", feedback: "Comentarios y entregas", announcements: "Anuncios" }, channelLabel: (category, channel) => `${category} por ${channel}`,
    password: "Contraseña", passwordHelp: "Las demás sesiones terminan después del cambio.", currentPassword: "Contraseña actual", newPassword: "Nueva contraseña", confirmPassword: "Confirmar contraseña", changePassword: "Cambiar contraseña",
    companyLogin: "Acceso de empresa", loginMode: "Modo de acceso", ssoOnly: "Solo SSO", linkedIdentity: "Identidad vinculada", noLinkedIdentity: "No hay vínculo actual con el proveedor", currentSession: "Sesión actual", signedInWithSso: "Sesión iniciada con SSO", existingSession: "Sesión existente", confirmedAt: (date) => `Confirmada ${date}`, lastProviderLogin: "Último acceso del proveedor",
    activeSessions: "Sesiones activas", signedInDevices: (count) => `${count} dispositivo${count === 1 ? " conectado" : "s conectados"}`, unknownDevice: "Dispositivo desconocido", mobile: "Móvil", desktop: "Escritorio", browserOnDevice: (browser, device) => `${browser} en ${device}`, current: "Actual", passwordMethod: "Contraseña", ipUnavailable: "IP no registrada", lastSeen: (date) => `Última actividad ${date}`, signOut: "Cerrar sesión", endSession: "Finalizar",
    communityComplete: "Perfil de comunidad completo", communityIncomplete: "Completa el perfil de comunidad", missing: "Falta:", openCommunity: "Abrir comunidad", myBadges: "Mis insignias",
  },
  courses: {
    filters: { all: "Todos", active: "Activos", completed: "Completados", locked: "Bloqueados" }, search: "Buscar cursos", filterLabel: "Filtrar por estado del curso", status: { upcoming: "Aún no disponible", expired: "Caducado", unavailable: "No disponible", completed: "Completado", new: "Nuevo", inProgress: "En curso" }, availableAt: (date) => `Disponible desde ${date}`, expiredAt: (date) => `Caducó el ${date}`, windowUnavailable: "No se puede acceder a la ventana de publicación.", courseUnavailable: "Este curso no está disponible actualmente.", uncategorized: "Sin categoría", progress: "Progreso", emptyTitle: "No hay cursos coincidentes", emptyDescription: "Ajusta la búsqueda o el filtro de estado.",
  },
  bookmarks: { metadataTitle: "Marcadores", eyebrow: "Tu colección de aprendizaje", title: "Marcadores", description: "Las lecciones guardadas se mantienen ordenadas por curso y módulo.", openCourse: "Abrir curso", minutes: (count) => `${count} min`, emptyTitle: "Aún no hay marcadores", emptyDescription: "Guarda una lección dentro del curso para encontrarla aquí rápidamente.", courses: "Ir a mis cursos" },
  media: { preview: (label) => `Vista previa de ${label}`, currentImage: "Imagen actual", noImage: "Sin imagen", preparing: "Preparando", uploading: (progress) => `Subiendo ${progress}%`, securityCheck: "Comprobación de seguridad", ready: "Verificada y lista", formats: "JPEG, PNG, WebP o AVIF", upload: (label) => `Subir ${label}`, remove: (label) => `Eliminar ${label}`, invalidFile: "El tipo o tamaño del archivo no es válido.", imageRequired: "Solo se puede usar un archivo de imagen verificado.", uploadFailed: "Error al subir el archivo.", removeFailed: "No se pudo eliminar la imagen." },
  customFields: { affirmative: "Sí, se aplica", select: "Selecciona una opción", emptyTitle: "No hay campos de perfil activos", emptySelf: "Tu academy no utiliza actualmente campos de perfil adicionales.", emptyAdmin: "En los ajustes puedes crear campos de perfil para todos los miembros.", openSettings: "Abrir campos de perfil", title: "Campos de perfil personalizados", selfDescription: "Añade los datos que requiere tu academy.", adminDescription: "Datos estructurados de este miembro.", saving: "Guardando", save: "Guardar campos de perfil", communityRequired: "Obligatorio para la comunidad", currentMedia: "Contenido actual", uploadAndCheck: "Subida y comprobación de seguridad en curso", ready: "Verificado y listo", uploadFailed: "Error al subir el archivo", viewMedia: "Ver contenido del perfil", noMedia: "Sin contenido", uploadMedia: "Subir contenido del perfil", removeMedia: "Eliminar contenido del perfil" },
  actions: { invalidProfile: "Comprueba los datos del perfil.", invalidAvatar: "La imagen de perfil no es válida.", avatarOwnership: "La imagen de perfil no está verificada o pertenece a otro perfil.", profileSaved: "Perfil guardado.", notificationsUnchanged: "No se modificaron los ajustes de notificación.", notificationsSaved: "Ajustes de notificación guardados.", passwordManagedByProvider: "El proveedor de identidad gestiona la contraseña de esta organización.", passwordMinLength: "La nueva contraseña debe tener al menos 10 caracteres.", passwordLowercase: "La nueva contraseña debe contener una letra minúscula.", passwordUppercase: "La nueva contraseña debe contener una letra mayúscula.", passwordNumber: "La nueva contraseña debe contener un número.", passwordMismatch: "La confirmación de contraseña no coincide.", passwordMustDiffer: "La nueva contraseña debe ser distinta de la actual.", invalidPassword: "Comprueba los datos de la contraseña.", currentPasswordIncorrect: "La contraseña actual no es correcta.", sessionExpired: "La sesión ya no está activa.", passwordChanged: "Contraseña cambiada. Las demás sesiones finalizaron.", invalidCustomValue: (label, required) => `Comprueba el valor de \"${label}\"${required ? " (obligatorio)" : ""}.`, invalidProfileMedia: "El contenido del perfil no está verificado o no pertenece a tu perfil.", customFieldsSaved: "Campos del perfil guardados.", invalidSession: "Sesión no válida.", sessionNotFound: "Sesión no encontrada.", sessionEnded: "Sesión finalizada." },
};

const fr: MemberExperienceCopy = {
  profile: {
    communityRequired: "Obligatoire pour la communauté", avatarPreview: "Aperçu de l'image de profil", personalDetails: "Informations personnelles", saveProfile: "Enregistrer le profil", firstName: "Prénom", lastName: "Nom", jobTitle: "Poste", department: "Service", phone: "Numéro de téléphone", phonePlaceholder: "+33 6 12 34 56 78", avatar: "Image de profil", bio: "Profil court",
    notifications: "Notifications", notificationHelp: "Les messages du centre de notifications restent toujours actifs.", saveNotifications: "Enregistrer les paramètres", deliveryChannels: "Canaux de diffusion par catégorie", category: "Catégorie", inApp: "Dans l'application", email: "E-mail", push: "Push",
    notificationCategories: { learning: "Apprentissage et cours", community: "Communauté", events: "Événements", feedback: "Retours et travaux", announcements: "Annonces" }, channelLabel: (category, channel) => `${category} par ${channel}`,
    password: "Mot de passe", passwordHelp: "Les autres sessions prennent fin après la modification.", currentPassword: "Mot de passe actuel", newPassword: "Nouveau mot de passe", confirmPassword: "Confirmer le mot de passe", changePassword: "Modifier le mot de passe",
    companyLogin: "Connexion d'entreprise", loginMode: "Mode de connexion", ssoOnly: "SSO uniquement", linkedIdentity: "Identité liée", noLinkedIdentity: "Aucun lien actuel avec le fournisseur", currentSession: "Session actuelle", signedInWithSso: "Connecté avec SSO", existingSession: "Session existante", confirmedAt: (date) => `Confirmée ${date}`, lastProviderLogin: "Dernière connexion du fournisseur",
    activeSessions: "Sessions actives", signedInDevices: (count) => `${count} appareil${count === 1 ? " connecté" : "s connectés"}`, unknownDevice: "Appareil inconnu", mobile: "Mobile", desktop: "Ordinateur", browserOnDevice: (browser, device) => `${browser} sur ${device}`, current: "Actuelle", passwordMethod: "Mot de passe", ipUnavailable: "IP non enregistrée", lastSeen: (date) => `Dernière activité ${date}`, signOut: "Se déconnecter", endSession: "Terminer",
    communityComplete: "Profil communautaire complet", communityIncomplete: "Complétez le profil communautaire", missing: "Manquant :", openCommunity: "Ouvrir la communauté", myBadges: "Mes badges",
  },
  courses: {
    filters: { all: "Tous", active: "Actifs", completed: "Terminés", locked: "Verrouillés" }, search: "Rechercher des cours", filterLabel: "Filtrer par statut du cours", status: { upcoming: "Pas encore disponible", expired: "Expiré", unavailable: "Indisponible", completed: "Terminé", new: "Nouveau", inProgress: "En cours" }, availableAt: (date) => `Disponible à partir du ${date}`, expiredAt: (date) => `Expiré le ${date}`, windowUnavailable: "La fenêtre de publication est inaccessible.", courseUnavailable: "Ce cours est actuellement indisponible.", uncategorized: "Sans catégorie", progress: "Progression", emptyTitle: "Aucun cours correspondant", emptyDescription: "Modifiez la recherche ou le filtre de statut.",
  },
  bookmarks: { metadataTitle: "Favoris", eyebrow: "Votre collection d'apprentissage", title: "Favoris", description: "Les leçons enregistrées restent classées par cours et module.", openCourse: "Ouvrir le cours", minutes: (count) => `${count} min`, emptyTitle: "Aucun favori", emptyDescription: "Enregistrez une leçon dans un cours pour la retrouver rapidement ici.", courses: "Accéder à mes cours" },
  media: { preview: (label) => `Aperçu de ${label}`, currentImage: "Image actuelle", noImage: "Aucune image", preparing: "Préparation", uploading: (progress) => `Téléversement ${progress} %`, securityCheck: "Contrôle de sécurité", ready: "Vérifiée et prête", formats: "JPEG, PNG, WebP ou AVIF", upload: (label) => `Téléverser ${label}`, remove: (label) => `Supprimer ${label}`, invalidFile: "Le type ou la taille du fichier est invalide.", imageRequired: "Seul un fichier image vérifié peut être utilisé.", uploadFailed: "Échec du téléversement.", removeFailed: "Impossible de supprimer l'image." },
  customFields: { affirmative: "Oui, cela s'applique", select: "Sélectionnez une option", emptyTitle: "Aucun champ de profil actif", emptySelf: "Votre academy n'utilise actuellement aucun champ de profil supplémentaire.", emptyAdmin: "Les paramètres permettent de créer des champs de profil pour tous les membres.", openSettings: "Ouvrir les champs de profil", title: "Champs de profil personnalisés", selfDescription: "Ajoutez les informations requises par votre academy.", adminDescription: "Informations structurées pour ce membre.", saving: "Enregistrement", save: "Enregistrer les champs du profil", communityRequired: "Obligatoire pour la communauté", currentMedia: "Média actuel", uploadAndCheck: "Téléversement et contrôle de sécurité en cours", ready: "Vérifié et prêt", uploadFailed: "Échec du téléversement", viewMedia: "Afficher le média du profil", noMedia: "Aucun média", uploadMedia: "Téléverser un média de profil", removeMedia: "Supprimer le média du profil" },
  actions: { invalidProfile: "Vérifiez les informations du profil.", invalidAvatar: "L'image de profil est invalide.", avatarOwnership: "L'image de profil n'est pas vérifiée ou appartient à un autre profil.", profileSaved: "Profil enregistré.", notificationsUnchanged: "Aucun paramètre de notification n'a changé.", notificationsSaved: "Paramètres de notification enregistrés.", passwordManagedByProvider: "Le fournisseur d'identité gère le mot de passe de cette organisation.", passwordMinLength: "Le nouveau mot de passe doit contenir au moins 10 caractères.", passwordLowercase: "Le nouveau mot de passe doit contenir une lettre minuscule.", passwordUppercase: "Le nouveau mot de passe doit contenir une lettre majuscule.", passwordNumber: "Le nouveau mot de passe doit contenir un chiffre.", passwordMismatch: "La confirmation du mot de passe ne correspond pas.", passwordMustDiffer: "Le nouveau mot de passe doit être différent de l'actuel.", invalidPassword: "Vérifiez les informations du mot de passe.", currentPasswordIncorrect: "Le mot de passe actuel est incorrect.", sessionExpired: "La session n'est plus active.", passwordChanged: "Mot de passe modifié. Les autres sessions ont été fermées.", invalidCustomValue: (label, required) => `Vérifiez la valeur de \"${label}\"${required ? " (obligatoire)" : ""}.`, invalidProfileMedia: "Le média du profil n'est pas vérifié ou n'appartient pas à votre profil.", customFieldsSaved: "Champs du profil enregistrés.", invalidSession: "Session invalide.", sessionNotFound: "Session introuvable.", sessionEnded: "Session terminée." },
};

const dictionaries: Record<AppLocale, MemberExperienceCopy> = { de, en, it, es, fr };

export function getMemberExperienceCopy(locale: AppLocale): MemberExperienceCopy {
  return dictionaries[locale] ?? de;
}
