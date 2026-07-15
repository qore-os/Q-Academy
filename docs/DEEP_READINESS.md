# Readiness und Provider-Preflights

Stand: 2026-07-15.

## Verträge

Q-Academy trennt Routing-Readiness, tiefe Provider-Abnahme und laufende
Degradationsueberwachung bewusst voneinander:

| Vertrag | Prueft | Darf Traffic entziehen? | Zeitpunkt |
| --- | --- | --- | --- |
| `GET /api/v1/health/live` | HTTP-Prozess und Release-Version | Nur bei Prozessausfall | fortlaufend |
| `GET /api/v1/health/ready` | Produktionskonfiguration, PostgreSQL, UTF-8 und erwartete Migrationen | Ja | fortlaufend |
| bestaetigter HTTP-SLO-Smoke | ausschliesslich lesende Live-/Ready-Latenz, Fehlerrate, Mindestmenge, Payload und Request-ID | Release blockieren | Release und Rootserver-/Proxy-Aenderung |
| Worker-S3-Preflight | Versionierung, DSAR-Lifecycle, Put/Head/Get/Copy/Delete, exakte Versionen und Cleanup | Release blockieren | Erstabnahme und Provider-/IAM-/Lifecycle-Aenderung |
| App-S3-Principal-Preflight | erforderliche App-Rechte und explizit verbotene S3-Rechte | Release blockieren | Erstabnahme und Provider-/IAM-Aenderung |
| ClamAV-Preflight | sauberer INSTREAM und erkannter Standard-AV-Testvektor | Medienfreigabe blockieren | Release und Scanner-/Signatur-Aenderung |
| Medien-Preflight | ClamAV, S3, FFmpeg, FFprobe, STT und Arbeitsfilesystem | Medienfreigabe blockieren | Release |
| interne Metriken | Runtime, Queue-Alter/-Tiefe/-Fehler und Worker-Heartbeats | Alarmieren, nicht automatisch routen | fortlaufend |

Die S3-Zeilen beschreiben im Modus `versioned` den vollstaendigen Vertrag. Im
expliziten Modus `strato-hidrive` bleiben nicht verfuegbare Provider-Garantien
(Versionierung, Lifecycle, Tagging, konditionales Write/Delete und
Prefix-Least-Privilege) in der Preflight-Ausgabe bewusst `false`. Eine
erfolgreiche STRATO-Abnahme darf nur die positiv geprueften POST/PUT-,
HEAD/GET-, ETag-Copy-, Delete- und Cleanup-Garantien bestaetigen und setzt den
separaten Acht-Tage-Export-Sweeper voraus. Details und die ausdrueckliche
Risikoannahme stehen in [S3_PROVIDER_CONTRACT.md](./S3_PROVIDER_CONTRACT.md).

`/ready` bleibt absichtlich auf App und Datenbank begrenzt. Die Web-App ist
nicht mit dem internen ClamAV-Netz verbunden; Scanner und S3-Schreibworkflow
gehoeren dem isolierten Medienrunner. Ein kurzzeitiger Scanner-, S3- oder
STT-Ausfall laesst neue Uploads fail-closed in einem unfertigen Zustand, waehrend
Login, Administration und bereits nicht-mediale Lerninhalte weiter erreichbar
bleiben. Wuerde Caddy oder Kubernetes deshalb die App-Readiness auf `503`
setzen, wuerde aus einer partiellen Medienstoerung ein vollstaendiger
Plattformausfall. Externe Provider werden deshalb nicht pro Readiness-Abruf
beschrieben, gelistet oder mit Schreibcanaries belastet.

## App-S3-Principal

Dieser Abschnitt beschreibt den strikten Modus `versioned`. Im
`strato-hidrive`-Modus ist die fehlende Principal-Isolation Teil der oben
genannten, explizit reduzierten Abnahme.

Der App-Principal und der Medienrunner muessen unterschiedliche Credentials
verwenden. Der Abnahmetest verwendet beide in einem kurzlebigen Operatorprozess:
Der Worker legt zufaellige, eindeutig markierte Canary-Versionen an und entfernt
am Ende alle exakten Versionen und Delete-Marker. Der App-Principal fuehrt nur
die zu pruefenden Produktoperationen aus. Produktobjekte werden weder gelistet
noch angefasst.

Unmittelbar vor jeder potenziell mutierenden Produktoperation prueft der
Worker-Principal erneut `GetBucketVersioning`. Nur der exakte Status `Enabled`
erlaubt die naechste Operation; `Suspended`, fehlender Status oder ein
Providerfehler stoppen vor der Mutation. Das mandatory Cleanup laeuft trotzdem.
Es ruft fuer genau die fuenf zufaelligen Canary-Keys zuerst Worker-`DeleteObject`
ohne Version auf und entfernt danach paginiert alle exakt gelisteten Versionen,
`null`-Versionen und Delete-Marker. Fremde Prefix-Treffer werden nie geloescht.
Der abschliessende Leerstand von `ListObjectVersions` ist autoritativ; weder der
App- noch der Worker-Cleanup setzt ein Abwesenheits-`HeadObject` voraus.

Erforderlich und positiv geprueft werden:

- Write-once-`PutObject` und anschliessendes `HeadObject` unter
  `incoming/tenants/<uuid>/assets/<uuid>/` mit Asset-/Tenant-Metadaten;
- versioniertes `HeadObject` und `GetObject` unter dem zugehoerigen
  `tenants/.../assets/...`-Pfad, einschliesslich ETag-, Version-, Metadaten-,
  Groessen- und Inhaltspruefung;
- fuer `tenants/<uuid>/privacy-exports/...` ausschliesslich der benoetigte
  Write-once-Put mit `q-academy-lifecycle=privacy-export-v1`, versioniertes
  Head/Get und physisches `DeleteObjectVersion` derselben ETag-gebundenen
  Exportversion.

Die App fuehrt nach dem exakten Export-Delete absichtlich kein Abwesenheits-HEAD
aus: AWS S3 darf ohne `ListBucket` fuer ein nicht vorhandenes Objekt `403` statt
`404` liefern. Der Preflight beweist die physische Abwesenheit stattdessen mit
dem getrennten Worker-Principal ueber `ListObjectVersions`; dadurch bleibt der
App-Principal listenfrei, ohne die Delete-Verifikation abzuschwaechen.
Auch `GetBucketLifecycleConfiguration` bleibt dem Operator-/Worker-Preflight
vorbehalten. Dieser prueft separat den wirksamen `tenants/`-plus-Tag-Filter,
acht Tage fuer aktuelle und nicht aktuelle Versionen sowie die
Delete-Marker-Bereinigung. Diese Pruefung laeuft auch im release-blockierenden
App-Principal-Preflight, dort aber ausschliesslich mit dem Worker-Principal.
Ein Prefix mit literalem `*` ist ungueltig.

Mit einer echten Autorisierungsablehnung (`403`/`AccessDenied`) scheitern
muessen dagegen `ListObjectsV2`, `ListObjectVersions`, serverseitiges Copy,
Put unter einem Asset-Zielpfad, unversioniertes Delete sowie Versionsloeschung
von Incoming- und Assetobjekten. Ein Timeout, `404`, `412` oder anderer
Providerfehler gilt nicht als Beweis fuer fehlende Berechtigung und laesst den
Test fail-closed abbrechen.

Lokal beziehungsweise in einer vorbereiteten Operator-Arbeitskopie:

```bash
npm run -- media:s3:app-principal-preflight -- \
  --confirm-bucket "q-academy-production-media" --json
```

Der Prozess benoetigt nur `MEDIA_S3_ENDPOINT`, `MEDIA_S3_REGION`,
`MEDIA_S3_BUCKET`, `MEDIA_S3_FORCE_PATH_STYLE`, die beiden
`MEDIA_S3_APP_*`-Werte und die beiden Worker-Werte `MEDIA_S3_ACCESS_KEY_ID` /
`MEDIA_S3_SECRET_ACCESS_KEY` sowie `MEDIA_S3_COMPATIBILITY_MODE` und
`MEDIA_S3_STRATO_LIMITATIONS_ACCEPTED`. Datenbank-, Session-, Mail-, KI- und
Job-Secrets duerfen nicht injiziert werden. Fuer einen kurzlebigen Rootserver-Container
steht das Docker-Ziel `s3-app-principal-preflight` bereit. Der Bucket muss mit
`--confirm-bucket` ein zweites Mal exakt bestaetigt werden; bei Abweichung
erfolgt kein Providerzugriff.

Nur Exitcode `0`, alle `required`-/`denied`-Werte auf `true` und
`cleanupVerified: true` bestehen den Vertrag. Bei `cleanup_failed` oder
`preflight_and_cleanup_failed` wird anhand der nicht sensitiven `canaryId` mit
Worker-/Provider-Administration geprueft, dass keine Canary-Version verbleibt.

## ClamAV

Der Deep-Preflight streamt zuerst einen zufaelligen sauberen Canary und danach
den harmlosen Standard-Antivirus-Testvektor ueber denselben begrenzten
`INSTREAM`-Pfad wie ein Medienjob. Der Testvektor wird nur zur Laufzeit aus
getrennten Fragmenten zusammengesetzt und nie als Datei oder vollstaendiges
Source-Literal abgelegt. Der saubere Stream muss `OK` liefern; der Testvektor
muss mit einer nicht leeren Signaturidentitaet als infiziert erkannt werden.

Ein eigenstaendiger Lauf braucht keine S3- oder Datenbank-Credentials:

```bash
npm run -- media:clamav:preflight -- \
  --confirm-host "clamav" --json
```

`--confirm-host` muss exakt dem normalisierten `MEDIA_CLAMAV_HOST` entsprechen.
Der bestehende `media:processing:preflight` fuehrt denselben ClamAV-Vertrag
zusaetzlich zu S3, FFmpeg, FFprobe, STT und Arbeitsfilesystem aus. Der
`media-preflight`-Container ist dafuer mit dem internen `media`-Netz verbunden;
der oeffentliche App-Container bleibt davon getrennt.

Der separate Container `clamav-freshclam` aktualisiert das gemeinsame
Signatur-Volume ueber `egress`; `clamav` selbst bleibt intern und mountet das
Volume nur lesend. Beide Container starten nur bei einer regulaeren Daily-Signatur
mit strukturell gueltigem `ClamAV-VDB`-Header und einem maximal 36 Stunden alten
internen Erstellungszeitstempel gesund. Dateisystem-`mtime`, Kopieren oder
`touch` koennen das Alters-Gate nicht erneuern. Der Medienrunner exportiert
`q_academy_clamav_signature_timestamp_seconds`,
`q_academy_clamav_signature_age_seconds` und
`q_academy_clamav_signature_current`. Stagnierendes Alter, ein fehlender Wert
oder ein fehlgeschlagenes Alters-Gate alarmieren ueber Prometheus.

## Laufendes Monitoring

Schreibende S3-Canaries und EICAR-Scans gehoeren nicht in einen 15- oder
30-Sekunden-Healthcheck. Laufend werden stattdessen diese Signale kombiniert:

- App- und Medienrunner-Target sowie `q_academy_runtime_ready`;
- ClamAV-Containerhealth, Neustarts und Signaturalter;
- `media-scan`-/`media-maintenance`-Heartbeats sowie Queue-Alter, -Tiefe und
  fehlgeschlagene Jobs;
- S3-Erreichbarkeit, Bucketkapazitaet, Fehler-/Latenzrate und abgelehnte
  Requests im Provider- oder externen Infrastrukturmonitor;
- regelmaessige Wiederholung der tiefen Verträge nach Credential-, Policy-,
  Bucket-, Verschluesselungs-, Proxy-, Scanner- oder Signaturaenderungen.

Ein externes Monitoring muss die Signale getrennt alarmieren. Bei Scanner- oder
S3-Ausfall werden Medienjobs angehalten beziehungsweise retried; niemals wird
ein nicht vollstaendig gescanntes Objekt `ready`. Erst wenn App oder Datenbank
nicht betriebsbereit sind, darf die Routing-Readiness die gesamte Instanz aus
dem Traffic nehmen.
