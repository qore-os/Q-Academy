import type { AppLocale } from "@/lib/i18n/model";

function staticMessage(value: string) {
  return (...counts: [string]) => {
    void counts;
    return value;
  };
}

const de = {
  page: { metadataTitle: "Event-Plan" },
  common: {
    closeDialog: "Dialog schließen",
    save: "Speichern",
    cancelled: "Abgesagt",
    scheduled: "Geplant",
    online: "Online",
  },
  types: {
    live_call: "Live Call",
    workshop: "Workshop",
    webinar: "Webinar",
    deadline: "Deadline",
  },
  colors: {
    teal: "Türkis",
    blue: "Blau",
    coral: "Koralle",
    gold: "Gold",
    violet: "Violett",
    green: "Grün",
    custom: "Eigene Farbe",
    customAccent: "Eigene Akzentfarbe",
  },
  details: {
    title: "Titel",
    description: "Beschreibung",
    type: "Typ",
    accent: "Akzentfarbe",
    preview: "Event-Vorschau",
    scheduleReason: "Grund bei Zeitänderung",
    scheduleReasonHint: "Wird nur bei geändertem Zeitraum verwendet",
    startsAt: "Beginn",
    endsAt: "Ende",
    meetingUrl: "Meeting-URL",
    location: "Ort",
    capacity: "Kapazität",
    unlimited: "Unbegrenzt",
  },
  audience: {
    empty: "Keine Einträge vorhanden.",
    visibility: "Sichtbarkeit",
    tenant: "Gesamte Organisation",
    tenantDescription: "Alle aktiven Mitglieder können den Termin sehen.",
    restricted: "Ausgewählte Zielgruppen",
    restrictedDescription: "Direkte Nutzer-, Gruppen- oder Bundle-Freigaben.",
    members: "Mitglieder",
    membersDescription: "Einzelne Personen direkt berechtigen.",
    groups: "Gruppen",
    groupsDescription: "Alle aktuellen Gruppenmitglieder.",
    bundles: "Bundles",
    bundlesDescription: "Direkt oder über Gruppen zugewiesen.",
    save: "Zielgruppe speichern",
  },
  attendance: {
    member: "Mitglied",
    selectMember: "Mitglied auswählen",
    noEligible: "Keine berechtigten Mitglieder",
    status: "Status",
    setStatus: "Teilnahmestatus setzen",
    going: "Dabei",
    maybe: "Vielleicht",
    declined: "Abgesagt",
    set: "Setzen",
    summary: (answers: string, accepted: string) => `${answers} Antworten, ${accepted} Zusagen`,
    exportCsv: "Teilnahmen als CSV exportieren",
    csvLabel: "CSV",
    statusFor: (name: string) => `Status von ${name}`,
    remove: "Antwort entfernen",
    removeFor: (name: string) => `Antwort von ${name} entfernen`,
    empty: "Noch keine Teilnahmeantworten.",
    locked: "Der Teilnahmestatus ist für abgesagte Termine gesperrt. Bestehende Antworten bleiben erhalten.",
  },
  lifecycle: {
    currentStatus: "Aktueller Status",
    revision: (revision: string) => `Lifecycle-Revision ${revision}`,
    planAgain: "Termin neu planen",
    reschedule: "Termin verschieben",
    rescheduleDescription: "Der neue Zeitraum wird versioniert und alle aktuell berechtigten Mitglieder werden informiert.",
    newStart: "Neuer Beginn",
    newEnd: "Neues Ende",
    reason: "Grund",
    planAgainAction: "Neu planen",
    rescheduleAction: "Verschieben",
    cancelTitle: "Termin absagen",
    cancelDescription: "Die Absage bleibt in der Historie erhalten. Zusagen werden nicht gelöscht.",
    cancelReason: "Absagegrund",
    cancelAction: "Termin absagen",
    history: "Statusverlauf",
    historyRevision: (revision: string, date: string) => `Rev. ${revision} · ${date}`,
    created: "Erstellt",
    rescheduled: "Neu geplant",
    cancelled: "Abgesagt",
    period: (start: string, end: string) => `${start} bis ${end}`,
    empty: "Für diesen Bestands-Termin liegt noch kein Lifecycle-Eintrag vor.",
  },
  dialog: {
    manage: (title: string) => `${title} verwalten`,
    eyebrow: "Event-Verwaltung",
    areas: "Event-Bereiche",
    details: "Details",
    lifecycle: "Status & Planung",
    audience: "Zielgruppe",
    attendance: (count: string) => `Teilnehmende (${count})`,
  },
  manager: {
    title: "Alle Termine",
    count: (count: string) => `${count} geplante und vergangene Events`,
    tenant: "Organisationsweit",
    audience: "Zielgruppe",
    manage: "Verwalten",
    empty: "Noch keine Termine",
  },
  create: {
    button: "Event erstellen",
    title: "Event erstellen",
    eyebrow: "Live Learning",
    titlePlaceholder: "z. B. KI-Sprechstunde",
    descriptionPlaceholder: "Agenda und erwartete Ergebnisse",
    locationPlaceholder: "Online oder Raum",
    successTitle: "Erfolgreich erstellt",
    done: "Fertig",
    cancel: "Abbrechen",
    creating: "Wird erstellt",
    submit: "Erstellen",
  },
  messages: {
    invalid: staticMessage("Bitte prüfe die Termindaten."),
    notFound: staticMessage("Der Termin wurde nicht gefunden."),
    capacityBelowAttendance: staticMessage("Die Kapazität liegt unter der Zahl bestehender Zusagen."),
    alreadyCancelled: staticMessage("Der Termin ist bereits abgesagt."),
    scheduleUnchanged: staticMessage("Der neue Zeitraum ist unverändert."),
    invalidWindow: staticMessage("Das Ende muss nach dem Beginn liegen."),
    startNotFuture: staticMessage("Der neue Beginn muss in der Zukunft liegen."),
    concurrentChange: staticMessage("Der Termin wurde parallel geändert. Bitte lade die Seite neu."),
    saved: staticMessage("Termin gespeichert."),
    rescheduled: (count: string) => `Termin neu geplant. ${count} Mitglieder wurden informiert.`,
    cancelled: (count: string) => `Termin abgesagt. ${count} Mitglieder wurden informiert.`,
    audienceInvalid: staticMessage("Bitte prüfe die Zielgruppe."),
    audienceTargetInvalid: staticMessage("Mindestens ein Ziel gehört nicht zu dieser Organisation."),
    audienceSaved: (count: string) => count === "0" ? "Zielgruppe gespeichert." : `Zielgruppe gespeichert. ${count} unberechtigte Antworten wurden entfernt.`,
    attendanceInvalid: staticMessage("Die Teilnahmeangaben sind ungültig."),
    attendanceNotFound: staticMessage("Termin oder Mitglied wurde nicht gefunden."),
    attendanceFull: staticMessage("Der Termin ist bereits ausgebucht."),
    attendanceCancelled: staticMessage("Für abgesagte Termine kann keine Teilnahme gesetzt werden."),
    attendanceSaved: staticMessage("Teilnahmestatus gespeichert."),
    attendanceRemoved: staticMessage("Teilnahmeantwort entfernt."),
    failed: staticMessage("Die Event-Aktion konnte nicht ausgeführt werden."),
    eventCreateInvalid: staticMessage("Bitte prüfe die Eventdaten."),
    eventCreateFuture: staticMessage("Das Event muss in der Zukunft enden."),
    eventCreateDuplicate: staticMessage("Ein Event mit diesem Titel und Startzeitpunkt existiert bereits."),
    eventCreated: staticMessage("Event erstellt."),
    eventCreateFailed: staticMessage("Das Event konnte nicht erstellt werden."),
  },
  csv: {
    headers: ["Vorname", "Nachname", "E-Mail", "Status", "Antwort am"],
    fileName: (id: string) => `event-${id}-teilnehmende.csv`,
  },
  member: {
    cancellationReason: "Absagegrund:",
    online: "Online",
    attendance: (count: string, capacity: string | null) => capacity ? `${count} von ${capacity} dabei` : `${count} dabei`,
    history: (count: string) => `Statusverlauf (${count})`,
    created: "Erstellt",
    rescheduled: "Neu geplant",
    cancelled: "Abgesagt",
    changedAt: (date: string) => `am ${date}`,
    forDate: (date: string) => `für ${date}`,
    rsvpInvalid: "Die Teilnahmeangaben sind ungültig.",
    rsvpUnavailable: "Dieser Termin ist nicht verfügbar.",
    rsvpEnded: "Dieser Termin ist bereits beendet.",
    rsvpCancelled: "Dieser Termin wurde abgesagt.",
    rsvpFull: "Dieser Termin ist bereits ausgebucht.",
    rsvpSaved: "Teilnahmestatus gespeichert.",
  },
};

type WidenCopy<T> = T extends (...args: infer Args) => string
  ? (...args: Args) => string
  : T extends readonly string[]
    ? readonly string[]
    : T extends string
      ? string
      : { readonly [Key in keyof T]: WidenCopy<T[Key]> };

export type EventAdminCopy = WidenCopy<typeof de>;
export type EventAdminMessageCode = keyof EventAdminCopy["messages"];

const en: EventAdminCopy = {
  page: { metadataTitle: "Events" },
  common: { closeDialog: "Close dialog", save: "Save", cancelled: "Cancelled", scheduled: "Scheduled", online: "Online" },
  types: { live_call: "Live call", workshop: "Workshop", webinar: "Webinar", deadline: "Deadline" },
  colors: { teal: "Teal", blue: "Blue", coral: "Coral", gold: "Gold", violet: "Violet", green: "Green", custom: "Custom colour", customAccent: "Custom accent colour" },
  details: { title: "Title", description: "Description", type: "Type", accent: "Accent colour", preview: "Event preview", scheduleReason: "Reason for time change", scheduleReasonHint: "Only used when the time period changes", startsAt: "Start", endsAt: "End", meetingUrl: "Meeting URL", location: "Location", capacity: "Capacity", unlimited: "Unlimited" },
  audience: { empty: "No entries available.", visibility: "Visibility", tenant: "Entire organisation", tenantDescription: "All active members can see this event.", restricted: "Selected audiences", restrictedDescription: "Direct user, group or bundle grants.", members: "Members", membersDescription: "Grant access to individual people.", groups: "Groups", groupsDescription: "All current group members.", bundles: "Bundles", bundlesDescription: "Assigned directly or through groups.", save: "Save audience" },
  attendance: { member: "Member", selectMember: "Select member", noEligible: "No eligible members", status: "Status", setStatus: "Set attendance status", going: "Going", maybe: "Maybe", declined: "Declined", set: "Set", summary: (answers, accepted) => `${answers} responses, ${accepted} going`, exportCsv: "Export attendance as CSV", csvLabel: "CSV", statusFor: (name) => `Status for ${name}`, remove: "Remove response", removeFor: (name) => `Remove response from ${name}`, empty: "No attendance responses yet.", locked: "Attendance is locked for cancelled events. Existing responses remain available." },
  lifecycle: { currentStatus: "Current status", revision: (revision) => `Lifecycle revision ${revision}`, planAgain: "Reschedule event", reschedule: "Move event", rescheduleDescription: "The new period is versioned and all currently eligible members are notified.", newStart: "New start", newEnd: "New end", reason: "Reason", planAgainAction: "Reschedule", rescheduleAction: "Move", cancelTitle: "Cancel event", cancelDescription: "The cancellation remains in the history. Responses are not deleted.", cancelReason: "Cancellation reason", cancelAction: "Cancel event", history: "Status history", historyRevision: (revision, date) => `Rev. ${revision} · ${date}`, created: "Created", rescheduled: "Rescheduled", cancelled: "Cancelled", period: (start, end) => `${start} to ${end}`, empty: "No lifecycle entry exists for this legacy event yet." },
  dialog: { manage: (title) => `Manage ${title}`, eyebrow: "Event management", areas: "Event sections", details: "Details", lifecycle: "Status & schedule", audience: "Audience", attendance: (count) => `Attendees (${count})` },
  manager: { title: "All events", count: (count) => `${count} scheduled and past events`, tenant: "Organisation-wide", audience: "Audience", manage: "Manage", empty: "No events yet" },
  create: { button: "Create event", title: "Create event", eyebrow: "Live learning", titlePlaceholder: "e.g. AI office hours", descriptionPlaceholder: "Agenda and expected outcomes", locationPlaceholder: "Online or room", successTitle: "Created successfully", done: "Done", cancel: "Cancel", creating: "Creating", submit: "Create" },
  messages: { invalid: () => "Check the event details.", notFound: () => "The event was not found.", capacityBelowAttendance: () => "Capacity is below the number of existing confirmations.", alreadyCancelled: () => "The event is already cancelled.", scheduleUnchanged: () => "The new period is unchanged.", invalidWindow: () => "The end must be after the start.", startNotFuture: () => "The new start must be in the future.", concurrentChange: () => "The event was changed concurrently. Reload the page.", saved: () => "Event saved.", rescheduled: (count) => `Event rescheduled. ${count} members were notified.`, cancelled: (count) => `Event cancelled. ${count} members were notified.`, audienceInvalid: () => "Check the audience.", audienceTargetInvalid: () => "At least one target does not belong to this organisation.", audienceSaved: (count) => count === "0" ? "Audience saved." : `Audience saved. ${count} ineligible responses were removed.`, attendanceInvalid: () => "The attendance details are invalid.", attendanceNotFound: () => "The event or member was not found.", attendanceFull: () => "The event is fully booked.", attendanceCancelled: () => "Attendance cannot be set for cancelled events.", attendanceSaved: () => "Attendance status saved.", attendanceRemoved: () => "Attendance response removed.", failed: () => "The event action could not be completed.", eventCreateInvalid: () => "Check the event details.", eventCreateFuture: () => "The event must end in the future.", eventCreateDuplicate: () => "An event with this title and start time already exists.", eventCreated: () => "Event created.", eventCreateFailed: () => "The event could not be created." },
  csv: { headers: ["First name", "Last name", "Email", "Status", "Responded at"], fileName: (id) => `event-${id}-attendees.csv` },
  member: { cancellationReason: "Cancellation reason:", online: "Online", attendance: (count, capacity) => capacity ? `${count} of ${capacity} going` : `${count} going`, history: (count) => `Status history (${count})`, created: "Created", rescheduled: "Rescheduled", cancelled: "Cancelled", changedAt: (date) => `on ${date}`, forDate: (date) => `for ${date}`, rsvpInvalid: "The attendance details are invalid.", rsvpUnavailable: "This event is not available.", rsvpEnded: "This event has already ended.", rsvpCancelled: "This event was cancelled.", rsvpFull: "This event is fully booked.", rsvpSaved: "Attendance status saved." },
};

const it: EventAdminCopy = {
  page: { metadataTitle: "Eventi" },
  common: { closeDialog: "Chiudi finestra", save: "Salva", cancelled: "Annullato", scheduled: "Pianificato", online: "Online" },
  types: { live_call: "Call live", workshop: "Workshop", webinar: "Webinar", deadline: "Scadenza" },
  colors: { teal: "Turchese", blue: "Blu", coral: "Corallo", gold: "Oro", violet: "Viola", green: "Verde", custom: "Colore personalizzato", customAccent: "Colore accento personalizzato" },
  details: { title: "Titolo", description: "Descrizione", type: "Tipo", accent: "Colore accento", preview: "Anteprima evento", scheduleReason: "Motivo della modifica oraria", scheduleReasonHint: "Usato solo quando cambia l'intervallo", startsAt: "Inizio", endsAt: "Fine", meetingUrl: "URL riunione", location: "Luogo", capacity: "Capienza", unlimited: "Illimitata" },
  audience: { empty: "Nessuna voce disponibile.", visibility: "Visibilità", tenant: "Intera organizzazione", tenantDescription: "Tutti i membri attivi possono vedere l'evento.", restricted: "Destinatari selezionati", restrictedDescription: "Autorizzazioni dirette per utenti, gruppi o bundle.", members: "Membri", membersDescription: "Autorizza singole persone.", groups: "Gruppi", groupsDescription: "Tutti i membri attuali del gruppo.", bundles: "Bundle", bundlesDescription: "Assegnati direttamente o tramite gruppi.", save: "Salva destinatari" },
  attendance: { member: "Membro", selectMember: "Seleziona membro", noEligible: "Nessun membro idoneo", status: "Stato", setStatus: "Imposta stato partecipazione", going: "Partecipa", maybe: "Forse", declined: "Rifiutato", set: "Imposta", summary: (answers, accepted) => `${answers} risposte, ${accepted} partecipazioni`, exportCsv: "Esporta partecipazioni in CSV", csvLabel: "CSV", statusFor: (name) => `Stato di ${name}`, remove: "Rimuovi risposta", removeFor: (name) => `Rimuovi risposta di ${name}`, empty: "Nessuna risposta di partecipazione.", locked: "La partecipazione è bloccata per gli eventi annullati. Le risposte esistenti restano disponibili." },
  lifecycle: { currentStatus: "Stato attuale", revision: (revision) => `Revisione lifecycle ${revision}`, planAgain: "Riprogramma evento", reschedule: "Sposta evento", rescheduleDescription: "Il nuovo intervallo viene versionato e tutti i membri attualmente idonei vengono avvisati.", newStart: "Nuovo inizio", newEnd: "Nuova fine", reason: "Motivo", planAgainAction: "Riprogramma", rescheduleAction: "Sposta", cancelTitle: "Annulla evento", cancelDescription: "L'annullamento resta nella cronologia. Le risposte non vengono eliminate.", cancelReason: "Motivo dell'annullamento", cancelAction: "Annulla evento", history: "Cronologia stato", historyRevision: (revision, date) => `Rev. ${revision} · ${date}`, created: "Creato", rescheduled: "Riprogrammato", cancelled: "Annullato", period: (start, end) => `${start} - ${end}`, empty: "Non è ancora presente una voce lifecycle per questo evento esistente." },
  dialog: { manage: (title) => `Gestisci ${title}`, eyebrow: "Gestione eventi", areas: "Sezioni evento", details: "Dettagli", lifecycle: "Stato e pianificazione", audience: "Destinatari", attendance: (count) => `Partecipanti (${count})` },
  manager: { title: "Tutti gli eventi", count: (count) => `${count} eventi pianificati e passati`, tenant: "Tutta l'organizzazione", audience: "Destinatari", manage: "Gestisci", empty: "Nessun evento" },
  create: { button: "Crea evento", title: "Crea evento", eyebrow: "Apprendimento live", titlePlaceholder: "es. Incontro sull'IA", descriptionPlaceholder: "Agenda e risultati attesi", locationPlaceholder: "Online o sala", successTitle: "Creato correttamente", done: "Fine", cancel: "Annulla", creating: "Creazione", submit: "Crea" },
  messages: { invalid: () => "Controlla i dati dell'evento.", notFound: () => "L'evento non è stato trovato.", capacityBelowAttendance: () => "La capienza è inferiore alle conferme esistenti.", alreadyCancelled: () => "L'evento è già annullato.", scheduleUnchanged: () => "Il nuovo intervallo non è cambiato.", invalidWindow: () => "La fine deve essere successiva all'inizio.", startNotFuture: () => "Il nuovo inizio deve essere nel futuro.", concurrentChange: () => "L'evento è stato modificato contemporaneamente. Ricarica la pagina.", saved: () => "Evento salvato.", rescheduled: (count) => `Evento riprogrammato. ${count} membri sono stati avvisati.`, cancelled: (count) => `Evento annullato. ${count} membri sono stati avvisati.`, audienceInvalid: () => "Controlla i destinatari.", audienceTargetInvalid: () => "Almeno un destinatario non appartiene all'organizzazione.", audienceSaved: (count) => count === "0" ? "Destinatari salvati." : `Destinatari salvati. Rimosse ${count} risposte non autorizzate.`, attendanceInvalid: () => "I dati di partecipazione non sono validi.", attendanceNotFound: () => "Evento o membro non trovato.", attendanceFull: () => "L'evento è al completo.", attendanceCancelled: () => "Non è possibile impostare la partecipazione per eventi annullati.", attendanceSaved: () => "Stato partecipazione salvato.", attendanceRemoved: () => "Risposta di partecipazione rimossa.", failed: () => "Non è stato possibile completare l'azione sull'evento.", eventCreateInvalid: () => "Controlla i dati dell'evento.", eventCreateFuture: () => "L'evento deve terminare nel futuro.", eventCreateDuplicate: () => "Esiste già un evento con questo titolo e orario di inizio.", eventCreated: () => "Evento creato.", eventCreateFailed: () => "Non è stato possibile creare l'evento." },
  csv: { headers: ["Nome", "Cognome", "E-mail", "Stato", "Risposta il"], fileName: (id) => `evento-${id}-partecipanti.csv` },
  member: { cancellationReason: "Motivo dell'annullamento:", online: "Online", attendance: (count, capacity) => capacity ? `${count} di ${capacity} partecipano` : `${count} partecipano`, history: (count) => `Cronologia stato (${count})`, created: "Creato", rescheduled: "Riprogrammato", cancelled: "Annullato", changedAt: (date) => `il ${date}`, forDate: (date) => `per ${date}`, rsvpInvalid: "I dati di partecipazione non sono validi.", rsvpUnavailable: "Questo evento non è disponibile.", rsvpEnded: "Questo evento è già terminato.", rsvpCancelled: "Questo evento è stato annullato.", rsvpFull: "Questo evento è al completo.", rsvpSaved: "Stato partecipazione salvato." },
};

const es: EventAdminCopy = {
  page: { metadataTitle: "Eventos" },
  common: { closeDialog: "Cerrar diálogo", save: "Guardar", cancelled: "Cancelado", scheduled: "Programado", online: "Online" },
  types: { live_call: "Llamada en directo", workshop: "Taller", webinar: "Webinario", deadline: "Fecha límite" },
  colors: { teal: "Turquesa", blue: "Azul", coral: "Coral", gold: "Dorado", violet: "Violeta", green: "Verde", custom: "Color personalizado", customAccent: "Color de acento personalizado" },
  details: { title: "Título", description: "Descripción", type: "Tipo", accent: "Color de acento", preview: "Vista previa del evento", scheduleReason: "Motivo del cambio horario", scheduleReasonHint: "Solo se usa cuando cambia el periodo", startsAt: "Inicio", endsAt: "Fin", meetingUrl: "URL de la reunión", location: "Lugar", capacity: "Capacidad", unlimited: "Ilimitada" },
  audience: { empty: "No hay entradas.", visibility: "Visibilidad", tenant: "Toda la organización", tenantDescription: "Todos los miembros activos pueden ver el evento.", restricted: "Destinatarios seleccionados", restrictedDescription: "Permisos directos para usuarios, grupos o paquetes.", members: "Miembros", membersDescription: "Autoriza personas individuales.", groups: "Grupos", groupsDescription: "Todos los miembros actuales del grupo.", bundles: "Paquetes", bundlesDescription: "Asignados directamente o mediante grupos.", save: "Guardar destinatarios" },
  attendance: { member: "Miembro", selectMember: "Seleccionar miembro", noEligible: "No hay miembros aptos", status: "Estado", setStatus: "Establecer estado de asistencia", going: "Asistirá", maybe: "Quizás", declined: "Rechazado", set: "Establecer", summary: (answers, accepted) => `${answers} respuestas, ${accepted} confirmaciones`, exportCsv: "Exportar asistencia como CSV", csvLabel: "CSV", statusFor: (name) => `Estado de ${name}`, remove: "Eliminar respuesta", removeFor: (name) => `Eliminar respuesta de ${name}`, empty: "Aún no hay respuestas de asistencia.", locked: "La asistencia está bloqueada para eventos cancelados. Las respuestas existentes se conservan." },
  lifecycle: { currentStatus: "Estado actual", revision: (revision) => `Revisión del ciclo ${revision}`, planAgain: "Reprogramar evento", reschedule: "Cambiar evento", rescheduleDescription: "El nuevo periodo se versiona y se avisa a todos los miembros actualmente autorizados.", newStart: "Nuevo inicio", newEnd: "Nuevo fin", reason: "Motivo", planAgainAction: "Reprogramar", rescheduleAction: "Cambiar", cancelTitle: "Cancelar evento", cancelDescription: "La cancelación se conserva en el historial. Las respuestas no se eliminan.", cancelReason: "Motivo de cancelación", cancelAction: "Cancelar evento", history: "Historial de estado", historyRevision: (revision, date) => `Rev. ${revision} · ${date}`, created: "Creado", rescheduled: "Reprogramado", cancelled: "Cancelado", period: (start, end) => `${start} a ${end}`, empty: "Este evento existente aún no tiene una entrada de ciclo." },
  dialog: { manage: (title) => `Gestionar ${title}`, eyebrow: "Gestión de eventos", areas: "Secciones del evento", details: "Detalles", lifecycle: "Estado y planificación", audience: "Destinatarios", attendance: (count) => `Participantes (${count})` },
  manager: { title: "Todos los eventos", count: (count) => `${count} eventos programados y pasados`, tenant: "Toda la organización", audience: "Destinatarios", manage: "Gestionar", empty: "Aún no hay eventos" },
  create: { button: "Crear evento", title: "Crear evento", eyebrow: "Aprendizaje en directo", titlePlaceholder: "p. ej., sesión sobre IA", descriptionPlaceholder: "Agenda y resultados esperados", locationPlaceholder: "Online o sala", successTitle: "Creado correctamente", done: "Listo", cancel: "Cancelar", creating: "Creando", submit: "Crear" },
  messages: { invalid: () => "Comprueba los datos del evento.", notFound: () => "No se encontró el evento.", capacityBelowAttendance: () => "La capacidad es inferior a las confirmaciones existentes.", alreadyCancelled: () => "El evento ya está cancelado.", scheduleUnchanged: () => "El nuevo periodo no ha cambiado.", invalidWindow: () => "El fin debe ser posterior al inicio.", startNotFuture: () => "El nuevo inicio debe estar en el futuro.", concurrentChange: () => "El evento se modificó simultáneamente. Recarga la página.", saved: () => "Evento guardado.", rescheduled: (count) => `Evento reprogramado. Se avisó a ${count} miembros.`, cancelled: (count) => `Evento cancelado. Se avisó a ${count} miembros.`, audienceInvalid: () => "Comprueba los destinatarios.", audienceTargetInvalid: () => "Al menos un destinatario no pertenece a la organización.", audienceSaved: (count) => count === "0" ? "Destinatarios guardados." : `Destinatarios guardados. Se eliminaron ${count} respuestas no autorizadas.`, attendanceInvalid: () => "Los datos de asistencia no son válidos.", attendanceNotFound: () => "No se encontró el evento o el miembro.", attendanceFull: () => "El evento está completo.", attendanceCancelled: () => "No se puede establecer la asistencia en eventos cancelados.", attendanceSaved: () => "Estado de asistencia guardado.", attendanceRemoved: () => "Respuesta de asistencia eliminada.", failed: () => "No se pudo completar la acción del evento.", eventCreateInvalid: () => "Comprueba los datos del evento.", eventCreateFuture: () => "El evento debe terminar en el futuro.", eventCreateDuplicate: () => "Ya existe un evento con este título y hora de inicio.", eventCreated: () => "Evento creado.", eventCreateFailed: () => "No se pudo crear el evento." },
  csv: { headers: ["Nombre", "Apellidos", "Correo electrónico", "Estado", "Respuesta el"], fileName: (id) => `evento-${id}-participantes.csv` },
  member: { cancellationReason: "Motivo de cancelación:", online: "Online", attendance: (count, capacity) => capacity ? `${count} de ${capacity} asistirán` : `${count} asistirán`, history: (count) => `Historial de estado (${count})`, created: "Creado", rescheduled: "Reprogramado", cancelled: "Cancelado", changedAt: (date) => `el ${date}`, forDate: (date) => `para ${date}`, rsvpInvalid: "Los datos de asistencia no son válidos.", rsvpUnavailable: "Este evento no está disponible.", rsvpEnded: "Este evento ya ha terminado.", rsvpCancelled: "Este evento fue cancelado.", rsvpFull: "Este evento está completo.", rsvpSaved: "Estado de asistencia guardado." },
};

const fr: EventAdminCopy = {
  page: { metadataTitle: "Événements" },
  common: { closeDialog: "Fermer la boîte de dialogue", save: "Enregistrer", cancelled: "Annulé", scheduled: "Planifié", online: "En ligne" },
  types: { live_call: "Appel en direct", workshop: "Atelier", webinar: "Webinaire", deadline: "Échéance" },
  colors: { teal: "Turquoise", blue: "Bleu", coral: "Corail", gold: "Or", violet: "Violet", green: "Vert", custom: "Couleur personnalisée", customAccent: "Couleur d'accent personnalisée" },
  details: { title: "Titre", description: "Description", type: "Type", accent: "Couleur d'accent", preview: "Aperçu de l'événement", scheduleReason: "Motif du changement d'horaire", scheduleReasonHint: "Utilisé uniquement lorsque la période change", startsAt: "Début", endsAt: "Fin", meetingUrl: "URL de la réunion", location: "Lieu", capacity: "Capacité", unlimited: "Illimitée" },
  audience: { empty: "Aucune entrée disponible.", visibility: "Visibilité", tenant: "Toute l'organisation", tenantDescription: "Tous les membres actifs peuvent voir l'événement.", restricted: "Publics sélectionnés", restrictedDescription: "Autorisations directes pour utilisateurs, groupes ou offres.", members: "Membres", membersDescription: "Autoriser des personnes individuellement.", groups: "Groupes", groupsDescription: "Tous les membres actuels du groupe.", bundles: "Offres", bundlesDescription: "Attribuées directement ou via des groupes.", save: "Enregistrer le public" },
  attendance: { member: "Membre", selectMember: "Sélectionner un membre", noEligible: "Aucun membre éligible", status: "Statut", setStatus: "Définir le statut de participation", going: "Participe", maybe: "Peut-être", declined: "Refusé", set: "Définir", summary: (answers, accepted) => `${answers} réponses, ${accepted} participations`, exportCsv: "Exporter les participations en CSV", csvLabel: "CSV", statusFor: (name) => `Statut de ${name}`, remove: "Supprimer la réponse", removeFor: (name) => `Supprimer la réponse de ${name}`, empty: "Aucune réponse de participation.", locked: "La participation est verrouillée pour les événements annulés. Les réponses existantes sont conservées." },
  lifecycle: { currentStatus: "Statut actuel", revision: (revision) => `Révision du cycle ${revision}`, planAgain: "Replanifier l'événement", reschedule: "Déplacer l'événement", rescheduleDescription: "La nouvelle période est versionnée et tous les membres actuellement éligibles sont informés.", newStart: "Nouveau début", newEnd: "Nouvelle fin", reason: "Motif", planAgainAction: "Replanifier", rescheduleAction: "Déplacer", cancelTitle: "Annuler l'événement", cancelDescription: "L'annulation reste dans l'historique. Les réponses ne sont pas supprimées.", cancelReason: "Motif d'annulation", cancelAction: "Annuler l'événement", history: "Historique du statut", historyRevision: (revision, date) => `Rév. ${revision} · ${date}`, created: "Créé", rescheduled: "Replanifié", cancelled: "Annulé", period: (start, end) => `${start} à ${end}`, empty: "Aucune entrée de cycle n'existe encore pour cet événement historique." },
  dialog: { manage: (title) => `Gérer ${title}`, eyebrow: "Gestion des événements", areas: "Sections de l'événement", details: "Détails", lifecycle: "Statut et planification", audience: "Public", attendance: (count) => `Participants (${count})` },
  manager: { title: "Tous les événements", count: (count) => `${count} événements planifiés et passés`, tenant: "Toute l'organisation", audience: "Public", manage: "Gérer", empty: "Aucun événement" },
  create: { button: "Créer un événement", title: "Créer un événement", eyebrow: "Apprentissage en direct", titlePlaceholder: "p. ex. permanence IA", descriptionPlaceholder: "Programme et résultats attendus", locationPlaceholder: "En ligne ou salle", successTitle: "Création réussie", done: "Terminé", cancel: "Annuler", creating: "Création", submit: "Créer" },
  messages: { invalid: () => "Vérifiez les informations de l'événement.", notFound: () => "L'événement est introuvable.", capacityBelowAttendance: () => "La capacité est inférieure aux confirmations existantes.", alreadyCancelled: () => "L'événement est déjà annulé.", scheduleUnchanged: () => "La nouvelle période est inchangée.", invalidWindow: () => "La fin doit être postérieure au début.", startNotFuture: () => "Le nouveau début doit être dans le futur.", concurrentChange: () => "L'événement a été modifié simultanément. Rechargez la page.", saved: () => "Événement enregistré.", rescheduled: (count) => `Événement replanifié. ${count} membres ont été informés.`, cancelled: (count) => `Événement annulé. ${count} membres ont été informés.`, audienceInvalid: () => "Vérifiez le public.", audienceTargetInvalid: () => "Au moins une cible n'appartient pas à l'organisation.", audienceSaved: (count) => count === "0" ? "Public enregistré." : `Public enregistré. ${count} réponses non autorisées ont été supprimées.`, attendanceInvalid: () => "Les informations de participation sont invalides.", attendanceNotFound: () => "L'événement ou le membre est introuvable.", attendanceFull: () => "L'événement est complet.", attendanceCancelled: () => "La participation ne peut pas être définie pour un événement annulé.", attendanceSaved: () => "Statut de participation enregistré.", attendanceRemoved: () => "Réponse de participation supprimée.", failed: () => "L'action sur l'événement n'a pas pu être exécutée.", eventCreateInvalid: () => "Vérifiez les informations de l'événement.", eventCreateFuture: () => "L'événement doit se terminer dans le futur.", eventCreateDuplicate: () => "Un événement avec ce titre et cette heure de début existe déjà.", eventCreated: () => "Événement créé.", eventCreateFailed: () => "L'événement n'a pas pu être créé." },
  csv: { headers: ["Prénom", "Nom", "E-mail", "Statut", "Réponse le"], fileName: (id) => `evenement-${id}-participants.csv` },
  member: { cancellationReason: "Motif d'annulation :", online: "En ligne", attendance: (count, capacity) => capacity ? `${count} sur ${capacity} participent` : `${count} participent`, history: (count) => `Historique du statut (${count})`, created: "Créé", rescheduled: "Replanifié", cancelled: "Annulé", changedAt: (date) => `le ${date}`, forDate: (date) => `pour le ${date}`, rsvpInvalid: "Les informations de participation sont invalides.", rsvpUnavailable: "Cet événement n'est pas disponible.", rsvpEnded: "Cet événement est déjà terminé.", rsvpCancelled: "Cet événement a été annulé.", rsvpFull: "Cet événement est complet.", rsvpSaved: "Statut de participation enregistré." },
};

const dictionaries = { de, en, it, es, fr } satisfies Record<
  AppLocale,
  EventAdminCopy
>;

export function getEventAdminCopy(locale: AppLocale) {
  return dictionaries[locale];
}

export { dictionaries as eventAdminDictionaries };
