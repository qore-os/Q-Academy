# S3-Provider-Contract-Abnahme

Dieser Preflight prueft den produktiven S3-kompatiblen Bucket und den
tatsaechlich vom Medienrunner verwendeten Worker-Principal vor der Freigabe.
Die hier genannten `MEDIA_S3_ACCESS_KEY_ID`/`MEDIA_S3_SECRET_ACCESS_KEY` sind
nicht die eingeschraenkten `MEDIA_S3_APP_*`-Zugangsdaten der Web-App. Er verwendet
ausschliesslich vier Objektschluessel unter einem zufaelligen Praefix der Form
`q-academy-provider-contract-canary/v1/<uuid>/`. Die Produktpraefixe
`incoming/` und `tenants/` werden weder gelesen noch veraendert.

## Vertragsmodi

`MEDIA_S3_COMPATIBILITY_MODE=versioned` ist der vollstaendige Vertrag. Fuer ihn
gelten alle nachfolgenden Anforderungen an Versionierung, Lifecycle,
Objekt-Tags, konditionale Mutationen und getrennte Principals unveraendert.
Modus, Endpoint, Region, Bucket und Path-Style werden im Release-State gebunden.
Ein Provider- oder Bucketwechsel ist nur nach gestoppten Writern und ohne
verbleibende Multipart-Sitzung, S3-Medienobjekt, S3-Derivat oder
S3-Datenschutzexport zulaessig. Bestandsdaten erfordern vorher einen separat
verifizierten Objektmigrationslauf. Deploy, Rollback und Boot-Reconcile erzwingen
diesen Vertrag fail-closed.

STRATO HiDrive Object Storage darf nur ueber den expliziten, anbieterspezifischen
Modus aktiviert werden:

```dotenv
MEDIA_S3_ENDPOINT=https://s3.hidrive.strato.com
MEDIA_S3_REGION=eu-central-1
MEDIA_S3_FORCE_PATH_STYLE=true
MEDIA_S3_COMPATIBILITY_MODE=strato-hidrive
MEDIA_S3_STRATO_LIMITATIONS_ACCEPTED=true
```

Das Acceptance-Flag ist eine dokumentierte Risikoannahme und kein Ersatz fuer
eine Provider-Faehigkeit. Der gegen STRATO verifizierte Vertrag ist gegenueber
`versioned` reduziert:

- Es gibt keine belastbare Objekt-`VersionId`; native Bucket-Versionierung und
  Lifecycle-Abfragen sind nicht verfuegbar. Ueberschriebene oder geloeschte
  Objekte koennen deshalb nicht ueber Q-Academy auf eine alte Provider-Version
  zurueckgesetzt werden.
- Objekt-Tags sowie ein nativer Acht-Tage-Lifecycle fuer Datenschutzexporte
  sind nicht verfuegbar. Der App-Scheduler loescht nach sieben Tagen; ein davon
  unabhaengiger, begrenzter STRATO-Sweeper muss alle passenden Exportobjekte
  spaetestens nach acht Tagen entfernen und seine Abwesenheitspruefung
  protokollieren. Ohne diesen Sweeper ist der Modus nicht produktionsreif.
  Der Compose-Service `strato-privacy-sweeper` laeuft mit dem Profil `strato`
  alle 15 Minuten, verwendet eine Stunde Sicherheitsabstand zur Acht-Tage-Grenze
  und wird nur nach einem verifizierten Sweep gesund.
- STRATO erzwingt weder `If-None-Match: *` beim Schreiben noch `If-Match` beim
  Loeschen verlaesslich. Q-Academy verwendet deshalb nicht wiederverwendete,
  vollstaendige UUID-Keys, prueft Zielabwesenheit, bindet Reads und Copy an den
  ETag und verifiziert nach einem exakten unversionierten Delete die
  Abwesenheit per HEAD.
- Die verwendeten HiDrive-Zugangsschluessel liefern keinen nachgewiesenen
  Prefix-IAM-/Least-Privilege-Vertrag. Getrennte `MEDIA_S3_APP_*`- und
  Worker-Werte stellen dort allein keine Rechteisolation her. Fuer einen
  begrenzten Schadensradius soll der gesamte HiDrive-Objektspeichervertrag nur
  Q-Academy dienen; Schluessel werden als accountweite Secrets behandelt und
  gemeinsam rotiert.
- Direkte Browser-PUTs scheitern an der fehlenden OPTIONS-CORS-Antwort. Der
  STRATO-Modus verwendet einen signierten Multipart-POST ohne eigene
  Request-Header; Upload-Fortschritt ist dabei nur als Start/Abschluss bekannt.

Der Modus liefert damit bewusst keine Paritaet zum strikten versionierten
Vertrag. Positive STRATO-Canaries muessen PUT/POST, HEAD/GET mit Metadaten und
ETag, ETag-gebundenes Copy, exaktes Delete und vollstaendigen Cleanup belegen;
nicht verfuegbare Versionierungs-, Lifecycle-, Tagging-, Conditional-Write- und
Least-Privilege-Eigenschaften muessen in der Abnahme sichtbar `false` bleiben.

## Voraussetzungen

- `MEDIA_S3_ENDPOINT`, `MEDIA_S3_REGION`, `MEDIA_S3_BUCKET`,
  `MEDIA_S3_ACCESS_KEY_ID`, `MEDIA_S3_SECRET_ACCESS_KEY` und optional
  `MEDIA_S3_FORCE_PATH_STYLE` zeigen auf die abzunehmende Umgebung.
  `MEDIA_S3_COMPATIBILITY_MODE` und
  `MEDIA_S3_STRATO_LIMITATIONS_ACCEPTED` sowie
  `MEDIA_MULTIPART_UPLOAD_TTL_SECONDS` muessen ebenfalls an den Preflight
  weitergereicht werden. Ohne Modus gilt der strikte `versioned`-Vertrag.
- `MEDIA_S3_BROWSER_ALLOWED_ORIGINS_JSON` ist das explizite, versionierte
  Inventar aller produktiven Plattform-, Tenant- und Custom-Domain-Origins.
  Es muss eine JSON-Liste aus mindestens zwei kanonischen HTTPS-Origins sein
  und `NEXT_PUBLIC_APP_URL` sowie den Default-Tenant-Host aus
  `DEFAULT_ORGANIZATION_SLUG` und `TENANT_BASE_DOMAIN` enthalten. Wildcards,
  Ports, Pfade, Duplikate und implizite Subdomain-Muster sind unzulaessig.
- Der Bucket-Name wird dem Befehl ein zweites Mal und exakt mit
  `--confirm-bucket` uebergeben. Bei einer Abweichung findet kein
  Provider-Zugriff statt.
- Der Worker-/Operator-Principal benoetigt `s3:GetBucketVersioning`,
  `s3:GetLifecycleConfiguration` fuer den SDK-Aufruf
  `GetBucketLifecycleConfiguration`, `s3:GetBucketCORS`, `s3:PutObject`,
  `s3:ListMultipartUploadParts`, `s3:AbortMultipartUpload`,
  `GetObjectVersion`, `ListBucketVersions`, `DeleteObject` und
  `DeleteObjectVersion` fuer den Canary-Praefix. Copy benoetigt Lesen der
  exakten Quellversion und Schreiben des Zielobjekts. Die normalen
  Produktrechte bleiben auf `incoming/` und `tenants/` begrenzt.
- Der Web-App-Principal ist separat abzunehmen: signierter Write-once-PUT unter
  `incoming/`, nativer Multipart-Upload, Upload-HEAD und versionierter Download
  muessen funktionieren. AWS autorisiert `CreateMultipartUpload`, `UploadPart`
  und `CompleteMultipartUpload` ueber `s3:PutObject`; zusaetzlich braucht die
  App auf `incoming/` `s3:ListMultipartUploadParts` und
  `s3:AbortMultipartUpload`;
  Copy, Listing, unversioniertes Delete und `DeleteObjectVersion` muessen fuer
  Asset- und Incoming-Pfade mit `AccessDenied` scheitern. Nur unter dem
  getrennten Privacy-Export-Praefix ist die exakte Versionsloeschung Teil des
  erforderlichen App-Vertrags. Dort braucht die App ausserdem
  `PutObjectTagging`; der Worker verifiziert das geschriebene Tag ueber
  `GetObjectVersionTagging` an der exakten Canary-Version.
- Bucket-Versionierung muss exakt `Enabled` sein. Ein leerer oder
  `Suspended`-Status ist nicht zulaessig.
- Die produktive Bucket-Lifecycle-Konfiguration muss den verpflichtenden
  Datenschutzexport-Vertrag aus
  [`deploy/s3-privacy-export-lifecycle.production.example.json`](../deploy/s3-privacy-export-lifecycle.production.example.json)
  enthalten. S3-Prefixfilter interpretieren `*` nicht als Wildcard. Deshalb
  lautet der wirksame Filter `tenants/` plus Objekt-Tag
  `q-academy-lifecycle=privacy-export-v1`; ein scheinbarer Prefix
  `tenants/*/privacy-exports/` besteht den Preflight nicht.
- Eine separate, aktivierte, bucketweite Regel mit leerem Prefix muss
  unvollstaendige Multipart-Uploads abbrechen. Die Frist muss mindestens
  `ceil((MEDIA_MULTIPART_UPLOAD_TTL_SECONDS + 2700) / 86400)` und hoechstens
  acht Tage betragen. Die 2700 Sekunden bestehen aus 30 Minuten
  Completion-Recovery und 15 Minuten Provider- und Uhrzeitreserve. Eine weitere
  globale oder fuer `incoming/` moeglicherweise
  zutreffende Regel mit frueherer Frist blockiert die Freigabe ebenfalls.

## Ausfuehrung

Auf dem Rootserver wird ein separates, kurzlebiges Operator-Image gebaut. Der
Container darf nicht die vollstaendige Produktionsumgebung mit Datenbank-,
Session-, Mail-, Webhook- oder KI-Secrets erhalten. Stattdessen filtert `awk`
ohne `source`, Shell-Evaluation oder Ausgabe der Werte ausschliesslich die
S3-Einstellungen und das explizite HTTPS-Origin-Inventar in eine temporaere Datei
mit Modus `0600`. Ein Trap entfernt
Datei und Operator-Image auch bei Abbruch:

```bash
cd /opt/q-academy
export Q_ACADEMY_ENV_FILE=/etc/q-academy/production.env
export PREFLIGHT_IMAGE="q-academy-s3-preflight:$(git rev-parse HEAD)"
scripts/ops/verify-image-pins.sh
export NODE_IMAGE="$(sed -n 's/^NODE_IMAGE=//p' "$Q_ACADEMY_ENV_FILE")"

(
  set -eu
  umask 077
  PREFLIGHT_ENV="$(mktemp /tmp/q-academy-s3-preflight.XXXXXX)"
  cleanup_preflight() {
    docker image rm "$PREFLIGHT_IMAGE" >/dev/null 2>&1 || true
    if command -v shred >/dev/null 2>&1; then
      shred -u -- "$PREFLIGHT_ENV" 2>/dev/null || rm -f -- "$PREFLIGHT_ENV"
    else
      rm -f -- "$PREFLIGHT_ENV"
    fi
  }
  trap cleanup_preflight EXIT
  trap 'exit 130' HUP INT TERM

  sudo awk -F= '
    $1 == "MEDIA_S3_ENDPOINT" ||
    $1 == "MEDIA_S3_REGION" ||
    $1 == "MEDIA_S3_BUCKET" ||
    $1 == "MEDIA_S3_ACCESS_KEY_ID" ||
    $1 == "MEDIA_S3_SECRET_ACCESS_KEY" ||
    $1 == "MEDIA_S3_FORCE_PATH_STYLE" ||
    $1 == "MEDIA_S3_COMPATIBILITY_MODE" ||
    $1 == "MEDIA_S3_STRATO_LIMITATIONS_ACCEPTED" ||
    $1 == "MEDIA_MULTIPART_UPLOAD_TTL_SECONDS" ||
    $1 == "NEXT_PUBLIC_APP_URL" ||
    $1 == "DEFAULT_ORGANIZATION_SLUG" ||
    $1 == "TENANT_BASE_DOMAIN" ||
    $1 == "MEDIA_S3_BROWSER_ALLOWED_ORIGINS_JSON" { print }
  ' "$Q_ACADEMY_ENV_FILE" >"$PREFLIGHT_ENV"
  chmod 0600 "$PREFLIGHT_ENV"

  docker build --pull --target s3-preflight \
    --build-arg "NODE_IMAGE=$NODE_IMAGE" -t "$PREFLIGHT_IMAGE" .
  docker run --rm --read-only --cap-drop=ALL \
    --security-opt=no-new-privileges \
    --env-file "$PREFLIGHT_ENV" \
    "$PREFLIGHT_IMAGE" \
    --confirm-bucket "q-academy-production-media" --json
)
unset NODE_IMAGE
```

In einer vorbereiteten Operator-Arbeitskopie oder CI-Umgebung ist derselbe Test
als NPM-Script verfuegbar. Der Prozess darf auch dort nur die oben genannten
S3-Variablen, `NEXT_PUBLIC_APP_URL`, `DEFAULT_ORGANIZATION_SLUG`,
`TENANT_BASE_DOMAIN` und `MEDIA_S3_BROWSER_ALLOWED_ORIGINS_JSON` erhalten; die Produktionsdatei wird
weder geladen noch evaluiert:

```bash
npm run -- media:s3:preflight -- \
  --confirm-bucket "q-academy-production-media" --json
```

Der Test verlangt und prueft:

1. Versionierungsstatus exakt `Enabled`.
2. Aktivierte Lifecycle-Regeln fuer aktuelle und nicht aktuelle, getaggte
   Datenschutzexport-Versionen mit exakt acht Tagen sowie die Bereinigung
   abgelaufener Delete-Marker unter `tenants/`; ausserdem die TTL-gebundene,
   bucketweite Multipart-Abbruchregel mit hoechstens acht Tagen.
3. Exakte HTTPS-Browser-CORS-Regel fuer `PUT`, `Content-Type`,
   `If-None-Match`, `X-Amz-Checksum-Sha256` und exponierten `ETag`, ohne
   Origin- oder Header-Wildcards. Zusaetzlich erzeugt der Preflight eine echte
   signierte UploadPart-URL und prueft jeden Inventar-Origin einzeln. Je Origin
   sendet er `OPTIONS` mit
   `Access-Control-Request-Headers: content-type,x-amz-checksum-sha256` und
   uebertraegt den dritten Part anschliessend mit realistischem
   `Content-Type: video/mp4` sowie derselben SHA-256-Pruefsumme wie der Browser.
4. Nativer Drei-Part-Canary mit `ChecksumAlgorithm=SHA256`,
   `ChecksumType=COMPOSITE`, UploadPart-SHA-256, ListParts-Inventar,
   `MpuObjectSize`, Composite-Checksumme in Complete und HEAD sowie ein
   separater Abort-Canary mit verifizierter Abwesenheit von Upload und Objekt.
5. Write-once-PUT mit `If-None-Match: *`, Metadaten, ETag und echter VersionId.
6. Versioniertes HEAD und GET der Quelle mit vollstaendigem Inhalts-Hash.
7. COPY exakt aus dieser Quellversion mit ersetzten Metadaten.
8. Versioniertes HEAD und GET der Kopie mit ETag-, Groessen-, MIME-,
   Metadaten- und SHA-256-Pruefung.
9. Unversionierten Delete der geprueften Kopie, einen gelisteten Delete-Marker
   mit stabiler VersionId und damit die produktiv benoetigte
   `DeleteObject`-Berechtigung.
10. Loeschung aller erzeugten Versionen, Delete-Marker und offenen
    Multipart-Uploads sowie anschliessend
    einen leeren Canary-Praefix.

Der Cleanup bricht fuer alle exakten Multipart-Canaries zunaechst jeden noch
offenen Upload ab. Fuer die vier exakten Keys fuehrt er danach ein unversioniertes
Worker-Delete aus und entfernt danach alle paginiert gelisteten Versionen,
`null`-Versionen und Delete-Marker in exakten Batches. Der leere
`ListObjectVersions`-Bestand ist der Abwesenheitsnachweis. Ein unversioniertes
HEAD ist weder fuer den Worker- noch fuer den App-Vertrag zulaessig, weil ein
Principal mit `ListBucketVersions`, aber ohne `ListBucket`, fuer ein fehlendes
Objekt `403` erhalten kann.

Der SDK-Transport verwendet eine Verbindungsdeadline von 5 Sekunden und eine
Socket-Inaktivitaetsgrenze von 2 Minuten. Jeder einzelne Preflight-Befehl hat
zusaetzlich eine harte Gesamtdeadline von 60 Sekunden; ein Provider, der nicht
antwortet oder einen Body-Stream offen haelt, besteht die Abnahme nicht.
Der Releasepfad begrenzt zusaetzlich den gesamten App-Principal-Container auf
1200 Sekunden und den gesamten Medien-Preflight auf 1800 Sekunden.

Der Exitcode `0` und die JSON-Ausgabe mit `cleanupVerified: true`,
`privacyExportLifecycleVerified: true` und
`privacyExportExpirationDays: 8`, `browserUploadCorsVerified: true`,
`multipartUploadVerified: true`, `multipartAbortVerified: true` und den
tatsaechlich wirksamen `incompleteMultipartAbortDays` sind gemeinsam die
technische Abnahme.
Zeitpunkt, Release-Commit, Provider/Region, Bucket,
Exitcode und die geheimnisfreie JSON-Ausgabe werden im Betriebsprotokoll
festgehalten. Umgebungsdateien, Access Keys, Secret Keys und SDK-Debugausgaben
duerfen nicht in das Protokoll gelangen.

## Fehler und Cleanup

Jeder fachliche oder technische Fehler fuehrt zu Exitcode `1`. Der Preflight
versucht trotzdem in mehreren Durchlaeufen, alle Canary-Versionen und
Delete-Marker zu entfernen und verifiziert danach den Leerstand. SDK-Fehler,
Endpoints und Zugangsdaten werden nicht ausgegeben; sichtbar sind nur ein
stabiler Fehlercode und der nicht sensitive Canary-Praefix.

Bei `cleanup_failed` oder `preflight_and_cleanup_failed` darf die Umgebung nicht
freigegeben werden. Der gemeldete Canary-Praefix wird mit den
Provider-Administrationswerkzeugen auf aktuelle Versionen und Delete-Marker
geprueft. Alle Versionen der beiden Canary-Keys muessen entfernt und der leere
Praefix nachgewiesen werden. Erst danach werden IAM-/Providerfehler behoben und
der Preflight mit einem neuen Zufallspraefix wiederholt.

Der Preflight wird vor dem ersten Produktivstart und erneut nach Aenderungen an
Provider, Bucket-Versionierung, Bucket-Lifecycle, Verschluesselung, IAM, Proxy oder
S3-Kompatibilitaetsmodus ausgefuehrt.

## App-Principal separat abnehmen

Der Worker-Vertrag belegt nicht die Least-Privilege-Policy der Web-App. Dafuer
steht ein eigener Positiv- und Negativvertrag bereit, der beide getrennten
Credentials verwendet, aber alle Canary-Versionen ausschliesslich mit dem
Worker-Principal aufraeumt:

```bash
npm run -- media:s3:app-principal-preflight -- \
  --confirm-bucket "q-academy-production-media" --json
```

Vor jeder potenziell mutierenden App-/Worker-Canary-Operation prueft der
Worker erneut, dass `GetBucketVersioning` exakt `Enabled` liefert. Ein
`Suspended`- oder fehlender Status stoppt vor der Produktpraefix-Mutation; das
exakte mandatory Cleanup wird trotzdem ausgefuehrt.

Noch vor der ersten Canary-Mutation liest derselbe Worker-Principal die
Bucket-Lifecycle- und Browser-CORS-Konfiguration fuer jeden Origin im
expliziten Inventar. Fehlt der exakte
Acht-Tage-, TTL-gebundene Multipart- oder CORS-Vertrag, blockiert
auch der bei jedem Release ausgefuehrte App-Principal-Preflight. Der
App-Principal selbst erhaelt dafuer weder Lifecycle-Leserechte noch Listenrechte.

Auch im STRATO-Modus prueft der Release-Vertrag nicht nur die statische
POST-CORS-Regel, sondern sendet fuer jeden Inventar-Origin einen echten
signierten Browser-POST und verlangt den jeweils exakten
`Access-Control-Allow-Origin`-Response-Header.

Er prueft erforderlichen Incoming-Put/Head, exakten Asset-Head/Get, den
begrenzten Privacy-Export-Lifecycle und einen nativen Drei-Part-Upload. Create,
UploadPart, ListParts, Complete und Composite-SHA-256 muessen funktionieren;
ein separater Canary wird abgebrochen und muss danach als Upload und Objekt
fehlen. Der Privacy-PUT muss dabei das
verpflichtende Tag `q-academy-lifecycle=privacy-export-v1` setzen duerfen.
List, ListVersions, Copy, Tenant-Asset-Put,
unversioniertes Delete und Version-Deletes fuer Incoming-/Assetobjekte muessen
als echte Autorisierungsablehnung scheitern. Ein Providerfehler oder ein
Precondition-Fehler ersetzt `AccessDenied` nicht. Das kurzlebige Docker-Ziel
`s3-app-principal-preflight` enthaelt nur den dafuer benoetigten Code. Details,
Ausgabevertrag und Readiness-Abgrenzung stehen in
[DEEP_READINESS.md](./DEEP_READINESS.md).

Nach dem App-seitigen, ETag-gebundenen `DeleteObjectVersion` eines Testexports
verifiziert der Worker-Principal ueber `ListObjectVersions`, dass exakt diese
Version physisch fehlt. Ein App-HEAD waere kein gueltiger Nachweis: Ohne
`ListBucket` darf S3 fuer ein nicht vorhandenes Objekt absichtlich `403` statt
`404` liefern.
