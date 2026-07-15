import type { AppLocale } from "@/lib/i18n/model";

type CourseModuleAccessNotificationCopy = {
  adminRequestTitle: string;
  adminRequestBody: (
    requesterName: string,
    moduleTitle: string,
    courseTitle: string,
  ) => string;
  approvedTitle: string;
  approvedBody: (moduleTitle: string) => string;
  rejectedTitle: string;
  rejectedBody: (moduleTitle: string) => string;
  staleBody: (moduleTitle: string) => string;
  overrideUpdatedTitle: string;
  overrideUpdatedBody: (moduleTitle: string, state: string) => string;
  overrideRemovedTitle: string;
  overrideRemovedBody: (moduleTitle: string) => string;
  states: Record<"available" | "read_only" | "locked" | "hidden", string>;
  moduleFallback: string;
};

const copy: Record<AppLocale, CourseModuleAccessNotificationCopy> = {
  de: {
    adminRequestTitle: "Neue Modul-Zugriffsanfrage",
    adminRequestBody: (requesterName, moduleTitle, courseTitle) =>
      `${requesterName} bittet um Zugriff auf "${moduleTitle}" im Kurs "${courseTitle}".`,
    approvedTitle: "Modulzugriff freigegeben",
    approvedBody: (moduleTitle) =>
      `Du kannst das Modul "${moduleTitle}" jetzt oeffnen.`,
    rejectedTitle: "Modul-Zugriffsanfrage abgelehnt",
    rejectedBody: (moduleTitle) =>
      `Deine Anfrage fuer "${moduleTitle}" wurde abgelehnt.`,
    staleBody: (moduleTitle) =>
      `Die Anfrage fuer "${moduleTitle}" ist nicht mehr aktuell. Bitte stelle bei Bedarf eine neue Anfrage.`,
    overrideUpdatedTitle: "Modulzugriff aktualisiert",
    overrideUpdatedBody: (moduleTitle, state) =>
      `Der Zugriff auf "${moduleTitle}" wurde auf "${state}" gesetzt.`,
    overrideRemovedTitle: "Individuelle Modulfreigabe beendet",
    overrideRemovedBody: (moduleTitle) =>
      `Fuer "${moduleTitle}" gilt wieder die allgemeine Kursregel.`,
    states: { available: "Verfuegbar", read_only: "Nur Lesen", locked: "Gesperrt", hidden: "Ausgeblendet" },
    moduleFallback: "Das angefragte Modul",
  },
  en: {
    adminRequestTitle: "New module access request",
    adminRequestBody: (requesterName, moduleTitle, courseTitle) =>
      `${requesterName} requests access to "${moduleTitle}" in the course "${courseTitle}".`,
    approvedTitle: "Module access approved",
    approvedBody: (moduleTitle) =>
      `You can now open the module "${moduleTitle}".`,
    rejectedTitle: "Module access request declined",
    rejectedBody: (moduleTitle) =>
      `Your request for "${moduleTitle}" was declined.`,
    staleBody: (moduleTitle) =>
      `The request for "${moduleTitle}" is no longer current. Submit a new request if needed.`,
    overrideUpdatedTitle: "Module access updated",
    overrideUpdatedBody: (moduleTitle, state) =>
      `Access to "${moduleTitle}" was set to "${state}".`,
    overrideRemovedTitle: "Individual module access ended",
    overrideRemovedBody: (moduleTitle) =>
      `The general course rule applies to "${moduleTitle}" again.`,
    states: { available: "Available", read_only: "Read only", locked: "Locked", hidden: "Hidden" },
    moduleFallback: "The requested module",
  },
  it: {
    adminRequestTitle: "Nuova richiesta di accesso al modulo",
    adminRequestBody: (requesterName, moduleTitle, courseTitle) =>
      `${requesterName} richiede l'accesso a "${moduleTitle}" nel corso "${courseTitle}".`,
    approvedTitle: "Accesso al modulo approvato",
    approvedBody: (moduleTitle) =>
      `Ora puoi aprire il modulo "${moduleTitle}".`,
    rejectedTitle: "Richiesta di accesso al modulo rifiutata",
    rejectedBody: (moduleTitle) =>
      `La tua richiesta per "${moduleTitle}" e stata rifiutata.`,
    staleBody: (moduleTitle) =>
      `La richiesta per "${moduleTitle}" non e piu attuale. Invia una nuova richiesta se necessario.`,
    overrideUpdatedTitle: "Accesso al modulo aggiornato",
    overrideUpdatedBody: (moduleTitle, state) =>
      `L'accesso a "${moduleTitle}" e stato impostato su "${state}".`,
    overrideRemovedTitle: "Accesso individuale al modulo terminato",
    overrideRemovedBody: (moduleTitle) =>
      `Per "${moduleTitle}" si applica nuovamente la regola generale del corso.`,
    states: { available: "Disponibile", read_only: "Sola lettura", locked: "Bloccato", hidden: "Nascosto" },
    moduleFallback: "Il modulo richiesto",
  },
  es: {
    adminRequestTitle: "Nueva solicitud de acceso al modulo",
    adminRequestBody: (requesterName, moduleTitle, courseTitle) =>
      `${requesterName} solicita acceso a "${moduleTitle}" en el curso "${courseTitle}".`,
    approvedTitle: "Acceso al modulo aprobado",
    approvedBody: (moduleTitle) =>
      `Ya puedes abrir el modulo "${moduleTitle}".`,
    rejectedTitle: "Solicitud de acceso al modulo rechazada",
    rejectedBody: (moduleTitle) =>
      `Tu solicitud para "${moduleTitle}" fue rechazada.`,
    staleBody: (moduleTitle) =>
      `La solicitud para "${moduleTitle}" ya no esta vigente. Envia una nueva solicitud si es necesario.`,
    overrideUpdatedTitle: "Acceso al modulo actualizado",
    overrideUpdatedBody: (moduleTitle, state) =>
      `El acceso a "${moduleTitle}" se establecio en "${state}".`,
    overrideRemovedTitle: "Acceso individual al modulo finalizado",
    overrideRemovedBody: (moduleTitle) =>
      `La regla general del curso vuelve a aplicarse a "${moduleTitle}".`,
    states: { available: "Disponible", read_only: "Solo lectura", locked: "Bloqueado", hidden: "Oculto" },
    moduleFallback: "El modulo solicitado",
  },
  fr: {
    adminRequestTitle: "Nouvelle demande d'acces au module",
    adminRequestBody: (requesterName, moduleTitle, courseTitle) =>
      `${requesterName} demande l'acces a "${moduleTitle}" dans le cours "${courseTitle}".`,
    approvedTitle: "Acces au module approuve",
    approvedBody: (moduleTitle) =>
      `Vous pouvez maintenant ouvrir le module "${moduleTitle}".`,
    rejectedTitle: "Demande d'acces au module refusee",
    rejectedBody: (moduleTitle) =>
      `Votre demande pour "${moduleTitle}" a ete refusee.`,
    staleBody: (moduleTitle) =>
      `La demande pour "${moduleTitle}" n'est plus actuelle. Envoyez une nouvelle demande si necessaire.`,
    overrideUpdatedTitle: "Acces au module mis a jour",
    overrideUpdatedBody: (moduleTitle, state) =>
      `L'acces a "${moduleTitle}" a ete defini sur "${state}".`,
    overrideRemovedTitle: "Acces individuel au module termine",
    overrideRemovedBody: (moduleTitle) =>
      `La regle generale du cours s'applique de nouveau a "${moduleTitle}".`,
    states: { available: "Disponible", read_only: "Lecture seule", locked: "Verrouille", hidden: "Masque" },
    moduleFallback: "Le module demande",
  },
};

export function getCourseModuleAccessNotificationCopy(locale: AppLocale) {
  return copy[locale];
}
