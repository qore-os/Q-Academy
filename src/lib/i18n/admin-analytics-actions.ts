import type { AppLocale } from "@/lib/i18n/model";

export type ProgressResetMessageCode =
  | "invalidRequest"
  | "assignmentNotFound"
  | "confirmationMismatch"
  | "certificateRevocationRequired"
  | "sharedProgressBlocked"
  | "progressReset"
  | "resetFailed";

export type ProgressResetMessageParams = Record<
  string,
  string | number | boolean
>;

type Renderer = (params: ProgressResetMessageParams) => string;

type AdminAnalyticsActionCopy = {
  messages: Record<ProgressResetMessageCode, Renderer>;
  notification: {
    title: string;
    body: (course: string, certificateRevoked: boolean) => string;
    revocationReason: string;
  };
};

function text(params: ProgressResetMessageParams, key: string) {
  const value = params[key];
  return typeof value === "string" ? value : "";
}

function count(params: ProgressResetMessageParams, key: string) {
  const value = params[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

const dictionaries: Record<AppLocale, AdminAnalyticsActionCopy> = {
  de: {
    messages: {
      invalidRequest: () => "Die Angaben für den Fortschrittsreset sind ungültig.",
      assignmentNotFound: () =>
        "Mitglied, Kurs oder Einschreibung wurde nicht gefunden.",
      confirmationMismatch: () =>
        "Mitgliedsname oder Kurstitel stimmt nicht mit den aktuellen Daten überein.",
      certificateRevocationRequired: (params) =>
        `Das aktive Zertifikat ${text(params, "certificateNumber")} muss für diesen Reset ausdrücklich widerrufen werden.`,
      sharedProgressBlocked: (params) =>
        `Der Reset ist blockiert, weil derselbe Lektionsfortschritt auch im Kurs „${text(params, "courseTitle")}“ verwendet wird. Trenne zuerst das wiederverwendete Modul oder setze die betroffenen Kurse gemeinsam über einen Datenworkflow zurück.`,
      progressReset: (params) => {
        const changes = [
          `${count(params, "lessonStates")} Lektionsstände`,
          `${count(params, "quizAttempts")} Quizversuche`,
        ];
        if (params.submissionsIncluded === true) {
          changes.push(`${count(params, "submissions")} Einreichungen`);
        }
        if (params.certificateRevoked === true) changes.push("1 Zertifikat widerrufen");
        return `Fortschritt zurückgesetzt: ${changes.join(", ")}.`;
      },
      resetFailed: () => "Der Lernfortschritt konnte nicht zurückgesetzt werden.",
    },
    notification: {
      title: "Lernfortschritt zurückgesetzt",
      body: (course, revoked) =>
        `Dein Fortschritt im Kurs „${course}“ wurde durch die Administration zurückgesetzt.${revoked ? " Das zugehörige Zertifikat wurde widerrufen." : ""}`,
      revocationReason:
        "Fortschritt wurde durch die Administration zurückgesetzt.",
    },
  },
  en: {
    messages: {
      invalidRequest: () => "The progress reset details are invalid.",
      assignmentNotFound: () => "The member, course or enrolment was not found.",
      confirmationMismatch: () =>
        "The member name or course title no longer matches the current data.",
      certificateRevocationRequired: (params) =>
        `Active certificate ${text(params, "certificateNumber")} must be explicitly revoked for this reset.`,
      sharedProgressBlocked: (params) =>
        `The reset is blocked because the same lesson progress is also used in “${text(params, "courseTitle")}”. Separate the reused module first or reset the affected courses together through a data workflow.`,
      progressReset: (params) => {
        const changes = [
          `${count(params, "lessonStates")} lesson states`,
          `${count(params, "quizAttempts")} quiz attempts`,
        ];
        if (params.submissionsIncluded === true) {
          changes.push(`${count(params, "submissions")} submissions`);
        }
        if (params.certificateRevoked === true) changes.push("1 certificate revoked");
        return `Progress reset: ${changes.join(", ")}.`;
      },
      resetFailed: () => "The learning progress could not be reset.",
    },
    notification: {
      title: "Learning progress reset",
      body: (course, revoked) =>
        `An administrator reset your progress in “${course}”.${revoked ? " The associated certificate was revoked." : ""}`,
      revocationReason: "Progress was reset by an administrator.",
    },
  },
  it: {
    messages: {
      invalidRequest: () => "I dati per l'azzeramento dei progressi non sono validi.",
      assignmentNotFound: () => "Il membro, il corso o l'iscrizione non sono stati trovati.",
      confirmationMismatch: () =>
        "Il nome del membro o il titolo del corso non corrispondono più ai dati attuali.",
      certificateRevocationRequired: (params) =>
        `Il certificato attivo ${text(params, "certificateNumber")} deve essere revocato esplicitamente per questo azzeramento.`,
      sharedProgressBlocked: (params) =>
        `L'azzeramento è bloccato perché lo stesso progresso della lezione è usato anche in “${text(params, "courseTitle")}”. Separa prima il modulo riutilizzato oppure azzera insieme i corsi interessati tramite un flusso dati.`,
      progressReset: (params) => {
        const changes = [
          `${count(params, "lessonStates")} stati lezione`,
          `${count(params, "quizAttempts")} tentativi quiz`,
        ];
        if (params.submissionsIncluded === true) {
          changes.push(`${count(params, "submissions")} consegne`);
        }
        if (params.certificateRevoked === true) changes.push("1 certificato revocato");
        return `Progressi azzerati: ${changes.join(", ")}.`;
      },
      resetFailed: () => "Non è stato possibile azzerare i progressi di apprendimento.",
    },
    notification: {
      title: "Progressi di apprendimento azzerati",
      body: (course, revoked) =>
        `Un amministratore ha azzerato i tuoi progressi in “${course}”.${revoked ? " Il certificato associato è stato revocato." : ""}`,
      revocationReason: "I progressi sono stati azzerati da un amministratore.",
    },
  },
  es: {
    messages: {
      invalidRequest: () => "Los datos para restablecer el progreso no son válidos.",
      assignmentNotFound: () => "No se encontró el miembro, el curso o la inscripción.",
      confirmationMismatch: () =>
        "El nombre del miembro o el título del curso ya no coinciden con los datos actuales.",
      certificateRevocationRequired: (params) =>
        `El certificado activo ${text(params, "certificateNumber")} debe revocarse expresamente para este restablecimiento.`,
      sharedProgressBlocked: (params) =>
        `El restablecimiento está bloqueado porque el mismo progreso de lección también se usa en “${text(params, "courseTitle")}”. Separa primero el módulo reutilizado o restablece conjuntamente los cursos afectados mediante un flujo de datos.`,
      progressReset: (params) => {
        const changes = [
          `${count(params, "lessonStates")} estados de lección`,
          `${count(params, "quizAttempts")} intentos de cuestionario`,
        ];
        if (params.submissionsIncluded === true) {
          changes.push(`${count(params, "submissions")} entregas`);
        }
        if (params.certificateRevoked === true) changes.push("1 certificado revocado");
        return `Progreso restablecido: ${changes.join(", ")}.`;
      },
      resetFailed: () => "No se pudo restablecer el progreso de aprendizaje.",
    },
    notification: {
      title: "Progreso de aprendizaje restablecido",
      body: (course, revoked) =>
        `Un administrador restableció tu progreso en “${course}”.${revoked ? " Se revocó el certificado asociado." : ""}`,
      revocationReason: "Un administrador restableció el progreso.",
    },
  },
  fr: {
    messages: {
      invalidRequest: () => "Les données de réinitialisation de la progression sont invalides.",
      assignmentNotFound: () => "Le membre, le cours ou l'inscription est introuvable.",
      confirmationMismatch: () =>
        "Le nom du membre ou le titre du cours ne correspond plus aux données actuelles.",
      certificateRevocationRequired: (params) =>
        `Le certificat actif ${text(params, "certificateNumber")} doit être explicitement révoqué pour cette réinitialisation.`,
      sharedProgressBlocked: (params) =>
        `La réinitialisation est bloquée car la même progression de leçon est également utilisée dans « ${text(params, "courseTitle")} ». Séparez d'abord le module réutilisé ou réinitialisez ensemble les cours concernés via un flux de données.`,
      progressReset: (params) => {
        const changes = [
          `${count(params, "lessonStates")} états de leçon`,
          `${count(params, "quizAttempts")} tentatives de quiz`,
        ];
        if (params.submissionsIncluded === true) {
          changes.push(`${count(params, "submissions")} travaux`);
        }
        if (params.certificateRevoked === true) changes.push("1 certificat révoqué");
        return `Progression réinitialisée : ${changes.join(", ")}.`;
      },
      resetFailed: () => "La progression n'a pas pu être réinitialisée.",
    },
    notification: {
      title: "Progression réinitialisée",
      body: (course, revoked) =>
        `Un administrateur a réinitialisé votre progression dans « ${course} ».${revoked ? " Le certificat associé a été révoqué." : ""}`,
      revocationReason:
        "La progression a été réinitialisée par un administrateur.",
    },
  },
};

export function getAdminAnalyticsActionCopy(locale: AppLocale) {
  return dictionaries[locale] ?? dictionaries.de;
}

export function progressResetActionMessage(
  locale: AppLocale,
  code: ProgressResetMessageCode,
  params: ProgressResetMessageParams = {},
) {
  return getAdminAnalyticsActionCopy(locale).messages[code](params);
}
