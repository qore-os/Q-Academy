import type { AppLocale } from "@/lib/i18n/model";

export type AuthPageCopy = {
  accountAccess: string;
  forgotTitle: string;
  forgotDescription: string;
  security: string;
  resetTitle: string;
  resetDescription: string;
  missingToken: string;
  requestNewLink: string;
  welcome: string;
  invitationTitle: string;
  invalidInvitation: string;
  backToLogin: string;
  activateWith: (name: string) => string;
  orPassword: string;
  email: string;
  requestLink: string;
  requesting: string;
  resetSent: string;
  localResetLink: string;
  newPassword: string;
  confirmPassword: string;
  passwordHint: string;
  passwordMismatch: string;
  savePassword: string;
  saving: string;
  passwordUpdated: string;
  signInNow: string;
  acceptInvitation: string;
  acceptingInvitation: string;
  requestFailed: string;
};

const copy: Record<AppLocale, AuthPageCopy> = {
  de: { accountAccess: "Kontozugriff", forgotTitle: "Passwort vergessen?", forgotDescription: "Fordere einen zeitlich begrenzten Link fuer dein Konto an.", security: "Sicherheit", resetTitle: "Neues Passwort setzen", resetDescription: "Der Link kann einmalig und nur innerhalb seines Zeitfensters verwendet werden.", missingToken: "Im Link fehlt das Reset-Token.", requestNewLink: "Neuen Link anfordern", welcome: "Willkommen", invitationTitle: "Academy-Zugang aktivieren", invalidInvitation: "Diese Einladung ist ungueltig, abgelaufen oder wurde bereits verwendet.", backToLogin: "Zurueck zur Anmeldung", activateWith: (name) => `Mit ${name} aktivieren`, orPassword: "Oder mit Passwort", email: "E-Mail-Adresse", requestLink: "Reset-Link anfordern", requesting: "Wird angefordert", resetSent: "Falls das Konto existiert, wurde ein Reset-Link versendet.", localResetLink: "Lokalen Reset-Link oeffnen", newPassword: "Neues Passwort", confirmPassword: "Passwort wiederholen", passwordHint: "Mindestens 10 Zeichen mit Gross- und Kleinbuchstaben sowie einer Zahl.", passwordMismatch: "Die Passwoerter stimmen nicht ueberein.", savePassword: "Passwort speichern", saving: "Wird gespeichert", passwordUpdated: "Dein Passwort wurde aktualisiert. Alle bisherigen Sitzungen wurden beendet.", signInNow: "Jetzt anmelden", acceptInvitation: "Einladung annehmen", acceptingInvitation: "Einladung wird aktiviert", requestFailed: "Die Anfrage konnte nicht verarbeitet werden." },
  en: { accountAccess: "Account access", forgotTitle: "Forgot your password?", forgotDescription: "Request a time-limited link for your account.", security: "Security", resetTitle: "Set a new password", resetDescription: "The link can be used once and only within its validity period.", missingToken: "The reset token is missing from the link.", requestNewLink: "Request a new link", welcome: "Welcome", invitationTitle: "Activate academy access", invalidInvitation: "This invitation is invalid, expired or has already been used.", backToLogin: "Back to sign-in", activateWith: (name) => `Activate with ${name}`, orPassword: "Or use a password", email: "Email address", requestLink: "Request reset link", requesting: "Requesting", resetSent: "If the account exists, a reset link has been sent.", localResetLink: "Open local reset link", newPassword: "New password", confirmPassword: "Repeat password", passwordHint: "At least 10 characters with upper- and lower-case letters and a number.", passwordMismatch: "The passwords do not match.", savePassword: "Save password", saving: "Saving", passwordUpdated: "Your password was updated. All previous sessions have ended.", signInNow: "Sign in now", acceptInvitation: "Accept invitation", acceptingInvitation: "Activating invitation", requestFailed: "The request could not be processed." },
  it: { accountAccess: "Accesso all'account", forgotTitle: "Password dimenticata?", forgotDescription: "Richiedi un link temporaneo per il tuo account.", security: "Sicurezza", resetTitle: "Imposta una nuova password", resetDescription: "Il link può essere usato una sola volta e solo entro il periodo di validità.", missingToken: "Nel link manca il token di ripristino.", requestNewLink: "Richiedi un nuovo link", welcome: "Benvenuto", invitationTitle: "Attiva l'accesso all'academy", invalidInvitation: "Questo invito non è valido, è scaduto o è già stato utilizzato.", backToLogin: "Torna all'accesso", activateWith: (name) => `Attiva con ${name}`, orPassword: "Oppure usa la password", email: "Indirizzo email", requestLink: "Richiedi link di ripristino", requesting: "Richiesta in corso", resetSent: "Se l'account esiste, è stato inviato un link di ripristino.", localResetLink: "Apri link di ripristino locale", newPassword: "Nuova password", confirmPassword: "Ripeti password", passwordHint: "Almeno 10 caratteri con maiuscole, minuscole e un numero.", passwordMismatch: "Le password non coincidono.", savePassword: "Salva password", saving: "Salvataggio", passwordUpdated: "La password è stata aggiornata. Tutte le sessioni precedenti sono terminate.", signInNow: "Accedi ora", acceptInvitation: "Accetta invito", acceptingInvitation: "Attivazione invito", requestFailed: "Non è stato possibile elaborare la richiesta." },
  es: { accountAccess: "Acceso a la cuenta", forgotTitle: "¿Olvidaste tu contraseña?", forgotDescription: "Solicita un enlace temporal para tu cuenta.", security: "Seguridad", resetTitle: "Establecer nueva contraseña", resetDescription: "El enlace solo puede usarse una vez y dentro de su periodo de validez.", missingToken: "Falta el token de restablecimiento en el enlace.", requestNewLink: "Solicitar nuevo enlace", welcome: "Bienvenido", invitationTitle: "Activar acceso a la academia", invalidInvitation: "Esta invitación no es válida, ha caducado o ya se ha utilizado.", backToLogin: "Volver al acceso", activateWith: (name) => `Activar con ${name}`, orPassword: "O usa una contraseña", email: "Correo electrónico", requestLink: "Solicitar enlace", requesting: "Solicitando", resetSent: "Si la cuenta existe, se ha enviado un enlace de restablecimiento.", localResetLink: "Abrir enlace local", newPassword: "Nueva contraseña", confirmPassword: "Repetir contraseña", passwordHint: "Al menos 10 caracteres con mayúsculas, minúsculas y un número.", passwordMismatch: "Las contraseñas no coinciden.", savePassword: "Guardar contraseña", saving: "Guardando", passwordUpdated: "Tu contraseña se ha actualizado. Todas las sesiones anteriores han finalizado.", signInNow: "Iniciar sesión", acceptInvitation: "Aceptar invitación", acceptingInvitation: "Activando invitación", requestFailed: "No se pudo procesar la solicitud." },
  fr: { accountAccess: "Accès au compte", forgotTitle: "Mot de passe oublié ?", forgotDescription: "Demandez un lien temporaire pour votre compte.", security: "Sécurité", resetTitle: "Définir un nouveau mot de passe", resetDescription: "Le lien ne peut être utilisé qu'une fois et pendant sa période de validité.", missingToken: "Le jeton de réinitialisation manque dans le lien.", requestNewLink: "Demander un nouveau lien", welcome: "Bienvenue", invitationTitle: "Activer l'accès à l'academy", invalidInvitation: "Cette invitation est invalide, expirée ou a déjà été utilisée.", backToLogin: "Retour à la connexion", activateWith: (name) => `Activer avec ${name}`, orPassword: "Ou utiliser un mot de passe", email: "Adresse e-mail", requestLink: "Demander un lien", requesting: "Demande en cours", resetSent: "Si le compte existe, un lien de réinitialisation a été envoyé.", localResetLink: "Ouvrir le lien local", newPassword: "Nouveau mot de passe", confirmPassword: "Répéter le mot de passe", passwordHint: "Au moins 10 caractères avec majuscules, minuscules et un chiffre.", passwordMismatch: "Les mots de passe ne correspondent pas.", savePassword: "Enregistrer le mot de passe", saving: "Enregistrement", passwordUpdated: "Votre mot de passe a été mis à jour. Toutes les sessions précédentes ont pris fin.", signInNow: "Se connecter", acceptInvitation: "Accepter l'invitation", acceptingInvitation: "Activation de l'invitation", requestFailed: "La demande n'a pas pu être traitée." },
};

export function getAuthPageCopy(locale: AppLocale) {
  return copy[locale];
}
