import type { AppLocale } from "@/lib/i18n/model";

export const COMMUNITY_ACTION_CODES = [
  "invalidRichContent",
  "contentInvalid",
  "contentNotFound",
  "contentChanged",
  "contentForbidden",
  "contentCreateFailed",
  "contentRateLimited",
  "contentCreated",
  "contentSaveFailed",
  "contentSaved",
  "contentDeleteFailed",
  "contentDeleted",
  "profileIncomplete",
  "reportInvalid",
  "reportRateLimited",
  "reportContentMissing",
  "reportOwnContent",
  "reportDuplicate",
  "reportSubmitted",
  "reportFailed",
  "appealInvalid",
  "appealNotFound",
  "appealUnavailable",
  "appealSubmitted",
  "appealFailed",
  "followSaved",
  "followRemoved",
  "followSaveFailed",
  "followRemoveFailed",
  "authorBoostSaved",
  "authorBoostRemoved",
  "authorBoostSaveFailed",
  "authorBoostRemoveFailed",
] as const;

export type CommunityActionCode = (typeof COMMUNITY_ACTION_CODES)[number];
export type CommunityActionParams = Record<
  string,
  string | number | boolean
>;

export type CommunityLocalizedActionState = Readonly<{
  code?: CommunityActionCode;
  params?: CommunityActionParams;
}>;

type ContentTarget = "post" | "answer" | "content";
type ContentOperation = "edit" | "delete";
type ModerationState = "pending" | "held" | "published";

type CommunityActionCopy = Readonly<{
  invalidRichContent: string;
  contentInvalid: (target: ContentTarget) => string;
  contentNotFound: (target: ContentTarget) => string;
  contentChanged: (target: ContentTarget) => string;
  contentForbidden: (
    target: ContentTarget,
    operation: ContentOperation,
  ) => string;
  contentCreateFailed: (target: ContentTarget) => string;
  contentRateLimited: (target: ContentTarget) => string;
  contentCreated: (
    target: ContentTarget,
    moderationState: ModerationState,
  ) => string;
  contentSaveFailed: (target: ContentTarget) => string;
  contentSaved: (
    target: ContentTarget,
    moderationState: ModerationState,
  ) => string;
  contentDeleteFailed: (target: ContentTarget) => string;
  contentDeleted: (target: ContentTarget) => string;
  profileIncomplete: string;
  reportInvalid: string;
  reportRateLimited: string;
  reportContentMissing: string;
  reportOwnContent: string;
  reportDuplicate: string;
  reportSubmitted: (held: boolean) => string;
  reportFailed: string;
  appealInvalid: string;
  appealNotFound: string;
  appealUnavailable: string;
  appealSubmitted: string;
  appealFailed: string;
  followSaved: string;
  followRemoved: string;
  followSaveFailed: string;
  followRemoveFailed: string;
  authorBoostSaved: string;
  authorBoostRemoved: string;
  authorBoostSaveFailed: string;
  authorBoostRemoveFailed: string;
  notification: Readonly<{
    reportHeldTitle: string;
    reportHeldBody: string;
    followedPostTitle: string;
    followedPostBody: (authorName: string, postTitle: string | null) => string;
    replyTitle: (threadReply: boolean) => string;
    replyBody: (authorName: string) => string;
    mentionTitle: string;
    mentionBody: (authorName: string) => string;
    reportReviewedTitle: string;
    reportReviewedBody: (dismissed: boolean) => string;
    contentDecisionTitle: (rejected: boolean) => string;
    contentDecisionBody: (rejected: boolean) => string;
    appealDecisionTitle: string;
    appealDecisionBody: (overturned: boolean) => string;
  }>;
}>;

const dictionaries: Record<AppLocale, CommunityActionCopy> = {
  de: {
    invalidRichContent: "Der formatierte Community-Inhalt ist ungültig.",
    contentInvalid: (target) =>
      target === "post"
        ? "Der Beitrag ist ungültig."
        : target === "answer"
          ? "Die Antwort ist ungültig."
          : "Der Community-Inhalt ist ungültig.",
    contentNotFound: (target) =>
      target === "post"
        ? "Der Beitrag wurde nicht gefunden."
        : target === "answer"
          ? "Die Antwort wurde nicht gefunden."
          : "Der Community-Inhalt wurde nicht gefunden.",
    contentChanged: (target) =>
      `${target === "answer" ? "Die Antwort" : target === "post" ? "Der Beitrag" : "Der Inhalt"} wurde zwischenzeitlich geändert. Lade die Seite neu und versuche es erneut.`,
    contentForbidden: (target, operation) =>
      `Du kannst nur eigene ${target === "answer" ? "Antworten" : target === "post" ? "Beiträge" : "Inhalte"} ${operation === "delete" ? "löschen" : "bearbeiten"}.`,
    contentCreateFailed: (target) =>
      target === "answer"
        ? "Die Antwort konnte nicht veröffentlicht werden."
        : "Der Beitrag konnte nicht veröffentlicht werden.",
    contentRateLimited: (target) =>
      target === "answer"
        ? "Zu viele Community-Antworten. Bitte versuche es später erneut."
        : "Zu viele Community-Beiträge. Bitte versuche es später erneut.",
    contentCreated: (target, moderationState) =>
      moderationState === "pending"
        ? `${target === "answer" ? "Antwort" : "Beitrag"} wurde zur Freigabe eingereicht.`
        : moderationState === "held"
          ? `${target === "answer" ? "Antwort" : "Beitrag"} wird vor der Veröffentlichung geprüft.`
          : `${target === "answer" ? "Antwort" : "Beitrag"} veröffentlicht.`,
    contentSaveFailed: (target) =>
      target === "answer"
        ? "Die Antwort konnte nicht gespeichert werden."
        : target === "post"
          ? "Der Beitrag konnte nicht gespeichert werden."
          : "Der Community-Inhalt konnte nicht gespeichert werden.",
    contentSaved: (target, moderationState) =>
      moderationState === "pending"
        ? "Die Änderung wurde zur Freigabe eingereicht."
        : moderationState === "held"
          ? "Die Änderung wird vor der Veröffentlichung geprüft."
          : target === "answer"
            ? "Antwort gespeichert."
            : "Beitrag gespeichert.",
    contentDeleteFailed: (target) =>
      target === "answer"
        ? "Die Antwort konnte nicht gelöscht werden."
        : "Der Beitrag konnte nicht gelöscht werden.",
    contentDeleted: (target) =>
      target === "answer" ? "Antwort gelöscht." : "Beitrag gelöscht.",
    profileIncomplete: "Vervollständige zuerst dein Community-Profil.",
    reportInvalid: "Prüfe den Grund und die Beschreibung der Meldung.",
    reportRateLimited:
      "Zu viele Meldungen. Bitte versuche es später erneut.",
    reportContentMissing: "Der gemeldete Inhalt ist nicht mehr vorhanden.",
    reportOwnContent: "Eigene Inhalte kannst du bearbeiten oder löschen.",
    reportDuplicate: "Du hast diesen Inhalt bereits gemeldet.",
    reportSubmitted: (held) =>
      held
        ? "Meldung gesendet. Der Inhalt wird bis zur Prüfung zurückgehalten."
        : "Meldung vertraulich an das Academy-Team gesendet.",
    reportFailed: "Die Meldung konnte nicht gesendet werden.",
    appealInvalid: "Der Einspruch muss zwischen 3 und 2000 Zeichen enthalten.",
    appealNotFound: "Die Moderationseinreichung wurde nicht gefunden.",
    appealUnavailable: "Für diese Einreichung ist kein Einspruch möglich.",
    appealSubmitted: "Einspruch eingereicht.",
    appealFailed: "Der Einspruch konnte nicht eingereicht werden.",
    followSaved: "Du folgst diesem Community-Inhalt jetzt.",
    followRemoved: "Du folgst diesem Community-Inhalt nicht mehr.",
    followSaveFailed: "Der Follow konnte nicht gespeichert werden.",
    followRemoveFailed: "Der Follow konnte nicht entfernt werden.",
    authorBoostSaved: "Autoren-Boost gespeichert.",
    authorBoostRemoved: "Autoren-Boost entfernt.",
    authorBoostSaveFailed: "Der Autoren-Boost konnte nicht gespeichert werden.",
    authorBoostRemoveFailed: "Der Autoren-Boost konnte nicht entfernt werden.",
    notification: {
      reportHeldTitle: "Community-Inhalt wird geprüft",
      reportHeldBody:
        "Ein von dir veröffentlichter Inhalt wurde vorübergehend zur Moderationsprüfung zurückgehalten.",
      followedPostTitle: "Neuer Community-Beitrag",
      followedPostBody: (authorName, postTitle) =>
        `${authorName} hat einen neuen Beitrag veröffentlicht${postTitle ? `: ${postTitle}.` : "."}`,
      replyTitle: (threadReply) =>
        threadReply ? "Neue Antwort in deinem Thread" : "Neue Community-Antwort",
      replyBody: (authorName) =>
        `${authorName} hat auf einen Community-Beitrag geantwortet.`,
      mentionTitle: "Du wurdest in der Community erwähnt",
      mentionBody: (authorName) =>
        `${authorName} hat dich in einem Community-Beitrag erwähnt.`,
      reportReviewedTitle: "Community-Meldung geprüft",
      reportReviewedBody: (dismissed) =>
        dismissed
          ? "Das Academy-Team hat deine Meldung geprüft und abgeschlossen."
          : "Das Academy-Team hat deine Meldung geprüft und den Inhalt verborgen.",
      contentDecisionTitle: (rejected) =>
        rejected ? "Community-Inhalt moderiert" : "Community-Inhalt freigegeben",
      contentDecisionBody: (rejected) =>
        rejected
          ? "Ein von dir veröffentlichter Inhalt wurde nach einer Moderationsprüfung abgelehnt. Du kannst die Entscheidung in deinen Einreichungen prüfen."
          : "Ein von dir eingereichter Inhalt wurde freigegeben und ist wieder sichtbar.",
      appealDecisionTitle: "Einspruch entschieden",
      appealDecisionBody: (overturned) =>
        overturned
          ? "Dein Einspruch wurde angenommen. Der Community-Inhalt ist wieder sichtbar."
          : "Dein Einspruch wurde geprüft. Die Moderationsentscheidung bleibt bestehen.",
    },
  },
  en: {
    invalidRichContent: "The formatted community content is invalid.",
    contentInvalid: (target) =>
      target === "post"
        ? "The post is invalid."
        : target === "answer"
          ? "The reply is invalid."
          : "The community content is invalid.",
    contentNotFound: (target) =>
      target === "post"
        ? "The post was not found."
        : target === "answer"
          ? "The reply was not found."
          : "The community content was not found.",
    contentChanged: (target) =>
      `${target === "answer" ? "The reply" : target === "post" ? "The post" : "The content"} changed in the meantime. Reload the page and try again.`,
    contentForbidden: (target, operation) =>
      `You can only ${operation === "delete" ? "delete" : "edit"} your own ${target === "answer" ? "replies" : target === "post" ? "posts" : "content"}.`,
    contentCreateFailed: (target) =>
      target === "answer"
        ? "The reply could not be published."
        : "The post could not be published.",
    contentRateLimited: (target) =>
      target === "answer"
        ? "Too many community replies. Please try again later."
        : "Too many community posts. Please try again later.",
    contentCreated: (target, moderationState) =>
      moderationState === "pending"
        ? `The ${target === "answer" ? "reply" : "post"} was submitted for approval.`
        : moderationState === "held"
          ? `The ${target === "answer" ? "reply" : "post"} is being reviewed before publication.`
          : `${target === "answer" ? "Reply" : "Post"} published.`,
    contentSaveFailed: (target) =>
      target === "answer"
        ? "The reply could not be saved."
        : target === "post"
          ? "The post could not be saved."
          : "The community content could not be saved.",
    contentSaved: (target, moderationState) =>
      moderationState === "pending"
        ? "The change was submitted for approval."
        : moderationState === "held"
          ? "The change is being reviewed before publication."
          : target === "answer"
            ? "Reply saved."
            : "Post saved.",
    contentDeleteFailed: (target) =>
      target === "answer"
        ? "The reply could not be deleted."
        : "The post could not be deleted.",
    contentDeleted: (target) =>
      target === "answer" ? "Reply deleted." : "Post deleted.",
    profileIncomplete: "Complete your community profile first.",
    reportInvalid: "Check the report reason and description.",
    reportRateLimited: "Too many reports. Try again later.",
    reportContentMissing: "The reported content is no longer available.",
    reportOwnContent: "You can edit or delete your own content.",
    reportDuplicate: "You have already reported this content.",
    reportSubmitted: (held) =>
      held
        ? "Report sent. The content is being held until it is reviewed."
        : "Report sent confidentially to the academy team.",
    reportFailed: "The report could not be sent.",
    appealInvalid: "The appeal must contain between 3 and 2,000 characters.",
    appealNotFound: "The moderation submission was not found.",
    appealUnavailable: "This submission cannot be appealed.",
    appealSubmitted: "Appeal submitted.",
    appealFailed: "The appeal could not be submitted.",
    followSaved: "You are now following this community content.",
    followRemoved: "You are no longer following this community content.",
    followSaveFailed: "The follow could not be saved.",
    followRemoveFailed: "The follow could not be removed.",
    authorBoostSaved: "Author boost saved.",
    authorBoostRemoved: "Author boost removed.",
    authorBoostSaveFailed: "The author boost could not be saved.",
    authorBoostRemoveFailed: "The author boost could not be removed.",
    notification: {
      reportHeldTitle: "Community content under review",
      reportHeldBody:
        "Content you published has been temporarily held for moderation review.",
      followedPostTitle: "New community post",
      followedPostBody: (authorName, postTitle) =>
        `${authorName} published a new post${postTitle ? `: ${postTitle}.` : "."}`,
      replyTitle: (threadReply) =>
        threadReply ? "New reply in your thread" : "New community reply",
      replyBody: (authorName) =>
        `${authorName} replied to a community post.`,
      mentionTitle: "You were mentioned in the community",
      mentionBody: (authorName) =>
        `${authorName} mentioned you in a community post.`,
      reportReviewedTitle: "Community report reviewed",
      reportReviewedBody: (dismissed) =>
        dismissed
          ? "The academy team reviewed and closed your report."
          : "The academy team reviewed your report and hid the content.",
      contentDecisionTitle: (rejected) =>
        rejected ? "Community content moderated" : "Community content approved",
      contentDecisionBody: (rejected) =>
        rejected
          ? "Content you published was rejected after moderation review. You can review the decision in your submissions."
          : "Content you submitted was approved and is visible again.",
      appealDecisionTitle: "Appeal decided",
      appealDecisionBody: (overturned) =>
        overturned
          ? "Your appeal was accepted. The community content is visible again."
          : "Your appeal was reviewed. The moderation decision remains in place.",
    },
  },
  it: {
    invalidRichContent: "Il contenuto formattato della community non è valido.",
    contentInvalid: (target) =>
      target === "post"
        ? "Il post non è valido."
        : target === "answer"
          ? "La risposta non è valida."
          : "Il contenuto della community non è valido.",
    contentNotFound: (target) =>
      target === "post"
        ? "Il post non è stato trovato."
        : target === "answer"
          ? "La risposta non è stata trovata."
          : "Il contenuto della community non è stato trovato.",
    contentChanged: (target) =>
      `${target === "answer" ? "La risposta" : target === "post" ? "Il post" : "Il contenuto"} è stato modificato nel frattempo. Ricarica la pagina e riprova.`,
    contentForbidden: (target, operation) =>
      `Puoi solo ${operation === "delete" ? "eliminare" : "modificare"} ${target === "answer" ? "le tue risposte" : target === "post" ? "i tuoi post" : "i tuoi contenuti"}.`,
    contentCreateFailed: (target) =>
      target === "answer"
        ? "Impossibile pubblicare la risposta."
        : "Impossibile pubblicare il post.",
    contentRateLimited: (target) =>
      target === "answer"
        ? "Troppe risposte nella community. Riprova più tardi."
        : "Troppi post nella community. Riprova più tardi.",
    contentCreated: (target, moderationState) =>
      moderationState === "pending"
        ? target === "answer"
          ? "La risposta è stata inviata per l'approvazione."
          : "Il post è stato inviato per l'approvazione."
        : moderationState === "held"
          ? `${target === "answer" ? "La risposta" : "Il post"} è in revisione prima della pubblicazione.`
          : target === "answer"
            ? "Risposta pubblicata."
            : "Post pubblicato.",
    contentSaveFailed: (target) =>
      target === "answer"
        ? "Impossibile salvare la risposta."
        : target === "post"
          ? "Impossibile salvare il post."
          : "Impossibile salvare il contenuto della community.",
    contentSaved: (target, moderationState) =>
      moderationState === "pending"
        ? "La modifica è stata inviata per l'approvazione."
        : moderationState === "held"
          ? "La modifica è in revisione prima della pubblicazione."
          : target === "answer"
            ? "Risposta salvata."
            : "Post salvato.",
    contentDeleteFailed: (target) =>
      target === "answer"
        ? "Impossibile eliminare la risposta."
        : "Impossibile eliminare il post.",
    contentDeleted: (target) =>
      target === "answer" ? "Risposta eliminata." : "Post eliminato.",
    profileIncomplete: "Completa prima il tuo profilo della community.",
    reportInvalid: "Controlla il motivo e la descrizione della segnalazione.",
    reportRateLimited: "Troppe segnalazioni. Riprova più tardi.",
    reportContentMissing: "Il contenuto segnalato non è più disponibile.",
    reportOwnContent: "Puoi modificare o eliminare i tuoi contenuti.",
    reportDuplicate: "Hai già segnalato questo contenuto.",
    reportSubmitted: (held) =>
      held
        ? "Segnalazione inviata. Il contenuto è trattenuto fino alla revisione."
        : "Segnalazione inviata in modo riservato al team dell'academy.",
    reportFailed: "Impossibile inviare la segnalazione.",
    appealInvalid: "Il ricorso deve contenere tra 3 e 2.000 caratteri.",
    appealNotFound: "La pubblicazione in moderazione non è stata trovata.",
    appealUnavailable: "Non è possibile presentare ricorso per questa pubblicazione.",
    appealSubmitted: "Ricorso inviato.",
    appealFailed: "Impossibile inviare il ricorso.",
    followSaved: "Ora segui questo contenuto della community.",
    followRemoved: "Non segui più questo contenuto della community.",
    followSaveFailed: "Impossibile salvare il follow.",
    followRemoveFailed: "Impossibile rimuovere il follow.",
    authorBoostSaved: "Boost autore salvato.",
    authorBoostRemoved: "Boost autore rimosso.",
    authorBoostSaveFailed: "Impossibile salvare il boost autore.",
    authorBoostRemoveFailed: "Impossibile rimuovere il boost autore.",
    notification: {
      reportHeldTitle: "Contenuto della community in revisione",
      reportHeldBody:
        "Un contenuto che hai pubblicato è stato temporaneamente trattenuto per la revisione di moderazione.",
      followedPostTitle: "Nuovo post della community",
      followedPostBody: (authorName, postTitle) =>
        `${authorName} ha pubblicato un nuovo post${postTitle ? `: ${postTitle}.` : "."}`,
      replyTitle: (threadReply) =>
        threadReply ? "Nuova risposta nel tuo thread" : "Nuova risposta della community",
      replyBody: (authorName) =>
        `${authorName} ha risposto a un post della community.`,
      mentionTitle: "Sei stato menzionato nella community",
      mentionBody: (authorName) =>
        `${authorName} ti ha menzionato in un post della community.`,
      reportReviewedTitle: "Segnalazione della community esaminata",
      reportReviewedBody: (dismissed) =>
        dismissed
          ? "Il team dell'academy ha esaminato e chiuso la tua segnalazione."
          : "Il team dell'academy ha esaminato la tua segnalazione e nascosto il contenuto.",
      contentDecisionTitle: (rejected) =>
        rejected ? "Contenuto della community moderato" : "Contenuto della community approvato",
      contentDecisionBody: (rejected) =>
        rejected
          ? "Un contenuto che hai pubblicato è stato rifiutato dopo la revisione. Puoi consultare la decisione nelle tue pubblicazioni."
          : "Un contenuto che hai inviato è stato approvato ed è di nuovo visibile.",
      appealDecisionTitle: "Ricorso deciso",
      appealDecisionBody: (overturned) =>
        overturned
          ? "Il tuo ricorso è stato accolto. Il contenuto della community è di nuovo visibile."
          : "Il tuo ricorso è stato esaminato. La decisione di moderazione resta valida.",
    },
  },
  es: {
    invalidRichContent: "El contenido con formato de la comunidad no es válido.",
    contentInvalid: (target) =>
      target === "post"
        ? "La publicación no es válida."
        : target === "answer"
          ? "La respuesta no es válida."
          : "El contenido de la comunidad no es válido.",
    contentNotFound: (target) =>
      target === "post"
        ? "No se encontró la publicación."
        : target === "answer"
          ? "No se encontró la respuesta."
          : "No se encontró el contenido de la comunidad.",
    contentChanged: (target) =>
      `${target === "answer" ? "La respuesta" : target === "post" ? "La publicación" : "El contenido"} ha cambiado. Recarga la página e inténtalo de nuevo.`,
    contentForbidden: (target, operation) =>
      `Solo puedes ${operation === "delete" ? "eliminar" : "editar"} ${target === "answer" ? "tus propias respuestas" : target === "post" ? "tus propias publicaciones" : "tu propio contenido"}.`,
    contentCreateFailed: (target) =>
      target === "answer"
        ? "No se pudo publicar la respuesta."
        : "No se pudo publicar el contenido.",
    contentRateLimited: (target) =>
      target === "answer"
        ? "Demasiadas respuestas en la comunidad. Inténtalo más tarde."
        : "Demasiadas publicaciones en la comunidad. Inténtalo más tarde.",
    contentCreated: (target, moderationState) =>
      moderationState === "pending"
        ? `La ${target === "answer" ? "respuesta" : "publicación"} se envió para su aprobación.`
        : moderationState === "held"
          ? `La ${target === "answer" ? "respuesta" : "publicación"} se está revisando antes de publicarse.`
          : `${target === "answer" ? "Respuesta" : "Publicación"} publicada.`,
    contentSaveFailed: (target) =>
      target === "answer"
        ? "No se pudo guardar la respuesta."
        : target === "post"
          ? "No se pudo guardar la publicación."
          : "No se pudo guardar el contenido de la comunidad.",
    contentSaved: (target, moderationState) =>
      moderationState === "pending"
        ? "El cambio se envió para su aprobación."
        : moderationState === "held"
          ? "El cambio se está revisando antes de publicarse."
          : target === "answer"
            ? "Respuesta guardada."
            : "Publicación guardada.",
    contentDeleteFailed: (target) =>
      target === "answer"
        ? "No se pudo eliminar la respuesta."
        : "No se pudo eliminar la publicación.",
    contentDeleted: (target) =>
      target === "answer" ? "Respuesta eliminada." : "Publicación eliminada.",
    profileIncomplete: "Completa primero tu perfil de la comunidad.",
    reportInvalid: "Comprueba el motivo y la descripción de la denuncia.",
    reportRateLimited: "Demasiadas denuncias. Inténtalo de nuevo más tarde.",
    reportContentMissing: "El contenido denunciado ya no está disponible.",
    reportOwnContent: "Puedes editar o eliminar tu propio contenido.",
    reportDuplicate: "Ya has denunciado este contenido.",
    reportSubmitted: (held) =>
      held
        ? "Denuncia enviada. El contenido se retendrá hasta que sea revisado."
        : "Denuncia enviada de forma confidencial al equipo de la academy.",
    reportFailed: "No se pudo enviar la denuncia.",
    appealInvalid: "El recurso debe contener entre 3 y 2.000 caracteres.",
    appealNotFound: "No se encontró el envío en moderación.",
    appealUnavailable: "Este envío no se puede recurrir.",
    appealSubmitted: "Recurso enviado.",
    appealFailed: "No se pudo presentar el recurso.",
    followSaved: "Ahora sigues este contenido de la comunidad.",
    followRemoved: "Ya no sigues este contenido de la comunidad.",
    followSaveFailed: "No se pudo guardar el seguimiento.",
    followRemoveFailed: "No se pudo eliminar el seguimiento.",
    authorBoostSaved: "Impulso de autor guardado.",
    authorBoostRemoved: "Impulso de autor eliminado.",
    authorBoostSaveFailed: "No se pudo guardar el impulso de autor.",
    authorBoostRemoveFailed: "No se pudo eliminar el impulso de autor.",
    notification: {
      reportHeldTitle: "Contenido de la comunidad en revisión",
      reportHeldBody:
        "Un contenido que publicaste se ha retenido temporalmente para su revisión de moderación.",
      followedPostTitle: "Nueva publicación de la comunidad",
      followedPostBody: (authorName, postTitle) =>
        `${authorName} ha publicado nuevo contenido${postTitle ? `: ${postTitle}.` : "."}`,
      replyTitle: (threadReply) =>
        threadReply ? "Nueva respuesta en tu hilo" : "Nueva respuesta de la comunidad",
      replyBody: (authorName) =>
        `${authorName} ha respondido a una publicación de la comunidad.`,
      mentionTitle: "Te han mencionado en la comunidad",
      mentionBody: (authorName) =>
        `${authorName} te ha mencionado en una publicación de la comunidad.`,
      reportReviewedTitle: "Denuncia de la comunidad revisada",
      reportReviewedBody: (dismissed) =>
        dismissed
          ? "El equipo de la academy ha revisado y cerrado tu denuncia."
          : "El equipo de la academy ha revisado tu denuncia y ocultado el contenido.",
      contentDecisionTitle: (rejected) =>
        rejected ? "Contenido de la comunidad moderado" : "Contenido de la comunidad aprobado",
      contentDecisionBody: (rejected) =>
        rejected
          ? "Un contenido que publicaste se rechazó tras la revisión. Puedes consultar la decisión en tus envíos."
          : "Un contenido que enviaste se aprobó y vuelve a estar visible.",
      appealDecisionTitle: "Recurso resuelto",
      appealDecisionBody: (overturned) =>
        overturned
          ? "Tu recurso ha sido aceptado. El contenido de la comunidad vuelve a estar visible."
          : "Tu recurso se ha revisado. La decisión de moderación se mantiene.",
    },
  },
  fr: {
    invalidRichContent: "Le contenu communautaire mis en forme n'est pas valide.",
    contentInvalid: (target) =>
      target === "post"
        ? "La publication n'est pas valide."
        : target === "answer"
          ? "La réponse n'est pas valide."
          : "Le contenu communautaire n'est pas valide.",
    contentNotFound: (target) =>
      target === "post"
        ? "La publication est introuvable."
        : target === "answer"
          ? "La réponse est introuvable."
          : "Le contenu communautaire est introuvable.",
    contentChanged: (target) =>
      `${target === "answer" ? "La réponse" : target === "post" ? "La publication" : "Le contenu"} a été modifié entre-temps. Rechargez la page et réessayez.`,
    contentForbidden: (target, operation) =>
      `Vous pouvez uniquement ${operation === "delete" ? "supprimer" : "modifier"} ${target === "answer" ? "vos propres réponses" : target === "post" ? "vos propres publications" : "votre propre contenu"}.`,
    contentCreateFailed: (target) =>
      target === "answer"
        ? "Impossible de publier la réponse."
        : "Impossible de publier le contenu.",
    contentRateLimited: (target) =>
      target === "answer"
        ? "Trop de réponses dans la communauté. Réessayez plus tard."
        : "Trop de publications dans la communauté. Réessayez plus tard.",
    contentCreated: (target, moderationState) =>
      moderationState === "pending"
        ? `${target === "answer" ? "La réponse" : "La publication"} a été soumise pour approbation.`
        : moderationState === "held"
          ? `${target === "answer" ? "La réponse" : "La publication"} est examinée avant sa publication.`
          : `${target === "answer" ? "Réponse" : "Publication"} publiée.`,
    contentSaveFailed: (target) =>
      target === "answer"
        ? "Impossible d'enregistrer la réponse."
        : target === "post"
          ? "Impossible d'enregistrer la publication."
          : "Impossible d'enregistrer le contenu communautaire.",
    contentSaved: (target, moderationState) =>
      moderationState === "pending"
        ? "La modification a été soumise pour approbation."
        : moderationState === "held"
          ? "La modification est examinée avant sa publication."
          : target === "answer"
            ? "Réponse enregistrée."
            : "Publication enregistrée.",
    contentDeleteFailed: (target) =>
      target === "answer"
        ? "Impossible de supprimer la réponse."
        : "Impossible de supprimer la publication.",
    contentDeleted: (target) =>
      target === "answer" ? "Réponse supprimée." : "Publication supprimée.",
    profileIncomplete: "Complétez d'abord votre profil communautaire.",
    reportInvalid: "Vérifiez le motif et la description du signalement.",
    reportRateLimited: "Trop de signalements. Réessayez plus tard.",
    reportContentMissing: "Le contenu signalé n'est plus disponible.",
    reportOwnContent: "Vous pouvez modifier ou supprimer votre propre contenu.",
    reportDuplicate: "Vous avez déjà signalé ce contenu.",
    reportSubmitted: (held) =>
      held
        ? "Signalement envoyé. Le contenu est retenu jusqu'à son examen."
        : "Signalement envoyé confidentiellement à l'équipe de l'academy.",
    reportFailed: "Impossible d'envoyer le signalement.",
    appealInvalid: "Le recours doit contenir entre 3 et 2 000 caractères.",
    appealNotFound: "La publication en modération est introuvable.",
    appealUnavailable: "Cette publication ne peut pas faire l'objet d'un recours.",
    appealSubmitted: "Recours envoyé.",
    appealFailed: "Impossible de déposer le recours.",
    followSaved: "Vous suivez maintenant ce contenu communautaire.",
    followRemoved: "Vous ne suivez plus ce contenu communautaire.",
    followSaveFailed: "Impossible d'enregistrer le suivi.",
    followRemoveFailed: "Impossible de supprimer le suivi.",
    authorBoostSaved: "Mise en avant de l'auteur enregistrée.",
    authorBoostRemoved: "Mise en avant de l'auteur supprimée.",
    authorBoostSaveFailed:
      "Impossible d'enregistrer la mise en avant de l'auteur.",
    authorBoostRemoveFailed:
      "Impossible de supprimer la mise en avant de l'auteur.",
    notification: {
      reportHeldTitle: "Contenu communautaire en cours d'examen",
      reportHeldBody:
        "Un contenu que vous avez publié a été temporairement retenu pour examen par la modération.",
      followedPostTitle: "Nouvelle publication communautaire",
      followedPostBody: (authorName, postTitle) =>
        `${authorName} a publié un nouveau contenu${postTitle ? ` : ${postTitle}.` : "."}`,
      replyTitle: (threadReply) =>
        threadReply ? "Nouvelle réponse dans votre fil" : "Nouvelle réponse communautaire",
      replyBody: (authorName) =>
        `${authorName} a répondu à une publication communautaire.`,
      mentionTitle: "Vous avez été mentionné dans la communauté",
      mentionBody: (authorName) =>
        `${authorName} vous a mentionné dans une publication communautaire.`,
      reportReviewedTitle: "Signalement communautaire examiné",
      reportReviewedBody: (dismissed) =>
        dismissed
          ? "L'équipe de l'academy a examiné et clôturé votre signalement."
          : "L'équipe de l'academy a examiné votre signalement et masqué le contenu.",
      contentDecisionTitle: (rejected) =>
        rejected ? "Contenu communautaire modéré" : "Contenu communautaire approuvé",
      contentDecisionBody: (rejected) =>
        rejected
          ? "Un contenu que vous avez publié a été refusé après examen. Vous pouvez consulter la décision dans vos publications."
          : "Un contenu que vous avez soumis a été approuvé et est de nouveau visible.",
      appealDecisionTitle: "Recours tranché",
      appealDecisionBody: (overturned) =>
        overturned
          ? "Votre recours a été accepté. Le contenu communautaire est de nouveau visible."
          : "Votre recours a été examiné. La décision de modération est maintenue.",
    },
  },
};

function target(params: CommunityActionParams | undefined): ContentTarget {
  return params?.target === "post" || params?.target === "answer"
    ? params.target
    : "content";
}

function operation(
  params: CommunityActionParams | undefined,
): ContentOperation {
  return params?.operation === "delete" ? "delete" : "edit";
}

function moderationState(
  params: CommunityActionParams | undefined,
): ModerationState {
  return params?.moderationState === "pending" ||
    params?.moderationState === "held"
    ? params.moderationState
    : "published";
}

export function resolveCommunityActionMessage(
  locale: AppLocale,
  state: CommunityLocalizedActionState,
  fallbackCode: CommunityActionCode = "contentSaveFailed",
) {
  const copy = dictionaries[locale] ?? dictionaries.de;
  const code = state.code ?? fallbackCode;
  switch (code) {
    case "invalidRichContent":
      return copy.invalidRichContent;
    case "contentInvalid":
      return copy.contentInvalid(target(state.params));
    case "contentNotFound":
      return copy.contentNotFound(target(state.params));
    case "contentChanged":
      return copy.contentChanged(target(state.params));
    case "contentForbidden":
      return copy.contentForbidden(target(state.params), operation(state.params));
    case "contentCreateFailed":
      return copy.contentCreateFailed(target(state.params));
    case "contentRateLimited":
      return copy.contentRateLimited(target(state.params));
    case "contentCreated":
      return copy.contentCreated(
        target(state.params),
        moderationState(state.params),
      );
    case "contentSaveFailed":
      return copy.contentSaveFailed(target(state.params));
    case "contentSaved":
      return copy.contentSaved(
        target(state.params),
        moderationState(state.params),
      );
    case "contentDeleteFailed":
      return copy.contentDeleteFailed(target(state.params));
    case "contentDeleted":
      return copy.contentDeleted(target(state.params));
    case "reportSubmitted":
      return copy.reportSubmitted(state.params?.held === true);
    case "profileIncomplete":
    case "reportInvalid":
    case "reportRateLimited":
    case "reportContentMissing":
    case "reportOwnContent":
    case "reportDuplicate":
    case "reportFailed":
    case "appealInvalid":
    case "appealNotFound":
    case "appealUnavailable":
    case "appealSubmitted":
    case "appealFailed":
    case "followSaved":
    case "followRemoved":
    case "followSaveFailed":
    case "followRemoveFailed":
    case "authorBoostSaved":
    case "authorBoostRemoved":
    case "authorBoostSaveFailed":
    case "authorBoostRemoveFailed":
      return copy[code];
  }
}

export function getCommunityNotificationCopy(locale: AppLocale) {
  return (dictionaries[locale] ?? dictionaries.de).notification;
}
