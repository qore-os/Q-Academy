import type { CourseVersionSnapshot } from "@/db/schema";

export const MAX_AVATAR_SOURCE_LENGTH = 2_000;

const PUBLIC_AVATAR_PATH =
  /^\/images\/(?:[a-z0-9][a-z0-9._-]*\/)*[a-z0-9][a-z0-9._-]*\.(?:avif|gif|jpe?g|png|webp)$/i;
const AVATAR_MEDIA_DOWNLOAD_PATH =
  /^\/api\/media-assets\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/download$/i;

/**
 * Avatar sources are local-only until private avatar uploads own the full flow.
 * This also keeps legacy remote values from becoming browser tracking pixels.
 */
export function safeAvatarSource(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const source = value.trim();
  if (!source || source.length > MAX_AVATAR_SOURCE_LENGTH) return null;
  return PUBLIC_AVATAR_PATH.test(source) ||
    AVATAR_MEDIA_DOWNLOAD_PATH.test(source)
    ? source
    : null;
}

export function avatarMediaAssetId(value: unknown): string | null {
  const source = safeAvatarSource(value);
  return source?.match(AVATAR_MEDIA_DOWNLOAD_PATH)?.[1]?.toLowerCase() ?? null;
}

export function sanitizeCourseSnapshotAvatarSources(
  snapshot: CourseVersionSnapshot,
): CourseVersionSnapshot {
  return {
    ...snapshot,
    authors: snapshot.authors?.map((entry) => ({
      ...entry,
      author: {
        ...entry.author,
        avatarUrl: safeAvatarSource(entry.author.avatarUrl),
      },
    })),
    widgets: snapshot.widgets?.map((entry) => ({
      ...entry,
      author: entry.author
        ? {
            ...entry.author,
            avatarUrl: safeAvatarSource(entry.author.avatarUrl),
          }
        : null,
    })),
  };
}
