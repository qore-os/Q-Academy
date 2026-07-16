export type SubmissionRecordingMode = "audio" | "video" | "screen";

export const MAX_SUBMISSION_RECORDING_DURATION_MS = 10 * 60 * 1_000;
export const MAX_SUBMISSION_RECORDING_BYTES = 250 * 1024 * 1024;

const MIME_CANDIDATES = {
  audio: [
    "audio/webm;codecs=opus",
    "audio/ogg;codecs=opus",
    "audio/mp4;codecs=mp4a.40.2",
    "audio/webm",
    "audio/ogg",
    "audio/mp4",
  ],
  video: [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    "video/webm",
    "video/mp4",
  ],
  screen: [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    "video/webm",
    "video/mp4",
  ],
} as const satisfies Record<SubmissionRecordingMode, readonly string[]>;

const EXTENSIONS = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
  "video/webm": "webm",
  "video/mp4": "mp4",
} as const;

export function recordingMimeCandidates(mode: SubmissionRecordingMode) {
  return MIME_CANDIDATES[mode];
}

export function selectRecordingMimeType(
  mode: SubmissionRecordingMode,
  isTypeSupported: (mimeType: string) => boolean,
) {
  return (
    MIME_CANDIDATES[mode].find((mimeType) => {
      try {
        return isTypeSupported(mimeType);
      } catch {
        return false;
      }
    }) ?? null
  );
}

export function recordingBaseMimeType(mimeType: string) {
  const base = mimeType.split(";", 1)[0]?.trim().toLowerCase();
  return base && base in EXTENSIONS ? (base as keyof typeof EXTENSIONS) : null;
}

export function recordingFileName(
  mode: SubmissionRecordingMode,
  mimeType: string,
  recordedAt = new Date(),
) {
  const baseMimeType = recordingBaseMimeType(mimeType);
  if (!baseMimeType) return null;
  const expectedKind = mode === "audio" ? "audio/" : "video/";
  if (!baseMimeType.startsWith(expectedKind)) return null;
  const timestamp = recordedAt
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
  const modeLabel =
    mode === "audio" ? "audio" : mode === "video" ? "video" : "bildschirm";
  return {
    baseMimeType,
    fileName: `aufnahme-${modeLabel}-${timestamp}.${EXTENSIONS[baseMimeType]}`,
  };
}

export function recordedMediaValidationError(input: {
  sizeBytes: number;
  durationMs: number;
}) {
  if (!Number.isFinite(input.sizeBytes) || input.sizeBytes <= 0) {
    return "Die Aufnahme enthält keine verwertbaren Mediendaten.";
  }
  if (input.sizeBytes > MAX_SUBMISSION_RECORDING_BYTES) {
    return "Die Aufnahme ist größer als 250 MiB und wurde verworfen.";
  }
  if (
    !Number.isFinite(input.durationMs) ||
    input.durationMs <= 0 ||
    input.durationMs > MAX_SUBMISSION_RECORDING_DURATION_MS
  ) {
    return "Die Aufnahme darf höchstens 10 Minuten lang sein.";
  }
  return null;
}

export function formatRecordingTime(durationMs: number) {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1_000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function recordingCaptureErrorMessage(
  error: unknown,
  mode: SubmissionRecordingMode,
) {
  const name =
    typeof error === "object" && error !== null && "name" in error
      ? String(error.name)
      : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return mode === "screen"
      ? "Die Bildschirmfreigabe wurde nicht erlaubt. Prüfe die Browser-Berechtigung."
      : "Der Zugriff auf Kamera oder Mikrofon wurde nicht erlaubt. Prüfe die Browser-Berechtigung.";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return mode === "audio"
      ? "Es wurde kein verwendbares Mikrofon gefunden."
      : "Die benötigte Kamera oder Audioquelle wurde nicht gefunden.";
  }
  if (name === "NotReadableError" || name === "TrackStartError") {
    return "Das Aufnahmegerät ist belegt oder konnte nicht gestartet werden.";
  }
  if (
    name === "OverconstrainedError" ||
    name === "ConstraintNotSatisfiedError"
  ) {
    return "Das Aufnahmegerät unterstützt die angeforderte Qualität nicht.";
  }
  if (name === "AbortError") {
    return mode === "screen"
      ? "Die Bildschirmfreigabe wurde abgebrochen."
      : "Die Aufnahmefreigabe wurde abgebrochen.";
  }
  if (name === "InvalidStateError") {
    return "Die Aufnahme kann in diesem Browserzustand nicht gestartet werden.";
  }
  return "Die Aufnahme konnte nicht gestartet werden. Prüfe Browser und Berechtigungen.";
}
