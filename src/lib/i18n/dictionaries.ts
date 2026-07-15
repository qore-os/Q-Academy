import type { AppLocale } from "@/lib/i18n/model";

type BaseCoreDictionary = {
  navigation: {
    groups: Record<"home" | "content" | "members" | "experience" | "ai" | "system" | "learning" | "exchange", string>;
    items: Record<"overview" | "courses" | "modules" | "tasks" | "members" | "groups" | "bundles" | "certificates" | "community" | "hubs" | "events" | "announcements" | "email" | "agents" | "analytics" | "privacy" | "integrations" | "api" | "settings" | "memberArea" | "dashboard" | "myCourses" | "bookmarks" | "aiTools" | "coach", string>;
    help: { adminTitle: string; adminBody: string; memberTitle: string; memberBody: string };
    open: string;
    close: string;
    mobile: string;
    adminArea: string;
    memberArea: string;
    profile: string;
    logout: string;
    roles: Record<"owner" | "admin" | "trainer" | "member", string>;
  };
  auth: {
    signIn: string;
    email: string;
    password: string;
    forgot: string;
    showPassword: string;
    hidePassword: string;
    signingIn: string;
    signInAt: (platformName: string) => string;
    corporateLogin: string;
    orPassword: string;
    demoMember: string;
    demoAdmin: string;
    demoPassword: string;
    learningEnvironment: string;
    imprint: string;
    support: string;
    heroEyebrow: string;
    heroTitle: string;
    heroImageAlt: string;
    heroCourses: string;
    heroCoursesBody: string;
    heroCoachBody: string;
    heroSecurity: string;
    heroSecurityBody: string;
    genericCredentialError: string;
    rateLimited: string;
    oidcErrors: Record<string, string>;
    mfaExpired: string;
  };
  mfa: {
    enrollTitle: string;
    verifyTitle: string;
    enrollIntro: string;
    verifyIntro: string;
    confirmCode: string;
    code: string;
    manualKey: string;
    qrAlt: string;
    activating: string;
    activate: string;
    verifying: string;
    finish: string;
    requestFailed: string;
    connectionFailed: string;
    missingRecovery: string;
    enabled: string;
    verified: string;
    saveRecovery: string;
    recoveryOnlyOnce: string;
    copied: string;
    copy: string;
    acknowledge: string;
    continue: string;
  };
  language: {
    profileLabel: string;
    profileHelp: string;
    inherit: string;
    organizationTitle: string;
    organizationHelp: string;
    organizationLabel: string;
    save: string;
    saving: string;
    profileSaved: string;
    organizationSaved: string;
    invalidLocale: string;
    profileUnavailable: string;
    organizationUnavailable: string;
  };
};

const de: BaseCoreDictionary = {
  navigation: {
    groups: { home: "Home", content: "Inhalts-Management", members: "Mitglieder-Management", experience: "Erlebnis", ai: "KI & Auswertung", system: "System", learning: "Lernen", exchange: "Austausch" },
    items: { overview: "Uebersicht", courses: "Kurse", modules: "Module", tasks: "Aufgaben-Center", members: "Mitglieder", groups: "Gruppen", bundles: "Bundles", certificates: "Zertifikate", community: "Community", hubs: "Hubs", events: "Event-Plan", announcements: "Ankuendigungen", email: "E-Mail-Center", agents: "KI-Agenten", analytics: "Statistiken", privacy: "Datenschutz", integrations: "Integrationen", api: "API & Webhooks", settings: "Einstellungen", memberArea: "Mitgliederbereich", dashboard: "Dashboard", myCourses: "Meine Kurse", bookmarks: "Lesezeichen", aiTools: "AI Tool Center", coach: "Q-Coach" },
    help: { adminTitle: "Aufgaben im Blick", adminBody: "Pruefungen und Feedback", memberTitle: "Brauchst du Hilfe?", memberBody: "Q-Coach fragen" },
    open: "Navigation oeffnen", close: "Navigation schliessen", mobile: "Mobile Hauptnavigation", adminArea: "Admin-Bereich", memberArea: "Mitgliederbereich", profile: "Mein Profil", logout: "Abmelden",
    roles: { owner: "Inhaber", admin: "Administrator", trainer: "Trainer", member: "Mitglied" },
  },
  auth: {
    signIn: "Anmelden", email: "E-Mail-Adresse", password: "Passwort", forgot: "Vergessen?", showPassword: "Passwort anzeigen", hidePassword: "Passwort verbergen", signingIn: "Anmeldung laeuft", signInAt: (name) => `Bei ${name} anmelden`, corporateLogin: "Unternehmens-Login", orPassword: "Oder mit Passwort", demoMember: "Als Mitglied testen", demoAdmin: "Als Admin testen", demoPassword: "Demo-Passwort fuer beide Rollen:", learningEnvironment: "Lernumgebung", imprint: "Impressum", support: "Support", heroEyebrow: "Dein Lernsystem", heroTitle: "Von der ersten Idee zum verantwortungsvollen KI-Workflow.", heroImageAlt: "Modulares KI-Workflow-System", heroCourses: "Praxisnahe Kurse", heroCoursesBody: "Lernpfade mit direktem Transfer", heroCoachBody: "Hilfe im richtigen Moment", heroSecurity: "Sicher anwenden", heroSecurityBody: "Leitplanken und Governance", genericCredentialError: "E-Mail-Adresse oder Passwort ist nicht korrekt.", rateLimited: "Zu viele Anmeldeversuche. Bitte versuche es spaeter erneut.", oidcErrors: { denied: "Die Anmeldung beim Identity Provider wurde abgebrochen.", expired: "Die Anmeldeanfrage ist abgelaufen. Bitte starte sie erneut.", changed: "Die Login-Konfiguration wurde geaendert. Bitte starte die Anmeldung erneut.", rate_limited: "Zu viele Anmeldeversuche. Bitte versuche es spaeter erneut.", account: "Fuer diesen Unternehmens-Login ist kein aktives Konto verfuegbar.", failed: "Der Unternehmens-Login konnte nicht sicher abgeschlossen werden.", unavailable: "Der Unternehmens-Login ist derzeit nicht verfuegbar." }, mfaExpired: "Die MFA-Anfrage ist abgelaufen. Bitte melde dich erneut an.",
  },
  mfa: { enrollTitle: "MFA jetzt einrichten", verifyTitle: "Anmeldung bestaetigen", enrollIntro: "Scanne den QR-Code mit deiner Authenticator-App und bestaetige die Einrichtung mit dem angezeigten sechsstelligen Code.", verifyIntro: "Gib den Code aus deiner Authenticator-App oder einen noch nicht verwendeten Recovery-Code ein.", confirmCode: "Bestaetigungscode", code: "MFA- oder Recovery-Code", manualKey: "Manueller Schluessel", qrAlt: "QR-Code fuer die Authenticator-App", activating: "Code wird geprueft", activate: "MFA aktivieren", verifying: "Code wird geprueft", finish: "Anmeldung abschliessen", requestFailed: "Die MFA-Anfrage konnte nicht abgeschlossen werden. Bitte versuche es erneut.", connectionFailed: "Die MFA-Anfrage konnte nicht abgeschlossen werden. Bitte pruefe deine Verbindung und versuche es erneut.", missingRecovery: "Die Recovery-Codes konnten nicht angezeigt werden. Bitte lade die Seite nicht neu und wende dich an den Support.", enabled: "MFA ist aktiv. Bewahre die Recovery-Codes sicher auf.", verified: "MFA wurde bestaetigt.", saveRecovery: "Recovery-Codes speichern", recoveryOnlyOnce: "Diese Codes werden nur jetzt angezeigt. Jeder Code funktioniert genau einmal.", copied: "Kopiert", copy: "Codes kopieren", acknowledge: "Ich habe die Recovery-Codes an einem sicheren Ort gespeichert.", continue: "Weiter" },
  language: { profileLabel: "Sprache", profileHelp: "Bestimmt Navigation, Anmeldung, Sicherheitsdialoge und System-E-Mails.", inherit: "Organisationsstandard verwenden", organizationTitle: "Sprache & Lokalisierung", organizationHelp: "Diese Sprache gilt fuer Konten ohne eigene Praeferenz und fuer neue Einladungen.", organizationLabel: "Organisationsstandard", save: "Sprache speichern", saving: "Wird gespeichert", profileSaved: "Sprache gespeichert.", organizationSaved: "Organisationssprache gespeichert.", invalidLocale: "Bitte waehle eine unterstuetzte Sprache.", profileUnavailable: "Das aktive Profil wurde nicht gefunden.", organizationUnavailable: "Die aktive Organisation wurde nicht gefunden." },
};

const en: BaseCoreDictionary = {
  navigation: {
    groups: { home: "Home", content: "Content management", members: "Member management", experience: "Experience", ai: "AI & analytics", system: "System", learning: "Learning", exchange: "Community" },
    items: { overview: "Overview", courses: "Courses", modules: "Modules", tasks: "Task centre", members: "Members", groups: "Groups", bundles: "Bundles", certificates: "Certificates", community: "Community", hubs: "Hubs", events: "Events", announcements: "Announcements", email: "Email centre", agents: "AI agents", analytics: "Analytics", privacy: "Privacy", integrations: "Integrations", api: "API & webhooks", settings: "Settings", memberArea: "Member area", dashboard: "Dashboard", myCourses: "My courses", bookmarks: "Bookmarks", aiTools: "AI Tool Centre", coach: "Q-Coach" },
    help: { adminTitle: "Tasks at a glance", adminBody: "Reviews and feedback", memberTitle: "Need help?", memberBody: "Ask Q-Coach" },
    open: "Open navigation", close: "Close navigation", mobile: "Mobile main navigation", adminArea: "Admin area", memberArea: "Member area", profile: "My profile", logout: "Sign out",
    roles: { owner: "Owner", admin: "Administrator", trainer: "Trainer", member: "Member" },
  },
  auth: {
    signIn: "Sign in", email: "Email address", password: "Password", forgot: "Forgot?", showPassword: "Show password", hidePassword: "Hide password", signingIn: "Signing in", signInAt: (name) => `Sign in to ${name}`, corporateLogin: "Company sign-in", orPassword: "Or use your password", demoMember: "Try as member", demoAdmin: "Try as admin", demoPassword: "Demo password for both roles:", learningEnvironment: "Learning environment", imprint: "Legal notice", support: "Support", heroEyebrow: "Your learning system", heroTitle: "From the first idea to a responsible AI workflow.", heroImageAlt: "Modular AI workflow system", heroCourses: "Practical courses", heroCoursesBody: "Learning paths for direct application", heroCoachBody: "Help at the right moment", heroSecurity: "Apply AI safely", heroSecurityBody: "Guardrails and governance", genericCredentialError: "The email address or password is incorrect.", rateLimited: "Too many sign-in attempts. Please try again later.", oidcErrors: { denied: "Sign-in with the identity provider was cancelled.", expired: "The sign-in request expired. Please start again.", changed: "The sign-in configuration changed. Please start again.", rate_limited: "Too many sign-in attempts. Please try again later.", account: "No active account is available for this company sign-in.", failed: "The company sign-in could not be completed securely.", unavailable: "Company sign-in is currently unavailable." }, mfaExpired: "The MFA request expired. Please sign in again.",
  },
  mfa: { enrollTitle: "Set up MFA now", verifyTitle: "Confirm sign-in", enrollIntro: "Scan the QR code with your authenticator app and confirm setup with the six-digit code shown.", verifyIntro: "Enter a code from your authenticator app or an unused recovery code.", confirmCode: "Confirmation code", code: "MFA or recovery code", manualKey: "Manual key", qrAlt: "QR code for the authenticator app", activating: "Checking code", activate: "Enable MFA", verifying: "Checking code", finish: "Complete sign-in", requestFailed: "The MFA request could not be completed. Please try again.", connectionFailed: "The MFA request could not be completed. Check your connection and try again.", missingRecovery: "Recovery codes could not be displayed. Do not reload this page and contact support.", enabled: "MFA is active. Store the recovery codes securely.", verified: "MFA was confirmed.", saveRecovery: "Save recovery codes", recoveryOnlyOnce: "These codes are shown only once. Each code works exactly once.", copied: "Copied", copy: "Copy codes", acknowledge: "I stored the recovery codes in a secure place.", continue: "Continue" },
  language: { profileLabel: "Language", profileHelp: "Controls navigation, sign-in, security dialogs and system emails.", inherit: "Use organisation default", organizationTitle: "Language & localisation", organizationHelp: "This language applies to accounts without a preference and to new invitations.", organizationLabel: "Organisation default", save: "Save language", saving: "Saving", profileSaved: "Language saved.", organizationSaved: "Organisation language saved.", invalidLocale: "Select a supported language.", profileUnavailable: "The active profile could not be found.", organizationUnavailable: "The active organisation could not be found." },
};

const it: BaseCoreDictionary = {
  navigation: {
    groups: { home: "Home", content: "Gestione contenuti", members: "Gestione membri", experience: "Esperienza", ai: "IA e analisi", system: "Sistema", learning: "Apprendimento", exchange: "Scambio" },
    items: { overview: "Panoramica", courses: "Corsi", modules: "Moduli", tasks: "Centro attività", members: "Membri", groups: "Gruppi", bundles: "Pacchetti", certificates: "Certificati", community: "Community", hubs: "Hub", events: "Eventi", announcements: "Annunci", email: "Centro email", agents: "Agenti IA", analytics: "Statistiche", privacy: "Privacy", integrations: "Integrazioni", api: "API e webhook", settings: "Impostazioni", memberArea: "Area membri", dashboard: "Dashboard", myCourses: "I miei corsi", bookmarks: "Segnalibri", aiTools: "Centro strumenti IA", coach: "Q-Coach" },
    help: { adminTitle: "Attività sotto controllo", adminBody: "Verifiche e feedback", memberTitle: "Serve aiuto?", memberBody: "Chiedi a Q-Coach" },
    open: "Apri navigazione", close: "Chiudi navigazione", mobile: "Navigazione principale mobile", adminArea: "Area amministrativa", memberArea: "Area membri", profile: "Il mio profilo", logout: "Esci",
    roles: { owner: "Proprietario", admin: "Amministratore", trainer: "Formatore", member: "Membro" },
  },
  auth: {
    signIn: "Accedi", email: "Indirizzo email", password: "Password", forgot: "Dimenticata?", showPassword: "Mostra password", hidePassword: "Nascondi password", signingIn: "Accesso in corso", signInAt: (name) => `Accedi a ${name}`, corporateLogin: "Accesso aziendale", orPassword: "Oppure usa la password", demoMember: "Prova come membro", demoAdmin: "Prova come admin", demoPassword: "Password demo per entrambi i ruoli:", learningEnvironment: "Ambiente di apprendimento", imprint: "Note legali", support: "Supporto", heroEyebrow: "Il tuo sistema di apprendimento", heroTitle: "Dalla prima idea a un flusso IA responsabile.", heroImageAlt: "Sistema modulare di flussi di lavoro IA", heroCourses: "Corsi pratici", heroCoursesBody: "Percorsi formativi applicabili subito", heroCoachBody: "Aiuto al momento giusto", heroSecurity: "Uso sicuro", heroSecurityBody: "Linee guida e governance", genericCredentialError: "L'indirizzo email o la password non sono corretti.", rateLimited: "Troppi tentativi di accesso. Riprova più tardi.", oidcErrors: { denied: "L'accesso tramite provider di identità è stato annullato.", expired: "La richiesta di accesso è scaduta. Riprova.", changed: "La configurazione di accesso è cambiata. Riprova.", rate_limited: "Troppi tentativi di accesso. Riprova più tardi.", account: "Non è disponibile un account attivo per questo accesso aziendale.", failed: "Non è stato possibile completare l'accesso aziendale in modo sicuro.", unavailable: "L'accesso aziendale non è attualmente disponibile." }, mfaExpired: "La richiesta MFA è scaduta. Accedi di nuovo.",
  },
  mfa: { enrollTitle: "Configura ora l'MFA", verifyTitle: "Conferma l'accesso", enrollIntro: "Scansiona il codice QR con l'app di autenticazione e conferma con il codice a sei cifre.", verifyIntro: "Inserisci un codice dell'app di autenticazione o un codice di recupero non utilizzato.", confirmCode: "Codice di conferma", code: "Codice MFA o di recupero", manualKey: "Chiave manuale", qrAlt: "Codice QR per l'app di autenticazione", activating: "Verifica del codice", activate: "Attiva MFA", verifying: "Verifica del codice", finish: "Completa l'accesso", requestFailed: "Non è stato possibile completare la richiesta MFA. Riprova.", connectionFailed: "Non è stato possibile completare la richiesta MFA. Controlla la connessione e riprova.", missingRecovery: "Non è stato possibile mostrare i codici di recupero. Non ricaricare la pagina e contatta il supporto.", enabled: "L'MFA è attiva. Conserva i codici di recupero in modo sicuro.", verified: "MFA confermata.", saveRecovery: "Salva i codici di recupero", recoveryOnlyOnce: "Questi codici vengono mostrati una sola volta. Ogni codice funziona una sola volta.", copied: "Copiati", copy: "Copia codici", acknowledge: "Ho salvato i codici di recupero in un luogo sicuro.", continue: "Continua" },
  language: { profileLabel: "Lingua", profileHelp: "Determina navigazione, accesso, dialoghi di sicurezza ed email di sistema.", inherit: "Usa la lingua dell'organizzazione", organizationTitle: "Lingua e localizzazione", organizationHelp: "Questa lingua si applica agli account senza preferenza e ai nuovi inviti.", organizationLabel: "Lingua dell'organizzazione", save: "Salva lingua", saving: "Salvataggio", profileSaved: "Lingua salvata.", organizationSaved: "Lingua dell'organizzazione salvata.", invalidLocale: "Seleziona una lingua supportata.", profileUnavailable: "Il profilo attivo non è stato trovato.", organizationUnavailable: "L'organizzazione attiva non è stata trovata." },
};

const es: BaseCoreDictionary = {
  navigation: {
    groups: { home: "Inicio", content: "Gestión de contenidos", members: "Gestión de miembros", experience: "Experiencia", ai: "IA y análisis", system: "Sistema", learning: "Aprendizaje", exchange: "Intercambio" },
    items: { overview: "Resumen", courses: "Cursos", modules: "Módulos", tasks: "Centro de tareas", members: "Miembros", groups: "Grupos", bundles: "Paquetes", certificates: "Certificados", community: "Comunidad", hubs: "Hubs", events: "Eventos", announcements: "Anuncios", email: "Centro de correo", agents: "Agentes de IA", analytics: "Estadísticas", privacy: "Privacidad", integrations: "Integraciones", api: "API y webhooks", settings: "Ajustes", memberArea: "Área de miembros", dashboard: "Panel", myCourses: "Mis cursos", bookmarks: "Marcadores", aiTools: "Centro de herramientas IA", coach: "Q-Coach" },
    help: { adminTitle: "Tareas bajo control", adminBody: "Revisiones y comentarios", memberTitle: "¿Necesitas ayuda?", memberBody: "Pregunta a Q-Coach" },
    open: "Abrir navegación", close: "Cerrar navegación", mobile: "Navegación principal móvil", adminArea: "Área de administración", memberArea: "Área de miembros", profile: "Mi perfil", logout: "Cerrar sesión",
    roles: { owner: "Propietario", admin: "Administrador", trainer: "Formador", member: "Miembro" },
  },
  auth: {
    signIn: "Iniciar sesión", email: "Correo electrónico", password: "Contraseña", forgot: "¿La olvidaste?", showPassword: "Mostrar contraseña", hidePassword: "Ocultar contraseña", signingIn: "Iniciando sesión", signInAt: (name) => `Entrar en ${name}`, corporateLogin: "Acceso corporativo", orPassword: "O usa tu contraseña", demoMember: "Probar como miembro", demoAdmin: "Probar como admin", demoPassword: "Contraseña demo para ambos roles:", learningEnvironment: "Entorno de aprendizaje", imprint: "Aviso legal", support: "Soporte", heroEyebrow: "Tu sistema de aprendizaje", heroTitle: "De la primera idea a un flujo de IA responsable.", heroImageAlt: "Sistema modular de flujos de trabajo de IA", heroCourses: "Cursos prácticos", heroCoursesBody: "Rutas de aprendizaje de aplicación directa", heroCoachBody: "Ayuda en el momento adecuado", heroSecurity: "Uso seguro", heroSecurityBody: "Directrices y gobernanza", genericCredentialError: "El correo electrónico o la contraseña no son correctos.", rateLimited: "Demasiados intentos de acceso. Inténtalo más tarde.", oidcErrors: { denied: "Se canceló el acceso con el proveedor de identidad.", expired: "La solicitud de acceso ha caducado. Vuelve a intentarlo.", changed: "La configuración de acceso ha cambiado. Vuelve a intentarlo.", rate_limited: "Demasiados intentos de acceso. Inténtalo más tarde.", account: "No hay una cuenta activa disponible para este acceso corporativo.", failed: "No se pudo completar el acceso corporativo de forma segura.", unavailable: "El acceso corporativo no está disponible en este momento." }, mfaExpired: "La solicitud MFA ha caducado. Inicia sesión de nuevo.",
  },
  mfa: { enrollTitle: "Configura MFA ahora", verifyTitle: "Confirma el acceso", enrollIntro: "Escanea el código QR con tu aplicación de autenticación y confirma con el código de seis dígitos.", verifyIntro: "Introduce un código de tu aplicación de autenticación o un código de recuperación sin usar.", confirmCode: "Código de confirmación", code: "Código MFA o de recuperación", manualKey: "Clave manual", qrAlt: "Código QR para la aplicación de autenticación", activating: "Comprobando código", activate: "Activar MFA", verifying: "Comprobando código", finish: "Completar acceso", requestFailed: "No se pudo completar la solicitud MFA. Inténtalo de nuevo.", connectionFailed: "No se pudo completar la solicitud MFA. Comprueba tu conexión e inténtalo de nuevo.", missingRecovery: "No se pudieron mostrar los códigos de recuperación. No recargues la página y contacta con soporte.", enabled: "MFA está activa. Guarda los códigos de recuperación de forma segura.", verified: "MFA confirmada.", saveRecovery: "Guardar códigos de recuperación", recoveryOnlyOnce: "Estos códigos solo se muestran ahora. Cada código funciona una sola vez.", copied: "Copiados", copy: "Copiar códigos", acknowledge: "He guardado los códigos de recuperación en un lugar seguro.", continue: "Continuar" },
  language: { profileLabel: "Idioma", profileHelp: "Determina la navegación, el acceso, los diálogos de seguridad y los correos del sistema.", inherit: "Usar el idioma de la organización", organizationTitle: "Idioma y localización", organizationHelp: "Este idioma se aplica a las cuentas sin preferencia y a las nuevas invitaciones.", organizationLabel: "Idioma de la organización", save: "Guardar idioma", saving: "Guardando", profileSaved: "Idioma guardado.", organizationSaved: "Idioma de la organización guardado.", invalidLocale: "Selecciona un idioma compatible.", profileUnavailable: "No se encontró el perfil activo.", organizationUnavailable: "No se encontró la organización activa." },
};

const fr: BaseCoreDictionary = {
  navigation: {
    groups: { home: "Accueil", content: "Gestion des contenus", members: "Gestion des membres", experience: "Expérience", ai: "IA et analyses", system: "Système", learning: "Apprentissage", exchange: "Échanges" },
    items: { overview: "Vue d'ensemble", courses: "Cours", modules: "Modules", tasks: "Centre de tâches", members: "Membres", groups: "Groupes", bundles: "Packs", certificates: "Certificats", community: "Communauté", hubs: "Hubs", events: "Événements", announcements: "Annonces", email: "Centre e-mail", agents: "Agents IA", analytics: "Statistiques", privacy: "Confidentialité", integrations: "Intégrations", api: "API et webhooks", settings: "Paramètres", memberArea: "Espace membres", dashboard: "Tableau de bord", myCourses: "Mes cours", bookmarks: "Favoris", aiTools: "Centre d'outils IA", coach: "Q-Coach" },
    help: { adminTitle: "Tâches en vue", adminBody: "Évaluations et retours", memberTitle: "Besoin d'aide ?", memberBody: "Demander à Q-Coach" },
    open: "Ouvrir la navigation", close: "Fermer la navigation", mobile: "Navigation principale mobile", adminArea: "Espace admin", memberArea: "Espace membres", profile: "Mon profil", logout: "Se déconnecter",
    roles: { owner: "Propriétaire", admin: "Administrateur", trainer: "Formateur", member: "Membre" },
  },
  auth: {
    signIn: "Se connecter", email: "Adresse e-mail", password: "Mot de passe", forgot: "Oublié ?", showPassword: "Afficher le mot de passe", hidePassword: "Masquer le mot de passe", signingIn: "Connexion en cours", signInAt: (name) => `Se connecter à ${name}`, corporateLogin: "Connexion d'entreprise", orPassword: "Ou utiliser le mot de passe", demoMember: "Tester comme membre", demoAdmin: "Tester comme admin", demoPassword: "Mot de passe de démo pour les deux rôles :", learningEnvironment: "Environnement d'apprentissage", imprint: "Mentions légales", support: "Support", heroEyebrow: "Votre système d'apprentissage", heroTitle: "De la première idée à un flux IA responsable.", heroImageAlt: "Système modulaire de flux de travail IA", heroCourses: "Cours pratiques", heroCoursesBody: "Parcours directement applicables", heroCoachBody: "De l'aide au bon moment", heroSecurity: "Utilisation sûre", heroSecurityBody: "Cadre et gouvernance", genericCredentialError: "L'adresse e-mail ou le mot de passe est incorrect.", rateLimited: "Trop de tentatives de connexion. Réessayez plus tard.", oidcErrors: { denied: "La connexion avec le fournisseur d'identité a été annulée.", expired: "La demande de connexion a expiré. Recommencez.", changed: "La configuration de connexion a changé. Recommencez.", rate_limited: "Trop de tentatives de connexion. Réessayez plus tard.", account: "Aucun compte actif n'est disponible pour cette connexion d'entreprise.", failed: "La connexion d'entreprise n'a pas pu être finalisée de manière sûre.", unavailable: "La connexion d'entreprise est actuellement indisponible." }, mfaExpired: "La demande MFA a expiré. Connectez-vous à nouveau.",
  },
  mfa: { enrollTitle: "Configurer la MFA", verifyTitle: "Confirmer la connexion", enrollIntro: "Scannez le code QR avec votre application d'authentification et confirmez avec le code à six chiffres.", verifyIntro: "Saisissez un code de votre application d'authentification ou un code de récupération inutilisé.", confirmCode: "Code de confirmation", code: "Code MFA ou de récupération", manualKey: "Clé manuelle", qrAlt: "Code QR pour l'application d'authentification", activating: "Vérification du code", activate: "Activer la MFA", verifying: "Vérification du code", finish: "Terminer la connexion", requestFailed: "La demande MFA n'a pas pu être finalisée. Réessayez.", connectionFailed: "La demande MFA n'a pas pu être finalisée. Vérifiez votre connexion et réessayez.", missingRecovery: "Les codes de récupération n'ont pas pu être affichés. Ne rechargez pas la page et contactez le support.", enabled: "La MFA est active. Conservez les codes de récupération en lieu sûr.", verified: "La MFA a été confirmée.", saveRecovery: "Enregistrer les codes de récupération", recoveryOnlyOnce: "Ces codes ne sont affichés qu'une seule fois. Chaque code ne fonctionne qu'une fois.", copied: "Copiés", copy: "Copier les codes", acknowledge: "J'ai enregistré les codes de récupération dans un endroit sûr.", continue: "Continuer" },
  language: { profileLabel: "Langue", profileHelp: "Détermine la navigation, la connexion, les dialogues de sécurité et les e-mails système.", inherit: "Utiliser la langue de l'organisation", organizationTitle: "Langue et localisation", organizationHelp: "Cette langue s'applique aux comptes sans préférence et aux nouvelles invitations.", organizationLabel: "Langue de l'organisation", save: "Enregistrer la langue", saving: "Enregistrement", profileSaved: "Langue enregistrée.", organizationSaved: "Langue de l'organisation enregistrée.", invalidLocale: "Sélectionnez une langue prise en charge.", profileUnavailable: "Le profil actif est introuvable.", organizationUnavailable: "L'organisation active est introuvable." },
};

type ExperienceDictionary = {
  courses: { eyebrow: string; title: string; description: string };
  events: {
    eyebrow: string;
    title: string;
    description: string;
    commitments: (count: number) => string;
    filterLabel: string;
    upcoming: string;
    mine: string;
    past: string;
    going: string;
    maybe: string;
    decline: string;
    cancelled: string;
    expired: string;
    live: string;
    planned: string;
    joinOnline: string;
    calendar: string;
    empty: string;
  };
  hub: {
    eyebrow: string;
    defaultTitle: string;
    defaultDescription: string;
    availableHubs: string;
    emptyTitle: string;
    emptyDescription: string;
    noContent: string;
    nextStep: string;
    courseCompleted: (title: string) => string;
    continueCourse: (title: string) => string;
    noAssignedCourse: string;
    courseProgress: string;
    openCourse: string;
    coachDescription: string;
    openChat: string;
  };
  account: { remembered: string; switchTo: string; other: string };
  profile: { eyebrow: string; title: string; description: string };
  admin: {
    eyebrow: string;
    greeting: (firstName: string) => string;
    description: string;
    invite: string;
    createCourse: string;
    members: string;
    courses: string;
    submissions: string;
    activePaths: string;
  };
  emailCenter: {
    eyebrow: string;
    title: string;
    description: string;
    tabs: { templates: string; outbox: string };
    language: string;
    recipientHint: string;
    subject: string;
    message: string;
    variables: string;
    save: string;
    saved: string;
    previewText: string;
    previewHtml: string;
    testRecipient: string;
    sendTest: string;
    defaultTemplate: string;
    validationHint: string;
    dirtyHint: string;
    searchPlaceholder: string;
    allEvents: string;
    allStatuses: string;
    filter: string;
    resetFilters: string;
    recipient: string;
    event: string;
    status: string;
    attempts: string;
    created: string;
    updated: string;
    open: string;
    empty: string;
    entries: (total: number, page: number, pages: number) => string;
    previous: string;
    next: string;
    statusLabels: Record<
      "pending" | "processing" | "delivered" | "failed" | "retrying",
      string
    >;
    eventLabels: Record<string, string>;
    saveSuccess: string;
    noChanges: string;
    saveFailed: string;
    testQueued: string;
    testDuplicate: string;
    testFailed: string;
  };
};

const experienceDictionaries: Record<AppLocale, ExperienceDictionary> = {
  de: {
    courses: { eyebrow: "Dein Lernpfad", title: "Meine Kurse", description: "Alle freigeschalteten Kurse und dein aktueller Fortschritt." },
    events: { eyebrow: "Live Learning", title: "Event-Plan", description: "Workshops, Sprechstunden und wichtige Deadlines auf einen Blick.", commitments: (count) => `${count} Zusagen`, filterLabel: "Termine filtern", upcoming: "Anstehend", mine: "Meine Termine", past: "Vergangen", going: "Dabei", maybe: "Vielleicht", decline: "Absagen", cancelled: "Abgesagt", expired: "Abgelaufen", live: "Live", planned: "Geplant", joinOnline: "Online teilnehmen", calendar: "Kalender", empty: "Keine Termine in dieser Ansicht" },
    hub: { eyebrow: "Dein Hub", defaultTitle: "AI Tool Center", defaultDescription: "Alle Werkzeuge und Ansprechpartner an einem Ort.", availableHubs: "Verfuegbare Hubs", emptyTitle: "Kein Hub freigeschaltet", emptyDescription: "Sobald ein Hub fuer dich veroeffentlicht wird, erscheint er hier.", noContent: "Dieser Hub hat noch keine Inhalte.", nextStep: "Naechster Lernschritt", courseCompleted: (title) => `${title} ist abgeschlossen. Waehle deinen naechsten Lernpfad.`, continueCourse: (title) => `Setze ${title} dort fort, wo du zuletzt aufgehoert hast.`, noAssignedCourse: "Dir ist aktuell noch kein Kurs zugewiesen.", courseProgress: "Kursfortschritt", openCourse: "Zum Kurs", coachDescription: "Klaere Fragen zu deinen freigeschalteten Lerninhalten im persoenlichen Chat.", openChat: "Chat oeffnen" },
    account: { remembered: "Gemerkt auf diesem Geraet", switchTo: "Konto wechseln", other: "Anderes Konto" },
    profile: { eyebrow: "Account", title: "Mein Profil", description: "Verwalte deine Angaben, Sicherheit und aktiven Sitzungen." },
    admin: { eyebrow: "Academy Cockpit", greeting: (name) => `Guten Morgen, ${name}`, description: "Hier siehst du, was in deiner Academy heute Aufmerksamkeit braucht.", invite: "Mitglied einladen", createCourse: "Kurs erstellen", members: "Mitglieder", courses: "Kurse", submissions: "Offene Abgaben", activePaths: "Aktive Lernpfade" },
    emailCenter: { eyebrow: "Kommunikation", title: "E-Mail-Center", description: "Bearbeite Vorlagen, pruefe Vorschauen und verfolge den Versand.", tabs: { templates: "Vorlagen", outbox: "Versand" }, language: "Sprache", recipientHint: "Empfaenger erhalten die Vorlage in dieser Sprache.", subject: "Betreff", message: "Nachricht", variables: "Verfuegbare Variablen", save: "Vorlage speichern", saved: "Gespeichert", previewText: "Textvorschau", previewHtml: "HTML-Vorschau", testRecipient: "Test-Empfaenger", sendTest: "Test senden", defaultTemplate: "Standardvorlage", validationHint: "Betreff und Nachricht muessen alle erforderlichen Variablen enthalten.", dirtyHint: "Es gibt noch nicht gespeicherte Aenderungen.", searchPlaceholder: "Empfaenger oder Betreff durchsuchen", allEvents: "Alle Ereignisse", allStatuses: "Alle Status", filter: "Filtern", resetFilters: "Filter zuruecksetzen", recipient: "Empfaenger", event: "Ereignis", status: "Status", attempts: "Versuche", created: "Erstellt", updated: "Aktualisiert", open: "Oeffnen", empty: "Keine Versandvorgaenge fuer diese Filter gefunden.", entries: (total, page, pages) => `${total} Eintraege | Seite ${page} von ${pages}`, previous: "Zurueck", next: "Weiter", statusLabels: { pending: "Ausstehend", processing: "In Bearbeitung", delivered: "Zugestellt", failed: "Fehlgeschlagen", retrying: "Erneuter Versuch" }, eventLabels: { feedbackReply: "Feedback-Antwort", lessonAvailable: "Lektion verfuegbar", courseModulesReleased: "Kursmodule freigegeben", invitationCreated: "Einladung erstellt", passwordReset: "Passwort zuruecksetzen", eventRescheduled: "Event verschoben", eventCancelled: "Event abgesagt", templateTest: "Vorlagentest" }, saveSuccess: "Vorlage gespeichert.", noChanges: "Keine Aenderungen zum Speichern.", saveFailed: "Vorlage konnte nicht gespeichert werden.", testQueued: "Test-E-Mail wurde zum Versand eingeplant.", testDuplicate: "Diese Test-E-Mail wurde bereits eingeplant.", testFailed: "Test-E-Mail konnte nicht eingeplant werden." },
  },
  en: {
    courses: { eyebrow: "Your learning path", title: "My courses", description: "All available courses and your current progress." },
    events: { eyebrow: "Live learning", title: "Events", description: "Workshops, office hours and important deadlines at a glance.", commitments: (count) => `${count} commitments`, filterLabel: "Filter events", upcoming: "Upcoming", mine: "My events", past: "Past", going: "Going", maybe: "Maybe", decline: "Decline", cancelled: "Cancelled", expired: "Ended", live: "Live", planned: "Scheduled", joinOnline: "Join online", calendar: "Calendar", empty: "No events in this view" },
    hub: { eyebrow: "Your hub", defaultTitle: "AI Tool Centre", defaultDescription: "All tools and contacts in one place.", availableHubs: "Available hubs", emptyTitle: "No hub available", emptyDescription: "Published hubs available to you will appear here.", noContent: "This hub does not contain any content yet.", nextStep: "Next learning step", courseCompleted: (title) => `${title} is complete. Choose your next learning path.`, continueCourse: (title) => `Continue ${title} where you left off.`, noAssignedCourse: "No course is currently assigned to you.", courseProgress: "Course progress", openCourse: "Open course", coachDescription: "Ask questions about your available learning content in your personal chat.", openChat: "Open chat" },
    account: { remembered: "Remembered on this device", switchTo: "Switch account", other: "Another account" },
    profile: { eyebrow: "Account", title: "My profile", description: "Manage your details, security and active sessions." },
    admin: { eyebrow: "Academy cockpit", greeting: (name) => `Good morning, ${name}`, description: "See what needs attention in your academy today.", invite: "Invite member", createCourse: "Create course", members: "Members", courses: "Courses", submissions: "Open submissions", activePaths: "Active learning paths" },
    emailCenter: { eyebrow: "Communication", title: "Email centre", description: "Edit templates, verify previews and track delivery.", tabs: { templates: "Templates", outbox: "Delivery" }, language: "Language", recipientHint: "Recipients receive the template in this language.", subject: "Subject", message: "Message", variables: "Available variables", save: "Save template", saved: "Saved", previewText: "Text preview", previewHtml: "HTML preview", testRecipient: "Test recipient", sendTest: "Send test", defaultTemplate: "Default template", validationHint: "Subject and message must contain all required variables.", dirtyHint: "There are unsaved changes.", searchPlaceholder: "Search recipient or subject", allEvents: "All events", allStatuses: "All statuses", filter: "Filter", resetFilters: "Reset filters", recipient: "Recipient", event: "Event", status: "Status", attempts: "Attempts", created: "Created", updated: "Updated", open: "Open", empty: "No deliveries match these filters.", entries: (total, page, pages) => `${total} entries | Page ${page} of ${pages}`, previous: "Previous", next: "Next", statusLabels: { pending: "Pending", processing: "Processing", delivered: "Delivered", failed: "Failed", retrying: "Retrying" }, eventLabels: { feedbackReply: "Feedback reply", lessonAvailable: "Lesson available", courseModulesReleased: "Course modules released", invitationCreated: "Invitation created", passwordReset: "Password reset", eventRescheduled: "Event rescheduled", eventCancelled: "Event cancelled", templateTest: "Template test" }, saveSuccess: "Template saved.", noChanges: "There are no changes to save.", saveFailed: "The template could not be saved.", testQueued: "The test email was queued for delivery.", testDuplicate: "This test email is already queued.", testFailed: "The test email could not be queued." },
  },
  it: {
    courses: { eyebrow: "Il tuo percorso", title: "I miei corsi", description: "Tutti i corsi disponibili e i tuoi progressi attuali." },
    events: { eyebrow: "Apprendimento live", title: "Eventi", description: "Workshop, incontri e scadenze importanti in un unico posto.", commitments: (count) => `${count} partecipazioni`, filterLabel: "Filtra eventi", upcoming: "In programma", mine: "I miei eventi", past: "Passati", going: "Partecipo", maybe: "Forse", decline: "Rifiuta", cancelled: "Annullato", expired: "Terminato", live: "Live", planned: "Pianificato", joinOnline: "Partecipa online", calendar: "Calendario", empty: "Nessun evento in questa vista" },
    hub: { eyebrow: "Il tuo hub", defaultTitle: "Centro strumenti IA", defaultDescription: "Tutti gli strumenti e i contatti in un unico posto.", availableHubs: "Hub disponibili", emptyTitle: "Nessun hub disponibile", emptyDescription: "Gli hub pubblicati per te appariranno qui.", noContent: "Questo hub non contiene ancora contenuti.", nextStep: "Prossimo passo formativo", courseCompleted: (title) => `${title} è completato. Scegli il tuo prossimo percorso formativo.`, continueCourse: (title) => `Continua ${title} da dove avevi interrotto.`, noAssignedCourse: "Al momento non ti è assegnato alcun corso.", courseProgress: "Avanzamento del corso", openCourse: "Apri corso", coachDescription: "Chiarisci i dubbi sui contenuti formativi disponibili nella chat personale.", openChat: "Apri chat" },
    account: { remembered: "Memorizzati su questo dispositivo", switchTo: "Cambia account", other: "Altro account" },
    profile: { eyebrow: "Account", title: "Il mio profilo", description: "Gestisci dati, sicurezza e sessioni attive." },
    admin: { eyebrow: "Academy cockpit", greeting: (name) => `Buongiorno, ${name}`, description: "Controlla cosa richiede attenzione oggi nella tua academy.", invite: "Invita membro", createCourse: "Crea corso", members: "Membri", courses: "Corsi", submissions: "Consegne aperte", activePaths: "Percorsi attivi" },
    emailCenter: { eyebrow: "Comunicazione", title: "Centro email", description: "Modifica i modelli, controlla le anteprime e monitora gli invii.", tabs: { templates: "Modelli", outbox: "Invii" }, language: "Lingua", recipientHint: "I destinatari ricevono il modello in questa lingua.", subject: "Oggetto", message: "Messaggio", variables: "Variabili disponibili", save: "Salva modello", saved: "Salvato", previewText: "Anteprima testo", previewHtml: "Anteprima HTML", testRecipient: "Destinatario di prova", sendTest: "Invia prova", defaultTemplate: "Modello predefinito", validationHint: "Oggetto e messaggio devono contenere tutte le variabili richieste.", dirtyHint: "Sono presenti modifiche non salvate.", searchPlaceholder: "Cerca destinatario o oggetto", allEvents: "Tutti gli eventi", allStatuses: "Tutti gli stati", filter: "Filtra", resetFilters: "Reimposta filtri", recipient: "Destinatario", event: "Evento", status: "Stato", attempts: "Tentativi", created: "Creato", updated: "Aggiornato", open: "Apri", empty: "Nessun invio corrisponde ai filtri.", entries: (total, page, pages) => `${total} voci | Pagina ${page} di ${pages}`, previous: "Precedente", next: "Successivo", statusLabels: { pending: "In attesa", processing: "In elaborazione", delivered: "Consegnato", failed: "Non riuscito", retrying: "Nuovo tentativo" }, eventLabels: { feedbackReply: "Risposta al feedback", lessonAvailable: "Lezione disponibile", courseModulesReleased: "Moduli del corso disponibili", invitationCreated: "Invito creato", passwordReset: "Reimposta password", eventRescheduled: "Evento riprogrammato", eventCancelled: "Evento annullato", templateTest: "Test del modello" }, saveSuccess: "Modello salvato.", noChanges: "Non ci sono modifiche da salvare.", saveFailed: "Impossibile salvare il modello.", testQueued: "L'email di prova è stata messa in coda.", testDuplicate: "Questa email di prova è già in coda.", testFailed: "Impossibile mettere in coda l'email di prova." },
  },
  es: {
    courses: { eyebrow: "Tu ruta de aprendizaje", title: "Mis cursos", description: "Todos los cursos disponibles y tu progreso actual." },
    events: { eyebrow: "Aprendizaje en directo", title: "Eventos", description: "Talleres, sesiones y fechas importantes de un vistazo.", commitments: (count) => `${count} confirmaciones`, filterLabel: "Filtrar eventos", upcoming: "Próximos", mine: "Mis eventos", past: "Pasados", going: "Asistiré", maybe: "Quizás", decline: "Rechazar", cancelled: "Cancelado", expired: "Finalizado", live: "En directo", planned: "Programado", joinOnline: "Unirse online", calendar: "Calendario", empty: "No hay eventos en esta vista" },
    hub: { eyebrow: "Tu hub", defaultTitle: "Centro de herramientas IA", defaultDescription: "Todas las herramientas y contactos en un solo lugar.", availableHubs: "Hubs disponibles", emptyTitle: "No hay ningún hub disponible", emptyDescription: "Los hubs publicados para ti aparecerán aquí.", noContent: "Este hub todavía no contiene contenido.", nextStep: "Siguiente paso de aprendizaje", courseCompleted: (title) => `${title} está completado. Elige tu siguiente ruta de aprendizaje.`, continueCourse: (title) => `Continúa ${title} donde lo dejaste.`, noAssignedCourse: "Actualmente no tienes ningún curso asignado.", courseProgress: "Progreso del curso", openCourse: "Abrir curso", coachDescription: "Resuelve dudas sobre tus contenidos formativos disponibles en el chat personal.", openChat: "Abrir chat" },
    account: { remembered: "Recordados en este dispositivo", switchTo: "Cambiar cuenta", other: "Otra cuenta" },
    profile: { eyebrow: "Cuenta", title: "Mi perfil", description: "Gestiona tus datos, seguridad y sesiones activas." },
    admin: { eyebrow: "Panel de la academy", greeting: (name) => `Buenos días, ${name}`, description: "Consulta qué necesita atención hoy en tu academy.", invite: "Invitar miembro", createCourse: "Crear curso", members: "Miembros", courses: "Cursos", submissions: "Entregas abiertas", activePaths: "Rutas activas" },
    emailCenter: { eyebrow: "Comunicación", title: "Centro de correo", description: "Edita plantillas, revisa vistas previas y controla los envíos.", tabs: { templates: "Plantillas", outbox: "Envíos" }, language: "Idioma", recipientHint: "Los destinatarios reciben la plantilla en este idioma.", subject: "Asunto", message: "Mensaje", variables: "Variables disponibles", save: "Guardar plantilla", saved: "Guardado", previewText: "Vista previa de texto", previewHtml: "Vista previa HTML", testRecipient: "Destinatario de prueba", sendTest: "Enviar prueba", defaultTemplate: "Plantilla predeterminada", validationHint: "El asunto y el mensaje deben incluir todas las variables obligatorias.", dirtyHint: "Hay cambios sin guardar.", searchPlaceholder: "Buscar destinatario o asunto", allEvents: "Todos los eventos", allStatuses: "Todos los estados", filter: "Filtrar", resetFilters: "Restablecer filtros", recipient: "Destinatario", event: "Evento", status: "Estado", attempts: "Intentos", created: "Creado", updated: "Actualizado", open: "Abrir", empty: "Ningún envío coincide con los filtros.", entries: (total, page, pages) => `${total} entradas | Página ${page} de ${pages}`, previous: "Anterior", next: "Siguiente", statusLabels: { pending: "Pendiente", processing: "Procesando", delivered: "Entregado", failed: "Fallido", retrying: "Reintentando" }, eventLabels: { feedbackReply: "Respuesta de feedback", lessonAvailable: "Lección disponible", courseModulesReleased: "Módulos del curso disponibles", invitationCreated: "Invitación creada", passwordReset: "Restablecer contraseña", eventRescheduled: "Evento reprogramado", eventCancelled: "Evento cancelado", templateTest: "Prueba de plantilla" }, saveSuccess: "Plantilla guardada.", noChanges: "No hay cambios que guardar.", saveFailed: "No se pudo guardar la plantilla.", testQueued: "El correo de prueba se ha puesto en cola.", testDuplicate: "Este correo de prueba ya está en cola.", testFailed: "No se pudo poner en cola el correo de prueba." },
  },
  fr: {
    courses: { eyebrow: "Votre parcours", title: "Mes cours", description: "Tous les cours disponibles et votre progression actuelle." },
    events: { eyebrow: "Apprentissage en direct", title: "Événements", description: "Ateliers, permanences et échéances importantes en un coup d'œil.", commitments: (count) => `${count} participations`, filterLabel: "Filtrer les événements", upcoming: "À venir", mine: "Mes événements", past: "Passés", going: "Je participe", maybe: "Peut-être", decline: "Refuser", cancelled: "Annulé", expired: "Terminé", live: "En direct", planned: "Planifié", joinOnline: "Participer en ligne", calendar: "Calendrier", empty: "Aucun événement dans cette vue" },
    hub: { eyebrow: "Votre hub", defaultTitle: "Centre d'outils IA", defaultDescription: "Tous les outils et contacts au même endroit.", availableHubs: "Hubs disponibles", emptyTitle: "Aucun hub disponible", emptyDescription: "Les hubs publiés pour vous apparaîtront ici.", noContent: "Ce hub ne contient pas encore de contenu.", nextStep: "Prochaine étape d'apprentissage", courseCompleted: (title) => `${title} est terminé. Choisissez votre prochain parcours d'apprentissage.`, continueCourse: (title) => `Reprenez ${title} là où vous vous étiez arrêté.`, noAssignedCourse: "Aucun cours ne vous est actuellement attribué.", courseProgress: "Progression du cours", openCourse: "Ouvrir le cours", coachDescription: "Posez vos questions sur les contenus de formation disponibles dans votre chat personnel.", openChat: "Ouvrir le chat" },
    account: { remembered: "Mémorisés sur cet appareil", switchTo: "Changer de compte", other: "Autre compte" },
    profile: { eyebrow: "Compte", title: "Mon profil", description: "Gérez vos informations, votre sécurité et vos sessions actives." },
    admin: { eyebrow: "Cockpit academy", greeting: (name) => `Bonjour, ${name}`, description: "Consultez ce qui demande votre attention aujourd'hui.", invite: "Inviter un membre", createCourse: "Créer un cours", members: "Membres", courses: "Cours", submissions: "Travaux ouverts", activePaths: "Parcours actifs" },
    emailCenter: { eyebrow: "Communication", title: "Centre e-mail", description: "Modifiez les modèles, vérifiez les aperçus et suivez les envois.", tabs: { templates: "Modèles", outbox: "Envois" }, language: "Langue", recipientHint: "Les destinataires reçoivent le modèle dans cette langue.", subject: "Objet", message: "Message", variables: "Variables disponibles", save: "Enregistrer le modèle", saved: "Enregistré", previewText: "Aperçu texte", previewHtml: "Aperçu HTML", testRecipient: "Destinataire de test", sendTest: "Envoyer un test", defaultTemplate: "Modèle par défaut", validationHint: "L'objet et le message doivent contenir toutes les variables requises.", dirtyHint: "Des modifications ne sont pas enregistrées.", searchPlaceholder: "Rechercher destinataire ou objet", allEvents: "Tous les événements", allStatuses: "Tous les statuts", filter: "Filtrer", resetFilters: "Réinitialiser les filtres", recipient: "Destinataire", event: "Événement", status: "Statut", attempts: "Tentatives", created: "Créé", updated: "Mis à jour", open: "Ouvrir", empty: "Aucun envoi ne correspond aux filtres.", entries: (total, page, pages) => `${total} entrées | Page ${page} sur ${pages}`, previous: "Précédent", next: "Suivant", statusLabels: { pending: "En attente", processing: "Traitement", delivered: "Livré", failed: "Échec", retrying: "Nouvelle tentative" }, eventLabels: { feedbackReply: "Réponse au feedback", lessonAvailable: "Leçon disponible", courseModulesReleased: "Modules du cours disponibles", invitationCreated: "Invitation créée", passwordReset: "Réinitialisation du mot de passe", eventRescheduled: "Événement reprogrammé", eventCancelled: "Événement annulé", templateTest: "Test du modèle" }, saveSuccess: "Modèle enregistré.", noChanges: "Aucune modification à enregistrer.", saveFailed: "Le modèle n'a pas pu être enregistré.", testQueued: "L'e-mail de test a été mis en file d'attente.", testDuplicate: "Cet e-mail de test est déjà mis en file d'attente.", testFailed: "L'e-mail de test n'a pas pu être mis en file d'attente." },
  },
};

export type CoreDictionary = BaseCoreDictionary & {
  experience: ExperienceDictionary;
};

const dictionaries: Record<AppLocale, BaseCoreDictionary> = { de, en, it, es, fr };

export function getCoreDictionary(locale: AppLocale): CoreDictionary {
  const selected = dictionaries[locale] ?? de;
  return { ...selected, experience: experienceDictionaries[locale] ?? experienceDictionaries.de };
}
