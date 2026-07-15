export const VIDEO_VOLUME_STORAGE_KEY = "q-academy:video-volume:v1";

export type VideoVolumePreference = {
  version: 1;
  volume: number;
  muted: boolean;
};

export function parseVideoVolumePreference(
  value: string | null,
): VideoVolumePreference | null {
  if (!value || value.length > 200) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object") return null;
    const candidate = parsed as Record<string, unknown>;
    if (
      candidate.version !== 1 ||
      typeof candidate.volume !== "number" ||
      !Number.isFinite(candidate.volume) ||
      candidate.volume < 0 ||
      candidate.volume > 1 ||
      typeof candidate.muted !== "boolean"
    ) {
      return null;
    }
    return {
      version: 1,
      volume: candidate.volume,
      muted: candidate.muted,
    };
  } catch {
    return null;
  }
}

export function videoVolumePreference(
  media: Pick<HTMLMediaElement, "volume" | "muted">,
): VideoVolumePreference {
  return {
    version: 1,
    volume: Math.min(1, Math.max(0, media.volume)),
    muted: media.muted,
  };
}
