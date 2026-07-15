# Q-Academy

Q-Academy ist eine eigenstaendige, mandantenfaehige Lernplattform nach dem Produktprinzip moderner All-in-one Learning Suites. Sie bildet nicht die oeffentliche LearningSuite-Webseite nach, sondern implementiert die zentralen LMS-Arbeitsablaeufe mit eigener Marke, eigenem Code und eigenen Demo-Inhalten.

## Funktionsumfang

- Getrennte Admin- und Mitglieder-Perspektive mit rollenbasierter Anmeldung
- Kurse, Kategorien, wiederverwendbare Module, Kurs-Link-Module und eine
  eingerueckte Modulstruktur mit bis zu vier Ebenen
- Geordnete Autor-, Info- und verlinkte Bildkarten in der Kursuebersicht mit
  sicheren oeffentlichen Quellen oder tenantgebundenen, gescannten privaten
  Bild-Assets aus dem Kursmedien-Picker
- Kurseditor mit Sektionen, Lektionen, Seiten, strukturiertem Rich Text,
  Button-/Link-, Galerie-, Callout-, Zitat-, Trenner-, Accordion-, Tabs-,
  Spalten-, Code-, Tabellen-, sicherem Download-, kontrolliertem HTTPS-Embed-
  und eingebetteten Datenformular-Bloecken; der Integrationskatalog bindet
  YouTube, Vimeo, Loom, Microsoft Forms und Google Forms an ihre kanonischen
  Hosts und passende responsive Layouts; im Mitgliederbereich wird die
  Drittanbieter-Verbindung erst nach einer lokalisierten Click-to-load-
  Freigabe aufgebaut. Optimistische Revisionskontrolle verhindert
  ueberschriebene Parallelaenderungen;
  Seiten und Bloecke koennen verschoben, dupliziert und ausgeblendet werden;
  ganze Sektionen und einzelne Lektionen lassen sich samt Seiten, Bloecken und
  sicher neu zugeordneten Medien-/Formular-/Agent-/Pruefungsreferenzen in ein
  berechtigtes Zielmodul kopieren,
  Page-CAS, sichtbare Bearbeiterpraesenz, Seiten-/Blockstyles und eine
  attributionserhaltende, SSRF-gehaertete Stockbildsuche ergaenzen den Workflow
- Lernpfade, Zugriffsquellen, vollstaendiges Content-Drip, zeitgesteuerte
  Bundle-Kurse und abonnierbare Lektionsfreigaben mit genau einmal erzeugten
  In-App-, E-Mail- und Webhook-Ereignissen
- Versionierte Kursveroeffentlichungen mit redigierter Aenderungsvorschau,
  Versionshinweisen und Historie
- Eigenstaendige Pruefungsmodule mit fuenf serverbewerteten Fragetypen,
  manuellen Abgaben, Bestehensgrenze, Versuchslimit und Shuffle
- Idempotente Kurszertifikate mit serverseitiger Abschlusspruefung, Druckansicht und Widerrufshistorie
- Versionierte Rich-Text- und Datei-/Audio-/Video-Abgaben mit sicherem
  Browser-Upload, Mikrofon-/Kamera-/Bildschirmaufnahme, atomarer Anhangbindung,
  exakten Text-/Medienkommentaren, Trainer-Feedback und Bewertung
- Mitglieder, Einladungen, CSV-Import/Export, Gruppen, Bundles, sichtbarkeitsgesteuerte
  Profilfelder, benannte Multi-Profile, konfigurierbare Datenformulare und eine
  transaktionale Owner-Uebergabe mit Step-up, Rollenwechsel, Session-Widerruf
  und Audit
- Community mit erklaerbarem personalisiertem, Following- und Latest-Feed,
  Autoren-/Bereichs-Follows, zeitlich begrenzten Admin-Boosts, Threads,
  Reaktionen, Votes, Mentions, reversiblen Punkten, Badges, Rangliste sowie
  vertraulicher Melde- und Moderationsqueue; Posts und Kommentare unterstuetzen
  gepruefte Bild-, Audio-, Video- und Dokumentanhaenge sowie offene oder
  eingeschraenkte Bereiche mit Rollen-, Personen-, Gruppen- und Bundle-Rechten;
  Mention- und Moderationsbenachrichtigungen werden in der wirksamen Sprache
  des jeweiligen Empfaengers materialisiert
- Badge-Gruppen mit `alle`-/`hoechstes`-Anzeigepolicy, manueller Vergabe und
  automatischen Punkte-Badges in Posts, Kommentaren und Mitgliederprofilen
- Event-Plan mit Zusagen, IANA-Zeitzonen, revisionierter Absage/Neuplanung,
  ICS und barrierearm konfigurierbarem Kalender-Theme
- Individuelle Hub-Dashboards mit vier Starttemplates, sicheren Mitglieds-/
  Kursvariablen, eingebetteten Datenformularen und KI-Agenten
- Hub-Kategorien, kontrollierte HTTPS-Embeds und begrenzte HTML-/CSS-/
  JavaScript-Widgets in netzlosen Opaque-Origin-Iframes ohne Cookie-, Storage-,
  Formular-, Popup- oder Academy-Zugriff sowie zeitgesteuerte
  Ankuendigungs-Presets und erweiterte Event-Farbpaletten
- Persistente KI-Agenten-Konversationen mit OpenAI-kompatiblem Provider, sicherem Fallback und unveraenderlichen, SSRF-gehaertet abgerufenen Webquellen-Snapshots
- Versioniertes Agent Studio mit Draft/Publish/Rollback, Rollen-, Nutzer-,
  Gruppen- und Bundle-Zugriff, tenantweiter Credit-Policy sowie einer
  freigabepflichtigen, exakt einmal ausgefuehrten Kurs-, Gruppen- oder
  Bundle-Aktion; Dokumentquellen, ausgewaehlte sichtbare Profileigenschaften
  und versionierte Zusatz-Prompts werden serverseitig aufbereitet
- KI-Kursassistent mit strukturiertem Provider-Output, vollstaendigem
  Draft-Fallback fuer alle unterstuetzten bewerteten Aufgabentypen, Stundenquote
  und parallelem Generierungsschutz; Agent-Chats und Kurserstellung verwenden
  dasselbe vertragsbegrenzte Creditmodell und einen PostgreSQL-geteilten
  Provider-Circuit-Breaker
- Manuell pflegbare oder asynchron lokal erzeugte WebVTT-Transkripte mit
  validiertem Dateiimport/-export, Untertiteln, zeitcodierter Suche, Sprung zur
  Fundstelle und tenantweiten Suchausschluessen sowie ein transkriptbasierter
  Wizard fuer Zusammenfassungen und alle fuenf bewerteten Aufgabentypen
- Zeitgesteuerte Ankuendigungs-Banner und Modals mit typisiertem Rich-Text-,
  Callout-, Trenner- und CTA-Blockeditor, sicheren Variablen, regelbasierten
  Zielgruppen, Treffer-Vorschau und idempotenten Interaktions-Insights
- Versioniertes Willkommens-Popup mit HTTPS-Video, Profilbild- und
  Profilvervollstaendigungsaufforderung, das Mitglieder pro Konfigurationsstand
  genau einmal bestaetigen
- Learning Analytics, tenantisoliertes Feedback-Center mit Antwort-Outbox,
  Branding, konfigurierbarer Login und Plattform-Einstellungen einschliesslich
  ownergebundenem, revisioniertem Header-/Footer-Custom-Code in getrennten
  `allow-scripts`-Sandboxes mit expliziter HTTPS-Netzwerk-Allowlist
- E-Mail-Center mit parallelen tenantindividuellen Plaintext-Vorlagensaetzen
  fuer DE/EN/IT/ES/FR, Feedback, Lektionen, Einladungen und Passwort-Recovery,
  erlaubten Variablen, sicherer HTML-Vorschau, localegebundenem Testversand,
  maskierter Versandhistorie, REST/OpenAPI und kontrolliertem Retry sowie
  signiertem Bounce-/Complaint-Rueckkanal, fail-closed Empfaengersperren und
  auditierter Freigabe
- Tenantgebundener OpenID-Connect-Login mit PKCE, optionaler SSO-only-Policy,
  Einladungsaktivierung, Member-Provisionierung, expliziter Owner-Verknuepfung,
  frischem Owner-Step-up, zusaetzlichem MFA-Nachweis bei aktivierter persoenlicher
  MFA vor interaktiven Konfigurationsaenderungen und eigener Session-Provenienz
- TOTP-MFA fuer Owner, Admins und Trainer mit Login-Challenge,
  Einmal-Recovery-Codes, tenantweiter Pflicht-Policy, Replay-Schutz und sicherem
  SSO-Step-up
- Persistente Medienplattform mit lokalen/S3-Speichertreibern, unveraenderlichen
  Objektversionen, Quota, signierten URLs, strukturierter Datei-Pruefung,
  ClamAV-Streaming-Scan, Retention sowie Upload-Oberflaechen fuer Abgaben,
  Kursinhalte, Kurs-Widgets, Community, Profile und Branding; Videoeditor und
  Player unterstuetzen mehrere Schnittbereiche, bis zu acht immutable
  gebundene Audiospuren mit Timeline-Offset, Quelltrim und Lautstaerke,
  komprimierte effektive Wiedergabezeit und versionierte Endkarten mit sicherer
  CTA
- Strikte, renderbare Kurscover-Policy fuer lokale Bilder und private,
  zugriffsgebundene Medien statt beliebiger externer Bildquellen
- Vollstaendige mandantengebundene REST-API mit API-Keys, Scopes, Idempotenz,
  Audit-Log sowie Webhooks mit Claim-Token, Dead-Letter-Replay und
  unveraenderlicher sanitisierter Versuchshistorie in OpenAPI 3.1
- Providerneutrale Commerce-Domaene mit signierten, idempotenten Adaptern fuer Digistore24, Ablefy und Copecart, Produkt-Bundle-Mappings, Order-/Subscription-Lifecycle und quellenbezogenen Entitlements
- Versionierte Pakete fuer Zapier CLI 19 und Make Apps Editor mit Scope-Test,
  dynamischer Bundleauswahl, getrenntem Grant/Revoke, Idempotenz und
  Secret-Sanitization; dedizierte signierte n8n-Workflows mit durable
  Retry-Queue sowie tenantkonfigurierbarer Link-, E-Mail- oder
  Intercom-Supportlauncher
- Orbit-Control-Plane mit globalen Accounts, Workspaces, Rollen und
  Permission-Sets, Kundenslots, Instanzverknuepfung, Partnerdelegation,
  Entitlements, Audit, revisionsgebundener Monats-/Jahresabrechnung mit
  unveraenderlicher Preishistorie und idempotentem Cross-Tenant-Kursinhaltstransfer
- Responsive Desktop- und Mobiloberflaeche, installierbare PWA,
  sitzungsgebundene Web Push sowie vorbereitete Capacitor-8-Apps fuer Android,
  iPhone und iPad mit Deep Links und verschluesselter APNs-/FCM-Push-Queue
- Tenant-Theme `light`/`dark`/`system` und serverseitig aufgeloeste
  Kernoberflaechen in Deutsch, Englisch, Italienisch, Spanisch und Franzoesisch;
  typisierte Fachaktionscodes und explizite Locale-Weitergabe haerten
  Fehlermeldungen sowie Datums-, Zeit-, Dauer- und Zahlenformate
- Revisionsgebundene Tenant-Vertraege mit serverseitigen Seat-, Kurs-,
  Speicher-, KI- und Feature-Grenzen sowie DNS-verifizierte Custom-Domain-
  Claims mit Create/Rotate/Verify/Revoke-Lifecycle
- Kontrolliertes Tenant-Offboarding mit typisiertem Policy-Manifest,
  Mindestwartefrist und Legal-Hold-Sperre, verschluesseltem/HMAC-verkettetem
  Auditarchiv, verifiziertem Media-/S3-Purge, Receipt-autorisiertem
  PostgreSQL-Cascade und separat belegtem Backup-Auslauf

## Stack

- Next.js 16 App Router und React 19
- TypeScript und Tailwind CSS 4
- PostgreSQL mit Drizzle ORM
- Aktueller Datenstand: 170 PostgreSQL-Tabellen und 74 versionierte Migrationen
  bis einschliesslich `0073_intercom_identity_fail_closed`;
  DSAR-Exportschema 23
- Signierte HTTP-only Sessions mit serverseitiger Widerrufsliste und `jose`
- Playwright fuer End-to-End- und visuelle Tests

Fuer lokale Entwicklung kann das Projekt ueber `embedded-postgres` eine echte,
persistente UTF-8-PostgreSQL-Instanz unter `.data/postgres` starten. In
Produktion wird dieselbe Anwendung ueber `DATABASE_URL` mit einer externen
PostgreSQL-Datenbank verbunden. Migration und Readiness lehnen Datenbanken ab,
deren `server_encoding` nicht `UTF8` ist.

## Produktionsreife

Der aktuelle Repository-Stand enthaelt neben der umfangreichen Anwendung eine
gehaertete Rootserver-, CI-, Migrations-, Queue-, Backup- und Betriebsbasis. Der
CI-Workflow prueft das exakte Produktions-App-Image hinter einem lokalen
HTTPS/TLS-Proxy per Browser-Smoke, bindet die Image-ID vor und nach dem Lauf und
verpackt anschliessend genau die getesteten Release-Images. Das ist ein lokaler
Workflow- und Artefaktvertrag, aber noch kein Nachweis eines geschuetzten
Main-Laufs oder Rootserver-Deployments. Der Stand ist deshalb weiterhin keine
formal freigegebene Kundenproduktion. Vor realen Kundendaten muessen die
verbleibenden externen Pilot-Gates im
[Production-Readiness-Plan](./PRODUCTION_READINESS_PLAN.md) abgeschlossen und
abgenommen werden. Technische Risiken und Datenklassen sind im
[Threat Model](./docs/THREAT_MODEL.md) sowie in
[Daten, Retention und DSAR](./docs/DATA_RETENTION_AND_DSAR.md) dokumentiert. Das
technische [Cookie- und Tracking-Inventar](./docs/COOKIE_TRACKING_INVENTORY.md)
erfasst First-Party-Cookies, Browser-Speicher, Intercom, Click-to-load-Iframes
und konfigurierbare Drittanbieterflaechen; die rechtliche Consententscheidung
bleibt ein externes Pilot-Gate.

Der OIDC-Core ist lokal vollstaendig implementiert und getestet. Ein echter
Kundenbetrieb verlangt weiterhin die Registrierung des jeweiligen Clients beim
Identity Provider sowie abgenommene kanonische DNS-/TLS-Hosts. Einrichtung,
Providervertrag und Sicherheitsgrenzen beschreibt
[OIDC_SSO.md](./docs/OIDC_SSO.md).

Tenant-Standard und optionale Nutzerpraeferenz unterstuetzen `de`, `en`, `it`,
`es` und `fr`. Kernnavigation, globale Suche, Auth-/Login-MFA-Flows, sichere
Systemmails, eine deklarierte Flaeche aus 18 zentralen Admin-/Academy-Routen
sowie zusaetzliche Community-, Kurseditor-, Hub- und Einstellungs-Kataloge
verwenden dieselbe serverseitige Aufloesung. Typisierte Dictionary-Vertraege
pruefen auch Autoren-, Pruefungs- und Fachaktionen auf Key-, Platzhalter- und
Leerwertparitaet; das Mailcenter umfasst 54 Copy-Werte je Locale.
Muttersprachliche Fach-, Rechts- und UX-Abnahmen bleiben ein Marktfreigabe-Gate.
Modell und Fallbacks stehen in [LOCALIZATION.md](./docs/LOCALIZATION.md).

Der belegte Produktumfang, verbleibende Vertiefungen und externe Abnahme-Gates
stehen in der
[Feature-Paritaetsmatrix](./docs/FEATURE_PARITY.md).

Tenant-Vertragsstatus, Entitlements und serverseitige Seat-, Kurs-, Speicher-
und KI-Grenzen sind in [TENANT_CONTRACTS.md](./docs/TENANT_CONTRACTS.md)
dokumentiert. Die lokale Operations-CLI ist bewusst von einem spaeteren
externen Billing-Provider getrennt.

Manipulationsnachweis, Key-Rotation und WORM-Uebergabe fuer tenantgebundene
Betriebsexporte beschreibt [AUDIT_EXPORT.md](./docs/AUDIT_EXPORT.md).

Die vorhandenen Rollen- und Kernworkflows sind im
[Rollenhandbuch](./docs/USER_GUIDE.md) zusammengefasst. Onboarding,
Owner-Uebergabe, Sperrung, Reaktivierung, Offboarding und sichere Support-Triage
stehen im [Tenant Operations Runbook](./docs/TENANT_OPERATIONS_RUNBOOK.md).
Die bewusste aktuelle Entscheidung gegen eine teilweise PostgreSQL-RLS-
Aktivierung samt Neubewertungskriterien dokumentiert
[ADR_POSTGRES_RLS.md](./docs/ADR_POSTGRES_RLS.md).

## Lokal starten

Voraussetzung: Node.js 22.

```powershell
npm install
```

Terminal 1, lokale PostgreSQL-Instanz:

```powershell
npm run db:dev
```

Beim ersten Start in Terminal 2 Schema anwenden und Demo-Daten laden:

```powershell
$env:ALLOW_DESTRUCTIVE_SEED = "true"
$env:SEED_EXPECTED_DATABASE = "q_academy"
npm run db:setup
Remove-Item Env:ALLOW_DESTRUCTIVE_SEED, Env:SEED_EXPECTED_DATABASE
```

Danach die Anwendung starten:

```powershell
npm run dev
```

Die Anwendung ist unter [http://localhost:3000](http://localhost:3000) erreichbar.

## Demo-Zugaenge

| Rolle | E-Mail | Passwort |
| --- | --- | --- |
| Admin | `admin@q-academy.de` | `Demo123!` |
| Mitglied | `lea@q-academy.de` | `Demo123!` |

Auf der Login-Seite gibt es fuer beide Rollen einen Direktzugang.
Die Direktzugaenge werden nur in der lokalen Entwicklungsumgebung gerendert. `ENABLE_DEMO_LOGIN` bleibt bei produktiven Deployments deaktiviert.

## Externe PostgreSQL-Datenbank

1. `.env.example` nach `.env` uebernehmen.
2. `DATABASE_URL` auf eine PostgreSQL-Datenbank mit `server_encoding=UTF8` setzen.
3. Fuer `SESSION_SECRET`, `AUTH_RATE_LIMIT_SECRET`,
   `PRIVACY_SUBJECT_HMAC_SECRET`, `EXAM_SELECTION_SECRET`,
   `DATA_ENCRYPTION_KEY`, `WEBHOOK_ENCRYPTION_KEY`,
   `MFA_RECOVERY_PEPPER`, `EMAIL_DELIVERY_INBOUND_SECRET`, `CRON_SECRET` und
   `METRICS_SECRET` jeweils
   unabhaengige Zufallswerte setzen. Fuer Daten-, Webhook- und MFA-Keyrings
   zusaetzlich `DATA_ENCRYPTION_KEY_ID`, `WEBHOOK_ENCRYPTION_KEY_ID` und
   `MFA_RECOVERY_PEPPER_ID` setzen.
4. Fuer Produktion ein authentifiziertes HTTPS-Mail-Gateway konfigurieren und `EMAIL_DELIVERY_REQUIRED=true` setzen.
5. Juristisch freigegebene `LEGAL_IMPRINT_URL`, `LEGAL_PRIVACY_URL` und `SUPPORT_EMAIL` setzen.
6. Ein eigenes VAPID-P-256-Schluesselpaar als `WEB_PUSH_VAPID_PUBLIC_KEY`,
   `WEB_PUSH_VAPID_PRIVATE_KEY` und `WEB_PUSH_VAPID_SUBJECT` konfigurieren.
7. `npm run db:migrate` ausfuehren.

`npm run db:push` ist fuer die lokale Schemaentwicklung gedacht. Produktionsrollouts verwenden die versionierten Migrationen unter `drizzle/`.

`NEXT_PUBLIC_APP_URL` muss in Produktion auf die kanonische HTTPS-Basis der
Anwendung zeigen. `APP_DOMAIN` muss exakt deren Hostname sein und
`DEFAULT_ORGANIZATION_SLUG` einen bestehenden aktiven Tenant benennen; eine
Abweichung macht die Anwendung nicht readiness-faehig. Optional kann
`AI_API_KEY` fuer einen OpenAI-kompatiblen Provider gesetzt werden. Ohne
Schluessel arbeiten der Q-Coach und der KI-Kursassistent mit deterministischen
Fallbacks. Der Vertrag fuer den zwingenden Transaktionsmail-Dienst steht in
[MAIL_GATEWAY_CONTRACT.md](./docs/MAIL_GATEWAY_CONTRACT.md).

OIDC wird pro Tenant durch einen aktiven Owner konfiguriert. Jede interaktive
Konfigurationsaenderung verlangt einen frischen Owner-Step-up ueber das aktuelle
Passwort oder den Identity Provider und bei aktivierter persoenlicher MFA
zusaetzlich einen TOTP- oder unbenutzten Recovery-Code. Beim Identity Provider
muss die exakte kanonische Callback-URL
`https://<tenant-host>/api/v1/auth/oidc/callback` registriert sein. Der Provider
muss Discovery, Authorization Code, PKCE S256, `client_secret_post`, die Scopes
`openid email` und asymmetrisch signierte ID-Tokens unterstuetzen. Details und
die sichere Reihenfolge fuer einen SSO-only-Tenant stehen in
[OIDC_SSO.md](./docs/OIDC_SSO.md).

Login, Passwort-Reset-Anforderung und Passwort-Reset verwenden gemeinsame atomare PostgreSQL-Ratenlimits mit ausschliesslich gehashten Identifikatoren. `X-Forwarded-For` wird standardmaessig ignoriert. `TRUST_PROXY_HEADERS=true` darf nur gesetzt werden, wenn ein vertrauenswuerdiger Reverse Proxy eingehende Forwarding-Header entfernt und selbst mit einer validen Client-IP neu setzt.

Das Tenant-Branding umfasst Plattformname, Primaer- und Akzentfarbe, gepruefte
Standard-/Light-/Dark-Logos, Favicon, Link-Vorschaubild, eine sichere lokale
Schriftfamilie, den Eckenradius sowie Login-Titel, -Beschreibung,
Hintergrundbild und Hintergrundfarbe. Neue Profil- und Branding-Bilder laufen
durch dieselbe Upload-, Struktur- und Malware-Pruefung wie andere Medien und
werden erst im Zustand `ready` gebunden. Nach der Anmeldung wird immer das
Branding der Organisation aus der Session verwendet. Vor der Anmeldung wird der
Tenant nur ueber den exakten kanonischen `APP_DOMAIN`-Host fuer
`DEFAULT_ORGANIZATION_SLUG`, einen eindeutigen verifizierten
Custom-Domain-Claim oder mit `TENANT_BASE_DOMAIN` exakt ueber
`<tenant-slug>.<base-domain>` ermittelt. Nur in der lokalen Entwicklung gelten
zusaetzlich `<tenant-slug>.localhost` und `localhost`. Unbekannte Hosts bleiben
beim neutralen Standard-Branding und koennen weder einen Tenant authentifizieren
noch dessen Branding-Medien abrufen.

Der Medienworkflow reserviert Tenant-Quota atomar, verwendet in Produktion einen
privaten versionierten S3-kompatiblen Bucket, bindet Scan und Download an exakte
Objektversionen und prueft MIME-Typ, Groesse, Struktur, SHA-256 und Malware.
Browser-Sessions sowie die REST-API koennen Abgabe-, Kurs-, Community-, Profil-
und Branding-Bilder hochladen; nur `ready`-Objekte werden atomar gebunden und
autorisiert heruntergeladen. Der Kurs-Widget-Picker bindet private Bilder mit
kanonischer Download-URL tenant- und kursgebunden; oeffentliche Bildquellen
bleiben kompatibel. Community-Posts erlauben bis zu sechs, Kommentare bis zu drei
gepruefte Bild-, Audio-, Video- oder Dokumentanhaenge. Eine globale,
unveraenderliche Bindungsregistrierung verhindert Wiederverwendung und
mandantenfremde Bindungen; Inhaltsloeschungen erzeugen Medien-Tombstones,
ungebundene Community-Uploads laufen nach 24 Stunden ab. Die aktuellen
Open-/Restricted-Policies werden fuer Rollen, Personen, Gruppen und Bundles mit
`view`-, `post`- und `comment`-Rechten serverseitig in Feed, Suche, Dashboard,
Mentions, Reports, Reaktionen, Votes und REST-API durchgesetzt. Der erklaerbare
Feed verwendet signierte, akteur- und revisionsgebundene Keyset-Cursor; Follow-,
Boost-, Lese- und Interaktionspfade besitzen persistente Benutzer- und
Mandantenlimits. Der Recorder fuer Mikrofon, Kamera und Bildschirm ist in
Abgaben integriert. Gepruefte MP4-, MOV-, M4A-, WAV-, MP3-, Ogg- und
WebM-Dauern werden serverseitig ressourcenbegrenzt ermittelt. Deduplizierte
Lease-Jobs erzeugen lokal und im isolierten S3-Runner mit FFmpeg verifizierte
Thumbnails und H.264/AAC-Derivate aus den erhaltenen Segmenten; der Editor zeigt
Trimgrenzen, mehrere nicht ueberlappende Schnittbereiche, Thumbnail-Marker,
Untertitel und Vorschau auf einer visuellen Timeline. Audio-
und Videobloecke nehmen Mikrofon, Kamera plus Mikrofon oder Bildschirm auf und
uebergeben bestaetigte Vorschauen ausschliesslich an den bestehenden
`course_content`-Upload-/Scan-Workflow. Der Player ueberspringt entfernte
Segmente, bildet Seek und Fortschritt auf die komprimierte effektive Zeit ab und
erzwingt Pflichtwiedergabe sowie Vorspulregeln auch beim Lektionsabschluss.
Versionierte Endkarten zeigen begrenzten Titel/Text, eine sichere interne oder
HTTP(S)-CTA und Replay. Bis zu acht Audiospuren lassen sich aus der
tenant- und kursbegrenzten Medienbibliothek waehlen, trimmen, zeitlich
versetzen und in der Lautstaerke regeln. Der Renderjob friert jede Quelle mit
Key, Version, ETag, SHA-256, Groesse und Dauer ein; Publishing und
Mitgliedsauslieferung akzeptieren nur den exakt gebundenen erfolgreichen Job.
Automatische
Transkripte werden asynchron ueber einen lokalen STT-Befehl als begrenztes,
validiertes WebVTT erzeugt und koennen fuer Untertitel sowie zeitcodierte Suche
uebernommen werden. Profilbilder und Medien-Profilfelder laufen durch dieselbe
tenantgebundene `ready`-Asset-Pipeline. Der S3-Runner bindet exakte VersionId,
ETag und SHA-256, verifiziert Derivat-Uploads und bereinigt sein dediziertes,
diskbasiertes sowie groessenbegrenztes `nodev,nosuid,noexec`-Arbeitsfilesystem.
Konkrete S3-/FFmpeg-, STT-Modell-/Sprach- und Lastabnahmen bleiben
betriebliche Gates.

Die installierbare PWA verwendet absichtlich nur das neutrale Q-Academy-Default-Branding im Manifest und in der Offline-Seite. Der Service Worker wird in Produktion automatisch registriert; lokal kann er mit `NEXT_PUBLIC_ENABLE_PWA=true` explizit aktiviert werden. Er speichert ausschliesslich die neutrale Offline-Seite, versionierte App-Icons und von Next.js als `immutable` ausgelieferte `/_next/static/`-Assets. Navigations- und API-Antworten, tenant-spezifische Bilder sowie Cookies oder andere Anmeldedaten werden nie gecacht. Nach Aenderungen am Service Worker muss `CACHE_NAME` in `public/sw.js` erhoeht werden.

Web Push verwendet denselben Service Worker, speichert Capability-Endpunkte und
Clientschluessel nur AES-256-GCM-verschluesselt und bindet jedes Abonnement an
den exakten Login-Session-Datensatz. Konfiguration, Rotation, Browserverhalten
und Queue-Betrieb stehen in [WEB_PUSH.md](./docs/WEB_PUSH.md).

Die nativen Capacitor-Container, Deep-/Universal-Link-Vertraege und die
sitzungsgebundene APNs-/FCM-Zustellqueue sind lokal implementiert. Vor einer
Store-Auslieferung muessen Bundle-ID, Apple-/Google-Credentials,
Association-Dateien auf dem kanonischen HTTPS-Host, Signierung, Store-Metadaten
und reale Geraetetests abgenommen werden; siehe
[MOBILE_DEPLOYMENT.md](./docs/MOBILE_DEPLOYMENT.md).

`npm run db:seed` setzt die Datenbank vollstaendig auf Demo-Daten zurueck. Der Befehl ist in Produktion gesperrt, akzeptiert nur Loopback-Testdatenbanken und verlangt `ALLOW_DESTRUCTIVE_SEED=true` sowie eine exakt passende `SEED_EXPECTED_DATABASE`.

## Rootserver-Deployment

Die vorbereitete Produktion besteht aus Caddy mit statischem Auto-TLS fuer den
Plattformhost und fail-closed On-Demand TLS fuer verifizierte Custom Domains,
einer Non-root-App,
einem davon getrennten und ressourcenbegrenzten Medienrunner, einem separaten
Migrator, PostgreSQL 16 mit getrennten Owner-/App-/Medienrollen, internem Scheduler,
internem ClamAV-1.5-Dienst sowie verifiziertem Backup/Restore. Der
Medienbetrieb setzt zusaetzlich einen externen privaten S3-kompatiblen Bucket
mit getrennten App- und Worker-Principals sowie Job-Secrets voraus. Installation,
Firewall, DNS, Secrets, Deployment und Rollback stehen in
[ROOTSERVER_DEPLOYMENT.md](./docs/ROOTSERVER_DEPLOYMENT.md).
Das Rootserver-Paket enthaelt ausserdem einen gehaerteten systemd-Service samt
taeglichem Timer fuer restore-verifizierte PostgreSQL-Backups. Diagnose,
Provider-Degradation, Recovery-Gates und knappe Statusvorlagen stehen im
[INCIDENT_RESPONSE_RUNBOOK.md](./docs/INCIDENT_RESPONSE_RUNBOOK.md).
Sicherheitsmeldungen laufen nach [SECURITY.md](./SECURITY.md); der aus dem
Lockfile erzeugte Produktions-Lizenzbestand steht in
[THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).
Die externe Providerregistrierung fuer jeden produktiven OIDC-Tenant ist kein
Bestandteil des lokalen Deployments und bleibt ein Go-live-Gate.
Produktive Tenant-, Export-, Loesch- und HTTP-SLO-Kommandos laufen auf dem
Node-freien Rootserver ausschliesslich im releasegebundenen Operations-Profil;
siehe [TENANT_OPERATIONS_RUNBOOK.md](./docs/TENANT_OPERATIONS_RUNBOOK.md). Die
folgenden npm-Beispiele sind nur fuer eine lokale Operator-Arbeitskopie gedacht.

## Betriebswerkzeuge

Neuen Tenant mit verschluesselter Owner-Mail-Outbox provisionieren:

```powershell
$env:DATABASE_URL = "postgresql://..."
$env:DATA_ENCRYPTION_KEY = "..."
npm run -- tenant:provision -- --name "Acme Academy" --slug "acme" --owner-email "owner@acme.de" --owner-first-name "Erika" --owner-last-name "Musterfrau" --app-url "https://academy.example.org"
```

Eine eigene Login-Domain wird nach Annahme der Owner-Einladung unter
`/admin/settings` oder ueber `POST /api/v1/organization/domains` beansprucht,
nicht waehrend der Provisionierung gesetzt. Create und Rotate geben den
einmaligen, 24 Stunden gueltigen TXT-Wert fuer
`_q-academy-verification.<hostname>` genau einmal aus. Verify gibt die Domain
fuer Caddys On-Demand TLS frei; A/AAAA oder CNAME muessen danach auf den
Rootserver zeigen, und das Zertifikat entsteht beim ersten HTTPS-Aufruf. Revoke
entfernt sie aus Login-, Branding- und OIDC-Aufloesung und verweigert weitere
TLS-Autorisierungen.
Lokale `<tenant-slug>.localhost`-Hosts und die kontrollierte
`TENANT_BASE_DOMAIN` brauchen keinen Claim.

Tenant sperren, reaktivieren oder ins Offboarding setzen. Sperrung widerruft
Sessions und API-Keys; Reaktivierung stellt alte Credentials nicht wieder her:

```powershell
npm run -- tenant:status -- --slug "acme" --status suspended --confirm "acme"
```

Tenantgebundenen DSGVO-Datenexport als neue, nicht ueberschreibbare JSON-Datei
erzeugen:

```powershell
npm run -- user-data:export -- --organization-slug "acme" --user-email "person@acme.de" --output "C:\secure\acme-person.json"
```

## Qualitaetspruefung

```powershell
npm run verify:local
npm run test:unit
npm run test:integration
npm run test:accessibility
npm run test:load -- --origin http://127.0.0.1:3000 --confirm-origin http://127.0.0.1:3000 --scenario health --require true
npm run typecheck
npm run lint
npm run api:check-contract
npm run security:scan-secrets
npm run security:scan-secrets:history
npm run notices:check
npm run db:check
npm run db:test-migrations
npm run test:e2e
npm run build
npm audit --omit=dev --audit-level=moderate
```

Der reproduzierbare lokale Release-Runner, lange Checks und explizite externe
Provider-Gates sind in [docs/LOCAL_VERIFICATION.md](docs/LOCAL_VERIFICATION.md)
dokumentiert. Das abgesicherte Lasttest-Harness, Credential-Dateien,
Thresholds und Evidence-Reports beschreibt
[docs/LOAD_TESTING.md](docs/LOAD_TESTING.md).

`test:integration` verwendet einen bereits laufenden lokalen Q-Academy-Server
auf Port 3000 oder startet selbst einen isolierten Next.js-Testserver. Ein
explizites `TEST_BASE_URL` muss auf einen erreichbaren und betriebsbereiten
Q-Academy-Server zeigen; fremde oder nicht migrierte Ziele werden abgelehnt.

Weitere Datenbankbefehle:

```powershell
npm run db:generate
npm run db:migrate
npm run db:test-migrations
npm run db:push
npm run db:studio
```

## Projektstruktur

- `src/app/(admin)/admin`: Admin-Routen
- `src/app/(member)/academy`: Mitglieder-Routen
- `src/components`: Layout, UI, Editor und interaktive Lernkomponenten
- `src/db/schema.ts`: PostgreSQL-Datenmodell
- `src/app/api/v1`: versionierte REST-Routen
- `src/lib/api/openapi.ts`: maschinenlesbarer API-Vertrag
- `src/lib/*-actions.ts`: autorisierte Server Actions
- `src/lib/data.ts`: serverseitige Datenzugriffe
- `drizzle`: versionierte PostgreSQL-Migrationen
- `scripts/seed.ts`: realistische Demo-Academy
- `tests`: API-, Sicherheits-, Admin-, Lern- und responsive Browser-Flows
