export const VIDEO_PLAYBACK_RATE_STORAGE_KEY =
  "q-academy:video-playback-rate:v1";

export const VIDEO_PLAYBACK_RATES = [
  0.5,
  0.75,
  1,
  1.25,
  1.5,
  1.75,
  2,
] as const;

export type VideoPlaybackRate = (typeof VIDEO_PLAYBACK_RATES)[number];

export type VideoPlaybackRatePreference = {
  version: 1;
  rate: VideoPlaybackRate;
};

function supportedRate(value: unknown): value is VideoPlaybackRate {
  return (
    typeof value === "number" &&
    VIDEO_PLAYBACK_RATES.some((rate) => rate === value)
  );
}

export function parseVideoPlaybackRatePreference(
  value: string | null,
): VideoPlaybackRatePreference | null {
  if (!value || value.length > 100) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object") return null;
    const candidate = parsed as Record<string, unknown>;
    if (candidate.version !== 1 || !supportedRate(candidate.rate)) return null;
    return { version: 1, rate: candidate.rate };
  } catch {
    return null;
  }
}

export function videoPlaybackRatePreference(
  media: Pick<HTMLMediaElement, "playbackRate">,
): VideoPlaybackRatePreference {
  const rate = VIDEO_PLAYBACK_RATES.reduce((closest, candidate) =>
    Math.abs(candidate - media.playbackRate) <
    Math.abs(closest - media.playbackRate)
      ? candidate
      : closest,
  );
  return { version: 1, rate };
}
