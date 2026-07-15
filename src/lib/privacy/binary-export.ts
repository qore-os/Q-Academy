import "server-only";

import { createHash } from "node:crypto";
import type { Sql } from "postgres";
import { mediaAssetIdentity } from "@/lib/media/asset-service";
import { getStoredMediaObjectForScanning } from "@/lib/media/storage";
import { getMediaStorageConfiguration } from "@/lib/server-environment";
import { stringifyBoundedJson } from "@/lib/privacy/bounded-json";
import { createStoredZip, type StoredZipEntry } from "@/lib/privacy/stored-zip";
import {
  MAX_PRIVACY_EXPORT_MEDIA_BYTES,
  MAX_PRIVACY_EXPORT_MEDIA_ROWS,
  MAX_PRIVACY_EXPORT_STRUCTURED_JSON_BYTES,
} from "@/lib/privacy/export-limits";

type BoundMediaRow = {
  id: string;
  organizationId: string;
  purpose: "course_content" | "submission" | "community" | "avatar" | "branding";
  kind: "image" | "audio" | "video" | "document";
  status: "pending" | "uploaded" | "scanning" | "ready" | "quarantined" | "failed" | "deleted";
  storageDriver: "filesystem" | "s3";
  storageKey: string;
  stagingStorageKey: string;
  safeFileName: string;
  declaredMimeType: string;
  detectedMimeType: string | null;
  declaredSizeBytes: number | string;
  actualSizeBytes: number | string | null;
  etag: string | null;
  storageVersionId: string | null;
  contentSha256: string | null;
  deletedAt: Date | null;
  createdAt: Date | string;
  relationships: string[];
};

export type PrivacyMediaSnapshot = Readonly<{
  id: string;
  status: "ready";
  storageDriver: "filesystem" | "s3";
  storageVersionId: string | null;
  etag: string | null;
  contentSha256: string;
  sizeBytes: number;
}>;

export type PrivacyBinaryManifest = Readonly<{
  schemaVersion: 1;
  generatedAt: string;
  requestId: string;
  organizationId: string;
  subjectReference: string;
  structuredData: {
    path: "data.json";
    sha256: string;
    sizeBytes: number;
  };
  media: ReadonlyArray<{
    assetId: string;
    path: string | null;
    included: boolean;
    unavailableReason: string | null;
    purpose: BoundMediaRow["purpose"];
    kind: BoundMediaRow["kind"];
    relationships: string[];
    mimeType: string;
    sizeBytes: number | null;
    sha256: string | null;
  }>;
}>;

function sha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

function safeInteger(value: number | string | null) {
  if (value === null) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function archiveName(asset: Pick<BoundMediaRow, "id" | "safeFileName">) {
  const normalized = asset.safeFileName
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "")
    .slice(-100);
  return `media/${asset.id}/${normalized || "file.bin"}`;
}

function mediaModifiedAt(value: Date | string) {
  const timestamp =
    value instanceof Date
      ? Date.prototype.getTime.call(value)
      : typeof value === "string"
        ? Date.parse(value)
        : Number.NaN;
  if (!Number.isFinite(timestamp)) {
    throw new TypeError("The DSAR media creation timestamp is invalid.");
  }
  return new Date(timestamp);
}

async function readVerifiedAsset(asset: BoundMediaRow, expectedSize: number) {
  const stored = await getStoredMediaObjectForScanning(
    mediaAssetIdentity(asset, "ready"),
    asset.etag,
    asset.storageVersionId,
  );
  if (stored.sizeBytes !== expectedSize) {
    throw new Error(`Media asset ${asset.id} changed size during DSAR export.`);
  }
  if (
    !Number.isSafeInteger(expectedSize) ||
    expectedSize <= 0 ||
    expectedSize > MAX_PRIVACY_EXPORT_MEDIA_BYTES
  ) {
    throw new Error(`Media asset ${asset.id} exceeds its verified size.`);
  }
  const output = Buffer.allocUnsafe(expectedSize);
  let received = 0;
  const hash = createHash("sha256");
  for await (const source of stored.body) {
    const chunk = Buffer.from(
      source.buffer,
      source.byteOffset,
      source.byteLength,
    );
    if (
      chunk.byteLength > expectedSize - received ||
      chunk.byteLength > MAX_PRIVACY_EXPORT_MEDIA_BYTES - received
    ) {
      throw new Error(`Media asset ${asset.id} exceeds its verified size.`);
    }
    chunk.copy(output, received);
    received += chunk.byteLength;
    hash.update(chunk);
  }
  if (received !== expectedSize || hash.digest("hex") !== asset.contentSha256) {
    throw new Error(`Media asset ${asset.id} failed the DSAR integrity check.`);
  }
  return output;
}

async function subjectMedia(
  sql: Sql,
  input: { organizationId: string; subjectUserId: string; snapshotAt: Date },
) {
  let snapshotAtIso: string;
  try {
    snapshotAtIso = Date.prototype.toISOString.call(input.snapshotAt);
  } catch {
    throw new TypeError("The DSAR media snapshot timestamp is invalid.");
  }
  return sql<BoundMediaRow[]>`
    with bindings as (
      select m.id as media_asset_id, 'owner'::text as relationship
      from media_assets m
      where m.organization_id = ${input.organizationId}
        and m.owner_user_id = ${input.subjectUserId}
      union all
      select m.id, 'uploader'::text
      from media_assets m
      where m.organization_id = ${input.organizationId}
        and m.uploaded_by_id = ${input.subjectUserId}
      union all
      select attachment.media_asset_id, 'submission_attachment'::text
      from submission_attachments attachment
      join submissions submission
        on submission.id = attachment.submission_id
       and submission.organization_id = attachment.organization_id
      where attachment.organization_id = ${input.organizationId}
        and submission.user_id = ${input.subjectUserId}
        and attachment.created_at <= ${snapshotAtIso}::timestamptz
      union all
      select attachment.media_asset_id, 'community_post_attachment'::text
      from community_post_attachments attachment
      join posts post
        on post.id = attachment.post_id
       and post.organization_id = attachment.organization_id
      where attachment.organization_id = ${input.organizationId}
        and post.author_id = ${input.subjectUserId}
        and attachment.created_at <= ${snapshotAtIso}::timestamptz
      union all
      select attachment.media_asset_id, 'community_comment_attachment'::text
      from community_comment_attachments attachment
      join comments comment
        on comment.id = attachment.comment_id
       and comment.post_id = attachment.post_id
       and comment.organization_id = attachment.organization_id
      where attachment.organization_id = ${input.organizationId}
        and comment.author_id = ${input.subjectUserId}
        and attachment.created_at <= ${snapshotAtIso}::timestamptz
    ), grouped as (
      select media_asset_id,
             array_agg(distinct relationship order by relationship) as relationships
      from bindings
      group by media_asset_id
    )
    select m.id, m.organization_id as "organizationId", m.purpose, m.kind,
           m.status, m.storage_driver as "storageDriver",
           m.storage_key as "storageKey",
           m.staging_storage_key as "stagingStorageKey",
           m.safe_file_name as "safeFileName",
           m.declared_mime_type as "declaredMimeType",
           m.detected_mime_type as "detectedMimeType",
           m.declared_size_bytes as "declaredSizeBytes",
           m.actual_size_bytes as "actualSizeBytes", m.etag,
           m.storage_version_id as "storageVersionId",
           m.content_sha256 as "contentSha256",
           m.deleted_at as "deletedAt", m.created_at as "createdAt",
           grouped.relationships
    from grouped
    join media_assets m
      on m.id = grouped.media_asset_id
     and m.organization_id = ${input.organizationId}
    where m.created_at <= ${snapshotAtIso}::timestamptz
    order by m.created_at, m.id
    limit ${MAX_PRIVACY_EXPORT_MEDIA_ROWS + 1}
  `;
}

export async function buildPrivacyBinaryExport(input: {
  sql: Sql;
  organizationId: string;
  requestId: string;
  subjectUserId: string;
  subjectReference: string;
  snapshotAt: Date;
  structuredPayload: unknown;
}) {
  const structured = stringifyBoundedJson(input.structuredPayload, {
    maxBytes: MAX_PRIVACY_EXPORT_STRUCTURED_JSON_BYTES,
    space: 2,
    trailingNewline: true,
  });
  const dataBytes = Buffer.from(structured.json, "utf8");
  const assets = await subjectMedia(input.sql, input);
  if (assets.length > MAX_PRIVACY_EXPORT_MEDIA_ROWS) {
    throw new Error("The DSAR media row count exceeds the supported limit.");
  }
  const configuredDriver = getMediaStorageConfiguration().driver;
  const entries: StoredZipEntry[] = [
    { path: "data.json", bytes: dataBytes, modifiedAt: input.snapshotAt },
  ];
  const media: Array<PrivacyBinaryManifest["media"][number]> = [];
  const snapshots: PrivacyMediaSnapshot[] = [];
  let totalMediaBytes = 0;

  for (const asset of assets) {
    const mimeType = asset.detectedMimeType ?? asset.declaredMimeType;
    if (asset.status !== "ready" || asset.deletedAt) {
      media.push({
        assetId: asset.id,
        path: null,
        included: false,
        unavailableReason: `asset_${asset.status}`,
        purpose: asset.purpose,
        kind: asset.kind,
        relationships: asset.relationships,
        mimeType,
        sizeBytes: safeInteger(asset.actualSizeBytes ?? asset.declaredSizeBytes),
        sha256: null,
      });
      continue;
    }
    const sizeBytes = safeInteger(asset.actualSizeBytes);
    if (
      !sizeBytes ||
      !asset.contentSha256 ||
      !/^[0-9a-f]{64}$/.test(asset.contentSha256) ||
      asset.storageDriver !== configuredDriver
    ) {
      throw new Error(`Media asset ${asset.id} has no complete immutable identity.`);
    }
    totalMediaBytes += sizeBytes;
    if (totalMediaBytes > MAX_PRIVACY_EXPORT_MEDIA_BYTES) {
      throw new Error("The bound DSAR media exceeds the supported package size.");
    }
    const bytes = await readVerifiedAsset(asset, sizeBytes);
    const path = archiveName(asset);
    entries.push({ path, bytes, modifiedAt: mediaModifiedAt(asset.createdAt) });
    media.push({
      assetId: asset.id,
      path,
      included: true,
      unavailableReason: null,
      purpose: asset.purpose,
      kind: asset.kind,
      relationships: asset.relationships,
      mimeType,
      sizeBytes,
      sha256: asset.contentSha256,
    });
    snapshots.push({
      id: asset.id,
      status: "ready",
      storageDriver: asset.storageDriver,
      storageVersionId: asset.storageVersionId,
      etag: asset.etag,
      contentSha256: asset.contentSha256,
      sizeBytes,
    });
  }

  const manifest: PrivacyBinaryManifest = {
    schemaVersion: 1,
    generatedAt: input.snapshotAt.toISOString(),
    requestId: input.requestId,
    organizationId: input.organizationId,
    subjectReference: input.subjectReference,
    structuredData: {
      path: "data.json",
      sha256: sha256(dataBytes),
      sizeBytes: dataBytes.byteLength,
    },
    media,
  };
  const serializedManifest = stringifyBoundedJson(manifest, {
    maxBytes: MAX_PRIVACY_EXPORT_STRUCTURED_JSON_BYTES,
    space: 2,
    trailingNewline: true,
  });
  entries.push({
    path: "manifest.json",
    bytes: Buffer.from(serializedManifest.json, "utf8"),
    modifiedAt: input.snapshotAt,
  });
  return { bytes: createStoredZip(entries), manifest, snapshots };
}
