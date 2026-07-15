import { exactS3VersionDeletionTargets } from "./s3-object-integrity";

export const S3_VERSION_CLEANUP_MAX_PAGES = 100;
export const S3_VERSION_CLEANUP_MAX_TARGETS = 100_000;
export const S3_VERSION_CLEANUP_MAX_PAGE_ENTRIES = 1_000;
export const S3_VERSION_CLEANUP_VERIFICATION_PASSES = 3;

export type S3VersionCleanupCursor = Readonly<{
  keyMarker?: string;
  versionIdMarker?: string;
}>;

export type S3VersionCleanupPage = Readonly<{
  isTruncated: boolean;
  nextKeyMarker?: string;
  nextVersionIdMarker?: string;
  versions: ReadonlyArray<Readonly<{ Key?: string; VersionId?: string }>>;
  deleteMarkers: ReadonlyArray<
    Readonly<{ Key?: string; VersionId?: string }>
  >;
}>;

export class S3VersionCleanupError extends Error {
  readonly code:
    | "cursor_cycle"
    | "history_limit"
    | "invalid_page"
    | "verification_failed";

  constructor(code: S3VersionCleanupError["code"], message: string) {
    super(message);
    this.name = "S3VersionCleanupError";
    this.code = code;
  }
}

function cursorIdentity(cursor: S3VersionCleanupCursor) {
  return `${cursor.keyMarker ?? ""}\0${cursor.versionIdMarker ?? ""}`;
}

function exactPageTargets(key: string, page: S3VersionCleanupPage) {
  const entries = [...page.versions, ...page.deleteMarkers];
  if (entries.length > S3_VERSION_CLEANUP_MAX_PAGE_ENTRIES) {
    throw new S3VersionCleanupError(
      "invalid_page",
      "The S3 version-listing page exceeds the provider page limit.",
    );
  }
  if (
    entries.some(
      (entry) => entry.Key === key && (!entry.VersionId || !entry.Key),
    )
  ) {
    throw new S3VersionCleanupError(
      "invalid_page",
      "The S3 provider returned an exact-key entry without a VersionId.",
    );
  }
  return exactS3VersionDeletionTargets(
    key,
    page.versions,
    page.deleteMarkers,
  );
}

export async function deleteS3ObjectVersionsPagewise(input: {
  key: string;
  listPage(cursor: S3VersionCleanupCursor): Promise<S3VersionCleanupPage>;
  deletePage(
    targets: ReadonlyArray<Readonly<{ Key: string; VersionId: string }>>,
  ): Promise<void>;
  maxPages?: number;
  maxTargets?: number;
  verificationPasses?: number;
}) {
  const maxPages = input.maxPages ?? S3_VERSION_CLEANUP_MAX_PAGES;
  const maxTargets = input.maxTargets ?? S3_VERSION_CLEANUP_MAX_TARGETS;
  const verificationPasses =
    input.verificationPasses ?? S3_VERSION_CLEANUP_VERIFICATION_PASSES;
  if (
    !Number.isSafeInteger(maxPages) ||
    maxPages < 1 ||
    !Number.isSafeInteger(maxTargets) ||
    maxTargets < 1 ||
    !Number.isSafeInteger(verificationPasses) ||
    verificationPasses < 1
  ) {
    throw new TypeError("The S3 version-cleanup limits are invalid.");
  }

  let listedPages = 0;
  let deletedTargets = 0;
  for (let pass = 0; pass < verificationPasses; pass += 1) {
    let cursor: S3VersionCleanupCursor = {};
    const seenCursors = new Set<string>();
    const seenTargets = new Set<string>();
    let foundTargets = 0;
    while (true) {
      if (listedPages >= maxPages) {
        throw new S3VersionCleanupError(
          "history_limit",
          "The S3 version history exceeds the per-operation page limit.",
        );
      }
      const currentCursor = cursorIdentity(cursor);
      if (seenCursors.has(currentCursor)) {
        throw new S3VersionCleanupError(
          "cursor_cycle",
          "The S3 provider repeated a version-listing cursor.",
        );
      }
      seenCursors.add(currentCursor);
      listedPages += 1;
      const page = await input.listPage(cursor);
      const targets = exactPageTargets(input.key, page);

      let nextCursor: S3VersionCleanupCursor | null = null;
      if (page.isTruncated) {
        if (!page.nextKeyMarker) {
          throw new S3VersionCleanupError(
            "invalid_page",
            "The S3 provider omitted a required version-listing cursor.",
          );
        }
        nextCursor = {
          keyMarker: page.nextKeyMarker,
          versionIdMarker: page.nextVersionIdMarker,
        };
        if (seenCursors.has(cursorIdentity(nextCursor))) {
          throw new S3VersionCleanupError(
            "cursor_cycle",
            "The S3 provider returned a cyclic version-listing cursor.",
          );
        }
      }

      for (const target of targets) {
        const identity = `${target.Key}\0${target.VersionId}`;
        if (seenTargets.has(identity)) {
          throw new S3VersionCleanupError(
            "invalid_page",
            "The S3 provider repeated an object version within one listing pass.",
          );
        }
        seenTargets.add(identity);
      }
      if (deletedTargets + targets.length > maxTargets) {
        throw new S3VersionCleanupError(
          "history_limit",
          "The S3 version history exceeds the per-operation target limit.",
        );
      }
      if (targets.length) {
        await input.deletePage(targets);
        foundTargets += targets.length;
        deletedTargets += targets.length;
      }
      if (!nextCursor) break;
      cursor = nextCursor;
    }
    if (foundTargets === 0) {
      return { listedPages, deletedTargets, verificationPasses: pass + 1 };
    }
  }
  throw new S3VersionCleanupError(
    "verification_failed",
    "The S3 version deletion could not be verified.",
  );
}
