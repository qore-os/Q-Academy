# Commerce-, Automation- und Supportvertraege

## Geltungsbereich

Q-Academy normalisiert Digistore24-, Ablefy- und Copecart-Ereignisse in
Produkte, Bestellungen, Subscriptions und quellenbezogene Entitlements. Die
Adapter sind lokal implementiert und getestet. Sie sind ohne eine Abnahme mit
einem realen Providerkonto nicht als vom jeweiligen Anbieter zertifiziert zu
bezeichnen.

## Inbound-Endpunkte

Jede aktive Providerverbindung besitzt einen zufaelligen, nicht erratbaren
Endpoint unter
`/api/integrations/commerce/{provider}/{endpointKey}`. Der Endpoint akzeptiert
hoechstens 256 KiB als JSON oder Form-URL-Encoding. Der Originalbody wird nicht
persistiert; gespeichert werden sein SHA-256-Digest und ein minimierter,
normalisierter Payload.

Unterstuetzte Signaturmodi:

| Modus | Vertrag |
| --- | --- |
| `hmac_sha256` | Hex-HMAC-SHA256 ueber die exakten Raw-Body-Bytes. Akzeptierte providerspezifische Header: `X-Digistore24-Signature`, `X-Digistore-Signature`, `X-Ablefy-Signature`, `X-Elopage-Signature`, `X-Copecart-Signature`; alternativ `X-Commerce-Signature`. Das optionale Praefix `sha256=` wird entfernt. |
| `digistore_sha512` | Nur fuer Digistore24. Alle skalaren Felder ausser `sha_sign`/`sha_signature` werden nach Feldname sortiert, ihre Werte verkettet und das konfigurierte Geheimnis angehaengt; hiervon wird SHA-512 gebildet und konstantzeitlich mit `sha_sign` verglichen. Dieser explizite Kompatibilitaetsmodus muss gegen die im konkreten Konto konfigurierte IPN-Version abgenommen werden. |
| `shared_token` | Konstantzeitlicher Vergleich des Geheimnisses in `X-Commerce-Token` oder `X-Webhook-Token`. Nur verwenden, wenn der sendende Dienst keinen Body-HMAC unterstuetzt. |

Unbekannte Eventtypen, fehlende Pflichtfelder, ungueltige Signaturen und nicht
zugeordnete Produkte schlagen geschlossen fehl. Eine Provider-Event-ID darf
nur mit einem Payload-Digest verwendet werden. Identische Wiederholungen sind
idempotent; eine abweichende Wiederverwendung liefert `409`.

Die Integrationsverwaltung bietet fuer jede gespeicherte Verbindung einen
lokalen Preflight. Er entschluesselt das gespeicherte Geheimnis nur im Prozess,
durchlaeuft mit einer kanonischen Provider-Fixture denselben Body-Parser,
Signaturpruefer und Normalisierer wie der oeffentliche Endpoint und verlangt
mindestens eine aktive Zuordnung zu einem aktiven Produkt und Bundle. Ablefy
oder Copecart mit dem nur fuer Digistore24 definierten
`digistore_sha512`-Modus werden bereits beim Speichern abgewiesen. Der geheime
Endpoint-Key kann nach expliziter Bestaetigung rotiert werden; der vorherige
Endpoint ist danach sofort ungueltig. Dieser lokale Nachweis ersetzt nicht den
Abnahmelauf mit einem echten Providerkonto.

## Normalisierter Lifecycle

| Ereignis | Order/Subscription | Zugriff |
| --- | --- | --- |
| `order_created` | Order `paid` | Entitlement aktivieren |
| `subscription_activated` | Subscription `active` | Entitlement aktivieren oder reaktivieren |
| `payment_failed` | Subscription `past_due` | Commerce-Entitlement sofort entziehen |
| `subscription_cancelled` mit zukuenftigem `accessUntil` | `cancel_at_period_end` | Zugriff bis zum gespeicherten Endzeitpunkt behalten |
| `subscription_cancelled` ohne Restlaufzeit | `cancelled` | Zugriff entziehen |
| `subscription_expired` / `refunded` | `expired` | Zugriff endgueltig entziehen |

Jedes Entitlement erzeugt Kurszugriffsquellen im Format
`commerce:entitlement:{id}`. Beim Entzug werden ausschliesslich diese Quellen
entfernt. Direkte, Gruppen- oder andere Bundle-Zugriffe bleiben bestehen. Der
interne Scheduler reconciliert abgelaufene Restlaufzeiten in Batches.

## API und Automationen

Owner-gebundene Scopes `commerce:read` und `commerce:write` schuetzen
Providergeheimnisse und Kaeuferdaten. Der delegierbare Scope
`automations:write` ist fuer eingeschraenkte Zapier-/Make-/n8n-Credentials
vorgesehen. Die lokalen Zapier-/Make-Pakete benoetigen fuer ihr aktives
Bundle-Dropdown zusaetzlich `bundles:read`; Einrichtung, Offline-Pruefung und
externe Freigabegates beschreibt [AUTOMATION_CONNECTORS.md](AUTOMATION_CONNECTORS.md).

- `GET /api/v1/automation/connector-status`: API-Key und beide Connector-
  Scopes mutationsfrei pruefen; die Antwort enthaelt nur Tenant-/Key-Metadaten,
  Vertragsversion und Faehigkeiten, niemals Credentialmaterial.
- `POST /api/v1/automation/members/upsert`: Mitglied idempotent anlegen oder
  aufloesen und optional ein Bundle als quellenbezogenes Entitlement vergeben.
  `bundleAction=grant|revoke` erlaubt auch einen idempotenten, auf genau diese
  Automationsquelle begrenzten Zugriffsentzug; andere Commerce-, Gruppen- oder
  Direktzugriffe bleiben bestehen. Ohne Angabe bleibt `grant` der kompatible
  Standard.
- `POST /api/v1/automation/n8n/trigger`: frei benannten, auf 64 KiB begrenzten
  Workflow-Payload in die durable Delivery-Queue stellen.
- `GET|POST /api/v1/automation/n8n/workflows`: n8n-Ziele und abonnierte Events
  verwalten. Ziele werden mit der bestehenden SSRF-Pruefung validiert; jede
  Zustellung wird mit dem individuellen Webhookgeheimnis signiert und mit
  Retry-/Replay-Metadaten persistiert.

Ein Operator kann je aktivem n8n-Ziel eine `webhook.test`-Zustellung in genau
dieselbe durable Queue einreihen. Vor dem Einreihen werden Zielaufloesung,
Secret-Envelope und der unveraenderte, gesperrte Webhook-Datensatz erneut
geprueft. Der Worker versieht auch diesen Test mit `X-QA-*`-Signatur- und
Replay-Metadaten; Erfolg oder Fehler bleibt in der Delivery-Historie sichtbar.

Alle Mutationen koennen per `Idempotency-Key` wiederholungssicher ausgefuehrt
werden; die Connectorpakete senden den Header immer. Sie werden im API-Audit
erfasst und erzeugen transaktionale Activity-/Webhook-Ereignisse. Die
vollstaendige Spezifikation liegt unter `/api/v1/openapi.json`.

## Support

Der tenantweite Supportlauncher unterstuetzt HTTPS-Link, E-Mail und Intercom.
Bei Intercom wird die Nutzer-ID serverseitig per HMAC-SHA256 signiert; das
Identity-Secret wird verschluesselt gespeichert und nie an Admin- oder REST-
Antworten ausgegeben. App-ID, Nutzer-ID, Name, E-Mail und `user_hash` werden nur
fuer einen aktiv konfigurierten Intercom-Kanal an das Widget uebergeben.
Der UI-Preflight verwendet den effektiven Launcherpfad fuer den angemeldeten
Operator und akzeptiert Intercom nur mit einem entschluesselbaren Secret sowie
dem daraus erzeugten 64-stelligen Identity-HMAC. Link und E-Mail werden anhand
der effektiv ausgelieferten Konfiguration geprueft.

Das Intercom-SDK wird bei aktivierter Tenant-Konfiguration automatisch im
Browser geladen; es ist kein Click-to-load-Widget. Provider-Cookies,
Browser-Speicher, Empfaenger und Lebensdauern liegen ausserhalb der technischen
Kontrolle der Anwendung. Sie sind im
[Cookie- und Tracking-Inventar](./COOKIE_TRACKING_INVENTORY.md) als offene Legal-
und Consententscheidung dokumentiert und muessen mit einer realen
Tenantkonfiguration erhoben werden. Die fuenf Kurs-Iframe-Anbieter bleiben davon
getrennt und werden erst nach explizitem Click-to-load verbunden.
