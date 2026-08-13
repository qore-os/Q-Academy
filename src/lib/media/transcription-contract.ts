export const OPENAI_TRANSCRIPTION_MODEL = "gpt-4o-transcribe-diarize" as const;
export const OPENAI_TRANSCRIPTION_RESPONSE_FORMAT = "diarized_json" as const;
export const OPENAI_TRANSCRIPTION_CHUNKING_STRATEGY = "auto" as const;
export const MAX_AUTOMATIC_TRANSCRIPTION_DURATION_MS =
  2 * 60 * 60 * 1_000;
export const OPENAI_TRANSCRIPTION_REQUEST_CONTRACT =
  "openai-diarized-transcription-v1" as const;
export const TRANSCRIPT_PROCESSING_PROVIDER =
  "configured-transcript-webvtt-v2" as const;
export const OPENAI_TRANSCRIPTION_RESULT_PROVIDER =
  "openai-gpt-4o-transcribe-diarize-v1" as const;
export const BUNDLED_OPENAI_TRANSCRIPT_EXECUTABLE =
  "/app/node_modules/.bin/tsx" as const;
export const BUNDLED_OPENAI_TRANSCRIPT_SCRIPT =
  "/app/scripts/openai-transcribe.ts" as const;
export const AUTOMATIC_TRANSCRIPTION_LANGUAGE_PATTERN = /^[a-z]{2}$/;

export function normalizeAutomaticTranscriptionLanguage(value: unknown) {
  return typeof value === "string" &&
    AUTOMATIC_TRANSCRIPTION_LANGUAGE_PATTERN.test(value)
    ? value
    : null;
}

export function normalizeLegacyAutomaticTranscriptionLanguage(value: unknown) {
  const current = normalizeAutomaticTranscriptionLanguage(value);
  if (current) return current;
  if (typeof value !== "string") return null;
  const legacyTag = /^([a-z]{2})(?:-[a-z0-9]{2,8})+$/i.exec(value);
  return legacyTag?.[1]?.toLowerCase() ?? null;
}

export function automaticTranscriptionDurationSupported(
  durationMilliseconds: number | null | undefined,
): durationMilliseconds is number {
  return (
    typeof durationMilliseconds === "number" &&
    Number.isSafeInteger(durationMilliseconds) &&
    durationMilliseconds > 0 &&
    durationMilliseconds <= MAX_AUTOMATIC_TRANSCRIPTION_DURATION_MS
  );
}

export function configuredTranscriptionProviderId(
  environment: Readonly<Record<string, string | undefined>>,
) {
  if (environment.MEDIA_TRANSCRIPTION_ENABLED?.trim() !== "true") {
    return "disabled-v1" as const;
  }
  if (environment.MEDIA_TRANSCRIPT_SIDECAR_DIRECTORY?.trim()) {
    return "deterministic-sidecar-v1" as const;
  }
  const executable = environment.MEDIA_TRANSCRIPT_COMMAND?.trim();
  if (!executable) return "unconfigured-v1" as const;
  let argumentsList: unknown;
  try {
    argumentsList = JSON.parse(
      environment.MEDIA_TRANSCRIPT_COMMAND_ARGS_JSON?.trim() ?? "[]",
    );
  } catch {
    return "unconfigured-v1" as const;
  }
  return executable === BUNDLED_OPENAI_TRANSCRIPT_EXECUTABLE &&
    Array.isArray(argumentsList) &&
    argumentsList[0] === BUNDLED_OPENAI_TRANSCRIPT_SCRIPT
    ? OPENAI_TRANSCRIPTION_RESULT_PROVIDER
    : ("local-command-v1" as const);
}
