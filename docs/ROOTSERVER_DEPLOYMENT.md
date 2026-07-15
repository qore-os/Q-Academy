# Q-Academy Rootserver-Betrieb

Dieses Runbook beschreibt einen einzelnen Produktions-Stack aus Caddy, einer
oeffentlichen Next.js-App-Instanz, einem davon getrennten Next.js-Medienrunner,
PostgreSQL 16, getrennten Scan- und Maintenance-Dispatchern und ClamAV 1.5.
PostgreSQL und ClamAV sind nicht am Host veroeffentlicht. Caddy bezieht und
erneuert TLS-Zertifikate automatisch und ueberschreibt die an die App
weitergereichte Client-IP. Medienobjekte liegen in Produktion in einem externen
privaten S3-kompatiblen Bucket.
Ein optionales Compose-Profil `monitoring` betreibt Prometheus und Node Exporter
ohne oeffentlich erreichbaren Monitoring-Port. Die enthaltenen Alarmregeln
ersetzen keine extern konfigurierte Benachrichtigungsstrecke.
Das Compose-Profil `operations` stellt releasegebundene, nicht-root One-shot-
Container fuer Tenantverwaltung, Exporte, Loeschung, Offline-Verifikation und
HTTP-SLO-Smokes bereit. Auf dem Host ist dafuer weiterhin kein Node.js noetig.

## Voraussetzungen

- Debian 12 oder Ubuntu 24.04 mit mindestens 4 vCPU, 16 GB RAM und 80 GB SSD;
  bei parallelen Medienjobs, groesseren Privacy-Exports oder hoher Datenbanklast
  sind 24 GB oder mehr einzuplanen
- Docker Engine und Docker Compose Plugin in einer gepflegten Version
- Bash, Python 3, `flock` und entweder Dockers `DOCKER-USER`-Kette ueber
  `iptables`/`iptables-nft` oder natives `nft`; die spaetere Egress-Aktivierung
  prueft das tatsaechlich aktive Backend fail-closed
- auf dem Rootserver werden weder Node.js noch npm benoetigt; Release-Pruefungen
  und Provider-Preflights laufen in dafuer gebauten Non-root-Containern
- Verschluesseltes System-/Datenlaufwerk (zum Beispiel LUKS oder ein beim
  Anbieter nachweislich verschluesseltes Block-Volume)
- SSH nur mit Schluesseln, deaktivierter Passwortanmeldung, funktionierendem
  NTP und eingespielten Sicherheitsupdates
- DNS-A/AAAA-Eintraege fuer alle statischen Werte aus `CADDY_SITE_ADDRESSES`;
  verifizierte Custom Domains zeigen per A/AAAA oder CNAME auf denselben Server
- Eingehend nur TCP 22, 80, 443 und UDP 443; Port 5432 bleibt geschlossen
- Mail-Gateway gemaess [MAIL_GATEWAY_CONTRACT.md](./MAIL_GATEWAY_CONTRACT.md)
- fuer jeden produktiv aktivierten SSO-Tenant ein OIDC-Client beim vorgesehenen
  Identity Provider mit kontrolliertem Owner-/Administratorzugang
- Externes, verschluesseltes Backup-Ziel zusaetzlich zum lokalen Backup-Verzeichnis

Die bereitgestellte Konfiguration betreibt genau eine oeffentliche App-Instanz
und einen nicht oeffentlich erreichbaren Medienrunner. Horizontale Skalierung
der oeffentlichen App erfordert vorher einen gemeinsamen Next.js-Cache, koordinierte
Invalidierung und einen fuer alle Instanzen identischen Server-Action-Schluessel.
Das releasegebundene, gehaertete Scratch-Caddy-Image verwaltet die explizit in
`CADDY_SITE_ADDRESSES` aufgefuehrten Plattformhosts statisch. Es lauscht im
Container ohne Root-Rechte auf `8080`/`8443`; Compose bildet die Host-Ports
`80`/`443` darauf ab. Fuer verifizierte Custom Domains verwendet es einen
`https://`-Catch-all mit On-Demand TLS. Vor
jeder neuen oder erneut zu autorisierenden Domain fragt Caddy ueber einen nur
auf Container-Loopback gebundenen Proxy den internen App-Endpunkt ab. Der Proxy
setzt `CADDY_TLS_ASK_SECRET` als Bearer-Header und erreicht die App ausschliesslich
ueber das interne `tls-ask`-Netz. Der oeffentliche Proxy beantwortet alle
`/api/internal/*`-Pfade mit `404`. Die App liefert am Ask-Endpunkt keine
Tenantdaten, sondern nur einen leeren Status: `200` ausschliesslich fuer einen
normalisierten, verifizierten, nicht widerrufenen Claim eines aktiven Tenants,
`404` fuer alle Ablehnungen und `503` bei Konfigurations- oder Datenbankfehlern.
Es finden dort keine DNS- oder sonstigen Netzwerkabfragen statt.
PostgreSQL und App kommunizieren in diesem Ein-Host-Modell ausschliesslich ueber
ein internes, nicht am Host publiziertes Docker-Netz. Fuer eine spaetere externe
oder Managed-Datenbank ist TLS mit Zertifikatspruefung zwingend nachzuruesten.

## OIDC und kanonische Login-Hosts

OIDC wird pro Tenant in der Owner-Oberflaeche beziehungsweise ueber die
ownergebundenen REST-Scopes `authentication:read` und `authentication:write`
konfiguriert. Client-Secrets liegen verschluesselt in PostgreSQL und verwenden
den versionierten `DATA_ENCRYPTION_KEY`-Keyring. Es gibt deshalb kein globales
OIDC-Client-Secret in der Produktions-Environment.

Die Callback-URL wird nicht aus beliebigen Request-Headern uebernommen. Der
kanonische Ursprung wird in dieser Reihenfolge bestimmt:

1. aktiver, DNS-verifizierter Custom-Domain-Claim des Tenants,
2. `https://<tenant-slug>.<TENANT_BASE_DOMAIN>`, falls eine Basisdomain gesetzt ist,
3. die produktive `NEXT_PUBLIC_APP_URL` als Fallback.

`APP_DOMAIN` ist der exakte kanonische Plattformhost und muss mit dem Hostnamen
aus `NEXT_PUBLIC_APP_URL` uebereinstimmen. Ausschliesslich dieser Host wird dem
aktiven Tenant aus `DEFAULT_ORGANIZATION_SLUG` zugeordnet. Ein unbekannter
`Host`- oder `X-Forwarded-Host`-Wert erhaelt kein Tenant-Branding und keine
implizite Default-Tenant-Bindung. Verifizierte Custom Domains und exakte
`<tenant-slug>.<TENANT_BASE_DOMAIN>`-Hosts bleiben davon getrennt.

Die Produktionsvalidierung und damit `/api/v1/health/ready` arbeiten hierbei
fail-closed: fehlende oder widerspruechliche Werte fuer `APP_DOMAIN`,
`NEXT_PUBLIC_APP_URL` und `DEFAULT_ORGANIZATION_SLUG` sowie eine ungueltige
`TENANT_BASE_DOMAIN` liefern Readiness `503`. Vor dem Rollout muss der
Default-Slug deshalb als aktiver Tenant in PostgreSQL vorhanden sein.

Eigene Login-Hosts werden ausschliesslich durch einen aktiven Owner unter
`/admin/settings` oder ueber `/api/v1/organization/domains` verwaltet. Create
und Rotate liefern den 24 Stunden gueltigen TXT-Wert fuer
`_q-academy-verification.<hostname>` genau einmal. Nach dem Setzen des Records
gibt Verify den Host fuer On-Demand TLS frei. Danach muessen A/AAAA oder CNAME
auf diesen Rootserver zeigen; Caddy stellt das Zertifikat beim ersten
HTTPS-Aufruf bereit. Revoke entfernt den Host sofort aus Tenant-Aufloesung,
Branding und kanonischer OIDC-Origin und verweigert weitere TLS-Autorisierungen.
Ein bereits ausgestelltes Zertifikat kann bis zur Caddy-Bereinigung gespeichert
bleiben, liefert aber nach Revoke keine Tenantanwendung mehr. Direkte Datenbank- oder
`loginHostname`-Provisionierung ist kein zulaessiger Betriebsweg. Lokale
`<tenant-slug>.localhost`-Hosts sowie `<tenant-slug>.<TENANT_BASE_DOMAIN>`
bleiben kontrollierte, claimfreie Plattformhosts.

Der resultierende Custom Host muss in DNS auf den Rootserver zeigen und beim
Identity Provider identisch eingetragen sein. Nur statische Plattformhosts
stehen in `CADDY_SITE_ADDRESSES`; verifizierte Custom Domains werden nicht
manuell in die Caddy-Konfiguration geschrieben. Pro Tenant ist exakt folgende
Redirect-URI zu registrieren; zusaetzliche Wildcard-Callbacks sind unzulaessig:

```text
https://<kanonischer-tenant-host>/api/v1/auth/oidc/callback
```

Der Identity Provider muss OIDC Discovery, Authorization Code, PKCE mit S256,
`client_secret_post`, die Scopes `openid` und `email`, einen verifizierten
`email`-Claim sowie asymmetrisch signierte ID-Tokens anbieten. `profile` wird
nur angefordert, wenn der Provider den Scope veroeffentlicht. Authorization-,
Token- und JWKS-Endpunkte muessen in Produktion sichere oeffentliche HTTPS-Ziele
sein. Provider, die ausschliesslich `client_secret_basic`, symmetrische
ID-Token-Signaturen oder einen impliziten Flow anbieten, sind nicht kompatibel.

Sichere Inbetriebnahmereihenfolge:

1. Tenant und kanonischen Login-Host provisionieren, TXT-Verifikation
   abschliessen, Ziel-DNS setzen und den ersten HTTPS-Aufruf samt Zertifikatskette
   abnehmen.
2. OIDC-Client mit der exakten Callback-URL beim Provider registrieren.
3. Providerdaten mit weiterhin aktiviertem Passwort-Login speichern und durch
   die eingebaute Discovery-/Metadatenpruefung validieren.
4. Der aktive Owner verknuepft sein aktuelles Konto explizit per SSO und prueft
   danach eine neue Anmeldung. Eine reine E-Mail-Uebereinstimmung verknuepft
   Owner-, Admin- oder Trainerkonten nicht automatisch.
5. Nur wenn der Owner die aktuelle Konfigurationsversion erfolgreich verwendet
   hat, den Passwort-Login in einem zweiten, getrennten Schritt abschalten.
6. SSO-only-Einladungsannahme, Domainbegrenzung, IdP-Recovery und den
   dokumentierten Administratorzugang des Providers praktisch testen.

Kritische Aenderungen an Aktivierung, Issuer, Client-ID, Client-Secret oder
Domain-Allowlist widerrufen bestehende OIDC-Sessions. OIDC-Sessions laufen
spaetestens nach 12 Stunden und bei einer Stunde Inaktivitaet ab; die Anwendung
prueft bei jedem Zugriff weiterhin aktive Identitaet, Issuer und Konfiguration.
RP-initiated beziehungsweise Backchannel Logout und SCIM sind nicht Bestandteil
des lokalen OIDC-Core. Sie muessen nur dann vor Go-live ergaenzt werden, wenn
Kundenvertrag oder IdP-Policy diese Enterprise-Funktionen verlangen. Weitere
Details stehen in [OIDC_SSO.md](./OIDC_SSO.md).

## Browser-Sicherheitsheader und CSP

Die App erzeugt fuer jede dynamische HTML-Antwort im Next.js-Proxy einen neuen
128-Bit-Nonce und reicht ihn intern an den Renderer weiter. Next.js versieht
damit Framework-, Seiten- und Inline-Skripte. `script-src` verwendet zusaetzlich
`strict-dynamic`; `unsafe-eval` wird nur vom Development-Server fuer dessen
Debugging geladen und ist in Production nicht enthalten. API- und sonstige
Nicht-Dokument-Antworten erhalten stattdessen `default-src 'none'` und duerfen
nicht eingebettet werden.

Die Dokument-Policy erlaubt externe HTTPS-Verbindungen fuer S3-Direktuploads,
tenantverwaltete Bilder/Medien und explizite Kurs-Einbettungen. Inline-Styles
sind als dokumentierte Kompatibilitaetsausnahme erforderlich, weil React im
Produkt dynamische Style-Properties setzt und Sonner sein paketiertes Stylesheet
zur Laufzeit einfuegt. Inline-Skripte und Inline-Eventhandler bleiben gesperrt.
Kamera, Mikrofon und Display-Capture sind nur fuer denselben Ursprung erlaubt,
damit der Abgaben-Recorder funktioniert; Geolocation, Payment und nicht
benoetigte Hardware-APIs sind deaktiviert.

Caddy muss `X-Forwarded-Proto: https` selbst setzen beziehungsweise eingehende
Forwarding-Header ersetzen. Dann aktiviert die CSP auch
`upgrade-insecure-requests`; Production sendet HSTS fuer zwei Jahre. Vor Pilot
sind mindestens diese beiden Antworten am oeffentlichen HTTPS-Ursprung zu
pruefen:

```bash
curl -fsSI https://academy.example/login
curl -fsSI https://academy.example/api/v1/health/ready
```

Die Login-Antwort muss eine pro Abruf unterschiedliche `nonce-...`-Quelle,
`strict-dynamic`, `frame-ancestors 'self'`, HSTS und die weiteren
Security-Header enthalten. Die API-Antwort muss mit `default-src 'none'` und
`frame-ancestors 'none'` antworten. HTML-Antworten duerfen deshalb nicht als
statische, tenantuebergreifende CDN-Antworten gecacht werden.

## Medienspeicher und Malware-Scan

Die Produktionskonfiguration erzwingt den S3-Treiber und startet den internen
ClamAV-Dienst, einen isolierten Next.js-Medienrunner, zwei kleine
Scan-Dispatcher und genau einen Maintenance-Dispatcher. Die Scan-Dispatcher
claimen jeweils nur ein Asset; der Maintenance-Dispatcher verarbeitet maximal
fuenf Storage-Assets als gemeinsames I/O-Budget. Alle drei rufen den
Medienrunner ueber das interne `jobs`-Netz auf. Der Medienrunner verwendet
dasselbe unveraenderliche App-Image wie die Web-App, ist aber ein eigener
Prozess ohne Proxy-Netz und mit einem Limit von 2 vCPU und 2 GiB RAM. Seine
Umgebung enthaelt weder Session-, Verschluesselungs-, Mail- noch KI-Secrets. Er
verwendet eine eigene PostgreSQL-Rolle und eigene S3-Zugangsdaten; die
oeffentliche App erhaelt weder Versionsloeschrechte noch das Medienjob-Secret.
App und Runner erreichen PostgreSQL ueber getrennte interne Docker-Netze und
koennen einander nicht per Service-DNS ansprechen.
ClamAV ist auf 3 vCPU und 5 GiB RAM begrenzt; der getrennte FreshClam-Updater
besitzt fuer Download und Signaturaufbereitung ein eigenes Limit von 1 vCPU und
2 GiB RAM. Ein aufwendiger Scan kann damit weder den
Web-Prozess noch dessen Next.js-Cache direkt beanspruchen. Das
persistierte Asset-Modell reserviert die Tenant-Quota atomar, trennt Incoming-
und freigegebene Objektschluessel und kennt die Zustaende `pending`, `uploaded`,
`scanning`, `ready`, `quarantined`, `failed` und `deleted`. Nur `ready`-Objekte
werden zum Download autorisiert. Upload, Statuswechsel, Scan-Lease, Retry,
Quarantaene und verifizierte physische Loeschung sind implementiert. Abgaben,
Kurseditor und Community verwenden den Endnutzer-Upload bereits; Kursmedien
werden tenantgebunden an Kurse und veroeffentlichte Snapshots gebunden.
Community-Posts binden bis zu sechs und Kommentare bis zu drei gepruefte Bild-,
Audio-, Video- oder Dokumentanhaenge atomar. Eine globale unveraenderliche
Registry verhindert Mehrfach- und mandantenfremde Bindungen; Inhaltsloeschung
erzeugt Medien-Tombstones. Die Zugriffspruefung folgt den aktuellen offenen oder
eingeschraenkten Bereichsrechten fuer Rollen, Personen, Gruppen und Bundles.
MP4-, MOV- und M4A-Dauern werden aus geprueften Containern, WAV-Dauern mit
einem streamingbasierten, ressourcenbegrenzten Parser ermittelt.
Profil- und Branding-Bilder verwenden denselben Scan- und Retention-Workflow.
Profilbilder werden authentifiziert und tenantgebunden ausgeliefert; oeffentliche
Branding-Slots werden aus dem aktiven Tenant-Host aufgeloest und geben keine
beliebigen Asset-IDs frei. Auch Quarantaene- und
endgueltige Fehlstatus geben reservierte Quota erst nach verifiziertem
Harddelete beider Objektpfade frei; ihre Diagnose-Tombstones bleiben danach 30
Tage erhalten.

### Externer privater S3-Bucket

Vor dem Rendern der Compose-Konfiguration muss ein separater Bucket pro Umgebung
bereitstehen. Fuer AWS S3 sind alle vier Einstellungen von
[Block Public Access](https://docs.aws.amazon.com/AmazonS3/latest/userguide/access-control-block-public-access.html)
zu aktivieren; ein S3-kompatibler Anbieter muss einen gleichwertigen Schutz
bereitstellen. Der Bucket darf weder Website-Hosting noch oeffentliche ACLs oder
oeffentliche Bucket-Policies verwenden.

Die folgenden Versionierungs-, Lifecycle- und Principal-Anforderungen gelten
vollstaendig fuer `MEDIA_S3_COMPATIBILITY_MODE=versioned`. STRATO HiDrive wird
nicht als stillschweigend gleichwertiger S3-Anbieter behandelt. Es muss mit
`https://s3.hidrive.strato.com`, Region `eu-central-1`, Path-Style,
`MEDIA_S3_COMPATIBILITY_MODE=strato-hidrive` und der bewussten Freigabe
`MEDIA_S3_STRATO_LIMITATIONS_ACCEPTED=true` konfiguriert werden. Dieser Modus
hat keine native Versionwiederherstellung, keinen nativen Export-Lifecycle,
keine Objekt-Tags, keinen nachgewiesenen Prefix-IAM-Vertrag und keine
verlaesslichen konditionalen Writes/Deletes. Er setzt den separaten
Acht-Tage-Export-Sweeper und die ETag-/Key-Kompensationen aus
[S3_PROVIDER_CONTRACT.md](./S3_PROVIDER_CONTRACT.md) voraus; ohne diese
Kontrollen darf der Release nicht freigegeben werden.

Die gesperrten Deploy- und Rollback-Skripte lesen den Modus ohne das Env-File zu
sourcen, aktivieren fuer diesen Modus automatisch `--profile strato` und warten
vor dem Persistieren des Release-State auf den Healthcheck. Dadurch laeuft
`strato-privacy-sweeper` alle 15 Minuten; sein Healthcheck verlangt einen
erfolgreichen, verifizierten Vollzyklus innerhalb von 40 Minuten. Ein einzelner
Traversal-Zyklus darf hoechstens 20 Minuten dauern, damit selbst zwei
unguenstig verschobene Scanpositionen plus Intervall und Reserve innerhalb der
einstuendigen Loeschmarge bleiben. Der Healthcheck gewaehrt beim Containerstart
25 Minuten fuer diesen ersten Vollzyklus. Manuelle
Compose-Aufrufe muessen das Profil ebenfalls explizit aktivieren.

- `MEDIA_S3_ENDPOINT` muss ein vom Rootserver erreichbarer HTTPS-Ursprung mit
  gueltiger Zertifikatskette sein. Bucket, Region und Path-Style-Einstellung
  muessen zum Anbieter passen.
- Pro Umgebung sind zwei verschiedene technische Principals erforderlich.
  `MEDIA_S3_APP_ACCESS_KEY_ID` darf fuer Medien nur kurzlebige Browser-PUTs unter
  `incoming/` signieren, die zugehoerigen Upload-Metadaten lesen und exakt
  freigegebene Objektversionen unter `tenants/` lesen. Dieser Principal erhaelt
  fuer Asset-Pfade keine Copy-, List- oder Delete-Rechte. Unter dem getrennten
  Schluesselform `tenants/<tenant-uuid>/privacy-exports/<object>` braucht die
  App dagegen `PutObject`,
  `PutObjectTagging`, `GetObjectVersion` und `DeleteObjectVersion`, damit GET/HEAD,
  verschluesselte DSAR-Artefakte write-once gespeichert, exakt gelesen und nach
  sieben Tagen physisch geloescht werden. Bucket- oder Versionslisten bleiben
  auch dort verboten. `MEDIA_S3_ACCESS_KEY_ID` gehoert nur
  zum Medienrunner und erhaelt die minimalen Rechte fuer Scan, Copy-Promotion
  und Harddelete. Fuer ihn sind `ListBucketVersions`, `DeleteObject`,
  `DeleteObjectVersion` und fuer die App-Principal-Abnahme
  `GetObjectVersionTagging` sowie `s3:GetLifecycleConfiguration` zwingend
  erforderlich, weil der Loeschpfad bei
  jedem Objekt prueft, dass weder Versionen noch Delete-Marker uebrig sind und
  der Canary das verpflichtende Export-Tag nachweist. Beide
  Principals erhalten keine Benutzer-, Policy- oder sonstige
  Bucket-Administration und duerfen keine gemeinsamen Schluessel verwenden.
- Der Bucket muss standardmaessig serverseitig mit SSE-S3 oder SSE-KMS
  verschluesseln. Bei SSE-KMS braucht der technische Principal die minimalen
  Schluesselrechte und der Schluessel einen dokumentierten Rotations- und
  Wiederherstellungsprozess. Siehe
  [S3-Verschluesselung](https://docs.aws.amazon.com/AmazonS3/latest/userguide/UsingEncryption.html).
- Bucket-Versionierung muss aktiviert sein und der Anbieter muss fuer `HEAD`,
  `GET` und `COPY` eine echte, von `null` verschiedene `VersionId` liefern.
  Ohne diese Identitaet bricht der Upload fail-closed ab; ein Objekt wird nie
  als `ready` freigegeben. Download-Autorisierungen pruefen Metadaten, ETag,
  SHA-256 und Groesse gegen die Datenbank und signieren genau die beim Scan
  gespeicherte Version. Eine
  serverseitige Lifecycle-Regel soll unvollstaendige Multipart-Uploads nach
  hoechstens sieben Tagen abbrechen und verwaiste aktuelle Objekte unter
  `incoming/` fruehestens nach sieben Tagen entfernen. Der Worker
  entfernt Incoming-Objekte regulaer erst nach Ablauf der signierten URL plus
  einer Sicherheitsstunde. Unter `tenants/.../assets/...` duerfen weder aktuelle
  noch nicht aktuelle Versionen pauschal ablaufen: Die in PostgreSQL gebundene
  Scan-Version kann nach einem fremden oder fehlerhaften Schreibvorgang
  nicht aktuell sein und muss trotzdem bis zum verifizierten Harddelete
  erhalten bleiben. Siehe
  [S3-Lifecycle-Regeln](https://docs.aws.amazon.com/AmazonS3/latest/userguide/intro-lifecycle-rules.html).
- Fuer die Schluesselform `tenants/<tenant-uuid>/privacy-exports/...` ist
  zusaetzlich der Defense-in-Depth-Lifecycle aus
  [`deploy/s3-privacy-export-lifecycle.production.example.json`](../deploy/s3-privacy-export-lifecycle.production.example.json)
  verpflichtend. Da S3 in Prefixfiltern keine `*`-Wildcard auswertet, setzt
  jeder Export-PUT das Tag `q-academy-lifecycle=privacy-export-v1`. Die
  aktivierte Regel kombiniert den echten Prefix `tenants/` mit genau diesem
  Tag und entfernt aktuelle sowie nicht aktuelle Versionen nach exakt acht
  Tagen; eine getrennte `tenants/`-Regel bereinigt abgelaufene Delete-Marker.
  Der App-Scheduler bleibt mit seiner exakten Sieben-Tage-Loeschung autoritativ;
  die Providerregel faengt vor einem DB-Commit verwaiste oder fehlgeschlagene
  Uploads ab. Nach einem erfolgreichen PUT persistiert die App die exakte
  `VersionId` und den ETag sofort am noch gebauten Artefakt. Fehlerpfade und der
  Retention-Retry loeschen ausschliesslich diese Version mit passendem ETag;
  nur die Lifecycle-Regel deckt das enge Orphan-Fenster zwischen PUT und
  Datenbank-Commit ab. Der App-Principal erhaelt dafuer weiterhin weder `ListBucket`
  noch `ListBucketVersions` oder Bucket-Lifecycle-Administration.
- DSAR-Downloads sind auf 32 MiB Klartext/ZIP, davon hoechstens 16 MiB
  strukturiertes JSON und 12 MiB gebundene Medien, sowie ein 64-MiB-Envelope
  begrenzt. JSON- und ZIP-Groessen werden vor den grossen Folgeallokationen
  exakt vorgeprueft; Media-Reads schreiben direkt in einen verifizierten
  Zielpuffer.
  `GetObject` einschliesslich vollstaendigem Body-Verbrauch hat eine gemeinsame
  30-Sekunden-Deadline und wird unabhaengig vom Provider-`Content-Length`
  chunkweise gezaehlt. Persistente Limits erlauben sechs Downloads pro Owner
  und 30 pro Tenant in 15 Minuten sowie einen laufenden Read pro Tenant mit
  hoechstens 15 Minuten Crash-Lease; jeder App-Prozess nimmt ohne Warteschlange
  insgesamt maximal eine DSAR-Erzeugung oder einen Download an. Die lokale
  Prozesslease verfaellt waehrend einer aktiven Operation nicht automatisch,
  sondern wird im `finally` beziehungsweise nach Streamabschluss freigegeben.
  Der Download wird in 64-KiB-Kopien gestreamt und nach insgesamt zehn Minuten
  zwingend abgebrochen und freigegeben. Der Web-App-Container ist deshalb mit
  einem harten Speicherlimit von 2 GiB zu betreiben und unter Grenzlast vor
  Pilotfreigabe zu verifizieren.
- Datenbank-Backups enthalten keine S3-Objekte. Versionierung, Replikation oder
  ein separates Objektspeicher-Backup muessen deshalb gegen RPO, RTO und
  Loeschfristen getestet werden.

Vor dem Deployment ist der sichere, schreibende Provider-Preflight aus
[S3_PROVIDER_CONTRACT.md](./S3_PROVIDER_CONTRACT.md) vollstaendig auszufuehren
und mit verifiziertem Canary-Cleanup zu dokumentieren.

Die Beispieldatei enthaelt nur die beiden verpflichtenden DSAR-Regeln. Da
`PutBucketLifecycleConfiguration` immer die gesamte Bucket-Konfiguration
ersetzt, muessen sie mit vorhandenen Regeln (etwa fuer abgebrochene
Multipart-Uploads) zu einem Gesamtdokument zusammengefuehrt werden. Nach dem
Einspielen mit einem Provider-Administrator wird die wirksame Konfiguration
mit `GetBucketLifecycleConfiguration` gelesen und der Provider-Preflight
ausgefuehrt. Der Operator-Principal des Preflights braucht dieses Leserecht;
der Web-App-Principal nicht.

Im Modus `versioned` benoetigen direkte signierte Browser-PUTs eine restriktive
Bucket-CORS-Regel.
`AllowedOrigins` muss jeden tatsaechlichen kanonischen HTTPS-Ursprung einzeln
nennen; Wildcards und `*` sind unzulaessig. Der aktuelle signierte PUT bindet
`Content-Type`, die vom Browser gesetzte exakte `Content-Length` und
`If-None-Match: *`. Fuer den Browser-Preflight sind `PUT`, `Content-Type` und
`If-None-Match` freizugeben:

```json
[
  {
    "AllowedOrigins": ["https://academy.example.com"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["Content-Type", "If-None-Match"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 300
  }
]
```

Im Modus `strato-hidrive` gilt dieser PUT-Vertrag nicht. Die Bucket-CORS-Regel
muss stattdessen `POST` fuer den exakten Produktionsursprung sowie `ETag` als
Expose-Header erlauben. Der Client sendet den signierten Multipart-POST ohne
eigene Request-Header und ohne XHR-Upload-Listener, damit kein von STRATO nicht
beantworteter OPTIONS-Preflight erforderlich wird.

`Content-Length` wird vom Browser kontrolliert und deshalb nicht manuell als
Request-Header gesetzt. Weitere Header duerfen erst ergaenzt werden, wenn der
Client sie tatsaechlich sendet. CORS ersetzt keine Authentifizierung oder
Bucket-Policy; S3 wertet diese weiterhin aus. Details stehen in der offiziellen
[S3-CORS-Dokumentation](https://docs.aws.amazon.com/AmazonS3/latest/userguide/ManageCorsUsing.html).
Die signierten PUT-URLs bleiben kurzlebig, werden serverseitig an einen
tenantgebundenen Objektschluessel und `Content-Type` gebunden und duerfen ein
Objekt erst nach Groessen-, Signatur- und Malware-Pruefung fachlich freigeben.

### Interner ClamAV-1.5-Dienst

`compose.production.yml` verwendet fuer beide Scannerrollen dasselbe ueber
`CLAMAV_IMAGE` an einen echten SHA-256-Digest gebundene ClamAV-1.5-Image.
`clamav-freshclam` besitzt als einziger Scannercontainer das `egress`-Netz,
schreibt initial und danach standardmaessig zwoelfmal pro Tag in das Volume
`clamav_signatures` und startet keinen `clamd`. Der eigentliche Dienst `clamav`
mountet dieses Volume nur lesend, startet keinen FreshClam und bleibt
ausschliesslich im internen `media`-Netz. Port 3310 darf nicht am Host oder an
Caddy publiziert werden. Beide Rollen verwenden den offiziellen
`/init-unprivileged`-Entrypoint als Benutzer `clamav`, ein read-only Root-Dateisystem,
`cap_drop: ALL` und nur eng begrenzte Tmpfs-/Volume-Schreibpfade.

Ein leerer `_base`-Volume-Start blockiert `clamav`, bis der Updater eine gueltige
Daily-Datenbank geladen hat. Beide Healthchecks wenden
`scripts/ops/clamav-signature-health.sh` an. `daily.cvd` oder `daily.cld` muss eine
regulaere Datei mit vollstaendigem offiziellem 512-Byte-`ClamAV-VDB`-Header sein.
Das Alter wird ausschliesslich aus dessen internem Erstellungszeitstempel
ermittelt: Kopieren oder `touch` einer alten Datenbank erneuert das Gate daher
nicht. Der interne Zeitstempel darf nicht aus der Zukunft stammen und darf bei
`CLAMAV_SIGNATURE_MAX_AGE_SECONDS=129600` hoechstens 36 Stunden alt sein.
Verkuerzte oder strukturell ungueltige Header schlagen geschlossen fehl. Der
Medienrunner verwendet dieselbe interne Zeitquelle fuer Zeitstempel, Alter und
Gate-Status in den Prometheus-Metriken;
`QAcademyClamAvUpdaterStalled`, `QAcademyClamAvSignaturesStale` und der
Missing-Metrics-Alarm sind verbindlich. Die oeffentliche App besitzt keinen
Zugang zum `media`-Netz. Uploads bleiben bei Scanner- oder Signaturausfall
unfertig und werden niemals als `ready` freigegeben. Die offiziellen
[ClamAV-Docker-Hinweise](https://docs.clamav.net/manual/Installing/Docker.html)
nennen 3 GiB als Minimum und 4 GiB als bevorzugten RAM-Bedarf allein fuer
`clamd`; 2 GiB koennen unzureichend sein. Die Compose-Grenzen reservieren daher
bis zu 5 GiB fuer `clamd` und separat bis zu 2 GiB fuer `clamav-freshclam`, weil
Signaturaufbereitung und laufende Scans waehrend eines Reloads ueberlappen
koennen. Zusammen mit je 2 GiB fuer App und Medienrunner sowie PostgreSQL,
Proxy, Dispatchern und optionalem Monitoring ist 16 GB die kleinste
Betriebsklasse; fuer reale Parallelitaet sind 24 GB oder mehr vorzusehen.
Der App-Container besitzt unabhaengig davon ein festes Limit von 2 CPUs und
2 GiB RAM. Der Medienrunner definiert seinen eigenen 2-CPU-/2-GiB-Block und
erbt das App-Limit nicht implizit. Diese Grenzen muessen in Lasttests mit einem
maximal grossen Privacy-Export und gleichzeitigem normalem App-Verkehr
nachgewiesen werden; ein zweiter Privacy-Lauf muss geschlossen abgewiesen werden.

Bei einem Signaturalarm niemals das Alters-Gate anheben oder den Medienjob
manuell freigeben. Zuerst Updaterstatus, Signaturalter und sichere Logs pruefen:

```bash
docker compose --env-file "$Q_ACADEMY_ENV_FILE" -f compose.production.yml ps clamav-freshclam clamav media-runner
docker compose --env-file "$Q_ACADEMY_ENV_FILE" -f compose.production.yml logs --tail=100 clamav-freshclam clamav
docker compose --env-file "$Q_ACADEMY_ENV_FILE" -f compose.production.yml exec -T clamav-freshclam /bin/sh /opt/q-academy/clamav-signature-health.sh signatures
```

DNS, TLS, Provider-Erreichbarkeit, Volume-Fuellstand und Eigentuemerschaft
beheben, dann nur `clamav-freshclam` neu starten. Erst wenn dessen Healthcheck,
der `clamav`-Healthcheck und der Clean-/Testvektor-Preflight bestehen, duerfen
Medienworker wieder freigegeben werden.

Die Compose-Konfiguration setzt `StreamMaxLength`, `MaxScanSize` und
`MaxFileSize` auf denselben Wert wie `MEDIA_MAX_UPLOAD_BYTES` und aktiviert
`AlertExceedsMax`. Q-Academy begrenzt diesen Wert auf `2000000000` Bytes, weil
ClamAV 1.5 laut offizieller
[Beispielkonfiguration](https://github.com/Cisco-Talos/clamav/blob/clamav-1.5.2/etc/clamd.conf.sample)
Dateien ueber 2 GB technisch nicht scannen kann. Der
[INSTREAM-Vertrag](https://docs.clamav.net/manual/Usage/ClamdProtocol.html#instream)
verlangt ausserdem, dass der gesamte Stream innerhalb von `StreamMaxLength`
bleibt. Abweichende hoehere Upload-Grenzen werden bereits beim App-Start
abgelehnt. Vor Freischaltung realer Uploads muessen Scan-Timeout und parallele
Scanlast mit Dateien nahe dieser Obergrenze getestet werden. Ein nicht
erreichbarer Scanner, ein Limitfehler oder eine veraltete Signaturdatenbank darf
in Produktion keine Freigabe eines Objekts bewirken.

Der Release-Medienpreflight streamt deshalb einen sauberen Canary und einen nur
zur Laufzeit zusammengesetzten Standard-AV-Testvektor ueber `INSTREAM`. Der
erste muss sauber sein, der zweite mit Signatur erkannt werden. `/api/v1/health/ready`
bleibt trotzdem absichtlich auf App, Datenbank und Schema begrenzt: Ein
Scanner- oder S3-Ausfall darf neue Medien fail-closed anhalten, aber nicht die
gesamte Plattform aus Caddy entfernen. Positiv-/Negativvertraege fuer beide
S3-Principals, ClamAV und die laufenden Alarmsignale sind in
[DEEP_READINESS.md](./DEEP_READINESS.md) festgelegt.

## Hostseitige Egress-Durchsetzung

Die Anwendung validiert ausgehende HTTP-Ziele selbst. Fuer Defense-in-Depth
liegt zusaetzlich eine hostseitige, projektgebundene Egress-Policy vor:
[`docker-egress-firewall.sh`](../scripts/ops/docker-egress-firewall.sh) liest
ausschliesslich die nicht geheime, strikt geparste
[`docker-egress-policy.conf`](../deploy/security/docker-egress-policy.conf).
Sie liest weder die Produktions-Environment noch Container-Environments und
gibt keine inspizierten Docker-Payloads aus.

Die eingecheckte Policy ist absichtlich klein:

| Compose-Netz | Erlaubter ausgehender Zielport | Zweck |
| --- | --- | --- |
| `egress` | TCP 80 und 443 | S3-/Provider-Preflight, Medienworker und ClamAV-Signaturen |
| `proxy` | TCP 80 und 443, UDP 443 | App-Providerverkehr und Caddy ACME/HTTPS |

Docker-internes DNS an `127.0.0.11` wird im Container-Namespace beantwortet und
benoetigt keine Freigabe zum Host. Interne App-Protokolle bleiben auf ihren
jeweiligen Bridges erhalten. Verkehr innerhalb derselben kontrollierten Bridge
wird vor der Zielklassifizierung zurueck an Docker gegeben. Alle anderen
Weiterleitungen aus `proxy` und `egress` werden zuerst gegen Cloud-Metadata,
Loopback, private, Link-local-, CGNAT-, reservierte, Dokumentations-, Benchmark-,
Multicast-, IPv4-Mapped-, NAT64-, Teredo-, 6to4- und IPv6-ULA-Bereiche geprueft.
Erst danach gelten die Portfreigaben; der Abschluss pro Eingangsbridge ist ein
Default-Drop. Ein separater Host-`INPUT`-Hook blockiert auch Zugriffe auf das
Bridge-Gateway oder andere lokale Hostdienste. Damit ist ein erlaubter Port 443
kein Weg zu `169.254.169.254`, `fd00:ec2::254`, RFC1918 oder einem lokalen
Rootserver-Dienst.

Das Werkzeug akzeptiert nur den exakten Compose-Projektnamen. Fuer jede Policy-
Zeile muss `${project}_${network}` existieren und die Docker-Labels
`com.docker.compose.project` und `com.docker.compose.network`, der Bridge-Treiber,
lokaler Scope, `Internal=false`, `Ingress=false`, konsistente IPv6-Aktivierung,
Interface-Name und kanonisches IPAM muessen exakt passen. Eine
fehlende, fremde, interne oder mehrdeutige Bridge bricht den Lauf ab. `auto`
bindet sich an das von Docker selbst gemeldete Firewall-Backend. Bei
`iptables` beziehungsweise `iptables-nft` ist Dockers `DOCKER-USER`-Kette
zwingend. Nur wenn Docker selbst `nftables` meldet, wird ein eigenes natives
`nft`-Table mit Forward- und Input-Hook eingesetzt; eine bloss fehlende
`DOCKER-USER`-Kette loest niemals diesen Fallback aus. Sobald eine kontrollierte
Bridge IPv6 besitzt, ist
das native `nft`-Backend zwingend, damit IPv4 und IPv6 in genau einer atomaren
Transaktion aktiviert werden. Getrennte iptables/ip6tables-Commits werden
bewusst abgelehnt; es gibt keinen stillen IPv6-Fallback.

Die lokale Produktionsbaseline bleibt deshalb IPv4 auf den Compose-Bridges mit
Dockers iptables-Backend und `iptables-nft` als Distribution-Frontend. Dockers
[natives nftables-Backend](https://docs.docker.com/engine/network/firewall-nftables/)
ist laut Hersteller derzeit experimentell und darf auf dem Zielserver nur nach
expliziter Versionsfreigabe und dem vollstaendigen externen IPv4-/IPv6-Gate
verwendet werden. Das Werkzeug unterstuetzt diesen kontrollierten Pfad, schaltet
ihn aber nicht ein.

Nach dem ersten Compose-Start, wenn die beiden Bridges existieren, wird der
exakte Projektname aus der gerenderten Compose-Konfiguration gelesen und
zunaechst nur validiert. Die JSON-Evidence auf stdout enthaelt keine Secrets:

```bash
cd /opt/q-academy
export Q_ACADEMY_ENV_FILE=/etc/q-academy/production.env
project_name="$(docker compose --env-file "$Q_ACADEMY_ENV_FILE" \
  -f compose.production.yml config --format json \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["name"])')"

sudo bash scripts/ops/docker-egress-firewall.sh dry-run \
  --project "$project_name" --evidence -
```

Erst nach Kontrolle von Projekt, Bridges, erlaubten Ports und Backend wird die
Policy bewusst als eigene Rootserver-Aktion aktiviert und direkt erneut
verifiziert:

```bash
sudo bash scripts/ops/docker-egress-firewall.sh apply --project "$project_name"
sudo bash scripts/ops/docker-egress-firewall.sh verify --project "$project_name"
sudo install -m 0600 \
  "/var/lib/q-academy/security/docker-egress-$(printf '%s' "$project_name" | sha256sum | cut -c1-12)-evidence.json" \
  "/var/lib/q-academy/operations-exports/egress-firewall-$(date -u +%Y%m%dT%H%M%SZ).json"
```

`apply` und `verify` versiegeln beziehungsweise vergleichen SHA-256-Digests von
Werkzeug, Policy, exakter Docker-Netz-ID samt Netzmanifest und dem tatsaechlich
installierten, nur diesem Projekt gehoerenden Kernel-Ruleset. Die Evidence gibt
von der Docker-Netz-ID nur einen SHA-256-Digest aus und haelt das von Docker
gemeldete Firewall-Backend fest. State und Evidence werden unter
einem `flock`, mit Modus `0600` und atomarem Rename geschrieben. Wiederholtes
`apply` erzeugt weder doppelte Jumps noch parallele Rulesets. Kollisionen mit
nicht eindeutig eigenen Chains/Tables und doppelte Ownership-Jumps fuehren zum
Abbruch. Die Ownership-Jumps stehen nach jedem Apply an Position eins der
jeweiligen Host-Chain. Ein Fehler bei der Regelerzeugung wird vor dem atomaren
Commit erkannt.

Nach jedem Docker-/Host-Update, Neustart und jeder Netzneuerstellung ist
`verify` ein verpflichtendes Gate. Die Boot-Reihenfolge und dauerhafte
Aktivierung werden absichtlich nicht aus dem Repository eingeschaltet: Die
reale Unit beziehungsweise Host-Automation muss auf dem Zielserver nach Docker
und nach der Erzeugung der Compose-Netze `apply`, danach `verify` ausfuehren und
bei jedem Fehler App-/Workerfreigabe verhindern. Dieses Boot-, IPv4-/IPv6- und
Kernel-Gate gehoert zur externen Rootserver-Abnahme. Vor Kundendaten sind
Negativtests gegen beide Metadata-Adressen, Host-Gateway, RFC1918/ULA und einen
nicht erlaubten Port sowie Positivtests fuer alle realen HTTPS-/ACME-/S3-/ClamAV-
Ziele mit dem aktiven Provider-DNS durchzufuehren.

Nur fuer einen kontrollierten Rollback entfernt der folgende Befehl exakt die
projektgebundenen Ownership-Jumps beziehungsweise das eigene nft-Table. Er
oeffnet den Egress und ist daher ein Security-Incident, kein normaler
Fehlerbehebungsschritt. Existiert noch ein Ruleset, ist der passende versiegelte
State zwingend; gleichnamige fremde Chains/Tables werden nie entfernt:

```bash
sudo bash scripts/ops/docker-egress-firewall.sh remove --project "$project_name"
```

Ein privater S3-, Mail-, OIDC-, KI- oder sonstiger Provider-Endpunkt ist mit
dieser Basispolicy absichtlich nicht erreichbar. Solche Ziele duerfen nicht
durch das Entfernen privater Deny-Bereiche freigeschaltet werden. Dafuer ist ein
kontrollierter Outbound-Proxy oder eine separat reviewte, engere Zielpolicy mit
neuem Evidence- und Abnahmelauf erforderlich.

## Erstinstallation

1. Repository nach `/opt/q-academy` auschecken, exakt den freigegebenen Commit
   aktivieren und einen vollstaendig sauberen Worktree sicherstellen. Der
   Release-Tag ist immer `git-` plus vollstaendiger Git-Objekt-ID. Die
   Betriebsskripte ausfuehrbar machen:

   ```bash
   sudo chmod 0750 scripts/ops/deploy-release.sh scripts/ops/rollback-release.sh \
     scripts/ops/postgres-backup.sh scripts/ops/postgres-restore.sh \
     scripts/ops/verify-image-pins.sh scripts/ops/create-release-artifact.sh \
     scripts/ops/publish-release-images.sh scripts/ops/docker-egress-firewall.sh
   ```
2. Konfiguration ausserhalb des Repositories anlegen:

   ```bash
   sudo install -d -m 0750 /etc/q-academy
   sudo install -m 0600 deploy/.env.production.example /etc/q-academy/production.env
   sudo editor /etc/q-academy/production.env
   sudo test "$(stat -c '%a' /etc/q-academy/production.env)" = 600
   ```

   Die Operator-Container erhalten keine Repository- oder Host-Root-Mounts.
   Eingaben und Ausgaben werden auf zwei feste Verzeichnisse begrenzt. Das
   Eingabeverzeichnis ist im Container read-only; nur UID/GID 1001 darf neue
   Export- und Evidenzdateien anlegen. Die Werte muessen mit
   `OPERATIONS_INPUT_DIR` und `OPERATIONS_EXPORT_DIR` in der Env-Datei
   uebereinstimmen:

   ```bash
   sudo install -d -o root -g 1001 -m 0750 /var/lib/q-academy/operations-input
   sudo install -d -o 1001 -g 1001 -m 0700 /var/lib/q-academy/operations-exports
   sudo test "$(stat -c '%u:%g:%a' /var/lib/q-academy/operations-input)" = "0:1001:750"
   sudo test "$(stat -c '%u:%g:%a' /var/lib/q-academy/operations-exports)" = "1001:1001:700"
   ```

   Das Ausgabedateisystem muss Hardlinks unterstuetzen. Der Dispatcher prueft
   dies vor jedem schreibenden Lauf und akzeptiert weder Pfade ausserhalb der
   Mounts noch Symlink-Escapes. Policy-Manifeste und Kundenexporte werden als
   root-eigene, fuer Gruppe 1001 lesbare Dateien mit Modus `0440` in das
   Eingabeverzeichnis uebertragen.

   Fuer das temporaere Medien-Arbeitsverzeichnis ein eigenes, groessenbegrenztes
   Disk-Filesystem bereitstellen. Das folgende Beispiel verwendet bewusst eine
   neue 10-GiB-Loopdatei; der `test` verhindert ein versehentliches
   Ueberschreiben. Ein vorhandenes dediziertes LVM-/Quota-Volume ist ebenso
   geeignet. Das Mount muss `nodev,nosuid,noexec` tragen. Sein Root und der
   Sentinel bleiben root-eigen; nur das Job-Unterverzeichnis gehoert UID/GID
   1001:

   ```bash
   sudo test ! -e /var/lib/q-academy-media-processing.ext4
   sudo truncate -s 10G /var/lib/q-academy-media-processing.ext4
   sudo mkfs.ext4 -F /var/lib/q-academy-media-processing.ext4
   sudo install -d -m 0700 /var/lib/q-academy-media-processing
   printf '%s\n' '/var/lib/q-academy-media-processing.ext4 /var/lib/q-academy-media-processing ext4 loop,nodev,nosuid,noexec 0 2' \
     | sudo tee -a /etc/fstab
   sudo mount /var/lib/q-academy-media-processing
   sudo chown root:root /var/lib/q-academy-media-processing
   sudo chmod 0755 /var/lib/q-academy-media-processing
   printf '%s\n' 'q-academy-media-processing-v1' \
     | sudo tee /var/lib/q-academy-media-processing/.q-academy-media-work-root >/dev/null
   sudo chown root:root /var/lib/q-academy-media-processing/.q-academy-media-work-root
   sudo chmod 0444 /var/lib/q-academy-media-processing/.q-academy-media-work-root
   sudo install -d -m 0700 -o 1001 -g 1001 /var/lib/q-academy-media-processing/work
   findmnt --target /var/lib/q-academy-media-processing
   ```

   `MEDIA_PROCESSING_WORK_DIR` muss exakt auf diesen Host-Mount zeigen. Compose
   erstellt einen fehlenden Pfad nicht automatisch. Deploy, Rollback und
   Restore verlangen ein eigenes `nodev,nosuid,noexec`-Mount, den root-eigenen
   exakten Sentinel und das UID/GID-1001-Unterverzeichnis `work`. Unterhalb des
   Mounts darf kein weiteres Dateisystem eingehangen sein; `findmnt -R
   /var/lib/q-academy-media-processing` darf genau den Haupt-Mount ausgeben.
   Der Runner leert `work` rekursiv, bleibt dabei mit `find -xdev` auf diesem
   Dateisystem und bricht bei einem nicht loeschbaren Mountpunkt ab. Der
   Sentinel-geschuetzte Mount selbst ist nie ein Loeschziel. Das Volume ist kein
   persistenter Medienspeicher und wird nicht gesichert.

3. Fuer `POSTGRES_BOOTSTRAP_PASSWORD`, `OWNER_POSTGRES_PASSWORD`,
   `APP_POSTGRES_PASSWORD`, `MEDIA_POSTGRES_PASSWORD`,
   `SESSION_SECRET`, `AUTH_RATE_LIMIT_SECRET`, `MFA_RECOVERY_PEPPER`,
   `PRIVACY_SUBJECT_HMAC_SECRET`,
   `EXAM_SELECTION_SECRET`, `WEBHOOK_ENCRYPTION_KEY`, `DATA_ENCRYPTION_KEY`, `CRON_SECRET`,
   `MEDIA_CRON_SECRET`, `METRICS_SECRET`, `MEDIA_METRICS_SECRET` und
   `EMAIL_DELIVERY_WEBHOOK_SECRET` und `EMAIL_DELIVERY_INBOUND_SECRET` jeweils
   einen eigenen Wert erzeugen:

   ```bash
   openssl rand -hex 32
   ```

   `AUDIT_EXPORT_HMAC_KEY` verwendet separat mindestens 32 zufaellige
   Base64url-Bytes und wird ausschliesslich den kurzlebigen Export-,
   Loesch- und Verifikationsdiensten injiziert:

   ```bash
   openssl rand -base64 48 | tr '+/' '-_' | tr -d '=\n'
   ```

   Dazu eine nicht geheime Rotations-ID wie `audit-2026-01` als
   `AUDIT_EXPORT_HMAC_KEY_ID` setzen. Alte HMAC- und Daten-Keys muessen fuer die
   vereinbarte Nachweisfrist weiterhin kontrolliert abrufbar bleiben.

   Alle vier PostgreSQL-Passwoerter muessen exakt 64 Hex-Zeichen lang und
   paarweise verschieden sein. `POSTGRES_DB` und alle Rollennamen muessen
   `^[a-z][a-z0-9_]{0,62}$` entsprechen. Der netzlose
   `database-config-preflight` prueft dies vor der ersten PGDATA-Initialisierung.

   `POSTGRES_BOOTSTRAP_USER` ist der vom offiziellen Image nur fuer
   Initialisierung, Rollenpflege, Backup und Restore angelegte Superuser.
   `OWNER_POSTGRES_USER` ist davon verschieden und wird bei jedem Lauf explizit
   auf `NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
   NOINHERIT` gesetzt. Dasselbe gilt fuer App und Media. Nur dieser
   Owner fuehrt Migrationen aus und besitzt Datenbank, Schemas und
   Anwendungsobjekte; App und Medienrunner erhalten eigene noch kleinere Rollen.
   Die vier Rollennamen werden beim ersten Rollenabgleich in der Datenbank
   markiert und sind danach unveraenderlich. Eine Namensaenderung in der Env-Datei
   bricht vor jeder Rollen- oder Passwortmutation ab und muss als geplante
   Datenbankmigration durchgefuehrt werden.

   Bei einem unmarkierten Upgrade inventarisiert der Rollenabgleich vorab alle
   Owner, expliziten ACLs, Default-ACLs, Policy-Rollen und relevanten
   Memberships der Datenbank sowie der Schemas `public` und `drizzle`. Verweist
   etwas auf eine nicht konfigurierte Nicht-Systemrolle, bricht er ohne
   Aenderung ab. Dann zuerst ein verifiziertes Backup erstellen, die alte Rolle
   und ihre Grants fachlich zuordnen und per gepruefter Rename-/Revoke-Migration
   bereinigen; niemals durch kurzfristiges Wiedereintragen des alten Logins oder
   manuelles Setzen der Identitaetsmarker umgehen.

   Owner-, App- und Media-Passwoerter koennen in einem Wartungsfenster durch
   Aktualisieren der geschuetzten Env-Datei und erneutes Ausfuehren von
   `database-role` rotiert werden. Das von Q-Academy aus dem offiziellen
   PostgreSQL-Basisimage abgeleitete Image wendet
   `POSTGRES_BOOTSTRAP_PASSWORD` bei vorhandenem `PGDATA` nicht erneut an. Dieses
   Passwort daher zuerst mit dem noch gueltigen Bootstrap-Zugang per `ALTER ROLE`
   in PostgreSQL rotieren, danach die Env-Datei atomar aktualisieren und
   Preflight, Rollenabgleich und ein verifiziertes Backup ausfuehren. Nur die
   Env-Datei zu aendern sperrt die Operationscontainer aus.

   Beim S3-Anbieter zwei getrennte Principals provisionieren und deren Access-/
   Secret-Keys in `MEDIA_S3_APP_*` beziehungsweise `MEDIA_S3_*` eintragen.

   Fuer `NODE_IMAGE`, den lokalen Fallback `POSTGRES_IMAGE`, `CLAMAV_IMAGE`,
   `PROMETHEUS_IMAGE` und `NODE_EXPORTER_IMAGE` jeweils das
   freigegebene Upstream-Image ziehen und die vom Registry-Provider
   veroeffentlichte unveraenderliche Referenz im Format
   `name:tag@sha256:<64-hex>` eintragen. Digests niemals raten oder aus einer
   anderen Architektur uebernehmen. Release-Evidence muss Referenz,
   Zielarchitektur, Abrufzeitpunkt und erfolgreichen Vulnerability-Scan
   enthalten. Im normalen `verified-manifest`-Pfad ist jedoch nicht der
   PostgreSQL-Fallback aus der Env-Datei autoritativ: Das attestierte
   `Q_ACADEMY_POSTGRES_IMAGE` aus `release-images.env` wird vor dem ersten
   Compose-Aufruf als `POSTGRES_IMAGE` gesetzt und erst nach erfolgreicher
   Readiness atomar in der Env-Datei persistiert. `APP_IMAGE_TAG` bleibt bei der
   Erstinstallation leer und wird erst
   nach erfolgreicher Readiness durch das gesperrte Deploy-Skript gesetzt;
   danach pflegen Deploy und Rollback den Wert atomar.

   Das Datenbankpasswort muss URL-sicher bleiben. Geheimnisse nicht in Git,
   Shell-History, Tickets oder Container-Build-Argumente schreiben. Die Daten- und
   Webhook-Verschluesselungsschluessel duerfen spaeter nicht ohne geplante
   Re-Verschluesselung ersetzt werden. Fuer die Erstinstallation ausserdem
   eindeutige, nicht geheime IDs wie `data-2026-01`, `mfa-recovery-2026-01`
   und `webhook-2026-01` in `DATA_ENCRYPTION_KEY_ID`,
   `MFA_RECOVERY_PEPPER_ID` beziehungsweise `WEBHOOK_ENCRYPTION_KEY_ID`
   eintragen. Beide `*_PREVIOUS_KEYS` bleiben zunaechst leer.

   `LEGAL_IMPRINT_URL`, `LEGAL_PRIVACY_URL` und `SUPPORT_EMAIL` muessen vor dem
   Start auf die juristisch freigegebenen Betreiberangaben zeigen. Beispielwerte
   aus der Vorlage sind nicht produktionsgeeignet.

4. Image-Pins und DNS pruefen. Danach das zum exakten Commit gehoerende Artefakt
   `q-academy-published-release-<commit>` aus dem erfolgreichen Main-Workflow in
   ein root-eigenes Verzeichnis laden. Das Artefakt enthaelt ein
   digest-gepinntes Manifest, dessen SHA-256 und GitHub-Build-Provenance vor dem
   Deploy geprueft werden muessen. Die GitHub CLI kann auf einer getrennten
   Admin-Workstation laufen; Manifest und Attestierungsnachweis werden danach
   unveraendert auf den Server uebertragen:

   ```bash
   release_commit="$(git rev-parse HEAD)"
   release_tag="git-$release_commit"
   install -d -m 0750 "/var/lib/q-academy/releases/artifacts/$release_tag"
   gh run download <successful-run-id> \
     --name "q-academy-published-release-$release_commit" \
     --dir "/var/lib/q-academy/releases/artifacts/$release_tag"
   cd "/var/lib/q-academy/releases/artifacts/$release_tag"
   sha256sum --check --strict release-images.env.sha256
   gh attestation verify release-images.env \
     --repo <owner>/<repository> \
     --bundle release-images.intoto.jsonl \
     --signer-workflow <owner>/<repository>/.github/workflows/ci.yml \
     --source-digest "$release_commit" \
     --deny-self-hosted-runners
   cd /opt/q-academy

   export Q_ACADEMY_ENV_FILE=/etc/q-academy/production.env
   export APP_DOMAIN=academy.example.com
   export RELEASE_IMAGE_MANIFEST="/var/lib/q-academy/releases/artifacts/$release_tag/release-images.env"
   export RELEASE_IMAGE_ATTESTATION_BUNDLE="/var/lib/q-academy/releases/artifacts/$release_tag/release-images.intoto.jsonl"
   export RELEASE_GITHUB_REPOSITORY="<owner>/<repository>"
   export RELEASE_SIGNER_WORKFLOW="<owner>/<repository>/.github/workflows/ci.yml"
   scripts/ops/verify-image-pins.sh
   APP_IMAGE_TAG="$release_tag" docker compose --env-file "$Q_ACADEMY_ENV_FILE" -f compose.production.yml config --quiet
   APP_IMAGE_TAG="$release_tag" docker compose --env-file "$Q_ACADEMY_ENV_FILE" -f compose.production.yml run --rm --no-deps database-config-preflight
   ```

   Bei privaten GHCR-Paketen vorab mit einem kurzlebigen, nur lesenden Token
   `docker login ghcr.io` ausfuehren. Das Deploy zieht ausschliesslich die im
   Manifest enthaltenen `@sha256:`-Referenzen, einschliesslich der gehaerteten
   PostgreSQL-, Dispatcher- und Scratch-Caddy-Images. Dispatcher und Caddy sind
   releasegebundene Q-Academy-Artefakte; separate `CURL_IMAGE`- oder
   `CADDY_IMAGE`-Upstream-Pins gehoeren nicht mehr in die Produktions-Env. Der
   Manifest-Commit, der
   vollstaendige lokale Git-Commit und `linux/<arch>` des Docker-Servers muessen
   exakt uebereinstimmen.

   Vor dem ersten Start denselben containerisierten Secret-Scan wie der
   Releasepfad ausfuehren. Das Deploy-Skript erledigt diesen Schritt mit dem
   digest-gepinnten `NODE_IMAGE`; auf dem Host werden keine npm-Abhaengigkeiten
   installiert:

   ```bash
   export NODE_IMAGE="$(sed -n 's/^NODE_IMAGE=//p' "$Q_ACADEMY_ENV_FILE")"
   docker build --pull --target release-verifier --build-arg "NODE_IMAGE=$NODE_IMAGE" \
     --tag q-academy-release-verifier:local .
   docker run --rm --network none --volume "$PWD:/workspace:ro" \
     --workdir /workspace q-academy-release-verifier:local
   unset NODE_IMAGE
   ```

5. Datenbank, Migration, ClamAV, App, Medienrunner, Scan- und
   Maintenance-Dispatcher, Scheduler und Caddy ueber den gesperrten Releasepfad
   starten. Der Releasepfad prueft zuerst alle Zielimages. Direkt vor jedem
   Caddy-Recreate initialisiert der isolierte `caddy-volume-init` die benannten
   Volumes fail-closed und prueft Owner, Modus und Sentinel. Erst der danach mit
   UID/GID 10001 gesunde Caddy darf die externe HTTPS-Readiness freigeben:

   ```bash
   release_tag="git-$(git rev-parse HEAD)"
   export RELEASE_IMAGE_MANIFEST="/var/lib/q-academy/releases/artifacts/$release_tag/release-images.env"
   scripts/ops/deploy-release.sh "$release_tag"
   docker compose --env-file "$Q_ACADEMY_ENV_FILE" -f compose.production.yml ps
   ```

   Beim ersten Release darf `APP_IMAGE_TAG` nur dann leer sein, wenn noch keine
   Release-State-Datei existiert. Der Releasepfad erstellt und prueft PostgreSQL
   in diesem Fall zuerst mit dem digest-gepinnten Image. Nur wenn `public` und
   `drizzle` nachweislich noch keine Anwendungsrelation enthalten, entfaellt das
   Vorab-Backup, weil noch kein wiederherstellbarer Anwendungsstand existiert.
   Eine teilweise initialisierte oder bereits befuellte Datenbank muss dagegen
   denselben restore-verifizierten Backup-Gate wie jedes Upgrade bestehen. Vor
   Migration und Runtime-Start werden PostgreSQL und ClamAV explizit mit ihren
   freigegebenen Images aktiviert und bis zum gesunden Zustand abgewartet.

6. Betriebsbereitschaft pruefen:

   ```bash
   curl --fail --show-error "https://$APP_DOMAIN/api/v1/health/live"
   curl --fail --show-error "https://$APP_DOMAIN/api/v1/health/ready"
   docker compose --env-file "$Q_ACADEMY_ENV_FILE" -f compose.production.yml logs --tail=100 app media-runner clamav scheduler media-worker media-maintenance caddy
   ```

   Danach in `/admin/api` einen dedizierten, nicht ablaufenden API-Schluessel
   `Rootserver SLO probe` mit ausschliesslich `courses:read` anlegen. Den nur
   einmal angezeigten Wert ohne Zwischenablage, Shell-Argument oder Env-Datei in
   den separaten read-only Mount schreiben:

   ```bash
   sudo install -o 1001 -g 1001 -m 0400 /dev/null /etc/q-academy/http-slo-api-key
   read -r -s -p "SLO API key: " HTTP_SLO_API_KEY; printf '\n'
   printf '%s' "$HTTP_SLO_API_KEY" | sudo tee /etc/q-academy/http-slo-api-key >/dev/null
   unset HTTP_SLO_API_KEY
   sudo sh -c 'test "$(wc -c </etc/q-academy/http-slo-api-key)" -ge 32'
   sudo test "$(stat -c '%u:%g:%a' /etc/q-academy/http-slo-api-key)" = 1001:1001:400
   ```

   Den bestaetigungspflichtigen HTTP-SLO-Smoke gegen Live-, Readiness- und
   einmalig gegen den authentifizierten Kurslisten-Endpunkt ausfuehren. Der
   API-Probe mutiert keine Fachressource, erzeugt aber wie jeder API-Aufruf
   einen Audit-Eintrag. Origin und Bestaetigung muessen
   exakt uebereinstimmen; Dauer, Parallelitaet und Stichprobenzahl sind hart
   begrenzt. Das Gate scheitert bei Payload-/Request-ID-Fehlern, HTTP-Fehlern,
   zu hoher Fehlerrate oder ueberschrittener p95-Latenz. Unbekannte,
   unvollstaendige oder doppelte CLI-Optionen werden vor dem ersten Request
   abgelehnt:

   ```bash
   docker compose --env-file "$Q_ACADEMY_ENV_FILE" -f compose.production.yml \
     --profile operations run --rm --no-deps http-slo-ops test:http-slo \
     --origin "https://$APP_DOMAIN" \
     --confirm-origin "https://$APP_DOMAIN" \
     --duration-seconds 60 \
     --concurrency 8 \
     --min-requests 200 \
     --max-error-rate 0 \
     --max-p95-ms 500 \
     --api-probe true
   ```

   Der JSON-Report mit Gesamtrate, p50/p95/p99, Statusverteilung, getrennten
   Endpointwerten und redigiertem Ergebnis der authentifizierten Sonde gehoert
   als Release-Artefakt in die Abnahme. Weder Schluessel noch Dateipfad werden
   ausgegeben. Der Smoke ist
   eine reproduzierbare Baseline, ersetzt aber keinen realistischen Lasttest
   authentifizierter Lern-, Authoring-, Upload- und Workerpfade auf Staging.
   Der separate SLO-Dienst liegt nur im Proxy-Netz, erhaelt keinen
   Datenbankzugang und sieht als einziges Anwendungssecret den eigenen
   `courses:read`-Schluessel im read-only Dateimount. Der kanonische Host
   ist dort ausschliesslich als Alias des Caddy-Dienstes aufgeloest, sodass der
   Smoke denselben Host-, TLS- und Proxyvertrag wie externe Requests prueft.

   Tenant- und Exportoperationen laufen ebenfalls ausschliesslich ueber das
   freigegebene `q-academy-tenant-ops:<release>`-Image. Die exakten Aufrufe,
   Vier-Augen-Gates und Mountpfade stehen in
   [TENANT_OPERATIONS_RUNBOOK.md](./TENANT_OPERATIONS_RUNBOOK.md). Der
   Dispatcher erlaubt keine freie npm-, Node-, Shell- oder Script-Ausfuehrung;
   die Compose-Dienste deaktivieren persistente Containerlogs, damit der nur
   einmal ausgegebene Provisionierungslink nicht in `docker logs` verbleibt.

7. Monitoring-Token und das Node-Exporter-Textfile-Verzeichnis anlegen. Die
   Dateien enthalten jeweils ausschliesslich den bereits konfigurierten
   Hex-Wert ohne Schluesselname oder Zeilenumbruch. Sie muessen exakt zu
   `METRICS_SECRET` beziehungsweise `MEDIA_METRICS_SECRET` passen. Diese
   Read-only-Tokens muessen von den Job-Secrets getrennt sein:

   ```bash
   sudo install -d -m 0755 /var/lib/q-academy-observability
   sudo sh -c 'umask 027; sed -n "s/^METRICS_SECRET=//p" /etc/q-academy/production.env | tr -d "\r\n" > /etc/q-academy/prometheus-app-token'
   sudo sh -c 'umask 027; sed -n "s/^MEDIA_METRICS_SECRET=//p" /etc/q-academy/production.env | tr -d "\r\n" > /etc/q-academy/prometheus-media-token'
   sudo chown root:65534 /etc/q-academy/prometheus-app-token /etc/q-academy/prometheus-media-token
   sudo chmod 0640 /etc/q-academy/prometheus-app-token /etc/q-academy/prometheus-media-token
   sudo test "$(wc -c </etc/q-academy/prometheus-app-token)" -ge 32
   sudo test "$(wc -c </etc/q-academy/prometheus-media-token)" -ge 32
   ```

8. Das Monitoring-Profil starten und lokal auf dem Rootserver pruefen:

   ```bash
   docker compose --env-file "$Q_ACADEMY_ENV_FILE" -f compose.production.yml --profile monitoring up -d prometheus node-exporter
   curl --fail --show-error http://127.0.0.1:9090/-/ready
   curl --fail --show-error http://127.0.0.1:9090/api/v1/targets
   curl --fail --show-error http://127.0.0.1:9090/api/v1/rules
   ```

   Prometheus ist nur an `127.0.0.1:9090` gebunden. Fuer die Bedienoberflaeche
   einen SSH-Tunnel verwenden und Port 9090 nicht in der Firewall freigeben.

Der Scheduler ruft alle 15 Sekunden die Queue-Verarbeitung und standardmaessig
stuendlich zusaetzlich
`POST /api/internal/jobs/dispatch?cleanup=run&cleanupLimit=1000` mit
`Authorization: Bearer $CRON_SECRET` auf. Die Retention entfernt nur abgelaufene
operative Datensaetze und abgeschlossene alte Zustellungen; Lern-, Audit- und
Aktivitaetsdaten bleiben unangetastet.

Alle internen Batchparameter sind routegebunden hart begrenzt: Der gemeinsame
Job-Dispatch akzeptiert `limit` von 1 bis 100 und `cleanupLimit` von 1 bis 1000,
der dedizierte Webhook-Dispatch `limit` von 1 bis 100, der Medien-Dispatch exakt
`limit=1` und die Medienwartung `limit` von 1 bis 5. Unbekannte, doppelte,
negative, nicht kanonische oder ausserhalb dieser Bereiche liegende
Query-Parameter werden vor jedem Claim mit HTTP 400 als
`application/problem+json` abgelehnt. Ein Request kann daher keine unbegrenzte
Worker- oder Cleanup-Menge erzwingen; die Dispatcher behandeln die
Nicht-2xx-Antwort als Fehler und schreiben keinen Success-Marker.

Fuer Privacy-Processing und DSAR-Export-Retention ist PostgreSQL die
autoritative Uhr: Claim- und Lease-Grenzen, aktive Legal Holds sowie
Retention-Faelligkeit werden mit `clock_timestamp()` bewertet. Ein Processing-
Claim ist 15 Minuten gueltig und wird durch einen serialisierten Heartbeat alle
30 Sekunden nur bei weiterhin passendem Fallstatus, Tenant, Token und aktiver
Lease verlaengert. Der Retention-Lauf recovered abgelaufene Claims nach
`failed`, leert die Claim-Felder und markiert zugehoerige `building`-Artefakte
als fehlgeschlagen. Alle Finalisierungs- und Fehlerpfade bleiben durch das
Claim-Token gefenced.

Der Privacy-Cleanup nimmt pro App-Prozess lokal nur einen Aufruf an und
serialisiert alle Replikate zusaetzlich mit einer globalen PostgreSQL-Session-
Advisory-Lock. Die Lock lebt auf einem dedizierten Client mit maximal einer
Datenbanksession; Session-Token und Backend-PID werden bei jedem Arbeitsschritt
verifiziert. Pro Lauf beginnen hoechstens zehn physische Loeschungen. Das harte,
monoton gemessene Arbeitsbudget betraegt 32 Sekunden, jeder einzelne Storage-
Delete hoechstens fuenf Sekunden. Bei der Deadline wird der dedizierte Client
hart geschlossen, sodass auch eine noch gehaltene Session-Lock endet.

Ein fehlgeschlagener Delete wird auditiert und ueber `updated_at` fuer fuenf
Minuten aus der Kandidatenmenge rotiert. Dadurch kann ein dauerhaft defektes
Objekt spaetere Kandidaten nicht als Poison-Batch verhungern lassen. Bei einer
belegten globalen Lock, mindestens einem Deletefehler, Rest-Backlog oder
ausgeschoepftem Arbeitsbudget antwortet der Dispatcher mit HTTP 503 und
`Retry-After: 15`. Der 45-Sekunden-Scheduler-Request behandelt dies als Fehler,
schreibt keinen Success-Marker und behaelt den Cleanup als faellig; nur ein
fehlerfreier, vollstaendig geleerter Lauf liefert 2xx und verschiebt den
stuendlichen Cleanup-Zeitpunkt.

Filesystem-Exports werden nur unter ihrem validierten, aus Tenant-, Fall- und
Artefakt-ID abgeleiteten Write-once-Schluessel ohne `VersionId`/ETag geloescht.
Im Modus `versioned` verwenden S3-Exports ausschliesslich den persistierten
Schluessel, die konkrete `VersionId` und den ETag. Scheitert eine
Kompensationsloeschung nach dem PUT, bleibt diese Identitaet fuer den
Retention-Retry erhalten; die taggebundene Acht-Tage-Lifecycle-Regel deckt nur
Orphans vor dem Datenbank-Commit ab. Im Modus `strato-hidrive` bindet Q-Academy
stattdessen den eindeutigen Schluessel an den ETag, verifiziert den exakten
unversionierten Delete per HEAD und ueberlaesst das Orphan-Fenster dem
separaten Acht-Tage-Sweeper. Beide Pfade ersetzen die autoritative
Sieben-Tage-Loeschung nicht.

Die beiden getrennten `media-worker`-Dispatcher rufen auf dem isolierten
`media-runner` den Endpunkt `POST /api/internal/jobs/media/dispatch` mit
dem nur fuer Medienjobs gueltigen `MEDIA_CRON_SECRET` auf. Dieser Endpunkt ist
streng begrenzt: Jeder Request claimt hoechstens einen Scan und danach
hoechstens einen Thumbnail-, Transcode- oder Transkriptjob. Ein einzelner
Provideraufruf hat ein hartes Zehn-Minuten-Limit. Kompositionsjobs koennen vor
diesem Aufruf jedoch bis zu acht weitere unveraenderliche S3-Quellen seriell
materialisieren und vollstaendig verifizieren. Der Dispatcher und die Route
begrenzen deshalb den gesamten synchronen Request auf 14.400 Sekunden.
Retention oder S3-Harddelete koennen die beiden Jobschleifen daher nicht
blockieren.

Der Produktions-Compose baut einen separaten `media-runner` mit FFmpeg und
bindet dessen Arbeitsverzeichnis an das dedizierte, groessenbegrenzte
Disk-Filesystem des Hosts. Der Runner
laedt im Modus `versioned` nur die gespeicherte S3-VersionId mit passendem ETag;
im Modus `strato-hidrive` wird derselbe Zugriff an den gespeicherten ETag und
die daraus abgeleitete synthetische Revision gebunden. Der Runner verifiziert den
Quell-Digest, startet FFmpeg beziehungsweise den konfigurierten STT-Provider
ohne Shell und speichert ein Derivat erst nach erneuter Version-/Metadaten-/
Digestpruefung. Vor Kundenfreigabe muessen S3 und die konkrete STT-Installation
im Runner-Netz abgenommen werden:

Der Produktionsadapter ist auf `whisper-1` und
`https://api.openai.com/v1/audio/transcriptions` festgelegt. Sein dedizierter
Schluessel liegt standardmaessig nur in
`/etc/q-academy/openai-transcription-api-key` mit Host-Owner `1001:1001` und
Modus `0400`; `OPENAI_TRANSCRIPTION_API_KEY_SOURCE_FILE` darf ausschliesslich
einen gleich geschuetzten alternativen Hostpfad benennen. UID/GID 1001 bleibt
auf dem Host ohne Login-Konto fuer den Container reserviert. Vor dem Lauf gilt:

```bash
test "$(stat -c '%u:%g:%a' /etc/q-academy/openai-transcription-api-key)" = \
  "1001:1001:400"
```

Der Medien-Preflight uebertraegt einen synthetischen Audio-Canary an den echten
Provider. Ohne dokumentierte Freigabe von Audio-Egress, Rechtsgrundlage oder
Einwilligung, Datenschutzhinweis, AVV/DPA, Retention/Datenregion und
Kostenalarmierung darf dieses Gate nicht ausgefuehrt und der Medienbetrieb
nicht freigegeben werden. Rotation und Provider-Ausfall stehen in
[MEDIA_PROCESSING.md](./MEDIA_PROCESSING.md).

```bash
docker compose --env-file "$Q_ACADEMY_ENV_FILE" -f compose.production.yml \
  --profile operations run --rm --no-deps s3-app-principal-preflight \
  --confirm-bucket "$(sed -n 's/^MEDIA_S3_BUCKET=//p' "$Q_ACADEMY_ENV_FILE")"
docker compose --env-file "$Q_ACADEMY_ENV_FILE" -f compose.production.yml \
  --profile operations run --rm --no-deps media-preflight \
  --confirm-bucket "$(sed -n 's/^MEDIA_S3_BUCKET=//p' "$Q_ACADEMY_ENV_FILE")"
```

Der gesperrte Releasepfad fuehrt den App-Principal-Vertrag vor Backup und
Migration aus. Nach dem Stop der Writer startet er das freigegebene
ClamAV-Image bis zum gesunden Zustand und fuehrt erst dann den vollstaendigen
Medien-Preflight aus. Beide Preflight-Images sind Teil des gescannten,
digest-gepinnten und attestierten Release-Manifests; ein lokal nachgebautes
Operatorimage ersetzt diesen Nachweis nicht.

Das vollstaendige Provider- und Datenmodell steht in
[MEDIA_PROCESSING.md](./MEDIA_PROCESSING.md).

`scheduler`, `media-worker` und `media-maintenance` aktualisieren jeweils nur
nach einer erfolgreichen HTTP-2xx-Antwort einen atomar geschriebenen
Success-Marker unter `/tmp`. Der Medien-Dispatcher aktualisiert waehrend seines
auf vier Stunden begrenzten Requests zusaetzlich alle 30 Sekunden einen
separaten In-progress-Marker; dieser belegt nur Prozessaktivitaet und wird nie
als fachlicher Erfolg gewertet. Transportfehler werden als HTTP `000` gezaehlt.
Nach `SCHEDULER_MAX_CONSECUTIVE_FAILURES`,
`MEDIA_WORKER_MAX_CONSECUTIVE_FAILURES` beziehungsweise
`MEDIA_MAINTENANCE_MAX_CONSECUTIVE_FAILURES` aufeinanderfolgenden Fehlern
beendet sich der Dispatcher, damit `restart: unless-stopped` greift. Die
Docker-Healthchecks melden einen fehlenden oder zu alten Marker als
`unhealthy`; beim Medien-Dispatcher gilt alternativ ein hoechstens 120 Sekunden
alter In-progress-Marker. Die Altersgrenzen der Success-Marker werden mit den drei
`*_HEARTBEAT_STALE_SECONDS`-Variablen gesetzt und muessen mindestens einen
vollstaendigen Poll-/Timeout-Zyklus abdecken. Die Marker enthalten nur einen
Unix-Zeitstempel. Secrets und Response-Bodies werden nicht protokolliert.
Deploy, Rollback und In-place-Restore starten die drei Dispatcher deshalb nicht
fire-and-forget: Sie warten bis zu 1.800 Sekunden auf die Healthchecks aller
Replikate. Erst danach wird ein Release-/Restore-Erfolg persistiert und
gemeldet. Der lange Gate-Zeitraum ist erforderlich, weil ein einzelner
Medien-Dispatch beide begrenzten Verarbeitungsschritte seriell ausfuehren kann.
Zusaetzlich schreibt der jeweilige Next.js-Runtime-Prozess nach einer
erfolgreich abgeschlossenen Dispatch-Anfrage einen eigenen atomaren
Unix-Zeitstempel. Der authentifizierte Endpunkt `GET /api/internal/metrics`
liefert daraus Service-Heartbeats sowie Queue-Tiefe, aktuelle Fehlerzahl und
Alter des aeltesten Jobs im Prometheus-Textformat. Die App verwendet dafuer
`METRICS_SECRET`, der Medienrunner `MEDIA_METRICS_SECRET`. Beide Werte sind
bewusst von `CRON_SECRET` und `MEDIA_CRON_SECRET` getrennt, sodass lesendes
Monitoring keine Job-Dispatch-Berechtigung erhaelt. Ohne konfiguriertes oder
mit falschem Bearer-Token antwortet der Endpunkt mit 401. Prometheus erreicht
beide Runtimes ueber deren bereits bestehende interne Netze; App und
Medienrunner teilen weiterhin kein Netz miteinander.

Genau ein `media-maintenance`-Dispatcher ruft standardmaessig alle 60 Sekunden
`POST /api/internal/jobs/media/maintenance?limit=5` auf. Das Intervall ist ueber
`MEDIA_MAINTENANCE_INTERVAL_SECONDS` auf 30 bis 3600 Sekunden begrenzt; der
interne Arbeitszeitraum betraegt acht Minuten, das Route-Limit neun Minuten und
der Dispatcher-Timeout 550 Sekunden. Der Endpunkt akzeptiert maximal fuenf
Storage-Assets als gemeinsames I/O-Budget fuer Tombstone-Purge und Cleanup. Bei
weniger als 75 Sekunden Restbudget startet kein weiteres I/O-Asset; laufende
Loeschungen erhalten dasselbe AbortSignal. Retention-Phasen starten nur mit
mindestens zehn Sekunden Restbudget. Der Lauf wird mit einer globalen
PostgreSQL-Session-Advisory-Lock geschuetzt. Ein paralleler manueller oder ueberlappender
Aufruf liefert sofort `skipped: true`; ein ausgeschoepftes Arbeitsbudget wird
als `timedOut: true` gemeldet und gibt die Lock vor dem HTTP-Timeout frei.
Waehrend S3-I/O bleibt keine
Datenbanktransaktion offen. Bereits physisch geloeschte alte Tombstones werden
vor neuem Cleanup gepurgt, damit dasselbe Asset nicht im selben Lauf zweimal
harddeleted wird. Danach werden abgelaufene Upload-Intents, seit 24 Stunden
scanbereite aber nie gebundene Abgabeanhaenge, Kurs- oder Community-Medien,
verwaiste Incoming-Objekte und neu faellige Harddeletes gepflegt. Die
Response-Zaehler `expiredUnattachedSubmissionAssets`,
`expiredUnattachedCourseAssets` und `expiredUnattachedCommunityAssets` muessen
im Regelbetrieb beobachtet werden; ungewoehnliche Spitzen koennen auf
abgebrochene Upload-, Abgabe- oder Community-Flows hinweisen. Worker-Fehler,
Queue-Tiefe und Alter des aeltesten wartenden Scans beziehungsweise
Processing-Jobs muessen alarmiert werden.
Die interne Job-Dispatch-Response liefert dafuer unter `data.queues` nur
aggregierte Werte (`depth`, `failed`, `oldestAgeSeconds`) fuer E-Mail,
Webhooks und faellige Pruefungsfristen. Der Media-Dispatch liefert dieselben
Zaehler fuer die Scan-Queue unter `data.backlog` und fuer die Processing-Queue
unter `data.processingBacklog`; die bestehende `oldestQueuedAt`-Angabe bleibt
fuer interne Diagnose erhalten. Prometheus exportiert beide als `media_scan`
und `media_processing`. Keine dieser
Metriken enthaelt Tenant-, Benutzer-, Asset- oder Delivery-IDs.
Der Caddy-Proxy beantwortet externe Zugriffe auf `/api/internal/*` mit 404. Der
Scheduler erreicht die App nur ueber das interne `proxy`-Netz; die
Scan- und Maintenance-Dispatcher erreichen den Medienrunner nur ueber das getrennte interne
`jobs`-Netz. App und Medienrunner nutzen getrennte interne PostgreSQL-Netze;
keiner der beiden Next.js-Prozesse ist im Netz des anderen Mitglied. App-,
Medienrunner-, ClamAV- und PostgreSQL-Ports werden nicht am
Host publiziert.

## Monitoring und Alarmierung

`deploy/observability/prometheus.yml` scrapt alle 30 Sekunden die
authentifizierten App- und Medienrunner-Metriken sowie Node Exporter.
`deploy/observability/alerts.yml` enthaelt auslieferbare Regeln fuer:

- fehlende Scrapes und nicht bereite Runtimes,
- Runtime-Neustarts und veraltete Scheduler-/Medienworker-Heartbeats,
- anhaltend hohe oder alte E-Mail-, Webhook-, Web-Push-, Native-Push-,
  Pruefungs- und Medienqueues,
- vorhandene fehlgeschlagene Queue-Eintraege,
- fehlende, fehlgeschlagene, aeltere als 30 Stunden oder nicht
  restore-verifizierte PostgreSQL-Backups.

Die Standardgrenzen sind ein sicherer Ausgangspunkt, muessen aber im Lasttest
gegen reale Queue-Raten, SLOs und Wartungsfenster freigegeben werden. Prometheus
wertet die Regeln aus und speichert Zeitreihen standardmaessig 30 Tage im Volume
`prometheus_data`. Das Profil enthaelt bewusst keinen vorkonfigurierten
Empfaenger mit Platzhalter-Zugangsdaten. Vor Kundenbetrieb muss Prometheus an
einen externen Alertmanager oder einen verwalteten Monitoringdienst mit
mindestens zwei getesteten Empfaengern angebunden werden. Je ein absichtlich
ausgeloester Readiness-, Worker- und Backup-Fehler muss bis zur
Rufbereitschaftszustellung und Quittierung nachgewiesen werden.

Der Metrikendpunkt exportiert nur feste Runtime-/Queue-/Worker-Labels und
numerische Aggregate. Tenant-, Benutzer-, Asset-, Delivery-IDs, Inhalte und
Secrets sind ausgeschlossen. Node Exporter erhaelt nur lesenden Zugriff auf den
Host und das Textfile-Verzeichnis; sein Port wird nicht am Host publiziert.

## Verschluesselungsschluessel rotieren

Die App schreibt Mail-Outbox- und Idempotenz-Nutzlasten als AES-256-GCM-v2 mit
`kid`; Webhook- und Intercom-Identity-Secrets verwenden dasselbe versionierte
Prinzip in einem kompakten Format. V1-Daten ohne `kid` bleiben waehrend der
Rotation ueber den begrenzten Leseschluesselring entschluesselbar. Der
Operations-Container besitzt
nur App-Datenbankrechte und die beiden Verschluesselungs-Keyrings, aber keine
Session-, Cron-, Mail-, KI- oder S3-Secrets.

1. Verifiziertes Backup erstellen und laufende Version dokumentieren.
2. Je Ring einen neuen unabhaengigen Schluessel und eine neue ID erzeugen. Den
   bisherigen Schluessel unter seiner bisherigen ID in das jeweilige JSON-
   Objekt `*_ENCRYPTION_PREVIOUS_KEYS` verschieben. Beispiel:

   ```dotenv
   DATA_ENCRYPTION_KEY_ID=data-2026-07
   DATA_ENCRYPTION_KEY=<new-secret>
   DATA_ENCRYPTION_PREVIOUS_KEYS={"data-2026-01":"<old-secret>"}
   ```

3. Konfiguration rendern, das neue App-Image ausrollen und warten, bis keine
   alte App-Replik mehr schreibt. Der alte Schluessel darf zu diesem Zeitpunkt
   noch nicht entfernt werden.
4. Zuerst alle Werte ohne Schreibzugriff pruefen, danach in kleinen,
   transaktionalen Batches neu verschluesseln und abschliessend erneut pruefen:

   ```bash
   docker compose --env-file "$Q_ACADEMY_ENV_FILE" -f compose.production.yml \
     --profile operations run --rm key-rotation --check
   docker compose --env-file "$Q_ACADEMY_ENV_FILE" -f compose.production.yml \
     --profile operations run --rm key-rotation --execute --batch-size 100
   docker compose --env-file "$Q_ACADEMY_ENV_FILE" -f compose.production.yml \
     --profile operations run --rm key-rotation --check
   ```

   `verified` muss `true` sein; nach `--execute` muessen alle
   `remaining`-Zaehler null sein. Der Prozess nutzt eine globale Advisory-Lock,
   `FOR UPDATE SKIP LOCKED` und gibt weder Klartext noch Schluessel aus.
   `mfaTotpSecrets: 0` ist zwingend, weil derselbe Daten-Keyring auch die
   tenant-/nutzergebundenen TOTP-Secrets schuetzt. Ebenso muss
   `supportIdentitySecrets: 0` gelten, bevor ein alter Webhook-Leseschluessel
   entfernt wird.

   Recovery-Code-Hashes verwenden einen getrennten Pepper-Keyring. Bei einem
   Wechsel kommt die bisherige ID samt Secret zuerst in
   `MFA_RECOVERY_PREVIOUS_PEPPERS`. Da Hashes nicht online umgeschluesselt
   werden koennen, muessen betroffene privilegierte Konten ihre Recovery-Codes
   bestaetigt regenerieren. Der alte Pepper darf erst entfernt werden, wenn
   `user_mfa_configurations.recovery_code_hashes` keine Envelope mit seiner
   Key-ID mehr enthaelt. Details: `docs/MFA_SECURITY.md`.
5. Alte Leseschluessel mindestens fuer das freigegebene Rollback-Fenster
   behalten. Ein Konfigurationsrollback muss den dann neuen Schluessel als
   Leseschluessel enthalten. Erst nach erneutem `--check`, Ablauf des Fensters
   und dokumentierter Freigabe duerfen alte Eintraege entfernt werden.

Bei fehlendem Schluessel, Authentifizierungsfehler oder ungueltigem Ciphertext
bricht der Lauf ohne Teil-Update des betroffenen Batches ab. Nicht durch
Probieren ersetzen: Backup sichern, Incident eroeffnen und den letzten
nachweislich passenden Leseschluessel wieder bereitstellen. Der erstmalige
Wechsel von einem Release ohne v2-Unterstuetzung muss vor dem Pilot erfolgen;
ein solches Alt-Image kann nach ersten v2-Schreibvorgaengen nicht mehr als
App-Rollback dienen.

## Deployment

Vor jedem Deployment muessen CI-Pruefungen, gueltige Upstream-Image-Digests,
CycloneDX-SBOMs, ein erfolgreicher High-/Critical-Vulnerability-Gate, eine
verifizierte Release-Manifest-Attestierung, ein verifiziertes Backup und ein
dokumentierter Rollback-Commit vorliegen.
`APP_IMAGE_TAG` ist exakt `git-` plus vollstaendiger Git-Objekt-ID; der
Releasepfad lehnt einen abweichenden Tag, einen dirty oder untracked Worktree
ab. Ein vorhandener lokaler Release-Tag wird nur akzeptiert, wenn seine Image-ID
mit dem neu gezogenen digest-gepinnten CI-Image uebereinstimmt.

Der Secret-Scan ist Teil der CI und muss vor dem Release gruen sein. Auf dem
Rootserver baut und startet das Deploy-Skript dafuer den isolierten
`release-verifier`; Node.js und npm laufen nicht auf dem Host. Der Scanner prueft Textdateien einschliesslich
`.env.example` auf bekannte Provider-Credentials und Private-Key-Material und
gibt nur Regel, Datei und Position aus. Echte lokale `.env.*`-Dateien bleiben
ausgenommen; produktive Secrets gehoeren ausschliesslich in die geschuetzte
Rootserver-Umgebung beziehungsweise den spaeter gewaehlten Secret Manager.

Der Produktions-Releasepfad ist das gesperrte Operationsskript. Es nimmt den
globalen Lock `/var/lock/q-academy-release.lock`, validiert Env-Dateirechte,
verpflichtende Image-Digests, das Sentinel-geschuetzte
Medien-Arbeitsfilesystem und Compose, fuehrt den
containerisierten Secret-Scan, einen rein lesenden Rollenidentitaets- und
Legacy-Referenzcheck, den realen Medien-/S3-Preflight sowie ein verifiziertes
Backup aus. Vor dem Backup-Gate nimmt es in fester Reihenfolge nach dem
Release-Lock zusaetzlich `/var/lock/q-academy-backup.lock`.
Standardmaessig verlangt es `RELEASE_IMAGE_MANIFEST`, verifiziert
dessen GitHub-/Sigstore-Bundle gegen Repository, signernden Workflow und
Source-Commit, prueft Zielarchitektur und zieht in fester Reihenfolge
PostgreSQL, App, Migrator, Key-Rotation, Tenant-Ops, Medienrunner,
Medien-Preflight, App-S3-Principal-Preflight, Dispatcher und Caddy nur ueber die
dort attestierten Registry-Digests. Erst danach
stoppt es Scheduler, beide Medien-Dispatcher, App und Medienrunner, fuehrt
Rollenabgleich, den sessiongesperrten Migrator und den transaktionalen
Rechteabgleich aus und startet App und Medienrunner gemeinsam mit `--wait`.
Compose injiziert den exakten `APP_IMAGE_TAG` in beide Runtimes als
`Q_ACADEMY_APP_VERSION`; erfolgreiche Readiness gibt ihn unter `data.version`
aus. Deploy und Rollback vergleichen diesen Wert in App und Medienrunner exakt
mit dem angeforderten Zieltag. Danach initialisiert der isolierte
`caddy-volume-init` die Caddy-Volumes, Caddy wird aus dem Zielimage neu erstellt
und intern gesund geprueft. Erst dann darf die externe HTTPS-Readiness
erfolgreich sein; danach starten die Dispatcher. Jeder Fehler
nach dem Stop laesst alle DB-Writer fuer die Untersuchung angehalten. Erst nach
dieser Release-Readiness schreibt das Skript `APP_IMAGE_TAG` und den
attestierten PostgreSQL-Digest atomar in die geschuetzte
Produktions-Env sowie den aktuellen und vorherigen Releasezustand. Env und
State muessen bei jedem weiteren Deploy und Rollback uebereinstimmen. Der
Backup-Lock bleibt dabei vom Vorab-Backup ueber Writer-Stop, Migration und
Readiness bis zur abgeschlossenen Release-Aktivierung auf dem im Deployprozess
geoeffneten Dateideskriptor 8 gehalten. Damit kann weder ein systemd-Backup noch
ein Restore einen Zwischenstand der Migration oder Aktivierung beobachten:

```bash
cd /opt/q-academy
export Q_ACADEMY_ENV_FILE=/etc/q-academy/production.env
export APP_DOMAIN=academy.example.com
release_tag="git-$(git rev-parse HEAD)"
export RELEASE_IMAGE_MANIFEST="/var/lib/q-academy/releases/artifacts/$release_tag/release-images.env"
export RELEASE_IMAGE_ATTESTATION_BUNDLE="/var/lib/q-academy/releases/artifacts/$release_tag/release-images.intoto.jsonl"
export RELEASE_GITHUB_REPOSITORY="<owner>/<repository>"
export RELEASE_SIGNER_WORKFLOW="<owner>/<repository>/.github/workflows/ci.yml"
scripts/ops/deploy-release.sh "$release_tag"
```

`RELEASE_IMAGE_MODE=local-build` erhaelt den bisherigen reproduzierbaren Build
mit digest-gepinntem Node-Basisimage, festem Debian-Snapshot und exakter
FFmpeg-Paketversion sowie dem digest-gepinnten `POSTGRES_IMAGE`-Fallback aus
der Env-Datei fuer isolierte lokale oder Offline-Abnahmen. Dieser Modus
besitzt ohne anschliessende identische CI-Scans, SBOMs, Publikation und
Attestierung keine Produktionsfreigabe. Ein manuelles `sed` auf `APP_IMAGE_TAG`
oder ein direkter Release-Build umgeht
Clean-Tree-, Digest-, Backup-, Readiness- und Zustandssperren und ist kein
zulaessiger Produktionspfad. Der taegliche Backup-Job liest den nach Readiness
persistierten Tag und die geprueften Image-Referenzen direkt aus der Env-Datei;
er benoetigt keine zusaetzlich exportierte Releasevariable.

`database-role` verwendet den Bootstrap-Superuser ausschliesslich fuer
Rollenpflege und Ownership und pflegt getrennte Owner-, App- und Medien-Logins.
Mit `DATABASE_ROLE_MODE=validate` prueft derselbe Entrypoint Konfiguration,
unveraenderliche Identitaeten und Legacy-Referenzen, beendet sich jedoch vor
jeder Rollen-, Passwort-, Ownership- oder Rechteaenderung. Der Releasepfad nutzt
diesen Modus vor Backup und Image-Aktivierung; der mutierende Abgleich beginnt erst, nachdem
alle Datenbank-Writer gestoppt wurden.
Der Medien-Login darf nur Medienassets und Jobtabellen bearbeiten. Auf
Organisationen, Benutzer und Bindungstabellen erhaelt er ausschliesslich die
fuer Locale-, Avatar- und Asset-Zuordnung benoetigten Spalten; E-Mail,
Passwort-Hash, Name, Telefon und weitere Profilspalten bleiben unlesbar.
Row-Level-Policies beschraenken Profilwerte auf Felder vom Typ `media` und
Plattformeinstellungen auf den Branding-Schluessel `design`. Sessions,
API-Schluessel, Mail-, Webhook- und KI-Daten bleiben vollstaendig unzugreifbar.
Die Worker-S3-Zugangsdaten sind ebenfalls vom eingeschraenkten Signatur-/
Download-Principal der App getrennt. `migrate` und `database-permissions`
arbeiten mit dem nicht privilegierten Datenbank-Owner; letzteres gewaehrt der
App danach DML- und dem Medienrunner die beschriebenen Minimalrechte. Alle drei Container muessen
erfolgreich beendet sein, bevor die App startet. Bei Fehlern keine Migration mit `db:push` oder manuellem SQL
umgehen. Logs mit `docker compose ... logs migrate` sichern und das Deployment
abbrechen.

Die Storage-Limit-Trigger laufen als Owner-eigene `SECURITY DEFINER`-Funktionen
mit festem `search_path=pg_catalog, public`. `PUBLIC` besitzt kein Execute-Recht;
nur App und Media werden explizit freigeschaltet. Dadurch kann Media das Limit
beim Derivative-Schreiben durchsetzen, ohne `organization_contracts` direkt
lesen zu duerfen. `database-permissions` prueft Owner, Security-Modus,
Suchpfad, ACLs, RLS, Policies und gesperrte Spalten nach dem Commit im Katalog.
Der Abgleich entfernt ausserdem `PUBLIC`-Rechte auf Datenbank, Schemas,
Tabellen, Sequenzen und Funktionen sowie alte App-/Media-Rechte, bevor er die
Minimalmenge neu vergibt. App darf nur die beiden Storage-Trigger und
`q_academy_lock_course_link_graph(uuid)` ausfuehren; Media nur die beiden
Storage-Trigger. Trigger-interne Funktionen sind nicht direkt aufrufbar.

## Backups

Das Backup-Skript serialisiert alle Ziele unabhaengig von `BACKUP_DIR` ueber
`/var/lock/q-academy-backup.lock`. Ein Standalone-Lauf oeffnet und sperrt ihn
selbst. Nur der Deploypfad darf stattdessen den bereits exklusiv gehaltenen
Deskriptor mit `Q_ACADEMY_BACKUP_LOCK_FD=8` und dem identischen
`BACKUP_LOCK_FILE` an das Kind-Backup vererben. Das Kind akzeptiert diesen
Vertrag nur bei einem numerischen, offenen Deskriptor, identischer Device-/
Inode-Identitaet und erfolgreicher exklusiver `flock`-Bestaetigung. Fehlende,
abweichende oder nicht sperrbare Deskriptoren brechen fail-closed ab; das Kind
oeffnet den Lock in diesem Modus nicht erneut und kann sich daher nicht selbst
blockieren. Der Deployprozess behaelt denselben Deskriptor bis zur erfolgreichen
Release-Aktivierung oder seinem Fehler-Exit.

Das Skript erstellt ein komprimiertes Custom-Format-Archiv, eine Archivliste
und eine SHA-256-Pruefsumme. Standardmaessig wird das Archiv in eine separate,
dem nicht privilegierten Owner gehoerende Datenbank vollstaendig als Owner
zurueckgespielt. Geprueft werden Migrationstabelle, Datenbank-Owner,
Owner aller Objekte in `public` und `drizzle`, Owner-Rollenflags und fehlende
Rollenmitgliedschaften. Nur Erstellung und spaetere Loeschung der Probe-DB
nutzen den Bootstrap-Login; der laufende App- und Medienverkehr kennt dessen
Zugang nicht. Erst danach greift die Aufbewahrung von 30 Tagen.

Der Repository-Drill prueft diesen Ablauf vor CI- oder Rootserver-Freigaben mit
einem echten PostgreSQL-Archiv und einem zusaetzlichen Side-by-side-Restore. Er
verwendet das Produktions-Compose, den Rollen-Preflight, den Owner-Migrator und
den Rechteabgleich, legt aber ein eindeutig benanntes Compose-Projekt mit
eigenem Volume und rein internem Datenbanknetz ohne Host-Port an. Vor dem Start
werden die effektiven Images von `database-role`, `database-permissions` und
`migrate` geprueft. Der Drill baut genau das Produktions-Migrator-Target mit dem
im Dockerfile digest-gepinnten Node-Basisimage, fixiert dessen lokale Image-ID
fuer den Lauf und migriert innerhalb des isolierten Compose-Netzes. Eine Fixture
wird als App-Rolle geschrieben, nach dem Restore wieder gelesen und erneut
beschrieben; zugleich werden Owner-Haertung, fehlende Rollenmitgliedschaften und
der verweigerte Medienzugriff geprueft. Das zweite Restore laeuft ueber den
produktiven `postgres-restore.sh`-Orchestrator samt Checksumme, Locks,
Rollenabgleich und Rechteabgleich. Nur ein expliziter In-place-Restore prueft den
festen Medien-Work-Mount und startet danach Runtime-Health-Gates; der
Side-by-side-Drill aendert keine laufende Datenbank und startet bewusst keine
App- oder Medienwriter. Der Exit-Trap entfernt Zieldatenbank, Container, Netz,
Volume, das eindeutige Migrator-Image, Archive und temporaere Konfiguration.
Jeder Cleanupfehler macht auch einen fachlich erfolgreichen Lauf rot. Eine
vorhandene Entwicklungs- oder Produktionsdatenbank wird weder verbunden noch
adressiert.

```bash
npm run test:backup-restore-drill
```

Der Lauf benoetigt Bash, npm, einen erreichbaren Docker-Daemon und das Docker
Compose Plugin. Standardmaessig wird ein vorhandenes `postgres:16.14-alpine3.23`
verwendet oder einmal gezogen und danach dessen tatsaechlicher Repository-Digest
an Compose uebergeben. Das verpflichtende CI-Gate setzt PostgreSQL- und
Migrator-Basisimage explizit auf freigegebene Digests; `publish-release` haengt
von diesem Job und dem regulaeren Verify-Job ab. Lokal lassen sich dieselben
Inputs setzen und fehlende Voraussetzungen als Fehler behandeln:

```bash
Q_ACADEMY_DRILL_NODE_IMAGE='node:22-bookworm-slim@sha256:<freigegebener-digest>' \
Q_ACADEMY_DRILL_POSTGRES_IMAGE='postgres:16.14-alpine3.23@sha256:<freigegebener-digest>' \
npm run test:backup-restore-drill:required
```

Der Required-Modus akzeptiert keine Defaults oder mutable Tags: Beide
`Q_ACADEMY_DRILL_*_IMAGE`-Variablen muessen explizit gesetzt und mit einem
vollstaendigen `sha256`-Digest gepinnt sein. Der Drill aktiviert ausserdem nur
die vollstaendige, fest vorgegebene Schluesselliste seiner selbst erzeugten
Env-Datei. Werte werden als Daten gelesen und nicht von der Shell ausgewertet;
fehlende, doppelte oder unbekannte Eintraege brechen den Lauf ab.

Ohne Bash, Compose oder laufenden Docker-Daemon meldet der lokale Standardlauf
ein deutliches `SKIP` und endet erfolgreich; das `:required`-Ziel ist das
verpflichtende, fail-closed CI-Gate. Alternativ setzt
`Q_ACADEMY_DRILL_REQUIRED=true` denselben Modus. Der disposable Drill ersetzt nicht den
monatlichen Restore auf einem getrennten Host und keine RPO-/RTO-Abnahme.

```bash
sudo install -d -m 0700 /var/backups/q-academy
Q_ACADEMY_ENV_FILE=/etc/q-academy/production.env \
BACKUP_DIR=/var/backups/q-academy \
BACKUP_RETENTION_DAYS=30 \
BACKUP_VERIFY_RESTORE=true \
BACKUP_METRICS_FILE=/var/lib/q-academy-observability/q-academy-backup.prom \
/opt/q-academy/scripts/ops/postgres-backup.sh
```

Der mitgelieferte systemd-Timer ist der bevorzugte Produktionspfad. Die Unit
laedt keine Secrets als eigene systemd-Umgebung, sondern uebergibt nur den Pfad
der geschuetzten Produktions-Env an dasselbe Skript. Vor Aktivierung muessen
Repository, Backup- und Metrikpfad vorhanden sein:

```bash
sudo install -d -m 0700 /var/backups/q-academy
sudo install -d -m 0755 /var/lib/q-academy-observability
sudo install -m 0644 deploy/systemd/q-academy-backup.service \
  /etc/systemd/system/q-academy-backup.service
sudo install -m 0644 deploy/systemd/q-academy-backup.timer \
  /etc/systemd/system/q-academy-backup.timer
sudo systemctl daemon-reload
sudo systemctl enable --now q-academy-backup.timer
sudo systemctl list-timers q-academy-backup.timer --all
```

Den ersten Lauf vor Freigabe manuell ausloesen und Ergebnis, Journal sowie
Metrik pruefen:

```bash
sudo systemctl start q-academy-backup.service
sudo systemctl status q-academy-backup.service --no-pager
sudo journalctl -u q-academy-backup.service -n 100 --no-pager
sudo systemctl show q-academy-backup.timer \
  --property=LastTriggerUSec --property=NextElapseUSecRealtime
```

`Persistent=true` holt einen waehrend eines Serverstillstands verpassten Lauf
nach; `RandomizedDelaySec=15m` vermeidet einen festen Lastpeak. Keinen parallelen
Cronjob aktivieren, da er trotz Lock nur Fehlalarme und unnoetige Starts erzeugt.

Nach jedem Lauf `.dump`, `.sha256` und `.manifest` verschluesselt auf ein
physisch getrenntes Ziel replizieren. Monatlich einen Restore auf einem getrennten
Host pruefen. Zielwerte: RPO maximal 24 Stunden, RTO vor Kundenstart praktisch
messen und vertraglich festlegen.
Das Skript schreibt bei normalem Ende atomar nur Zeitstempel, Erfolg und
Archivgroesse in die `.prom`-Datei. Ein fehlgeschlagener Lauf setzt
`q_academy_backup_last_run_success` auf 0, behaelt aber den letzten erfolgreichen
und restore-verifizierten Zeitstempel fuer die Frischealarme bei. Ein Fehler
beim Schreiben der Metrik verhindert das eigentliche Backup nicht; der fehlende
oder veraltete Textfile-Wert loest stattdessen einen Alarm aus.

## Restore

Ein Restore erfolgt standardmaessig neben der laufenden Datenbank. Dadurch kann
der Datenstand vor einem Umschalten fachlich geprueft werden:

Restore nimmt immer zuerst `/var/lock/q-academy-release.lock` und danach
`/var/lock/q-academy-backup.lock`. Standalone-Backups nehmen nur den zweiten
Lock; dadurch koennen Deploy, Backup und Restore nicht gegeneinander laufen und
die Sperrreihenfolge erzeugt keinen Deadlock.

```bash
Q_ACADEMY_ENV_FILE=/etc/q-academy/production.env \
RESTORE_DATABASE=q_academy_restore_20260710 \
scripts/ops/postgres-restore.sh /var/backups/q-academy/q-academy-YYYYMMDDTHHMMSSZ.dump
```

Nach fachlicher Pruefung `POSTGRES_DB` auf die Restore-Datenbank setzen und den
Stack neu erstellen. Das Restore-Skript stellt die Least-Privilege-Rechte fuer
die App-Rolle nach dem privilegienfreien Dump automatisch wieder her. Der
Bootstrap-Login erstellt beziehungsweise ersetzt dabei nur die Zieldatenbank;
`pg_restore` laeuft als nicht privilegierter Owner, sodass kein
Anwendungsobjekt dem Superuser gehoert. Ein
In-place-Restore stoppt App, Scheduler, Medienrunner sowie alle Scan- und
Maintenance-Dispatcher und verlangt eine doppelte, exakte Bestaetigung. Bei
jedem Fehler bleiben alle DB-Writer gestoppt. Erst nach Restore,
Least-Privilege-Rechten und erfolgreicher Readiness beider Runtimes werden die
Dispatcher wieder gestartet:

```bash
Q_ACADEMY_ENV_FILE=/etc/q-academy/production.env \
RESTORE_DATABASE=q_academy \
RESTORE_IN_PLACE=true \
CONFIRM_RESTORE_DATABASE=q_academy \
scripts/ops/postgres-restore.sh /var/backups/q-academy/q-academy-YYYYMMDDTHHMMSSZ.dump
```

Nach jedem Restore Login, Mandantentrennung, Kurszugriff, Mailversand, Job-Queue
und beide Healthchecks pruefen. Das verwendete Backup und die Freigabe protokollieren.

## Rollback

1. Fehlerhafte Version und Zeitpunkt dokumentieren; schreibende Integrationen und
   Scheduler bei Dateninkonsistenz stoppen.
2. Ein Runtime-Rollback von App und Medienrunner ist nur nach einer expliziten
   Rueckwaertskompatibilitaetspruefung der seit dem alten Image ausgefuehrten
   Migrationen zulaessig. Die Readiness des alten Images akzeptiert zusaetzliche
   angewendete Migrationen, verlangt aber weiterhin jeden von diesem Image
   erwarteten Hash; ein fehlender erwarteter Hash ergibt 503. Diese technische
   Teilmengenpruefung ersetzt keine fachliche Kompatibilitaetspruefung. Nach der
   Freigabe das gesperrte Rollback-Skript mit dem bereits vorhandenen vorherigen
   Release-Tag ausfuehren. Es stoppt alle fuenf DB-Writer, startet `app` und
   `media-runner` gemeinsam ohne Abhaengigkeiten mit `--wait`, prueft beide
   Runtimes im Container und startet erst danach die Dispatcher. Im
   `strato-hidrive`-Modus startet es ausserdem den Sweeper aus dem exakt gleichen
   Ziel-Tag und wartet auf dessen Healthcheck. Bei einem Fehler bleiben alle
   Writer gestoppt. Den Tag persistiert es erst nach Readiness atomar in Env und
   Release-State. Im Incident wird kein neues Image gebaut.
3. Ist die Rueckwaertskompatibilitaet nicht belegt, keine improvisierten
   Down-SQLs ausfuehren. Entweder mit einem vorwaerts gerichteten Fix fortfahren
   oder das Pre-Deployment-Backup seitlich wiederherstellen, fachlich pruefen
   und kontrolliert auf Backup-Datenbank und altes Image umschalten. Dabei gehen
   Aenderungen nach dem Backup verloren.
4. Healthchecks, Logs und zentrale Kundenablaeufe pruefen; erst danach Scheduler und
   Integrationen wieder freigeben.

Der Runtime-Rollback ist ausschliesslich als bestaetigtes, prozessgesperrtes
Skript verfuegbar. Es aendert weder Schema noch Datenbank und
bricht ohne vorhandenes Image, exakte Tag-Bestaetigung oder dokumentierte
Migrationskompatibilitaet ab:

```bash
export Q_ACADEMY_ENV_FILE=/etc/q-academy/production.env
export APP_DOMAIN=academy.example.com
export CONFIRM_ROLLBACK_TAG=git-<vorheriger-commit>
export MIGRATIONS_BACKWARD_COMPATIBLE=true
scripts/ops/rollback-release.sh "$CONFIRM_ROLLBACK_TAG"
```

## Regelbetrieb

- Taeglich Backup-, Scheduler- und Caddy-Fehler kontrollieren.
- Nach jedem Host-/Docker-Start, Release und jeder Netzneuerstellung die
  hostseitige Egress-Policy mit `docker-egress-firewall.sh verify` gegen
  Werkzeug-, Policy-, Docker-Backend-, Netz-ID- und Kernel-Digest pruefen; ein
  Fehler sperrt App- und Workerfreigabe und die aktuelle Evidence wird archiviert.
- Taeglich ClamAV-Health, Signaturalter und Scanfehler sowie Erreichbarkeit und
  Kapazitaet des S3-Buckets kontrollieren.
- Taeglich Media-Queue-Alter, Quota-Auslastung, Quarantaene-/Retry-Rate und
  fehlgeschlagene verifizierte Objektloeschungen kontrollieren.
- Taeglich `media-maintenance`-Fehler und anhaltende `skipped`-Antworten
  kontrollieren; einzelne `skipped`-Antworten bei einem laufenden Batch sind
  erwartbar.
- Prometheus-Targets und aktive Regeln kontrollieren; die externe
  Alertmanager-/Provider-Zustellung sowie Eskalation regelmaessig testen.
- Die mitgelieferten Alarme decken Readiness, Queue-Alter/-Tiefe/-Fehler,
  Worker-Heartbeats und Backup-Frische ab. Zusaetzlich Alarme fuer HTTP-5xx,
  Latenzen, Datenbank-/S3-Platz, Zertifikatsablauf, ClamAV-Signaturalter und
  Container-Restarts im gewaehlten externen Monitor konfigurieren.
- Docker markiert einen Container als `unhealthy`, startet ihn allein deshalb
  aber nicht neu. Vor dem Kundenbetrieb muss ein externer Monitor Healthstatus,
  Restart-Zaehler und die aggregierten Queue-Metriken erfassen und alarmieren;
  die eingebauten Fehlerbudgets decken nur explizite HTTP-/Transportfehler ab.
- Monatlich Restore und Zertifikatserneuerung pruefen.
- Basis-Images regelmaessig aktualisieren; neue Digests erst nach
  Architekturpruefung, Vulnerability-Scan und Test als eigener Release in die
  Produktions-Env uebernehmen. Ungepinnte Tags werden nicht ausgerollt.
- Das groessenbegrenzte Medien-Arbeitsfilesystem auf Belegung, Mount-Optionen
  und I/O-Fehler ueberwachen; es darf nicht auf das Root-Dateisystem
  zurueckfallen.
- Docker-Datentraeger und `/var/backups` in die Kapazitaetsueberwachung aufnehmen.
- `docker compose down -v` niemals im Produktionsbetrieb verwenden; der Parameter
  `-v` loescht persistente Datenvolumes.

## Incident Response

Technische Erstdiagnose, sichere Eindaemmung von App-, Datenbank-, Queue-, Secret-
und Providerausfaellen, Recovery-Gates sowie freigabefaehige Kommunikationsvorlagen
stehen in [INCIDENT_RESPONSE_RUNBOOK.md](./INCIDENT_RESPONSE_RUNBOOK.md). Vor dem
Kundenbetrieb muessen On-call, Eskalationskette, Provider-Adminzugaenge,
Kommunikationskanaele und vertragliche Fristen ausserhalb des Repositories
zugewiesen und der Ablauf in Staging geprobt werden.
