import type { AppLocale } from "@/lib/i18n/model";

type Copy = {
  tab: string;
  eyebrow: string;
  title: string;
  description: string;
  search: string;
  status: string;
  reason: string;
  all: string;
  active: string;
  released: string;
  expired: string;
  hardBounce: string;
  softBounce: string;
  complaint: string;
  recipient: string;
  occurrences: string;
  lastEvent: string;
  lifecycle: string;
  action: string;
  filter: string;
  release: string;
  releaseReason: string;
  addressCorrected: string;
  providerError: string;
  memberRequest: string;
  otherVerified: string;
  empty: string;
  releasedSuccess: string;
  invalidRelease: string;
  releaseError: string;
  pagination: string;
  previousPage: string;
  nextPage: string;
  results: string;
};

const de: Copy = {
  tab: "Sperrliste",
  eyebrow: "E-Mail-Center",
  title: "Empfaengersperren",
  description:
    "Unzustellbare oder beanstandete Adressen werden vor Entschluesselung und Versand blockiert.",
  search: "Name oder E-Mail suchen",
  status: "Status",
  reason: "Grund",
  all: "Alle",
  active: "Aktiv",
  released: "Entsperrt",
  expired: "Abgelaufen",
  hardBounce: "Permanent unzustellbar",
  softBounce: "Voruebergehend unzustellbar",
  complaint: "Beschwerde",
  recipient: "Empfaenger",
  occurrences: "Ereignisse",
  lastEvent: "Letztes Ereignis",
  lifecycle: "Lifecycle",
  action: "Aktion",
  filter: "Filtern",
  release: "Entsperren",
  releaseReason: "Pruefgrund",
  addressCorrected: "Adresse korrigiert",
  providerError: "Providerfehler bestaetigt",
  memberRequest: "Verifizierter Mitgliederwunsch",
  otherVerified: "Anderer verifizierter Grund",
  empty: "Keine passenden Empfaengersperren vorhanden.",
  releasedSuccess: "Empfaenger wurde entsperrt.",
  invalidRelease: "Die Entsperraktion ist ungueltig.",
  releaseError: "Empfaenger konnte nicht entsperrt werden.",
  pagination: "Seitennavigation",
  previousPage: "Vorherige Seite",
  nextPage: "Naechste Seite",
  results: "Ergebnisse",
};

const translations: Record<AppLocale, Copy> = {
  de,
  en: {
    ...de,
    tab: "Suppressions",
    title: "Recipient suppressions",
    description:
      "Undeliverable or complained-about recipients are blocked before decryption and delivery.",
    search: "Search name or email",
    status: "Status",
    reason: "Reason",
    all: "All",
    active: "Active",
    released: "Released",
    expired: "Expired",
    hardBounce: "Permanently undeliverable",
    softBounce: "Temporarily undeliverable",
    complaint: "Complaint",
    recipient: "Recipient",
    occurrences: "Events",
    lastEvent: "Last event",
    lifecycle: "Lifecycle",
    action: "Action",
    filter: "Filter",
    release: "Release",
    releaseReason: "Review reason",
    addressCorrected: "Address corrected",
    providerError: "Provider error confirmed",
    memberRequest: "Verified member request",
    otherVerified: "Other verified reason",
    empty: "No matching recipient suppressions.",
    releasedSuccess: "Recipient suppression released.",
    invalidRelease: "The release request is invalid.",
    releaseError: "Recipient suppression could not be released.",
    pagination: "Pagination",
    previousPage: "Previous page",
    nextPage: "Next page",
    results: "results",
  },
  it: {
    ...de,
    tab: "Soppressioni",
    title: "Soppressioni destinatari",
    description:
      "I destinatari non raggiungibili o segnalati vengono bloccati prima della decifratura e dell'invio.",
    search: "Cerca nome o e-mail",
    status: "Stato",
    reason: "Motivo",
    all: "Tutti",
    active: "Attiva",
    released: "Sbloccata",
    expired: "Scaduta",
    hardBounce: "Permanentemente non raggiungibile",
    softBounce: "Temporaneamente non raggiungibile",
    complaint: "Reclamo",
    recipient: "Destinatario",
    occurrences: "Eventi",
    lastEvent: "Ultimo evento",
    lifecycle: "Ciclo di vita",
    action: "Azione",
    filter: "Filtra",
    release: "Sblocca",
    releaseReason: "Motivo della verifica",
    addressCorrected: "Indirizzo corretto",
    providerError: "Errore del provider confermato",
    memberRequest: "Richiesta verificata del membro",
    otherVerified: "Altro motivo verificato",
    empty: "Nessuna soppressione corrispondente.",
    releasedSuccess: "Soppressione del destinatario rimossa.",
    invalidRelease: "La richiesta di sblocco non e valida.",
    releaseError: "Impossibile rimuovere la soppressione.",
    pagination: "Navigazione pagine",
    previousPage: "Pagina precedente",
    nextPage: "Pagina successiva",
    results: "risultati",
  },
  es: {
    ...de,
    tab: "Supresiones",
    title: "Supresiones de destinatarios",
    description:
      "Los destinatarios no entregables o denunciados se bloquean antes del descifrado y del envio.",
    search: "Buscar nombre o correo",
    status: "Estado",
    reason: "Motivo",
    all: "Todos",
    active: "Activa",
    released: "Liberada",
    expired: "Caducada",
    hardBounce: "No entregable permanentemente",
    softBounce: "No entregable temporalmente",
    complaint: "Queja",
    recipient: "Destinatario",
    occurrences: "Eventos",
    lastEvent: "Ultimo evento",
    lifecycle: "Ciclo de vida",
    action: "Accion",
    filter: "Filtrar",
    release: "Liberar",
    releaseReason: "Motivo de revision",
    addressCorrected: "Direccion corregida",
    providerError: "Error del proveedor confirmado",
    memberRequest: "Solicitud verificada del miembro",
    otherVerified: "Otro motivo verificado",
    empty: "No hay supresiones coincidentes.",
    releasedSuccess: "Supresion del destinatario liberada.",
    invalidRelease: "La solicitud de liberacion no es valida.",
    releaseError: "No se pudo liberar la supresion.",
    pagination: "Paginacion",
    previousPage: "Pagina anterior",
    nextPage: "Pagina siguiente",
    results: "resultados",
  },
  fr: {
    ...de,
    tab: "Suppressions",
    title: "Suppressions de destinataires",
    description:
      "Les destinataires non distribuables ou signales sont bloques avant le dechiffrement et l'envoi.",
    search: "Rechercher un nom ou un e-mail",
    status: "Statut",
    reason: "Motif",
    all: "Tous",
    active: "Active",
    released: "Liberee",
    expired: "Expiree",
    hardBounce: "Definitivement non distribuable",
    softBounce: "Temporairement non distribuable",
    complaint: "Plainte",
    recipient: "Destinataire",
    occurrences: "Evenements",
    lastEvent: "Dernier evenement",
    lifecycle: "Cycle de vie",
    action: "Action",
    filter: "Filtrer",
    release: "Liberer",
    releaseReason: "Motif de verification",
    addressCorrected: "Adresse corrigee",
    providerError: "Erreur fournisseur confirmee",
    memberRequest: "Demande du membre verifiee",
    otherVerified: "Autre motif verifie",
    empty: "Aucune suppression correspondante.",
    releasedSuccess: "Suppression du destinataire liberee.",
    invalidRelease: "La demande de liberation n'est pas valide.",
    releaseError: "La suppression n'a pas pu etre liberee.",
    pagination: "Pagination",
    previousPage: "Page precedente",
    nextPage: "Page suivante",
    results: "resultats",
  },
};

export function getEmailSuppressionCopy(locale: AppLocale) {
  return translations[locale];
}

export type EmailSuppressionCopy = Copy;
