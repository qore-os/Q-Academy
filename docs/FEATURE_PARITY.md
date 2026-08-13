# Q-Academy Feature-Paritaet

Stand: 2026-07-14

## Zweck und Abgrenzung

Q-Academy ist eine eigenstaendige Lernplattform nach dem Produktprinzip einer
modernen All-in-one Learning Suite. Ziel ist funktionale Produktparitaet mit
einem mindestens gleichwertigen Nutzungserlebnis, nicht die Uebernahme von
Marke, Texten, Gestaltung, Quellcode oder proprietaeren Inhalten eines anderen
Anbieters.

Diese Matrix vergleicht den im Repository nachweisbaren Funktionsumfang mit dem
oeffentlich dokumentierten Mindestumfang von LearningSuite. Nicht oeffentlich
dokumentierte LearningSuite-Funktionen sind nicht bewertet. Ein Status
"voll" bedeutet nur, dass der in der jeweiligen Zeile beschriebene Workflow im
aktuellen Q-Academy-Stand nachweisbar ist. Er ersetzt keine Produktions- oder
Kundenfreigabe.

## Quellen und Methode

Geprueft wurden am 2026-07-11 ausschliesslich offizielle Primaerquellen:

- [LearningSuite Features][ls-features]
- [LearningSuite Updates][ls-updates], einschliesslich des dort neuesten
  gelisteten Produktupdates vom 2026-05-19
- [LearningSuite Hilfezentrum][ls-docs] mit den offiziellen Produktkollektionen

Der Q-Academy-Status wurde gegen `README.md`, die Routen unter `src/app`, das
Datenmodell in `src/db/schema.ts` und die zugehoerigen Admin-, Lern- und
API-Workflows geprueft. Eine fehlende oeffentliche LearningSuite-Dokumentation
wird nicht als Beleg dafuer verwendet, dass LearningSuite eine Funktion nicht
besitzt.

## Status und Prioritaet

| Wert | Bedeutung |
| --- | --- |
| `voll` | Der beschriebene Kernworkflow ist im Repository durch UI, Serverlogik und Datenmodell nachweisbar. |
| `weitgehend` | Der lokale End-to-End-Kernworkflow ist vorhanden; eine Vertiefung oder externe Provider-/Store-/Betriebsabnahme bleibt offen. |
| `teilweise` | Ein belastbares Fundament ist vorhanden, aber wesentliche Teile des offiziellen Workflows fehlen. |
| `fehlt` | Kein zusammenhaengender Produktworkflow ist im Repository nachweisbar. |
| `P0` | Grundvoraussetzung fuer funktionale Produktparitaet oder sichere Nutzung des betreffenden Kernworkflows. |
| `P1` | Zwingend fuer das vollstaendige B2B-/SaaS-Produkt, baut aber auf P0 auf. |
| `P2` | Vertiefung, Komfort oder Anwendungsfall-Erweiterung nach den Kernworkflows. |

## Feature-Matrix

| Reihenfolge | Produktbereich | Offiziell belegter Referenzumfang | Q-Academy-Status | Wichtigste Luecke oder Nachweis | Prioritaet | Fuer Konzept-Clone |
| ---: | --- | --- | --- | --- | --- | --- |
| 1 | Kursbibliothek und Kategorien | Kategorien verwalten, sortieren und in einer umfangreichen Bibliothek nutzen. [Quelle][ls-course-categories] | voll | Mandantengebundene Kurskategorien lassen sich mit Name, Beschreibung und Farbe anlegen, bearbeiten, atomar umsortieren und loeschen. Belegte Kategorien zeigen ihre Kurszahl; eine explizite Bestaetigung entfernt beim Loeschen nur die Zuordnung und erhaelt alle Kurse. Owner, Admin und berechtigte Custom-Rollen werden serverseitig erneut geprueft. Suche sowie Karten- und Tabellenansicht der Kursbibliothek sind vorhanden. | P0 | zwingend, vorhanden |
| 2 | Kursstruktur und Module | Kurse aus Modulen, Sektionen, Lektionen und Seiten; Module in Ordnern und synchronisiert in mehreren Kursen. [Quelle][ls-modules] | voll | Q-Academy verwendet bewusst die flachere Struktur Kurs, Modul, Lektion und Seite. Wiederverwendbare Module, eigenstaendige Kurs-Link-Module und eine validierte, im Admin- und Mitgliederbereich dargestellte Moduleinrueckung ueber vier Ebenen sind vorhanden. Lektionszugriff, Content-Drip und Reihenfolge werden direkt an der Lektion gepflegt; eine zusaetzliche Sektionsebene ist nicht erforderlich. Mitglieder koennen jede aktuell zugaengliche Lektion direkt merken; `/academy/bookmarks` zeigt die weiterhin berechtigten Lesezeichen nach Kurs und Modul gruppiert, waehrend Zugriffsentzug oder Loeschung keine veraltete Lernroute offenlegt. | P0 | zwingend, vorhanden |
| 3 | Seiten- und Kurseditor | Drag and Drop, Styling, Vorschau, Verschieben, Kopieren, Undo und Anzeige gleichzeitiger Bearbeiter. [Quelle][ls-editor] | voll | Seiten, Vorschau, Drag and Drop, Seiten-/Blockduplikation, Verschieben, Ausblenden, Schnellnavigation sowie strukturierter Rich Text mit Undo/Redo sind vorhanden. Einzelne Lektionen lassen sich in ein berechtigtes Zielmodul kopieren; der atomare Graph-Clone uebernimmt Seiten und Bloecke, ordnet Pruefungs-, Medien-, Datenformular- und KI-Agent-Referenzen sicher neu zu und weist archivierte, tenantfremde oder nicht editierbare Ziele ab. Page- und Block-CAS weisen veraltete UI-/API-Schreibversuche sichtbar ab. Bearbeiterpraesenz verwendet tenant-/kursgebundene Heartbeats mit kurzer TTL; Seiten- und Blockstyles werden validiert und versioniert. Der redigierte Publish-Diff mit Hinweisen und Historie bleibt erhalten. CRDT-/OT-Echtzeit-Merge ist bewusst keine Voraussetzung dieses Kernworkflows. | P0 | zwingend, vorhanden |
| 4 | Inhaltsbloecke | Text, Listen, Medien, Interaktionen, Eingabefelder und Integrationen als frei kombinierbare Elemente. [Quelle][ls-editor] | voll | Neunundzwanzig typisierte Bloecke inklusive Rich Text, Medien, sicherem Asset-Download, Button/Link, Galerie, Callout, Zitat, Trenner, Accordion, Tabs, Spalten, Code, barrierearmer Tabelle, Datenformular, KI-Agent und Assessments sind mit versionierten, begrenzten Dokumenten in Editor, Vorschau, Lernansicht, Snapshot und REST/OpenAPI vorhanden. Der Integrationskatalog bindet YouTube, Vimeo, Loom, Microsoft Forms und Google Forms an kanonische HTTPS-Hosts und passende Video-, 4:3- oder Langformular-Layouts; eine ausgewaehlte Provideridentitaet kann nicht mit einer fremden URL kombiniert werden. Im Mitgliederbereich entsteht vor der lokalisierten Click-to-load-Freigabe weder ein Iframe noch eine Verbindung zum Drittanbieter. | P0 | zwingend, vorhanden |
| 5 | Sichtbarkeit und Content Drip | Nach vorherigem Inhalt, Tage, Datumsbereiche, "erscheint bald", gesperrt, versteckt und nutzerspezifische Ueberschreibungen. [Quelle][ls-visibility] | voll | Alle Sichtbarkeitsmodi, Datumsfenster, Reihenfolge-Gates, individuelle Overrides und Anfragen werden am publizierten Snapshot durchgesetzt. Mitglieder koennen eine effektiv als `coming_soon` aufgeloeste Lektion abonnieren; eine neue Publikation erzeugt beim Uebergang zu `canOpen` transaktional und genau einmal In-App-, Mail- und Webhook-Ereignisse. Pro Kurs aktivierbare Modulfreigabe-Mails vergleichen ausschliesslich beim Publikationswechsel den alten und neuen Snapshot zum selben Publikationszeitpunkt fuer jedes aktive, berechtigte Enrollment, respektieren Learning-Opt-outs und werden pro Version und Mitglied dedupliziert. Das blosse Erreichen eines `date_window`-Zeitpunkts ohne neue Publikation versendet keine Mail. | P0 | zwingend, vorhanden |
| 6 | Kurs-Widgets | Autor-, Info- und verlinkte Bildkarten direkt in der Kursuebersicht. [Quelle][ls-course-widgets] | voll | Geordnete Autor-, Info- und Bild-Link-Karten sind mit Admin-CRUD, sicheren Links, tenantgebundener Autorenauswahl, unveraenderlichem Versions-Snapshot sowie responsiver Mitgliederansicht belegt. Bildkarten akzeptieren weiterhin sichere oeffentliche Quellen oder waehlen ueber den Asset-Picker ein gescanntes `ready`-Bild des Mandanten. Private Bilder werden mit kanonischer autorisierter Download-URL und unveraenderlicher Kursbindung gespeichert; Kursversionen, Clone-/Transferpfade und der Asset-Lifecycle erhalten diese Bindung, waehrend tenantfremde oder ungepruefte Medien atomar abgewiesen werden. | P1 | zwingend, vorhanden |
| 7 | Pruefungen | Eigenstaendiger Pruefungsmodultyp, der verschiedene Aufgaben in einer umfangreichen Pruefung buendelt. [Quelle][ls-exams] | voll | Der eigenstaendige Pruefungsmodultyp buendelt fuenf serverbewertete Fragetypen sowie manuell gepruefte Abgaben. Bewertete Versuche frieren Kursversion, Definition und eine HMAC-ausgewaehlte Fragenpraesentation ein; Zeitlimit, revisioniertes Autosave, serverseitige Finalisierung, maximale Versuche, Inhaltsbindung sowie getrennte Ergebnis- und Einsichtsfreigabe werden persistent durchgesetzt. Vor dem expliziten Start liefert die Lernansicht keine Frageinhalte oder Loesungsschluessel aus. | P0 | zwingend, vorhanden |
| 8 | Interaktive Aufgaben | Single-/Multi-Select, Lueckentext, Sortieraufgabe und sofortiges Feedback. [Quellen][ls-interactive] [Update][ls-v112] | voll | Single-/Multi-Select, Wahr/Falsch, normalisierter Lueckentext und sicher gemischte Sortieraufgaben werden serverseitig bewertet und geben loesungsschluesselfreies Sofortfeedback. | P0 | zwingend, vorhanden |
| 9 | Abgaben und Review | Text, Rich Text, Datei, Audio und Video mit Trainerbewertung, Inline-Kommentaren und sekundengenauem Video-Feedback. [Quellen][ls-submissions] [Update][ls-v112] | voll | Versionierte Rich-Text-Versuche mit deterministischer Textprojektion, sichere Datei-/Audio-/Video-Anhaenge, Score, Reviewer und unveraenderliches Feedback sind vorhanden. Trainer markieren exakte Textbereiche oder millisekundengenaue Stellen gebundener Audio-/Videoanhaenge; Lernende sehen Formatierung, Zitat, Kommentar und abspielbare Zeitmarke. Fuer ISO-BMFF- und WAV-Medien wird die gepruefte Dauer serverseitig gespeichert und als Timestamp-Obergrenze erzwungen; Formate ohne vertrauenswuerdige Serverdauer bleiben abspiel- und kommentierbar. REST, DB-Constraints, Tenant-/Attachment-Bindung, Range-Streaming sowie positive, negative und responsive E2E-Tests sind belegt. | P0 | zwingend, vorhanden |
| 10 | Medien- und Asset-Plattform | Upload, Bildgalerie, Stockbilder, Videoaufnahme, Schnitt, Hosting, Thumbnails, Pflichtvideo und steuerbares Vorspulen. [Quellen][ls-media] [Features][ls-features] | weitgehend | Persistiertes Asset-/Scanmodell, Quota, exakte S3-Versionen und Uploads fuer Abgabe, Kurs, Community, Profil und Branding sind vorhanden. Eine suchbare, rollen-, tenant- und kursbegrenzte Medienbibliothek erlaubt die sichere Wiederverwendung bereits freigegebener Assets im Kurseditor. Audio- und Videobloecke nehmen Mikrofon, Kamera plus Mikrofon oder Bildschirm per MediaRecorder auf und uebergeben bestaetigte Dateien ausschliesslich an den Scan-/Asset-Workflow. Der Editor verwaltet Trimgrenzen, mehrere nicht ueberlappende Schnittbereiche, Thumbnail-Marker, Untertitel und Vorschau auf einer visuellen Timeline. Bis zu acht Audiospuren besitzen eigene Quelltrims, Timeline-Offsets und Lautstaerke; der Runner bindet jede Quelle immutable an Key, Version, ETag, SHA-256, Groesse und Dauer, mischt mit Limiter und liefert Mitgliedern nur den exakt publizierten Renderjob aus. Player, Suche, Seek-/Fortschrittslogik und Lektionsabschluss bilden Quellzeit auf die komprimierte effektive Wiedergabezeit ab und erzwingen Pflichtanteil sowie Vorspulregel. Versionierte Endkarten mit sicherer CTA und Replay sind vorhanden. Reale S3-/FFmpeg-/STT-Provider- und Lastabnahme bleiben Betriebs-Gates. | P0 | zwingend |
| 11 | Transkripte, Untertitel und Videosuche | Automatische Transkripte, Untertitel und Suche mit Sprung zur Fundstelle im Video sowie tenantweite Suchausschluesse. [Quellen][ls-v110] [Update][ls-v111] | weitgehend | Versionierte WebVTT-Transkripte liefern Untertitel, Textsuche und klickbare Zeitmarken; tenantweite auditierte Suchausschluesse veraendern das Transkript nicht. Strikter UTF-8-Dateiimport, begrenzter Parser mit korrekter Cue-Markup-Klartextprojektion und kanonischer Export sind im Editor vorhanden. Der asynchrone, digest- und vertragsgebundene Transkriptjob besitzt einen begrenzten OpenAI-Adapter fuer `gpt-4o-transcribe-diarize` mit `diarized_json`-Zeitsegmenten und Server-VAD, der samt dateibasiertem Credential ausschliesslich in den isolierten Medien-Images liegt; deterministische Sidecars bleiben auf Dev/Test beschraenkt. Das ist noch keine Produktionsfreigabe: dedizierter Schluessel, echter gesprochener Provider-Canary, Sprach- und Cue-Qualitaet, Audio-Egress/Einwilligung, AVV/DPA, Retention/Datenregion, Kosten- und Lastabnahme bleiben zwingende Go-live-Gates. | P0 | zwingend fuer gleichwertiges Premium-Lernen |
| 12 | Lernzugriff und Bundles | Direkte, Gruppen- und Bundle-Zugriffe sowie Laufzeiten, Verzogerung und Sichtbarkeit pro Bundle-Kurs. [Quelle][ls-bundles] | voll | Direkte, Gruppen- und Bundle-Zuweisungen sowie Start, Ende, Verzoegerung und Sichtbarkeit pro Bundle-Kurs werden in Katalog, Lernen, Abgaben, Assessments und KI-Kontext serverseitig durchgesetzt. | P0 | zwingend, vorhanden |
| 13 | Mitglieder- und Gruppenverwaltung | Mitglieder suchen/importieren, Kurse zuweisen und Gruppen gemeinsam verwalten. [Quellen][ls-members] [Gruppen][ls-groups] | voll | Mitglieder, Einladungen, CSV, Gruppen, Bundles und Profile sind als Kernworkflow vorhanden. Das eigene Profil fuehrt eine optional normalisierte Telefonnummer und eine responsive, barrierearme Kanal-Matrix fuer Lernen, Community, Events, Feedback und Ankuendigungen; In-App bleibt aktiv, E-Mail und Push werden tenantgebunden bis in die Worker erzwungen. | P0 | zwingend, vorhanden |
| 14 | Team und Berechtigungen | Getrennte Admin-Team-Verwaltung mit Rollen und sichtbaren Rechten. [Quelle][ls-team] | voll | Owner, Admin, Trainer und Member bleiben als sessionkompatible Basisrollen erhalten. Owner definieren mandantengebundene Custom-Rollen mit sichtbaren View-/Manage-Rechten fuer Mitglieder, Kurse, Community, Events, Analytics, Einstellungen, Integrationen, API und KI und weisen sie aktiven Admin-/Trainerkonten zu. Live-Resolver, Navigation, Dashboard, globale Suche, Bereichslayouts und kritische Mutationen verwenden dieselbe fail-closed Policy; Trainerrechte sind nach oben begrenzt, Owner unveraenderlich und Rollen-REST ist ueber owner-gebundene Scopes abgesichert. | P1 | zwingend, vorhanden |
| 15 | Mitglieder-Eigenschaften | Datenprofile, Kategorien, viele Feldtypen, Feldsichtbarkeit, Auswertung und Personalisierung. [Quelle][ls-member-properties] | voll | Personalisierte Custom- und Multi-Profile, Vorlagen, Kategorien, Medienfelder und Sichtbarkeitsstufen fuer Mitglied, Trainer und Admin sind mandantengebunden vorhanden. Eigenpflege, Adminpflege, Formulare und REST validieren Medien tenant-/ownergebunden; permissiongebundener CSV-Export, Opt-in-Templates sowie REST-Analytics decken Auswertung und Personalisierung ab. | P0 | zwingend, vorhanden |
| 16 | Formulare und Multi-Profile | Formulare in Lektionen/Hubs, mehrere Profile pro Mitglied und Profilwechsel im Inhalt. [Quellen][ls-property-forms] [Multi-Profile][ls-multi-profile] | voll | Konfigurierbare Formulare, mehrere Profile pro Mitglied, Profilwechsel und tenantisolierte Formularabgaben sind in Lektionen und Hubs durch UI, Serverlogik, Datenmodell, Audit und responsive Tests belegt. | P0 | zwingend, vorhanden |
| 17 | Branding und Plattformdesign | Name, Domain, Light/Dark-Logos, Farben, Font, Abrundung, Link-Vorschau und Dark Mode. [Quelle][ls-design] | voll | Name, Farben, getrennte gescannte Light-/Dark-Logos, Favicon, Font, Radius, Link-Vorschaubild, E-Mail-Absendername und validierte Legal-/KI-Links sind vorhanden. Unter `/admin/settings` lassen sich geordnete, aktivierbare Mitglieder-Sidebarlinks mit festem Icon-Katalog und ausschliesslich sicheren relativen oder HTTPS-Zielen verwalten; Desktop- und Mobildrawer verwenden dieselbe tenantgebundene Reihenfolge. Owner koennen revisionsgebundenen Header- und Footer-Custom-Code konfigurieren. Beide Slots laufen als getrennte `srcdoc`-Iframes nur mit `allow-scripts`, ohne Same-Origin-, Cookie-/Storage-, Formular- oder Popup-Rechte; eine restriktive CSP sperrt Netzwerk standardmaessig und erlaubt hoechstens explizite HTTPS-Origins. Aenderungen verwenden CAS, Audit und nur Inhalts-Hashes statt Quellcode im Audit. Custom Domains besitzen einen owner- und entitlementgebundenen Create/Rotate/Verify/Revoke-Lifecycle; nur verifizierte Claims steuern Login, Branding und OIDC-Hostaufloesung. Der Tenant setzt `light`, `dark` oder `system`; eine optionale Nutzerpraeferenz wird serverseitig aufgeloest. Produktives DNS und TLS bleiben Betriebsabnahmen. | P1 | zwingend, vorhanden |
| 18 | Login und First-Login-Onboarding | Anpassbare Login-Seite, Hintergrund, Willkommens-Popup, Video sowie Profilbild-/Profilaufforderung. [Quelle][ls-login-design] | voll | Tenant-Login-Builder, Hintergrund und Vorschau sind vorhanden. Owner konfigurieren ein versioniertes Willkommens-Popup mit sicherer HTTPS-Video-URL sowie direkten Profilbild- und Profilvervollstaendigungsaufforderungen; jedes aktive Mitglied bestaetigt jeden Konfigurationsstand genau einmal. | P1 | zwingend, vorhanden |
| 19 | Mehrsprachigkeit | Mindestens DE, EN, IT, ES und FR, Nutzer-Sprache und lokalisierte Einladungen/E-Mails. [Quelle][ls-exams] | voll | Persistierter Tenant-Standard und optionale Nutzerpraeferenz fuer DE/EN/IT/ES/FR, serverseitige Aufloesung, auditierte Admin-/Profilwahl sowie lokalisierte Navigation, Suche, Auth-, Recovery-, MFA-, Autoren-, Pruefungs- und Mitgliederoberflaechen sind vorhanden. Eine deklarierte Flaeche aus 18 Admin-/Academy-Routen sowie typisierte Fachkataloge erzwingen DE/EN/IT/ES/FR-Key-, Platzhalter- und Leerwertparitaet; lokalisierte Block-/Aufgaben-Defaults und Fachaktionscodes verhindern sprachfremde Serverfehler. Das E-Mail-Center behaelt 54 gemessene Werte je Locale. Datums-, Zeit-, Dauer- und Zahlenformatierer erhalten die wirksame Locale explizit; empfaengerbezogene Benachrichtigungen werden je Nutzer-Locale materialisiert, waehrend Nutzerinhalte unveraendert bleiben. Muttersprachliche Fach-, Rechts- und UX-Abnahme bleibt ein Marktfreigabe-Gate, keine fehlende Produktfunktion. | P1 | zwingend, vorhanden |
| 20 | E-Mail-Center | Mehrsprachiger Vorlageneditor, Variablen und einsehbare Versandhistorie. [Quelle][ls-email-editor] | voll | Parallele tenantindividuelle Plaintext-Vorlagensaetze fuer DE/EN/IT/ES/FR decken Feedbackantwort, Lektionsfreigabe, Kurs-Modulfreigabe, Einladung und Passwort-Reset ab. Admin-Editor, locale-spezifische sichere Text-/HTML-Vorschau und Testsendung, maskierte/filterbare Historie, redigierte Auth-Details, unveraenderlicher Retry-Snapshot sowie REST/OpenAPI sind vorhanden. Die Empfaenger-Locale wird verschluesselt beim Einreihen fixiert. Ein HMAC-signierter, replay-sicherer Bounce-/Complaint-Rueckkanal erzeugt tenantgebundene Empfaengersperren; der Worker prueft sie fail-closed und berechtigte Admins koennen sie mit geschlossenem Grund auditierbar freigeben. Stabile Locale-Keys materialisieren gueltige Legacy-Templates beim Standardsprachewechsel rueckwaertskompatibel; DSAR behandelt geteilte Templates als manuell zu pruefende Tenant-Konfiguration ohne automatische Retention-Loeschung. | P1 | zwingend, vorhanden |
| 21 | Hubs | Zugriffsgebundene Dashboards mit Reihen, Templates, Kategorien, Variablen, Medien-, Formular-, KI- und Custom-Code-Widgets. [Quellen][ls-hubs] [Variablen][ls-hub-vars] | voll | Reihen, neun Widgettypen einschliesslich Datenformular, KI-Agent, kontrolliertem HTTPS-Embed und Custom Code, User-/Gruppen-/Bundle-Zugriff, vier Layout-Templates, Kategorien und sichere Mitglieds-/Kursvariablen sind vorhanden. HTML, CSS und JavaScript im begrenzten Custom-Code-Widget laufen in einem CSP-gebundenen `srcdoc`-Iframe mit `allow-scripts`, aber ohne Same-Origin-, Netzwerk-, Cookie-/Storage-, Formular-, Popup- oder Academy-Zugriff; Personalisierungsvariablen werden im Code bewusst nicht aufgeloest. | P1 | zwingend, vorhanden |
| 22 | Pop-ups und Ankuendigungen | Editor-Bloecke, Templates, regelbasierte Zielgruppen, Treffer-Vorschau und Statistiken. [Quellen][ls-popups] [Sichtbarkeit][ls-popup-visibility] | voll | Banner/Modal, Zeitraum, Dismissal und wiederverwendbare Presets sind vorhanden. Der versionierte, auf 16 Bloecke begrenzte Editor kombiniert Rich Text, Callouts, Trenner und sichere interne beziehungsweise HTTP(S)-CTAs, ordnet Bloecke neu, setzt freigegebene Variablen ein und zeigt dieselbe responsive Lernansicht als Vorschau. Legacy-Inhalte werden verlustfrei in das Blockdokument projiziert. Ein serverseitig identischer UND-Regelbuilder deckt Rolle, Gruppe, Bundle, Kurszugriff und Fortschritt ab; die Admin-Vorschau zeigt Treffer und Stichprobe, waehrend Impression, Klick und Dismissal idempotent erfasst werden. | P1 | zwingend, vorhanden |
| 23 | Community-Grundlagen | Bereiche, Feed-, Ankuendigungs- und Diskussionsforen mit Rich Media und verschiedenen Reaktionen. [Quelle][ls-forums] | voll | Geordnete Community-Areas gruppieren Feed-, Diskussions- und Ankuendigungsforen; Admins koennen Areas anlegen, bearbeiten, umsortieren, Foren verschieben und nur unter Erhalt mindestens einer Ziel-Area loeschen. Mitglieder sehen dieselbe zugriffsgefilterte Gruppierung. Posts und Kommentare verwenden ein begrenztes versioniertes Rich-Text-Dokument mit deterministischer Plaintext-Projektion fuer Suche, Mentions und Moderation und binden bis zu sechs beziehungsweise drei gescannte Anhaenge atomar. Ein Post kann genau einen typisierten Kurs statt einer freien URL referenzieren; Tenant, Publikationsstatus sowie Autor- und Betrachtersichtbarkeit werden bei Schreiben und Lesen geprueft, bevor eine Kurskarte erscheint. Offene oder eingeschraenkte Foren erzwingen `view`, `post` und `comment` auch in Suche, Dashboard, Reports, Reaktionen, Votes und REST. | P0 | zwingend, vorhanden |
| 24 | Community-Engagement und Moderation | Personalisierter Feed, Mentions, Follow, Boosting, Levels, Reports, Freigabe und Auto-Sperre. [Quellen][ls-community-app] [Levels][ls-levels] | voll | Ein erklaerbarer personalisierter, Following- und Latest-Feed, Follows, auditierte Boosts, Mentions, reversible Punkte, Reaktionen, Rangliste und frei konfigurierbare Levels sind vorhanden. Benachrichtigende Autor- und Bereichs-Follows werden beim ersten sichtbaren Publish dedupliziert, schliessen den Autor aus und revalidieren aktives Konto sowie aktuelle Bereichsrechte; moderierte Inhalte loesen vorher nichts aus. Admins konfigurieren explizit oeffentliche Standardfelder (`Profilbild`, Position, Abteilung, Kurzprofil, Community-Punkte, Badges) und freigegebene sichere Custom-Felder samt Reihenfolge und optionaler Schreibpflicht. Oeffentliche Mitgliedsprofile geben weder E-Mail noch Telefon aus; bei aktivem Completion-Gate blockieren UI, Servermutation und REST neue Posts und Kommentare bis alle markierten Felder im Standardprofil befuellt sind. Bereichsfreigaben, Link-/Duplikatpruefung, vertrauliche Meldungen, automatische Schwellen-Sperre, non-destruktive Faelle, Admin-Queue und Einsprueche werden tenantgebunden durchgesetzt. | P0 | zwingend, vorhanden |
| 25 | Mobile App und Push | Native iOS-/Android-/iPad-App, Push, Accountwechsel und optional eigene Store-App. [Quelle][ls-community-app] | weitgehend | Responsive Web-App, PWA und Web Push sind vorhanden. Capacitor-8-Projekte fuer Android, iPhone und iPad integrieren restriktive Deep-/Universal-Links, sitzungsgebundene Push-Geraete, APNs-/FCM-Zustellqueue, Retry, Widerruf, Retention und Metriken. Tokens rotieren automatisch und werden beim Vordergrundwechsel erneuert; gebrandetes URL-Schema, iOS Privacy Manifest sowie getrennte Android-/iOS-Release-Preflights pruefen HTTPS-, Store-, Push- und Signing-Vertraege fail-closed. Unter `/admin/settings` legt der Tenant Dashboard oder Community als native Kaltstartansicht fest; sichere Links haben Vorrang. Ein Kontowechsel beendet die alte Sitzung und verlangt Reauthentifizierung. Reale Geraete-, Signierungs- und Store-Abnahme sowie Apple-/Google-Credentials bleiben extern. | P1 | zwingend fuer volle Paritaet |
| 26 | Event-Plan | Zielgruppen-/Bundle-Kalender, Zeitzonen, Live-Hinweis, Meeting-Einstieg, Verschiebung/Absage und Design. [Quellen][ls-events] [Update][ls-event-update] | voll | Events, Zielgruppen, RSVP, Kapazitaet, Meeting-URL, ICS und CSV sind vorhanden. Persistente IANA-Zeitzonen werden DST-sicher in Formularen, API, Historie, Benachrichtigungen und Kalenderexporten erhalten. Absagen und Neuplanungen verwenden revisionierte, tenantgebundene Statushistorien und erzeugen atomar In-App-, E-Mail- und Webhook-Outbox-Eintraege; Mitglieder sehen Status, Grund und Verlauf, waehrend RSVP, Meeting-Einstieg und ICS eine Absage durchsetzen. Ein tenantweiter Kalender-Theme-Editor steuert acht Farben, Dichte und Kartenradius mit kontrastgepruefter Textwahl. | P1 | zwingend, vorhanden |
| 27 | Learning Analytics | Kurs- und Nutzerfortschritt, Lernzeit, letzte Lektion, individuelle Freigabe und Fortschrittsreset. [Quelle][ls-course-stats] | voll | Overview-, Kurs-, Mitglied- und Aktivitaetsanalysen, CSV, individuelle Freigaben und transaktionaler Fortschrittsreset sind vorhanden. Aktive Lernzeit wird nur in sichtbaren, fokussierten Lektionsansichten durch tenant- und zugriffsgebundene, sequenzierte Server-Heartbeats gemessen; parallele Tabs, Replay, Zeitluecken und uebergrosse Intervalle werden begrenzt. Jede Messsitzung ist unveraenderlich an die publizierte Kursversion und den damaligen Snapshot-Lektionstitel gebunden. | P1 | zwingend, vorhanden |
| 28 | Feedback-Center | Sterne-/Textfeedback, zentrale Auswertung und Antwort an das Mitglied. [Quellen][ls-course-feedback] [Update][ls-v110] | voll | Mitglieder geben in jeder lesbaren Lektion 1-5 Sterne und optionalen Text ab. Das tenantisolierte Admin-Center bietet Text-/Personensuche, Kurs-/Mitglied-/Statusfilter, Sortierung, explizite Erledigung und eine verschluesselte, auditierte Antwort-Outbox an das aktive Mitglied. | P1 | zwingend, vorhanden |
| 29 | KI-Kurs-Wizard | Video zusammenfassen und daraus Fragen, Lueckentexte und weitere Inhalte erzeugen. [Quelle][ls-wizard] | weitgehend | Der lokale, quellengebundene WebVTT-Wizard erzeugt Zusammenfassungen sowie direkt alle fuenf serverbewerteten Typen: Single-/Multi-Select, Wahr/Falsch, Lueckentext und chronologische Sortieraufgabe. Eine begrenzte freie Anweisung darf deterministisch einen vorhandenen Cue-Zeitbereich fokussieren, aber weder Blocktyp, Operation noch Berechtigung veraendern; die kopierbare Ergebnisprojektion enthaelt keinen Loesungsschluessel. Ein asynchroner STT-Job kann digestgebundene Video-/Audiotranskripte erzeugen; der isolierte Runner bindet Quelle und Derivate an exakte S3-Versionen, ETag, Groesse, MIME-Typ und SHA-256. Vor Produktion bleiben die konkrete S3-/STT-Konfiguration, Modell-/Sprachqualitaet, Datenschutz und Lastabnahme offen. | P1 | zwingend |
| 30 | KI-Agenten und Concierge | Coaching-/Formular-Bots, Kurswissen, Dokumente, Web, Mitglieder-Eigenschaften, n8n und Einbettung in Lektionen/Hubs. [Quelle][ls-ai-agents] | voll | Das versionierte Agent Studio bietet drei Agenttypen mit Draft/Publish/Rollback, Kurs-, manuellen, Medien-, Dokument- und unveraenderlichen SSRF-gehaerteten Webquellen, Mitgliedsvorschau sowie Einbettung in Lektionen und Hubs. PDF-, DOCX-, PPTX-, XLSX-, CSV- und Textinhalte werden serverseitig begrenzt extrahiert und per SHA-256 gebunden. Nur explizit ausgewaehlte, fuer das Mitglied sichtbare Profilfelder gelangen redigiert in den Prompt. Dedizierte signierte n8n-Workflows laufen ueber die durable Retry-Queue. | P0 | zwingend, vorhanden |
| 31 | KI-Zugriff, Insights und Automation | Gruppen-/Bundle-Zugriff, Chat-Insights, Credits, Zusatz-Prompts, Aktionen und externe Trigger. [Quellen][ls-ai-access] [Trigger][ls-ai-triggers] | voll | Versionierte Freigaben, Kill-Switch, inhaltsfreie Insights, bis zu 20 versionierte Zusatz-Prompts und ein digestgebundener Transparenzhinweis sind vorhanden. Agentnachrichten und KI-Kurserstellung reservieren kostenabhaengige Einheiten aus demselben vertragsbegrenzten Monatsbudget; Provider-Timeout und ein PostgreSQL-geteilter Circuit Breaker fallen ohne unkontrollierte Retries auf lokale Lernpfade zurueck. Freigabepflichtige Kurszugriffs-, Gruppenmitgliedschafts- und Bundlezuweisungsaktionen besitzen Exactly-once-Ausfuehrung, exakte Provenienz, append-only Audit, REST und Webhooks; ein Entfernen widerruft keine manuell oder durch Commerce erteilte Berechtigung. | P1 | zwingend fuer kontrollierten KI-Betrieb, vorhanden |
| 32 | Native Verkaufsintegrationen | Copecart, Digistore24 und Ablefy steuern Mitglied, Bundle, Zahlungsausfall, Kuendigung und Restlaufzeit. [Quellen][ls-copecart] [Digistore][ls-digistore] [Ablefy][ls-ablefy] | weitgehend | Providerneutrale Produkte, Mappings, Orders, Subscriptions und quellenbezogene Entitlements sowie signierte/idempotente Adapter, Zahlungsausfall, Kuendigung und Restlaufzeit sind lokal umgesetzt. Provider-, Signatur-, Parser- und Mapping-Preflights sowie revisionskontrollierte Endpoint-Key-Rotation verhindern ungetestete Aktivierungen. Eine Abnahme mit realen Providerkonten und deren konkret konfigurierten Signaturversionen bleibt vor Livebetrieb erforderlich. | P1 | zwingend fuer Coach-/Kursgeschaeft |
| 33 | Automations- und Supportintegrationen | Zapier-Aktionen sowie eingebetteter Intercom-Support. [Quellen][ls-zapier] [Intercom][ls-intercom] | weitgehend | Versionierte repo-native Pakete fuer Zapier CLI 19 und Make Apps Editor stellen getrennte Member-Grant-/Revoke-Aktionen, mutationsfreien Scope-Test, aktive Bundleauswahl, Bearer-Auth, Idempotenz und Secret-Sanitization bereit; Contracttests binden beide an dasselbe REST-/OpenAPI-Schema. Dedizierte signierte n8n-Workflows laufen ueber die durable Webhook-Queue und der tenantkonfigurierbare Link-, E-Mail- oder Intercom-Launcher nutzt Identity-HMAC. n8n-Testzustellungen laufen real durch die persistente signierte Queue; Support-HMAC und effektiver Launcher besitzen einen fail-closed Preflight. Reale Zapier-/Make-Origins, Kontotests und Marketplace-Zertifizierungen bleiben extern. | P1 | zwingend fuer breite Automatisierung |
| 34 | Orbit / Multiinstanz-Control-Plane | Instanzwechsel, organisationsweite Rollen, Partnerzugriff, Kundenslots, Abrechnung und Inhaltstransfer. [Quellen][ls-orbit] [Transfer][ls-content-transfer] | weitgehend | Globale Orbit-Accounts und verifizierte Tenant-Identitaeten, Workspaces, Rollen/Permission-Sets, Kundenslots, Entitlements, Instanz-Claims, zeitlich begrenzte Partnerdelegationen und Audit sind als Self-Service-Control-Plane vorhanden. Monats- oder Jahresabrechnung verwendet revisionsgebundene, erst zur Folgeperiode wirksame und append-only geschuetzte Preisversionen; faellige Perioden werden lueckenlos, idempotent und mit unveraenderlichen Abschluessen abgestimmt. Der Cross-Tenant-Transfer fuehrt Preflight, Berechtigungs-Recheck und Kopie publizierter Kursinhalte mit Item-Mappings aus. Mehrspur-Kompositionen muessen vor dem Transfer als eigenstaendiges Video exportiert werden; Preflight und Remapper verhindern einen still ungerendert publizierten Zielkurs. Produktive Multi-Rootserver-, Zahlungsprovider- und Lastabnahme bleiben extern. | P1 | zwingend fuer Multi-Kunden-SaaS und Agenturen |
| 35 | SSO | OpenID Connect und optional Google-Anmeldung. [Quellen][ls-exams] [Login][ls-login-design] | voll | Der tenantgebundene OIDC-Code-Flow mit Discovery, PKCE S256, State/Nonce, verschluesselter Transaktion, verifizierter E-Mail, Identitaetsbindung, optionalem Domain-JIT, SSO-only-Einladungen, expliziter Owner-Verknuepfung und frischem Owner-Step-up ist lokal vollstaendig getestet. Providerregistrierung und DNS/TLS sind externe Go-live-Gates; ein Google-spezifischer Komfortadapter ist nicht separat implementiert. | P1 | zwingend fuer B2B, OIDC vorhanden |

## Nachweisbare Q-Academy-Differenzierung

Diese Bereiche sollen bei der Paritaetsarbeit erhalten und weiter ausgebaut
werden:

- versionierte, mandantengebundene REST-API mit OpenAPI 3.1, Scopes,
  Idempotenz, Audit-Log und durable Webhooks
- Kurszertifikate mit serverseitiger Abschlusspruefung und Widerrufshistorie
- sichere Mandantentrennung, Tenant-Lifecycle und Operator-Werkzeuge
- Self-Hosting-Basis mit PostgreSQL, Migrationen, Backup/Restore, DSAR und
  Retention-Kontrollen
- revisionsgebundene Tenant-Vertraege mit DB-erzwungenen Seat-, Kurs- und
  Speichergrenzen sowie gemeinsamen KI-Credits und Feature-Entitlements
- DNS-verifizierte Custom-Domain-Claims und signiertes Mail-Zustellfeedback mit
  fail-closed Empfaengersperren
- verkettete, HMAC-signierte Tenant-Audit-Exporte mit separater Verifikation und
  dokumentierter WORM-/Object-Lock-Uebergabe
- deterministischer KI-Fallback, damit LMS-Kernfunktionen nicht von einem
  KI-Provider abhaengen; der Kursfallback erzeugt alle fuenf unterstuetzten
  bewerteten Aufgabentypen
- versionierte WebVTT-Dokumente, lokale digestgebundene STT-Jobs und ein
  transkriptbasierter Content-Wizard ohne Abhaengigkeit von einem Cloud-STT-
  Provider

Die offiziellen Quellen belegen nicht ausreichend, ob LearningSuite in diesen
Bereichen einen direkt vergleichbaren oeffentlichen Vertrag anbietet. Deshalb
werden sie als Q-Academy-Differenzierung, nicht als behauptete Ueberlegenheit
gegen eine unbekannte Implementierung, dokumentiert.

## Verbindliche Arbeitsreihenfolge

### Phase 1: Medien- und Authoring-Fundament (P0)

Teilstand vom 2026-07-13 mit abgeschlossenem Submission-, Community-, Profil-
und Branding-Endnutzer-Upload:

- [x] Entwicklungs-Dateispeicher und Produktions-S3-Treiber mit
  tenantgebundenen Objektschluesseln, signierten PUT-/GET-URLs,
  Metadatenpruefung und Loeschoperation als Bibliotheksfundament
- [x] Zweckbezogene MIME-, Dateinamen-, Dateigroessen- und
  Inhaltssignatur-Pruefungen sowie konfigurierbare globale Upload-Grenze,
  Tenant-Quote und URL-Laufzeiten
- [x] ClamAV-INSTREAM-Client mit Groessen- und Protokollpruefung sowie interner
  ClamAV-1.5-Dienst in der Produktions-Compose-Konfiguration
- [x] Persistiertes Asset-/Scan-Statusmodell, atomare Quotenabrechnung,
  authentifizierte und tenantisolierte Upload-Endpunkte, Quarantaene- und
  Freigabe-Workflow sowie Lifecycle-Ausfuehrung
- [x] Upload-Oberflaechen und durchgaengige Einbindung in Kurseditor,
  Lernansicht, Abgaben, Community, Profile und Branding sind vorhanden

Upload-API, Scan-/Retention-Pipeline, Profil- und private Kurs-Widget-Medien,
exakt versionsgebundene S3-FFmpeg-/STT-Jobs, visuelle Medien-Timeline,
Stockbildauswahl sowie Submission- und Community-Oberflaechen sind damit
funktionsfaehig. Authoring-Aufnahmen fuer Mikrofon, Kamera plus Mikrofon und
Bildschirm sind direkt an die Audio-/Videobloecke und den bestehenden Scan-/
Asset-Workflow gebunden. Multi-Segment-Schnitt mit komprimierter Lernzeit und
versionierte Endkarten sowie ein bis zu achtspurig gemischter, immutable
quellengebundener Audio-Mehrspurschnitt sind vorhanden.

1. [abgeschlossen] S3-kompatiblen Asset-Service mit tenantgebundenen Objekten,
   Quoten, signierten Uploads, Typ-/Groessenpruefung, Malware-Scan und Lifecycle
   bauen.
2. [abgeschlossen] Bild-, Datei-, Audio- und Video-Uploads sind in Editor,
   Lernansicht, Abgaben und Community integriert; gescannte Bild-Uploads sind
   zusaetzlich in Profil und Branding gebunden. Medienfelder in frei
   konfigurierbaren Mitglieder-Eigenschaften verwenden dieselbe Pipeline.
3. [weitgehend] Mikrofon-, Kamera- und Bildschirmrecorder, gepruefte Dauern fuer
   MP4/MOV/M4A/WAV/MP3/Ogg/WebM, S3-faehiges FFmpeg-Transcoding, Thumbnails,
   Multi-Segment-Schnitt, komprimierte Player-/Fortschrittszeit, Endkarten und
   visuelle Timeline sind umgesetzt. Sichere Audio-, Kamera- und
   Bildschirmaufnahme ist direkt an die Blockeditoren und den bestehenden
   Scan-/Asset-Workflow gebunden. Bis zu acht Audiospuren lassen sich mit
   Quelltrim, Timeline-Offset und Lautstaerke mischen; Publishing und
   Lernansicht sind an den exakten erfolgreichen Renderjob gebunden.
4. [weitgehend] Versionierte WebVTT-Transkripte, Untertitel, zeitcodierte Suche,
   Suchausschluesse und asynchrone STT-Jobs sind umgesetzt. Der isolierte Runner
   verarbeitet exakte S3-Objektversionen und verifiziert Derivate vor der
   Freigabe. Konkrete S3-/STT-Provider-, Modell-, Sprach-, Datenschutz- und
   Lastabnahme bleiben vor Produktion offen.
5. [weitgehend] Versionierte Blocktypen inklusive Callout, Zitat, Trenner,
   Accordion, Tabs, Spalten und sicherem Download, Seiten-/Blockstyles, sichtbare
   Bearbeiterpraesenz, Page-/Block-CAS, Seitenoperationen und
   attributionserhaltende Stockbildauswahl sind implementiert. Ein CRDT-/OT-
   Echtzeit-Merge bleibt Komfortausbau.
6. [abgeschlossen] Eigenstaendige Pruefungsmodule mit fokussiertem Editor,
   gemischten versionierten Auto-Fragen, manuellen Rich-Text-Abgaben,
   Bestehensgrenze, Versuchslimit, Shuffle und Publish-Validierung sind
   umgesetzt. Textbereichs- und zeitcodiertes Audio-/Video-Review sind im
   allgemeinen Abgabe-Workflow umgesetzt.

### Phase 2: Community und Personalisierung (P0)

7. [abgeschlossen] Geordnete Areas gruppieren typisierte Feed-, Diskussions-
   und Ankuendigungsforen. Threads und Kommentare besitzen strukturierten Rich
   Text samt Plaintext-Projektion, Reaktionen, Votes, Mentions, gescannte
   Rich-Media-Anhaenge und sichtbarkeitsgepruefte typisierte Kurskarten.
   Open-/Restricted-Policies mit Rollen-, Personen-, Gruppen- und Bundle-Regeln
   erzwingen `view`, `post` und `comment` serverseitig.
8. [abgeschlossen] Erklaerbarer Feed, Autoren-/Bereichs-Follows, zeitlich
   begrenzte Admin-Boosts, Mentions, getrennte reversible Community-Punkte,
   Kommentarreaktionen, Reports, konfigurierbare Levels, Bereichs-Approval,
   automatische Zurueckhaltung, versionierte Moderationsfaelle, Admin-Queue und
   30-Tage-Einsprueche sind umgesetzt und responsiv getestet.
9. [abgeschlossen] Datenprofile, Feldsichtbarkeit, Medienfelder, Formulare,
   Multi-Profile, Lektion-/Hub-Einbettung und ausgewaehlte Profilpersonalisierung
   fuer KI-Agenten sind umgesetzt. Zusaetzlich besitzt die Community explizit
   konfigurierte oeffentliche Standard-/Custom-Felder, sichere Mitgliederprofile
   ohne E-Mail/Telefon und ein transaktional erzwungenes Profil-Completion-Gate.
10. [abgeschlossen] Das versionierte Agent Studio mit drei Agenttypen,
    Kurs-, manuellen, Medien-, Dokument- und sicheren Web-Snapshots,
    ausgewaehlten sichtbaren Profileigenschaften, Zusatz-Prompts, Zielgruppen,
    Mitgliedsvorschau und Einbettung in Lektionen sowie Hubs ist umgesetzt.
    Kurs-, Gruppen- und Bundle-Aktionen besitzen Adminfreigabe, Provenienz,
    Exactly-once-Ausfuehrung, REST, Webhooks und append-only Audit; n8n ist ueber
    die signierte durable Automationsqueue angebunden.

### Phase 3: B2B-Produkt und Mobile (P1)

11. [weitgehend] Tenantgebundener OIDC-SSO einschliesslich SSO-only-Einladungen,
    Owner-Step-up, dedizierter API-Scopes und Session-Provenienz ist lokal
    abgeschlossen. Mandantengebundene Custom-Rollen, sichtbare Rechte,
    Staff-Zuweisung, transaktionale Owner-Uebergabe und owner-gebundene Rollen-
    REST sind vorhanden. Custom Domains werden per einmaliger DNS-Challenge
    verifiziert und erst danach fuer Branding, Login und OIDC aufgeloest;
    produktive DNS-/TLS- und IdP-Abnahme bleibt extern.
12. [weitgehend] Das versionierte First-Login-Onboarding mit Video und
    Profilaufforderungen ist umgesetzt. Tenant-/Nutzer-Locale, fuenfsprachige
    Kernnavigation, Auth/MFA, Systemmail-Standards, zentrale Fachaktionscodes
    und empfaengerlokalisierte Community-Benachrichtigungen sowie Tenant-/
    Nutzer-Theme `light`/`dark`/`system` sind vorhanden. 18 deklarierte Admin-/
    Academy-Routen und zusaetzliche typisierte Fachkataloge erzwingen
    Dictionary-Paritaet auch in Autoren-/Pruefungsformularen und
    Fachaktionen; muttersprachliche Fach-, Rechts- und UX-Abnahme bleibt ein
    Marktfreigabe-Gate.
13. [abgeschlossen] Parallele tenantindividuelle E-Mail-Vorlagensaetze je
    Sprache, Versandhistorie, Preview/Testsendung, REST/OpenAPI,
    Empfaenger-Locale-Snapshot und Legacy-Materialisierung sind als sicherer
    Admin-Workflow umgesetzt. Der typisierte Pop-up-Blockeditor, Presets,
    sichere Variablen, regelbasierte Zielgruppen/Insights, der achtfarbige
    Event-Theme-Editor mit Dichte und Kartenradius sowie der revisionierte
    Event-Lifecycle sind abgeschlossen.
14. [weitgehend] PWA, Web Push und Capacitor-8-Container fuer Android, iPhone
    und iPad mit Deep Links, tenantkonfigurierbarer Dashboard-/Community-
    Kaltstartansicht, sitzungsgebundener APNs-/FCM-Queue, Retry, Widerruf und
    Reauthentifizierung beim Accountwechsel sind umgesetzt. Signierung,
    reale Geraetetests, Provider-Credentials und Store-Auslieferung bleiben extern.
15. [abgeschlossen] Tenantkonfigurierbarer Kill-Switch, vertragsbegrenzte
    Monatscredits, optionales Mitgliedsstundenlimit und aggregierte
    Nutzungsanalysen werden serverseitig durchgesetzt. Agent-Chats und KI-
    Kurserstellung verwenden dasselbe kostenabhaengige Creditmodell; Provider-
    Timeout und ein PostgreSQL-geteilter Circuit Breaker sichern den lokalen
    Fallback. Reale Provider- und Lastabnahme bleibt ein Betriebs-Gate.

### Phase 4: Commerce und Control Plane (P1)

16. [abgeschlossen] Providerneutrales Produkt-/Bestell-/Subscription-/
    Entitlement-Modell mit quellenbezogenem Zugriff ist implementiert.
17. [weitgehend] Signierte, idempotente Adapter fuer Digistore24, Ablefy und
    Copecart, versionierte Zapier-CLI-/Make-Apps-Editor-Pakete, n8n-Aktionen und
    Supportintegration sind lokal implementiert; reale Providerkonten,
    Connector-Origins und Marketplace-Freigaben bleiben extern.
18. [weitgehend] Orbit-Control-Plane mit globalen Accounts, Workspaces,
    Organisationsrollen/Permission-Sets, Partnerdelegation, Kundenslots,
    Entitlements, Audit und idempotentem Inhaltstransfer ist implementiert;
    externes Billing und produktive Multi-Rootserver-Abnahme bleiben offen.
19. [abgeschlossen] Eine revisionsgebundene Tenant-Vertragsquelle mit Status,
    Feature-Entitlements und DB-erzwungenen Seat-, Kurs- und Speicherlimits ist
    samt Operations-CLI, Nutzungsansicht und REST/OpenAPI lokal vorhanden. Sie
    ersetzt bewusst kein externes Billing- oder Rechnungssystem.

### Phase 5: Vertiefung (P2)

20. [abgeschlossen] Das KI-Agent-Widget, vier Hub-Templates, Kategorien,
    sichere Mitglieds-/Kursvariablen, kontrollierte HTTPS-Embeds und ein
    begrenztes HTML-/CSS-/JavaScript-Widget sind umgesetzt. Custom Code laeuft
    in einem netzlosen, CSP-gebundenen Opaque-Origin-Iframe ohne
    Zugriff auf Cookies, Storage, Formulare, Popups oder die Academy.
21. [weitgehend] Analytics, aktive Lernzeit, Feedbackdialog und visuelle
    Editorpraesenz sind umgesetzt; CRDT-/OT-Merge bleibt eine Komfortfunktion.

## Abschlusskriterium

Feature-Paritaet ist erst erreicht, wenn alle als zwingend markierten P0- und
P1-Zeilen den Status `voll` besitzen und jeweils durch positive, negative,
rollenbezogene, tenantisolierte und responsive Tests belegt sind. Die formale
Kundenfreigabe benoetigt zusaetzlich die externen Gates aus dem
[Production-Readiness-Plan](../PRODUCTION_READINESS_PLAN.md).

Umzugsservice, Store-Einreichungsservice, Live-Support und Marketing-Badges
sind Service- oder Vertriebsangebote. Sie gehoeren zu einem spaeteren
Betriebsmodell, sind aber keine Voraussetzung fuer die technische
LMS-Feature-Paritaet.

[ls-features]: https://learningsuite.io/features
[ls-updates]: https://learningsuite.io/updates
[ls-docs]: https://docs.learningsuite.io/de/
[ls-course-categories]: https://learningsuite.io/en/updates/course-categories
[ls-modules]: https://docs.learningsuite.io/de/articles/13917251-verwaltung-von-modulen
[ls-editor]: https://docs.learningsuite.io/de/articles/6622475-seiten-editor-basics
[ls-visibility]: https://docs.learningsuite.io/de/articles/13916205-sichtbarkeit-deiner-kurs-inhalte
[ls-course-widgets]: https://docs.learningsuite.io/de/articles/6622457-widgets-in-deinem-kurs-addieren
[ls-exams]: https://learningsuite.io/updates/version-1-11
[ls-interactive]: https://docs.learningsuite.io/de/articles/6622485-interaktive-inhalte
[ls-v112]: https://learningsuite.io/updates/update-version-1-12
[ls-submissions]: https://docs.learningsuite.io/de/articles/6622489-abgaben
[ls-media]: https://docs.learningsuite.io/de/articles/6622483-multimedia-elemente
[ls-v110]: https://learningsuite.io/updates/update-version-1-10
[ls-v111]: https://learningsuite.io/updates/version-1-11
[ls-bundles]: https://docs.learningsuite.io/de/articles/6618532-bundles
[ls-members]: https://docs.learningsuite.io/de/articles/6622362-mitglieder-verwalten
[ls-groups]: https://docs.learningsuite.io/de/articles/6622381-mitglieder-gruppen-verwaltung
[ls-team]: https://docs.learningsuite.io/de/articles/6622350-admin-team-verwalten
[ls-member-properties]: https://docs.learningsuite.io/de/collections/18082037-mitglieder-eigenschaften
[ls-property-forms]: https://docs.learningsuite.io/de/articles/14399382-formulare-in-lektionen-oder-hubs-einbauen
[ls-multi-profile]: https://docs.learningsuite.io/de/articles/14429951-deep-dive-multi-profil-modus-nutzung
[ls-design]: https://docs.learningsuite.io/de/articles/6622427-plattform-design
[ls-login-design]: https://docs.learningsuite.io/de/articles/13915535-login-willkommens-popup-anpassen
[ls-email-editor]: https://docs.learningsuite.io/de/articles/6622440-e-mail-benachrichtigungen-bearbeiten
[ls-hubs]: https://docs.learningsuite.io/de/articles/10028507-hubs
[ls-hub-vars]: https://docs.learningsuite.io/de/articles/7882920-template-variablen-in-hubs
[ls-popups]: https://docs.learningsuite.io/de/articles/10032315-pop-ups-erstellung
[ls-popup-visibility]: https://docs.learningsuite.io/de/articles/10125024-pop-ups-sichtbarkeit
[ls-forums]: https://docs.learningsuite.io/de/articles/11105114-foren-mechanik
[ls-community-app]: https://learningsuite.io/updates/community-and-app
[ls-levels]: https://docs.learningsuite.io/de/articles/10681682-level-mechanik
[ls-events]: https://docs.learningsuite.io/de/articles/13193600-event-plan-live-call-kalender
[ls-event-update]: https://learningsuite.io/updates/event-calendar
[ls-course-stats]: https://docs.learningsuite.io/de/articles/13917898-statistiken-nutzer-fortschritt-loschen
[ls-course-feedback]: https://docs.learningsuite.io/de/articles/13917318-feedback-in-kursen-einsehen
[ls-wizard]: https://docs.learningsuite.io/de/articles/9938595-learningsuite-wizard
[ls-ai-agents]: https://docs.learningsuite.io/de/articles/14635549-erklarung-allgemein-ki-agenten
[ls-ai-access]: https://docs.learningsuite.io/de/articles/14654694-ki-concierege-veroffentlichung-zugriff-steuern
[ls-ai-triggers]: https://docs.learningsuite.io/de/articles/15029818-erklarung-ki-trigger
[ls-copecart]: https://docs.learningsuite.io/de/articles/6697305-copecart-integration
[ls-digistore]: https://docs.learningsuite.io/de/articles/12890816-digistore24-integration
[ls-ablefy]: https://docs.learningsuite.io/de/articles/12890854-ablefy-integration
[ls-zapier]: https://docs.learningsuite.io/de/articles/6704267-zapier-integration
[ls-intercom]: https://docs.learningsuite.io/de/articles/7037674-intercom-integration
[ls-orbit]: https://docs.learningsuite.io/de/articles/10981940-orbit-allgemeine-informationen
[ls-content-transfer]: https://docs.learningsuite.io/de/articles/10742157-inhalts-transfer
