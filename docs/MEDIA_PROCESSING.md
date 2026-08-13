# Medienverarbeitung

Stand: 2026-08-13.

## Lifecycle

Ein Upload wird weiterhin zuerst vollstaendig gestreamt, signatur- und
strukturgeprueft, mit SHA-256 gebunden und je nach Umgebung durch ClamAV
gescannt. Erst ein unveraenderliches `ready`-Asset darf einen
`media_processing_job` erhalten. Der Request-Key bindet Jobtyp, Optionen,
Asset-ID, Inhaltsdigest und bei Transkripten den versionierten Providervertrag;
identische Auftraege sind damit idempotent. Jobs eines abgeloesten
Transkriptvertrags werden erst nach Lease-Ablauf claim-gesichert abgebrochen und
unter dem aktuellen Vertrag neu eingereiht.

Fuer Kursvideo werden automatisch Thumbnail, H.264/AAC-Transcode und
Transkript eingeplant, fuer Kursaudio ein Transkript. Ein Worker beansprucht
genau einen Job mit Lease und Claim-Token. Ergebniszeilen entstehen erst nach
erfolgreicher Provider-Ausfuehrung sowie erneuter Groessen-, Signatur-,
Metadaten- und Digestpruefung. Ein fehlender Prozessor erzeugt
`provider_unavailable`, nie ein Scheinergebnis. Terminale Quellen loesen die
physische Derivatloeschung aus.

MP3-, Ogg- und WebM-Dauern werden mit `music-metadata` aus einem gebremsten
64-KiB-Streamingpfad gelesen. Der Parser darf fuer eine belastbare Dauer bis
zum Streamende lesen, puffert den Upload aber nicht vollstaendig im Speicher.
Nicht parsebare oder unplausible Dateien werden quarantiniert.

## Provider und isolierter Runner

- `MEDIA_FFMPEG_PATH` zeigt auf ein echtes FFmpeg-Binary. Ohne Wert wird
  `ffmpeg` aus `PATH` verwendet.
- Der Produktions-Compose setzt `MEDIA_TRANSCRIPT_COMMAND` fest auf
  `/app/node_modules/.bin/tsx` und startet damit ausschliesslich
  `/app/scripts/openai-transcribe.ts`. Die Jobargumente sind fest
  `--input {input} --output-vtt {output} --language {language}`;
  der Preflight ist fest das Script plus `--preflight`. Ein `--help`-Ersatz
  besteht den Preflight nicht.
- Der Adapter verwendet ausschliesslich
  `https://api.openai.com/v1/audio/transcriptions`, das feste Modell
  `gpt-4o-transcribe-diarize`, `response_format=diarized_json` und
  `chunking_strategy=auto`. Die API liefert damit zeitcodierte Segmente fuer
  das kanonische WebVTT; Sprecherlabels werden nicht in Cue-Text eingebettet.
  `prompt`, `include` und `timestamp_granularities` sind fuer diesen Vertrag
  bewusst ausgeschlossen. Weder Base-URL noch Modell kommen aus Job-, Tenant-
  oder Operator-Eingaben. Siehe die offizielle
  [Create-transcription-Referenz](https://developers.openai.com/api/reference/resources/audio/subresources/transcriptions/methods/create).
- FFmpeg normalisiert die Eingabe auf Mono-MP3 mit 16 kHz und 32 kbit/s und
  teilt sie deterministisch in hoechstens fuenf Minuten lange Dateien. Jede
  Datei bleibt mit maximal 24.000.000 Byte unter der offiziellen 25-MB-Grenze;
  `chunking_strategy=auto` fuehrt innerhalb eines Uploads zusaetzlich die vom
  Modell erwartete serverseitige VAD-Segmentierung aus. Die automatische
  Verarbeitung ist auf zwei Stunden begrenzt und lehnt laengere oder unbekannte
  Dauern im Worker vor Quelldownload, FFmpeg und Providerzugriff ab. Manuell
  importierte WebVTT-Transkripte duerfen weiterhin bis zu zwoelf Stunden
  abdecken. Unvollstaendige Segmentantworten und unplausible Zeitcodes schlagen
  geschlossen fehl. Damit umfasst ein automatischer Auftrag hoechstens 24
  Provideraufrufe; die feste Modellgrenze von 2.000 Ausgabetokens je
  Fuenf-Minuten-Aufruf bleibt innerhalb der globalen Text- und WebVTT-Grenzen.
  Bei unbekannter oder laengerer Dauer werden weder ein automatischer
  Transkript- noch ein Videobeschreibungsauftrag angelegt. Bereits persistierte
  Beschreibungsauftraege enden stabil mit `transcript_duration_unsupported`.
- `MEDIA_FFMPEG_TIMEOUT_SECONDS` und `MEDIA_TRANSCRIPT_TIMEOUT_SECONDS`
  begrenzen die beiden Prozessoren getrennt. Die Produktionsdefaults sind
  10.800 beziehungsweise 18.000 Sekunden; zulaessig sind 60 bis 18.000
  Sekunden. Das Transkriptionsdefault deckt den formalen Worst Case aus
  FFmpeg, 24 seriellen Fuenf-Minuten-Chunks, je drei begrenzten
  Provider-Versuchen und einer festen Abschlussreserve ab.
- Der synchrone Media-Dispatch hat einen schichtweisen End-to-End-Vertrag:
  600 Sekunden ClamAV plus 900 Sekunden gebundene S3-Quellmaterialisierung
  plus 18.000 Sekunden STT ergeben 19.500 Sekunden Arbeit. Die Route hat mit
  19.800 Sekunden weitere 300 Sekunden Abschlussreserve; der HTTP-Dispatcher
  wartet 19.900 Sekunden und besitzt damit nochmals 100 Sekunden
  Transportreserve. Das Mindestalter des Success-Heartbeats ist dynamisch
  `MEDIA_WORKER_POLL_SECONDS + 19.900 + 60` Sekunden.
- `MEDIA_TRANSCRIPT_COMMAND_ARGS_JSON` ersetzt nur die drei exakten Platzhalter
  `{input}`, `{output}` und `{language}`. Im Produktions-Compose ist das Array
  fest verdrahtet; freie Jobargumente werden nicht uebernommen.
- `MEDIA_TRANSCRIPT_SIDECAR_DIRECTORY` aktiviert den deterministischen
  Dev-/Test-Provider. Er liest nur
  `<sha256>.<language>.vtt` unter diesem Verzeichnis und validiert das Ergebnis
  mit denselben WebVTT-Grenzen wie der Editor.
- `MEDIA_PROCESSING_WORK_ROOT` ist das ausschliesslich fuer einen Job verwendete
  Arbeitsverzeichnis. Im Produktions-Compose ist es ein Bind-Mount auf ein
  eigenes 10-GiB-Disk-Filesystem mit `nodev,nosuid,noexec`. Der Container
  erstellt einen fehlenden Hostpfad nicht, leert abgebrochene Jobverzeichnisse
  beim Start und bereinigt jedes laufende Jobverzeichnis in `finally`.
- `MEDIA_FFPROBE_PATH` wird zusammen mit FFmpeg im Processing-Preflight
  geprueft. Im bereitgestellten `media-runner`-Image sind beide Binaries
  enthalten.

Der Produktions-Runner verwendet den eingeschraenkten Datenbanknutzer und die
separaten S3-Credentials des Runtime-Roles `media-worker`. Eine Quelle wird nur
ueber ihre gespeicherte `VersionId` und ETag geladen. Nach dem begrenzten
Download muessen Groesse und SHA-256 erneut zur Datenbankidentitaet passen.
FFmpeg und STT laufen ohne Shell, mit geschlossenem stdin und getrennten
harten Timeouts. Bei Timeout oder Claim-Verlust wird unter Linux die gesamte
Prozessgruppe beendet, damit kein Kindprozess weiterarbeitet.
Das dedizierte Provider-Credential steht nie in Compose-Environment,
Build-Argumenten oder App-Logs. Der Hostpfad
`OPENAI_TRANSCRIPTION_API_KEY_SOURCE_FILE` ist standardmaessig
`/etc/q-academy/openai-transcription-api-key`; Compose bindet ihn mit Long-
Syntax, `read_only: true` und `create_host_path: false` ausschliesslich nach
`media-runner` und `media-preflight` als
`/run/secrets/q-academy-openai-transcription-api-key`. Auf dem Host muss die
regulaere Datei exakt UID/GID `1001:1001` und Modus `0400` besitzen. Release,
Reconcile und Rollback verlangen zusaetzlich hoechstens 1024 Byte, im
aktivierten Modus mindestens acht Byte und im deaktivierten Modus eine exakt
leere Platzhalterdatei. UID/GID 1001 ist fuer den nicht privilegierten
Containerprozess reserviert und braucht
kein anmeldbares Hostkonto. Initiales Einspielen und Rotation erfolgen aus
einer geschuetzten Operatorquelle, niemals ueber die Env-Datei oder die
Shell-History:

```bash
install -o 1001 -g 1001 -m 0400 \
  /geschuetzte/operatorquelle/openai-transcription-api-key \
  /etc/q-academy/openai-transcription-api-key.new
mv -f /etc/q-academy/openai-transcription-api-key.new \
  /etc/q-academy/openai-transcription-api-key
test "$(stat -c '%u:%g:%a' /etc/q-academy/openai-transcription-api-key)" = \
  "1001:1001:400"
```

Nach jeder Rotation muss der echte Medien-Preflight erfolgreich laufen; der
gesprochene Canary muss dabei als zeitcodiertes `diarized_json` mit den
erwarteten Canary-Begriffen zurueckkommen. Der
alte Schluessel wird erst danach beim Provider widerrufen. Vor Kundenfreigabe
muessen Audio-Egress zu OpenAI, Rechtsgrundlage beziehungsweise Einwilligung,
Datenschutzhinweis, AVV/DPA, Provider-Retention und Datenregion schriftlich
freigegeben sein. Die fuer Uploads erzeugten Audio-Chunks liegen nur im
isolierten Job-Arbeitsverzeichnis und werden im `finally` entfernt; nur der
kurze Preflight-Canary liegt im Container-`/tmp`-Tmpfs. Diese lokale Bereinigung
ersetzt keine vertragliche Provider-Retention. Der stabile `Idempotency-Key`
bindet Modell, Format, Chunking, Sprache und Inhaltsdigest fuer Retries. Er ist
keine Zusage ueber genau einmalige Providerabrechnung.
Das Kostenmodell wird gegen den jeweils gueltigen
Minutenpreis vertraglich bestaetigt und mit Budget-/Usage-Alarmen begrenzt.
Bei Provider-Ausfall bleiben neue Transkriptjobs unfertig und werden ueber die
bestehende Queue erneut versucht; es gibt keinen stillen Ersatzprovider und
keine Freigabe eines Scheintranskripts. Bestehende Inhalte und die App-
Readiness bleiben davon getrennt.

Die Freigabe des Transkriptionsvertrags braucht reale, nicht synthetische
Audio-Evals fuer Deutsch und Englisch: WER, Cue-Zeitabweichung, schnelle
Fuenf-Minuten-Sprache, Satzgrenzen an lokalen Chunk-Grenzen sowie Laufzeit und
Kosten fuer 60 Minuten und den zweistuendigen automatischen Grenzfall. Der Canary prueft
nur Erreichbarkeit, Authentisierung und das erwartete Antwortschema; er ersetzt
keine Qualitaetsabnahme.

Derivate werden mit Quell-Digest und Job-ID hochgeladen und erst nach einem
verifizierenden Head-Request inklusive VersionId, ETag, Groesse, MIME-Typ und
Metadaten in der Datenbank freigegeben. Jeder Fehler entfernt die erzeugte
Objektversion; das Jobverzeichnis wird in einem `finally` rekursiv bereinigt.

Vor einem Deployment ist zusaetzlich zum allgemeinen S3-Preflight auszufuehren:

```bash
docker compose --env-file "$Q_ACADEMY_ENV_FILE" -f compose.production.yml \
  --profile operations run --rm --no-deps media-preflight \
  --confirm-bucket "$(sed -n 's/^MEDIA_S3_BUCKET=//p' "$Q_ACADEMY_ENV_FILE")"
```

Der Preflight prueft Worker-Rolle, S3-Versionierung/Conditional Writes/Cleanup,
einen sauberen und einen erkannten ClamAV-INSTREAM-Canary, FFmpeg, FFprobe, den
konfigurierten STT-Provider und Schreib-/Loeschzugriff im isolierten
Arbeitsverzeichnis. Der STT-Schritt erzeugt einen kurzen synthetischen
Audio-Canary und ruft damit den echten festen OpenAI-Endpunkt auf. Er ist ein
explizites Go-live-Gate und darf weder offline ersetzt noch mit `--help`
uebersprungen werden. Script und Credential werden absichtlich nicht in den
oeffentlichen App- oder Dispatcher-Container aufgenommen.

Fehlerausgaben des Release-Preflights enthalten nur den stabilen Code
`media_processing_preflight_failed` und eine feste Stage. Rohes `stderr` von
FFmpeg, FFprobe oder STT sowie Providerfehlermeldungen werden niemals in die
Release-Ausgabe uebernommen. Der gesamte Containerlauf ist im Deploypfad auf
1800 Sekunden begrenzt.

Der reine Scannervertrag kann ohne S3-, Datenbank- oder Job-Secrets separat
ausgefuehrt werden:

```bash
npm run -- media:clamav:preflight -- --confirm-host "clamav" --json
```

Routing-Readiness und tiefe Provider-Abnahme sind getrennt; siehe
[DEEP_READINESS.md](./DEEP_READINESS.md).

## Player und Profile

Audio- und Videobloecke koennen Medien direkt im Kurseditor aufnehmen. Der
Audioblock fordert ausschliesslich das Mikrofon an; der Videoblock bietet
Kamera plus Mikrofon oder Bildschirmfreigabe mit optional angefragtem
Systemaudio. Der Browser-Recorder prueft sicheren Kontext, MediaRecorder,
MediaDevices und einen tatsaechlich unterstuetzten MIME-Typ, bevor er eine
Berechtigung anfragt. Anfrage, Aufnahme, Stop, Fehler und Vorschau sind
sichtbare Zustaende. Dauer und Groesse sind auf zehn Minuten und 250 MiB
begrenzt. Vorschauen verwenden nur kurzlebige Object-URLs; Verwerfen,
Moduswechsel, Navigation und Unmount stoppen alle Tracks, loeschen Chunks und
widerrufen die URL. Erst `Aufnahme verwenden` uebergibt eine `File` an den
bestehenden `course_content`-Upload-Intent. Nur das anschliessend gescannte
`ready`-Asset wird im Block gespeichert; Blob-, LocalStorage- oder
IndexedDB-Persistenz existiert nicht.

Videos speichern Schnittgrenzen nur als Metadaten; das Quellobjekt bleibt
unveraendert. Der Editor zeigt Trimfenster, Thumbnail-Marker,
Untertitelsegmente und Abspielposition gemeinsam auf einer visuellen Timeline.
Die Vorschau spielt nur den gewaehlten Ausschnitt; der Thumbnail-Job bindet den
gewaehlten Millisekunden-Zeitpunkt an seinen idempotenten Request-Key. Der
Player erzwingt Start/Ende, erlaubt wahlweise alle Spruenge,
nur bereits gesehene Bereiche oder keine manuellen Spruenge. Pflichtwiedergabe
wird zeitgebunden in `media_playback_progress` gespeichert und vor dem
Lektionsabschluss erneut gegen den publizierten Block, Asset-Digest und die
aktuelle Mindestdauer geprueft.

Custom Fields vom Typ `media` speichern nur eine Asset-UUID. Zulaessig sind
ausschliesslich tenantgleiche `ready`-Assets mit Purpose `profile` und
`owner_user_id` des Profilinhabers. Dieselbe Pruefung gilt fuer Eigenpflege,
Adminpflege, Datenprofile, eingebettete Formulare und REST-Schreibzugriffe.
Ungebundene Profilmedien laufen nach 24 Stunden durch den Media-Cleanup aus.
