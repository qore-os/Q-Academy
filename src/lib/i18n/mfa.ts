import type { AppLocale } from "@/lib/i18n/model";

export type MfaCopy = {
  account: {
    title: string;
    description: string;
    active: string;
    required: string;
    inactive: string;
    recentSsoRequired: string;
    confirmSso: string;
    policyRequired: string;
    currentPassword: string;
    freshSso: string;
    startSetup: string;
    qrAlt: string;
    scanQr: string;
    sixDigitCode: string;
    enable: string;
    recoveryVisibleOnce: string;
    copied: string;
    copyCodes: string;
    activeSince: string;
    justEnabled: string;
    recoveryCodes: string;
    remainingCodes: (count: number) => string;
    renewCodes: string;
    passwordForCodes: string;
    codeForCodes: string;
    codePlaceholder: string;
    createCodes: string;
    disable: string;
    passwordToDisable: string;
    codeToDisable: string;
  };
  policy: {
    title: string;
    description: string;
    privilegedAccounts: string;
    protectedAccounts: string;
    recentSsoRequired: string;
    confirmSso: string;
    required: string;
    requiredHelp: string;
    ownerPassword: string;
    freshSso: string;
    code: string;
    save: string;
    ownerOnly: string;
  };
  messages: {
    genericFailure: string;
    rateLimited: (seconds: number) => string;
    currentPasswordIncorrect: string;
    confirmAtProvider: string;
    mfaNotEnabledForAccount: string;
    codeIncorrect: string;
    privilegedOnly: string;
    enterPassword: string;
    organizationUnavailable: string;
    alreadyEnabled: string;
    scanAndConfirm: string;
    actionUnavailable: string;
    checkPasswordAndSixDigit: string;
    sessionExpired: string;
    restartSetup: string;
    confirmationIncorrect: string;
    enabled: string;
    checkPasswordAndCode: string;
    notEnabled: string;
    codesRegenerated: string;
    policyPreventsDisable: string;
    disabled: string;
    checkPolicyPasswordCode: string;
    ownerNeedsMfa: string;
    policyConflict: string;
    policyEnabled: string;
    policyDisabled: string;
    permissionChanged: string;
    primaryChanged: string;
  };
};

const de: MfaCopy = {
  account: {
    title: "Multi-Faktor-Authentifizierung", description: "Authenticator-App und einmalige Recovery-Codes", active: "Aktiv", required: "Erforderlich", inactive: "Inaktiv", recentSsoRequired: "Sicherheitsaktionen brauchen eine SSO-Bestaetigung der letzten fuenf Minuten.", confirmSso: "SSO erneut bestaetigen", policyRequired: "Die Organisations-Policy verlangt MFA fuer dieses Konto.", currentPassword: "Aktuelles Passwort", freshSso: "Diese Aktion nutzt deine frische SSO-Bestaetigung.", startSetup: "Einrichtung starten", qrAlt: "QR-Code fuer die Authenticator-App", scanQr: "Scanne den QR-Code. Alternativ kannst du diesen Schluessel manuell eingeben:", sixDigitCode: "Sechsstelliger Code", enable: "MFA aktivieren", recoveryVisibleOnce: "Nur jetzt sichtbar: Recovery-Codes", copied: "Kopiert", copyCodes: "Codes kopieren", activeSince: "Aktiv seit", justEnabled: "Gerade aktiviert", recoveryCodes: "Recovery-Codes", remainingCodes: (count) => `${count} verbleibend`, renewCodes: "Recovery-Codes erneuern", passwordForCodes: "Aktuelles Passwort fuer neue Recovery-Codes", codeForCodes: "MFA-Code fuer neue Recovery-Codes", codePlaceholder: "MFA- oder Recovery-Code", createCodes: "Neue Codes erstellen", disable: "MFA deaktivieren", passwordToDisable: "Aktuelles Passwort zum Deaktivieren", codeToDisable: "MFA-Code zum Deaktivieren",
  },
  policy: {
    title: "Privilegierte Konten", description: "MFA-Policy fuer Owner und Administratoren", privilegedAccounts: "Privilegierte Konten", protectedAccounts: "Bereits geschuetzt", recentSsoRequired: "Bestaetige SSO erneut, bevor du die Policy aenderst.", confirmSso: "SSO erneut bestaetigen", required: "MFA verpflichtend", requiredHelp: "Konten ohne Einrichtung werden beim naechsten Login durch das geschuetzte Enrollment gefuehrt.", ownerPassword: "Owner-Passwort", freshSso: "Diese Aktion nutzt deine frische SSO-Bestaetigung.", code: "MFA- oder Recovery-Code", save: "Policy speichern", ownerOnly: "Nur der Organisations-Owner kann diese Policy aendern.",
  },
  messages: {
    genericFailure: "Die Sicherheitsaktion konnte nicht abgeschlossen werden.", rateLimited: (seconds) => `Zu viele Sicherheitsversuche. Bitte versuche es in ${seconds} Sekunden erneut.`, currentPasswordIncorrect: "Das aktuelle Passwort ist nicht korrekt.", confirmAtProvider: "Bitte bestaetige diese Sicherheitsaktion erneut beim Identity Provider.", mfaNotEnabledForAccount: "MFA ist fuer dieses Konto nicht aktiv.", codeIncorrect: "Der MFA- oder Recovery-Code ist nicht korrekt.", privilegedOnly: "MFA wird fuer Owner und Administratoren verwaltet.", enterPassword: "Bitte gib dein aktuelles Passwort ein.", organizationUnavailable: "Die Organisation ist nicht verfuegbar.", alreadyEnabled: "MFA ist bereits aktiv.", scanAndConfirm: "Scanne den QR-Code und bestaetige die Einrichtung.", actionUnavailable: "Diese Aktion ist nicht verfuegbar.", checkPasswordAndSixDigit: "Bitte pruefe Passwort und sechsstelligen Code.", sessionExpired: "Die Sitzung ist nicht mehr aktiv.", restartSetup: "Starte die MFA-Einrichtung erneut.", confirmationIncorrect: "Der Bestaetigungscode ist nicht korrekt.", enabled: "MFA ist aktiv. Speichere die Recovery-Codes jetzt.", checkPasswordAndCode: "Bitte pruefe Passwort und MFA-Code.", notEnabled: "MFA ist nicht aktiv.", codesRegenerated: "Neue Recovery-Codes wurden erstellt. Alte Codes sind ungueltig.", policyPreventsDisable: "Die Owner-Policy erzwingt MFA. Deaktiviere zuerst die Policy.", disabled: "MFA wurde deaktiviert. Andere Sitzungen wurden beendet.", checkPolicyPasswordCode: "Bitte pruefe Policy, Passwort und MFA-Code.", ownerNeedsMfa: "Richte zuerst MFA fuer dein Owner-Konto ein.", policyConflict: "Die MFA-Policy wurde zwischenzeitlich geaendert. Lade die Seite neu.", policyEnabled: "MFA ist jetzt fuer Owner und Administratoren verpflichtend.", policyDisabled: "Die verpflichtende MFA-Policy wurde deaktiviert.", permissionChanged: "Die Berechtigung fuer diese Sicherheitsaktion hat sich geaendert.", primaryChanged: "Die Primaer-Anmeldung hat sich geaendert. Bitte bestaetige die Aktion erneut.",
  },
};

const en: MfaCopy = {
  account: {
    title: "Multi-factor authentication", description: "Authenticator app and one-time recovery codes", active: "Active", required: "Required", inactive: "Inactive", recentSsoRequired: "Security actions require an SSO confirmation from the last five minutes.", confirmSso: "Confirm SSO again", policyRequired: "The organisation policy requires MFA for this account.", currentPassword: "Current password", freshSso: "This action uses your recent SSO confirmation.", startSetup: "Start setup", qrAlt: "QR code for the authenticator app", scanQr: "Scan the QR code. You can also enter this key manually:", sixDigitCode: "Six-digit code", enable: "Enable MFA", recoveryVisibleOnce: "Visible only now: recovery codes", copied: "Copied", copyCodes: "Copy codes", activeSince: "Active since", justEnabled: "Just enabled", recoveryCodes: "Recovery codes", remainingCodes: (count) => `${count} remaining`, renewCodes: "Renew recovery codes", passwordForCodes: "Current password for new recovery codes", codeForCodes: "MFA code for new recovery codes", codePlaceholder: "MFA or recovery code", createCodes: "Create new codes", disable: "Disable MFA", passwordToDisable: "Current password to disable MFA", codeToDisable: "MFA code to disable MFA",
  },
  policy: {
    title: "Privileged accounts", description: "MFA policy for owners and administrators", privilegedAccounts: "Privileged accounts", protectedAccounts: "Already protected", recentSsoRequired: "Confirm SSO again before changing the policy.", confirmSso: "Confirm SSO again", required: "Require MFA", requiredHelp: "Accounts without setup will be guided through protected enrolment at the next login.", ownerPassword: "Owner password", freshSso: "This action uses your recent SSO confirmation.", code: "MFA or recovery code", save: "Save policy", ownerOnly: "Only the organisation owner can change this policy.",
  },
  messages: {
    genericFailure: "The security action could not be completed.", rateLimited: (seconds) => `Too many security attempts. Try again in ${seconds} seconds.`, currentPasswordIncorrect: "The current password is incorrect.", confirmAtProvider: "Confirm this security action with the identity provider again.", mfaNotEnabledForAccount: "MFA is not enabled for this account.", codeIncorrect: "The MFA or recovery code is incorrect.", privilegedOnly: "MFA is managed for owners and administrators.", enterPassword: "Enter your current password.", organizationUnavailable: "The organisation is unavailable.", alreadyEnabled: "MFA is already enabled.", scanAndConfirm: "Scan the QR code and confirm the setup.", actionUnavailable: "This action is unavailable.", checkPasswordAndSixDigit: "Check the password and six-digit code.", sessionExpired: "The session is no longer active.", restartSetup: "Restart the MFA setup.", confirmationIncorrect: "The confirmation code is incorrect.", enabled: "MFA is active. Save the recovery codes now.", checkPasswordAndCode: "Check the password and MFA code.", notEnabled: "MFA is not active.", codesRegenerated: "New recovery codes were created. Old codes are invalid.", policyPreventsDisable: "The owner policy requires MFA. Disable the policy first.", disabled: "MFA was disabled. Other sessions were ended.", checkPolicyPasswordCode: "Check the policy, password and MFA code.", ownerNeedsMfa: "Set up MFA for your owner account first.", policyConflict: "The MFA policy changed in the meantime. Reload the page.", policyEnabled: "MFA is now required for owners and administrators.", policyDisabled: "The mandatory MFA policy was disabled.", permissionChanged: "Your permission for this security action changed.", primaryChanged: "The primary sign-in changed. Confirm the action again.",
  },
};

const it: MfaCopy = {
  account: {
    title: "Autenticazione a più fattori", description: "App di autenticazione e codici di recupero monouso", active: "Attiva", required: "Obbligatoria", inactive: "Inattiva", recentSsoRequired: "Le azioni di sicurezza richiedono una conferma SSO degli ultimi cinque minuti.", confirmSso: "Conferma di nuovo SSO", policyRequired: "La policy dell'organizzazione richiede MFA per questo account.", currentPassword: "Password attuale", freshSso: "Questa azione utilizza la conferma SSO recente.", startSetup: "Avvia configurazione", qrAlt: "Codice QR per l'app di autenticazione", scanQr: "Scansiona il codice QR. In alternativa, inserisci manualmente questa chiave:", sixDigitCode: "Codice a sei cifre", enable: "Attiva MFA", recoveryVisibleOnce: "Visibili solo ora: codici di recupero", copied: "Copiati", copyCodes: "Copia codici", activeSince: "Attiva dal", justEnabled: "Appena attivata", recoveryCodes: "Codici di recupero", remainingCodes: (count) => `${count} rimanenti`, renewCodes: "Rinnova codici di recupero", passwordForCodes: "Password attuale per nuovi codici", codeForCodes: "Codice MFA per nuovi codici", codePlaceholder: "Codice MFA o di recupero", createCodes: "Crea nuovi codici", disable: "Disattiva MFA", passwordToDisable: "Password attuale per disattivare", codeToDisable: "Codice MFA per disattivare",
  },
  policy: {
    title: "Account privilegiati", description: "Policy MFA per owner e amministratori", privilegedAccounts: "Account privilegiati", protectedAccounts: "Già protetti", recentSsoRequired: "Conferma di nuovo SSO prima di modificare la policy.", confirmSso: "Conferma di nuovo SSO", required: "MFA obbligatoria", requiredHelp: "Gli account non configurati seguiranno l'attivazione protetta al prossimo accesso.", ownerPassword: "Password owner", freshSso: "Questa azione utilizza la conferma SSO recente.", code: "Codice MFA o di recupero", save: "Salva policy", ownerOnly: "Solo l'owner dell'organizzazione può modificare questa policy.",
  },
  messages: {
    genericFailure: "Impossibile completare l'azione di sicurezza.", rateLimited: (seconds) => `Troppi tentativi di sicurezza. Riprova tra ${seconds} secondi.`, currentPasswordIncorrect: "La password attuale non è corretta.", confirmAtProvider: "Conferma nuovamente questa azione con l'Identity Provider.", mfaNotEnabledForAccount: "MFA non è attiva per questo account.", codeIncorrect: "Il codice MFA o di recupero non è corretto.", privilegedOnly: "MFA è gestita per owner e amministratori.", enterPassword: "Inserisci la password attuale.", organizationUnavailable: "L'organizzazione non è disponibile.", alreadyEnabled: "MFA è già attiva.", scanAndConfirm: "Scansiona il codice QR e conferma la configurazione.", actionUnavailable: "Questa azione non è disponibile.", checkPasswordAndSixDigit: "Controlla la password e il codice a sei cifre.", sessionExpired: "La sessione non è più attiva.", restartSetup: "Riavvia la configurazione MFA.", confirmationIncorrect: "Il codice di conferma non è corretto.", enabled: "MFA è attiva. Salva ora i codici di recupero.", checkPasswordAndCode: "Controlla la password e il codice MFA.", notEnabled: "MFA non è attiva.", codesRegenerated: "Sono stati creati nuovi codici. Quelli precedenti non sono validi.", policyPreventsDisable: "La policy owner richiede MFA. Disattiva prima la policy.", disabled: "MFA è stata disattivata. Le altre sessioni sono terminate.", checkPolicyPasswordCode: "Controlla la policy, la password e il codice MFA.", ownerNeedsMfa: "Configura prima MFA per l'account owner.", policyConflict: "La policy MFA è cambiata. Ricarica la pagina.", policyEnabled: "MFA è ora obbligatoria per owner e amministratori.", policyDisabled: "La policy MFA obbligatoria è stata disattivata.", permissionChanged: "L'autorizzazione per questa azione di sicurezza è cambiata.", primaryChanged: "L'accesso primario è cambiato. Conferma nuovamente l'azione.",
  },
};

const es: MfaCopy = {
  account: {
    title: "Autenticación multifactor", description: "Aplicación de autenticación y códigos de recuperación de un solo uso", active: "Activa", required: "Obligatoria", inactive: "Inactiva", recentSsoRequired: "Las acciones de seguridad requieren una confirmación SSO de los últimos cinco minutos.", confirmSso: "Confirmar SSO de nuevo", policyRequired: "La política de la organización exige MFA para esta cuenta.", currentPassword: "Contraseña actual", freshSso: "Esta acción utiliza tu confirmación SSO reciente.", startSetup: "Iniciar configuración", qrAlt: "Código QR para la aplicación de autenticación", scanQr: "Escanea el código QR. También puedes introducir esta clave manualmente:", sixDigitCode: "Código de seis dígitos", enable: "Activar MFA", recoveryVisibleOnce: "Visibles solo ahora: códigos de recuperación", copied: "Copiados", copyCodes: "Copiar códigos", activeSince: "Activa desde", justEnabled: "Recién activada", recoveryCodes: "Códigos de recuperación", remainingCodes: (count) => `${count} restantes`, renewCodes: "Renovar códigos de recuperación", passwordForCodes: "Contraseña actual para nuevos códigos", codeForCodes: "Código MFA para nuevos códigos", codePlaceholder: "Código MFA o de recuperación", createCodes: "Crear nuevos códigos", disable: "Desactivar MFA", passwordToDisable: "Contraseña actual para desactivar", codeToDisable: "Código MFA para desactivar",
  },
  policy: {
    title: "Cuentas privilegiadas", description: "Política MFA para propietarios y administradores", privilegedAccounts: "Cuentas privilegiadas", protectedAccounts: "Ya protegidas", recentSsoRequired: "Confirma SSO de nuevo antes de cambiar la política.", confirmSso: "Confirmar SSO de nuevo", required: "MFA obligatoria", requiredHelp: "Las cuentas sin configurar seguirán la activación protegida en el próximo acceso.", ownerPassword: "Contraseña del propietario", freshSso: "Esta acción utiliza tu confirmación SSO reciente.", code: "Código MFA o de recuperación", save: "Guardar política", ownerOnly: "Solo el propietario de la organización puede cambiar esta política.",
  },
  messages: {
    genericFailure: "No se pudo completar la acción de seguridad.", rateLimited: (seconds) => `Demasiados intentos de seguridad. Vuelve a intentarlo en ${seconds} segundos.`, currentPasswordIncorrect: "La contraseña actual no es correcta.", confirmAtProvider: "Confirma de nuevo esta acción con el proveedor de identidad.", mfaNotEnabledForAccount: "MFA no está activa para esta cuenta.", codeIncorrect: "El código MFA o de recuperación no es correcto.", privilegedOnly: "MFA se gestiona para propietarios y administradores.", enterPassword: "Introduce tu contraseña actual.", organizationUnavailable: "La organización no está disponible.", alreadyEnabled: "MFA ya está activa.", scanAndConfirm: "Escanea el código QR y confirma la configuración.", actionUnavailable: "Esta acción no está disponible.", checkPasswordAndSixDigit: "Comprueba la contraseña y el código de seis dígitos.", sessionExpired: "La sesión ya no está activa.", restartSetup: "Reinicia la configuración MFA.", confirmationIncorrect: "El código de confirmación no es correcto.", enabled: "MFA está activa. Guarda ahora los códigos de recuperación.", checkPasswordAndCode: "Comprueba la contraseña y el código MFA.", notEnabled: "MFA no está activa.", codesRegenerated: "Se crearon nuevos códigos. Los anteriores ya no son válidos.", policyPreventsDisable: "La política del propietario exige MFA. Desactiva primero la política.", disabled: "MFA fue desactivada. Las demás sesiones finalizaron.", checkPolicyPasswordCode: "Comprueba la política, la contraseña y el código MFA.", ownerNeedsMfa: "Configura primero MFA para la cuenta del propietario.", policyConflict: "La política MFA cambió. Recarga la página.", policyEnabled: "MFA es ahora obligatoria para propietarios y administradores.", policyDisabled: "La política MFA obligatoria fue desactivada.", permissionChanged: "El permiso para esta acción de seguridad ha cambiado.", primaryChanged: "El acceso principal ha cambiado. Confirma la acción de nuevo.",
  },
};

const fr: MfaCopy = {
  account: {
    title: "Authentification multifacteur", description: "Application d'authentification et codes de récupération à usage unique", active: "Active", required: "Obligatoire", inactive: "Inactive", recentSsoRequired: "Les actions de sécurité exigent une confirmation SSO datant de moins de cinq minutes.", confirmSso: "Confirmer à nouveau par SSO", policyRequired: "La politique de l'organisation exige la MFA pour ce compte.", currentPassword: "Mot de passe actuel", freshSso: "Cette action utilise votre récente confirmation SSO.", startSetup: "Démarrer la configuration", qrAlt: "Code QR pour l'application d'authentification", scanQr: "Scannez le code QR. Vous pouvez aussi saisir cette clé manuellement :", sixDigitCode: "Code à six chiffres", enable: "Activer la MFA", recoveryVisibleOnce: "Visibles maintenant uniquement : codes de récupération", copied: "Copiés", copyCodes: "Copier les codes", activeSince: "Active depuis", justEnabled: "À l'instant", recoveryCodes: "Codes de récupération", remainingCodes: (count) => `${count} restants`, renewCodes: "Renouveler les codes de récupération", passwordForCodes: "Mot de passe actuel pour de nouveaux codes", codeForCodes: "Code MFA pour de nouveaux codes", codePlaceholder: "Code MFA ou de récupération", createCodes: "Créer de nouveaux codes", disable: "Désactiver la MFA", passwordToDisable: "Mot de passe actuel pour désactiver", codeToDisable: "Code MFA pour désactiver",
  },
  policy: {
    title: "Comptes privilégiés", description: "Politique MFA pour les propriétaires et administrateurs", privilegedAccounts: "Comptes privilégiés", protectedAccounts: "Déjà protégés", recentSsoRequired: "Confirmez à nouveau par SSO avant de modifier la politique.", confirmSso: "Confirmer à nouveau par SSO", required: "MFA obligatoire", requiredHelp: "Les comptes non configurés suivront l'activation protégée lors de leur prochaine connexion.", ownerPassword: "Mot de passe du propriétaire", freshSso: "Cette action utilise votre récente confirmation SSO.", code: "Code MFA ou de récupération", save: "Enregistrer la politique", ownerOnly: "Seul le propriétaire de l'organisation peut modifier cette politique.",
  },
  messages: {
    genericFailure: "L'action de sécurité n'a pas pu être effectuée.", rateLimited: (seconds) => `Trop de tentatives de sécurité. Réessayez dans ${seconds} secondes.`, currentPasswordIncorrect: "Le mot de passe actuel est incorrect.", confirmAtProvider: "Confirmez à nouveau cette action auprès du fournisseur d'identité.", mfaNotEnabledForAccount: "La MFA n'est pas active pour ce compte.", codeIncorrect: "Le code MFA ou de récupération est incorrect.", privilegedOnly: "La MFA est gérée pour les propriétaires et administrateurs.", enterPassword: "Saisissez votre mot de passe actuel.", organizationUnavailable: "L'organisation est indisponible.", alreadyEnabled: "La MFA est déjà active.", scanAndConfirm: "Scannez le code QR et confirmez la configuration.", actionUnavailable: "Cette action est indisponible.", checkPasswordAndSixDigit: "Vérifiez le mot de passe et le code à six chiffres.", sessionExpired: "La session n'est plus active.", restartSetup: "Redémarrez la configuration MFA.", confirmationIncorrect: "Le code de confirmation est incorrect.", enabled: "La MFA est active. Enregistrez maintenant les codes de récupération.", checkPasswordAndCode: "Vérifiez le mot de passe et le code MFA.", notEnabled: "La MFA n'est pas active.", codesRegenerated: "De nouveaux codes ont été créés. Les anciens ne sont plus valides.", policyPreventsDisable: "La politique du propriétaire exige la MFA. Désactivez d'abord la politique.", disabled: "La MFA a été désactivée. Les autres sessions ont été fermées.", checkPolicyPasswordCode: "Vérifiez la politique, le mot de passe et le code MFA.", ownerNeedsMfa: "Configurez d'abord la MFA pour le compte propriétaire.", policyConflict: "La politique MFA a changé. Rechargez la page.", policyEnabled: "La MFA est désormais obligatoire pour les propriétaires et administrateurs.", policyDisabled: "La politique MFA obligatoire a été désactivée.", permissionChanged: "L'autorisation pour cette action de sécurité a changé.", primaryChanged: "La connexion principale a changé. Confirmez à nouveau l'action.",
  },
};

const dictionaries: Record<AppLocale, MfaCopy> = { de, en, it, es, fr };

const staffScopeCopy: Record<
  AppLocale,
  {
    policyDescription: string;
    privilegedOnly: string;
    policyEnabled: string;
  }
> = {
  de: {
    policyDescription: "MFA-Policy fuer Owner, Administratoren und Trainer",
    privilegedOnly: "MFA wird fuer alle Mitarbeiterkonten verwaltet.",
    policyEnabled:
      "MFA ist jetzt fuer Owner, Administratoren und Trainer verpflichtend.",
  },
  en: {
    policyDescription: "MFA policy for owners, administrators, and trainers",
    privilegedOnly: "MFA is managed for all staff accounts.",
    policyEnabled: "MFA is now required for owners, administrators, and trainers.",
  },
  it: {
    policyDescription: "Policy MFA per owner, amministratori e trainer",
    privilegedOnly: "MFA e gestita per tutti gli account dello staff.",
    policyEnabled: "MFA e ora obbligatoria per owner, amministratori e trainer.",
  },
  es: {
    policyDescription: "Politica MFA para propietarios, administradores y formadores",
    privilegedOnly: "MFA se gestiona para todas las cuentas del personal.",
    policyEnabled:
      "MFA es ahora obligatoria para propietarios, administradores y formadores.",
  },
  fr: {
    policyDescription:
      "Politique MFA pour les proprietaires, administrateurs et formateurs",
    privilegedOnly: "La MFA est geree pour tous les comptes du personnel.",
    policyEnabled:
      "La MFA est desormais obligatoire pour les proprietaires, administrateurs et formateurs.",
  },
};

export function getMfaCopy(locale: AppLocale): MfaCopy {
  const base = dictionaries[locale] ?? de;
  const scope = staffScopeCopy[locale] ?? staffScopeCopy.de;
  return {
    ...base,
    policy: { ...base.policy, description: scope.policyDescription },
    messages: {
      ...base.messages,
      privilegedOnly: scope.privilegedOnly,
      policyEnabled: scope.policyEnabled,
    },
  };
}

const messageKeys = {
  "Das aktuelle Passwort ist nicht korrekt.": "currentPasswordIncorrect",
  "Bitte bestaetige diese Sicherheitsaktion erneut beim Identity Provider.": "confirmAtProvider",
  "MFA ist fuer dieses Konto nicht aktiv.": "mfaNotEnabledForAccount",
  "Der MFA- oder Recovery-Code ist nicht korrekt.": "codeIncorrect",
  "MFA wird fuer Owner und Administratoren verwaltet.": "privilegedOnly",
  "Bitte gib dein aktuelles Passwort ein.": "enterPassword",
  "Die Organisation ist nicht verfuegbar.": "organizationUnavailable",
  "MFA ist bereits aktiv.": "alreadyEnabled",
  "Scanne den QR-Code und bestaetige die Einrichtung.": "scanAndConfirm",
  "Diese Aktion ist nicht verfuegbar.": "actionUnavailable",
  "Bitte pruefe Passwort und sechsstelligen Code.": "checkPasswordAndSixDigit",
  "Die Sitzung ist nicht mehr aktiv.": "sessionExpired",
  "Starte die MFA-Einrichtung erneut.": "restartSetup",
  "Der Bestaetigungscode ist nicht korrekt.": "confirmationIncorrect",
  "MFA ist aktiv. Speichere die Recovery-Codes jetzt.": "enabled",
  "Bitte pruefe Passwort und MFA-Code.": "checkPasswordAndCode",
  "MFA ist nicht aktiv.": "notEnabled",
  "Neue Recovery-Codes wurden erstellt. Alte Codes sind ungueltig.": "codesRegenerated",
  "Die Owner-Policy erzwingt MFA. Deaktiviere zuerst die Policy.": "policyPreventsDisable",
  "MFA wurde deaktiviert. Andere Sitzungen wurden beendet.": "disabled",
  "Bitte pruefe Policy, Passwort und MFA-Code.": "checkPolicyPasswordCode",
  "Richte zuerst MFA fuer dein Owner-Konto ein.": "ownerNeedsMfa",
  "Die MFA-Policy wurde zwischenzeitlich geaendert. Lade die Seite neu.": "policyConflict",
  "MFA ist jetzt fuer Owner und Administratoren verpflichtend.": "policyEnabled",
  "Die verpflichtende MFA-Policy wurde deaktiviert.": "policyDisabled",
  "Die Berechtigung fuer diese Sicherheitsaktion hat sich geaendert.": "permissionChanged",
  "Die Primaer-Anmeldung hat sich geaendert. Bitte bestaetige die Aktion erneut.": "primaryChanged",
} as const satisfies Record<string, keyof MfaCopy["messages"]>;

export function localizeMfaMessage(locale: AppLocale, message: string) {
  if (!message) return "";
  const messages = getMfaCopy(locale).messages;
  const rateLimit = /^Zu viele Sicherheitsversuche\. Bitte versuche es in (\d+) Sekunden erneut\.$/.exec(message);
  if (rateLimit) return messages.rateLimited(Number(rateLimit[1]));
  const key = messageKeys[message as keyof typeof messageKeys];
  if (key) {
    const translated = messages[key];
    return typeof translated === "string" ? translated : messages.genericFailure;
  }
  return locale === "de" ? message : messages.genericFailure;
}
