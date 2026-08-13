import type { AppLocale } from "@/lib/i18n/model";

export type TranscriptWizardActionCode =
  | "transcript_wizard.invalid_input"
  | "transcript_wizard.block_unavailable"
  | "transcript_wizard.transcript_missing"
  | "transcript_wizard.no_content"
  | "transcript_wizard.permission_denied"
  | "transcript_wizard.conflict"
  | "transcript_wizard.failed"
  | "transcript_wizard.created";

export type CourseLifecycleActionCode =
  | "course_lifecycle.invalid_input"
  | "course_lifecycle.not_found"
  | "course_lifecycle.permission_denied"
  | "course_lifecycle.link_conflict"
  | "course_lifecycle.invalid_state"
  | "course_lifecycle.failed"
  | "course_lifecycle.archived"
  | "course_lifecycle.restored";

export type CourseParityCopy = {
  structured: {
    type: string;
    title: string;
    content: string;
    quote: string;
    attribution: string;
    sourceOptional: string;
    line: string;
    spacing: string;
    layout: string;
    tones: Record<"info" | "success" | "warning" | "danger", string>;
    lineStyles: Record<"solid" | "dashed" | "dotted", string>;
    spacings: Record<"compact" | "normal" | "wide", string>;
    layouts: Record<"equal" | "sidebar_left" | "sidebar_right", string>;
    itemTitle: (number: number) => string;
    initiallyOpen: string;
    removeItem: (number: number) => string;
    item: string;
    newItemTitle: (number: number) => string;
    defaultBody: string;
    tab: (number: number) => string;
    initiallyActive: string;
    removeTab: (number: number) => string;
    newTabLabel: (number: number) => string;
    column: (number: number) => string;
    removeColumn: (number: number) => string;
    newColumnHeading: (number: number) => string;
    codeLanguage: string;
    code: string;
    lineNumbers: string;
    wrapLines: string;
    codeLanguages: Record<"plaintext" | "bash" | "css" | "html" | "javascript" | "json" | "python" | "sql" | "typescript", string>;
    tableCaption: string;
    stripedRows: string;
    addRow: string;
    removeRow: (number: number) => string;
    addColumn: string;
    removeColumnLabel: (number: number) => string;
    defaultCode: string;
    defaultTableCaption: string;
    newTableHeader: (number: number) => string;
    defaultTableCell: string;
  };
  transcript: {
    wizard: string;
    operations: Record<"mixed" | "summary" | "fill_blank" | "ordering", string>;
    generating: string;
    generate: string;
    genericFailure: string;
    action: Record<TranscriptWizardActionCode, string | ((count: number) => string)>;
    generated: {
      summaryPrefix: string;
      summaryFallback: string;
      fillTitle: string;
      fillPrompt: (prompt: string) => string;
      fillFeedback: (text: string) => string;
      orderingTitle: string;
      orderingPrompt: string;
      orderingFeedback: string;
    };
  };
  video: {
    timeline: string;
    trimStart: string;
    trimEnd: string;
    thumbnail: string;
    previewClip: string;
    showThumbnail: string;
    timelineSummary: (start: string, end: string, thumbnail: string, captions: number) => string;
    playback: string;
    startSeconds: string;
    endSecondsOptional: string;
    seeking: string;
    seekingOptions: Record<"allowed" | "watched_only" | "disabled", string>;
    minimumPlayback: string;
    requiredPlayback: string;
    variantsTitle: string;
    processing: string;
    createVariants: string;
    language: string;
    transcribing: string;
    transcribe: string;
    importVtt: string;
    exportVtt: string;
    timestamps: (count: number) => string;
    invalidVtt: string;
    noTranscript: string;
    transcriptLabel: string;
    transcriptPlaceholder: string;
    errors: {
      assetRequired: string;
      queueTranscript: string;
      transcriptStatus: string;
      providerUnavailable: string;
      transcriptFailed: string;
      transcriptContinues: string;
      transcriptGeneric: string;
      variantsQueue: string;
      variantsGeneric: string;
      transcriptFileTooLarge: string;
      transcriptFileEncoding: string;
      transcriptFileInvalid: string;
    };
    success: {
      transcriptLoaded: string;
      variantsQueued: string;
      transcriptImported: string;
    };
    endCard: {
      title: string;
      enabled: string;
      heading: string;
      text: string;
      ctaLabel: string;
      ctaUrl: string;
      ctaHint: string;
      replay: string;
      unsafeUrl: string;
    };
  };
  presence: {
    activeEditors: string;
    single: (name: string) => string;
    multiple: (count: number) => string;
  };
  cover: {
    label: string;
    currentPreview: string;
    presets: string;
    presetNames: Record<"foundations" | "workflows" | "prompts" | "responsibleAi", string>;
    customImage: string;
    invalid: string;
    invalidAsset: string;
  };
  modulePicker: {
    search: string;
    folder: string;
    kind: string;
    allFolders: string;
    allKinds: string;
    kinds: Record<"learning" | "exam" | "link", string>;
    resultCount: (visible: number, total: number) => string;
    empty: string;
    select: (title: string) => string;
  };
  lifecycle: {
    archive: string;
    restore: string;
    archiveTitle: string;
    archiveDescription: string;
    archiveConfirm: string;
    restoreTitle: string;
    restoreDescription: string;
    restoreConfirm: string;
    close: string;
    pending: string;
    action: Record<CourseLifecycleActionCode, string>;
  };
};

const de: CourseParityCopy = {
  structured: { type: "Typ", title: "Titel", content: "Inhalt", quote: "Zitat", attribution: "Urheber / Quelle", sourceOptional: "Quellenlink (optional)", line: "Linie", spacing: "Abstand", layout: "Layout", tones: { info: "Information", success: "Erfolg", warning: "Warnung", danger: "Kritisch" }, lineStyles: { solid: "Durchgezogen", dashed: "Gestrichelt", dotted: "Gepunktet" }, spacings: { compact: "Kompakt", normal: "Normal", wide: "Weit" }, layouts: { equal: "Gleich breit", sidebar_left: "Schmale linke Spalte", sidebar_right: "Schmale rechte Spalte" }, itemTitle: (number) => `Titel ${number}`, initiallyOpen: "Initial geoeffnet", removeItem: (number) => `Abschnitt ${number} entfernen`, item: "Abschnitt", newItemTitle: (number) => `Abschnitt ${number}`, defaultBody: "Inhalt", tab: (number) => `Tab ${number}`, initiallyActive: "Initial aktiv", removeTab: (number) => `Tab ${number} entfernen`, newTabLabel: (number) => `Tab ${number}`, column: (number) => `Spalte ${number}`, removeColumn: (number) => `Spalte ${number} entfernen`, newColumnHeading: (number) => `Spalte ${number}`, codeLanguage: "Programmiersprache", code: "Code", lineNumbers: "Zeilennummern anzeigen", wrapLines: "Lange Zeilen umbrechen", codeLanguages: { plaintext: "Nur Text", bash: "Bash", css: "CSS", html: "HTML", javascript: "JavaScript", json: "JSON", python: "Python", sql: "SQL", typescript: "TypeScript" }, tableCaption: "Tabellenbeschreibung", stripedRows: "Zeilen abwechselnd hervorheben", addRow: "Zeile hinzufuegen", removeRow: (number) => `Zeile ${number} entfernen`, addColumn: "Spalte hinzufuegen", removeColumnLabel: (number) => `Spalte ${number} entfernen`, defaultCode: "Beispiel", defaultTableCaption: "Uebersicht", newTableHeader: (number) => `Spalte ${number}`, defaultTableCell: "Inhalt" },
  transcript: { wizard: "Transkript-Wizard", operations: { mixed: "Zusammenfassung und Aufgaben", summary: "Zusammenfassung", fill_blank: "Lueckentext", ordering: "Videoablauf sortieren" }, generating: "Wird erstellt", generate: "Inhalte erstellen", genericFailure: "Inhalte konnten nicht erstellt werden.", action: { "transcript_wizard.invalid_input": "Die Wizard-Auswahl ist ungueltig.", "transcript_wizard.block_unavailable": "Der Video-Block ist nicht verfuegbar.", "transcript_wizard.transcript_missing": "Bitte zuerst ein gueltiges Transkript speichern.", "transcript_wizard.no_content": "Aus dem Transkript konnten keine Inhalte erzeugt werden.", "transcript_wizard.permission_denied": "Du darfst diesen Video-Block nicht bearbeiten.", "transcript_wizard.conflict": "Der Video-Block wurde gleichzeitig geaendert. Lade die Seite neu.", "transcript_wizard.failed": "Die Inhalte konnten nicht erstellt werden.", "transcript_wizard.created": (count) => `${count} Inhaltsbloecke aus dem Transkript erstellt.` }, generated: { summaryPrefix: "Zusammenfassung des Videos:", summaryFallback: "Die Kernaussage wird im Video anhand dieses Abschnitts eingefuehrt.", fillTitle: "Lueckentext aus dem Video", fillPrompt: (prompt) => `Ergaenze die fehlende Aussage aus dem Video: ${prompt}`, fillFeedback: (text) => `Im Video lautet die relevante Passage: ${text}`, orderingTitle: "Videoablauf sortieren", orderingPrompt: "Bringe die Aussagen in die Reihenfolge, in der sie im Video behandelt werden.", orderingFeedback: "Die korrekte Reihenfolge folgt den Zeitmarken und dem inhaltlichen Aufbau des Videos." } },
  video: { timeline: "Video-Timeline", trimStart: "Trim Start", trimEnd: "Trim Ende", thumbnail: "Thumbnail", previewClip: "Ausschnitt", showThumbnail: "Thumbnail anzeigen", timelineSummary: (start, end, thumbnail, captions) => `${start} s bis ${end} s | Thumbnail ${thumbnail} s | ${captions} Untertitel`, playback: "Wiedergabe", startSeconds: "Start (Sek.)", endSecondsOptional: "Ende (Sek., optional)", seeking: "Vorspulen", seekingOptions: { allowed: "Erlaubt", watched_only: "Nur bereits gesehen", disabled: "Gesperrt" }, minimumPlayback: "Mindestwiedergabe (%)", requiredPlayback: "Wiedergabe ist fuer den Lektionsabschluss verpflichtend", variantsTitle: "Thumbnail und H.264/AAC-Variante erzeugen", processing: "Verarbeitung laeuft", createVariants: "Video-Varianten erzeugen", language: "Sprache", transcribing: "Transkription laeuft", transcribe: "Automatisch transkribieren", importVtt: "VTT importieren", exportVtt: "VTT exportieren", timestamps: (count) => `${count} Zeitmarken`, invalidVtt: "WebVTT ist ungueltig", noTranscript: "Kein Transkript", transcriptLabel: "WebVTT-Transkript", transcriptPlaceholder: "WEBVTT\n\n00:00:00.000 --> 00:00:05.000\nErster Abschnitt", errors: { assetRequired: "Waehle zuerst ein geprueftes Video-Asset aus.", queueTranscript: "Der Transkriptauftrag konnte nicht angelegt werden.", transcriptStatus: "Der Transkriptstatus ist nicht verfuegbar.", providerUnavailable: "Der lokale Transkript-Provider ist nicht konfiguriert.", transcriptFailed: "Die automatische Transkription ist fehlgeschlagen.", transcriptContinues: "Die Transkription laeuft weiter. Bitte spaeter erneut pruefen.", transcriptGeneric: "Transkription fehlgeschlagen.", variantsQueue: "Medienvarianten konnten nicht eingeplant werden.", variantsGeneric: "Medienverarbeitung fehlgeschlagen.", transcriptFileTooLarge: "Die VTT-Datei darf maximal 600 kB gross sein.", transcriptFileEncoding: "Die VTT-Datei muss gueltiges UTF-8 enthalten.", transcriptFileInvalid: "Die Datei enthaelt kein gueltiges WebVTT-Transkript." }, success: { transcriptLoaded: "Transkript wurde erzeugt und in den Editor geladen.", variantsQueued: "Thumbnail und kompatible Videovariante wurden eingeplant.", transcriptImported: "Das VTT-Transkript wurde importiert." }, endCard: { title: "Video-Endkarte", enabled: "Endkarte am Videoende anzeigen", heading: "Titel", text: "Text", ctaLabel: "CTA-Beschriftung (optional)", ctaUrl: "CTA-Ziel (optional)", ctaHint: "Interner Pfad oder sichere HTTP(S)-URL.", replay: "Video erneut abspielen", unsafeUrl: "Die CTA-URL ist nicht sicher." } },
  presence: { activeEditors: "Aktive Bearbeiter", single: (name) => `${name} bearbeitet`, multiple: (count) => `${count} Personen bearbeiten` },
  cover: { label: "Kursbild", currentPreview: "Aktuelle Kursbild-Vorschau", presets: "Vorlagen", presetNames: { foundations: "Grundlagen", workflows: "Arbeitsablaeufe", prompts: "Prompts", responsibleAi: "Verantwortungsvolle KI" }, customImage: "Eigenes Kursbild", invalid: "Waehle eine gueltige Kursbild-Vorlage oder ein geprueftes Bild aus.", invalidAsset: "Das Kursbild muss ein bereites Bild-Asset dieses Mandanten sein." },
  modulePicker: { search: "Module durchsuchen", folder: "Ordner", kind: "Modultyp", allFolders: "Alle Ordner", allKinds: "Alle Typen", kinds: { learning: "Lernmodul", exam: "Pruefung", link: "Kurslink" }, resultCount: (visible, total) => `${visible} von ${total} Modulen`, empty: "Keine passenden wiederverwendbaren Module.", select: (title) => `${title} auswaehlen` },
  lifecycle: { archive: "Archivieren", restore: "Wiederherstellen", archiveTitle: "Kurs archivieren?", archiveDescription: "Der Kurs verschwindet aus aktiven Ansichten. Versionen, Einschreibungen, Pruefungsversuche und Abgaben bleiben erhalten.", archiveConfirm: "Kurs archivieren", restoreTitle: "Kurs wiederherstellen?", restoreDescription: "Der Kurs wird als Entwurf wiederhergestellt und bleibt bis zur erneuten Veroeffentlichung unsichtbar.", restoreConfirm: "Als Entwurf wiederherstellen", close: "Dialog schliessen", pending: "Wird gespeichert", action: { "course_lifecycle.invalid_input": "Der Kursstatus ist ungueltig.", "course_lifecycle.not_found": "Der Kurs wurde nicht gefunden.", "course_lifecycle.permission_denied": "Du darfst den Kursstatus nicht aendern.", "course_lifecycle.link_conflict": "Der Kurs wird von einem veroeffentlichten Link-Modul verwendet.", "course_lifecycle.invalid_state": "Der Kurs befindet sich nicht im erwarteten Status.", "course_lifecycle.failed": "Der Kursstatus konnte nicht geaendert werden.", "course_lifecycle.archived": "Kurs archiviert. Alle Lern- und Pruefungsdaten bleiben erhalten.", "course_lifecycle.restored": "Kurs als Entwurf wiederhergestellt." } },
};

const en: CourseParityCopy = {
  structured: { type: "Type", title: "Title", content: "Content", quote: "Quote", attribution: "Author / source", sourceOptional: "Source link (optional)", line: "Line", spacing: "Spacing", layout: "Layout", tones: { info: "Information", success: "Success", warning: "Warning", danger: "Critical" }, lineStyles: { solid: "Solid", dashed: "Dashed", dotted: "Dotted" }, spacings: { compact: "Compact", normal: "Normal", wide: "Wide" }, layouts: { equal: "Equal width", sidebar_left: "Narrow left column", sidebar_right: "Narrow right column" }, itemTitle: (number) => `Title ${number}`, initiallyOpen: "Open initially", removeItem: (number) => `Remove section ${number}`, item: "Section", newItemTitle: (number) => `Section ${number}`, defaultBody: "Content", tab: (number) => `Tab ${number}`, initiallyActive: "Active initially", removeTab: (number) => `Remove tab ${number}`, newTabLabel: (number) => `Tab ${number}`, column: (number) => `Column ${number}`, removeColumn: (number) => `Remove column ${number}`, newColumnHeading: (number) => `Column ${number}`, codeLanguage: "Language", code: "Code", lineNumbers: "Show line numbers", wrapLines: "Wrap long lines", codeLanguages: { plaintext: "Plain text", bash: "Bash", css: "CSS", html: "HTML", javascript: "JavaScript", json: "JSON", python: "Python", sql: "SQL", typescript: "TypeScript" }, tableCaption: "Table caption", stripedRows: "Highlight alternating rows", addRow: "Add row", removeRow: (number) => `Remove row ${number}`, addColumn: "Add column", removeColumnLabel: (number) => `Remove column ${number}`, defaultCode: "Example", defaultTableCaption: "Overview", newTableHeader: (number) => `Column ${number}`, defaultTableCell: "Content" },
  transcript: { wizard: "Transcript wizard", operations: { mixed: "Summary and activities", summary: "Summary", fill_blank: "Fill in the blank", ordering: "Order the video sequence" }, generating: "Creating", generate: "Create content", genericFailure: "The content could not be created.", action: { "transcript_wizard.invalid_input": "The wizard selection is invalid.", "transcript_wizard.block_unavailable": "The video block is unavailable.", "transcript_wizard.transcript_missing": "Save a valid transcript first.", "transcript_wizard.no_content": "No content could be created from this transcript.", "transcript_wizard.permission_denied": "You cannot edit this video block.", "transcript_wizard.conflict": "The video block changed at the same time. Reload the page.", "transcript_wizard.failed": "The content could not be created.", "transcript_wizard.created": (count) => `${count} content blocks created from the transcript.` }, generated: { summaryPrefix: "Video summary:", summaryFallback: "The video introduces its key point using this segment.", fillTitle: "Fill in the blank from the video", fillPrompt: (prompt) => `Complete the missing statement from the video: ${prompt}`, fillFeedback: (text) => `The relevant passage in the video is: ${text}`, orderingTitle: "Order the video sequence", orderingPrompt: "Put the statements in the order in which they are discussed in the video.", orderingFeedback: "The correct order follows the timestamps and structure of the video." } },
  video: { timeline: "Video timeline", trimStart: "Trim start", trimEnd: "Trim end", thumbnail: "Thumbnail", previewClip: "Preview clip", showThumbnail: "Show thumbnail", timelineSummary: (start, end, thumbnail, captions) => `${start}s to ${end}s | Thumbnail ${thumbnail}s | ${captions} captions`, playback: "Playback", startSeconds: "Start (seconds)", endSecondsOptional: "End (seconds, optional)", seeking: "Seeking", seekingOptions: { allowed: "Allowed", watched_only: "Watched content only", disabled: "Disabled" }, minimumPlayback: "Minimum playback (%)", requiredPlayback: "Playback is required to complete the lesson", variantsTitle: "Create thumbnail and H.264/AAC variant", processing: "Processing", createVariants: "Create video variants", language: "Language", transcribing: "Transcribing", transcribe: "Transcribe automatically", importVtt: "Import VTT", exportVtt: "Export VTT", timestamps: (count) => `${count} timestamps`, invalidVtt: "WebVTT is invalid", noTranscript: "No transcript", transcriptLabel: "WebVTT transcript", transcriptPlaceholder: "WEBVTT\n\n00:00:00.000 --> 00:00:05.000\nFirst segment", errors: { assetRequired: "Select a verified video asset first.", queueTranscript: "The transcription job could not be queued.", transcriptStatus: "The transcript status is unavailable.", providerUnavailable: "The local transcription provider is not configured.", transcriptFailed: "Automatic transcription failed.", transcriptContinues: "Transcription is still running. Check again later.", transcriptGeneric: "Transcription failed.", variantsQueue: "The media variants could not be queued.", variantsGeneric: "Media processing failed.", transcriptFileTooLarge: "The VTT file must not exceed 600 kB.", transcriptFileEncoding: "The VTT file must contain valid UTF-8.", transcriptFileInvalid: "The file does not contain a valid WebVTT transcript." }, success: { transcriptLoaded: "The transcript was created and loaded into the editor.", variantsQueued: "The thumbnail and compatible video variant were queued.", transcriptImported: "The VTT transcript was imported." }, endCard: { title: "Video end card", enabled: "Show an end card when the video ends", heading: "Title", text: "Text", ctaLabel: "CTA label (optional)", ctaUrl: "CTA destination (optional)", ctaHint: "Internal path or secure HTTP(S) URL.", replay: "Play video again", unsafeUrl: "The CTA URL is unsafe." } },
  presence: { activeEditors: "Active editors", single: (name) => `${name} is editing`, multiple: (count) => `${count} people are editing` },
  cover: { label: "Course cover", currentPreview: "Current course cover preview", presets: "Presets", presetNames: { foundations: "Foundations", workflows: "Workflows", prompts: "Prompts", responsibleAi: "Responsible AI" }, customImage: "Custom course cover", invalid: "Select a valid cover preset or a verified image.", invalidAsset: "The course cover must be a ready image asset from this tenant." },
  modulePicker: { search: "Search modules", folder: "Folder", kind: "Module type", allFolders: "All folders", allKinds: "All types", kinds: { learning: "Learning module", exam: "Exam", link: "Course link" }, resultCount: (visible, total) => `${visible} of ${total} modules`, empty: "No matching reusable modules.", select: (title) => `Select ${title}` },
  lifecycle: { archive: "Archive", restore: "Restore", archiveTitle: "Archive course?", archiveDescription: "The course disappears from active views. Versions, enrolments, exam attempts and submissions remain intact.", archiveConfirm: "Archive course", restoreTitle: "Restore course?", restoreDescription: "The course is restored as a draft and remains hidden until it is published again.", restoreConfirm: "Restore as draft", close: "Close dialog", pending: "Saving", action: { "course_lifecycle.invalid_input": "The course status is invalid.", "course_lifecycle.not_found": "The course was not found.", "course_lifecycle.permission_denied": "You cannot change the course status.", "course_lifecycle.link_conflict": "A published link module uses this course.", "course_lifecycle.invalid_state": "The course is not in the expected state.", "course_lifecycle.failed": "The course status could not be changed.", "course_lifecycle.archived": "Course archived. All learning and exam data remains intact.", "course_lifecycle.restored": "Course restored as a draft." } },
};

const it: CourseParityCopy = {
  structured: { type: "Tipo", title: "Titolo", content: "Contenuto", quote: "Citazione", attribution: "Autore / fonte", sourceOptional: "Link alla fonte (facoltativo)", line: "Linea", spacing: "Spaziatura", layout: "Layout", tones: { info: "Informazione", success: "Successo", warning: "Avviso", danger: "Critico" }, lineStyles: { solid: "Continua", dashed: "Tratteggiata", dotted: "Punteggiata" }, spacings: { compact: "Compatta", normal: "Normale", wide: "Ampia" }, layouts: { equal: "Larghezza uguale", sidebar_left: "Colonna sinistra stretta", sidebar_right: "Colonna destra stretta" }, itemTitle: (number) => `Titolo ${number}`, initiallyOpen: "Aperto inizialmente", removeItem: (number) => `Rimuovi sezione ${number}`, item: "Sezione", newItemTitle: (number) => `Sezione ${number}`, defaultBody: "Contenuto", tab: (number) => `Scheda ${number}`, initiallyActive: "Attiva inizialmente", removeTab: (number) => `Rimuovi scheda ${number}`, newTabLabel: (number) => `Scheda ${number}`, column: (number) => `Colonna ${number}`, removeColumn: (number) => `Rimuovi colonna ${number}`, newColumnHeading: (number) => `Colonna ${number}`, codeLanguage: "Linguaggio", code: "Codice", lineNumbers: "Mostra numeri di riga", wrapLines: "A capo automatico", codeLanguages: { plaintext: "Testo semplice", bash: "Bash", css: "CSS", html: "HTML", javascript: "JavaScript", json: "JSON", python: "Python", sql: "SQL", typescript: "TypeScript" }, tableCaption: "Didascalia tabella", stripedRows: "Evidenzia righe alternate", addRow: "Aggiungi riga", removeRow: (number) => `Rimuovi riga ${number}`, addColumn: "Aggiungi colonna", removeColumnLabel: (number) => `Rimuovi colonna ${number}`, defaultCode: "Esempio", defaultTableCaption: "Panoramica", newTableHeader: (number) => `Colonna ${number}`, defaultTableCell: "Contenuto" },
  transcript: { wizard: "Procedura guidata trascrizione", operations: { mixed: "Riepilogo e attivita", summary: "Riepilogo", fill_blank: "Testo con lacune", ordering: "Ordina la sequenza video" }, generating: "Creazione", generate: "Crea contenuti", genericFailure: "Non e stato possibile creare i contenuti.", action: { "transcript_wizard.invalid_input": "La selezione della procedura guidata non e valida.", "transcript_wizard.block_unavailable": "Il blocco video non e disponibile.", "transcript_wizard.transcript_missing": "Salva prima una trascrizione valida.", "transcript_wizard.no_content": "Non e stato possibile creare contenuti dalla trascrizione.", "transcript_wizard.permission_denied": "Non puoi modificare questo blocco video.", "transcript_wizard.conflict": "Il blocco video e stato modificato contemporaneamente. Ricarica la pagina.", "transcript_wizard.failed": "Non e stato possibile creare i contenuti.", "transcript_wizard.created": (count) => `${count} blocchi di contenuto creati dalla trascrizione.` }, generated: { summaryPrefix: "Riepilogo del video:", summaryFallback: "Il video introduce il punto principale tramite questo segmento.", fillTitle: "Testo con lacune dal video", fillPrompt: (prompt) => `Completa l'affermazione mancante del video: ${prompt}`, fillFeedback: (text) => `Il passaggio rilevante nel video e: ${text}`, orderingTitle: "Ordina la sequenza video", orderingPrompt: "Metti le affermazioni nell'ordine in cui vengono trattate nel video.", orderingFeedback: "L'ordine corretto segue le indicazioni temporali e la struttura del video." } },
  video: { timeline: "Timeline video", trimStart: "Inizio ritaglio", trimEnd: "Fine ritaglio", thumbnail: "Miniatura", previewClip: "Anteprima segmento", showThumbnail: "Mostra miniatura", timelineSummary: (start, end, thumbnail, captions) => `${start}s - ${end}s | Miniatura ${thumbnail}s | ${captions} sottotitoli`, playback: "Riproduzione", startSeconds: "Inizio (secondi)", endSecondsOptional: "Fine (secondi, facoltativa)", seeking: "Avanzamento", seekingOptions: { allowed: "Consentito", watched_only: "Solo contenuti gia visti", disabled: "Disattivato" }, minimumPlayback: "Riproduzione minima (%)", requiredPlayback: "La riproduzione e obbligatoria per completare la lezione", variantsTitle: "Crea miniatura e variante H.264/AAC", processing: "Elaborazione", createVariants: "Crea varianti video", language: "Lingua", transcribing: "Trascrizione", transcribe: "Trascrivi automaticamente", importVtt: "Importa VTT", exportVtt: "Esporta VTT", timestamps: (count) => `${count} indicazioni temporali`, invalidVtt: "WebVTT non valido", noTranscript: "Nessuna trascrizione", transcriptLabel: "Trascrizione WebVTT", transcriptPlaceholder: "WEBVTT\n\n00:00:00.000 --> 00:00:05.000\nPrimo segmento", errors: { assetRequired: "Seleziona prima una risorsa video verificata.", queueTranscript: "Non e stato possibile accodare la trascrizione.", transcriptStatus: "Lo stato della trascrizione non e disponibile.", providerUnavailable: "Il provider di trascrizione locale non e configurato.", transcriptFailed: "La trascrizione automatica non e riuscita.", transcriptContinues: "La trascrizione e ancora in corso. Controlla piu tardi.", transcriptGeneric: "Trascrizione non riuscita.", variantsQueue: "Non e stato possibile accodare le varianti multimediali.", variantsGeneric: "Elaborazione multimediale non riuscita.", transcriptFileTooLarge: "Il file VTT non puo superare 600 kB.", transcriptFileEncoding: "Il file VTT deve contenere UTF-8 valido.", transcriptFileInvalid: "Il file non contiene una trascrizione WebVTT valida." }, success: { transcriptLoaded: "La trascrizione e stata creata e caricata nell'editor.", variantsQueued: "La miniatura e la variante video compatibile sono state accodate.", transcriptImported: "La trascrizione VTT e stata importata." }, endCard: { title: "Scheda finale video", enabled: "Mostra una scheda al termine del video", heading: "Titolo", text: "Testo", ctaLabel: "Etichetta CTA (facoltativa)", ctaUrl: "Destinazione CTA (facoltativa)", ctaHint: "Percorso interno o URL HTTP(S) sicuro.", replay: "Riproduci di nuovo", unsafeUrl: "L'URL della CTA non e sicuro." } },
  presence: { activeEditors: "Editor attivi", single: (name) => `${name} sta modificando`, multiple: (count) => `${count} persone stanno modificando` },
  cover: { label: "Copertina del corso", currentPreview: "Anteprima attuale della copertina", presets: "Preimpostazioni", presetNames: { foundations: "Fondamenti", workflows: "Flussi di lavoro", prompts: "Prompt", responsibleAi: "IA responsabile" }, customImage: "Copertina personalizzata", invalid: "Seleziona una copertina preimpostata valida o un'immagine verificata.", invalidAsset: "La copertina deve essere una risorsa immagine pronta di questo tenant." },
  modulePicker: { search: "Cerca moduli", folder: "Cartella", kind: "Tipo di modulo", allFolders: "Tutte le cartelle", allKinds: "Tutti i tipi", kinds: { learning: "Modulo didattico", exam: "Esame", link: "Link al corso" }, resultCount: (visible, total) => `${visible} di ${total} moduli`, empty: "Nessun modulo riutilizzabile corrispondente.", select: (title) => `Seleziona ${title}` },
  lifecycle: { archive: "Archivia", restore: "Ripristina", archiveTitle: "Archiviare il corso?", archiveDescription: "Il corso scompare dalle viste attive. Versioni, iscrizioni, tentativi d'esame e consegne restano invariati.", archiveConfirm: "Archivia corso", restoreTitle: "Ripristinare il corso?", restoreDescription: "Il corso viene ripristinato come bozza e resta nascosto fino alla nuova pubblicazione.", restoreConfirm: "Ripristina come bozza", close: "Chiudi finestra", pending: "Salvataggio", action: { "course_lifecycle.invalid_input": "Lo stato del corso non e valido.", "course_lifecycle.not_found": "Il corso non e stato trovato.", "course_lifecycle.permission_denied": "Non puoi modificare lo stato del corso.", "course_lifecycle.link_conflict": "Un modulo link pubblicato utilizza questo corso.", "course_lifecycle.invalid_state": "Il corso non si trova nello stato previsto.", "course_lifecycle.failed": "Non e stato possibile modificare lo stato del corso.", "course_lifecycle.archived": "Corso archiviato. Tutti i dati didattici e d'esame restano invariati.", "course_lifecycle.restored": "Corso ripristinato come bozza." } },
};

const es: CourseParityCopy = {
  structured: { type: "Tipo", title: "Titulo", content: "Contenido", quote: "Cita", attribution: "Autor / fuente", sourceOptional: "Enlace de fuente (opcional)", line: "Linea", spacing: "Espaciado", layout: "Diseno", tones: { info: "Informacion", success: "Exito", warning: "Advertencia", danger: "Critico" }, lineStyles: { solid: "Continua", dashed: "Discontinua", dotted: "Punteada" }, spacings: { compact: "Compacto", normal: "Normal", wide: "Amplio" }, layouts: { equal: "Mismo ancho", sidebar_left: "Columna izquierda estrecha", sidebar_right: "Columna derecha estrecha" }, itemTitle: (number) => `Titulo ${number}`, initiallyOpen: "Abierto inicialmente", removeItem: (number) => `Eliminar seccion ${number}`, item: "Seccion", newItemTitle: (number) => `Seccion ${number}`, defaultBody: "Contenido", tab: (number) => `Pestana ${number}`, initiallyActive: "Activa inicialmente", removeTab: (number) => `Eliminar pestana ${number}`, newTabLabel: (number) => `Pestana ${number}`, column: (number) => `Columna ${number}`, removeColumn: (number) => `Eliminar columna ${number}`, newColumnHeading: (number) => `Columna ${number}`, codeLanguage: "Lenguaje", code: "Codigo", lineNumbers: "Mostrar numeros de linea", wrapLines: "Ajustar lineas largas", codeLanguages: { plaintext: "Texto sin formato", bash: "Bash", css: "CSS", html: "HTML", javascript: "JavaScript", json: "JSON", python: "Python", sql: "SQL", typescript: "TypeScript" }, tableCaption: "Titulo de tabla", stripedRows: "Resaltar filas alternas", addRow: "Anadir fila", removeRow: (number) => `Eliminar fila ${number}`, addColumn: "Anadir columna", removeColumnLabel: (number) => `Eliminar columna ${number}`, defaultCode: "Ejemplo", defaultTableCaption: "Resumen", newTableHeader: (number) => `Columna ${number}`, defaultTableCell: "Contenido" },
  transcript: { wizard: "Asistente de transcripcion", operations: { mixed: "Resumen y actividades", summary: "Resumen", fill_blank: "Texto con huecos", ordering: "Ordenar la secuencia del video" }, generating: "Creando", generate: "Crear contenido", genericFailure: "No se pudo crear el contenido.", action: { "transcript_wizard.invalid_input": "La seleccion del asistente no es valida.", "transcript_wizard.block_unavailable": "El bloque de video no esta disponible.", "transcript_wizard.transcript_missing": "Guarda primero una transcripcion valida.", "transcript_wizard.no_content": "No se pudo crear contenido a partir de la transcripcion.", "transcript_wizard.permission_denied": "No puedes editar este bloque de video.", "transcript_wizard.conflict": "El bloque de video cambio al mismo tiempo. Recarga la pagina.", "transcript_wizard.failed": "No se pudo crear el contenido.", "transcript_wizard.created": (count) => `${count} bloques de contenido creados desde la transcripcion.` }, generated: { summaryPrefix: "Resumen del video:", summaryFallback: "El video presenta su idea principal mediante este fragmento.", fillTitle: "Texto con huecos del video", fillPrompt: (prompt) => `Completa la afirmacion que falta del video: ${prompt}`, fillFeedback: (text) => `El fragmento relevante del video es: ${text}`, orderingTitle: "Ordenar la secuencia del video", orderingPrompt: "Ordena las afirmaciones segun aparecen en el video.", orderingFeedback: "El orden correcto sigue las marcas de tiempo y la estructura del video." } },
  video: { timeline: "Linea de tiempo del video", trimStart: "Inicio del recorte", trimEnd: "Fin del recorte", thumbnail: "Miniatura", previewClip: "Vista previa", showThumbnail: "Mostrar miniatura", timelineSummary: (start, end, thumbnail, captions) => `${start}s a ${end}s | Miniatura ${thumbnail}s | ${captions} subtitulos`, playback: "Reproduccion", startSeconds: "Inicio (segundos)", endSecondsOptional: "Fin (segundos, opcional)", seeking: "Avance", seekingOptions: { allowed: "Permitido", watched_only: "Solo contenido visto", disabled: "Desactivado" }, minimumPlayback: "Reproduccion minima (%)", requiredPlayback: "La reproduccion es obligatoria para completar la leccion", variantsTitle: "Crear miniatura y variante H.264/AAC", processing: "Procesando", createVariants: "Crear variantes de video", language: "Idioma", transcribing: "Transcribiendo", transcribe: "Transcribir automaticamente", importVtt: "Importar VTT", exportVtt: "Exportar VTT", timestamps: (count) => `${count} marcas de tiempo`, invalidVtt: "WebVTT no valido", noTranscript: "Sin transcripcion", transcriptLabel: "Transcripcion WebVTT", transcriptPlaceholder: "WEBVTT\n\n00:00:00.000 --> 00:00:05.000\nPrimer fragmento", errors: { assetRequired: "Selecciona primero un recurso de video verificado.", queueTranscript: "No se pudo poner en cola la transcripcion.", transcriptStatus: "El estado de la transcripcion no esta disponible.", providerUnavailable: "El proveedor local de transcripcion no esta configurado.", transcriptFailed: "La transcripcion automatica ha fallado.", transcriptContinues: "La transcripcion sigue en curso. Vuelve a comprobarlo mas tarde.", transcriptGeneric: "La transcripcion ha fallado.", variantsQueue: "No se pudieron poner en cola las variantes multimedia.", variantsGeneric: "El procesamiento multimedia ha fallado.", transcriptFileTooLarge: "El archivo VTT no puede superar los 600 kB.", transcriptFileEncoding: "El archivo VTT debe contener UTF-8 valido.", transcriptFileInvalid: "El archivo no contiene una transcripcion WebVTT valida." }, success: { transcriptLoaded: "La transcripcion se creo y se cargo en el editor.", variantsQueued: "La miniatura y la variante de video compatible se pusieron en cola.", transcriptImported: "La transcripcion VTT se ha importado." }, endCard: { title: "Tarjeta final del video", enabled: "Mostrar una tarjeta al finalizar el video", heading: "Titulo", text: "Texto", ctaLabel: "Etiqueta CTA (opcional)", ctaUrl: "Destino CTA (opcional)", ctaHint: "Ruta interna o URL HTTP(S) segura.", replay: "Reproducir de nuevo", unsafeUrl: "La URL de la CTA no es segura." } },
  presence: { activeEditors: "Editores activos", single: (name) => `${name} esta editando`, multiple: (count) => `${count} personas estan editando` },
  cover: { label: "Portada del curso", currentPreview: "Vista previa actual de la portada", presets: "Preajustes", presetNames: { foundations: "Fundamentos", workflows: "Flujos de trabajo", prompts: "Prompts", responsibleAi: "IA responsable" }, customImage: "Portada personalizada", invalid: "Selecciona un preajuste valido o una imagen verificada.", invalidAsset: "La portada debe ser un recurso de imagen preparado de este tenant." },
  modulePicker: { search: "Buscar modulos", folder: "Carpeta", kind: "Tipo de modulo", allFolders: "Todas las carpetas", allKinds: "Todos los tipos", kinds: { learning: "Modulo de aprendizaje", exam: "Examen", link: "Enlace de curso" }, resultCount: (visible, total) => `${visible} de ${total} modulos`, empty: "No hay modulos reutilizables coincidentes.", select: (title) => `Seleccionar ${title}` },
  lifecycle: { archive: "Archivar", restore: "Restaurar", archiveTitle: "Archivar curso?", archiveDescription: "El curso desaparece de las vistas activas. Las versiones, inscripciones, intentos de examen y entregas se conservan.", archiveConfirm: "Archivar curso", restoreTitle: "Restaurar curso?", restoreDescription: "El curso se restaura como borrador y permanece oculto hasta que se publique de nuevo.", restoreConfirm: "Restaurar como borrador", close: "Cerrar ventana", pending: "Guardando", action: { "course_lifecycle.invalid_input": "El estado del curso no es valido.", "course_lifecycle.not_found": "No se encontro el curso.", "course_lifecycle.permission_denied": "No puedes cambiar el estado del curso.", "course_lifecycle.link_conflict": "Un modulo de enlace publicado utiliza este curso.", "course_lifecycle.invalid_state": "El curso no esta en el estado esperado.", "course_lifecycle.failed": "No se pudo cambiar el estado del curso.", "course_lifecycle.archived": "Curso archivado. Todos los datos de aprendizaje y examen se conservan.", "course_lifecycle.restored": "Curso restaurado como borrador." } },
};

const fr: CourseParityCopy = {
  structured: { type: "Type", title: "Titre", content: "Contenu", quote: "Citation", attribution: "Auteur / source", sourceOptional: "Lien source (facultatif)", line: "Ligne", spacing: "Espacement", layout: "Disposition", tones: { info: "Information", success: "Succes", warning: "Avertissement", danger: "Critique" }, lineStyles: { solid: "Continue", dashed: "Tirets", dotted: "Pointilles" }, spacings: { compact: "Compact", normal: "Normal", wide: "Large" }, layouts: { equal: "Largeur egale", sidebar_left: "Colonne gauche etroite", sidebar_right: "Colonne droite etroite" }, itemTitle: (number) => `Titre ${number}`, initiallyOpen: "Ouvert initialement", removeItem: (number) => `Supprimer la section ${number}`, item: "Section", newItemTitle: (number) => `Section ${number}`, defaultBody: "Contenu", tab: (number) => `Onglet ${number}`, initiallyActive: "Actif initialement", removeTab: (number) => `Supprimer l'onglet ${number}`, newTabLabel: (number) => `Onglet ${number}`, column: (number) => `Colonne ${number}`, removeColumn: (number) => `Supprimer la colonne ${number}`, newColumnHeading: (number) => `Colonne ${number}`, codeLanguage: "Langage", code: "Code", lineNumbers: "Afficher les numeros de ligne", wrapLines: "Renvoyer les lignes longues", codeLanguages: { plaintext: "Texte brut", bash: "Bash", css: "CSS", html: "HTML", javascript: "JavaScript", json: "JSON", python: "Python", sql: "SQL", typescript: "TypeScript" }, tableCaption: "Legende du tableau", stripedRows: "Mettre en evidence les lignes alternees", addRow: "Ajouter une ligne", removeRow: (number) => `Supprimer la ligne ${number}`, addColumn: "Ajouter une colonne", removeColumnLabel: (number) => `Supprimer la colonne ${number}`, defaultCode: "Exemple", defaultTableCaption: "Apercu", newTableHeader: (number) => `Colonne ${number}`, defaultTableCell: "Contenu" },
  transcript: { wizard: "Assistant de transcription", operations: { mixed: "Resume et activites", summary: "Resume", fill_blank: "Texte a trous", ordering: "Classer la sequence video" }, generating: "Creation", generate: "Creer le contenu", genericFailure: "Le contenu n'a pas pu etre cree.", action: { "transcript_wizard.invalid_input": "La selection de l'assistant n'est pas valide.", "transcript_wizard.block_unavailable": "Le bloc video n'est pas disponible.", "transcript_wizard.transcript_missing": "Enregistrez d'abord une transcription valide.", "transcript_wizard.no_content": "Aucun contenu n'a pu etre cree a partir de cette transcription.", "transcript_wizard.permission_denied": "Vous ne pouvez pas modifier ce bloc video.", "transcript_wizard.conflict": "Le bloc video a ete modifie simultanement. Rechargez la page.", "transcript_wizard.failed": "Le contenu n'a pas pu etre cree.", "transcript_wizard.created": (count) => `${count} blocs de contenu crees a partir de la transcription.` }, generated: { summaryPrefix: "Resume de la video :", summaryFallback: "La video presente son idee principale a l'aide de ce segment.", fillTitle: "Texte a trous de la video", fillPrompt: (prompt) => `Completez l'affirmation manquante de la video : ${prompt}`, fillFeedback: (text) => `Le passage pertinent de la video est : ${text}`, orderingTitle: "Classer la sequence video", orderingPrompt: "Placez les affirmations dans l'ordre ou elles sont abordees dans la video.", orderingFeedback: "L'ordre correct suit les reperes temporels et la structure de la video." } },
  video: { timeline: "Chronologie video", trimStart: "Debut du decoupage", trimEnd: "Fin du decoupage", thumbnail: "Miniature", previewClip: "Apercu de l'extrait", showThumbnail: "Afficher la miniature", timelineSummary: (start, end, thumbnail, captions) => `${start}s a ${end}s | Miniature ${thumbnail}s | ${captions} sous-titres`, playback: "Lecture", startSeconds: "Debut (secondes)", endSecondsOptional: "Fin (secondes, facultatif)", seeking: "Avance rapide", seekingOptions: { allowed: "Autorisee", watched_only: "Contenu deja vu uniquement", disabled: "Desactivee" }, minimumPlayback: "Lecture minimale (%)", requiredPlayback: "La lecture est obligatoire pour terminer la lecon", variantsTitle: "Creer une miniature et une variante H.264/AAC", processing: "Traitement", createVariants: "Creer les variantes video", language: "Langue", transcribing: "Transcription", transcribe: "Transcrire automatiquement", importVtt: "Importer VTT", exportVtt: "Exporter VTT", timestamps: (count) => `${count} reperes temporels`, invalidVtt: "WebVTT non valide", noTranscript: "Aucune transcription", transcriptLabel: "Transcription WebVTT", transcriptPlaceholder: "WEBVTT\n\n00:00:00.000 --> 00:00:05.000\nPremier segment", errors: { assetRequired: "Selectionnez d'abord une ressource video verifiee.", queueTranscript: "La transcription n'a pas pu etre mise en file.", transcriptStatus: "Le statut de la transcription n'est pas disponible.", providerUnavailable: "Le fournisseur local de transcription n'est pas configure.", transcriptFailed: "La transcription automatique a echoue.", transcriptContinues: "La transcription est toujours en cours. Verifiez plus tard.", transcriptGeneric: "La transcription a echoue.", variantsQueue: "Les variantes multimedia n'ont pas pu etre mises en file.", variantsGeneric: "Le traitement multimedia a echoue.", transcriptFileTooLarge: "Le fichier VTT ne doit pas depasser 600 ko.", transcriptFileEncoding: "Le fichier VTT doit contenir un UTF-8 valide.", transcriptFileInvalid: "Le fichier ne contient pas de transcription WebVTT valide." }, success: { transcriptLoaded: "La transcription a ete creee et chargee dans l'editeur.", variantsQueued: "La miniature et la variante video compatible ont ete mises en file.", transcriptImported: "La transcription VTT a ete importee." }, endCard: { title: "Carte de fin video", enabled: "Afficher une carte a la fin de la video", heading: "Titre", text: "Texte", ctaLabel: "Libelle CTA (facultatif)", ctaUrl: "Destination CTA (facultative)", ctaHint: "Chemin interne ou URL HTTP(S) securisee.", replay: "Relire la video", unsafeUrl: "L'URL du CTA n'est pas sure." } },
  presence: { activeEditors: "Editeurs actifs", single: (name) => `${name} modifie`, multiple: (count) => `${count} personnes modifient` },
  cover: { label: "Couverture du cours", currentPreview: "Apercu actuel de la couverture", presets: "Modeles", presetNames: { foundations: "Fondamentaux", workflows: "Flux de travail", prompts: "Prompts", responsibleAi: "IA responsable" }, customImage: "Couverture personnalisee", invalid: "Selectionnez un modele valide ou une image verifiee.", invalidAsset: "La couverture doit etre une ressource image prete de ce tenant." },
  modulePicker: { search: "Rechercher des modules", folder: "Dossier", kind: "Type de module", allFolders: "Tous les dossiers", allKinds: "Tous les types", kinds: { learning: "Module pedagogique", exam: "Examen", link: "Lien de cours" }, resultCount: (visible, total) => `${visible} sur ${total} modules`, empty: "Aucun module reutilisable correspondant.", select: (title) => `Selectionner ${title}` },
  lifecycle: { archive: "Archiver", restore: "Restaurer", archiveTitle: "Archiver le cours ?", archiveDescription: "Le cours disparait des vues actives. Les versions, inscriptions, tentatives d'examen et remises restent intactes.", archiveConfirm: "Archiver le cours", restoreTitle: "Restaurer le cours ?", restoreDescription: "Le cours est restaure comme brouillon et reste masque jusqu'a sa prochaine publication.", restoreConfirm: "Restaurer comme brouillon", close: "Fermer la fenetre", pending: "Enregistrement", action: { "course_lifecycle.invalid_input": "Le statut du cours n'est pas valide.", "course_lifecycle.not_found": "Le cours est introuvable.", "course_lifecycle.permission_denied": "Vous ne pouvez pas modifier le statut du cours.", "course_lifecycle.link_conflict": "Un module de lien publie utilise ce cours.", "course_lifecycle.invalid_state": "Le cours n'est pas dans l'etat attendu.", "course_lifecycle.failed": "Le statut du cours n'a pas pu etre modifie.", "course_lifecycle.archived": "Cours archive. Toutes les donnees d'apprentissage et d'examen restent intactes.", "course_lifecycle.restored": "Cours restaure comme brouillon." } },
};

const COURSE_PARITY_COPY: Record<AppLocale, CourseParityCopy> = { de, en, it, es, fr };

export function getCourseParityCopy(locale: AppLocale) {
  return COURSE_PARITY_COPY[locale];
}
