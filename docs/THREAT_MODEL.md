# Q-Academy Threat Model

Stand: 2026-07-14. Dieses Dokument bewertet den vorbereiteten Ein-Rootserver-
Stack. Es ersetzt weder einen externen Penetrationstest noch eine rechtliche
Risikobewertung.

## Schutzgueter

- Tenant-, Benutzer-, Lern-, Community-, Feedback- und Analysedaten
- Passwort-Hashes, Sessions, Einladungs- und Reset-Tokens sowie verschluesselte
  TOTP-Secrets, Recovery-Verifier und MFA-Challenges
- API-Keys, Webhook-Secrets, OIDC-Client-Secrets sowie Daten-, Session- und
  HMAC-Schluessel
- OIDC-Issuer/Subject-Bindungen, erlaubte E-Mail-Domains und
  Authentifizierungsprovenienz von Sitzungen
- KI-Prompts, Antworten, Quellen, Nutzungsmetadaten und die Integritaet
  versionierter Aktionsfreigaben
- Private Medienobjekte, Abgabeanhaenge, Scanstatus und reservierte Tenant-Quota
- Verfuegbarkeit von Anwendung, PostgreSQL, Queues und Backups
- Integritaet von Zertifikaten, Fortschritt, Rollen und Audit-Eintraegen
- Integritaet von Datenschutzfaellen, Legal Holds, append-only Ereignissen und
  verschluesselten Exportartefakten
- Native APNs-/FCM-Geraetetokens und Zustellmetadaten
- Globale Orbit-Identitaeten, Delegationen, Entitlements und Transfer-Audit

## Vertrauensgrenzen

1. Browser oder API-Client zu Caddy ueber oeffentliches HTTPS.
2. Caddy zu Next.js im privaten Docker-Netz.
3. Next.js mit DML-App-Rolle zu PostgreSQL im internen Datenbanknetz.
4. Einmaliger Migrator mit DB-Owner-Rechten zu PostgreSQL.
5. Scheduler zu geschuetzten internen Job-Endpunkten.
6. Worker zu Mail-Gateway, Webhook-Zielen und optionalem KI-Provider.
7. Browser und Medienworker zum privaten S3-kompatiblen Objektspeicher.
8. Medienworker zum internen ClamAV-Dienst.
9. Rootserver zu lokalem und extern repliziertem Backup-Ziel.
10. Owner-Browser und explizit privilegierte API-Keys zum DSAR-Fallmodell.
11. Operator-CLI zu Provisionierung, Tenant-Lifecycle und DSAR-Export.
12. Browser ueber den externen Identity Provider zur exakt registrierten
    tenantgebundenen OIDC-Callback-Route.
13. App-Worker zu Apple APNs und Google FCM sowie nativer Container zum
    kanonischen HTTPS-Host und den Association-Dateien.
14. Verifizierte Tenant-Identitaeten zur globalen Orbit-Control-Plane und von
    dort ueber explizite Instanzberechtigungen zum Cross-Tenant-Transfer.

## Bedrohungen und Kontrollen

### Tenant-Isolation und Autorisierung

Risiken: manipulierte IDs, fremde Hostnamen, API-Key eines anderen Tenants,
fehlerhafte Joins und suspendierte Tenants mit weiter gueltigen Credentials.

Kontrollen:

- Tenant-ID wird aus signierter Session oder gehashtem API-Key abgeleitet.
- Ressourcenabfragen und Mutationen sind serverseitig an `organization_id`
  gebunden und durch Cross-Tenant-Tests abgedeckt.
- Eigene Login-Hostnamen werden normalisiert und global eindeutig als
  ablaufender DNS-TXT-Claim beansprucht; nur aktive, verifizierte Claims einer
  aktiven Organisation werden fuer Login, Branding und OIDC aufgeloest.
- Suspension/Offboarding widerruft Sessions und API-Keys; zentrale Guards
  blockieren Login, Recovery, Einladungen, Branding, API und Queues.
- Letzter aktiver Owner ist in den vorhandenen Rollenmutationen geschuetzt.

Restrisiko: PostgreSQL-RLS ist nicht aktiviert. Ein Anwendungsfehler in einer
neuen Query bleibt deshalb relevant und muss weiterhin durch Review und
Isolationstests abgefangen werden. Entscheidung, Neubewertungs-Trigger und
Einfuehrungsanforderungen stehen in
[ADR_POSTGRES_RLS.md](./ADR_POSTGRES_RLS.md).

### Authentifizierung und Secrets

Risiken: Credential Stuffing, Token-Diebstahl, Session-Replay, bekannte Demo-
Credentials, OIDC-Claim-/Issuer-Verwechslung, unberechtigte Kontoverknuepfung,
MFA-Challenge-/TOTP-Replay, Recovery-Code-Raten und -Diebstahl, SSO-Lockout und
unsichere Produktionskonfiguration.

Kontrollen:

- bcrypt Kostenfaktor 12, starke Regeln fuer neue Passwoerter und zeitlich
  begrenzte, nur gehasht gespeicherte Einmal-Tokens.
- Atomare PostgreSQL-Ratenlimits fuer Login, Recovery, API und KI.
- Signierte HTTP-only Sessions mit serverseitiger Widerrufsliste; Produktion
  nutzt ein `Secure`/`SameSite=Lax`-Cookie mit `__Host-`-Prefix.
- Owner, Admins und Trainer mit aktiver MFA oder tenantweiter Pflicht-Policy
  erhalten nach dem Primaerfaktor nur eine zehn Minuten gueltige, HttpOnly,
  `SameSite=Lax` und in Produktion `Secure`/`__Host-` gebundene Challenge. Die
  Anwendungssitzung entsteht erst nach dem zweiten Faktor.
- TOTP-Secrets sind mit tenant-/nutzergebundenen Associated Data und Key-ID
  verschluesselt. Recovery-Codes liegen nur als versionierte HMAC-Envelopes
  vor, werden einmalig verbraucht und TOTP-Counter atomar gegen Replay
  fortgeschrieben. Ein tenant-/nutzergebundener Versuchsbucket ueberlebt neue
  Challenges und Passwort-Logins.
- Fail-fast-Validierung fuer getrennte starke Secrets, HTTPS-Origins,
  Least-Privilege-DB-Zugang und zwingende Mailzustellung.
- Demo-Seed, Demo-Passwort und bekannter Demo-API-Key sind in Produktion
  technisch blockiert.
- OIDC verwendet ausschliesslich Discovery plus Authorization Code, PKCE S256,
  State und Nonce. Die kryptografisch hoechstens zehn Minuten gueltige
  Logintransaktion ist authentifiziert verschluesselt und an Tenant, Issuer,
  Konfigurationsversion, exakte Callback-URL und gegebenenfalls die aktuelle
  Sitzung gebunden; das Host-only-Transaktionscookie laeuft ebenfalls nach zehn
  Minuten ab. Eine separate signierte Client-Kennung fuer das OIDC-Start-
  Ratenlimit laeuft nach 15 Minuten ab.
- Nur kanonische Tenant-HTTPS-Urspruenge werden als Callback akzeptiert.
  Authorization-, Token- und JWKS-Endpunkte durchlaufen eine SSRF-sichere
  Zielpruefung; kompatible Provider muessen `client_secret_post`, `openid email`
  und asymmetrisch signierte ID-Tokens anbieten.
- Identitaeten erfordern `email_verified=true`; JIT-Provisionierung erstellt
  ausschliesslich Member und verlangt eine explizite Domain-Allowlist. Owner,
  Admins und Trainer werden nie allein aufgrund gleicher E-Mail verknuepft.
- Die Verknuepfung des aktuellen Ownerkontos startet als same-origin POST und
  verlangt eine frische Provideranmeldung. Passwort-Login kann erst in einem
  getrennten Schritt abgeschaltet werden, nachdem ein aktiver Owner die aktuelle
  SSO-Konfiguration erfolgreich verwendet hat.
- Interaktive OIDC-Konfigurationsaenderungen erfordern bei jedem Speichern einen
  frischen Owner-Step-up ueber aktuelles Passwort oder Provider und bei aktiver
  persoenlicher MFA zusaetzlich TOTP oder einen unbenutzten Recovery-Code. Beide
  Nachweise liegen vor jedem Discovery- oder Providerzugriff.
- OIDC-Sessions speichern Identity-, Konfigurations- und Auth-Time-Provenienz,
  laufen nach 12 Stunden beziehungsweise einer Stunde Inaktivitaet ab und werden
  bei einer kritischen Providerkonfigurationsaenderung widerrufen.
- `authentication:read` und `authentication:write` sind ownergebundene Scopes;
  Wildcard-Keys erhalten sie nicht und API-Keys koennen sie nicht delegieren.

Restrisiken: Produktive MFA-Enrollment-/Recovery-Ablaeufe, getrennte Verwahrung
der Recovery-Codes und die Pflicht-Policy sind mit realen Betreibern noch nicht
praktisch abgenommen. Produktive IdP-Registrierung, IdP-Account-Recovery und
Ausfallverfahren sind ebenfalls offen; RP-initiated/Backchannel Logout, SCIM
und SAML sind nicht implementiert. Secrets liegen im vorbereiteten Rootserver-
Modell in einer Datei mit Modus 0600 statt in einem externen Secret Manager.
Versionierte Daten- und Webhook-Keyrings, Legacy-Lesepfade und ein
transaktionaler Online-Rekey sind vorhanden; reale Rotation, Secret-Manager und
Recovery-Uebung muessen vor Kundendaten betrieblich abgenommen werden.

### Browserzustand, Cookies und Drittanbieter

Risiken: unbemerkte neue Cookie-Schreibstellen, optionale Tracker- oder Support-
SDKs ohne Rechtsgrundlage, Drittanbieter-Verbindungen vor Nutzerinteraktion,
personenbezogene Daten in langlebigem Browser-Speicher und tenantindividueller
Custom-Code mit nicht bewerteten externen Zielen.

Kontrollen:

- Das strukturierte
  [Cookie- und Tracking-Inventar](./COOKIE_TRACKING_INVENTORY.md) bindet Name,
  Quelle, Zweck, Lebensdauer, `SameSite`, `Secure`, `HttpOnly` und technische
  Notwendigkeit fuer Session, MFA und beide OIDC-Cookies an den Quelltext.
- Ein AST-basierter Regressionstest scheitert bei jeder neuen Cookie-
  Schreibstelle, jedem direkten `Set-Cookie`-/`document.cookie`-Pfad, bekannten
  Tracker-/Telemetry-SDKs und neuen Browser-Scriptloadern, bis das Inventar
  explizit aktualisiert und geprueft wurde.
- YouTube-Nocookie, Vimeo, Loom, Microsoft Forms und Google Forms werden als
  Kurs-Iframes erst nach einem expliziten Click-to-load erzeugt. Der Katalog
  erlaubt nur den jeweils fest gebundenen HTTPS-Host.
- Intercom ist tenantoptional und der einzige bekannte Browser-SDK-Loader. Das
  Identity-Secret bleibt serverseitig; die automatische Browserverbindung bei
  aktivierter Konfiguration und providerkontrollierter Speicher sind im
  Inventar sichtbar und nicht als rechtlich freigegeben markiert.
- Plattform-Custom-Code ist standardmaessig aus, ownergebunden und auf acht
  explizite HTTPS-Origins begrenzt. Er laeuft in einem Opaque-Origin-Iframe mit
  `sandbox=allow-scripts`, ohne Same-Origin-, Referrer- oder Zugriff auf Cookies
  und Storage der Q-Academy-Origin. Hub-Custom-Code besitzt zusaetzlich eine
  netzlose Sandbox-CSP.
- Der PWA-Cache speichert nur oeffentliche neutrale Ressourcen mit ausgelassenen
  Credentials; Navigationen, APIs, Tenant-Medien und Anmeldedaten werden nicht
  gecacht.

Restrisiken: Rechtsgrundlage, Consentbedarf, Datenschutzhinweise und gegebenenfalls
ein Consent-Management-System sind fuer Intercom, Kursanbieter, funktionalen
Browser-Speicher und jeden Custom-Code-Origin noch festzulegen. Vor Pilotbetrieb
ist je realer Tenant-/Providerkonfiguration ein Browser- und Cookie-Scan noetig;
der statische Quelltext kann providerseitig geaenderte Cookies, Empfaenger,
Regionen oder Lebensdauern nicht belegen.

### Datenschutzfaelle und Exportartefakte

Risiken: fremde Subject-IDs, unberechtigte Admin-/API-Zugriffe, Wildcard-
Privilege-Eskalation, gefaelschte Statuswechsel, Legal-Hold-Umgehung,
Exportmanipulation, Storage-URL-Leaks und zu lange Artefaktaufbewahrung.

Kontrollen:

- Alle Fall-, Event-, Hold- und Artefakt-FKs sind tenantgebunden; Subject und
  Actor werden im unveraenderlichen Log nur als HMAC-Referenz gespeichert.
- Nur der aktive Owner sieht den Workflow. Identitaetspruefung, Freigabe,
  Verarbeitung, Holds und Download verlangen bei aktivem Passwort-Login das
  aktuelle Passwort und ein persistentes Fehlversuchslimit. In einem SSO-only-
  Tenant gilt stattdessen nur eine hoechstens fuenf Minuten alte, frische
  OIDC-Owner-Sitzung mit Provider-`auth_time` als Step-up.
- API-Privacy-Scopes werden nie von `*` impliziert, koennen nicht durch einen
  API-Key weiterdelegiert werden und erfordern einen aktiven Owner als
  Schluesselersteller. Die API bietet keine Lifecycle- oder Downloadmutation.
- Eine explizite Zustandsmaschine, Zeilensperren und atomare Event-/Activity-
  Eintraege verhindern freie Status-Patches und parallele Doppelverarbeitung.
- `privacy_request_events` blockiert Update, Delete und Truncate. Auch ein
  ungeplanter Tenant-Cascade-Delete scheitert fail-closed.
- Der JSON-Export mit `schemaVersion: 23` verwendet Repeatable Read,
  tabellenspezifische Projektionen,
  Secret-/URL-Sanitizing und ein Ausschlussmanifest. Webhook-Payloads,
  Antwortschluessel, Storage- und Claim-Daten bleiben ausgeschlossen. Eigene
  Kommentarreaktionen und Community-Scorebeitraege werden ohne Identitaeten
  anderer Mitglieder exportiert. Das Inventar deckt alle 170 Tabellen aus 74
  Migrationen ab. MFA wird nur als sicherer Status-, Zeit- und Policy-Kontext
  ohne Secret-, Hash- oder Replay-Material exportiert. KI-Unterhaltungen werden
  mit ihrer unveraenderlich gebundenen
  Agent-Version exportiert; sichere Versions- und Grant-Metadaten enthalten
  weder mutable Agent-Shells noch Systemprompts, Source-Inhalte, interne
  Source-/fremde Grant-Ziel-IDs oder Tool-/Grounding-Konfiguration. Zitate werden
  auf bereinigte, ID-freie Felder reduziert. Eigene Aktionsanfragen und
  Ereignisse enthalten nur sichere Labels, Ergebnisse, Revisionen und
  Zeitpunkte; interne Bindungen, Digests und Actor-Referenzen bleiben verborgen.
- Artefakte sind an Tenant, Fall und Artefakt-ID kryptografisch gebunden,
  write-once gespeichert, per SHA-256 geprueft und nur nach Owner-Step-up
  auslieferbar. Der Scheduler loescht fertige Artefakte nach sieben Tagen als
  exakte Datei beziehungsweise S3-Version und protokolliert dies append-only.
- In-Memory-Downloads sind bis zur Einfuehrung eines chunkweisen AEAD-Formats
  auf 32 MiB Klartext beziehungsweise 64 MiB verschluesseltes Envelope
  begrenzt; strukturiertes JSON darf 16 MiB und gebundene Medien duerfen
  12 MiB belegen. Ein exakter JSON-/ZIP-Preflight, finaler File-Stat mit
  EOF-Probe und der gezaehlte S3-Stream erzwingen die Grenzen vor oder waehrend
  der Allokation; S3-Header und Body teilen eine 30-Sekunden-Deadline.
  Persistente Owner-/Tenant-Ratenlimits, genau ein Read pro Tenant und maximal
  ein aktiver Privacy-Lauf pro App-Prozess begrenzen korrekte, aber missbraeuchlich
  wiederholte Step-ups sowie tenantuebergreifenden Speicherdruck. Alle Guards
  liegen vor dem Objektzugriff und scheitern bei Infrastrukturfehlern geschlossen.
  Jede Downloadantwort besitzt unabhaengig vom Client eine absolute
  Zehn-Minuten-Deadline und gibt ihre Prozess- und Tenant-Lease exakt einmal frei.

Restrisiken: Binary-Paket und Loesch-/Anonymisierungs-Executor sind lokal
implementiert; Pakete an den neuen Obergrenzen, S3-Versionierung und der komplette Lauf muessen
auf dem Zielsystem noch abgenommen werden. Rechtliche Policy, Legal-Hold-Entscheidungen,
Backup-Auslauf und ein externer unveraenderlicher Ledger-Export muessen vor
Kundendaten freigegeben werden. Eine S3-Lifecycle-Regel muss fehlgeschlagene
oder vor dem DB-Commit verwaiste Exportversionen als Defense-in-Depth entfernen.

### Webhooks und ausgehende Verbindungen

Risiken: SSRF, DNS-Rebinding, Cloud-Metadata-Zugriff, langsame Ziele,
Worker-Crash und tenantuebergreifende Queue-Blockade.

Kontrollen:

- Nur HTTPS-Port 443 und globales Unicast; Loopback, private, Link-local,
  reservierte, CGNAT-, Multicast- und Metadata-Bereiche werden abgewiesen.
- Alle DNS-Antworten werden geprueft und die ausgewaehlte IP wird bis zum Socket
  gepinnt; TLS-SNI und Host bleiben der validierte Originalhost.
- Keine Redirects, 10-Sekunden-Timeout, begrenzte Antwortgroesse, HMAC-Signatur.
- Persistente Claims mit Lease-Recovery, globale Concurrency 5 und maximal zwei
  Claims pro Tenant und Dispatch.
- Jeder Claim besitzt ein rotationssicheres Token. Nur der aktuelle Claim kann
  den Parent abschliessen und in derselben Transaktion einen append-only,
  tenantgebundenen Versuch mit Fehlerklasse, Laufzeit und Zeitstempeln schreiben;
  Antwortkoerper werden dort nie gespeichert. Replay erhoeht eine Generation,
  ohne die vorherigen Versuche zu veraendern.
- Dead Letters sind tenant- und berechtigungsgebunden in Admin und REST sichtbar;
  die Prometheus-Queue-Metrik und `QAcademyQueueHasFailedJobs` alarmieren
  dauerhaft fehlgeschlagene Zustellungen.
- Operative Retention entfernt Parent und Versuche gemeinsam und wertet aktive
  `all`-, `integrations`- und `communications`-Holds gegen eingebettete
  Subject-IDs aus; nicht mehr aufloesbare Holds sperren konservativ tenantweit.

Die lokal vorbereitete hostseitige Egress-Policy bindet die exakten Compose-
Bridges `proxy` und `egress` an minimale Portlisten. Sie blockiert private,
reservierte, Link-local- und Metadata-Ziele vor jeder Portfreigabe sowohl im
Forwarding als auch zum Host-`INPUT`. Das Werkzeug validiert Compose-Projekt,
Labels, Treiber, IPAM und IPv4-/IPv6-Abdeckung, unterstuetzt Dockers
`DOCKER-USER` ueber iptables/iptables-nft sowie, ausschliesslich bei einem von
Docker selbst gemeldeten nftables-Backend, ein natives nftables-Table und
versiegelt Werkzeug, Policy, Netzidentitaet und Kernel-Ruleset in maschinenlesbarer
Evidence. Dual-Stack wird nur ueber eine atomare native nftables-Transaktion
zugelassen. Interne App-, Datenbank-, Job-, Scan- und Observability-Protokolle
laufen auf anderen beziehungsweise derselben kontrollierten Bridge weiter und
werden nicht auf zusaetzliche Hostports umgestellt.

Die versionierte, an `docker.service` gebundene Runtime-Unit erzeugt die beiden
kontrollierten Netze ohne Containerstart, erzwingt und verifiziert das
Host-Ruleset und startet alle Runtimes einschliesslich Monitoring erst danach;
Caddy ist die letzte, atomare Freigabe der von Docker publizierten Ports. Eine
plain UFW-`INPUT`-Policy wird nicht als Docker-Publish-Gate betrachtet. Bei
jedem Fehler stoppt `ExecStopPost` ausschliesslich das exakte Compose-Projekt.

Restrisiko: Installation/Aktivierung dieser Unit, Kernel-Ruleset-Verifikation
auf dem realen Host sowie reale Positiv- und Negativtests fuer IPv4, IPv6,
Metadata, Host-Gateway und Provider-DNS koennen lokal nicht abgenommen werden.
Sie bleiben ein blockierendes Gate der externen Rootserver-Abnahme. Ein Provider mit ausschliesslich privatem Ziel benoetigt
einen separat kontrollierten Outbound-Proxy oder eine neu reviewte Zielpolicy.
Reale Alarmempfaenger und der Feueralarmtest bleiben ebenfalls Teil dieser
Abnahme.

### Commerce, Automationen und Support

Risiken: gefaelschte oder wiederholte Verkaufsereignisse, manipulierte
Produktzuordnungen, tenantfremde Bundle-IDs, verfruehter oder unvollstaendiger
Zugriffsentzug, Abfluss von Provider-/Intercom-Secrets und n8n-SSRF.

Kontrollen:

- Providerendpunkte sind an zufaellige Connection-Keys und einen explizit
  konfigurierten HMAC-, Feldsignatur- oder Shared-Token-Vertrag gebunden. Der
  Body ist auf 256 KiB begrenzt; Secrets werden konstantzeitlich verglichen.
- Die Inbox speichert keine Raw-Payloads, sondern SHA-256 und minimierte
  Normalfelder. Connection plus externe Event-ID ist eindeutig; dieselbe ID
  mit anderem Digest wird abgewiesen und parallele Verarbeitung serialisiert.
- Produkte, Mappings, Orders, Subscriptions und Entitlements besitzen
  `organization_id` sowie zusammengesetzte Tenant-Fremdschluessel.
  Kursfreigaben referenzieren die unverwechselbare Entitlement-Provenienz;
  ein Entzug entfernt keine andere Zugriffsquelle.
- Restlaufzeit wird als unveraenderlicher Endzeitpunkt gespeichert und vom
  geschuetzten Scheduler idempotent reconciliert. Activity, Commerce-Outbox
  und abonnierte Webhook-Delivery werden gemeinsam mit dem Lifecycle committed.
- `commerce:read` und `commerce:write` sind ownergebunden und werden nicht von
  Wildcard-Keys impliziert. Zapier-/Make-/n8n-Aktionen verwenden den getrennten,
  delegierbaren Scope `automations:write` und API-Idempotenz.
- n8n-Ziele durchlaufen dieselbe DNS-gepinnte SSRF-Pruefung und durable,
  HMAC-signierte Retry-Queue wie andere Webhooks. Intercom Identity-Secrets
  bleiben verschluesselt und werden vom Webhook-Keyring mitrotiert. Ohne
  entschluesselbares Secret und gueltigen nutzergebundenen HMAC werden weder
  Intercom-Launcher noch Browser-SDK ausgeliefert.

Restrisiken: Die drei Provideradapter und das Intercom-/n8n-Verhalten muessen
mit realen Konten, den dort aktivierten Signaturversionen und Sandbox-/Staging-
Events abgenommen werden. Marketplace- oder Providerzertifizierungen sind
nicht Bestandteil der lokalen Implementierung.

### Native Apps und Push

Risiken: gestohlene Geraetetokens, tenant- oder sitzungsfremde Registrierung,
Deep-Link-Umleitung, Push nach Logout, manipulierte Association-Dateien und
Abfluss von APNs-/FCM-Credentials.

Kontrollen:

- Native Push-Tokens werden tenant-, nutzer- und sessiongebunden verschluesselt
  gespeichert. Registrierung, Status und Loeschung verlangen die aktuelle
  Sitzung; Logout widerruft die zugehoerigen Geraete.
- Materialisierung und Zustellung verwenden persistente Claims, Retry und
  terminale Status. APNs HTTP/2 und FCM HTTP v1 erhalten nur den fuer die
  Benachrichtigung erforderlichen minimierten Payload.
- Der Capacitor-Bridge akzeptiert nur interne, explizit erlaubte Routen aus
  Custom-, Universal- oder App-Links. Fremde Hosts und unsichere Schemes werden
  nicht in die WebView-Navigation uebernommen.
- Apple- und Android-Association-Dokumente werden ueber feste Well-known-Routen
  erzeugt; Bundle-/Team-/Zertifikatkonfiguration kommt aus gepruefter
  Deployment-Konfiguration. Produktionspreflight scheitert ohne Pflichtwerte.
- Providercredentials bleiben ausschliesslich serverseitig. Queue-Metriken und
  Retention decken Fehler, Alter und terminale Zustellungen ab.

Restrisiken: APNs-/FCM-Projekte, Apple-Team, Android-/iOS-Signierung,
Association-Dateien auf dem kanonischen DNS-/TLS-Host, reale Geraetetests und
Store-Reviews sind externe Gates. iOS-Build/Archivierung erfordert macOS; die
lokale Windows-Implementierung ist kein Store-Abnahmenachweis.

### Orbit-Control-Plane und Inhaltstransfer

Risiken: E-Mail-basierte Accountuebernahme, tenantfremde Instanzverknuepfung,
ueberbreite Partnerdelegation, Slot-/Entitlement-Umgehung, Transfer von nicht
freigegebenen Inhalten und unvollstaendige Cross-Tenant-Kopien.

Kontrollen:

- Ein Orbit-Account wird nur ueber eine explizit verifizierte Tenant-Identitaet
  verbunden; bestehende globale Accounts werden nicht allein anhand derselben
  E-Mail verknuepft. Der letzte Workspace-Owner ist geschuetzt.
- Rollen, Permission-Sets, Instanzbereiche, Entitlements und zeitlich begrenzte
  Partnerdelegationen werden zentral fail-closed aufgeloest. Instanz-Claims sind
  zufaellig, einmalig und an ausstellenden Account sowie verfuegbare Slots gebunden.
- Transfer-Preflight und Ausfuehrung pruefen Quell-/Zielinstanz, Entitlement,
  Delegation und Berechtigung erneut. Idempotenzschluessel, Advisory Lock,
  Statusmaschine und Item-Mappings verhindern doppelte beziehungsweise
  unbemerkte Teilkopien; nur publizierte Kursinhalte werden kopiert.
- Globale Audit-Ereignisse speichern den Control-Plane-Lifecycle, waehrend
  fachliche Zielobjekte weiterhin tenantgebundene Fremdschluessel verwenden.

Restrisiken: Multi-Rootserver-Betrieb, hohe Transferlast, Abbruch/Recovery,
externes Billing und organisatorische Partnerfreigabe muessen in Staging und
mit realen Kundenvertraegen abgenommen werden. Die globale Control Plane
erhoeht den Blast Radius und bleibt ein Schwerpunkt des externen Pentests.

### Mail, Queues und Tokens

Risiken: verlorene Einladungen, doppelte Mails, Token-Leaks und Zustellung nach
Tenant-Sperrung.

Kontrollen:

- Token und AES-GCM-verschluesselte Outbox werden gemeinsam committed.
- Worker nutzt Lease, Stale-Recovery, Backoff, acht Versuche und persistente
  Delivery-ID als Provider-Idempotency-Key.
- Provider-Antworttexte und Links werden nicht geloggt; Produktionslogging
  verwirft Messages, Query-Parameter, Prompts und Eingabedaten.
- Queue-Claim und Delivery pruefen den aktiven Tenant erneut.
- Bounce-/Complaint-Callbacks verwenden einen dedizierten HMAC-Vertrag mit
  engem Zeitfenster, konstantem Vergleich, striktem Payloadschema und
  dauerhafter Event-Idempotenz. Hard-Bounces und Complaints erzeugen dauerhafte,
  Soft-Bounces zeitlich begrenzte tenantgebundene Empfaengersperren; der Worker
  prueft sie fail-closed vor Entschluesselung und Netzwerkzugriff.

Restrisiken: Der konkrete Provider, SPF/DKIM/DMARC sowie dessen praktische
Umsetzung von Outbound-Idempotenz und signiertem Bounce-/Complaint-Rueckkanal
muessen vor Pilotstart abgenommen werden.

### Kursauthoring und parallele Aenderungen

Risiken: Zwei Trainer bearbeiten denselben Inhaltsblock und der spaetere
Schreibvorgang ueberschreibt unbemerkt die bereits gespeicherte Fassung;
tenantfremde Praesenzdaten, manipulierte Styles oder Stockbild-URLs werden
eingeschleust.

Kontrollen:

- Jeder Inhaltsblock traegt eine positive Revision. Admin-UI und REST-API
  erhoehen sie atomar und lehnen veraltete Updates oder Loeschungen mit `409`
  beziehungsweise einem sichtbaren UI-Konflikt ab.
- Seiten besitzen eine eigene positive Revision. Verschieben, Duplizieren,
  Ausblenden und Aendern verwenden denselben Page-CAS-Vertrag.
- Editor-Praesenz ist an Tenant, Kurs, Seite, Benutzer und kurze TTL gebunden;
  Heartbeats koennen keine Entwurfsinhalte oder fremden Kursstatus schreiben.
- Seiten- und Blockstyles werden gegen ein begrenztes strukturiertes Schema
  validiert und als Teil des versionierten Inhalts publiziert.
- Stockbildanbieter laufen ueber serverseitig konfigurierte Adapter. Nur
  gepruefte HTTPS-Quellen werden gespeichert; Provider-ID, Attribution und
  Auswahlprovenienz bleiben nachvollziehbar, rohe Provider-Schluessel gelangen
  nicht in den Browser.
- Publizierte Snapshots akzeptieren Legacy-Bloecke ohne Revision, validieren
  vorhandene Revisionen aber als positive Ganzzahl. Reine Revisionsaenderungen
  erzeugen keinen inhaltlichen Kurs-Diff.

Restrisiken: Offline-Merge und CRDT-/OT-basierte Echtzeitbearbeitung sind nicht
implementiert. Providerbedingungen, Attribution und Nutzungsrechte fuer reale
Stockbildkonten muessen vor Freischaltung juristisch und praktisch abgenommen werden.

### Kursbezogene Teamrechte

Risiken: Trainer erraten Kurs-, Modul-, Zertifikats-, Abgabe- oder Medien-IDs,
sehen fremde Lerndaten oder veraendern ein in mehreren Kursen verwendetes Modul
ueber einen einzelnen freigegebenen Kurs.

Kontrollen:

- Owner und Admins erhalten tenantgebunden `manage`. Trainer benoetigen pro
  Kurs einen expliziten Grant fuer `view`, `edit` oder `manage`; Mitglieder
  erhalten niemals ein administratives Kursrecht.
- Kursliste, Suche und Vorschau verlangen mindestens `view`, Builder,
  Abgaben-/Feedback-Review und Zertifikate mindestens `edit`, Publizieren und
  Depublizieren `manage`. Direkte Server-Action-Aufrufe verwenden dieselbe
  Policy wie die UI.
- Trainer-Ersteller erhalten im selben Commit wie der neue Standard- oder
  KI-Kurs `manage`. Bestandskurse werden fuer Trainer-Ersteller auf `manage`
  und fuer weitere Trainer-Autoren auf `edit` migriert.
- Inhaltsmutationen eines geteilten Moduls verlangen `edit` auf jedem Kurs,
  der dieses Modul referenziert. Link-Module akzeptieren fuer Trainer nur
  tenantgebundene Zielkurse mit mindestens `view`.
- Globale Modulbibliothek und mandantenweite Analytics bleiben Owner/Admins
  vorbehalten. Das Aufgaben-Center und kursbezogene Statistiken werden auf die
  jeweils freigegebenen Kurse begrenzt.
- Zusammengesetzte Fremdschluessel binden Kurs, Trainer und Grant-Erteiler an
  denselben Tenant. Grant-Aenderungen werden auditiert und personenbezogen im
  Datenschutzinventar sowie im DSAR-Export erfasst.
- Organisations-API-Keys sind bewusst eine getrennte Maschinen-Boundary:
  Nur Owner/Admins duerfen sie ausstellen, und ein expliziter Scope wie
  `submissions:read` oder `feedback:write` gilt tenantweit. Kursbezogene
  Trainergrants verengen diesen Vertrag nicht stillschweigend; Tenant, Scope,
  Idempotenz und API-Audit bleiben dort die durchgesetzten Kontrollen.

Zusaetzliche Kontrolle: Owner definieren tenantgebundene Custom-Rollen mit
begrenzten View-/Manage-Rechten und weisen sie nur aktiven Admin-/Trainerkonten
zu. Zentraler Resolver, Navigation, Seitenlayouts und kritische Mutationen
verwenden dieselbe fail-closed Policy; Custom-Rollen koennen Owner-Schutz und
Trainerobergrenzen nicht umgehen.

Restrisiko: Die formale Berechtigungs- und Deadlock-Abnahme muss nach jedem
weiteren bereichsuebergreifenden Admin-Workflow wiederholt werden.

### Pruefungsversuche und Ergebnisfreigabe

Risiken: Fragen oder Loesungsschluessel werden vor dem Start offengelegt,
Kursinhalte lassen sich trotz laufender gesperrter Pruefung abrufen, parallele
Starts umgehen Versuchsgrenzen oder eine nachtraegliche Kursaenderung
veraendert eine bereits begonnene Bewertung.

Kontrollen:

- Ein Start sperrt den aktiven Benutzer organisationsweit und friert
  Kursversion, Bewertungsdefinition, Fragenreihenfolge und loesungsfreie
  Praesentation ein. Eine partielle Datenbank-Unique-Constraint verhindert
  zusaetzlich doppelte aktive Versuche je Pruefung.
- Die Fragenauswahl ist deterministisch mit einem separaten produktiven
  HMAC-Schluessel gebunden. Der Lernpayload enthaelt vor dem expliziten Start
  weder Exam-Fragetexte noch Optionen oder Block-IDs.
- Entwuerfe verwenden eine monotone Revision. Veraltetes Autosave und Submit
  werden mit Konflikt abgelehnt; Deadline-Finalisierung bewertet den zuletzt
  bestaetigten Serverentwurf.
- `block_course` und `block_academy` werden im zentralen publizierten
  Lernzugriff durchgesetzt und gelten damit auch fuer direkte Medien-,
  Transkript- und KI-Kontextabrufe.
- Automatische Fragen und manuelle Pruefungsaufgaben werden unabhaengig vom
  Freigabemodus nie als Q-Coach-Grounding verwendet. Bei einem aktiven
  `block_course`- oder `block_academy`-Versuch wird eine KI-Nachricht vor der
  Provider-Ausfuehrung und erneut vor dem Commit abgewiesen; aeltere Antworten
  aus der vorherigen Grounding-Policy werden nicht weiter angezeigt.
- Eine erste manuelle Pruefungsabgabe benoetigt einen serverseitig aktiven,
  noch nicht abgelaufenen Lifecycle-Versuch. Die Attempt-Zeile wird dabei
  geteilt gesperrt, damit paralleles Finalisieren die Frist nicht umgehen kann;
  explizit angeforderte Revisionen bleiben moeglich.
- Ergebnis und Antwort-Einsicht besitzen getrennte Freigabezeitpunkte.
  Manuelle Freigabe und administrative Finalisierung pruefen das aktuelle
  `edit`-Kursrecht innerhalb derselben Transaktion und werden auditiert.
- Legacy-Versuche bleiben lesbar, werden beim Upgrade aber sicher finalisiert;
  neue Exam-Abgaben koennen den Lifecycle nicht ueber den alten Quiz-Endpunkt
  umgehen.

Restrisiken: Die Zeitquelle ist die Serverzeit, setzt im spaeteren Cluster aber
eine ueberwachte Uhrensynchronisation voraus. Parallelitaet, Timeout-Worker und
Browser-Restore muessen in Staging unter Last erneut abgenommen werden.

### Medien, Uploads und Malware

Risiken: MIME-Spoofing, Malware, ueberschriebene oder tenantfremde Objekte,
Quota-Umgehung, langsame Uploads, Queue-Starvation, signierte URL-Leaks und
unvollstaendige Loeschung versionierter Objekte.

Kontrollen:

- Upload-Intents reservieren Quota und offene Asset-Slots unter Tenant-Lock;
  Kursmedien werden erst im Zustand `ready` atomar an einen tenantgleichen Kurs
  gebunden und beim Publizieren erneut gegen den versionierten Snapshot validiert;
  persistente User-/Tenant-Ratenlimits begrenzen Intent-Missbrauch.
- Incoming- und freigegebene Schluessel sind tenant- und assetgebunden. PUTs
  binden MIME-Typ, exakte Bytezahl und Write-once-Semantik.
- Der Worker prueft den gesamten unveraenderlichen Stream auf Groesse,
  erlaubte Signatur und UTF-8-Kontrollzeichen, bildet SHA-256 und gibt das
  Objekt erst nach erfolgreichem ClamAV-INSTREAM-Scan frei.
- OOXML-Pakete werden mit begrenzter Entry-/Expansionsgroesse, sicheren Pfaden,
  Content-Types, interner Office-Relation und typkorrektem XML-Root validiert.
  ISO-BMFF/MP4 wird vor dem Drittparser strukturell auf Box-, Track-, Sample-
  und Tabellengrenzen geprueft.
- Claim-Token, Leases, Heartbeat, Backoff und `skip locked` sichern parallele
  Worker. Nur `ready` wird heruntergeladen; andere Zustaende bleiben privat.
- MP4/MOV/M4A/WAV/MP3/Ogg/WebM-Dauern werden serverseitig mit begrenzten
  Parsern ermittelt. Digestgebundene Processing-Jobs deduplizieren FFmpeg-
  Thumbnails/Derivate und STT-Ergebnisse; der Provider wird ohne Shell gestartet.
  Der isolierte Runner laedt nur die gespeicherte S3-VersionId/ETag, prueft
  Groesse und SHA-256 erneut und bindet freigegebene Derivate an verifizierte
  VersionId, ETag, MIME-Typ, Groesse und Metadaten.
- Audio- und Videobloecke nehmen Mikrofon, Kamera plus Mikrofon oder Bildschirm
  nur in sicherem Browserkontext auf. Dauer und Groesse sind begrenzt; Tracks,
  Chunks und Object-URLs werden beim Verwerfen oder Unmount bereinigt. Erst eine
  bestaetigte Vorschau gelangt als Datei in den bestehenden Upload-/Scanpfad.
- Nicht-destruktive Schnittgrenzen, Pflichtanteil und Vorspulregel sind Teil des
  publizierten Snapshots. Der Server akzeptiert den Lektionsabschluss erst nach
  ausreichendem, assetgebundenem Wiedergabefortschritt.
- Scan und Maintenance laufen getrennt. Ein globales Maintenance-Budget bricht
  Storage-I/O vor dem HTTP-Limit ab; Harddelete verarbeitet S3-Versionen
  seitenweise mit Cursor-, Historien- und Leerverifikationsgrenzen.
- Der Medienrunner besitzt weder App-Sessions noch Verschluesselungs-, Mail-
  oder KI-Secrets. Eine eigene Datenbankrolle und getrennte Worker-S3-Credentials
  begrenzen einen Parser-Exploit auf die benoetigten Medienoperationen.
- App und Medienrunner liegen in getrennten internen PostgreSQL-Netzen und
  verwenden verschiedene Job-Secrets. Sie koennen weder den internen Server
  des jeweils anderen aufloesen noch dessen Job-Endpunkte autorisieren.
- Noch nicht an eine Abgabe gebundene Submission-Assets bleiben auch mit dem
  tenantweiten API-Scope `submissions:read` auf Uploader und Eigentuemer begrenzt.
  Nach der atomaren Attachment-Bindung erhalten Owner/Admins Zugriff; Trainer
  benoetigen mindestens `edit` auf dem zugehoerigen Kurs. Gebundene Kursmedien
  sind fuer Trainer erst ab `view` sichtbar, eigene ungebundene Kursuploads
  bleiben bis zur Bindung fuer den Uploader erreichbar.
- Fachliche Loeschung sperrt den Zugriff sofort. Fuer `deleted`, `quarantined`
  und `failed` wird Quota erst nach verifizierter Loeschung von Incoming- und
  Final-Objekt samt Versionen freigegeben; Tombstones bleiben 30 Tage erhalten.
- Kurscover werden zentral auf lokale Rasterbilder oder tenantgebundene,
  authentifizierte Media-Downloads begrenzt. Protokoll-relative, externe,
  SVG-, Traversal-, Query- und Credential-Quellen werden abgewiesen; alte
  ungueltige Werte rendern nur einen sicheren lokalen Fallback.
- Profil- und Branding-Uploader verwenden die vorhandene Browser-Session-
  Pipeline mit den getrennten Zwecken `avatar` und `branding`. Die Bindung liest
  das Asset serverseitig erneut und akzeptiert nur tenantgleiche `ready`-
  Bildobjekte ohne Loeschzeitpunkt. Ein Mitglied kann nur ein ihm gehoerendes
  Avatar-Asset an das eigene Profil binden; Branding-Uploads und -Bindungen sind
  Owner/Admin vorbehalten.
- Medien-Profilfelder binden ebenfalls nur tenantgleiche `ready`-Assets des
  betroffenen Mitglieds und geben keine Storage-Schluessel oder signierten URLs
  als frei konfigurierbaren Profilwert aus.
- Gebundene Profilbilder werden ueber den authentifizierten Media-Endpunkt
  ausgeliefert. Innerhalb des Tenants ist ein fremdes Profilbild erst nach der
  Bindung an ein aktives Mitglied sichtbar; ein eigener gepruefter Entwurf bleibt
  nur fuer seinen Eigentuemer sichtbar. Oeffentliches Branding verwendet keine
  frei waehlbare Asset-ID, sondern feste Slot-Routen. Diese loesen den aktiven
  Tenant aus dem vertrauenswuerdigen Host auf und liefern nur das aktuell an den
  Slot gebundene Bild. Unbekannte Hosts und fremde IDs erhalten `404`.
- Gebundene Avatar- und Branding-Assets koennen nicht separat geloescht werden.
  Nicht gebundene gepruefte Entwuerfe werden nach 24 Stunden tombstoniert; die
  physische Loeschung und Quota-Freigabe folgen dem bestehenden Media-Lifecycle.

Restrisiken: S3-IAM, CORS, Verschluesselung und Lifecycle-Regeln sind
providerseitig und muessen praktisch abgenommen werden. Auch begrenzte
Containerparser koennen neue Bibliotheks- oder Formatfehler enthalten; Updates
und externe Sicherheitstests bleiben erforderlich. Lasttests fuer grosse
Dateien, der reale Bucket-/Rootserverbetrieb des isolierten FFmpeg-/STT-Runners,
Provider-/Modell- und Sprachqualitaet, Queue-SLO/Alarmierung sowie ein vollstaendiger
Media-Purge vor einem vollstaendigen Tenant-Harddelete stehen aus. Der
Mitglieder-DSAR liefert lokal ein verschluesseltes ZIP mit strukturierten Daten,
Manifest und integritaetsgeprueften gebundenen Medien.

### Datenbank, Deployment und Backups

Risiken: DDL durch kompromittierte App, unvollstaendige Migration, Datenverlust,
manipuliertes Image und nicht wiederherstellbares Backup.

Kontrollen:

- Getrennte DB-Owner-/App-Rollen; App besitzt nur DML und Migrations-Leserechte.
- Einmaliger Migrator vor App-Start und Readiness-Vergleich aller
  Migrations-Hashes des Images mit der Datenbank.
- Non-root-/Read-only-Container, internes DB-Netz, Caddy Auto-TLS und
  commitgebundene Image-Tags.
- Vor der ersten moeglichen Migration wird ein atomarer, root-eigener und
  crash-durabler Pending-Marker mit FROM-/TO-Tag und aktuellem Controller-Commit
  geschrieben. Unbeaufsichtigter Boot verweigert bei jedem Markerobjekt den
  Start. Resume und kompatibler Runtime-Rollback verlangen exakte, getrennte
  Operatorbestaetigungen; eine fehlgeschlagene Erstinstallation ohne FROM-Tag
  kann nicht auf ein nicht existentes Runtime-Image zurueckrollen.
- Env und State Schema 2 werden samt Controller-Commit dauerhaft synchronisiert,
  bevor der Pending-Marker dauerhaft entfernt wird. Interne und externe
  Readiness muessen exakt dieselbe Release-Version melden; dadurch kann ein
  veraltetes DNS-Ziel den Caddy-Go-live nicht bestaetigen.
- Alle persistenten Container besitzen nur `restart: "on-failure:5"`.
  Geordneten Start nach Docker-Neustart uebernimmt der migrationsfreie,
  projektgebundene systemd-Reconcile mit begrenzten Wiederholungen.
- Custom-Format-Backup mit SHA-256, Archivpruefung und standardmaessigem
  vollstaendigem Test-Restore in eine separate Datenbank.

Restrisiken: Upstream-Images und freigegebene App-Artefakte sind auf Digests
gepinnt; CI erzeugt SBOMs, blockiert reparierbare hohe/kritische Funde und
attestiert das Manifest der exakt getesteten Images. Registry-Zugriff,
Attestierungspruefung und Digest-Transfer muessen auf dem realen Rootserver
praktisch abgenommen werden. Ein echter Rootserver-Restore mit gemessenem RTO,
Offsite-Replikation, Monitoring und Alarmtests steht aus. PostgreSQL-Verkehr ist
im Ein-Host-Docker-Netz nicht zusaetzlich TLS-verschluesselt; das Hostlaufwerk
muss verschluesselt sein.

### KI und Inhalte

Risiken: Prompt Injection, Datenabfluss an Provider, Halluzinationen,
Kostenmissbrauch, gespeicherte sensible Prompts und unberechtigte oder doppelte
Ausfuehrung einer Agentenaktion.

Kontrollen:

- Externe KI ist ohne `AI_API_KEY` deaktiviert; LMS-Kernfunktionen verwenden
  deterministische Fallbacks.
- Q-Coach-Inhalte werden serverseitig aus tatsaechlich freigeschalteten,
  versionierten Kursen erzeugt; interne Links werden validiert.
- Persistente Benutzer-/Tenant-Quoten, Concurrent-Limits und Provider-Timeouts.
- Das Agent Studio erzwingt einen tenantweiten Kill-Switch, Monatscredits und
  optional ein Stundenlimit je Mitglied. Rollen-, Nutzer-, Gruppen- und
  Bundle-Freigaben sind an eine unveraenderliche publizierte Version gebunden.
- Agent-Webquellen erlauben nur oeffentliche HTTPS-Ziele auf Port 443 ohne
  Zugangsdaten oder Redirects. Alle DNS-Antworten muessen Public Unicast sein;
  der Abruf pinnt genau eine gepruefte Adresse fuer die TLS-Verbindung. Timeout,
  Content-Type, UTF-8, Encoding und Groesse sind begrenzt. Script-, Formular-,
  versteckte und nicht lesbare HTML-Inhalte werden strukturell entfernt. Chat
  und Publish besitzen keinen Webabruf und verwenden nur den gespeicherten,
  digestgebundenen Snapshot.
- Dokumentquellen werden ausschliesslich serverseitig aus dem unveraenderlichen
  `ready`-Asset gelesen. Plaintext/CSV sowie PDF- und OOXML-Dokumente werden mit
  Entry-, Groessen-, Seiten- und Textlimits extrahiert; Digest und Abrufzeit
  binden den publizierten Snapshot. Browserseitig mitgesendeter Quelltext wird
  nicht als vertrauenswuerdige Dokumentextraktion akzeptiert.
- Nur explizit ausgewaehlte Profilfelder, die fuer das jeweilige Mitglied
  sichtbar sind, werden begrenzt und redigiert in einen als unvertrauenswuerdig
  markierten Promptabschnitt eingefuegt. Medienwerte und rohe URLs werden nicht
  an den Provider gegeben; ein versionierter Transparenzhinweis deckt diesen
  Egress ab.
- Zusatz-Prompts sind strukturiert, begrenzt und Teil der unveraenderlichen
  Agent-Version; sie aendern keine Systempolicy und umgehen keine Aktionfreigabe.
- Die lokalen Kurs-, Gruppen- und Bundle-Aktionen werden
  versioniert konfiguriert, von einem Mitglied separat angefragt und nur nach
  expliziter Adminentscheidung mit optimistischer Revision und
  Exactly-once-Transaktion ausgefuehrt.
  Request-/Decision-Ereignisse sind tenantgebunden und append-only. Eine
  Remove-Aktion widerruft nur die exakt durch diese KI-Aktion erzeugte
  Provenienz und entfernt weder manuelle noch Commerce-Zugriffsquellen.

Agent-Chats und KI-Kurserstellung verwenden ein gemeinsames,
vertragsbegrenztes Creditmodell; Provider-Timeout und ein PostgreSQL-geteilter,
geleaster Circuit Breaker begrenzen Ausfaelle und schalten auf den lokalen
Fallback. Restrisiken bleiben die reale Mehrreplika-/Lastabnahme und rechtliche
Providerfreigabe. Der technische, digestgebundene Transparenzhinweis ersetzt
keine juristische Freigabe. Dokumentparser, Profilegress, Aktionen und der
signierte n8n-Adapter benoetigen produktive Provider-, Datenschutz-, Last- und
Penetrationstest-Abnahmen.

## Pilot-Blocker

- Rootserver-Hardening, Offsite-Backup und Restore/Alarm-Probe praktisch testen.
- Mail-Provider, Domainauthentifizierung und Bounce-/Complaint-Prozess abnehmen.
- Privaten S3-Bucket mit minimaler IAM-Policy, CORS, Versionierung, Lifecycle,
  Harddelete-Probe und verschluesseltem Objekt-Backup abnehmen.
- ClamAV-EICAR-, Timeout-, grosse-Datei- und parallele Queue-Lasttests inklusive
  Alarmierung ohne Freigabe bei Scannerfehlern durchfuehren.
- S3-faehigen FFmpeg-/STT-Runner, Modelle, Sprachen, Retention und
  Datenschutzvertrag unter realer Last abnehmen.
- Fuer native Auslieferung APNs/FCM, Signierung, Association-Dateien, reale
  Geraete und Apple-/Google-Store-Reviews abschliessen.
- Orbit-Delegation, Slot-/Entitlement-Grenzen und Cross-Tenant-Transfer in einer
  produktionsnahen Multiinstanz-Umgebung last- und sicherheitstesten.
- Produktive OIDC-Clients mit exakter kanonischer Callback-URL registrieren und
  Owner-Link, SSO-only-Einladung, Domain-Allowlist, IdP-Ausfall und Recovery
  gegen jeden freigegebenen Provider testen.
- TOTP-MFA fuer Owner, Admins und Trainer produktiv enrollen, Recovery-Codes
  getrennt verwahren und den tenantweiten Pflichtmodus nach Betreiberabnahme
  aktivieren.
- Datenschutzunterlagen, AVV/TOMs, Retention-Entscheidungen und Supportprozess
  freigeben.
- Staging-DAST und unabhaengigen Penetrationstest ohne offene hohe Funde
  abschliessen.
