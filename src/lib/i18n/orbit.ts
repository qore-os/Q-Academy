import type { AppLocale } from "@/lib/i18n/model";
import type { OrbitTransferWarningCode } from "@/lib/orbit/transfer-contract";

type OrbitCopy = {
  common: {
    controlPlane: string;
    academy: string;
    actionFailed: string;
    refresh: string;
    instances: (count: number) => string;
    slots: string;
    tabs: Record<"instances" | "transfer" | "access" | "billing" | "audit", string>;
    status: Record<string, string>;
    role: Record<string, string>;
  };
  instances: {
    title: string;
    entitlements: (count: number) => string;
    seats: string;
    courses: string;
    open: string;
    customerReference: string;
    seatLimit: string;
    courseLimit: string;
    status: string;
    entitlementsLabel: string;
    save: string;
    updated: string;
  };
  transfer: {
    title: string;
    source: string;
    target: string;
    publishedCourses: string;
    noPublishedCourses: string;
    execute: string;
    preflight: string;
    preflightComplete: string;
    preflightFailed: string;
    copyComplete: string;
    courses: string;
    media: string;
    targetUtilization: string;
    courseCount: (count: number) => string;
    mediaVolume: string;
    notRun: string;
    warningsTitle: string;
    warnings: Record<OrbitTransferWarningCode, string>;
    confirmWarnings: string;
    authorMappingTitle: string;
    authorMappingDescription: string;
    selectTargetAuthor: string;
    automaticMatch: string;
    historicalAuthor: string;
    noTargetAuthors: string;
    confirmAuthorMapping: string;
    journal: string;
    time: string;
    status: string;
  };
  access: {
    customerSlot: string;
    code: string;
    copy: string;
    occupiedSlots: (current: number, limit: number) => string;
    claimCreated: string;
    organizationRole: string;
    accountId: string;
    role: string;
    permissionSet: string;
    roleDefault: string;
    saveRole: string;
    roleSaved: string;
    permissionSetCreated: string;
    name: string;
    description: string;
    permissions: string;
    createPermissionSet: string;
    partnerDelegation: string;
    partner: string;
    select: string;
    instance: string;
    expires: string;
    scope: string;
    saveDelegation: string;
    delegationSaved: string;
    revoke: string;
    revoked: string;
    delegationRevoked: string;
  };
  billing: {
    configuration: string;
    status: string;
    interval: string;
    monthly: string;
    annual: string;
    intervalLocked: string;
    currency: string;
    baseFee: string;
    includedSlots: string;
    additionalFee: string;
    settlement: string;
    manual: string;
    external: string;
    externalReference: string;
    save: string;
    updated: string;
    readOnly: string;
    currentProjection: string;
    effectivePricing: string;
    scheduledPricing: string;
    effectiveFrom: string;
    instances: string;
    additionalInstances: string;
    period: string;
    finalizePrevious: string;
    finalized: string;
    statements: string;
    revision: string;
    subtotal: string;
    finalizedAt: string;
    noStatements: string;
  };
  audit: {
    title: string;
    time: string;
    actor: string;
    action: string;
    resource: string;
    outcome: string;
    system: string;
  };
  onboarding: {
    back: string;
    newOrganization: string;
    instanceCode: string;
    organization: string;
    name: string;
    slug: string;
    customerSlots: string;
    createOrganization: string;
    linkInstance: string;
    customerReference: string;
    redeemCode: string;
    organizationCreated: string;
    tenantLinked: string;
  };
};

const de: OrbitCopy = {
  common: { controlPlane: "Control Plane", academy: "Academy", actionFailed: "Orbit-Aktion fehlgeschlagen.", refresh: "Aktualisieren", instances: (count) => `${count} Instanzen`, slots: "Slots", tabs: { instances: "Instanzen", transfer: "Transfer", access: "Zugriff", billing: "Abrechnung", audit: "Audit" }, status: { active: "Aktiv", past_due: "Ueberfaellig", suspended: "Gesperrt", completed: "Abgeschlossen", succeeded: "Erfolgreich", failed: "Fehlgeschlagen", denied: "Abgelehnt", pending: "Ausstehend" }, role: { administrator: "Administrator", operator: "Operator", auditor: "Auditor", partner: "Partner", owner: "Eigentuemer" } },
  instances: { title: "Kundeninstanzen", entitlements: (count) => `${count} Entitlements`, seats: "Sitze", courses: "Kurse", open: "Instanz oeffnen", customerReference: "Kundenreferenz", seatLimit: "Sitzlimit", courseLimit: "Kurslimit", status: "Status", entitlementsLabel: "Entitlements", save: "Speichern", updated: "Instanz aktualisiert." },
  transfer: { title: "Kurskopie", source: "Quelle", target: "Ziel", publishedCourses: "Publizierte Kurse", noPublishedCourses: "Keine publizierten Kurse", execute: "Kopie ausfuehren", preflight: "Preflight", preflightComplete: "Preflight abgeschlossen.", preflightFailed: "Preflight fehlgeschlagen.", copyComplete: "Kurskopie abgeschlossen.", courses: "Kurse", media: "Medien", targetUtilization: "Zielauslastung", courseCount: (count) => `${count} Kurse`, mediaVolume: "Medienvolumen", notRun: "Nicht ausgefuehrt", warningsTitle: "Auswirkungen der Kopie", warnings: { target_seat_limit_exceeded: "Die Zielinstanz liegt bereits ueber ihrem Sitzplatzlimit.", external_course_link_neutralized: "Externe Kursverknuepfungen werden als leere Lernmodule kopiert.", tenant_dependency_removed: "Tenantgebundene Agent- und Formularverknuepfungen werden entfernt." }, confirmWarnings: "Ich habe diese Aenderungen geprueft und bestaetige die Kopie.", authorMappingTitle: "Autoren zuordnen", authorMappingDescription: "Jeder Quellautor benoetigt ein aktives Zielkonto mit Autorenrolle.", selectTargetAuthor: "Zielautor auswaehlen", automaticMatch: "Automatisch erkannt", historicalAuthor: "Historischer Snapshot-Autor", noTargetAuthors: "Keine geeigneten aktiven Zielautoren verfuegbar.", confirmAuthorMapping: "Autoren-Zuordnung bestaetigen", journal: "Transferjournal", time: "Zeit", status: "Status" },
  access: { customerSlot: "Kundenslot", code: "Code", copy: "Kopieren", occupiedSlots: (current, limit) => `${current}/${limit} Slots belegt`, claimCreated: "Instanzcode erstellt.", organizationRole: "Organisationsrolle", accountId: "Orbit-Account-ID", role: "Rolle", permissionSet: "Permission-Set", roleDefault: "Rollenstandard", saveRole: "Rolle speichern", roleSaved: "Organisationsrolle gespeichert.", permissionSetCreated: "Permission-Set erstellt.", name: "Name", description: "Beschreibung", permissions: "Berechtigungen", createPermissionSet: "Permission-Set", partnerDelegation: "Partnerdelegation", partner: "Partner", select: "Auswaehlen", instance: "Instanz", expires: "Ablauf", scope: "Scope", saveDelegation: "Delegation speichern", delegationSaved: "Partnerdelegation gespeichert.", revoke: "Widerrufen", revoked: "Widerrufen", delegationRevoked: "Delegation widerrufen." },
  billing: { configuration: "Abrechnungskonfiguration", status: "Status", interval: "Intervall", monthly: "Monatlich", annual: "Jaehrlich", intervalLocked: "Nach Aktivierung unveraenderlich.", currency: "Waehrung", baseFee: "Grundgebuehr", includedSlots: "Enthaltene Instanzslots", additionalFee: "Gebuehr je Zusatzinstanz", settlement: "Abwicklungsmodus", manual: "Manuell", external: "Extern", externalReference: "Externe Kundenreferenz", save: "Abrechnung speichern", updated: "Abrechnung aktualisiert.", readOnly: "Sie haben Lesezugriff auf die Abrechnung.", currentProjection: "Aktuelle Projektion", effectivePricing: "Wirksamer Preis", scheduledPricing: "Geplanter Preis", effectiveFrom: "wirksam ab", instances: "Instanzen", additionalInstances: "Zusatzinstanzen", period: "Periode", finalizePrevious: "Faellige Perioden abstimmen", finalized: "Faellige Abrechnungsperioden abgestimmt.", statements: "Periodenabschluesse", revision: "Preisrevision", subtotal: "Zwischensumme", finalizedAt: "Abgeschlossen am", noStatements: "Noch keine Abrechnungsperiode abgeschlossen." },
  audit: { title: "Audit Trail", time: "Zeit", actor: "Akteur", action: "Aktion", resource: "Ressource", outcome: "Ergebnis", system: "System" },
  onboarding: { back: "Zur Academy", newOrganization: "Neue Organisation", instanceCode: "Instanzcode", organization: "Orbit-Organisation", name: "Name", slug: "Slug", customerSlots: "Kundenslots", createOrganization: "Organisation erstellen", linkInstance: "Instanz verknuepfen", customerReference: "Kundenreferenz", redeemCode: "Code einloesen", organizationCreated: "Orbit-Organisation erstellt.", tenantLinked: "Tenant mit Orbit verknuepft." },
};

const en: OrbitCopy = {
  common: { controlPlane: "Control plane", academy: "Academy", actionFailed: "Orbit action failed.", refresh: "Refresh", instances: (count) => `${count} instance${count === 1 ? "" : "s"}`, slots: "slots", tabs: { instances: "Instances", transfer: "Transfer", access: "Access", billing: "Billing", audit: "Audit" }, status: { active: "Active", past_due: "Past due", suspended: "Suspended", completed: "Completed", succeeded: "Succeeded", failed: "Failed", denied: "Denied", pending: "Pending" }, role: { administrator: "Administrator", operator: "Operator", auditor: "Auditor", partner: "Partner", owner: "Owner" } },
  instances: { title: "Customer instances", entitlements: (count) => `${count} entitlement${count === 1 ? "" : "s"}`, seats: "Seats", courses: "Courses", open: "Open instance", customerReference: "Customer reference", seatLimit: "Seat limit", courseLimit: "Course limit", status: "Status", entitlementsLabel: "Entitlements", save: "Save", updated: "Instance updated." },
  transfer: { title: "Course copy", source: "Source", target: "Target", publishedCourses: "Published courses", noPublishedCourses: "No published courses", execute: "Run copy", preflight: "Preflight", preflightComplete: "Preflight completed.", preflightFailed: "Preflight failed.", copyComplete: "Course copy completed.", courses: "Courses", media: "Media", targetUtilization: "Target utilisation", courseCount: (count) => `${count} course${count === 1 ? "" : "s"}`, mediaVolume: "Media volume", notRun: "Not run", warningsTitle: "Effects of the copy", warnings: { target_seat_limit_exceeded: "The target instance is already above its seat limit.", external_course_link_neutralized: "External course links will be copied as empty learning modules.", tenant_dependency_removed: "Tenant-bound agent and form links will be removed." }, confirmWarnings: "I reviewed these changes and confirm the copy.", authorMappingTitle: "Map authors", authorMappingDescription: "Every source author needs an active target account with an author role.", selectTargetAuthor: "Select target author", automaticMatch: "Automatically matched", historicalAuthor: "Historical snapshot author", noTargetAuthors: "No suitable active target authors are available.", confirmAuthorMapping: "Confirm author mapping", journal: "Transfer journal", time: "Time", status: "Status" },
  access: { customerSlot: "Customer slot", code: "Code", copy: "Copy", occupiedSlots: (current, limit) => `${current}/${limit} slots occupied`, claimCreated: "Instance code created.", organizationRole: "Organisation role", accountId: "Orbit account ID", role: "Role", permissionSet: "Permission set", roleDefault: "Role default", saveRole: "Save role", roleSaved: "Organisation role saved.", permissionSetCreated: "Permission set created.", name: "Name", description: "Description", permissions: "Permissions", createPermissionSet: "Create permission set", partnerDelegation: "Partner delegation", partner: "Partner", select: "Select", instance: "Instance", expires: "Expires", scope: "Scope", saveDelegation: "Save delegation", delegationSaved: "Partner delegation saved.", revoke: "Revoke", revoked: "Revoked", delegationRevoked: "Delegation revoked." },
  billing: { configuration: "Billing configuration", status: "Status", interval: "Interval", monthly: "Monthly", annual: "Annual", intervalLocked: "Immutable after activation.", currency: "Currency", baseFee: "Base fee", includedSlots: "Included instance slots", additionalFee: "Fee per additional instance", settlement: "Settlement mode", manual: "Manual", external: "External", externalReference: "External customer reference", save: "Save billing", updated: "Billing updated.", readOnly: "You have read-only billing access.", currentProjection: "Current projection", effectivePricing: "Effective pricing", scheduledPricing: "Scheduled pricing", effectiveFrom: "effective from", instances: "Instances", additionalInstances: "Additional instances", period: "Period", finalizePrevious: "Reconcile due periods", finalized: "Due billing periods reconciled.", statements: "Finalized periods", revision: "Pricing revision", subtotal: "Subtotal", finalizedAt: "Finalized at", noStatements: "No billing period has been finalized yet." },
  audit: { title: "Audit trail", time: "Time", actor: "Actor", action: "Action", resource: "Resource", outcome: "Outcome", system: "System" },
  onboarding: { back: "Back to academy", newOrganization: "New organisation", instanceCode: "Instance code", organization: "Orbit organisation", name: "Name", slug: "Slug", customerSlots: "Customer slots", createOrganization: "Create organisation", linkInstance: "Link instance", customerReference: "Customer reference", redeemCode: "Redeem code", organizationCreated: "Orbit organisation created.", tenantLinked: "Tenant linked to Orbit." },
};

const it: OrbitCopy = {
  common: { controlPlane: "Piano di controllo", academy: "Academy", actionFailed: "Azione Orbit non riuscita.", refresh: "Aggiorna", instances: (count) => `${count} istanz${count === 1 ? "a" : "e"}`, slots: "slot", tabs: { instances: "Istanze", transfer: "Trasferimento", access: "Accesso", billing: "Fatturazione", audit: "Audit" }, status: { active: "Attiva", past_due: "Scaduta", suspended: "Sospesa", completed: "Completato", succeeded: "Riuscito", failed: "Non riuscito", denied: "Negato", pending: "In attesa" }, role: { administrator: "Amministratore", operator: "Operatore", auditor: "Revisore", partner: "Partner", owner: "Owner" } },
  instances: { title: "Istanze cliente", entitlements: (count) => `${count} abilitazion${count === 1 ? "e" : "i"}`, seats: "Posti", courses: "Corsi", open: "Apri istanza", customerReference: "Riferimento cliente", seatLimit: "Limite posti", courseLimit: "Limite corsi", status: "Stato", entitlementsLabel: "Abilitazioni", save: "Salva", updated: "Istanza aggiornata." },
  transfer: { title: "Copia corsi", source: "Origine", target: "Destinazione", publishedCourses: "Corsi pubblicati", noPublishedCourses: "Nessun corso pubblicato", execute: "Esegui copia", preflight: "Verifica preliminare", preflightComplete: "Verifica preliminare completata.", preflightFailed: "Verifica preliminare non riuscita.", copyComplete: "Copia dei corsi completata.", courses: "Corsi", media: "Media", targetUtilization: "Utilizzo destinazione", courseCount: (count) => `${count} cors${count === 1 ? "o" : "i"}`, mediaVolume: "Volume media", notRun: "Non eseguita", warningsTitle: "Effetti della copia", warnings: { target_seat_limit_exceeded: "L'istanza di destinazione supera già il limite di posti.", external_course_link_neutralized: "I collegamenti a corsi esterni verranno copiati come moduli didattici vuoti.", tenant_dependency_removed: "I collegamenti ad agenti e moduli legati al tenant verranno rimossi." }, confirmWarnings: "Ho verificato queste modifiche e confermo la copia.", authorMappingTitle: "Associa autori", authorMappingDescription: "Ogni autore di origine richiede un account di destinazione attivo con ruolo autore.", selectTargetAuthor: "Seleziona autore di destinazione", automaticMatch: "Associazione automatica", historicalAuthor: "Autore storico dello snapshot", noTargetAuthors: "Nessun autore di destinazione attivo idoneo disponibile.", confirmAuthorMapping: "Conferma associazione autori", journal: "Registro trasferimenti", time: "Data", status: "Stato" },
  access: { customerSlot: "Slot cliente", code: "Codice", copy: "Copia", occupiedSlots: (current, limit) => `${current}/${limit} slot occupati`, claimCreated: "Codice istanza creato.", organizationRole: "Ruolo organizzazione", accountId: "ID account Orbit", role: "Ruolo", permissionSet: "Set di permessi", roleDefault: "Predefinito del ruolo", saveRole: "Salva ruolo", roleSaved: "Ruolo organizzazione salvato.", permissionSetCreated: "Set di permessi creato.", name: "Nome", description: "Descrizione", permissions: "Permessi", createPermissionSet: "Crea set di permessi", partnerDelegation: "Delega partner", partner: "Partner", select: "Seleziona", instance: "Istanza", expires: "Scadenza", scope: "Ambito", saveDelegation: "Salva delega", delegationSaved: "Delega partner salvata.", revoke: "Revoca", revoked: "Revocata", delegationRevoked: "Delega revocata." },
  billing: { configuration: "Configurazione fatturazione", status: "Stato", interval: "Intervallo", monthly: "Mensile", annual: "Annuale", intervalLocked: "Immutabile dopo l'attivazione.", currency: "Valuta", baseFee: "Quota base", includedSlots: "Slot istanza inclusi", additionalFee: "Costo per istanza aggiuntiva", settlement: "Modalita di regolamento", manual: "Manuale", external: "Esterna", externalReference: "Riferimento cliente esterno", save: "Salva fatturazione", updated: "Fatturazione aggiornata.", readOnly: "Hai accesso in sola lettura alla fatturazione.", currentProjection: "Proiezione corrente", effectivePricing: "Prezzo effettivo", scheduledPricing: "Prezzo pianificato", effectiveFrom: "effettivo dal", instances: "Istanze", additionalInstances: "Istanze aggiuntive", period: "Periodo", finalizePrevious: "Riconcilia periodi dovuti", finalized: "Periodi di fatturazione dovuti riconciliati.", statements: "Periodi finalizzati", revision: "Revisione prezzi", subtotal: "Subtotale", finalizedAt: "Finalizzato il", noStatements: "Nessun periodo di fatturazione ancora finalizzato." },
  audit: { title: "Registro di audit", time: "Data", actor: "Attore", action: "Azione", resource: "Risorsa", outcome: "Esito", system: "Sistema" },
  onboarding: { back: "Torna all'academy", newOrganization: "Nuova organizzazione", instanceCode: "Codice istanza", organization: "Organizzazione Orbit", name: "Nome", slug: "Slug", customerSlots: "Slot cliente", createOrganization: "Crea organizzazione", linkInstance: "Collega istanza", customerReference: "Riferimento cliente", redeemCode: "Riscatta codice", organizationCreated: "Organizzazione Orbit creata.", tenantLinked: "Tenant collegato a Orbit." },
};

const es: OrbitCopy = {
  common: { controlPlane: "Plano de control", academy: "Academy", actionFailed: "Error en la acción de Orbit.", refresh: "Actualizar", instances: (count) => `${count} instancia${count === 1 ? "" : "s"}`, slots: "plazas", tabs: { instances: "Instancias", transfer: "Transferencia", access: "Acceso", billing: "Facturación", audit: "Auditoría" }, status: { active: "Activa", past_due: "Vencida", suspended: "Suspendida", completed: "Completado", succeeded: "Correcto", failed: "Fallido", denied: "Denegado", pending: "Pendiente" }, role: { administrator: "Administrador", operator: "Operador", auditor: "Auditor", partner: "Socio", owner: "Propietario" } },
  instances: { title: "Instancias de clientes", entitlements: (count) => `${count} habilitacion${count === 1 ? "" : "es"}`, seats: "Plazas", courses: "Cursos", open: "Abrir instancia", customerReference: "Referencia de cliente", seatLimit: "Límite de plazas", courseLimit: "Límite de cursos", status: "Estado", entitlementsLabel: "Habilitaciones", save: "Guardar", updated: "Instancia actualizada." },
  transfer: { title: "Copia de cursos", source: "Origen", target: "Destino", publishedCourses: "Cursos publicados", noPublishedCourses: "No hay cursos publicados", execute: "Ejecutar copia", preflight: "Comprobación previa", preflightComplete: "Comprobación previa completada.", preflightFailed: "Error en la comprobación previa.", copyComplete: "Copia de cursos completada.", courses: "Cursos", media: "Medios", targetUtilization: "Uso del destino", courseCount: (count) => `${count} curso${count === 1 ? "" : "s"}`, mediaVolume: "Volumen de medios", notRun: "No ejecutada", warningsTitle: "Efectos de la copia", warnings: { target_seat_limit_exceeded: "La instancia de destino ya supera su límite de plazas.", external_course_link_neutralized: "Los enlaces a cursos externos se copiarán como módulos de aprendizaje vacíos.", tenant_dependency_removed: "Se eliminarán los enlaces a agentes y formularios vinculados al tenant." }, confirmWarnings: "He revisado estos cambios y confirmo la copia.", authorMappingTitle: "Asignar autores", authorMappingDescription: "Cada autor de origen necesita una cuenta de destino activa con rol de autor.", selectTargetAuthor: "Seleccionar autor de destino", automaticMatch: "Asignación automática", historicalAuthor: "Autor histórico de la instantánea", noTargetAuthors: "No hay autores de destino activos adecuados.", confirmAuthorMapping: "Confirmar asignación de autores", journal: "Registro de transferencias", time: "Fecha", status: "Estado" },
  access: { customerSlot: "Plaza de cliente", code: "Código", copy: "Copiar", occupiedSlots: (current, limit) => `${current}/${limit} plazas ocupadas`, claimCreated: "Código de instancia creado.", organizationRole: "Rol de organización", accountId: "ID de cuenta Orbit", role: "Rol", permissionSet: "Conjunto de permisos", roleDefault: "Predeterminado del rol", saveRole: "Guardar rol", roleSaved: "Rol de organización guardado.", permissionSetCreated: "Conjunto de permisos creado.", name: "Nombre", description: "Descripción", permissions: "Permisos", createPermissionSet: "Crear conjunto de permisos", partnerDelegation: "Delegación de socio", partner: "Socio", select: "Seleccionar", instance: "Instancia", expires: "Caduca", scope: "Ámbito", saveDelegation: "Guardar delegación", delegationSaved: "Delegación de socio guardada.", revoke: "Revocar", revoked: "Revocada", delegationRevoked: "Delegación revocada." },
  billing: { configuration: "Configuración de facturación", status: "Estado", interval: "Intervalo", monthly: "Mensual", annual: "Anual", intervalLocked: "Inmutable tras la activación.", currency: "Moneda", baseFee: "Cuota base", includedSlots: "Plazas de instancia incluidas", additionalFee: "Cuota por instancia adicional", settlement: "Modo de liquidación", manual: "Manual", external: "Externo", externalReference: "Referencia externa de cliente", save: "Guardar facturación", updated: "Facturación actualizada.", readOnly: "Tiene acceso de solo lectura a la facturación.", currentProjection: "Proyección actual", effectivePricing: "Precio vigente", scheduledPricing: "Precio programado", effectiveFrom: "vigente desde", instances: "Instancias", additionalInstances: "Instancias adicionales", period: "Periodo", finalizePrevious: "Conciliar periodos vencidos", finalized: "Periodos de facturación vencidos conciliados.", statements: "Periodos cerrados", revision: "Revisión de precios", subtotal: "Subtotal", finalizedAt: "Cerrado el", noStatements: "Aún no se ha cerrado ningún periodo de facturación." },
  audit: { title: "Registro de auditoría", time: "Fecha", actor: "Actor", action: "Acción", resource: "Recurso", outcome: "Resultado", system: "Sistema" },
  onboarding: { back: "Volver a la academy", newOrganization: "Nueva organización", instanceCode: "Código de instancia", organization: "Organización Orbit", name: "Nombre", slug: "Slug", customerSlots: "Plazas de cliente", createOrganization: "Crear organización", linkInstance: "Vincular instancia", customerReference: "Referencia de cliente", redeemCode: "Canjear código", organizationCreated: "Organización Orbit creada.", tenantLinked: "Tenant vinculado a Orbit." },
};

const fr: OrbitCopy = {
  common: { controlPlane: "Plan de contrôle", academy: "Academy", actionFailed: "Échec de l'action Orbit.", refresh: "Actualiser", instances: (count) => `${count} instance${count === 1 ? "" : "s"}`, slots: "emplacements", tabs: { instances: "Instances", transfer: "Transfert", access: "Accès", billing: "Facturation", audit: "Audit" }, status: { active: "Active", past_due: "Échue", suspended: "Suspendue", completed: "Terminé", succeeded: "Réussi", failed: "Échoué", denied: "Refusé", pending: "En attente" }, role: { administrator: "Administrateur", operator: "Opérateur", auditor: "Auditeur", partner: "Partenaire", owner: "Propriétaire" } },
  instances: { title: "Instances clientes", entitlements: (count) => `${count} droit${count === 1 ? "" : "s"}`, seats: "Places", courses: "Cours", open: "Ouvrir l'instance", customerReference: "Référence client", seatLimit: "Limite de places", courseLimit: "Limite de cours", status: "Statut", entitlementsLabel: "Droits", save: "Enregistrer", updated: "Instance actualisée." },
  transfer: { title: "Copie de cours", source: "Source", target: "Cible", publishedCourses: "Cours publiés", noPublishedCourses: "Aucun cours publié", execute: "Exécuter la copie", preflight: "Vérification préalable", preflightComplete: "Vérification préalable terminée.", preflightFailed: "Échec de la vérification préalable.", copyComplete: "Copie des cours terminée.", courses: "Cours", media: "Médias", targetUtilization: "Utilisation de la cible", courseCount: (count) => `${count} cours`, mediaVolume: "Volume média", notRun: "Non exécutée", warningsTitle: "Effets de la copie", warnings: { target_seat_limit_exceeded: "L'instance cible dépasse déjà sa limite de places.", external_course_link_neutralized: "Les liens vers des cours externes seront copiés comme modules d'apprentissage vides.", tenant_dependency_removed: "Les liens vers des agents et formulaires propres au tenant seront supprimés." }, confirmWarnings: "J'ai vérifié ces modifications et je confirme la copie.", authorMappingTitle: "Associer les auteurs", authorMappingDescription: "Chaque auteur source nécessite un compte cible actif avec un rôle d'auteur.", selectTargetAuthor: "Sélectionner l'auteur cible", automaticMatch: "Association automatique", historicalAuthor: "Auteur historique de l'instantané", noTargetAuthors: "Aucun auteur cible actif approprié n'est disponible.", confirmAuthorMapping: "Confirmer l'association des auteurs", journal: "Journal des transferts", time: "Date", status: "Statut" },
  access: { customerSlot: "Emplacement client", code: "Code", copy: "Copier", occupiedSlots: (current, limit) => `${current}/${limit} emplacements occupés`, claimCreated: "Code d'instance créé.", organizationRole: "Rôle d'organisation", accountId: "ID de compte Orbit", role: "Rôle", permissionSet: "Jeu d'autorisations", roleDefault: "Valeur du rôle", saveRole: "Enregistrer le rôle", roleSaved: "Rôle d'organisation enregistré.", permissionSetCreated: "Jeu d'autorisations créé.", name: "Nom", description: "Description", permissions: "Autorisations", createPermissionSet: "Créer un jeu d'autorisations", partnerDelegation: "Délégation partenaire", partner: "Partenaire", select: "Sélectionner", instance: "Instance", expires: "Expiration", scope: "Périmètre", saveDelegation: "Enregistrer la délégation", delegationSaved: "Délégation partenaire enregistrée.", revoke: "Révoquer", revoked: "Révoquée", delegationRevoked: "Délégation révoquée." },
  billing: { configuration: "Configuration de facturation", status: "Statut", interval: "Intervalle", monthly: "Mensuel", annual: "Annuel", intervalLocked: "Immuable après activation.", currency: "Devise", baseFee: "Forfait de base", includedSlots: "Instances incluses", additionalFee: "Tarif par instance supplémentaire", settlement: "Mode de règlement", manual: "Manuel", external: "Externe", externalReference: "Référence client externe", save: "Enregistrer la facturation", updated: "Facturation actualisée.", readOnly: "Vous disposez d'un accès en lecture seule à la facturation.", currentProjection: "Projection actuelle", effectivePricing: "Tarification en vigueur", scheduledPricing: "Tarification planifiée", effectiveFrom: "en vigueur à partir du", instances: "Instances", additionalInstances: "Instances supplémentaires", period: "Période", finalizePrevious: "Rapprocher les périodes dues", finalized: "Périodes de facturation dues rapprochées.", statements: "Périodes clôturées", revision: "Révision tarifaire", subtotal: "Sous-total", finalizedAt: "Clôturée le", noStatements: "Aucune période de facturation n'a encore été clôturée." },
  audit: { title: "Journal d'audit", time: "Date", actor: "Acteur", action: "Action", resource: "Ressource", outcome: "Résultat", system: "Système" },
  onboarding: { back: "Retour à l'academy", newOrganization: "Nouvelle organisation", instanceCode: "Code d'instance", organization: "Organisation Orbit", name: "Nom", slug: "Slug", customerSlots: "Emplacements clients", createOrganization: "Créer l'organisation", linkInstance: "Lier l'instance", customerReference: "Référence client", redeemCode: "Utiliser le code", organizationCreated: "Organisation Orbit créée.", tenantLinked: "Tenant lié à Orbit." },
};

const dictionaries: Record<AppLocale, OrbitCopy> = { de, en, it, es, fr };

export function getOrbitCopy(locale: AppLocale): OrbitCopy {
  return dictionaries[locale] ?? de;
}
