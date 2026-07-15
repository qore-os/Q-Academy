# Q-Academy Daten, Retention und DSAR

Stand: 2026-07-14. Die technischen Defaults sind keine rechtliche Festlegung.
Rechtsgrundlage, Zweck, Verantwortlichkeit und Fristen muessen Betreiber, Kunde
und Datenschutzverantwortliche vor Pilotstart je Datenklasse freigeben.

## Datenklassen

| Klasse | Beispiele | Aktuelle technische Behandlung |
| --- | --- | --- |
| Konto und Profil | Name, E-Mail, optionale normalisierte Telefonnummer, Rolle, Abteilung, Profilvorlagen, benannte Mitgliederprofile, sichtbarkeitsgesteuerte Profilfelder und Werte | Bis Loesch-/Anonymisierungsentscheidung; tenantgebunden; Default- und weitere Profile werden getrennt gespeichert |
| Authentifizierung | bcrypt-Hash, Session-JTI-Hash, IP, User-Agent, OIDC-Issuer/Subject-Bindung sowie Auth-Methode, Konfigurationsversion und Auth-Time der Sitzung | Keine Klartextpasswoerter oder OIDC-Client-Secrets im Betroffenenexport; abgelaufene Sessions werden ausser unter aktivem `authentication`-/`all`-Hold automatisch geloescht |
| MFA | verschluesseltes TOTP-Secret, gehashte Recovery-Codes, Challenge-JTI-Hash und Replay-Counter | Secrets, Hashes und Counter werden nie exportiert; DSAR enthaelt nur Status, sichere Zeitmetadaten und Restanzahl; verbrauchte/abgelaufene Challenges sowie verlassene Pending-Enrollments werden nach 24 Stunden bereinigt |
| Browserzustand und externe Browserdienste | notwendige Session-/MFA-/OIDC-Cookies, bis zu fuenf lokal gemerkte Konto-E-Mails, Video-Praeferenzen, Native-Startstatus, neutraler PWA-Cache sowie tenantoptional Intercom, Kurs-Iframes und Plattform-Custom-Code | Vollstaendiger technischer Ist-Stand im [Cookie- und Tracking-Inventar](./COOKIE_TRACKING_INVENTORY.md). Browser-Speicher liegt nicht in PostgreSQL und erscheint deshalb nicht im serverseitigen DSAR; Providerdaten liegen ausserhalb des lokalen Exports. Rechtsgrundlage, Consentbedarf, Providerfristen und Hinweise bleiben vor Pilotbetrieb festzulegen |
| Einmal-Tokens | Einladung, Passwort-Reset | Nur SHA-256-Hash; abgelaufene Datensaetze werden automatisch geloescht |
| Lernen | Einschreibungen, Fortschritt, Lektionslesezeichen, serverseitig gemessene aktive Lernzeit und Pflichtvideo-Wiedergabefortschritt, Lektionsfreigabe-Abonnements, Antworten, Abgaben, Formularabgaben, kursbezogene Trainerrechte, Kurs-Widgets und als Kursinhalt gepflegte WebVTT-Transkripte | Keine automatische Loeschung ohne Kunden-/Nachweis-Policy; persoenliche Lesezeichen werden exportiert und beim freigegebenen Mitglieder-Loeschlauf entfernt; aktive Lernzeit wird pro sichtbarer Fokusphase an Kursversion und gespeicherten Snapshot-Lektionstitel gebunden; Pflichtvideo-Fortschritt ist an Nutzer, Kurs, Lektion, Block und Asset gebunden |
| Medien | Upload-Metadaten, Abgabe-/Community-Anhaenge, Kurs-/Profilbindungen, Processing-Jobs, Derivate, automatische Transkripte und private Speicherobjekte | Offene Intents sowie nie gebundene Fach-, Avatar-, Branding- und Profilmedien laufen ab; Derivate werden bei terminaler Quelle physisch entfernt; geloeschte, quarantinierte oder endgueltig fehlgeschlagene Objekte werden erst nach verifizierter physischer Loeschung aus der Quota entfernt |
| Zertifikate | Empfaenger, Kurs, Nummer, Widerruf | Keine automatische Loeschung; Nachweisfrist festlegen |
| Community und Events | Geteilte Areas/Foren und oeffentliche Profilfeldkonfiguration, Posts und Kommentare mit Format, versioniertem Rich-Text-Dokument und deterministischer Plaintext-Projektion, Publikationsstatus, Reaktionen, Community-Scorebeitraege, Votes, Follows, Autoren-Boosts, Mentions, Meldungen, Moderationsfaelle, Appeals und Zusagen | Areas, Foren, Completion-Gate und Feldzuordnung sind geteilte Tenant-Konfiguration ohne aufgeloeste Profilwerte; sie werden nicht als eigene personenbezogene Zeilen exportiert, Area-/Forentitel dienen nur als Kontext eigener Inhalte. Eigene Posts/Kommentare werden samt sicher bereinigtem Rich Text exportiert; beim freigegebenen Loeschlauf werden verwaltete Medien verifiziert entfernt und geteilte Threadknoten auf `[removed]`, `plain_text`, `rich_text = null` und Projektion v1 pseudonymisiert. Abgelaufene Boosts werden legal-hold-aware geloescht; Cases, Appeals und append-only Moderationsereignisse bleiben tenantgebundene Fallhistorie |
| Feedback | Lektions-/Kursbezug, Text, Rating, Testimonial-Einwilligung und Bearbeitungsstatus | Keine automatische Loeschung ohne freigegebene Policy; Antworten werden als Activity-Ereignis und verschluesselte Mail-Outbox nachvollziehbar |
| Gamification | Punkte, Badge-Gruppen, manuelle/automatische Badges, Rangliste | Keine automatische Loeschung ohne freigegebene Policy; Gruppen/Definitionen sind geteilte Tenant-Konfiguration, personenbezogene Vergaben werden exportiert und bei freigegebener Betroffenenloeschung entfernt |
| KI | Unterhaltungen, unveraenderlich gebundene Agent-Versionen, User-/Assistant-Nachrichten, manuelle/Kurs-/Medien-/Dokument-/Web-Snapshots, ausgewaehlte Profilfeldkonfiguration, Zusatz-Prompts, Access-Grants, Aktionskonfigurationen, Aktionsanfragen/-entscheidungen und Provenienz | Keine automatische Loeschung; publizierte Versionen samt Quellen, Grants und Aktionen sowie ausgefuehrte Aktionsanfragen/-ereignisse sind Verlaufsevidenz, Entwuerfe folgen dem gemeinsamen Agent-Lifecycle; Provider-, Chat- und Aktionsfrist festlegen |
| Benachrichtigungen | Kategoriebezogene E-Mail-/Push-Praeferenzen, In-App-Nachrichten, Ankuendigungsinteraktionen, verschluesselte Web-Push-Abonnements, verschluesselte native APNs-/FCM-Geraetetokens und Zustellhistorie | In-App bleibt aktiv; fehlende Praeferenzzeilen bedeuten fuer Bestandskonten E-Mail/Push aktiv. Push-Credentials werden an die exakte Login-Sitzung gebunden und bei Logout/Loeschung widerrufen; abgeschlossene Web-/Native-Push-Zustellungen laufen standardmaessig nach 90 Tagen ab; Praeferenzen und Ankuendigungsinteraktionen werden exportiert und bei freigegebener Betroffenenloeschung entfernt |
| Authoring-Kollaboration und Stockbilder | Aktive Kurs-/Seitenposition eines Bearbeiters, Anbieter-ID, Attribution, freigegebene HTTPS-Quellen und Auswahlzeitpunkte | Praesenz laeuft nach 75 Sekunden ab; nicht verwendete Stockbildauswahlen nach 30 Tagen. Verwendete Attribution bleibt geteilte Kursmetadatei, die persoenliche Auswahlzuordnung wird nach Shared-Resource-Pruefung entfernt oder pseudonymisiert |
| Commerce und Automationen | Providerverbindung, Produkte, Mappings, Orders, Subscriptions, Entitlements, Inbox-/Outbox-Ereignisse, Zapier/Make/n8n-Verbindungen und Supportkonfiguration | Transaktions- und Rechnungsfristen rechtlich festlegen; Secrets und rohe Payloads sind vom DSAR ausgeschlossen. Personenbezogene Zugriffsprovenienz darf nur nach Vertrags-/Nachweispruefung entfernt oder pseudonymisiert werden |
| Orbit | Globale Account-Identitaet, Workspace-Mitgliedschaft, Permission-Set, Partnerdelegation, Instanz-Claim, versionierte Preise und Periodenabschluesse, Transfers und Audit | Sichere Identitaets-, Mitgliedschafts-, Billing-, Delegations-, Transfer- und Auditprojektionen werden exportiert. Direkte Identitaetsbindungen werden bei freigegebener Loeschung entfernt; geteilte Ownership sowie Preis-, Abschluss-, Transfer- und Auditnachweise erfordern vorherige Uebertragung, Retention-Entscheidung oder Pseudonymisierung |
| API/Audit | Request-ID, Actor, Pfad, Status, IP, User-Agent | Keine automatische Loeschung; Sicherheits-/Vertragsfrist festlegen |
| Webhooks | Ziel, Event, Payload, letzter Antwortstatus sowie append-only Versuchsgenerationen mit Ergebnis, sanitisierter Fehlerklasse, Laufzeit und Zeitstempeln | Versuchseintraege enthalten nie Response-Bodies und folgen ausschliesslich der Parent-Delivery. Nur abgeschlossene Deliveries samt Versuchen nach Default 90 Tagen loeschen; aktive `all`-, `integrations`- oder `communications`-Holds sperren passende eingebettete Subjects, ein Hold ohne aufgeloesten Subject sperrt konservativ alle Tenant-Deliveries |
| Mail-Outbox, Zustellfeedback, Sperren und Vorlagen | E-Mail, verschluesselter Auth-Link oder gerenderter Vorlagen-/Empfaenger-Locale-Snapshot, Status, bounded Bounce-/Complaint-Metadaten, tenantgebundener Empfaenger-HMAC sowie tenantindividuelle Vorlagensaetze je Locale | Nur abgeschlossene, nicht referenzierte und nicht von einem aktiven Hold erfasste Deliveries nach Default 90 Tagen loeschen; Feedback-Events folgen kaskadierend der Delivery. Entsperrte oder seit derselben Frist abgelaufene Soft-Bounce-Sperren werden ohne `communications`-/`all`-Hold geloescht; aktive Hard-Bounce-/Complaint-Sperren bleiben als Zustellschutz bestehen. Klartext-Nachrichten und Provider-Rohpayloads werden nicht in Activity-Metadaten dupliziert. Geteilte Locale-Vorlagen sind Tenant-Konfiguration, werden nicht automatisch geloescht oder im Betroffenenexport wholesale ausgegeben und verlangen bei personenbezogenem Inhalt manuelle Pruefung/Redaktion |
| Rate/Idempotenz | HMAC-Hash, Zaehler, Response | Nach Ablauf automatisch loeschen |
| Datenschutzfaelle | Falltyp, Frist, pseudonymisierte Subject-/Actor-Referenzen, Statushistorie und Legal Holds | Owner-only; Ereignisse sind strikt append-only und bleiben bis zu einem expliziten auditierten Archiv-/Offboardingprozess erhalten |
| DSAR-Exportartefakte | AES-GCM-verschluesseltes JSON im lokalen oder versionierten S3-Speicher | Download nur nach Owner-Step-up durch aktuelles Passwort oder, bei SSO-only, eine frische OIDC-Owner-Sitzung; Ablauf nach 7 Tagen, danach exakte physische Objektloeschung und persistenter Tombstone |
| Backups | Vollstaendiger PostgreSQL-Stand | Rootserver-Default 30 Tage; externes verschluesseltes Ziel erforderlich |

## Automatischer Cleanup

Der interne Scheduler ruft standardmaessig stuendlich
`POST /api/internal/jobs/dispatch?cleanup=run&cleanupLimit=1000` auf. `1000` ist
die harte Obergrenze der Route; Werte ausserhalb von 1 bis 1000 sowie doppelte,
unbekannte oder nicht kanonische Query-Parameter werden vor dem Cleanup mit
HTTP 400 abgelehnt. Geloescht
werden gebatcht und transaktionssicher:

- abgelaufene Sessions, sofern kein aktiver `authentication`- oder `all`-Legal-
  Hold ihre Aufbewahrung verlangt
- abgelaufene Einladungen und Passwort-Reset-Tokens
- verbrauchte oder seit mindestens 24 Stunden abgelaufene MFA-Challenges sowie
  seit 24 Stunden verlassene Pending-Enrollments; aktive MFA-Konfigurationen
  bleiben erhalten
- abgelaufene Rate-Limit- und Idempotenzdatensaetze
- nur terminale (`delivered` oder `failed`) alte Mail-, Webhook-, Web-Push-
  und Native-Push-Deliveries;
  Mail-Deliveries unter einem aktiven `all`-, `authentication`- oder
  `communications`-Legal-Hold sowie Web-/Native-Push-Deliveries unter einem
  aktiven `all`- oder `communications`-Hold bleiben erhalten
- entsperrte oder seit mindestens `EMAIL_DELIVERY_RETENTION_DAYS` abgelaufene
  Empfaengersperren, sofern kein aktiver `communications`-/`all`-Hold des
  betroffenen Empfaengers besteht; aktive permanente Sperren laufen nicht ab
- Autoren-Boosts, deren Ende laenger als die konfigurierte Nachhaltefrist
  zurueckliegt; aktive `community`-/`all`-Holds fuer Autor oder Administrator
  verhindern die Loeschung
- abgelaufene, fertige DSAR-Exportartefakte nach exakter lokaler Datei- oder
  S3-Versionsloeschung; der Fall und das append-only Loeschereignis bleiben
  erhalten
- abgelaufene Editor-Praesenzzeilen und Stockbildauswahlen; geteilte, bereits
  verwendete Kursattribution bleibt davon unberuehrt

Aktive, wartende oder gerade verarbeitete Deliveries sowie Lern-, Audit- und
Activity-Daten werden nicht automatisch entfernt. Die Delivery-Fristen werden
mit `EMAIL_DELIVERY_RETENTION_DAYS`, `WEBHOOK_DELIVERY_RETENTION_DAYS`,
`PUSH_DELIVERY_RETENTION_DAYS` und
`COMMUNITY_AUTHOR_BOOST_RETENTION_DAYS` zwischen 1 und 3650 Tagen
konfiguriert; Default ist jeweils 90.

`community_moderation_cases`, `community_moderation_events`,
`community_moderation_assessments` und `community_moderation_appeals` sind
aus generischen Retention-Laeufen ausgeschlossen. Insbesondere werden Cases,
Appeals und die append-only Event-Timeline weder bei Fristablauf noch allein
wegen des Tenant-Status `offboarding` geloescht. Ein spaeterer
Archivierungs-/Pseudonymisierungslauf muss aktive `community`-/`audit`-/`all`-
Holds pruefen, die Aufbewahrungsentscheidung auditieren und die referenzielle
Reihenfolge explizit behandeln.

Eine Mail-Delivery, die noch von einer
`lesson_availability_subscription` referenziert wird, kann wegen der
referenziellen Integritaet nicht automatisch geloescht werden und wird vom
Cleanup ausgelassen. Das ist eine dokumentierte technische Einschraenkung bis
ein eigener, migrationsgestuetzter Archivierungs-/Entkopplungsprozess
freigegeben ist. Eine reine Verschluesselungs-Key-Rotation veraendert
`email_deliveries.updated_at` nicht und verlaengert die Retention daher nicht.

Eine Vorschau ohne Queue-Ausfuehrung oder Loeschung ist intern mit
`?cleanup=dry-run` moeglich. Der Endpoint ist durch `CRON_SECRET` geschuetzt und
wird von Caddy extern mit 404 blockiert.

### DSAR-Processing und Export-Retention

Fuer Claim, Lease, aktive Legal Holds und Export-Retention ist die
PostgreSQL-Uhr (`clock_timestamp()`) massgeblich, nicht die Uhr eines App-
Containers. Der Start eines freigegebenen Exports oder Loeschlaufs sperrt die
Fallzeile, vergibt ein zufaelliges Claim-Token und eine 15 Minuten gueltige
Processing-Lease. Ein serialisierter Heartbeat verlaengert sie alle 30 Sekunden
nur dann, wenn Fallstatus, Tenant, Claim-Token und die nach PostgreSQL-Zeit noch
aktive Lease zusammenpassen. Der Abschluss, ein Fehlerabschluss und die
Speicheridentitaet sind mit demselben Claim gefenced. Ein Retention-Lauf setzt
abgelaufene `processing`-Faelle auf `failed`, entfernt deren Claim und markiert
noch `building`-Artefakte als fehlgeschlagen; Fall- und Activity-Ereignisse
dokumentieren die Stale-Recovery. Ein alter Worker kann danach weder den Fall
noch das Artefakt erfolgreich abschliessen.

Nach einem erfolgreichen Export-PUT wird die exakte Speicheridentitaet noch
waehrend des Builds persistiert. Beim lokalen Treiber besteht sie aus dem
validierten, aus Tenant-, Fall- und Artefakt-ID abgeleiteten Write-once-Pfad;
`VersionId` und ETag muessen dort leer sein. Bei S3 besteht sie aus genau diesem
Schluessel, der nicht leeren `VersionId` und dem normalisierten ETag. Ein Fehler
nach dem PUT loescht genau diese Identitaet kompensierend. Schlaegt die
Kompensation fehl oder stirbt der Prozess nach dem Persistieren, bleibt die
Identitaet am fehlgeschlagenen Artefakt erhalten und wird vom Retention-Lauf
erneut geloescht. Stirbt der Prozess zwischen S3-PUT und Datenbank-Commit, faengt
die tag- und prefixgebundene Acht-Tage-S3-Lifecycle-Regel das ansonsten nicht
auffindbare Objekt als Defense-in-Depth ab; die autoritative Anwendungsfrist
bleibt sieben Tage. Der lokale Filesystem-Treiber besitzt fuer dieses enge
Vor-Commit-Fenster kein gleichwertiges Lifecycle-Sicherheitsnetz und ist nur
fuer die lokale Entwicklung vorgesehen; die Produktionskonfiguration erzwingt
S3.

Der Privacy-Retention-Lauf besitzt zwei Admission-Grenzen: ein Prozess nimmt
lokal nur einen Lauf an, und ueber alle App-Replikate darf nur der Besitzer der
globalen PostgreSQL-Session-Advisory-Lock arbeiten. Dafuer wird ein eigener
PostgreSQL-Client mit `max: 1` verwendet; Session-Token und Backend-PID werden in
jeder Cleanup-Transaktion erneut geprueft. Ein Lauf waehlt hoechstens zehn
physische Exportloeschungen aus. Sein 32-Sekunden-Arbeitsbudget wird monoton mit
`performance.now()` gemessen. Der produktive S3-Delete erhaelt davon
hoechstens fuenf Sekunden und wird mit einem Abort-Signal begrenzt; der lokale
Filesystem-Unlink besitzt keine eigene asynchrone Abbruch-API. Bei Erreichen der
harten Deadline wird die dedizierte Datenbanksession geschlossen; dadurch wird
auch eine verbliebene Advisory-Lock freigegeben.

Ein fehlgeschlagener Delete setzt `updated_at` mit der PostgreSQL-Uhr neu und
schreibt `export.cleanup_failed` sowie das passende Activity-Ereignis. Fertige
und fehlgeschlagene Artefakte sind erst nach fuenf Minuten ohne neuen Versuch
wieder auswaehlbar. Diese Rotation verhindert, dass dauerhaft fehlerhafte,
fruehe Objekte alle spaeteren Kandidaten eines begrenzten Batches blockieren.
Der interne Dispatcher antwortet bei belegter Lock, Cleanupfehler,
ausgeschoepftem Budget oder weiterem Backlog mit HTTP 503 und
`Retry-After: 15`. Nur ein vollstaendig entleerter, fehlerfreier Lauf liefert
2xx; deshalb schreibt der Scheduler in diesen Fehlerfaellen weder einen
fachlichen Success-Heartbeat noch seinen lokalen Success-Marker und setzt den
stuendlichen Cleanup-Zeitpunkt nicht faelschlich fort.

Der getrennte Medienworker laesst abgelaufene Upload-Intents auslaufen, entfernt
Incoming- und Final-Objekte ueber den jeweiligen Storage-Treiber und gibt
reservierte Quota fuer `deleted`, `quarantined` und `failed` erst frei, wenn
beide Loeschungen nachweislich abgeschlossen sind. Ein `ready`-Asset mit Zweck
`submission`, `community` oder `course_content`, das 24 Stunden nach
Scan-Abschluss noch nicht an seinen fachlichen Inhalt gebunden ist, wird auf
`deleted` gesetzt. Der Worker sperrt dafuer die Asset-Zeile; eine parallele
Attachment-Bindung verwendet dieselbe Sperre. Beim Loeschen eines Posts,
Kommentars oder ganzen Bereichs loescht ein Datenbanktrigger die dazugehoerigen
Community-Assets in derselben Transaktion fachlich mit. Gebundene
Abgabeanhaenge, Community-Inhalte, Kursmedien und frische Uploads bleiben sonst
erhalten. Final- und Incoming-Objekt
durchlaufen danach unveraendert die verifizierte Loeschpipeline samt Grace
Period; erst dann wird Quota freigegeben. Verifizierte Media-Tombstones aller
drei Terminalzustaende werden nach 30 Tagen erneut hart geloescht, geprueft und
anschliessend aus PostgreSQL entfernt.

## Personenbezogener Export

Der Owner-Workflow unter `/admin/privacy` fuehrt Faelle mit 30-Tage-Frist,
Identitaetspruefung, Freigabe, Legal Holds, Verarbeitung und unveraenderlicher
Timeline. Kritische Aktionen und jeder Download verlangen bei aktiviertem
Passwort-Login das aktuelle Owner-Passwort und verwenden ein persistentes
Fehlversuchslimit. In einem SSO-only-Tenant gilt stattdessen nur eine hoechstens
fuenf Minuten alte, frische OIDC-Owner-Sitzung mit Provider-`auth_time` als
Step-up. Normale Admins, Trainer und Mitglieder erhalten weder Navigation noch
Direktzugriff.

Maschinelle Integrationen koennen Faelle ueber
`GET/POST /api/v1/privacy-requests` und
`GET /api/v1/privacy-requests/{id}` anlegen beziehungsweise lesen. Die
privilegierten Scopes `privacy:read` und `privacy:write` muessen explizit auf
einem von einem weiterhin aktiven Owner erstellten Schluessel liegen; `*`
impliziert sie nicht. Freigabe, Holds, Verarbeitung und Download bleiben dem
Browser-Owner vorbehalten.

```bash
export Q_ACADEMY_ENV_FILE=/etc/q-academy/production.env
docker compose --env-file "$Q_ACADEMY_ENV_FILE" -f compose.production.yml \
  --profile operations run --rm --no-deps tenant-export-ops user-data:export \
  --organization-slug acme \
  --user-email person@acme.de \
  --output /operations/output/acme-person.json
```

Der releasegebundene Exportdienst verwendet die App-Datenbankrolle, ein
read-only Rootfs und ausschliesslich `/operations/output` als persistent
schreibbaren Mount. Pfade ausserhalb dieses Mounts und Symlink-Escapes werden
vor dem Scriptstart abgelehnt. Fuer grosse Konten ist der Speicherbedarf des
vollstaendigen JSON-Payloads vor Produktivfreigabe mit realistischen Daten zu
testen.

Der strukturierte Export mit `schemaVersion: 23` laeuft in einer read-only
Repeatable-read-Transaktion, verwendet eine
Whitelist tenantgebundener Queries und enthaelt Konto samt Tenant-Standard,
Nutzer-Sprachpraeferenz und wirksamer Locale, benannte Datenprofile,
Profilwerte, Formularabgaben, Auth-Aktivitaet ohne Credential-Material,
MFA-Status, sichere Challenge-Zeitmetadaten und Policy-Kontext, OIDC-Identitaet
und sicheren Konfigurationskontext ohne Client-Secret sowie Session-Provenienz,
Gruppen/Zugriff einschliesslich kursbezogener Trainerrechte und Grant-Erteiler,
Lernen einschliesslich Kurs-/Lektionsbezug, gutgeschriebener aktiver Sekunden
und Zeitpunkte ohne internen Heartbeat-Replay-Zaehler, sichere
Medien-/Attachment-Metadaten, Community einschliesslich
aller eigenen veroeffentlichten, wartenden, gehaltenen oder abgelehnten Posts
und Kommentare mit sicherem Publikationsstatus, Inhaltsformat,
Projektionsversion und erneut bereinigtem Rich-Text-Dokument, deren Anhangsmetadaten,
direkte Nutzer-Zugriffsregeln und
die pro Bereich wirksamen Rechte mit ihren passenden Rollen-/Nutzer-/Gruppen-/Bundle-Quelltypen,
  Post- und Kommentarreaktionen, Community-Scorebeitraege ohne Identitaeten
  anderer Mitglieder, Votes, Mentions und rollenbezogen bereinigter
Meldungsfaelle, Events,
Feedback, Gamification einschliesslich sicherer Badge-Metadaten,
Web-/Native-Push-Geraete- und Zustellhistorie ohne Credential-Material,
User-/Assistant-KI-Verlaeufe, sichere Orbit-Identitaets-, Mitgliedschafts-,
Delegations-, Transfer- und Auditprojektionen, aktive Editorpraesenz,
Stockbildauswahlen und relevante Audit- sowie Privacy-Metadaten. Jede
KI-Unterhaltung enthaelt ihre gebundene
`agentVersionId` sowie die unveraenderliche sichere Versionsprojektion aus Name,
Typ, Versionsnummer und Publikationszeitpunkt. Vom Betroffenen erstellte
Agent-Versionen und fuer ihn wirksame User-, Rollen-, Gruppen- oder Bundle-Grants
werden nur als sichere Metadaten ohne fremde Ziel- oder Mitglieder-IDs
ausgegeben. Eigene Aktionsanfragen und deren Ereignisse enthalten nur sichere
Agent-/Kursbezeichnungen, Status, Revisionen, bereinigte Entscheidungsnotizen
und Zeitpunkte, aber keine internen Bindungen, Digests oder Actor-Referenzen.
Bei Meldungen sieht der Reporter seine Falldetails; ein
betroffener Autor erhaelt nur eine Case-Zusammenfassung mit Inhaltsstatus,
Reason-Code, Fallstatus und Entscheidungszeitpunkten sowie eigene
Appeal-Statements und deren Ergebnis. Reporteridentitaeten und -details,
Moderator-/Claimant-IDs, interne Moderationsnotizen, rohe Event-Timelines,
Fingerprints und Assessment-Signale werden nicht an betroffene Autoren
exportiert. Das
Dateninventar unter
`src/lib/privacy/data-inventory.ts` klassifiziert alle 170 Tabellen und wird
gegen den aktuellen Drizzle-Snapshot sowie alle 73 versionierten Migrationen
getestet. Autorenzuordnung und frei konfigurierbare Texte,
Links oder Bildmetadaten gemeinsam genutzter Kurs-Widgets verlangen vor einer
personenbezogenen Offenlegung eine manuelle Pruefung.

Die Mailhistorie im DSAR enthaelt nur Ereignis, Empfaengeradresse, Status,
Versuchszahl, HTTP-Status und Lifecycle-Zeitpunkte. Verschluesselte Payloads,
gerenderte Betreff-/Nachrichtentexte, Gateway-Antwortkoerper und Worker-Claims
werden weder entschluesselt noch exportiert. Bounce-/Complaint-Feedback wird
nur mit Ereignistyp, Bounce-Klasse, bounded Reason-Code und Zeitpunkten
ausgegeben. Sperren enthalten Grund, Anzahl, Lifecycle und geschlossenen
Freigabegrund; Empfaenger-Hash, externe Event-ID, Payload-Hash, Source-Delivery
und freigebender Actor bleiben ausgeschlossen.

Mitglieder-Eigenschaftsauswertungen und ihre Filter werden ausschliesslich aus
den tenantgebundenen Profilwerten berechnet und nicht als eigener Datensatz
gespeichert. Der CSV-Export ist ein fluechtiger, nicht gecachter Download fuer
Administratoren mit `analytics.view` und `members.manage`; eine anschliessende
lokale Aufbewahrung liegt ausserhalb des Systems. Hub-, Ankuendigungs- und
E-Mail-Vorlagen speichern nur explizit freigegebene Variablentokens, niemals
eine aufgeloeste Eigenschaft. Gerenderte E-Mail-Payloads unterliegen der
bestehenden Delivery-Retention und bleiben im DSAR auf sichere Metadaten
beschraenkt. Die zugrunde liegenden `data_profile_values` sind bereits Teil des
Betroffenenexports und werden beim freigegebenen Loeschlauf zusammen mit den
benannten Profilen entfernt.

Custom-Domain-Claims speichern den normalisierten Hostnamen, Status und
Lifecycle-Zeitpunkte sowie ausschliesslich den SHA-256-Hash der zufaelligen
DNS-Challenge. Der einmal ausgegebene TXT-Wert und fremde DNS-Antworten werden
weder persistiert noch protokolliert. Im Betroffenenexport des erstellenden
Owners erscheinen nur bereinigte Claim-Metadaten; der Challenge-Hash bleibt
ausgeschlossen und `created_by_id` wird bei einer freigegebenen
Benutzerloeschung entkoppelt. Widerrufene Claims werden nach 90 Tagen durch den
gebatchten Operational-Cleanup entfernt. Aktive oder verifizierte Claims
bleiben als tenantweite Authentifizierungs- und Routingkonfiguration bestehen;
ihre Create-, Rotate-, Verify-, Fehlversuchs- und Revoke-Ereignisse folgen der
bestehenden Audit-Retention.

Ausgeschlossen sind insbesondere Assessment-Loesungsschluessel, Passwort-,
Session-, Token- und API-Key-Hashes, TOTP-Secrets, Recovery-Hashes,
Challenge-JTI-Hashes und Replay-Counter,
Webhook-Ziel/Secret, verschluesselte Mail-Payloads, Agent-Systemprompts,
manuelle oder extrahierte Agent-Quellen, interne Source-IDs, rohe Grant-Ziele,
interne Aktionsbindungen/-Digests/-Actor-Referenzen, Entwurfs-/Admin-
Konfiguration sowie System-/Tool-KI-Nachrichten und
Tool-/Grounding-Metadaten, verschluesselte Web-/Native-Push-Tokens samt Hashes,
Orbit-Idempotenz-/Request-Fingerprints und Credential-artige Audit-Metadaten.
KI-Zitate werden auf bereinigte Titel, Links und
unbedenkliche Auszuege ohne interne Ziel-IDs reduziert. Die Datei wird exklusiv
neu angelegt, nicht
ueberschrieben und auf Unix mit Modus 0600 versehen. Sie muss auf einem
verschluesselten Datentraeger liegen und nach sicherer Uebergabe gemaess DSAR-
Prozess geloescht werden.

Der Willkommensfluss speichert pro Mitglied ausschliesslich die zuletzt
bestaetigte Konfigurationsversion und den Zeitpunkt. Diese Angaben gehoeren in
einen Betroffenenexport und werden bei einer freigegebenen Benutzerloeschung
zusammen mit dem Konto kaskadierend entfernt. Titel, Begruessungstext und
Video-Link sind mandantenweite Konfiguration und werden nur nach manueller
Pruefung offengelegt, falls sie selbst personenbezogene Inhalte enthalten.

Das ZIP-Paket enthaelt `data.json`, `manifest.json` und jedes zum Betroffenen
gebundene, verfuegbare Media-Asset. Bindungen werden tenantgebunden ueber
Eigentuemer/Uploader sowie Abgabe-, Post- und Kommentaranhaenge aufgeloest.
Jedes fertige Objekt wird gegen Groesse und SHA-256 der unveraenderlichen
Storage-Identitaet geprueft; nicht fertige oder bereits geloeschte Assets werden
mit Status und Ausschlussgrund im Manifest dokumentiert. Storage-Schluessel,
signierte URLs, Scan-Claims und interne Diagnosen verlassen den Server nicht.

Im Owner-Workflow wird das ZIP vor Speicherung mit dem versionierten
Daten-Keyring und fallgebundenen Additional Authenticated Data verschluesselt.
S3-Downloads lesen ausschliesslich die persistierte `VersionId` und den ETag;
lokale Dateien werden write-once mit Modus 0600 veroeffentlicht. Der Fall wird
erst nach erfolgreicher Paketbildung und erneuter Media-Snapshot-Pruefung auf
`completed` gesetzt.

Bis ein chunkweises, streamingfaehiges AEAD-Format eingefuehrt ist, gilt eine
harte Klartext-/ZIP-Grenze von 32 MiB. Strukturierte Daten sind auf 16 MiB,
gebundene Medien auf 12 MiB und die Zahl gebundener Media-Zeilen auf 2.000
begrenzt, damit Manifest und ZIP-Metadaten Platz behalten. Das bestehende
JSON-/Base64-/AES-GCM-Envelope darf wegen seiner kodierungsbedingten Groesse
hoechstens 64 MiB belegen. Ein bytegenauer Plain-Data-JSON-Preflight lehnt
Accessor-, Custom-`toJSON`-, Zirkularitaets- und Uebergroessenfaelle vor der
Gesamtstring-Allokation ab; ZIP-Entry- und Gesamtsummen stehen vor Nutzdatenkopien
fest. Lokale Artefakte werden ueber ein bereits geoeffnetes File-Handle typ- und
groessenvalidiert und nach dem Read per EOF-Probe sowie finalem Dev/Inode/Size-Stat
erneut geprueft. S3 verwendet
`Content-Length` nur als Vorpruefung und zaehlt anschliessend jeden Stream-Chunk
gegen exakt diese Laenge und die harte Obergrenze. `GetObject` und der gesamte
Body-Verbrauch teilen eine Gesamtdeadline von 30 Sekunden; Timeout, Ueberlaenge,
Trunkierung oder ungueltige Chunks brechen den Body best-effort per Abort,
Destroy und Iterator-Return ab.

Nach erfolgreichem Owner-Step-up und Artefaktabgleich, aber vor Datei- oder
S3-Zugriff, greifen persistente PostgreSQL-Limits von sechs Downloads pro Owner
und 30 Downloads pro Tenant in 15 Minuten. Pro Tenant ist nur ein laufender
Read erlaubt; der 15-Minuten-Lease wird mit seinem Reset-Zeitpunkt gefenced
und in `finally` freigegeben. Zusaetzlich erlaubt jeder App-Prozess hoechstens
einen DSAR-Build oder -Read, ohne Warteschlange und mit einer
bundleuebergreifenden Lease-Identitaet auf `globalThis`. Die Prozesslease
verfaellt nicht waehrend der Operation: Builds geben sie in `finally` frei,
Downloads bei Close, Cancel oder nach einer absoluten Zehn-Minuten-Deadline.
Ein Ausfall der persistenten Guard-Abfrage oder erschoepfte Kapazitaet scheitert
vor dem Objektzugriff geschlossen.

Der Mitglieder-Loeschlauf deaktiviert den Account vor der Verarbeitung,
widerruft Credentials und entfernt direkte Profil-, Zugriffs-, Lern-,
Community-, Kommunikations-, Web-/Native-Push-, aktive Editorpraesenz-,
Stockbildauswahl- und KI-Daten. Eigene Community-Threadknoten bleiben nur zur
referenziellen Diskussionsintegritaet erhalten: Plaintext wird auf `[removed]`
gesetzt, das Rich-Text-Dokument verworfen und Format sowie Projektion auf
`plain_text`/v1 normalisiert. E-Mail-Feedback und Empfaengersperren werden
nach Legal-Hold-Pruefung zusammen mit der Mailhistorie entfernt.
Orbit-Identitaetsbindungen und nicht mehr
benoetigte Claims werden entfernt; globale Accounts/Delegationen werden
widerrufen oder pseudonymisiert, soweit geteilte Ownership und Audit-Retention
dies verlangen. Persoenliche Media-Objekte werden
zuerst inklusive Incoming-Objekt und aller S3-Versionen geloescht und danach als
storagefreie Tombstones markiert. Gemeinsam genutzte Kurs-/Branding-Medien
bleiben als dokumentierte Ausnahme erhalten; Nutzerzuordnung und Dateinamen
werden entfernt. Append-only Privacy-, Moderations- und Aktionsnachweise sowie
geteilte publizierte Inhalte bleiben nur an einer nicht direkt identifizierenden
Surrogatidentitaet gebunden. Jede aktive Aufbewahrungssperre blockiert den Lauf;
neue Holds sind ab Verarbeitungsbeginn ausgeschlossen. Backup-Auslauf und alle
Ausnahmecodes werden in der unveraenderlichen Fallhistorie protokolliert.

## Tenant-Offboarding

Technisch vorhanden sind die Zustaende `active`, `suspended` und `offboarding`.
Suspension/Offboarding widerruft Sessions und API-Keys; Login, Recovery,
Einladungen, API, Branding und Queue-Zustellung werden zentral blockiert.

Die physische Primaerdaten-Loeschung ist als kontrollierter Operatorprozess
implementiert. `tenant:erase` verlangt ein exakt typisiertes Policy-Manifest
mit Auftrag, Freigabe, Rechtsgrundlage, nachweislich uebergebenem Export,
Mindestwartefrist, Backup-Auslauf und ausdruecklichen Entscheidungen zu Audit,
Abrechnung, Zertifikaten und Lernnachweisen. Der Preview ist mutationsfrei;
die Ausfuehrung wird bei einem anderen Tenantstatus, aktiven Legal Holds,
nicht abgelaufener Frist, Datenveraenderung oder fehlender exakter
Slug-Bestaetigung abgebrochen.

Vor dem relationalen Cascade werden alle geschuetzten Tenant-Auditketten in ein
neues, Modus-0600-Archiv geschrieben. Jede Zeile ist separat mit AES-256-GCM
verschluesselt und durch Tenant-ID, Tabelle und Sequenz als AAD gebunden;
Datei-SHA-256, zeilenweise HMAC-Kette und Manifest-Signatur verhindern
unbemerkte Aenderung, Auslassung oder Umordnung. `tenant:erase:verify` prueft
Signatur, Kette, Zaehler, Entschluesselbarkeit und Tenant-Bindung, ohne
Plaintext auszugeben.

Anschliessend werden alle Tenant-Medien inklusive Derivaten, Incoming-Objekten
und S3-Versionen/Delete-Markern ueber den verifizierenden Storage-Pfad
entfernt. Verwaiste globale Orbit-Konten werden pseudonymisiert und aktive
Delegationen widerrufen. Erst ein transaktional angelegter
`tenant_erasure_receipt` im Status `erasing` kann per lokaler GUC den
vollstaendigen Offboarding-Cascade autorisieren. Direkte Einzel-Loeschungen der
Append-only-Tabellen bleiben gesperrt. Receipt und `tenant_erasure_events`
liegen ausserhalb des Tenant-FK-Baums. Die Receipt-Evidenzfelder sind
unveraenderlich, nur der enge Status-/Zeitstempel-Lifecycle darf fortschreiten;
die Ereignisse sind strikt append-only. Beide enthalten nur Policy, Hashes,
Zaehler und Zeitpunkte als Loeschbeleg.

Ist der dokumentierte Backup-Auslauf noch nicht erreicht, endet der Lauf mit
`backup_retention_pending`. Der Receipt wechselt erst nach Fristablauf und
separatem Backup-Evidenz-SHA-256 auf `completed`. `offboarding` allein ist daher
weiterhin kein Loeschnachweis; erforderlich sind zusaetzlich Kundenexport,
Policy-Freigabe, geprueftes Archiv, Receipt, Providerwiderruf und
Backup-Abschluss. Der konkrete rechtliche Inhalt dieser Entscheidungen bleibt
Aufgabe des Betreibers und seiner Rechtsberatung.

`privacy_request_events`, `community_moderation_events`,
`ai_agent_action_requests`, `ai_agent_action_events`,
`ai_agent_membership_provenance` und `event_lifecycle_history` blockieren
direkte Mutation und Loeschung. Nur der Receipt-gebundene Gesamt-Cascade darf
die zuvor verschluesselt archivierten Tenant-Zeilen entfernen;
Trigger-Deaktivierung oder Ad-hoc-SQL ist kein regulaerer Pfad. Publizierte
`ai_agent_versions`, Quellen, Grants und Aktionskonfigurationen werden dabei
als Tenantdaten kaskadiert; die Archivkopie der freigaberelevanten Evidenz
richtet sich nach der dokumentierten Retention-Entscheidung.

Globale Orbit-Workspaces, Instanzen, Transfer-Items und Audit-Ereignisse sind
geteilte Control-Plane-Ressourcen und koennen nicht durch das Loeschen eines
einzelnen Tenant-Benutzers kaskadierend entfernt werden. Vor der Entfernung
eines letzten Workspace-Owners muessen Ownership und aktive Delegationen
uebertragen werden. Direkte Tenant-Identitaeten werden geloescht, Claims
widerrufen und personenbezogene Account-/Transferattribution nach Legal-Hold-
und Retention-Pruefung entfernt oder pseudonymisiert; die minimale Transfer-
und Auditintegritaet bleibt nur mit dokumentierter Rechts-/Vertragsentscheidung.

Editor-Praesenz enthaelt keine Entwurfsinhalte und laeuft nach 75 Sekunden aus;
der Scheduler loescht abgelaufene Zeilen zusaetzlich stapelweise. Ein DSAR gibt
hoechstens die bei der Snapshot-Erstellung noch aktive Kurs-/Seitenposition aus,
eine Betroffenenloeschung entfernt sie sofort und Legal Holds verlaengern die TTL
nicht. Stockbildauswahlen speichern keinen Suchbegriff und keinen
Provider-Schluessel. Sie halten nur Anbieter-ID, Attribution, freigegebene
HTTPS-Quellen sowie Auswahl-/Trackingzeitpunkte und werden nach 30 Tagen
geloescht. Wird ein Bild verwendet, bleibt die notwendige Attribution als
geteilte Kursmetadaten erhalten; die persoenliche Auswahlzuordnung wird nach
Shared-Resource-Pruefung entfernt oder pseudonymisiert.
