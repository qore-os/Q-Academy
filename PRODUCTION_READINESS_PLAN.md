# Q-Academy Production-Readiness-Plan

Stand: 2026-07-15

## Zweck

Dieser Plan fuehrt Q-Academy vom umfangreichen lokalen Entwicklungsstand zu einem belastbaren B2B-Pilot und danach zu einem allgemein verfuegbaren SaaS-Produkt (GA).

Der aktuelle lokale Dev-Server und die Demo-Daten duerfen nicht fuer reale Kundendaten verwendet oder oeffentlich erreichbar gemacht werden.

## Ausgangslage

Im Repository nachweisbar vorhanden:

- [x] Mandantenfaehiges LMS mit Admin- und Mitgliederbereich
- [x] Rollen, Sessions, Einladungen, Passwort-Reset, TOTP-MFA fuer Owner,
  Admins und Trainer sowie tenantgebundener OpenID-Connect-Login einschliesslich
  SSO-only-Tenants
- [x] Kurseditor, redigierter Veroeffentlichungs-Diff, Versionierung,
  Kurs-Link-Module, Content-Drip, Lektionsfreigabe-Abonnements, eigenstaendige
  Pruefungsmodule, Datenformulare und Zertifikate; sichtbare Editorpraesenz,
  Page-/Block-CAS, Seitenoperationen, Styles, gepruefte Stockbilder,
  29 typisierte Inhaltsbloecke, ein hostgebundener Integrationskatalog fuer
  YouTube, Vimeo, Loom, Microsoft Forms und Google Forms mit lokalisierter
  Click-to-load-Freigabe im Mitgliederbereich sowie atomare Sektion-/
  Lektionskopien mit neu zugeordneten Medien-, Formular-, Agent- und
  Pruefungsreferenzen
- [x] Typisierte Community-Foren mit gescannten Medienanhaengen,
  feingranularen Bereichsrechten, empfaengerlokalisierten Mention-/
  Moderationsbenachrichtigungen, Badge-Gruppen, Events mit Farbpaletten, Hubs
  mit Kategorien, sicheren Embeds und isoliertem Custom Code, Analytics,
  Dark/System-Theme und PWA
- [x] Versioniertes Willkommens-Popup, Feedback-Center und E-Mail-Center mit
  parallelen tenantindividuellen Vorlagensaetzen fuer DE/EN/IT/ES/FR,
  Preview/Testversand, REST/OpenAPI, Empfaenger-Locale-Snapshot sowie
  signiertem Bounce-/Complaint-Rueckkanal und Empfaengersperren
- [x] Q-Coach, versioniertes Agent Studio mit drei Agenttypen, Einbettungen in
  Lektionen und Hubs, serverseitiger Dokumentextraktion, ausgewaehlten
  sichtbaren Profileigenschaften, Zusatz-Prompts und freigabepflichtigen Kurs-,
  Gruppen- und Bundle-Aktionen,
  KI-Kurserstellung mit lokalem Fallback sowie ein transkriptbasierter lokaler
  Content-Wizard
- [x] REST-API mit API-Keys, Scopes, Idempotenz, Audit-Log, Webhooks und OpenAPI
- [x] Revisionsgebundene Tenant-Vertraege mit DB-erzwungenen Seat-, Kurs- und
  Speicherlimits, gemeinsamen KI-Credits und Feature-Entitlements; verifizierte
  Custom-Domain-Claims sowie transaktionale Owner-Uebergabe
- [x] Custom-Rollen und fail-closed Bereichsrechte sowie Kernnavigation/Auth/
  Systemmails und typisierte Fachaktionskataloge in DE, EN, IT, ES und FR
- [x] Providerneutrale Commerce-Domaene, Digistore24-/Ablefy-/Copecart-Adapter,
  versionierte Zapier-CLI-19-/Make-Apps-Editor-Pakete, n8n und konfigurierbarer
  Supportlauncher
- [x] Orbit-Control-Plane mit Workspaces, Instanzen, Permission-Sets,
  Partnerdelegation, Slots/Entitlements, Audit, versionierter Abrechnung und
  Kursinhaltstransfer
- [x] Capacitor-8-Container fuer Android/iOS/iPad, Deep Links sowie
  sitzungsgebundene APNs-/FCM-Push-Queue
- [x] 170 PostgreSQL-Tabellen, 74 versionierte Migrationen bis `0073` und
  DSAR-Exportschema 23 sowie realistische Demo-Daten
- [x] Automatisierte Build-, Lint-, Typecheck-, Integrations-, Accessibility-,
  Cross-Browser- und responsive E2E-Pipelines sind vorhanden; der lokale Stand
  vom 2026-07-15 wurde vollstaendig validiert. Externe Release-Gates und die
  Abnahme jedes kuenftigen konkreten Stands bleiben separat erforderlich

Noch nicht vollstaendig vorhanden ist vor allem die betriebliche, rechtliche und
organisatorische Schicht fuer echte Kunden. Lokal implementiert sind auch
FFmpeg-Derivate/Thumbnails, exakt versionsgebundene S3-Verarbeitung,
bis zu acht immutable gebundene Audio-Mischspuren mit Quelltrim, Offset und
Lautstaerke, digestgebundene STT-Jobs, Authoring-Recorder, Stockbilder, native
Container/Push, Commerce, n8n/Support und Orbit. Sie sind jedoch erst nach
Abnahme der konkreten S3-, STT-, Apple-, Google-, Commerce-, Mail-, OIDC- und
Supportprovider produktiv nutzbar. Ebenso offen bleiben Rootserver-/Staging-
Lasttests, produktives DNS/TLS, Store-Reviews, muttersprachliche Fach-, Rechts-
und UX-Abnahme, formale Accessibility-Pruefung, rechtliche Freigaben,
Datenschutzfolgenabschaetzung und ein unabhaengiger Penetrationstest. Der lokale
Funktionsstand ist deshalb keine Produktions- oder Kundenfreigabe.

## Statuslegende

- `[ ]` Offen
- `[~]` In Arbeit
- `[x]` Abgenommen
- `P0` Pflicht vor dem ersten Pilot mit echten Kundendaten
- `P1` Pflicht vor GA; bei einem Pilot nur mit dokumentierter Kompensation
- `P2` Ausbau nach GA oder entsprechend der Vertriebsanforderungen

## Technischer Zwischenstand

Lokal implementiert und automatisiert verifiziert sind insbesondere PR-01, die
Container-/CI-Basis aus PR-02, versionierte Migrationen, Least-Privilege-Rollen,
Backup-/Restore-Automation, Tenant-Provisionierung und -Sperrung, persistente
Mail-/Webhook-Worker, signiertes Mail-Zustellfeedback mit Suppressions,
verteilte Limits, Provider-Circuit-Breaker, operative Retention sowie ein
tenantgebundener DSAR-Export und ein verifizierbarer Audit-Export. Hinzu kommen
ein tenantgebundenes Media-Asset-
Modell, private S3-Transfers, atomare Quota, ClamAV-Scan, Quarantaene,
versionierte Harddelete-Pruefung, begrenzte OOXML-/MP4-Containerpruefung,
getrennte Scan-/Maintenance-Budgets sowie ein Medienrunner mit eigener
DB-Rolle, eigenem DB-Netz, eigenem Job-Secret und getrennten S3-Credentials.
Private Kursmedien koennen inzwischen direkt im Editor hochgeladen, geprueft,
tenantgebunden versioniert und nur an berechtigte Kursteilnehmende ausgeliefert
werden; ungebundene Kursuploads laufen nach 24 Stunden ab. Community-Posts und
Community-Kommentare binden bis zu sechs beziehungsweise drei gescannte Bild-,
Audio-, Video- oder Dokumentanhaenge ueber eine globale, unveraenderliche Registry.
Loeschungen erzeugen Medien-Tombstones, ungebundene Community-Uploads laufen
nach 24 Stunden ab. Offene oder eingeschraenkte Bereiche vergeben `view`-,
`post`- und `comment`-Rechte an Rollen, Personen, Gruppen und Bundles; Feed,
Suche, Dashboard, Mentions, Reports, Reaktionen, Votes und REST-API setzen die
effektiven Rechte serverseitig durch. Gepruefte MP4-, MOV-, M4A-, WAV-, MP3-,
Ogg- und WebM-Dauern werden ressourcenbegrenzt persistiert. Deduplizierte
FFmpeg-Lease-Jobs erzeugen Thumbnails und H.264/AAC-Derivate; der isolierte
S3-Runner bindet Quelle und Ergebnis an exakte VersionId, ETag, Groesse,
MIME-Typ und SHA-256. STT-Jobs erzeugen digestgebundenes, validiertes WebVTT.
Audio- und Videobloecke nehmen Mikrofon, Kamera plus Mikrofon oder Bildschirm
auf und uebergeben bestaetigte Vorschauen ausschliesslich an den vorhandenen
Upload-/Scan-Workflow. Mehrere nicht ueberlappende Schnittbereiche,
komprimierte effektive Wiedergabezeit, Pflichtwiedergabe, Vorspulregeln und
versionierte Video-Endkarten werden im publizierten Lernstand erzwungen.
Der lokale Produktstand umfasst ausserdem Button-/Link- und Galerie-Bloecke,
Editorpraesenz, Page-/Block-CAS, Seitenoperationen, validierte Styles,
attributionserhaltende Stockbilder, WebVTT-Untertitel und zeitcodierte Suche,
Autor-/Info-/Bild-Link-Karten in Kursuebersichten mit gescannten privaten
Bild-Assets oder sicheren oeffentlichen Quellen, typisierte Community-Foren
mit Threads, Post- und Kommentarreaktionen, Votes und Mentions, einem
personalisierten Feed, Follows, Boosts, getrennten Community-Punkten,
konfigurierbaren Levels, Badge-Gruppen, Freigabepolicies, automatischer Zurueckhaltung,
versionierten Moderationsfaellen und Einspruechen sowie
sichtbarkeitsgesteuerte Datenprofile, Multi-Profile und in Lektionen sowie Hubs
eingebettete Datenformulare. Der KI-Kursfallback erzeugt alle fuenf unterstuetzten
bewerteten Aufgabentypen; ein lokaler Wizard leitet Inhalte aus vorhandenen
Transkripten ab. Zusaetzlich sind ein versioniertes Willkommens-Popup,
vollstaendiges Content-Drip mit abonnierbaren Lektionsfreigaben, redigierte
Kurs-Diffs und Versionshistorie, eigenstaendige Pruefungsmodule,
tenantweite Transkript-Suchausschluesse, Kurs-Link-Module mit Einrueckung,
Feedback-Center, locale-spezifisches E-Mail-Center, Hub-Kategorien/Embeds und
netzloses HTML-/CSS-/JavaScript-Widget im Opaque-Origin-Iframe,
Pop-up-Presets mit typisiertem Rich-Text-/Callout-/Trenner-/CTA-Blockeditor,
Event-Farbpaletten, Custom-Rollen, Dark/System-Theme, ownergebundener
Header-/Footer-Custom-Code mit HTTPS-Allowlist sowie fuenfsprachige
Kernbereiche und Fachaktionscodes lokal umgesetzt.
Pruefungsversuche frieren die veroeffentlichte Kursversion, Definition,
Fragenauswahl und Praesentation ein. Zeitlimits, revisioniertes Autosave,
serverseitige Finalisierung, getrennte Ergebnis-/Einsichtsfreigaben und
kurs- beziehungsweise akademieweite Inhaltsbindungen werden persistent und
mandantengebunden durchgesetzt.

Das lokale Agent Studio stellt Lerncoach, Wissensassistent und
Formularassistent als versionierte Drafts bereit. Publish und Rollback erzeugen
unveraenderliche Versionen; strukturierte Quellen umfassen Kursversionen,
manuelle Inhalte, freigegebene `ready`-Medien, begrenzt extrahierte Dokumente
und SSRF-gehaertete Web-Snapshots. Ausgewaehlte sichtbare Profilfelder und
versionierte Zusatz-Prompts personalisieren den Kontext. Rollen-, Nutzer-, Gruppen-
und Bundle-Regeln werden serverseitig durchgesetzt. Eine ausgewaehlte
Mitgliedsvorschau prueft Draft, Quellen und Zielgruppe ohne persistierten Chat
oder Kundencredit. Veroeffentlichte Agenten koennen als Inhaltsblock in
Lektionen und als Widget in Hubs eingebettet werden. Ein tenantweiter
Kill-Switch, ein gemeinsames vertragsbegrenztes Monatscreditmodell fuer Agent-
Chats und KI-Kurserstellung, ein optionales Stundenlimit je Mitglied,
inhaltsfreie aggregierte Nutzungs-Insights, Provider-Timeout und ein
PostgreSQL-geteilter Circuit Breaker sowie freigabepflichtige, exakt
provenienzgebundene Kurs-, Gruppen- und Bundle-Aktionen sind ebenfalls lokal
vorhanden.

Commerce mit Digistore24/Ablefy/Copecart, Zapier/Make/n8n und der
Supportlauncher sind lokal implementiert. Orbit verwaltet globale Accounts,
Workspaces, Permission-Sets, Instanzen, Partnerdelegationen, Slots,
Entitlements, Audit und idempotente Kursinhaltstransfers. Capacitor-8-Container
fuer Android, iPhone und iPad integrieren Deep Links sowie eine
sitzungsgebundene APNs-/FCM-Push-Queue. Diese Workflows benoetigen weiterhin
reale Provider-, Geraete-, Store-, Last- und Betriebsabnahmen.

Die Produktions-Compose-Konfiguration enthaelt ausserdem frischebasierte
Heartbeats fuer Scheduler, Medienworker und Medien-Maintenance sowie einen
authentifizierten Prometheus-Endpunkt mit Readiness und aggregierten
Queue-Werten fuer Tiefe, Fehler und Alter. Das optionale Monitoring-Profil
scrapt App, Medienrunner und Node Exporter; Alarmregeln decken Runtime-Ausfall,
Queue-Stau einschliesslich Web-/Native-Push, Worker-Heartbeats sowie fehlende,
fehlgeschlagene oder veraltete Backups ab. Konfiguration, PromQL und Contracts
sind lokal getestet; ein realer
Docker-/Rootserver-Lauf, externe Uptime-Pruefungen, Benachrichtigungsempfaenger
und Feueralarmtests bleiben offen.

Der lokale OIDC-Core umfasst Discovery, Authorization Code mit PKCE S256,
State/Nonce, verschluesselte Transaktionen und Client-Secrets, verifizierte
E-Mail-Claims, optionale domainbegrenzte Member-Provisionierung, SSO-only-
Einladungsaktivierung, explizite Owner-Verknuepfung, frischen Owner-Step-up,
ownergebundene `authentication:read`-/`authentication:write`-Scopes sowie
OIDC-Session-Provenienz und -Widerruf. Ein echter Kundenbetrieb benoetigt pro
Tenant weiterhin eine IdP-Clientregistrierung und abgenommene kanonische
DNS-/TLS-Hosts. RP-initiated beziehungsweise Backchannel Logout und SCIM sind
optionale Enterprise-Erweiterungen, nicht Teil des lokalen Core-Workflows.

Eine eigene Login-Domain besitzt lokal einen owner- und entitlementgebundenen
Create/Rotate/Verify/Revoke-Lifecycle. Der einmalige TXT-Wert wird nur gehasht
gespeichert; Host- und Tenant-Eindeutigkeit, Ablauf, Revision und Audit werden
erzwungen. Erst ein verifizierter Claim beeinflusst Login, Branding und OIDC.
Das ersetzt weder das reale Setzen des DNS-Eintrags noch die produktive Caddy-/
TLS-Abnahme.

Diese lokalen Produktfunktionen ersetzen keine formale Betriebsabnahme. Der
implementierte exakte S3-/FFmpeg-/STT-Workflow ist kein Nachweis fuer den
tatsaechlichen Rootserver-/Bucketbetrieb, ein bestimmtes Modell oder die
Datenschutzfreigabe eines Providers. Gate B bleibt offen,
weil Rootserver-,
IdP-/Mail-/Storage-/Malware-Scan-Provider-, Restore-, Monitoring-, Datenschutz-,
Legal- und externe Security-Abnahmen noch nicht praktisch abgeschlossen sind.

## Release-Gates

### Gate A: Interne Demo

Status: `[x]`

- [x] Anwendung startet lokal mit PostgreSQL
- [x] Demo-Zugaenge und Demo-Inhalte funktionieren
- [x] Kernfunktionen sind automatisiert getestet
- [x] Keine echten Kundendaten werden verwendet

### Gate B: Kontrollierter B2B-Pilot

Status: `[ ]`

Ein Pilot darf erst starten, wenn alle P0-Punkte abgenommen sind. Billing kann fuer Pilotkunden vertraglich und extern erfolgen. Externe KI bleibt deaktiviert, bis Provider, Region, Vertrag und Datenschutzhinweise freigegeben sind.

### Gate C: General Availability

Status: `[ ]`

GA darf erst starten, wenn alle P0- und P1-Punkte abgenommen, ein externer Sicherheitstest abgeschlossen und die Betriebsprozesse praktisch erprobt wurden.

## Offene Grundsatzentscheidungen

| ID | Entscheidung | Faellig vor | Status |
| --- | --- | --- | --- |
| DEC-01 | Hosting-Plattform und Betriebsmodell: einzelner Rootserver mit Docker Compose und Caddy | PR-02 | [x] |
| DEC-02 | Rootserver-Region, PostgreSQL-Betrieb und spaetere Managed-Option | PR-03 | [~] |
| DEC-03 | Vorlaeufig RPO 24 h, Backup 30 Tage und monatlicher Restore; RTO praktisch messen | PR-03 | [~] |
| DEC-04 | Transaktionsmail-Provider und Versanddomain | PR-05 | [ ] |
| DEC-05 | Job-System: PostgreSQL-Outbox mit Lease-basiertem internem Worker | PR-05 | [x] |
| DEC-06 | Externer KI-Provider, Datenregion, Vertrag, Retention und Budget | PR-07/PR-10 | [ ] |
| DEC-07 | Pilot-Abrechnung manuell oder Self-Service-Billing | PR-13 | [ ] |
| DEC-08 | Medien und Abgaben nur als externe Links oder eigener privater Dateispeicher | PR-13 | [x] Privater S3-kompatibler Speicher |
| DEC-09 | Custom Domains im Pilot oder erst nach GA | PR-04 | [~] Lokaler verifizierter Claim-Lifecycle vorhanden; Einsatzzeitpunkt, DNS/TLS und Betrieb bleiben zu entscheiden |
| DEC-10 | MFA-/SSO-Anforderung fuer Owner, Admins und Enterprise-Kunden | PR-12 | [~] TOTP-MFA und OIDC-Core lokal umgesetzt; optionale SAML-Anforderung und reale IdP-Abnahme offen |

## Arbeitspakete

### PR-01: Produktionskonfiguration und Demo-Sicherheit

Prioritaet: `P0`  
Verantwortung: Backend / DevOps  
Abhaengigkeit: DEC-01

Aufgaben:

- [x] Zentrale, typisierte Environment-Validierung beim Prozessstart einfuehren
- [x] In Produktion `DATABASE_URL`, `NEXT_PUBLIC_APP_URL`, `API_ALLOWED_ORIGIN`,
  `SESSION_SECRET`, `AUTH_RATE_LIMIT_SECRET`, `PRIVACY_SUBJECT_HMAC_SECRET`,
  `EXAM_SELECTION_SECRET`, `DATA_ENCRYPTION_KEY`, `WEBHOOK_ENCRYPTION_KEY`,
  `MFA_RECOVERY_PEPPER`, `DATA_ENCRYPTION_KEY_ID`,
  `WEBHOOK_ENCRYPTION_KEY_ID`, `MFA_RECOVERY_PEPPER_ID`, `CRON_SECRET` und
  `METRICS_SECRET` zwingend verlangen
- [x] Lokale URLs, HTTP, bekannte Placeholder und Development-Secrets in Produktion ablehnen
- [x] Produktion ohne konfigurierte Mailzustellung als `not ready` melden
- [x] Demo-Login, bekannte Demo-Passwoerter und Demo-API-Key in Produktion technisch ausschliessen
- [x] `db:seed` mit Produktionssperre, expliziter Bestaetigung und Datenbank-Allowlist absichern
- [x] Seed-Script gegen eine Datenbank mit Produktionskennzeichnung kategorisch abbrechen lassen
- [x] Readiness um Schema-Version, kritische Konfiguration und die in App sowie
  Medienrunner injizierte unveraenderliche Release-ID erweitern
- [x] Negative Tests fuer jede unsichere Produktionskonfiguration ergaenzen

Abnahme:

- [x] Eine Produktion mit fehlender oder unsicherer Konfiguration startet nicht
- [x] `npm run db:seed` kann eine Produktionsdatenbank auch bei Fehlbedienung nicht veraendern
- [x] Readiness ist nur bei verwendbarer DB, aktuellem Schema und vollstaendiger Pflichtkonfiguration gruen

### PR-02: Reproduzierbares Deployment und CI/CD

Prioritaet: `P0`  
Verantwortung: DevOps / Engineering  
Abhaengigkeit: DEC-01

Aufgaben:

- [x] Reproduzierbares Produktionsartefakt definieren, bevorzugt als gehaertetes Container-Image
- [x] Non-root Runtime, feste Node-Version und minimalen Runtime-Inhalt konfigurieren
- [ ] Getrennte Umgebungen fuer Development, Staging und Production anlegen
- [x] CI fuer `npm ci`, Typecheck, Lint, OpenAPI-Contract, Migrationstest, E2E, Build und Dependency-Audit einrichten
- [x] Deployment nur aus unveraenderlichen, versionierten Artefakten erlauben und
  beide Runtime-Readiness-Antworten exakt gegen den angeforderten Zieltag pruefen
- [x] Exakte App-/Migrator-/Key-Rotation-/Tenant-Ops-/Medienrunner-/Medien-
  Preflight-Targets in CI bauen und testen; das Produktions-App-Image wird per
  Browser-Smoke hinter einem lokalen HTTPS/TLS-Proxy vor und nach dem Lauf an
  dieselbe Image-ID gebunden, der Medienrunner ueber seinen authentifizierten
  internen Endpunkt geprueft
- [x] CycloneDX-SBOMs und vollstaendige Scan-Evidence erzeugen, reparierbare
  hohe/kritische Funde blockieren und genau die getesteten Image-IDs als
  Release-Artefakt verpacken
- [~] Die getesteten Image-IDs nach GHCR publizieren und das Digest-Manifest
  attestieren; der Workflow ist vorhanden, erster geschuetzter Main-Lauf und
  Rootserver-Verifikation bleiben extern abzunehmen
- [x] Migration als kontrollierten Release-Schritt vor dem App-Rollout ausfuehren
- [x] Gemeinsamen App-/Medienrunner-Rollback ohne erneuten Build als explizit
  bestaetigten, gesperrten und readiness-geprueften Operationspfad dokumentieren
  und lokal testen
- [ ] Branch-Schutz und verpflichtende CI-Checks aktivieren
- [~] Produktionsdomain, TLS, HSTS und Proxy-Header-Konfiguration abnehmen

Abnahme:

- [ ] Ein Commit laesst sich ohne lokale Handarbeit nach Staging ausrollen
- [ ] Fehlgeschlagene Checks verhindern ein Deployment
- [ ] Die vorherige App-/Medienrunner-Version kann innerhalb des vereinbarten
  RTO wiederhergestellt werden

### PR-03: PostgreSQL, Backup und Disaster Recovery

Prioritaet: `P0`  
Verantwortung: DevOps / Database  
Abhaengigkeit: DEC-02, DEC-03

Aufgaben:

- [ ] Managed PostgreSQL in der freigegebenen Region bereitstellen
- [~] TLS-Verbindung, getrennte DB-Rollen und Least-Privilege-Zugang konfigurieren
- [x] Connection Pooling und Poolgroessen fuer die maximale Replica-Zahl dimensionieren
- [~] Restore-verifizierten systemd-Backup-Service samt persistentem taeglichem
  Timer mitliefern; Aktivierung auf dem echten Rootserver und PITR bleiben offen
- [~] Backup-Aufbewahrung gemaess Daten- und Vertragsanforderungen definieren
- [x] Verschluesselung at rest und in transit dokumentieren
- [x] Restore in eine isolierte Umgebung automatisieren
- [ ] Vollstaendigen Restore-Test mit anschliessendem App-Smoke-Test durchfuehren
- [~] RPO, RTO, Verantwortlichkeiten und Eskalationsweg im Runbook festhalten
- [x] Migrationstest um den automatischen Upgradepfad von der unmittelbar vorherigen Release-Migration auf den aktuellen Stand erweitern

Abnahme:

- [ ] Ein dokumentierter Restore wurde erfolgreich ausgefuehrt und zeitlich gemessen
- [ ] RPO und RTO werden praktisch eingehalten
- [ ] Backup- und Restore-Alarme werden getestet

### PR-04: Sicheres Tenant-Provisioning und Kundenlebenszyklus

Prioritaet: `P0`  
Verantwortung: Backend / Product Operations  
Abhaengigkeit: DEC-09

Aufgaben:

- [x] Idempotenten internen Provisionierungsprozess fuer Organisation und ersten Owner bauen
- [x] Slug und Owner-E-Mail transaktional validieren; eigene Hostnamen nur ueber
  den nachgelagerten Claim-Workflow zulassen
- [x] Sichere Owner-Einladung statt initialem Standardpasswort verwenden
- [x] Standard-Branding, Plattformsettings und initialen KI-Agenten ohne Demo-Inhalte anlegen
- [x] Provisionierung vollstaendig auditieren
- [x] Owner-Uebergabe mit Step-up, atomarem Rollenwechsel, Audit und Session-Widerruf sowie Schutz vor dem Entfernen des letzten Owners implementieren
- [x] Organisationen sperren, reaktivieren und kontrolliert offboarden koennen
- [x] Custom Domains durch einmalige, ablaufende DNS-TXT-Challenge mit
  Create/Rotate/Verify/Revoke, Revision, Audit und globaler Host-Eindeutigkeit
  pruefen; nur verifizierte Claims fuer Runtime-Branding und OIDC verwenden
- [ ] Produktive OIDC-Clients mit der exakten kanonischen Callback-URL je Tenant
  beim jeweiligen Identity Provider registrieren und abnehmen
- [x] Tenant-Limits, Vertragsstatus, Entitlements, Revision und aktuelle Auslastung als serverseitiges Datenmodell samt Operations-CLI vorbereiten
- [x] Cross-Tenant-, Parallel- und Wiederholungs-Tests ergaenzen

Abnahme:

- [x] Ein neuer Pilotkunde kann ohne direkten SQL-Zugriff angelegt werden
- [x] Ein abgebrochener oder wiederholter Provisionierungslauf erzeugt keine Teilmandanten
- [x] Ein Tenant kann keinen fremden Hostnamen oder fremde Daten beanspruchen

### PR-05: Durable E-Mail-Zustellung

Prioritaet: `P0`  
Verantwortung: Backend / DevOps  
Abhaengigkeit: DEC-04, DEC-05

Aufgaben:

- [ ] Transaktionsmail-Provider mit SPF, DKIM und DMARC einrichten
- [x] Persistente Outbox fuer Einladungen, Passwort-Reset und Systemmails einfuehren
- [x] Token-Erstellung und Outbox-Eintrag in derselben Transaktion speichern
- [x] Worker mit Lease, Retry, Backoff, Dead-Letter-Status und Stale-Job-Recovery bauen
- [x] Idempotente Provider-Requests und Zustell-IDs verwenden
- [x] Versandstatus, Fehler und letzten Versuch fuer Admins sichtbar machen
- [x] HMAC-signierte, replay-sichere Bounce- und Complaint-Webhooks mit
  tenantgebundener Suppression, fail-closed Workerpruefung, Adminfreigabe,
  REST/OpenAPI, Retention und Audit verarbeiten
- [x] Tenant-gebrandete Vorlagensaetze fuer DE/EN/IT/ES/FR erstellen
- [x] Tenantweite Plaintext-Vorlagen, sichere Vorschau, Testsendung und
  kontrollierten manuellen Retry fuer inhaltsbasierte Mails bereitstellen
- [x] Keine Tokens oder vollstaendigen Links in Logs, Fehlertracking oder Analytics schreiben
- [x] CSV-Import so umbauen, dass er Mails nur einreiht und nicht seriell versendet

Abnahme:

- [x] Einladung und Passwort-Reset funktionieren nach Prozessneustart weiter
- [x] Provider-Ausfaelle fuehren zu Retries und sichtbarem Fehlerstatus
- [~] Lokale Worker-Claims und Delivery-IDs sind crash-sicher und idempotent;
  der reale Gateway-Provider muss denselben Idempotency-Key ueber Neustarts
  praktisch nachweisen

### PR-06: Webhook-Worker und SSRF-Hardening

Prioritaet: `P0` fuer Pilot-Sicherheit, ansonsten Webhooks im Pilot deaktivieren  
Verantwortung: Backend / Security  
Abhaengigkeit: DEC-05

Aufgaben:

- [x] Webhook-Claims um Lease, Claim-Zeitpunkt und automatische Recovery erweitern
- [x] Geplanten Worker mit begrenzter Parallelitaet und Laufzeit einrichten
- [x] DNS-Rebinding zwischen Zielpruefung und Verbindung verhindern
- [ ] Ausgehenden Traffic ueber Egress-Policy oder kontrollierten Proxy begrenzen
- [x] Link-local, private, loopback, metadata und nicht freigegebene Ports blockieren
- [x] DNS-Aufloesung und tatsaechlich verbundene Ziel-IP konsistent pruefen
- [x] Delivery-Limits pro Tenant und globale Backpressure einfuehren
- [x] Tenantgebundene Dead-Letter-Ansicht, berechtigungsgeprueftes Replay,
  Prometheus-Alarmierung und unveraenderliche sanitisierte Versuchshistorie bereitstellen
- [x] Tests fuer DNS-Rebinding, Worker-Crash, Timeout und Parallel-Claims ergaenzen

Abnahme:

- [x] Kein Webhook kann interne oder Cloud-Metadata-Adressen erreichen
- [x] Ein Worker-Abbruch laesst keine Delivery dauerhaft in `processing`
- [x] Ein langsamer Tenant blockiert nicht alle anderen Tenants

### PR-07: Verteilte Rate-Limits und KI-Kostenkontrolle

Prioritaet: `P0` bei externer KI, sonst `P1`  
Verantwortung: Backend / DevOps  
Abhaengigkeit: DEC-06

Aufgaben:

- [x] Prozesslokales REST-API-Rate-Limit durch PostgreSQL oder Redis ersetzen
- [x] Limits pro Tenant, API-Key, Benutzer, Route und globalem Schutzbudget definieren
- [x] KI-Agent-Chats mit tenantweitem Kill-Switch, Monatscredits und optionalem
  Stundenlimit je Mitglied absichern
- [~] Q-Coach mit Concurrent-Limit und Provider-Budget absichern
- [x] KI-Kurserstellung und Agent-Chats in ein gemeinsames, vertragsbegrenztes Monats-Creditmodell integrieren
- [x] Provider-Timeout und PostgreSQL-geteilten, geleasten Circuit Breaker einrichten; KI faellt ohne unkontrollierte Retries auf den lokalen Lernpfad zurueck
- [x] Pro Tenant konfigurierbare KI-Freigabe und Monatscreditgrenze anbieten
- [x] Aggregierte Agent-Nutzung und Tokenverbrauch ohne Prompt- oder
  Antwortinhalt auswerten
- [x] Versionierte Kurszugriffsaktionen nur ueber explizite Adminfreigabe,
  optimistische Revision und atomare Exactly-once-Ausfuehrung zulassen
- [x] Aktionsanfragen und Entscheidungen append-only auditieren sowie ueber
  REST und Webhook-Trigger bereitstellen
- [ ] Gateway- und App-Limits gemeinsam unter Last testen

Abnahme:

- [x] Mehrere App-Replikas teilen dieselben Limits
- [x] Parallelaufrufe koennen kein Budgetlimit umgehen
- [x] Ein Provider-Ausfall beeintraechtigt keine nicht-KI-basierten LMS-Funktionen

### PR-08: Secrets, Verschluesselung und Key-Rotation

Prioritaet: `P0`  
Verantwortung: Security / DevOps / Backend

Aufgaben:

- [ ] Secrets ausschliesslich ueber einen Secret Manager bereitstellen
- [x] Mindestentropie und bekannte Placeholder beim Start ablehnen
- [x] Separate Schluessel fuer Sessions, Rate-Limit-HMAC, Daten und Webhooks verwenden
- [x] Verschluesselte Nutzlasten um Key-ID und Version erweitern
- [x] Keyring mit aktuellem Schreibschluessel und alten Leseschluesseln implementieren
- [x] Online-Rotation fuer Mail-Outbox, Webhook-Secrets und verschluesselte Idempotency-Antworten testen
- [x] Rotations-, Verlust- und Incident-Runbook dokumentieren
- [x] Redigiertes Secret-Scanning fuer bekannte Provider-Credentials in CI und
  Arbeitsbaum sowie fuer alle erreichbaren Blobs, Commits und Tags einer
  vollstaendigen, nicht flachen Git-Historie integriert; fehlende, beschaedigte,
  unvollstaendige oder unbounded Objekte blockieren den Scan
- [x] Logs und Fehlerberichte auf Token, Prompt, E-Mail und Secret-Leaks pruefen

Abnahme:

- [~] Daten- und Webhook-Schluessel koennen online rotiert werden; Session-, HMAC- und externe Secret-Manager-Rotation ist noch betrieblich abzunehmen
- [x] Unsichere oder wiederverwendete Secrets verhindern den Produktionsstart
- [x] CI erkennt versehentlich eingecheckte und spaeter geloeschte bekannte
  Provider-Credentials sowie Private-Key-Material ohne den Fundwert auszugeben

### PR-09: Datenschutz, Retention und Betroffenenrechte

Prioritaet: `P0`  
Verantwortung: Backend / Product / Legal

Aufgaben:

- [x] Vollstaendiges Verzeichnis aller gespeicherten personenbezogenen Daten erstellen
- [ ] Rechtsgrundlage, Zweck, Empfaenger und Aufbewahrungsfrist je Datenklasse festlegen
- [~] Retention-Matrix fuer Sessions, Tokens, Audit, Activity, Webhooks, KI-Chats, Community, Feedback und Lernnachweise definieren
- [x] Automatische, mandantensichere Cleanup-Jobs implementieren
- [~] Personenbezogenen JSON-v23- und Binary-ZIP-Export samt tenantgebundenem
  Media-Manifest, SHA-256-Pruefung, sanitisierter Webhook-Versuchshistorie und
  verschluesseltem Artefakt implementiert; Rootserver-S3-Abnahme bleibt offen
- [x] Mandantensichere Loeschung/Anonymisierung eines Mitglieds mit
  Storage-Purge, Credential-Entzug, Legal-Hold-Sperre, dokumentierten
  Retention-Ausnahmen, kumulativer Migration und Cross-Tenant-E2E-Abnahme implementieren
- [ ] Zertifikats- und Nachweisdaten entsprechend der vereinbarten Aufbewahrung behandeln
- [x] Tenant-Offboarding mit Sperre, Policy-Manifest, Exporthash,
  Mindestwartefrist, Legal-Hold-Gate, verschluesseltem/HMAC-verkettetem
  Evidenzarchiv, verifiziertem Media-/S3-Purge, Receipt-autorisiertem Cascade,
  unveraenderlichem Loeschprotokoll und separatem Backup-Abschluss
  implementieren; Rechtsentscheidungen, realer Providerwiderruf und produktiver
  Backup-Purge bleiben separate externe Abnahmen
- [x] DSAR-Workflow mit Owner-Step-up, Identitaetspruefung, Status, Frist,
  Legal Holds, append-only Audit, privilegierter Intake-API und verschluesselten
  Sieben-Tage-Artefakten einrichten
- [~] Backup-Loeschkonzept dokumentieren

Abnahme:

- [x] Ein Testnutzer kann vollstaendig exportiert und gemaess Policy geloescht/anonymisiert werden
- [x] Cross-Tenant-Daten erscheinen weder im Export noch im Loeschlauf
- [~] Retention-Jobs sind idempotent und wiederholbar; Media-Queue- und Loeschalarme sind noch extern einzurichten

### PR-10: Rechtliche Unterlagen und KI-Datenschutz

Prioritaet: `P0`  
Verantwortung: Legal / Datenschutz / Product

Aufgaben:

- [~] Impressum, Datenschutzhinweise und Supportkontakt bereitstellen
- [x] Tenant-konfigurierbare Links zu kundeneigenen Datenschutzhinweisen ermoeglichen
- [ ] AVV, TOMs und Unterauftragnehmerliste erstellen und juristisch pruefen lassen
- [ ] Rollen von Q-Academy, Betreiber und Kunde als Verantwortlicher/Auftragsverarbeiter klaeren
- [ ] Verarbeitungsverzeichnis und Incident-Prozess dokumentieren
- [ ] KI-Provider, Region, Subprozessoren, Retention und Training-Nutzung dokumentieren
- [x] Externe KI standardmaessig deaktiviert lassen, bis die Organisation sie freigibt
- [x] Transparenzhinweis vor der ersten externen KI-Nutzung anzeigen
- [x] Technisches Cookie-/Tracking-Inventar fuer First-Party-Cookies,
  Browser-Speicher, Intercom, Click-to-load-Iframes und Custom-Code samt
  fail-closed Regressionstest erstellen
- [ ] Rechtsgrundlage und Consentbedarf je realer Tenant-/Providerkonfiguration
  festlegen, Provider-Cookies per Browseraufnahme verifizieren und nur nach
  dieser Entscheidung ein erforderliches Consent-Management einfuehren
- [ ] Aussage `DSGVO-orientiert` erst nach rechtlicher Freigabe verwenden

Abnahme:

- [ ] Legal und Datenschutzverantwortliche haben Pilotunterlagen schriftlich freigegeben
- [ ] Jeder Pilotkunde hat einen abgeschlossenen Vertrag und AVV
- [ ] Externe KI verarbeitet nur Daten im freigegebenen Vertrags- und Konfigurationsrahmen

### PR-11: Observability, Alarmierung und Runbooks

Prioritaet: `P0` fuer Basisbetrieb, erweiterte Metriken `P1`  
Verantwortung: DevOps / Backend

Aufgaben:

- [x] Strukturierte, redigierte JSON-Fehlerlogs mit Umgebung, Version,
  Runtime-Rolle und optionaler Request-ID einfuehren
- [~] Externes Fehlertracking ohne sensible Request-Bodies konfigurieren
- [x] Authentifizierte Prometheus-Metrikbasis fuer Runtime-Readiness, Mail-,
  Webhook-, Pruefungs- und Medienqueues sowie Worker-Heartbeats mit festen,
  inhaltsfreien Dimensionen bereitstellen
- [~] HTTP-, Latenz-, DB-Pool-, Auth- und vollstaendige KI-Metriken ergaenzen
- [x] Heartbeat-Marker und frischebasierte Docker-Healthchecks fuer Scheduler,
  Medienworker und Medien-Maintenance konfigurieren und lokal testen
- [~] Uptime-Checks fuer Live, Ready, Login und einen nicht-destruktiven Kernflow einrichten
- [~] Lokal validierte Prometheus-Regeln fuer Readiness, Queue-Alter/-Tiefe/-Fehler,
  Worker-Heartbeats und Backup-Frische konfigurieren; Error-Rate, Latenz,
  DB-Pool sowie externe Alertmanager-/Provider-Zustellung bleiben offen
- [~] Tenantgebundenen kanonischen JSONL-Audit-Export mit redigierten Metadaten,
  SHA-256, verketteter HMAC, Manifest, Key-ID und separater Verifikation
  implementieren; Retention und produktive WORM-/Object-Lock-Uebergabe bleiben
  mit Legal und Betrieb festzulegen
- [x] Runbooks fuer Ausfall, DB-Probleme, Provider-Ausfall, Queue-Stau und
  Secret-Incident samt Recovery-Gates schreiben
- [ ] On-call-Verantwortung und Eskalationskette festlegen
- [~] Knappe Vorlagen fuer Erstmeldung, Statusupdate, Wiederherstellung und
  Provider-Eskalation bereitstellen; Kanaele, Verantwortliche und vertragliche
  Fristen vor Pilotbetrieb freigeben

Abnahme:

- [ ] Ein absichtlich ausgeloester Fehler erzeugt den richtigen Alarm und ein verwertbares Ereignis
- [x] Keine Testmeldung enthaelt Passwort, Token, Prompt oder andere sensible Inhalte
- [ ] Ein Bereitschaftsmitglied kann einen simulierten Vorfall nur mit dem Runbook bearbeiten

### PR-12: Security-Hardening und externer Test

Prioritaet: `P1`, kritische Funde vor Pilot schliessen  
Verantwortung: Security / Engineering

Aufgaben:

- [x] Threat Model fuer Tenant-Isolation, Auth, API, Webhooks, KI und Adminfunktionen erstellen
- [x] Request-eindeutige Nonce-CSP fuer dynamische Seiten sowie restriktive
  Ressourcen-/API-CSP mit `default-src`, `script-src`, `connect-src`, `img-src`,
  `media-src`, `frame-src`, `worker-src`, `form-action` und `frame-ancestors`
  implementieren; Production-`script-src` enthaelt weder `unsafe-eval` noch
  `unsafe-inline`. Inline-Styles bleiben fuer React-Style-Props und Sonners
  Runtime-Styles explizit erlaubt.
- [x] TOTP-MFA fuer Owner, Admins und Trainer mit erzwungener Login-Challenge,
  verschluesseltem Secret, Einmal-Recovery-Codes, Replay-/Rate-Limit-Schutz,
  Owner-Policy, SSO-Step-up, Audit und Rotation implementiert
- [x] Tenantgebundenes OIDC mit sicherem Code-Flow, SSO-only-Einladungen,
  Owner-Link/Step-up, frischem Primaerfaktor und zusaetzlichem MFA-Nachweis bei
  aktivierter persoenlicher MFA vor interaktiven Konfigurationsaenderungen,
  dedizierten API-Scopes und Session-Provenienz implementieren
- [ ] Bedarf fuer SAML, RP-initiated/Backchannel Logout und SCIM anhand der
  Enterprise-Vertraege entscheiden; produktive IdP-Registrierungen praktisch testen
- [x] Entscheidung zu PostgreSQL-RLS als Defense-in-Depth dokumentieren: RLS ist
  im Shared-Pool-/Operator-/Worker-Modell derzeit bewusst nicht aktiviert;
  bestehende Query-/Composite-FK-/Trigger-Grenzen sowie Neubewertungs- und
  Einfuehrungsanforderungen stehen in [ADR_POSTGRES_RLS.md](./docs/ADR_POSTGRES_RLS.md)
- [x] Dependency-Audit, redigiertes Arbeitsbaum-/Vollhistorien-Secret-Scanning
  und digest-/regelgebundenes Semgrep-CE-SAST mit isoliertem Lauf und
  JSON-/SARIF-Evidence in CI aktivieren
- [ ] DAST gegen Staging ausfuehren
- [ ] Unabhaengigen Penetrationstest beauftragen
- [ ] Alle kritischen und hohen Funde vor GA schliessen
- [~] Security-Kontakt und Responsible-Disclosure-Prozess in `SECURITY.md`
  veroeffentlichen; reale Mailbox, Private-Reporting-Pfad und On-call testen

Abnahme:

- [ ] Kein offener kritischer oder hoher Security-Fund
- [ ] Cross-Tenant-Tests und Penetrationstest bestaetigen die Isolation
- [~] Zweiter Faktor fuer privilegierte Konten ist technisch vorhanden; produktive Enrollment-/Recovery-Abnahme mit realen Betreibern steht aus

### PR-13: Produktbetrieb, Billing, Storage und Accessibility

Prioritaet: `P1` fuer GA, teilweise optional im Pilot  
Verantwortung: Product / Engineering / Sales / Support

Aufgaben:

- [ ] Pilotmodell mit Vertrag und manueller Rechnung oder Self-Service-Billing festlegen
- [ ] Bei Self-Service Tarife, Subscription, Rechnungen, Zahlungsstatus und Kuendigung implementieren
- [x] Seat-, Kurs- und Speicherlimits sowie Feature-Entitlements serverseitig
  und als letzte Schranke durch Datenbank-Trigger durchsetzen; Vertragsrevision,
  Auslastung, REST/OpenAPI und Operations-CLI bereitstellen
- [ ] Supportkanal, Reaktionszeiten und SLA/SLO definieren
- [~] Lokales [Rollenhandbuch](./docs/USER_GUIDE.md) fuer Owner, Trainer und
  Mitglieder erstellen; kundenspezifische Schulung und Freigabe bleiben
  Betreiberaufgabe
- [~] Lokales [Admin-/Operations-Runbook](./docs/TENANT_OPERATIONS_RUNBOOK.md)
  fuer Onboarding, Owner-Uebergabe,
  Sperrung, Reaktivierung, Offboarding und sichere Support-Triage erstellen;
  Supportorganisation, On-call, SLA/SLO und physische Tenant-Loeschabnahme
  bleiben offen
- [x] Entscheidung fuer privaten S3-kompatiblen Dateispeicher treffen
- [~] Bei Uploads private ACLs, signierte URLs, Quota, Dateigroessen,
  MIME-/Container-Pruefung, Malware-Scan, Quarantaene, Retention, begrenzte
  Maintenance, Least-Privilege-Worker, Stockbilder, Audio-/Video-/Screen-
  Recording, exakte S3-Versionen, FFmpeg-Transcoding, Thumbnails, STT,
  verifizierte Derivat-Uploads, private Kurs-Widget-Bilder, Multi-Segment-
  Schnitt mit komprimierter Zeit und Video-Endkarten implementieren; realer
  Bucket-/Rootserverbetrieb, Provider-/Modellabnahme und Lasttest fehlen
- [~] Native Capacitor-Container, Deep Links und APNs-/FCM-Queue sind
  implementiert; Apple-/Google-Credentials, Signierung, reale Geraetetests,
  Store-Metadaten und Store-Reviews fehlen
- [ ] Formale WCAG-Pruefung mit Tastatur, Screenreader, Kontrast und Zoom durchfuehren
- [~] Deterministischen Produktions-Lizenzbestand und releasegenaue SBOMs
  erzeugen; Produktname, Markenauftritt, Nutzungsrechte und Open-Source-Hinweise
  juristisch pruefen

Abnahme:

- [ ] Vertrieb verkauft nur Funktionen und SLA, die technisch und organisatorisch geliefert werden
- [ ] Support und Eskalation sind fuer Pilotkunden erreichbar
- [ ] Kritische Accessibility-Barrieren sind geschlossen

### PR-14: Staging, Release-Abnahme und Pilot

Prioritaet: `P0` fuer Pilotabschluss  
Verantwortung: QA / Engineering / DevOps / Product

Aufgaben:

- [ ] Produktionsnahe Staging-Umgebung mit getrennten Secrets und synthetischen Daten betreiben
- [~] Vollstaendigen CI-Testlauf gegen das Release-Artefakt ausfuehren
- [~] Automatisierten Upgradepfad von der unmittelbar vorherigen Migration auf
  den aktuellen Stand `0073` testen; Upgrade des spaeteren echten
  Staging-Releases bleibt
  praktisch abzunehmen
- [ ] Backup-Restore und Rollback in Staging demonstrieren
- [ ] Lasttest fuer Login, Kurslesen, Fortschritt, Adminlisten, API und Jobs durchfuehren
- [~] Media-Upload, ClamAV, Worker-Backpressure und verifizierte S3-Loeschung
  mit grossen und parallelen Dateien testen; lokale Negativtests und
  Provider-Preflight sind vorhanden, reale S3-/Rootserver-Lastabnahme fehlt
- [~] Fail-closed Staging-Drills fuer Worker-Ausfall mit Queue-Anstieg/Drain und
  sequentiellen Zwei-Replika-App-Drain samt Sessionkontinuitaet lokal
  vorbereitet; echter Staging-Lauf, parallele Last und Multi-Host-HA bleiben offen
- [~] Fail-closed Storage-Pipeline-Drill fuer isolierten Media-Runner-Egress-
  Ausfall, beobachtbaren Retry, Queue-Drain, unveraenderten Download und
  separat verifizierte Provider-Canary-Loeschung lokal vorbereitet; echter
  Staging-Lauf, providerweiter Ausfall, Last und physische Asset-Loeschung nach
  Ablauf der Grace Period bleiben offen
- [ ] Mail-, Webhook- und Provider-Ausfall simulieren
- [ ] Cross-Tenant-Security-Suite erneut ausfuehren
- [ ] Browser-, Mobile-, Tastatur- und Screenreader-Smoke-Test durchfuehren
- [ ] Pilot mit ein bis drei Design-Partnern und klar begrenztem Scope starten
- [ ] Pilotfeedback, Incidents, Supportlast und SLO-Ergebnisse auswerten
- [ ] GA-Go/No-Go schriftlich dokumentieren

Abnahme:

- [ ] Alle P0-Arbeitspakete sind abgenommen
- [ ] Kein offener kritischer oder hoher Fehler
- [ ] Restore, Rollback und Incident-Ablauf wurden praktisch getestet
- [ ] Pilotkunden haben Vertrag, AVV, Ansprechpartner und dokumentierten Funktionsumfang

## Empfohlene Reihenfolge

### Phase 0: Entscheidungen und Sicherheitsgurt

1. DEC-01 bis DEC-06 treffen.
2. PR-01 umsetzen, insbesondere Environment-Validierung und Seed-Sperre.
3. Produktionsdaten bis dahin kategorisch ausschliessen.

### Phase 1: Technische Pilotbasis

1. PR-02 Deployment und CI/CD
2. PR-03 PostgreSQL, Backup und Restore
3. PR-04 Tenant-Provisioning
4. PR-05 E-Mail-Outbox und Worker
5. PR-06 Webhook-Sicherheit oder Webhooks im Pilot deaktivieren
6. PR-07 KI-Limits oder externe KI im Pilot deaktivieren
7. PR-08 Secret- und Key-Lifecycle

### Phase 2: Datenschutz und Betrieb

1. PR-09 Datenrechte und Retention
2. PR-10 Rechtliche Unterlagen
3. PR-11 Observability und Runbooks
4. PR-12 kritische Security-Massnahmen

### Phase 3: Pilotfreigabe

1. PR-14 Staging- und Release-Abnahme
2. Gate B formal abnehmen
3. Ein bis drei Pilotkunden kontrolliert onboarden
4. Betrieb fuer einen vereinbarten Beobachtungszeitraum auswerten

### Phase 4: GA-Ausbau

1. PR-12 vollstaendig abschliessen
2. PR-13 entsprechend dem Vertriebsmodell umsetzen
3. Alle Pilotbefunde schliessen
4. Gate C formal abnehmen

## Pilot-Go-Live-Checkliste

- [ ] Produktionsartefakt und CI/CD sind reproduzierbar
- [ ] HTTPS, Domains, Proxy-Vertrauen und Security-Header sind abgenommen
- [ ] Jeder freigeschaltete OIDC-Tenant hat eine getestete IdP-Registrierung mit
  exakt kanonischer HTTPS-Callback-URL und dokumentiertem Recovery-Zugang
- [ ] Produktionssecrets sind zufaellig, getrennt und im Secret Manager gespeichert
- [x] Destruktiver Seed ist in Produktion technisch unmoeglich
- [ ] Managed PostgreSQL, PITR und Restore-Test sind gruen
- [x] Tenant-Provisionierung und Owner-Einladung sind sicher und auditierbar
- [ ] E-Mail-Outbox, Worker, Retry und Alarmierung funktionieren
- [x] Webhooks sind gehaertet oder fuer den Pilot deaktiviert
- [ ] Externe KI ist vertraglich freigegeben und limitiert oder deaktiviert
- [ ] Personenbezogener Export, Loeschung und Retention sind abgenommen
- [ ] Privater S3-Bucket, ClamAV, Media-Worker, Queue-SLO und Binary-DSAR sind abgenommen
- [ ] FFmpeg-/STT-S3-Runner, Modelle, Sprachen, Retention und Provider-
  Datenschutz sind produktiv abgenommen
- [ ] Native Android-/iOS-Builds, Universal Links, APNs/FCM, Signierung und
  Store-Freigaben sind auf realen Geraeten abgenommen
- [ ] Datenschutzhinweise, Impressum, AVV, TOMs und Subprozessoren sind freigegeben
- [ ] Strukturierte Logs, Fehlertracking, Metriken und Uptime-Checks laufen
- [ ] Incident-, Restore- und Rollback-Runbooks wurden getestet
- [ ] Kein offener kritischer oder hoher Security-Fund
- [ ] Pilotvertrag, Scope, SLA und Supportkontakt sind dokumentiert

## GA-Go-Live-Checkliste

- [ ] Alle Pilot-Go-Live-Punkte bleiben dauerhaft gruen
- [ ] Verteilte Rate-Limits und KI-Budgets funktionieren unter Last
- [ ] Webhook- und Mail-Worker sind horizontal skalierbar und crash-sicher
- [ ] Unabhaengiger Penetrationstest ist ohne offene hohe Funde abgeschlossen
- [ ] Billing und Entitlements entsprechen dem Vertriebsmodell
- [ ] Commerce-, n8n-, Intercom- und Orbit-Workflows sind mit realen Provider-
  beziehungsweise Multiinstanz-Szenarien abgenommen
- [ ] Lokales TOTP-MFA ist umgesetzt; Enrollment, Recovery und Pflicht-Policy
  sind mit realen Betreibern abgenommen und OIDC ist fuer alle vertraglich
  vorgesehenen Tenants providerseitig registriert und getestet
- [ ] Accessibility-Audit ist abgeschlossen
- [ ] Endkundendokumentation und Supportorganisation sind freigegeben
- [ ] Pilot-SLOs, Incidentzahlen und Supportlast rechtfertigen GA
- [ ] Formales Go/No-Go wurde von Engineering, Operations, Security, Product und Legal signiert

## Definition of Done pro Arbeitspaket

Ein Arbeitspaket ist erst abgeschlossen, wenn:

- [ ] Code und Konfiguration implementiert sind
- [ ] Automatisierte Positiv-, Negativ- und Tenant-Isolationstests vorhanden sind
- [ ] Monitoring und relevante Alarme vorhanden sind
- [ ] Betriebs- und Recovery-Dokumentation aktualisiert ist
- [ ] Security- und Datenschutzfolgen bewertet wurden
- [ ] Staging-Abnahme erfolgreich war
- [ ] Verantwortliche Person und Abnahmedatum dokumentiert sind

## Aenderungsprotokoll

| Datum | Aenderung | Autor |
| --- | --- | --- |
| 2026-07-15 | Lokale Gesamtvalidierung abgeschlossen und dabei drei reale Randfaelle geschlossen: Community-Reorder verwendet fuer `updated_at` die PostgreSQL-Uhr und bleibt auch bei nachgehender App-Uhr gueltig; das Benachrichtigungs-Badge erreicht mit `#b84e42` auf Weiss 4,99:1 und wird mit einer deterministischen ungelesenen Meldung durch Axe geprueft; OIDC-Konfiguration und Step-up ignorieren keine Interaktionen mehr vor abgeschlossener Hydration. Playwright wartet auf App-Readiness und erzwingt in CI einen frischen Server. Nachweise: 170 Tabellen/73 Migrationen, 86 Integrations- und 1.276 Unit-Tests, vollstaendige lokale Verifikation, Produktions-Build, 317 bestandene E2E-Faelle plus 177 projektbedingte Skips ohne Fehler, Firefox/WebKit 6/6 sowie Produktions-Dependency-Audit ohne Fund. Der verpflichtende reale Backup-/Restore-Drill bleibt in dieser Umgebung mangels Docker und freigegebener Image-Digests unausfuehrbar; Git-Historien-Evidence ist ohne `.git` ebenfalls extern nachzuholen. Rootserver, Staging, DNS/TLS, reale Provider/Geraete/Stores, Restore, Last, Legal/Datenschutz, formale Accessibility, unabhaengiger Pentest und Go/No-Go bleiben offene Gates | Codex |
| 2026-07-14 | Fail-closed Storage-Pipeline-Drill lokal vorbereitet: doppelt bestaetigte und env-gebundene Staging-Origin-, Compose-Projekt- und Bucket-Ziele, exakter lokaler Docker-Unix-Socket, private Disposable-Member-Session, isolierter Media-Runner-Egress-Ausfall, erwarteter Retry bei gruener App, Queue-Drain, Hash-verifizierter Download, Trap-Recovery sowie separater Provider-Preflight mit verifizierter Canary-Loeschung. Signed URLs, Cookies, Secrets, IDs, Objektpfade und Hashes bleiben aus Logs und JSON. Reale Staging-Ausfuehrung, providerweiter Ausfall, Last und physische Loeschung des logisch geloeschten Test-Assets nach der Grace Period bleiben externe Gates | Codex |
| 2026-07-14 | Den offenen technischen Git-Historien-Secret-Scan geschlossen: CI checkt nicht flach aus und prueft Arbeitsbaum sowie alle aus lokalen Refs erreichbaren Blob-, Commit- und Tag-Payloads. Ersatzobjekte, defekte Konnektivitaet, flache Historie, unvollstaendige Objektstreams und Payloads ueber dem 64-MiB-Limit blockieren fail-closed; Findings enthalten nur Objekt-ID, Position und Regel. Der vorliegende dateibasierte Arbeitsstand enthaelt kein `.git`, daher bleibt der erste reale Scan der Repository-Historie als geschuetzte CI-Evidence vor Pilotfreigabe auszufuehren; externer Secret Manager und betriebliche Rotation bleiben offen | Codex |
| 2026-07-14 | Zwei staging-only Resilience-Evidence-Drills vorbereitet: Scheduler-/Media-Worker-Ausfall verlangt beobachtbaren Queue-Anstieg bei gruener App, Trap-Wiederanlauf und Drain ohne neue Failed Jobs; der Zwei-Replika-App-Drill stoppt jedes gleichartige Compose-Replikat einzeln und prueft Health sowie dieselbe serverseitige Session. Origin, Projekt, Env-Bindung und lokaler Docker-Unix-Socket werden doppelt fail-closed bestaetigt; JSON bleibt secretfrei. Reale Staging-Ausfuehrung, Last, Multi-Host-/Load-Balancer-/PostgreSQL-HA und allgemeiner Datenverlustnachweis bleiben externe Gates. Veraltete Upgrade-Referenz 0068 auf aktuellen Stand 0072 korrigiert | Codex |
| 2026-07-14 | Technisches Cookie-/Tracking-Inventar mit exakten Session-, MFA- und OIDC-Cookievertraegen, Browser-Speicher, automatischem Intercom-SDK, Click-to-load-Kursanbietern und isolierter Custom-Code-Flaeche erstellt. AST-basierter Guard blockiert neue Cookie-Schreibstellen, bekannte Tracker-/Telemetry-SDKs und Browser-Scriptloader bis zur expliziten Inventarisierung. Rechtsgrundlage, Provideraufnahme, Consent-/CMP-Entscheidung und Legal-Freigabe bleiben offen; der Datenstand bleibt unveraendert bei 170 Tabellen/73 Migrationen bis 0072 und DSAR-Schema 23 | Codex |
| 2026-07-14 | Security-/Betriebsvertrag mit dem lokalen Stand abgeglichen: Die MFA-Policy umfasst Owner, Admins und Trainer; interaktive OIDC-Konfigurationsaenderungen verlangen frischen Owner-Step-up und bei aktiver persoenlicher MFA einen zusaetzlichen zweiten Faktor vor Providerzugriff; interne Worker-Querys besitzen harte Batchobergrenzen; der CI-Workflow bindet den Produktions-Browser-Smoke an die exakte App-Image-ID und verpackt nur getestete Release-Images. Geschuetzter Main-Lauf, Rootserver, reale Provider, Restore, Last, Legal, Pentest und formale Abnahme bleiben offen | Codex |
| 2026-07-14 | Letzte lokal loesbare Paritaetspunkte dieser Runde umgesetzt: hostgebundener Kurs-Integrationskatalog, streng quellgebundener fuenfsprachiger Transcript-Wizard, offizielle versionierte Zapier-CLI-19-/Make-Apps-Editor-Pakete mit Clean-CI sowie Audio-Mehrspur mit bis zu acht Tracks, immutable Quellen, FFmpeg-Graph, rollen-/kursgebundener Derivatauslieferung und Publish-Invariant. Orbit blockiert Composition-Transfers vor jedem Objektcopy und erzeugt nie still einen ungerenderten publizierten Zielkurs. Lokale Gesamtvalidierung ist standbezogen auszufuehren; reale Rootserver-, Provider-, Geraete-/Store-, Legal-/Datenschutz-, Accessibility-, Pentest-, Restore-, Last- und Go/No-Go-Abnahmen bleiben verpflichtend | Codex |
| 2026-07-14 | Lokale Paritaetsrunde auf 170 Tabellen/73 Migrationen bis 0072 abgeschlossen: Code-/Tabellenbloecke, wiederverwendbare Kursmedien, valider WebVTT-Import/-Export, vollstaendiger transkriptbasierter Aufgaben-Wizard, Event-Zeitzonen/-Themes, mobile Release-Preflights, tiefere Commerce-/n8n-/Support-Pruefungen sowie revisionsgebundene Orbit-Abrechnung mit append-only Preis- und Periodenhistorie umgesetzt. Fresh-/Incremental-Migrationen sind gruen; Rootserver, reale Provider/Geraete/Stores, Legal/Datenschutz, Accessibility, unabhaengiger Pentest, Restore, Staging, Last und formales Go/No-Go bleiben externe Freigaben | Codex |
| 2026-07-14 | Lokalen Stand auf 166 Tabellen/69 Migrationen bis 0068 und DSAR-Schema 23 abgeglichen: private gescannte Kurs-Widget-Bilder, atomare Sektion-/Lektionskopien, Multi-Segment-Videozeit samt Endkarten, isolierter Hub-Custom-Code, ownergebundener Plattform-Header/-Footer-Code sowie fuenfsprachige Fachaktionen und empfaengerlokalisierte Community-Benachrichtigungen dokumentiert. Dies ist keine Produktionsfreigabe; Rootserver, DNS/TLS, Provider, Legal/Datenschutz, Accessibility, unabhaengiger Pentest, Staging, Last, Restore und formales Pilot-/GA-Go/No-Go bleiben offen | Codex |
| 2026-07-13 | Stand auf 166 Tabellen/67 Migrationen und DSAR-Schema 23 aktualisiert: Webhook-Zustellungen verwenden rotationssichere Claim-Tokens und schreiben jeden gewonnenen Abschluss atomar in eine append-only, tenantgebundene Versuchshistorie ohne Response-Body. Admin/API zeigen bis zu 50 sanitisierte Versuche; Replay erhaelt alte Generationen, Prometheus alarmiert Dead Letters und DSAR/Offboarding enthalten nur freigegebene Metadaten. Reale Egress-Policy und Rootserver-Alarmempfaenger bleiben externe Gates | Codex |
| 2026-07-13 | Release-Lieferkette lokal gehaertet: CI baut und smoketestet die exakten App-/Medien-Targets mit identischer Release-ID, erzeugt Trivy-Scan-Evidence und CycloneDX-SBOMs, publiziert exakt getestete Image-IDs nach GHCR und attestiert deren Digest-Manifest; Deploy zieht dieses Manifest standardmaessig statt neu zu bauen. SAST, Responsible Disclosure, deterministische Third-Party-Notices, reproduzierbares FFmpeg aus festem Debian-Snapshot sowie Web-/Native-Push-Queue-Alarme ergaenzt. Erster geschuetzter Main-/GHCR-/Attestierungs- und Rootserver-Lauf bleibt extern abzunehmen | Codex |
| 2026-07-13 | Release-ID in App und Medienrunner injiziert, Readiness und Deploy/Rollback exakt an den Zieltag gebunden, systemd-Service/-Timer fuer restore-verifizierte Backups sowie Incident-/Provider-Ausfall-Runbook mit Kommunikationsvorlagen lokal ergaenzt. Rootserver-Aktivierung, On-call-Zuordnung, externe Kanaele und Staging-Drill bleiben offen | Codex |
| 2026-07-13 | Stand auf 163 Tabellen/64 Migrationen und DSAR-Schema 22 aktualisiert: geordnete Community-Areas, strukturierter Rich Text fuer Posts und Kommentare, konfigurierbare oeffentliche Profile sowie ein transaktionales Profil-Completion-Gate lokal umgesetzt. Rootserver-, Provider-, Staging-, Legal- und externe Security-Abnahmen bleiben unveraendert offen | Codex |
| 2026-07-13 | Stand auf 157 Tabellen/60 Migrationen aktualisiert: 27 Kursbloecke mit sicheren Embeds und Authoring-Recorder, typisierter Pop-up-Blockeditor, exakt versionsgebundener S3-Medienrunner, Tenant-Vertraege mit DB-Limits und gemeinsamen KI-Kosten, Provider-Circuit-Breaker, verifizierte Custom Domains, Bounce-/Complaint-Suppressions, Owner-Uebergabe und verifizierbarer Audit-Export lokal umgesetzt. RLS-Entscheidung, Rollenhandbuch und Tenant-Operations-Runbook dokumentiert; reale DNS/TLS-, Provider-, Rootserver-/Staging-, Store-, Legal-, Accessibility-, Last- und Pentest-Gates bleiben offen | Codex |
| 2026-07-13 | Lokale Mehrsprachigkeitsabdeckung auf 18 deklarierte Admin-/Academy-Routen und 440 zentral gemessene Copy-Werte je Locale erweitert: Analytics samt Mitgliedertabelle, Mitglieder-/Datenprofildetails, Community-Profile/Rich-Text, Kursdetail, Lektionsleser und zentrale Kurseditorbereiche verwenden DE/EN/IT/ES/FR sowie locale-spezifische Datums-/Zeitformate. Das E-Mail-Center misst 54 Werte je Locale. Tiefe Autoren-/Pruefungsdetails, einzelne Fachaktionen, muttersprachliche Abnahme und reale Mailprovider-Abnahme bleiben offen | Codex |
| 2026-07-13 | CI-Secret-Scanner mit redigierten Findings sowie transaktionalen Owner-Wechsel mit Step-up, Rollen-Revalidierung, Session-Widerruf, Audit und Tenant-Isolation ergaenzt; Git-Historien-Scan und externer Secret Manager bleiben vor Pilotbetrieb offen | Codex |
| 2026-07-12 | Stand auf 153 Tabellen/58 Migrationen und DSAR-Schema 18 aktualisiert; Authoring-Praesenz/CAS/Styles/Stock, lokale FFmpeg-/STT-Medienpipeline, Profilmedien, Custom-Rollen, Dark/System-Theme und fuenfsprachige Kernbereiche, Hubs/Pop-ups/Events/Badges, Capacitor/Native Push, KI-Dokument-/Profil-/Prompt-/Aktionsworkflows, Commerce/n8n/Support sowie Orbit/Transfer lokal implementiert. Provider-, Store-, Rootserver-, DNS/TLS-, Legal-, Accessibility- und Pentest-Gates bleiben offen | Codex |
| 2026-07-12 | Stand auf 111 Tabellen/53 Migrationen und DSAR-Schema 11 aktualisiert; versionierte Kurszugriffsaktionen mit Mitgliederanfrage, expliziter Adminfreigabe, atomarem Grant, optimistischer Revision, append-only Audit, Scheduler-Expiry, REST und Webhook-Triggern umgesetzt | Codex |
| 2026-07-12 | Authentifizierten Prometheus-Endpunkt, servicebezogene Runtime-Heartbeats, optionales Prometheus-/Node-Exporter-Profil, 13 lokal mit promtool validierte Alarmregeln und atomare Backup-Textfile-Metriken ergaenzt; echter Docker-Lauf, externe Empfaenger und Feueralarmtest bleiben offen | Codex |
| 2026-07-12 | Stand auf 114 Tabellen/54 Migrationen und DSAR-Schema 12 aktualisiert; versioniertes Agent Studio, freigabepflichtige Aktionen und lokales TOTP-MFA-Fundament fuer Owner/Admins samt SSO-Step-up, Recovery, Policy, Audit, Retention und Rotation umgesetzt. Reale IdP-/Rootserver-/Pentest-/Legal-Abnahmen bleiben offen | Codex |
| 2026-07-12 | Bereichsbezogene Freigaben, automatische Zurueckhaltung, versionierte non-destruktive Moderationsfaelle, Admin-Queue, 30-Tage-Einsprueche, getrennte Community-Punkte, konfigurierbare Levels und Kommentarreaktionen umgesetzt; DSAR auf Schema 9 und das Inventar auf 105 Tabellen/50 Migrationen aktualisiert. Externe Produktions-Gates bleiben offen | Codex |
| 2026-07-12 | Community um erklaerbaren personalisierten/Following/Latest-Feed, Autoren-/Bereichs-Follows, auditierte zeitliche Boosts, begrenzte Kommentar-Cursor, reversible Gamification und persistente Benutzer-/Tenant-Limits erweitert; SQL-, ACL-, Idempotenz-, Datenschutz- und Lastpfade gehaertet | Codex |
| 2026-07-10 | Initialer Production-Readiness-Plan aus Funktions-, Ops-, Security- und Compliance-Audit erstellt | Codex |
| 2026-07-10 | Technische Rootserver-, CI-, Migrations-, Queue-, Tenant-, Retention- und DSAR-Basis umgesetzt; externe Pilot-Gates bewusst offen gelassen | Codex |
| 2026-07-11 | Privates Media-Asset-/Scan-/Quota-/Harddelete-Fundament und getrennte Medienworker umgesetzt; Provider-, Last-, Monitoring- und Binary-DSAR-Abnahmen bleiben offen | Codex |
| 2026-07-11 | Mediencontainer, S3-Pagination, globale Maintenance-Deadline sowie getrennte DB-/Netz-/Job-/S3-Workerrechte gehaertet; reale Provider- und Rootserver-Abnahme bleibt offen | Codex |
| 2026-07-11 | Private Kursmedien mit Editor-Upload, Kurs-/Snapshot-Bindung, Zugriffsschutz und Orphan-Retention umgesetzt | Codex |
| 2026-07-11 | Versionierte Daten-/Webhook-Keyrings, Legacy-Lesepfade, transaktionaler Online-Rekey und isolierter Operations-Container umgesetzt | Codex |
| 2026-07-11 | Owner-only DSAR-Fallworkflow, privilegierte REST-API, vollstaendiges Dateninventar, JSON-v3-Export, verschluesselte Artefakte und append-only Retention umgesetzt; Binary-Export und Loesch-Executor bleiben bewusst offen | Codex |
| 2026-07-11 | Lokale Produktparitaet um sicheren Rich-Text-Editor, Multi-Select/Lueckentext/Sortieraufgaben mit Sofortfeedback, zeitgesteuerte Bundle-Kurse und auditierte Community-Meldungsqueue erweitert; externe Produktions-Gates bleiben unveraendert offen | Codex |
| 2026-07-11 | Lokalen Funktionsstand um Button/Link, Galerie, manuelle WebVTT-Untertitel und Videosuche, transkriptbasierten Content-Wizard, typisierte Community-Foren, Datenprofile, Multi-Profile und Formulare erweitert; automatische Medienverarbeitung, Paritaetsluecken und externe Produktions-Gates bleiben offen | Codex |
| 2026-07-11 | Autor-, Info- und Bild-Link-Karten als versionierte, tenantgebundene Kurs-Widgets mit Admin-, REST- und responsivem Mitgliederworkflow umgesetzt; privater Asset-Picker und externe Produktions-Gates bleiben offen | Codex |
| 2026-07-11 | Lokalen Stand auf 87 Tabellen und 39 Migrationen aktualisiert; Welcome, Drip/Availability, Kurs-Diff, Pruefungen, Transkript-Suchausschluesse, Kurs-Link-Module, Feedback- und E-Mail-Center dokumentiert | Codex |
| 2026-07-11 | Tenantgebundenen OIDC-Core mit SSO-only-Einladungen, Owner-Link/Step-up, ownergebundenen API-Scopes und Session-Provenienz als lokal abgeschlossen dokumentiert; IdP-Registrierung, DNS/TLS und externe Betriebsabnahmen bleiben offen. Die damalige MFA-Entscheidung wurde mit der Erweiterung vom 2026-07-14 lokal geschlossen | Codex |
| 2026-07-11 | SSO-only-Profil und DSAR-Reauth geschlossen, Kurscover auf renderbare lokale/private Medien begrenzt, Inhaltsblock-Updates und -Loeschungen mit atomarer Revisionskontrolle abgesichert sowie leere Kernoberflaechen vervollstaendigt | Codex |
| 2026-07-11 | Kursbezogene Trainerrechte mit transaktionaler Revalidierung sowie persistente Pruefungsversuche mit eingefrorener Version, HMAC-Fragenauswahl, Autosave, Fristen, Inhaltsbindung und getrennter Ergebnis-/Einsichtsfreigabe umgesetzt; Stand auf 88 Tabellen und 41 Migrationen aktualisiert | Codex |
| 2026-07-11 | Community um gescannte Post-/Kommentaranhaenge, globale unveraenderliche Asset-Bindung, 24-Stunden-Orphan-Retention und serverseitige Open-/Restricted-Rechte fuer Rollen, Personen, Gruppen und Bundles erweitert; WAV-Dauerparser ergaenzt und Stand auf 93 Tabellen sowie 46 Migrationen aktualisiert. Externe Produktions-Gates bleiben offen | Codex |
