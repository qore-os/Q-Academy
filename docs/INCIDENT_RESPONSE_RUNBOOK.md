# Incident- und Provider-Ausfall-Runbook

Dieses Runbook beschreibt den lokal vorbereiteten Ablauf fuer Produktionsstoerungen
von Q-Academy. Es ersetzt weder vertragliche Meldefristen noch den vor Go-live
festzulegenden On-call-Plan. Namen, Rufnummern, freigegebene Kundenkanaele,
Provider-Administrationszugaenge und Eskalationsfristen duerfen nicht im Repository
erfunden oder als Secrets hinterlegt werden.

## Vor dem Go-live ausfuellen

Die Betriebsfreigabe benoetigt ausserhalb des Repositories:

- primaere und stellvertretende On-call-Verantwortung
- Incident Lead, Operations-, Security-/Datenschutz- und Kommunikation-Rolle
- freigegebene interne und externe Kommunikationskanaele
- Administrator- und Recovery-Zugang je produktivem Provider
- vertragliche Reaktions-, Update- und Meldefristen
- Entscheidungsbefugnis fuer Tenant-Sperre, Provider-Deaktivierung, Rollback und
  Restore

Fehlt einer dieser Punkte, ist das Runbook technisch nutzbar, aber nicht
organisatorisch produktionsreif.

## Grundregeln

1. Eine Incident-ID vergeben, Zeiten in UTC protokollieren und genau einen
   Incident Lead benennen.
2. Zuerst lesend untersuchen. Keine Datenbankmigration, kein `db:push`, kein
   `docker compose down -v` und kein neues Image waehrend des Incidents bauen.
3. Passwoerter, Tokens, Cookies, Provider-Payloads, Prompts und personenbezogene
   Inhalte weder in Chat/Ticket noch in Statusmeldungen kopieren.
4. Den aktiven Release-Tag, Alarm, Beginn, betroffene Tenants/Funktionen,
   Entscheidungen und Befehle revisionsfaehig festhalten.
5. Queues und idempotente Providerereignisse nicht blind loeschen oder erneut
   senden. Vor einem Replay Ursache, Idempotency-Key und Empfaengerwirkung pruefen.
6. Bei vermuteter Vertraulichkeits-, Integritaets- oder Tenant-Isolationsverletzung
   sofort Security/Datenschutz beteiligen und Beweise erhalten.

## Auswirkung einordnen

Die Einstufung beschreibt Auswirkung, nicht eine hier erfundene SLA:

| Klasse | Beispiele | Mindestbeteiligung |
| --- | --- | --- |
| Kritisch | Tenant-Uebergriff, Datenverlust/-veraenderung, kompromittiertes Secret, kompletter Ausfall ohne sicheren Workaround | Incident Lead, Operations, Security/Datenschutz, Kommunikation |
| Hoch | Anmeldung oder zentraler Lernbetrieb fuer mehrere Tenants ausgefallen, stark wachsender Queue-Stau, Datenbank oder S3 nicht verwendbar | Incident Lead, Operations, Kommunikation; Security bei Verdacht |
| Begrenzt | Einzelner Provider oder eine Nebenfunktion degradiert, Kernlernen bleibt sicher nutzbar | Operations und zustaendige Produktrolle |

Eine Einstufung wird bei wachsender Auswirkung sofort angehoben. Die produktive
Eskalations- und Meldefrist stammt aus Vertrag und On-call-Plan, nicht aus dieser
Tabelle.

## Erste Diagnose

Vom Rootserver aus nur mit freigegebenem Operationszugang arbeiten:

```bash
date -u
curl --fail --show-error --silent https://<kanonischer-host>/api/v1/health/live
curl --fail --show-error --silent https://<kanonischer-host>/api/v1/health/ready
sudo cat /var/lib/q-academy/releases/current.env
docker compose --env-file /etc/q-academy/production.env \
  -f /opt/q-academy/compose.production.yml ps
docker compose --env-file /etc/q-academy/production.env \
  -f /opt/q-academy/compose.production.yml logs --since 30m \
  app media-runner scheduler media-worker media-maintenance postgres caddy
systemctl status q-academy-backup.timer q-academy-backup.service --no-pager
```

Die erfolgreiche Readiness muss unter `data.version` exakt denselben
`git-<vollstaendiger-commit>`-Tag wie `CURRENT_TAG` zeigen. Eine Abweichung ist
ein fehlgeschlagenes oder manuell veraendertes Release und wird nicht durch
Anpassen des State-Files kaschiert. Compose injiziert diesen Tag in App und
Medienrunner ueber `Q_ACADEMY_APP_VERSION`. Die Produktions-Env niemals `source`n oder
vollstaendig ausgeben. Logs und Evidenz nur im zugriffsgeschuetzten Incident-
Speicher ablegen.

Danach klaeren:

- Ist Live, Ready oder nur eine Fachfunktion betroffen?
- Betrifft es alle Tenants, einzelne Hosts oder einen Provider?
- Wachsen Queue-Tiefe, Alter, Fehlerrate oder Container-Restarts?
- Sind Datenbank, freier Speicher, Zertifikat, DNS und S3 erreichbar?
- Begann die Stoerung mit Release, Konfigurationsaenderung oder Providerereignis?

## Eindaemmung nach Fehlerklasse

### Anwendung oder Release

- Bei einer Readiness-/Release-ID-Abweichung keine Dispatcher starten und keine
  Produktions-Env manuell umschreiben.
- Den zuletzt vollstaendig erfolgreichen Tag und die Migrationskompatibilitaet
  pruefen. Nur den bestaetigten Rollback aus
  [ROOTSERVER_DEPLOYMENT.md](./ROOTSERVER_DEPLOYMENT.md) verwenden.
- Nach einem fehlgeschlagenen Deploy bleiben alle Writer absichtlich gestoppt.
  Ursache und Containerlogs sichern, bevor ein neuer gepruefter Releaseversuch
  beginnt.

### Datenbank, Schema oder Speicher

- Bei vollem Datentraeger oder nicht erreichbarer Datenbank Schreibverkehr nicht
  durch Neustartschleifen verstaerken.
- Keine Down-Migration und kein improvisiertes SQL ausfuehren. Backupstatus,
  Schema-Readiness und Rollen-/Ownership-Fehler getrennt pruefen.
- Restore und kontrolliertes Umschalten ausschliesslich nach dem Ablauf in
  [ROOTSERVER_DEPLOYMENT.md](./ROOTSERVER_DEPLOYMENT.md) durchfuehren. RPO/RTO
  werden im realen Staging-/Rootserver-Drill gemessen.

### Queue-Stau

- Zuerst Providerfehler, Heartbeat, aeltesten Job, Retry-Anzahl und Queue-Wachstum
  bestimmen. Einen einzelnen defekten Payload nicht in Tickets kopieren.
- Dispatcher nur pausieren, wenn Retries Provider oder Plattform weiter
  gefaehrden. `scheduler` pausiert mehrere Hintergrundablaeufe; diese Auswirkung
  muss der Incident Lead vor dem Stop dokumentieren.
- Medien-Dispatcher koennen mit `docker compose ... stop media-worker
  media-maintenance` angehalten werden. Jobs bleiben in PostgreSQL; sie werden
  weder geloescht noch manuell auf Erfolg gesetzt.
- Nach Recovery mit begrenzter Parallelitaet anlaufen lassen und Alter,
  Fehlerrate sowie Providerlimits beobachten.

## Provider-Ausfall

1. Interne Netzwerk-/DNS-/Credentialfehler gegen den freigegebenen
   Providerstatus und den administrativen Providerkanal abgrenzen.
2. Beginn, Region/Produkt, HTTP-Fehlerklasse, betroffene Q-Academy-Funktion und
   Queue-Auswirkung ohne Payload oder Secret dokumentieren.
3. Automatische Fallbacks und begrenzte Retries wirken lassen. Keine
   Sicherheitskontrolle fuer Verfuegbarkeit umgehen.
4. Nur den betroffenen Ablauf pausieren; eine globale Abschaltung benoetigt eine
   dokumentierte Auswirkungsentscheidung.
5. Recovery erst bestaetigen, wenn ein kontrollierter Canary erfolgreich ist und
   der Rueckstau ohne neue Fehler sinkt.

| Provider/Ablauf | Sicheres Verhalten | Verbotener Workaround |
| --- | --- | --- |
| KI | Circuit Breaker und deterministische Fallbacks erhalten den lokalen Lernpfad; externe KI kann tenantseitig deaktiviert bleiben | Providerlimits umgehen, Prompts/Antworten in Tickets kopieren oder ungeprueft auf ein anderes Modell wechseln |
| Transaktionsmail | Outbox, Retry- und Suppressionstatus erhalten; Auth-Links bleiben an den gespeicherten Delivery-Snapshot gebunden | Mails manuell ohne Idempotency-/Suppressionpruefung senden |
| S3/Objektspeicher | Upload, Scan, Verarbeitung und Download schlagen geschlossen fehl; versionierte Objektreferenzen bleiben unveraendert | In Produktion auf lokales Dateisystem wechseln oder ungepruefte Objekte als `ready` markieren |
| ClamAV | Uploads bleiben unfertig oder quarantiniert | Malwarepruefung deaktivieren oder Objektstatus manuell freigeben |
| STT/Stockbilder | Optionale Erzeugung/Suche bleibt degradiert; vorhandene Inhalte bleiben nutzbar | ungepruefte Provider-URLs, Derivate oder Transkripte speichern |
| OIDC | Bestehende Sessions nach ihrer Policy behandeln; Recovery ueber den dokumentierten Provider-Adminzugang | SSO-only oder Owner-Step-up per Datenbank/Code umgehen, fremde Identitaet verknuepfen |
| Commerce/Webhooks/n8n | Signatur, Inbox, Idempotenz und Entitlement-Provenienz erhalten | Events faelschen, Inbox loeschen oder Zugriffe ohne spaetere Reconciliation massenhaft manuell vergeben |
| Web/Native Push | In-App-Benachrichtigungen bleiben der sichere Kern; Push-Retries und Sessionbindung erhalten | Endpunkte oder Schluessel aus Logs kopieren oder fremde Push-Credentials einsetzen |

Bei Credentialfehlern zuerst unterscheiden, ob ein Providerausfall oder ein
Secret-Incident vorliegt. Ein kompromittiertes Secret wird providerseitig
widerrufen und nach dem freigegebenen Rotationspfad ersetzt; es wird niemals zur
Diagnose ausgegeben.

## Security- oder Datenschutz-Incident

- Betroffenen Zugang, API-Key, Provider-Principal oder Tenant kontrolliert
  sperren, ohne relevante Logs und Auditdaten zu loeschen.
- Zeitfenster, Datenarten, Tenants, Aktionen und moeglichen Empfaenger bestimmen.
- Security/Datenschutz entscheidet ueber Forensik, Providerkontakt sowie
  gesetzliche und vertragliche Meldungen. Fristen nicht aus diesem Runbook
  ableiten.
- Rotation von Daten-, Webhook- oder MFA-Keyrings nur nach dem dokumentierten
  mehrstufigen Verfahren ausfuehren; alte Leseschluessel nicht voreilig entfernen.
- Kundenmeldungen bestaetigen nur verifizierte Fakten und enthalten keine
  Angriffsdetails, die weitere Ausnutzung erlauben.

## Recovery und Abschluss

Vor Wiederfreigabe muessen dokumentiert gruen sein:

- Live und Ready; `data.version` entspricht dem freigegebenen Release-State
- Datenbank-Schema, Rollen und Speicherplatz sind verwendbar
- kontrollierter Provider-Canary beziehungsweise bewusst deaktivierter Provider
- Queue-Alter und Fehlerrate sinken ohne unkontrolliertes Replay
- Login, ein nicht-destruktiver Lernflow und betroffene Kernfunktion
- Backup-Timer und letzter verifizierter Backupstatus
- interne und externe Abschlusskommunikation freigegeben

Danach Zeitpunkt, Auswirkung, Ursache, Timeline, Entscheidungen, Recovery,
verlorene oder verzoegerte Daten, offene Risiken und konkrete Folgemassnahmen in
einem Postmortem festhalten. Audit-/Logevidenz nach der freigegebenen Retention
schuetzen. Ein Runbook- oder Alarmdefizit wird als eigener Follow-up-Punkt mit
Verantwortung und Termin gefuehrt.

## Kommunikationsvorlagen

Platzhalter werden vor Versand ausgefuellt. Keine Secrets, internen Hostnamen,
personenbezogenen Inhalte oder unbestaetigten Ursachen aufnehmen.

### Erstmeldung

```text
Betreff: [INCIDENT-ID] Stoerung bei [betroffene Funktion]

Seit [ZEIT UTC] ist [betroffene Funktion/Tenantgruppe] [nicht verfuegbar/degradiert].
Aktuell bestaetigte Auswirkung: [AUSWIRKUNG].
Nicht betroffen beziehungsweise weiterhin nutzbar: [VERIFIZIERTER UMFANG].
Wir haben [MASSNAHME OHNE SICHERHEITSDETAILS] eingeleitet.
Das naechste Update erfolgt ueber [FREIGEGEBENER KANAL/ZEITPUNKT].
```

### Statusupdate

```text
Betreff: [INCIDENT-ID] Update zu [betroffene Funktion]

Status um [ZEIT UTC]: [STATUS].
Seit dem letzten Update bestaetigt: [NEUE FAKTEN].
Aktuelle Auswirkung: [AUSWIRKUNG].
Naechster Schritt: [MASSNAHME].
Das naechste Update erfolgt ueber [FREIGEGEBENER KANAL/ZEITPUNKT].
```

### Wiederherstellung

```text
Betreff: [INCIDENT-ID] [betroffene Funktion] wiederhergestellt

Die Funktion ist seit [ZEIT UTC] wieder [VERIFIZIERTER STATUS].
Betroffen war der Zeitraum [BEGINN UTC] bis [ENDE UTC] mit [AUSWIRKUNG].
Noch laufende Nacharbeiten oder Einschraenkungen: [NACHARBEIT/KEINE].
Eine Ursachen- und Massnahmenzusammenfassung folgt ueber [FREIGEGEBENER KANAL],
sobald sie geprueft und freigegeben ist.
```

### Provider-Eskalation

```text
Referenz: [INCIDENT-ID / PROVIDER-TICKET]
Providerprodukt/Region: [PRODUKT/REGION]
Beginn: [ZEIT UTC]
Beobachtete Fehlerklasse: [STATUS/TIMEOUT OHNE PAYLOAD]
Auswirkung: [TECHNISCHE AUSWIRKUNG]
Bereits geprueft: [DNS/NETZWERK/CREDENTIAL-STATUS/CANARY]
Erbeten: [STATUSBESTAETIGUNG/ETA/RECOVERY-ANWEISUNG]
```
