import type { AppLocale } from "@/lib/i18n/model";

export type EmailDeliveryMessageCode =
  | "emailDelivery.invalid"
  | "emailDelivery.queued"
  | "emailDelivery.alreadyQueued"
  | "emailDelivery.retryFailed";

type DeliveryStatus =
  | "pending"
  | "processing"
  | "delivered"
  | "failed"
  | "retrying";

type RecipientRole = "owner" | "admin" | "trainer" | "member";
type RecipientStatus = "active" | "invited" | "disabled";

type EmailDeliveryCopy = {
  metadataTitle: string;
  eyebrow: string;
  title: string;
  back: string;
  fields: {
    status: string;
    attempts: string;
    created: string;
    updated: string;
    content: string;
    recipient: string;
    gateway: string;
    httpStatus: string;
    accepted: string;
    nextAttempt: string;
  };
  statuses: Record<DeliveryStatus, string>;
  roles: Record<RecipientRole, string>;
  recipientStatuses: Record<RecipientStatus, string>;
  events: Record<string, string>;
  linksRedacted: string;
  hiddenContent: {
    authentication_link: string;
    unsupported_event: string;
    invalid_payload: string;
  };
  failures: {
    gatewayHttp: (status: number) => string;
    notConfigured: string;
    recipientUnavailable: string;
    generic: string;
  };
  retry: {
    pending: string;
    submit: string;
  };
  messages: Record<EmailDeliveryMessageCode, string>;
};

const de: EmailDeliveryCopy = {
  metadataTitle: "Versanddetails",
  eyebrow: "E-Mail-Center",
  title: "Versanddetails",
  back: "Zurueck",
  fields: { status: "Status", attempts: "Versuche", created: "Erstellt", updated: "Aktualisiert", content: "Inhalt", recipient: "Empfaenger", gateway: "Gateway", httpStatus: "HTTP-Status", accepted: "Angenommen", nextAttempt: "Naechster Versuch" },
  statuses: { pending: "Vorgemerkt", processing: "In Verarbeitung", delivered: "Vom Gateway angenommen", failed: "Fehlgeschlagen", retrying: "Wird erneut versucht" },
  roles: { owner: "Inhaber", admin: "Administrator", trainer: "Trainer", member: "Mitglied" },
  recipientStatuses: { active: "Aktiv", invited: "Eingeladen", disabled: "Deaktiviert" },
  events: { "feedback.reply": "Feedback-Antwort", "lesson.available": "Lektion verfuegbar", "course.modules.released": "Kursmodule freigegeben", "event.rescheduled": "Event neu geplant", "event.cancelled": "Event abgesagt", "email.template.test": "Vorlagen-Test", "invitation.created": "Einladung", "password.reset": "Passwort zuruecksetzen" },
  linksRedacted: "Links und Tokens ausgeblendet",
  hiddenContent: { authentication_link: "Inhalte von Authentifizierungs-E-Mails werden nicht angezeigt.", unsupported_event: "Fuer diesen E-Mail-Typ ist keine Inhaltsansicht verfuegbar.", invalid_payload: "Der gespeicherte Inhalt konnte nicht sicher dargestellt werden." },
  failures: { gatewayHttp: (status) => `Das Mail-Gateway antwortete mit HTTP ${status}.`, notConfigured: "Die E-Mail-Zustellung ist nicht konfiguriert.", recipientUnavailable: "Die E-Mail wurde nicht zugestellt, weil der Empfaenger nicht mehr zulaessig ist.", generic: "Die E-Mail-Zustellung ist fehlgeschlagen." },
  retry: { pending: "Wird vorgemerkt", submit: "Erneut senden" },
  messages: { "emailDelivery.invalid": "E-Mail-Versand nicht gefunden.", "emailDelivery.queued": "Erneuter Versand wurde vorgemerkt.", "emailDelivery.alreadyQueued": "Der erneute Versand ist bereits vorgemerkt.", "emailDelivery.retryFailed": "Der Versand konnte nicht erneut vorgemerkt werden." },
};

const en: EmailDeliveryCopy = {
  metadataTitle: "Delivery details",
  eyebrow: "Email centre",
  title: "Delivery details",
  back: "Back",
  fields: { status: "Status", attempts: "Attempts", created: "Created", updated: "Updated", content: "Content", recipient: "Recipient", gateway: "Gateway", httpStatus: "HTTP status", accepted: "Accepted", nextAttempt: "Next attempt" },
  statuses: { pending: "Queued", processing: "Processing", delivered: "Accepted by gateway", failed: "Failed", retrying: "Retrying" },
  roles: { owner: "Owner", admin: "Administrator", trainer: "Trainer", member: "Member" },
  recipientStatuses: { active: "Active", invited: "Invited", disabled: "Disabled" },
  events: { "feedback.reply": "Feedback reply", "lesson.available": "Lesson available", "course.modules.released": "Course modules released", "event.rescheduled": "Event rescheduled", "event.cancelled": "Event cancelled", "email.template.test": "Template test", "invitation.created": "Invitation", "password.reset": "Password reset" },
  linksRedacted: "Links and tokens hidden",
  hiddenContent: { authentication_link: "Content from authentication emails is not displayed.", unsupported_event: "A content view is not available for this email type.", invalid_payload: "The stored content could not be displayed safely." },
  failures: { gatewayHttp: (status) => `The mail gateway responded with HTTP ${status}.`, notConfigured: "Email delivery is not configured.", recipientUnavailable: "The email was not delivered because the recipient is no longer eligible.", generic: "Email delivery failed." },
  retry: { pending: "Queueing", submit: "Send again" },
  messages: { "emailDelivery.invalid": "The email delivery was not found.", "emailDelivery.queued": "The email was queued for another delivery attempt.", "emailDelivery.alreadyQueued": "Another delivery attempt is already queued.", "emailDelivery.retryFailed": "The email could not be queued for another attempt." },
};

const it: EmailDeliveryCopy = {
  metadataTitle: "Dettagli dell'invio",
  eyebrow: "Centro email",
  title: "Dettagli dell'invio",
  back: "Indietro",
  fields: { status: "Stato", attempts: "Tentativi", created: "Creato", updated: "Aggiornato", content: "Contenuto", recipient: "Destinatario", gateway: "Gateway", httpStatus: "Stato HTTP", accepted: "Accettato", nextAttempt: "Prossimo tentativo" },
  statuses: { pending: "In coda", processing: "In elaborazione", delivered: "Accettato dal gateway", failed: "Non riuscito", retrying: "Nuovo tentativo" },
  roles: { owner: "Proprietario", admin: "Amministratore", trainer: "Formatore", member: "Membro" },
  recipientStatuses: { active: "Attivo", invited: "Invitato", disabled: "Disattivato" },
  events: { "feedback.reply": "Risposta al feedback", "lesson.available": "Lezione disponibile", "course.modules.released": "Moduli del corso pubblicati", "event.rescheduled": "Evento riprogrammato", "event.cancelled": "Evento annullato", "email.template.test": "Test del modello", "invitation.created": "Invito", "password.reset": "Reimpostazione password" },
  linksRedacted: "Link e token nascosti",
  hiddenContent: { authentication_link: "Il contenuto delle email di autenticazione non viene mostrato.", unsupported_event: "La visualizzazione del contenuto non e disponibile per questo tipo di email.", invalid_payload: "Non e stato possibile mostrare in sicurezza il contenuto memorizzato." },
  failures: { gatewayHttp: (status) => `Il gateway email ha risposto con HTTP ${status}.`, notConfigured: "L'invio email non e configurato.", recipientUnavailable: "L'email non e stata consegnata perche il destinatario non e piu idoneo.", generic: "L'invio email non e riuscito." },
  retry: { pending: "Inserimento in coda", submit: "Invia di nuovo" },
  messages: { "emailDelivery.invalid": "L'invio email non e stato trovato.", "emailDelivery.queued": "L'email e stata messa in coda per un nuovo tentativo.", "emailDelivery.alreadyQueued": "Un nuovo tentativo e gia in coda.", "emailDelivery.retryFailed": "Non e stato possibile mettere in coda un nuovo tentativo." },
};

const es: EmailDeliveryCopy = {
  metadataTitle: "Detalles del envio",
  eyebrow: "Centro de correo",
  title: "Detalles del envio",
  back: "Volver",
  fields: { status: "Estado", attempts: "Intentos", created: "Creado", updated: "Actualizado", content: "Contenido", recipient: "Destinatario", gateway: "Gateway", httpStatus: "Estado HTTP", accepted: "Aceptado", nextAttempt: "Proximo intento" },
  statuses: { pending: "En cola", processing: "Procesando", delivered: "Aceptado por el gateway", failed: "Fallido", retrying: "Reintentando" },
  roles: { owner: "Propietario", admin: "Administrador", trainer: "Formador", member: "Miembro" },
  recipientStatuses: { active: "Activo", invited: "Invitado", disabled: "Desactivado" },
  events: { "feedback.reply": "Respuesta de feedback", "lesson.available": "Leccion disponible", "course.modules.released": "Modulos del curso publicados", "event.rescheduled": "Evento reprogramado", "event.cancelled": "Evento cancelado", "email.template.test": "Prueba de plantilla", "invitation.created": "Invitacion", "password.reset": "Restablecimiento de contrasena" },
  linksRedacted: "Enlaces y tokens ocultos",
  hiddenContent: { authentication_link: "No se muestra el contenido de los correos de autenticacion.", unsupported_event: "No hay una vista de contenido disponible para este tipo de correo.", invalid_payload: "El contenido almacenado no se pudo mostrar de forma segura." },
  failures: { gatewayHttp: (status) => `El gateway de correo respondio con HTTP ${status}.`, notConfigured: "El envio de correo no esta configurado.", recipientUnavailable: "El correo no se entrego porque el destinatario ya no cumple los requisitos.", generic: "El envio de correo ha fallado." },
  retry: { pending: "Poniendo en cola", submit: "Enviar de nuevo" },
  messages: { "emailDelivery.invalid": "No se encontro el envio de correo.", "emailDelivery.queued": "El correo se ha puesto en cola para un nuevo intento.", "emailDelivery.alreadyQueued": "Ya hay un nuevo intento en cola.", "emailDelivery.retryFailed": "No se pudo poner en cola un nuevo intento." },
};

const fr: EmailDeliveryCopy = {
  metadataTitle: "Details de l'envoi",
  eyebrow: "Centre e-mail",
  title: "Details de l'envoi",
  back: "Retour",
  fields: { status: "Statut", attempts: "Tentatives", created: "Cree", updated: "Mis a jour", content: "Contenu", recipient: "Destinataire", gateway: "Passerelle", httpStatus: "Statut HTTP", accepted: "Accepte", nextAttempt: "Prochaine tentative" },
  statuses: { pending: "En attente", processing: "Traitement", delivered: "Accepte par la passerelle", failed: "Echec", retrying: "Nouvelle tentative" },
  roles: { owner: "Proprietaire", admin: "Administrateur", trainer: "Formateur", member: "Membre" },
  recipientStatuses: { active: "Actif", invited: "Invite", disabled: "Desactive" },
  events: { "feedback.reply": "Reponse au feedback", "lesson.available": "Lecon disponible", "course.modules.released": "Modules du cours publies", "event.rescheduled": "Evenement reprogramme", "event.cancelled": "Evenement annule", "email.template.test": "Test du modele", "invitation.created": "Invitation", "password.reset": "Reinitialisation du mot de passe" },
  linksRedacted: "Liens et jetons masques",
  hiddenContent: { authentication_link: "Le contenu des e-mails d'authentification n'est pas affiche.", unsupported_event: "Aucun apercu du contenu n'est disponible pour ce type d'e-mail.", invalid_payload: "Le contenu enregistre n'a pas pu etre affiche de maniere sure." },
  failures: { gatewayHttp: (status) => `La passerelle e-mail a repondu avec le statut HTTP ${status}.`, notConfigured: "L'envoi d'e-mails n'est pas configure.", recipientUnavailable: "L'e-mail n'a pas ete livre, car le destinataire n'est plus autorise.", generic: "L'envoi de l'e-mail a echoue." },
  retry: { pending: "Mise en file", submit: "Renvoyer" },
  messages: { "emailDelivery.invalid": "L'envoi de l'e-mail est introuvable.", "emailDelivery.queued": "L'e-mail a ete mis en file pour une nouvelle tentative.", "emailDelivery.alreadyQueued": "Une nouvelle tentative est deja en file.", "emailDelivery.retryFailed": "L'e-mail n'a pas pu etre remis en file." },
};

const catalogs = { de, en, it, es, fr } satisfies Record<AppLocale, EmailDeliveryCopy>;

export function getEmailDeliveryCopy(locale: AppLocale): EmailDeliveryCopy {
  return catalogs[locale];
}

export function localizeEmailDeliveryFailure(
  locale: AppLocale,
  input: { responseStatus: number | null; failureSummary: string | null },
) {
  if (!input.failureSummary) return null;
  const copy = getEmailDeliveryCopy(locale).failures;
  if (input.responseStatus) return copy.gatewayHttp(input.responseStatus);
  if (input.failureSummary === "Die E-Mail-Zustellung ist nicht konfiguriert.") {
    return copy.notConfigured;
  }
  if (
    input.failureSummary ===
    "Die E-Mail wurde nicht zugestellt, weil der Empfaenger nicht mehr zulaessig ist."
  ) {
    return copy.recipientUnavailable;
  }
  return copy.generic;
}
