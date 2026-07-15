# Medienverarbeitung

Stand: 2026-07-12.

## Lifecycle

Ein Upload wird weiterhin zuerst vollstaendig gestreamt, signatur- und
strukturgeprueft, mit SHA-256 gebunden und je nach Umgebung durch ClamAV
gescannt. Erst ein unveraenderliches `ready`-Asset darf einen
`media_processing_job` erhalten. Der Request-Key bindet Jobtyp, Optionen,
Asset-ID und Inhaltsdigest; identische Auftraege sind damit idempotent.

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
- `MEDIA_TRANSCRIPT_COMMAND` zeigt auf ein lokales STT-Programm. Es wird ohne
  Shell, mit geschlossenem stdin, begrenztem stderr und hartem
  10-Minuten-Timeout gestartet.
- `MEDIA_TRANSCRIPT_COMMAND_ARGS_JSON` ist optional ein JSON-Array. Die exakt
  ersetzten Argumente sind `{input}`, `{output}` und `{language}`. Der Default
  erwartet `--input`, `--output-vtt`, `--language` und `--temperature 0`.
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
FFmpeg und STT laufen ohne Shell, mit geschlossenem stdin und hartem Timeout.
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
Arbeitsverzeichnis. Der STT-Befehl wird absichtlich nicht in den
oeffentlichen App-Container aufgenommen; er muss im Runner-Image oder ueber
einen read-only Mount bereitgestellt werden.

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
