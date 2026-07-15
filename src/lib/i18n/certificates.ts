import type { CertificateMessageCode } from "@/lib/certificate-actions";
import type { AppLocale } from "@/lib/i18n/model";

type CertificateCopy = {
  admin: {
    metadataTitle: string;
    eyebrow: string;
    title: string;
    description: string;
    total: string;
    valid: string;
    revoked: string;
    search: string;
    searchPlaceholder: string;
    status: string;
    all: string;
    filter: string;
    completed: (date: string) => string;
    issued: (date: string) => string;
    view: string;
    emptyTitle: string;
    emptyDescription: string;
  };
  document: {
    metadataTitle: string;
    back: string;
    print: string;
    ariaLabel: (number: string) => string;
    title: string;
    subtitle: string;
    confirms: string;
    course: string;
    completionStatement: string;
    completed: string;
    issued: string;
    number: string;
    revoked: string;
    revokedOn: (date: string) => string;
    noLongerValid: string;
  };
  actions: {
    reissue: string;
    revoke: string;
    reason: string;
    optional: string;
    confirmRevoke: string;
    messages: Record<CertificateMessageCode, string>;
  };
  notification: {
    issuedTitle: string;
    issuedBody: (courseTitle: string) => string;
    revokedTitle: string;
    revokedBody: (courseTitle: string) => string;
  };
};

const copy: Record<AppLocale, CertificateCopy> = {
  de: {
    admin: {
      metadataTitle: "Zertifikatsregister",
      eyebrow: "Kursabschluesse",
      title: "Zertifikatsregister",
      description: "Ausgestellte Nachweise je Mitglied und Kurs pruefen, widerrufen und bei weiterhin belegtem Abschluss neu ausstellen.",
      total: "Insgesamt",
      valid: "Gueltig",
      revoked: "Widerrufen",
      search: "Suche",
      searchPlaceholder: "Name, E-Mail, Kurs oder Nummer",
      status: "Status",
      all: "Alle",
      filter: "Filtern",
      completed: (date) => `Abschluss ${date}`,
      issued: (date) => `Ausgestellt ${date}`,
      view: "Ansehen",
      emptyTitle: "Keine Zertifikate gefunden",
      emptyDescription: "Passe Suche oder Statusfilter an.",
    },
    document: {
      metadataTitle: "Zertifikat",
      back: "Zurueck zur Uebersicht",
      print: "Drucken / als PDF sichern",
      ariaLabel: (number) => `Zertifikat ${number}`,
      title: "Zertifikat",
      subtitle: "ueber den erfolgreichen Kursabschluss",
      confirms: "Hiermit wird bestaetigt, dass",
      course: "den Kurs",
      completionStatement: "vollstaendig und erfolgreich abgeschlossen hat.",
      completed: "Abgeschlossen",
      issued: "Ausgestellt",
      number: "Zertifikatsnummer",
      revoked: "Widerrufen",
      revokedOn: (date) => `Widerrufen am ${date}.`,
      noLongerValid: "Dieses Zertifikat ist nicht mehr gueltig.",
    },
    actions: {
      reissue: "Neu ausstellen",
      revoke: "Widerrufen",
      reason: "Begruendung",
      optional: "Optional",
      confirmRevoke: "Widerruf bestaetigen",
      messages: {
        invalid: "Das Zertifikat ist ungueltig.",
        reason_too_long: "Die Begruendung ist zu lang.",
        not_found_or_revoked: "Das Zertifikat wurde nicht gefunden oder ist bereits widerrufen.",
        revoked: "Zertifikat widerrufen.",
        revoke_failed: "Das Zertifikat konnte nicht widerrufen werden.",
        not_found: "Das Zertifikat wurde nicht gefunden.",
        disabled: "Zertifikate sind fuer diesen Kurs deaktiviert.",
        incomplete: "Der Kursabschluss ist serverseitig nicht mehr vollstaendig nachweisbar.",
        member_course_not_found: "Mitglied oder Kurs wurde nicht gefunden.",
        issue_failed: "Das Zertifikat konnte nicht ausgestellt werden.",
        reissued: "Zertifikat neu ausgestellt.",
        already_active: "Es besteht bereits ein aktives Zertifikat.",
        reissue_failed: "Das Zertifikat konnte nicht neu ausgestellt werden.",
      },
    },
    notification: {
      issuedTitle: "Dein Zertifikat ist bereit",
      issuedBody: (courseTitle) => `Du hast den Kurs "${courseTitle}" erfolgreich abgeschlossen.`,
      revokedTitle: "Zertifikat widerrufen",
      revokedBody: (courseTitle) => `Das Zertifikat fuer \"${courseTitle}\" wurde widerrufen.`,
    },
  },
  en: {
    admin: {
      metadataTitle: "Certificate register",
      eyebrow: "Course completions",
      title: "Certificate register",
      description: "Review issued credentials by member and course, revoke them, or reissue them when completion remains verified.",
      total: "Total",
      valid: "Valid",
      revoked: "Revoked",
      search: "Search",
      searchPlaceholder: "Name, email, course or number",
      status: "Status",
      all: "All",
      filter: "Filter",
      completed: (date) => `Completed ${date}`,
      issued: (date) => `Issued ${date}`,
      view: "View",
      emptyTitle: "No certificates found",
      emptyDescription: "Adjust the search or status filter.",
    },
    document: {
      metadataTitle: "Certificate",
      back: "Back to overview",
      print: "Print / save as PDF",
      ariaLabel: (number) => `Certificate ${number}`,
      title: "Certificate",
      subtitle: "of successful course completion",
      confirms: "This certifies that",
      course: "has completed the course",
      completionStatement: "in full and with success.",
      completed: "Completed",
      issued: "Issued",
      number: "Certificate number",
      revoked: "Revoked",
      revokedOn: (date) => `Revoked on ${date}.`,
      noLongerValid: "This certificate is no longer valid.",
    },
    actions: {
      reissue: "Reissue",
      revoke: "Revoke",
      reason: "Reason",
      optional: "Optional",
      confirmRevoke: "Confirm revocation",
      messages: {
        invalid: "The certificate is invalid.",
        reason_too_long: "The reason is too long.",
        not_found_or_revoked: "The certificate was not found or has already been revoked.",
        revoked: "Certificate revoked.",
        revoke_failed: "The certificate could not be revoked.",
        not_found: "The certificate was not found.",
        disabled: "Certificates are disabled for this course.",
        incomplete: "Course completion can no longer be fully verified by the server.",
        member_course_not_found: "The member or course was not found.",
        issue_failed: "The certificate could not be issued.",
        reissued: "Certificate reissued.",
        already_active: "An active certificate already exists.",
        reissue_failed: "The certificate could not be reissued.",
      },
    },
    notification: {
      issuedTitle: "Your certificate is ready",
      issuedBody: (courseTitle) => `You successfully completed the course "${courseTitle}".`,
      revokedTitle: "Certificate revoked",
      revokedBody: (courseTitle) => `The certificate for \"${courseTitle}\" was revoked.`,
    },
  },
  it: {
    admin: {
      metadataTitle: "Registro certificati",
      eyebrow: "Completamenti dei corsi",
      title: "Registro certificati",
      description: "Controlla gli attestati emessi per membro e corso, revocali o emettili di nuovo se il completamento e ancora verificato.",
      total: "Totale",
      valid: "Valido",
      revoked: "Revocato",
      search: "Cerca",
      searchPlaceholder: "Nome, email, corso o numero",
      status: "Stato",
      all: "Tutti",
      filter: "Filtra",
      completed: (date) => `Completato ${date}`,
      issued: (date) => `Emesso ${date}`,
      view: "Visualizza",
      emptyTitle: "Nessun certificato trovato",
      emptyDescription: "Modifica la ricerca o il filtro di stato.",
    },
    document: {
      metadataTitle: "Certificato",
      back: "Torna alla panoramica",
      print: "Stampa / salva come PDF",
      ariaLabel: (number) => `Certificato ${number}`,
      title: "Certificato",
      subtitle: "di completamento del corso",
      confirms: "Si certifica che",
      course: "ha completato il corso",
      completionStatement: "integralmente e con successo.",
      completed: "Completato",
      issued: "Emesso",
      number: "Numero certificato",
      revoked: "Revocato",
      revokedOn: (date) => `Revocato il ${date}.`,
      noLongerValid: "Questo certificato non e piu valido.",
    },
    actions: {
      reissue: "Emetti di nuovo",
      revoke: "Revoca",
      reason: "Motivo",
      optional: "Facoltativo",
      confirmRevoke: "Conferma revoca",
      messages: {
        invalid: "Il certificato non e valido.",
        reason_too_long: "Il motivo e troppo lungo.",
        not_found_or_revoked: "Il certificato non e stato trovato o e gia stato revocato.",
        revoked: "Certificato revocato.",
        revoke_failed: "Non e stato possibile revocare il certificato.",
        not_found: "Certificato non trovato.",
        disabled: "I certificati sono disattivati per questo corso.",
        incomplete: "Il completamento del corso non e piu interamente verificabile dal server.",
        member_course_not_found: "Membro o corso non trovato.",
        issue_failed: "Non e stato possibile emettere il certificato.",
        reissued: "Certificato emesso di nuovo.",
        already_active: "Esiste gia un certificato attivo.",
        reissue_failed: "Non e stato possibile emettere di nuovo il certificato.",
      },
    },
    notification: {
      issuedTitle: "Il tuo certificato e pronto",
      issuedBody: (courseTitle) => `Hai completato con successo il corso "${courseTitle}".`,
      revokedTitle: "Certificato revocato",
      revokedBody: (courseTitle) => `Il certificato per \"${courseTitle}\" e stato revocato.`,
    },
  },
  es: {
    admin: {
      metadataTitle: "Registro de certificados",
      eyebrow: "Cursos completados",
      title: "Registro de certificados",
      description: "Revisa las acreditaciones emitidas por miembro y curso, revocalas o emitelas de nuevo si la finalizacion sigue verificada.",
      total: "Total",
      valid: "Valido",
      revoked: "Revocado",
      search: "Buscar",
      searchPlaceholder: "Nombre, correo, curso o numero",
      status: "Estado",
      all: "Todos",
      filter: "Filtrar",
      completed: (date) => `Completado ${date}`,
      issued: (date) => `Emitido ${date}`,
      view: "Ver",
      emptyTitle: "No se encontraron certificados",
      emptyDescription: "Ajusta la busqueda o el filtro de estado.",
    },
    document: {
      metadataTitle: "Certificado",
      back: "Volver al resumen",
      print: "Imprimir / guardar como PDF",
      ariaLabel: (number) => `Certificado ${number}`,
      title: "Certificado",
      subtitle: "de finalizacion satisfactoria del curso",
      confirms: "Se certifica que",
      course: "ha completado el curso",
      completionStatement: "en su totalidad y con exito.",
      completed: "Completado",
      issued: "Emitido",
      number: "Numero de certificado",
      revoked: "Revocado",
      revokedOn: (date) => `Revocado el ${date}.`,
      noLongerValid: "Este certificado ya no es valido.",
    },
    actions: {
      reissue: "Emitir de nuevo",
      revoke: "Revocar",
      reason: "Motivo",
      optional: "Opcional",
      confirmRevoke: "Confirmar revocacion",
      messages: {
        invalid: "El certificado no es valido.",
        reason_too_long: "El motivo es demasiado largo.",
        not_found_or_revoked: "No se encontro el certificado o ya esta revocado.",
        revoked: "Certificado revocado.",
        revoke_failed: "No se pudo revocar el certificado.",
        not_found: "No se encontro el certificado.",
        disabled: "Los certificados estan desactivados para este curso.",
        incomplete: "El servidor ya no puede verificar por completo la finalizacion del curso.",
        member_course_not_found: "No se encontro el miembro o el curso.",
        issue_failed: "No se pudo emitir el certificado.",
        reissued: "Certificado emitido de nuevo.",
        already_active: "Ya existe un certificado activo.",
        reissue_failed: "No se pudo volver a emitir el certificado.",
      },
    },
    notification: {
      issuedTitle: "Tu certificado esta listo",
      issuedBody: (courseTitle) => `Has completado correctamente el curso "${courseTitle}".`,
      revokedTitle: "Certificado revocado",
      revokedBody: (courseTitle) => `Se revoco el certificado de \"${courseTitle}\".`,
    },
  },
  fr: {
    admin: {
      metadataTitle: "Registre des certificats",
      eyebrow: "Cours termines",
      title: "Registre des certificats",
      description: "Consultez les justificatifs emis par membre et par cours, revoquez-les ou reemettez-les si la reussite reste verifiee.",
      total: "Total",
      valid: "Valide",
      revoked: "Revoque",
      search: "Rechercher",
      searchPlaceholder: "Nom, e-mail, cours ou numero",
      status: "Statut",
      all: "Tous",
      filter: "Filtrer",
      completed: (date) => `Termine ${date}`,
      issued: (date) => `Emis ${date}`,
      view: "Voir",
      emptyTitle: "Aucun certificat trouve",
      emptyDescription: "Modifiez la recherche ou le filtre de statut.",
    },
    document: {
      metadataTitle: "Certificat",
      back: "Retour a la vue d'ensemble",
      print: "Imprimer / enregistrer en PDF",
      ariaLabel: (number) => `Certificat ${number}`,
      title: "Certificat",
      subtitle: "de reussite du cours",
      confirms: "Il est certifie que",
      course: "a suivi le cours",
      completionStatement: "dans son integralite et avec succes.",
      completed: "Termine",
      issued: "Emis",
      number: "Numero du certificat",
      revoked: "Revoque",
      revokedOn: (date) => `Revoque le ${date}.`,
      noLongerValid: "Ce certificat n'est plus valide.",
    },
    actions: {
      reissue: "Reemettre",
      revoke: "Revoquer",
      reason: "Motif",
      optional: "Facultatif",
      confirmRevoke: "Confirmer la revocation",
      messages: {
        invalid: "Le certificat n'est pas valide.",
        reason_too_long: "Le motif est trop long.",
        not_found_or_revoked: "Le certificat est introuvable ou a deja ete revoque.",
        revoked: "Certificat revoque.",
        revoke_failed: "Le certificat n'a pas pu etre revoque.",
        not_found: "Le certificat est introuvable.",
        disabled: "Les certificats sont desactives pour ce cours.",
        incomplete: "La reussite du cours ne peut plus etre entierement verifiee par le serveur.",
        member_course_not_found: "Le membre ou le cours est introuvable.",
        issue_failed: "Le certificat n'a pas pu etre emis.",
        reissued: "Certificat reemis.",
        already_active: "Un certificat actif existe deja.",
        reissue_failed: "Le certificat n'a pas pu etre reemis.",
      },
    },
    notification: {
      issuedTitle: "Votre certificat est pret",
      issuedBody: (courseTitle) => `Vous avez termine avec succes le cours "${courseTitle}".`,
      revokedTitle: "Certificat revoque",
      revokedBody: (courseTitle) => `Le certificat du cours \"${courseTitle}\" a ete revoque.`,
    },
  },
};

export function getCertificateCopy(locale: AppLocale) {
  return copy[locale];
}

export function resolveCertificateMessage(
  locale: AppLocale,
  code: CertificateMessageCode | undefined,
) {
  return copy[locale].actions.messages[code ?? "reissue_failed"];
}
