import type { DataFormMessageCode } from "@/lib/data-form-actions";
import type { AppLocale } from "@/lib/i18n/model";
import type { OidcSettingsMessageCode } from "@/lib/oidc-actions";

type Copy = {
  shell: {
    rolesAndPermissions: string;
    customLinks: string;
  };
  dataForm: {
    yes: string;
    selectOption: string;
    loading: string;
    noProfile: string;
    openProfile: string;
    profile: string;
    requestFailed: string;
    messages: Record<Exclude<DataFormMessageCode, "invalid_field">, string> & {
      invalidField: (label: string, required: boolean) => string;
    };
  };
  oidc: {
    title: string;
    description: string;
    active: string;
    ownerOnly: string;
    displayName: string;
    clientId: string;
    issuerUrl: string;
    clientSecret: string;
    unchangedSecret: string;
    removeSecret: string;
    allowedDomains: string;
    autoProvision: string;
    autoProvisionDescription: string;
    passwordLogin: string;
    passwordLoginDescription: string;
    redirectUri: string;
    connectionActive: string;
    connectionInactive: string;
    checking: string;
    checkAndSave: string;
    linkAccount: string;
    stepUpFailed: string;
    messages: Record<OidcSettingsMessageCode, string>;
  };
};

const copy: Record<AppLocale, Copy> = {
  de: {
    shell: { rolesAndPermissions: "Rollen & Rechte", customLinks: "Links" },
    dataForm: {
      yes: "Ja",
      selectOption: "Bitte auswaehlen",
      loading: "Formular wird geladen",
      noProfile: "Kein passendes Datenprofil vorhanden.",
      openProfile: "Zum Profil",
      profile: "Datenprofil",
      requestFailed: "Das Formular konnte nicht geladen werden.",
      messages: {
        invalid_form: "Ungueltiges Formular.",
        invalid_request: "Ungueltige Formular-Anfrage.",
        form_not_found: "Formular nicht gefunden.",
        source_denied: "Formular ist an dieser Stelle nicht freigegeben.",
        profile_not_found: "Datenprofil nicht gefunden.",
        profile_mismatch: "Datenprofil passt nicht zum Formular.",
        media_unavailable: "Ein Profilmedium ist nicht bereit oder gehoert nicht zu deinem Profil.",
        saved: "Angaben wurden gespeichert.",
        failed: "Die Angaben konnten nicht gespeichert werden.",
        invalidField: (label, required) => `Bitte den Wert fuer \"${label}\" pruefen${required ? " (Pflichtfeld)" : ""}.`,
      },
    },
    oidc: {
      title: "OpenID Connect",
      description: "Zentraler Unternehmens-Login mit Authorization Code und PKCE.",
      active: "Aktiv",
      ownerOnly: "Nur Owner koennen die SSO-Konfiguration aendern.",
      displayName: "Anzeigename",
      clientId: "Client-ID",
      issuerUrl: "Issuer-URL",
      clientSecret: "Client-Secret",
      unchangedSecret: "Unveraendert lassen",
      removeSecret: "Gespeichertes Client-Secret entfernen",
      allowedDomains: "Erlaubte E-Mail-Domains",
      autoProvision: "Mitglieder automatisch anlegen",
      autoProvisionDescription: "Neue, verifizierte Konten erlaubter Domains werden ausschliesslich als Mitglied angelegt.",
      passwordLogin: "Passwort-Login aktiviert",
      passwordLoginDescription: "Das Abschalten ist erst nach einem erfolgreichen SSO-Login eines aktiven Owners moeglich.",
      redirectUri: "Redirect-URI",
      connectionActive: "Verbindung aktiv",
      connectionInactive: "Verbindung inaktiv",
      checking: "Wird geprueft",
      checkAndSave: "Verbindung pruefen & speichern",
      linkAccount: "Mein Konto mit SSO verknuepfen",
      stepUpFailed: "Unternehmens-Login konnte nicht gestartet werden.",
      messages: {
        invalid_version: "Die Konfigurationsversion ist ungueltig. Bitte lade die Seite neu.",
        invalid_configuration: "Bitte pruefe die OIDC-Konfiguration.",
        configuration_changed: "Die Konfiguration wurde geaendert. Bitte lade die Seite neu.",
        provider_changes_require_password_login: "Speichere zuerst die Provider-Aenderungen, teste den Owner-Login per SSO und schalte den Passwort-Login danach separat ab.",
        owner_sso_required: "Vor dem Abschalten des Passwort-Logins muss ein aktiver Owner die aktuelle SSO-Konfiguration erfolgreich verwendet haben.",
        step_up_invalid_password: "Das aktuelle Owner-Passwort ist nicht korrekt.",
        step_up_rate_limited: "Zu viele Bestaetigungsversuche. Bitte versuche es spaeter erneut.",
        step_up_reauthentication_required: "Bestaetige diese SSO-Aenderung erneut beim Identity Provider.",
        step_up_mfa_required: "Bestaetige diese SSO-Aenderung mit deinem MFA- oder Recovery-Code.",
        step_up_mfa_invalid: "Der MFA- oder Recovery-Code ist nicht korrekt.",
        provider_rejected: "Die Provider-Konfiguration konnte nicht sicher geprueft werden.",
        saved: "Unternehmens-Login geprueft und gespeichert.",
        disabled: "Unternehmens-Login deaktiviert und gespeichert.",
        unchanged: "Keine Aenderungen gespeichert.",
        save_failed: "Der Unternehmens-Login konnte nicht gespeichert werden.",
      },
    },
  },
  en: {
    shell: { rolesAndPermissions: "Roles & permissions", customLinks: "Links" },
    dataForm: {
      yes: "Yes",
      selectOption: "Please select",
      loading: "Loading form",
      noProfile: "No matching data profile is available.",
      openProfile: "Open profile",
      profile: "Data profile",
      requestFailed: "The form could not be loaded.",
      messages: {
        invalid_form: "The form is invalid.",
        invalid_request: "The form request is invalid.",
        form_not_found: "The form was not found.",
        source_denied: "The form is not available in this location.",
        profile_not_found: "The data profile was not found.",
        profile_mismatch: "The data profile does not match this form.",
        media_unavailable: "A profile media item is not ready or does not belong to your profile.",
        saved: "Your details were saved.",
        failed: "Your details could not be saved.",
        invalidField: (label, required) => `Check the value for \"${label}\"${required ? " (required)" : ""}.`,
      },
    },
    oidc: {
      title: "OpenID Connect",
      description: "Central company sign-in using Authorization Code and PKCE.",
      active: "Active",
      ownerOnly: "Only owners can change the SSO configuration.",
      displayName: "Display name",
      clientId: "Client ID",
      issuerUrl: "Issuer URL",
      clientSecret: "Client secret",
      unchangedSecret: "Leave unchanged",
      removeSecret: "Remove stored client secret",
      allowedDomains: "Allowed email domains",
      autoProvision: "Create members automatically",
      autoProvisionDescription: "New verified accounts from allowed domains are created with the member role only.",
      passwordLogin: "Password sign-in enabled",
      passwordLoginDescription: "It can only be disabled after a successful SSO sign-in by an active owner.",
      redirectUri: "Redirect URI",
      connectionActive: "Connection active",
      connectionInactive: "Connection inactive",
      checking: "Checking",
      checkAndSave: "Check connection & save",
      linkAccount: "Link my account to SSO",
      stepUpFailed: "Company sign-in could not be started.",
      messages: {
        invalid_version: "The configuration version is invalid. Reload the page.",
        invalid_configuration: "Check the OIDC configuration.",
        configuration_changed: "The configuration changed. Reload the page.",
        provider_changes_require_password_login: "Save the provider changes first, test the owner sign-in through SSO, and disable password sign-in separately afterwards.",
        owner_sso_required: "Before disabling password sign-in, an active owner must successfully use the current SSO configuration.",
        step_up_invalid_password: "The current owner password is incorrect.",
        step_up_rate_limited: "Too many confirmation attempts. Try again later.",
        step_up_reauthentication_required: "Confirm this SSO change with the identity provider again.",
        step_up_mfa_required: "Confirm this SSO change with your MFA or recovery code.",
        step_up_mfa_invalid: "The MFA or recovery code is incorrect.",
        provider_rejected: "The provider configuration could not be verified securely.",
        saved: "Company sign-in was verified and saved.",
        disabled: "Company sign-in was disabled and saved.",
        unchanged: "No changes were saved.",
        save_failed: "Company sign-in could not be saved.",
      },
    },
  },
  it: {
    shell: { rolesAndPermissions: "Ruoli e autorizzazioni", customLinks: "Link" },
    dataForm: {
      yes: "Si",
      selectOption: "Seleziona",
      loading: "Caricamento del modulo",
      noProfile: "Non e disponibile un profilo dati adatto.",
      openProfile: "Apri il profilo",
      profile: "Profilo dati",
      requestFailed: "Non e stato possibile caricare il modulo.",
      messages: {
        invalid_form: "Il modulo non e valido.",
        invalid_request: "La richiesta del modulo non e valida.",
        form_not_found: "Modulo non trovato.",
        source_denied: "Il modulo non e disponibile in questa posizione.",
        profile_not_found: "Profilo dati non trovato.",
        profile_mismatch: "Il profilo dati non corrisponde al modulo.",
        media_unavailable: "Un contenuto multimediale non e pronto o non appartiene al tuo profilo.",
        saved: "I dati sono stati salvati.",
        failed: "Non e stato possibile salvare i dati.",
        invalidField: (label, required) => `Controlla il valore di \"${label}\"${required ? " (obbligatorio)" : ""}.`,
      },
    },
    oidc: {
      title: "OpenID Connect",
      description: "Accesso aziendale centralizzato con Authorization Code e PKCE.",
      active: "Attivo",
      ownerOnly: "Solo i proprietari possono modificare la configurazione SSO.",
      displayName: "Nome visualizzato",
      clientId: "ID client",
      issuerUrl: "URL issuer",
      clientSecret: "Segreto client",
      unchangedSecret: "Lascia invariato",
      removeSecret: "Rimuovi il segreto client salvato",
      allowedDomains: "Domini email consentiti",
      autoProvision: "Crea automaticamente i membri",
      autoProvisionDescription: "I nuovi account verificati dei domini consentiti vengono creati esclusivamente come membri.",
      passwordLogin: "Accesso con password attivo",
      passwordLoginDescription: "Puo essere disattivato solo dopo un accesso SSO riuscito di un proprietario attivo.",
      redirectUri: "URI di reindirizzamento",
      connectionActive: "Connessione attiva",
      connectionInactive: "Connessione inattiva",
      checking: "Verifica in corso",
      checkAndSave: "Verifica connessione e salva",
      linkAccount: "Collega il mio account a SSO",
      stepUpFailed: "Non e stato possibile avviare l'accesso aziendale.",
      messages: {
        invalid_version: "La versione della configurazione non e valida. Ricarica la pagina.",
        invalid_configuration: "Controlla la configurazione OIDC.",
        configuration_changed: "La configurazione e cambiata. Ricarica la pagina.",
        provider_changes_require_password_login: "Salva prima le modifiche del provider, verifica l'accesso SSO del proprietario e disattiva successivamente l'accesso con password separatamente.",
        owner_sso_required: "Prima di disattivare l'accesso con password, un proprietario attivo deve usare correttamente la configurazione SSO corrente.",
        step_up_invalid_password: "La password attuale dell'owner non e corretta.",
        step_up_rate_limited: "Troppi tentativi di conferma. Riprova piu tardi.",
        step_up_reauthentication_required: "Conferma nuovamente questa modifica SSO con l'Identity Provider.",
        step_up_mfa_required: "Conferma questa modifica SSO con il codice MFA o di recupero.",
        step_up_mfa_invalid: "Il codice MFA o di recupero non e corretto.",
        provider_rejected: "Non e stato possibile verificare in modo sicuro la configurazione del provider.",
        saved: "L'accesso aziendale e stato verificato e salvato.",
        disabled: "L'accesso aziendale e stato disattivato e salvato.",
        unchanged: "Nessuna modifica salvata.",
        save_failed: "Non e stato possibile salvare l'accesso aziendale.",
      },
    },
  },
  es: {
    shell: { rolesAndPermissions: "Roles y permisos", customLinks: "Enlaces" },
    dataForm: {
      yes: "Si",
      selectOption: "Selecciona una opcion",
      loading: "Cargando formulario",
      noProfile: "No hay un perfil de datos adecuado.",
      openProfile: "Abrir perfil",
      profile: "Perfil de datos",
      requestFailed: "No se pudo cargar el formulario.",
      messages: {
        invalid_form: "El formulario no es valido.",
        invalid_request: "La solicitud del formulario no es valida.",
        form_not_found: "No se encontro el formulario.",
        source_denied: "El formulario no esta disponible en esta ubicacion.",
        profile_not_found: "No se encontro el perfil de datos.",
        profile_mismatch: "El perfil de datos no corresponde al formulario.",
        media_unavailable: "Un recurso multimedia no esta listo o no pertenece a tu perfil.",
        saved: "Los datos se guardaron.",
        failed: "No se pudieron guardar los datos.",
        invalidField: (label, required) => `Revisa el valor de \"${label}\"${required ? " (obligatorio)" : ""}.`,
      },
    },
    oidc: {
      title: "OpenID Connect",
      description: "Acceso corporativo centralizado con Authorization Code y PKCE.",
      active: "Activo",
      ownerOnly: "Solo los propietarios pueden cambiar la configuracion SSO.",
      displayName: "Nombre visible",
      clientId: "ID de cliente",
      issuerUrl: "URL del emisor",
      clientSecret: "Secreto de cliente",
      unchangedSecret: "Dejar sin cambios",
      removeSecret: "Eliminar el secreto de cliente guardado",
      allowedDomains: "Dominios de correo permitidos",
      autoProvision: "Crear miembros automaticamente",
      autoProvisionDescription: "Las cuentas nuevas y verificadas de dominios permitidos se crean exclusivamente como miembros.",
      passwordLogin: "Acceso con contrasena activo",
      passwordLoginDescription: "Solo puede desactivarse tras un acceso SSO correcto de un propietario activo.",
      redirectUri: "URI de redireccion",
      connectionActive: "Conexion activa",
      connectionInactive: "Conexion inactiva",
      checking: "Comprobando",
      checkAndSave: "Comprobar conexion y guardar",
      linkAccount: "Vincular mi cuenta con SSO",
      stepUpFailed: "No se pudo iniciar el acceso corporativo.",
      messages: {
        invalid_version: "La version de la configuracion no es valida. Recarga la pagina.",
        invalid_configuration: "Revisa la configuracion OIDC.",
        configuration_changed: "La configuracion ha cambiado. Recarga la pagina.",
        provider_changes_require_password_login: "Guarda primero los cambios del proveedor, prueba el acceso SSO del propietario y desactiva despues el acceso con contrasena por separado.",
        owner_sso_required: "Antes de desactivar el acceso con contrasena, un propietario activo debe usar correctamente la configuracion SSO actual.",
        step_up_invalid_password: "La contrasena actual del owner no es correcta.",
        step_up_rate_limited: "Demasiados intentos de confirmacion. Intentalo de nuevo mas tarde.",
        step_up_reauthentication_required: "Confirma de nuevo este cambio SSO con el proveedor de identidad.",
        step_up_mfa_required: "Confirma este cambio SSO con tu codigo MFA o de recuperacion.",
        step_up_mfa_invalid: "El codigo MFA o de recuperacion no es correcto.",
        provider_rejected: "No se pudo verificar de forma segura la configuracion del proveedor.",
        saved: "El acceso corporativo se verifico y guardo.",
        disabled: "El acceso corporativo se desactivo y guardo.",
        unchanged: "No se guardaron cambios.",
        save_failed: "No se pudo guardar el acceso corporativo.",
      },
    },
  },
  fr: {
    shell: { rolesAndPermissions: "Roles et autorisations", customLinks: "Liens" },
    dataForm: {
      yes: "Oui",
      selectOption: "Veuillez selectionner",
      loading: "Chargement du formulaire",
      noProfile: "Aucun profil de donnees adapte n'est disponible.",
      openProfile: "Ouvrir le profil",
      profile: "Profil de donnees",
      requestFailed: "Le formulaire n'a pas pu etre charge.",
      messages: {
        invalid_form: "Le formulaire n'est pas valide.",
        invalid_request: "La demande de formulaire n'est pas valide.",
        form_not_found: "Le formulaire est introuvable.",
        source_denied: "Le formulaire n'est pas disponible a cet emplacement.",
        profile_not_found: "Le profil de donnees est introuvable.",
        profile_mismatch: "Le profil de donnees ne correspond pas au formulaire.",
        media_unavailable: "Un media de profil n'est pas pret ou n'appartient pas a votre profil.",
        saved: "Les informations ont ete enregistrees.",
        failed: "Les informations n'ont pas pu etre enregistrees.",
        invalidField: (label, required) => `Verifiez la valeur de \"${label}\"${required ? " (obligatoire)" : ""}.`,
      },
    },
    oidc: {
      title: "OpenID Connect",
      description: "Connexion d'entreprise centralisee avec Authorization Code et PKCE.",
      active: "Actif",
      ownerOnly: "Seuls les proprietaires peuvent modifier la configuration SSO.",
      displayName: "Nom affiche",
      clientId: "ID client",
      issuerUrl: "URL de l'emetteur",
      clientSecret: "Secret client",
      unchangedSecret: "Laisser inchange",
      removeSecret: "Supprimer le secret client enregistre",
      allowedDomains: "Domaines e-mail autorises",
      autoProvision: "Creer automatiquement les membres",
      autoProvisionDescription: "Les nouveaux comptes verifies des domaines autorises sont crees uniquement comme membres.",
      passwordLogin: "Connexion par mot de passe activee",
      passwordLoginDescription: "Elle ne peut etre desactivee qu'apres une connexion SSO reussie d'un proprietaire actif.",
      redirectUri: "URI de redirection",
      connectionActive: "Connexion active",
      connectionInactive: "Connexion inactive",
      checking: "Verification",
      checkAndSave: "Verifier la connexion et enregistrer",
      linkAccount: "Lier mon compte au SSO",
      stepUpFailed: "La connexion d'entreprise n'a pas pu etre lancee.",
      messages: {
        invalid_version: "La version de configuration n'est pas valide. Rechargez la page.",
        invalid_configuration: "Verifiez la configuration OIDC.",
        configuration_changed: "La configuration a change. Rechargez la page.",
        provider_changes_require_password_login: "Enregistrez d'abord les modifications du fournisseur, testez la connexion SSO du proprietaire, puis desactivez separement la connexion par mot de passe.",
        owner_sso_required: "Avant de desactiver la connexion par mot de passe, un proprietaire actif doit utiliser avec succes la configuration SSO actuelle.",
        step_up_invalid_password: "Le mot de passe actuel du proprietaire est incorrect.",
        step_up_rate_limited: "Trop de tentatives de confirmation. Reessayez plus tard.",
        step_up_reauthentication_required: "Confirmez a nouveau cette modification SSO aupres du fournisseur d'identite.",
        step_up_mfa_required: "Confirmez cette modification SSO avec votre code MFA ou de recuperation.",
        step_up_mfa_invalid: "Le code MFA ou de recuperation est incorrect.",
        provider_rejected: "La configuration du fournisseur n'a pas pu etre verifiee de maniere sure.",
        saved: "La connexion d'entreprise a ete verifiee et enregistree.",
        disabled: "La connexion d'entreprise a ete desactivee et enregistree.",
        unchanged: "Aucune modification n'a ete enregistree.",
        save_failed: "La connexion d'entreprise n'a pas pu etre enregistree.",
      },
    },
  },
};

export function getSystemExperienceCopy(locale: AppLocale) {
  return copy[locale];
}

export function resolveDataFormMessage(
  locale: AppLocale,
  state: { messageCode?: DataFormMessageCode; fieldLabel?: string; required?: boolean },
) {
  const messages = copy[locale].dataForm.messages;
  if (state.messageCode === "invalid_field") {
    return messages.invalidField(state.fieldLabel ?? "", Boolean(state.required));
  }
  return messages[state.messageCode ?? "failed"];
}

export function resolveOidcSettingsMessage(
  locale: AppLocale,
  code: OidcSettingsMessageCode | undefined,
) {
  return copy[locale].oidc.messages[code ?? "save_failed"];
}
