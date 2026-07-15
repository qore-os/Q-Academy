import { createHash } from "node:crypto";

import type { OrbitTransferPreflight } from "@/db/schema";
import type { OrbitTransferAuthorMapping } from "@/lib/orbit/transfer-authors";

type SourceVersionState = {
  courseId: string;
  versionId: string;
  snapshot: unknown;
};

type MediaAssetState = {
  id: string;
  kind: string;
  status: string;
  storageDriver: string;
  storageKey: string;
  stagingStorageKey: string;
  actualSizeBytes: number | null;
  contentSha256: string | null;
  etag: string | null;
  stagingStorageVersionId: string | null;
  storageVersionId: string | null;
};

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!value || typeof value !== "object") return value;
  if (value instanceof Date) return value.toISOString();
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, canonicalValue(nested)]),
  );
}

function sha256(value: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(canonicalValue(value)))
    .digest("hex");
}

export function createOrbitTransferPreflightToken(input: {
  canonicalRequest: string;
  actorAccountId: string;
  targetOwnerId: string;
  preflight: OrbitTransferPreflight;
  sourceVersions: readonly SourceVersionState[];
  mediaAssets: readonly MediaAssetState[];
  authorState: {
    sourceAuthors: readonly {
      sourceUserId: string;
      email: string | null;
      role: string | null;
      status: string | null;
      courseIds: readonly string[];
      courseAuthorCourseIds: readonly string[];
    }[];
    targetAuthors: readonly {
      targetUserId: string;
      email: string;
      role: string;
      status: string;
    }[];
    authorMappings: readonly OrbitTransferAuthorMapping[];
  };
}) {
  return sha256({
    contract: "orbit-transfer-preflight:v2",
    canonicalRequest: input.canonicalRequest,
    actorAccountId: input.actorAccountId,
    targetOwnerId: input.targetOwnerId,
    preflight: {
      ...input.preflight,
      warnings: [...input.preflight.warnings].sort(),
      authorMappings: [...(input.preflight.authorMappings ?? [])].sort(
        (left, right) => left.sourceUserId.localeCompare(right.sourceUserId),
      ),
    },
    sourceVersions: input.sourceVersions
      .map((source) => ({
        courseId: source.courseId,
        versionId: source.versionId,
        snapshotSha256: sha256(source.snapshot),
      }))
      .sort((left, right) => left.courseId.localeCompare(right.courseId)),
    mediaAssets: [...input.mediaAssets].sort((left, right) =>
      left.id.localeCompare(right.id),
    ),
    authorState: {
      sourceAuthors: [...input.authorState.sourceAuthors].sort((left, right) =>
        left.sourceUserId.localeCompare(right.sourceUserId),
      ),
      targetAuthors: [...input.authorState.targetAuthors].sort((left, right) =>
        left.targetUserId.localeCompare(right.targetUserId),
      ),
      authorMappings: [...input.authorState.authorMappings].sort((left, right) =>
        left.sourceUserId.localeCompare(right.sourceUserId),
      ),
    },
  });
}
