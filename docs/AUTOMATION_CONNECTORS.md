# Zapier- und Make-Connectoren

## Umfang und Version

Die lokal versionierten Connector-Artefakte liegen unter
`integrations/automation-connectors`. `artifact.json` bindet Release `1.0.0`
an den kanonischen Vertrag `contract.v1.json`, die REST-API `v1` und beide
Plattformpakete.

Beide Pakete stellen dieselben Aktionen bereit:

- Mitglied anlegen oder aktualisieren und optional aktiven Bundlezugriff geben
- ausschliesslich den durch diese Automationsquelle erteilten Bundlezugriff
  widerrufen

Beide Aktionen rufen `POST /api/v1/automation/members/upsert` auf. Validierung,
Mandantentrennung, Einladung und Zugriffsprovenienz bleiben damit in der
bestehenden Q-Academy-Businesslogik.

## Verbindung und Sicherheit

Eine Verbindung benoetigt die HTTPS-Origin der Academy und einen dedizierten
API-Key mit exakt diesen Scopes:

- `automations:write`
- `bundles:read`

`GET /api/v1/automation/connector-status` prueft Authentifizierung und beide
Scopes ohne Mutation. Das aktive Bundle-Dropdown liest
`GET /api/v1/bundles?active=true&limit=100&sort=name:asc`.

Jede Mutation benoetigt einen expliziten `Idempotency-Key` mit 8 bis 180
Zeichen. Zapier und Make erzeugen bewusst keinen automatischen Ersatzwert,
damit auch ein vollstaendiger Task- oder Scenario-Retry denselben stabilen Key
verwenden kann. Derselbe Key darf nur fuer eine inhaltlich identische Anfrage
wiederverwendet werden.

API-Keys, `.zapierapprc`, `.env`, Make-Origins und `.secrets` werden nicht
versioniert. Make und Zapier maskieren den Authorization-Header in ihren Logs.

## Zapier

`integrations/automation-connectors/zapier` ist eine private TypeScript-/ESM-
App fuer `zapier-platform-core` und `zapier-platform-cli` 19.0.0 auf Node 22.
Die Bundle-Auswahl verwendet den nativen `choices.perform`-Vertrag und reicht
den opaken API-Cursor ueber `bundle.meta.paging_token` weiter. Grant und Revoke
sind getrennte Create-Actions, teilen aber Request-Builder und API.

Lokale Pruefung:

```bash
cd integrations/automation-connectors/zapier
npm ci
npm test
npm run typecheck
npm run validate
npm run build
```

`register`, `link`, `push`, Zapier-Testkonto und Marketplace-Pruefung benoetigen
spaeter ein echtes Zapier-Konto und sind kein Bestandteil des Offline-Pakets.

## Make

`integrations/automation-connectors/make/makecomapp.json` entspricht dem
lokalen Projektformat des Make Apps Editor. Es referenziert Base, Basic-
Connection, Bundle-RPC sowie getrennte Grant-/Revoke-Module. `origins` bleibt
absichtlich leer, damit weder erfundene App-IDs noch Tokens im Repository
landen.

Der Make Apps Editor kann in diesem Verzeichnis einen privaten Origin anlegen.
Die dabei erzeugte `.secrets`-Datei bleibt lokal. Das Rootmanifest wurde gegen
das `makecomapp.json`-Schema des aktuellen Editors geprueft; JSON-Syntax,
Dateireferenzen, Authheader, Sanitization, RPC und Request-Bodies prueft
zusaetzlich der Repository-Contracttest. Ein echter Modul-/RPC-Lauf benoetigt
einen Make-Test-Origin und den Scenario Builder. Marketplace-Freigabe bleibt
extern.

## Repository-Pruefung

```bash
npm run connectors:check
npm run api:check-contract
```

Der Contracttest gleicht Version, Scopes, OpenAPI, Backend-Eingabeschema,
Zapier-Actions, Make-Dateireferenzen sowie Grant-/Revoke-Bodies ab und prueft,
dass keine Connector-Secretdatei eingecheckt ist.
