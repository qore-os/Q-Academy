# Tenant-Vertraege und Limits

`organization_contracts` ist die serverseitige Vertragsquelle pro Academy. Ein
Tenant ohne Vertragszeile behaelt den unbegrenzten Legacybetrieb; sobald ein
Vertrag angelegt wird, gelten dessen Status, Entitlements und Limits fail-closed.

## Modell

- Status: `trial`, `active`, `past_due`, `suspended`, `cancelled`
- optionale Grenzen fuer Seats, nicht archivierte Kurse, Media-Speicher und
  monatliche KI-Credits
- explizite Entitlements wie `ai`, `commerce`, `automations`, `oidc_sso`,
  `custom_domains` und `native_mobile`
- optimistische Revision, Vertragszeitraum und optionale externe Referenz

Seats zaehlen aktive und eingeladene Konten aller Rollen. Media-Speicher zaehlt
reservierte Originalobjekte und erzeugte Derivate. Das wirksame KI-Monatsbudget
ist das Minimum aus Tenant-Konfiguration und Vertrag; eine Kurserstellung
reserviert 25, eine Agentnachricht einen Credit.

Die App prueft Limits vor den normalen Erstellpfaden. Datenbank-Trigger bilden
die letzte Schranke fuer direkte, parallele sowie spaeter hinzukommende OIDC-,
Commerce-, Orbit-, CSV- und API-Pfade. Bekannte Limitverletzungen werden in der
REST-API als `409 Conflict` ohne interne SQL-Details ausgegeben.

## Betrieb

Vertraege sind nicht durch Tenant-Admins editierbar. Operations verwendet die
revisionsgebundene CLI mit exakter Slug-Bestaetigung:

```bash
export Q_ACADEMY_ENV_FILE=/etc/q-academy/production.env
docker compose --env-file "$Q_ACADEMY_ENV_FILE" -f compose.production.yml \
  --profile operations run --rm --no-deps tenant-admin-ops tenant:contract \
  --slug kunde-a \
  --plan business_2026 \
  --status active \
  --seat-limit 250 \
  --course-limit 500 \
  --storage-limit 536870912000 \
  --ai-credits 50000 \
  --features ai,automations,commerce,custom_domains,native_mobile,oidc_sso \
  --expected-revision 0 \
  --confirm kunde-a
```

Fuer eine bestehende Zeile muss `--expected-revision` der aktuell sichtbaren
Revision entsprechen. `unlimited` entfernt die jeweilige Grenze. Die CLI weist
Limits unterhalb der aktuellen Nutzung ab und schreibt ein Audit-Ereignis. Owner
und berechtigte API-Clients koennen Vertrag und aktuelle Nutzung ueber
`GET /api/v1/organization/contract` lesen.

Ein Billing-Provider darf den Vertrag spaeter nur ueber einen separaten,
signierten Control-Plane-Adapter aktualisieren. Die lokale CLI ist kein
Zahlungssystem und ersetzt weder Rechnungsstellung noch steuerliche Prozesse.
