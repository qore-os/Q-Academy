# Begrenzte Lasttests

`npm run test:load` ist ein Node/TypeScript-Harness ohne k6 oder einen anderen
externen Load-Generator. Es ist fuer lokale Systeme und explizit benannte
Staging-, QA-, Test-, Dev-, Preprod- oder Sandbox-Hosts vorgesehen. Ein
entfernter Host muss HTTPS verwenden und eine dieser Kennzeichnungen als
eigenes Hostname-Label enthalten. Produktionshosts werden abgelehnt.

Jeder Lauf braucht `--origin` und dieselbe URL nochmals als
`--confirm-origin`. VUs, Laufzeit, Requests und Timeouts haben harte
Obergrenzen. Ein kleiner lokaler Health-Lauf sieht so aus:

```powershell
npm run -- test:load -- --origin http://127.0.0.1:3000 --confirm-origin http://127.0.0.1:3000 --scenario health --duration-seconds 15 --vus 4 --max-requests 500 --min-requests 50 --max-p95-ms 500 --max-error-rate 0.01 --require true --output .data/load-health.json
```

Die Ausgabedatei darf vorher nicht existieren. Zusaetzlich wird derselbe
maschinenlesbare Evidence-Report nach stdout geschrieben. Der Report enthaelt
nur Ziel, Grenzen, Szenarionamen, aggregierte Latenzen, Statuscodes und
Fehlercodes. Credentials, Cookies und Authorization-Header werden weder
gespeichert noch ausgegeben.

## Authentifizierte Szenarien

Credentials liegen ausserhalb des Repositories in einer nur fuer den
ausfuehrenden Benutzer lesbaren JSON-Datei:

```json
{
  "email": "load-member@example.test",
  "password": "<staging-only-password>",
  "organizationSlug": "load-test-tenant"
}
```

API-Key und Job-Secret liegen jeweils als reiner Token in einer eigenen Datei.
Secrets werden nicht als CLI-Argument oder Umgebungsvariable uebergeben.

Verfuegbare Szenarien:

- `health`: `GET /api/v1/health/live`
- `login`: begrenztes Session-Setup pro VU, kein unbegrenzter Login-Loop
- `course-list`: authentifizierte Mitglieder-Kursliste
- `course-read`: expliziter Kurs- oder Lektionspfad unter `/academy/courses`
- `admin`: authentifizierte Admin-Startseite
- `api`: lesende Kurs-API mit API-Key
- `progress`: lesender Fortschritts-Endpunkt mit API-Key und zwei UUIDs
- `job`: genau ein Dispatch mit `limit=1` und Cleanup-Dry-Run

Ohne `--scenario` werden alle lesenden Szenarien angefordert. Nicht
konfigurierte Szenarien werden im Report als uebersprungen ausgewiesen. Mit
`--require true` bricht der Lauf stattdessen vor dem ersten Request ab. Fuer
eine Release-Evidence sollte immer `--require true` verwendet werden.

Ein authentifizierter Staging-Lauf kann beispielsweise diese zusaetzlichen
Argumente verwenden:

```text
--member-credentials-file C:\secure\load-member.json
--admin-credentials-file C:\secure\load-admin.json
--api-key-file C:\secure\load-api-key
--member-course-path /academy/courses/security-basics
--progress-member-id 123e4567-e89b-42d3-a456-426614174000
--progress-lesson-id 123e4567-e89b-42d3-a456-426614174001
--require true
```

Das `job`-Szenario gehoert absichtlich nicht zum Standard. Es schreibt trotz
Dry-Run einen Scheduler-Heartbeat und braucht daher eine separate Auswahl,
eine Secret-Datei und die exakte Bestaetigung:

```text
--scenario job
--job-secret-file C:\secure\cron-secret
--ack-mutating-job STAGING_SYNTHETIC_JOB_DISPATCH
--min-requests 1
```

Der Ziel-Tenant muss synthetische Testdaten verwenden. Ein Lauf gegen
Kundendaten oder einen Produktionshost ist kein unterstuetzter Betriebsmodus.
