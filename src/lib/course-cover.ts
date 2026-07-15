export const DEFAULT_COURSE_COVER =
  "/images/courses/foundations.webp" as const;

export const COURSE_COVER_PRESETS = [
  "/images/courses/foundations.webp",
  "/images/courses/workflows.webp",
  "/images/courses/prompts.webp",
  "/images/courses/responsible-ai.webp",
] as const;

export type CourseCoverPreset = (typeof COURSE_COVER_PRESETS)[number];

export function isCourseCoverPreset(value: unknown): value is CourseCoverPreset {
  return COURSE_COVER_PRESETS.some((preset) => preset === value);
}

export const MAX_COURSE_COVER_LENGTH = 2_000;

const PUBLIC_COURSE_COVER_PATH =
  /^\/images\/(?:[a-z0-9][a-z0-9._-]*\/)*[a-z0-9][a-z0-9._-]*\.(?:avif|gif|jpe?g|png|webp)$/i;
const COURSE_MEDIA_DOWNLOAD_PATH =
  /^\/api\/media-assets\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/download$/i;

/**
 * Course covers are deliberately local-only. Remote hosts must never become an
 * implicit image-proxy allowlist merely because their URL was persisted.
 */
export function safeCourseCoverSource(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const candidate = value.trim();
  if (!candidate || candidate.length > MAX_COURSE_COVER_LENGTH) return null;
  return PUBLIC_COURSE_COVER_PATH.test(candidate) ||
    COURSE_MEDIA_DOWNLOAD_PATH.test(candidate)
    ? candidate
    : null;
}

export function courseCoverMediaAssetId(value: unknown): string | null {
  const source = safeCourseCoverSource(value);
  return source?.match(COURSE_MEDIA_DOWNLOAD_PATH)?.[1]?.toLowerCase() ?? null;
}

export function courseCoverImageProps(value: unknown): {
  src: string;
  unoptimized: boolean;
} {
  const src = safeCourseCoverSource(value) ?? DEFAULT_COURSE_COVER;
  return {
    src,
    // The authenticated media route must be fetched by the browser so the
    // user's session cookie and the route's authorization checks are applied.
    unoptimized: courseCoverMediaAssetId(src) !== null,
  };
}
