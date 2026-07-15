# Audit-Export

Der Betreiber kann `activity_events` eines einzelnen Tenants fuer einen
begrenzten Zeitraum als kanonisches JSONL exportieren. Jede Zeile fliesst in
eine verkettete HMAC ein; ein separates Manifest bindet Tenant, Zeitraum,
Anzahl, Dateiname, SHA-256, finale Kette und Key-ID. Metadaten werden vor dem
Export rekursiv um Zugangsdaten, Secrets und URL-Querys bereinigt.

```bash
export Q_ACADEMY_ENV_FILE=/etc/q-academy/production.env
docker compose --env-file "$Q_ACADEMY_ENV_FILE" -f compose.production.yml \
  --profile operations run --rm --no-deps tenant-export-ops audit:export \
  --slug kunde-a \
  --confirm kunde-a \
  --from 2026-07-01T00:00:00.000Z \
  --until 2026-08-01T00:00:00.000Z \
  --output /operations/output/kunde-a-2026-07.jsonl

docker compose --env-file "$Q_ACADEMY_ENV_FILE" -f compose.production.yml \
  --profile operations run --rm --no-deps artifact-verify-ops audit:verify \
  /operations/input/kunde-a-2026-07.jsonl
```

Der erste Dienst verwendet nur App-Datenbankrolle, HMAC-Key und den
schreibbaren Export-Mount. Der Verifikationsdienst sieht denselben Host-Mount
read-only unter `/operations/input`, besitzt kein Netzwerk und erhaelt keine
Datenbank-Credentials. Der HMAC-Key ist ein separates Operations-Secret und
wird keinem App-Runtime-Container injiziert. Er muss nach Betreiberpolicy
rotiert werden; alte Keys bleiben
fuer die vereinbarte Verifikationsfrist abrufbar. Eine erfolgreiche lokale
Verifikation macht das Dateisystem nicht unveraenderlich. JSONL und Manifest
muessen danach gemeinsam in versionierten WORM-/Object-Lock-Speicher uebertragen
und dort mit Retention, Zugriffskontrolle und regelmaessigem Restore-Test
betrieben werden. Zeitraum und Aufbewahrung sind vor Produktivbetrieb mit Legal
und Datenschutz festzulegen.
