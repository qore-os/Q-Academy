import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { constants, createReadStream } from "node:fs";
import {
  copyFile,
  link,
  mkdir,
  open,
  stat,
  unlink,
} from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";

import {
  FILESYSTEM_MEDIA_ROOT,
  type FilesystemMediaStorageConfiguration,
} from "@/lib/media/storage-configuration";
import {
  isValidMediaObjectIdentity,
  type MediaObjectIdentity,
} from "@/lib/media/storage-key";

export class FilesystemMediaStorageError extends Error {
  readonly code:
    | "invalid_storage_key"
    | "invalid_upload_size"
    | "object_exists"
    | "object_mismatch"
    | "object_missing"
    | "storage_unavailable";

  constructor(
    code: FilesystemMediaStorageError["code"],
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "FilesystemMediaStorageError";
    this.code = code;
  }
}

export function resolveFilesystemMediaObjectPath(
  configuration: FilesystemMediaStorageConfiguration,
  identity: MediaObjectIdentity,
) {
  if (!isValidMediaObjectIdentity(identity)) {
    throw new FilesystemMediaStorageError(
      "invalid_storage_key",
      "The media object identity is invalid.",
    );
  }
  const normalizedRoot = configuration.rootDirectory.replace(/\\/g, "/");
  const rootSegments = normalizedRoot.split("/");
  if (
    (normalizedRoot !== FILESYSTEM_MEDIA_ROOT &&
      !normalizedRoot.startsWith(`${FILESYSTEM_MEDIA_ROOT}/`)) ||
    rootSegments.some(
      (segment) => segment === "" || segment === "." || segment === "..",
    )
  ) {
    throw new FilesystemMediaStorageError(
      "invalid_storage_key",
      "The media storage root is invalid.",
    );
  }
  const mediaRoot = resolve(process.cwd(), ".data", "media");
  const rootSuffix = normalizedRoot.slice(FILESYSTEM_MEDIA_ROOT.length + 1);
  const root = rootSuffix
    ? `${mediaRoot}${sep}${rootSuffix.replaceAll("/", sep)}`
    : mediaRoot;
  const target = `${root}${sep}${identity.key.replaceAll("/", sep)}`;
  if (!target.startsWith(`${root}${sep}`)) {
    throw new FilesystemMediaStorageError(
      "invalid_storage_key",
      "The media object identity is invalid.",
    );
  }
  return target;
}

function safeFilesystemFailure(error: unknown): never {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "ENOENT"
  ) {
    throw new FilesystemMediaStorageError(
      "object_missing",
      "The media object is missing.",
    );
  }
  throw new FilesystemMediaStorageError(
    "storage_unavailable",
    "The media storage service is unavailable.",
    error instanceof Error ? { cause: error } : undefined,
  );
}

export async function writeFilesystemMediaObject(
  configuration: FilesystemMediaStorageConfiguration,
  identity: MediaObjectIdentity,
  body: AsyncIterable<Uint8Array>,
  expectedSizeBytes: number,
) {
  if (
    !Number.isSafeInteger(expectedSizeBytes) ||
    expectedSizeBytes <= 0 ||
    expectedSizeBytes > configuration.limits.maxUploadBytes
  ) {
    throw new FilesystemMediaStorageError(
      "invalid_upload_size",
      "The media upload size is invalid.",
    );
  }

  const target = resolveFilesystemMediaObjectPath(configuration, identity);
  const temporary = `${target}.upload-${randomUUID()}`;
  await mkdir(dirname(target), { recursive: true });
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  let received = 0;
  try {
    handle = await open(temporary, "wx", 0o600);
    for await (const sourceChunk of body) {
      const chunk = Buffer.from(sourceChunk);
      received += chunk.byteLength;
      if (received > expectedSizeBytes) {
        throw new FilesystemMediaStorageError(
          "invalid_upload_size",
          "The uploaded media size exceeds its declared size.",
        );
      }
      let offset = 0;
      while (offset < chunk.byteLength) {
        const { bytesWritten } = await handle.write(
          chunk,
          offset,
          chunk.byteLength - offset,
        );
        if (bytesWritten <= 0) {
          throw new FilesystemMediaStorageError(
            "storage_unavailable",
            "The media storage service is unavailable.",
          );
        }
        offset += bytesWritten;
      }
    }
    if (received !== expectedSizeBytes) {
      throw new FilesystemMediaStorageError(
        "invalid_upload_size",
        "The uploaded media size does not match its declared size.",
      );
    }
    await handle.sync();
    await handle.close();
    handle = null;
    try {
      await link(temporary, target);
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "EEXIST"
      ) {
        throw new FilesystemMediaStorageError(
          "object_exists",
          "The media object was already uploaded.",
        );
      }
      throw error;
    }
    await unlink(temporary);
    return { sizeBytes: received };
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await unlink(temporary).catch(() => undefined);
    if (error instanceof FilesystemMediaStorageError) throw error;
    safeFilesystemFailure(error);
  }
}

export async function inspectFilesystemMediaObject(
  configuration: FilesystemMediaStorageConfiguration,
  identity: MediaObjectIdentity,
) {
  try {
    const details = await stat(resolveFilesystemMediaObjectPath(configuration, identity));
    if (!details.isFile() || details.size <= 0) {
      throw new FilesystemMediaStorageError(
        "object_missing",
        "The media object is missing.",
      );
    }
    return { sizeBytes: details.size, lastModified: details.mtime };
  } catch (error) {
    if (error instanceof FilesystemMediaStorageError) throw error;
    safeFilesystemFailure(error);
  }
}

export function readFilesystemMediaObject(
  configuration: FilesystemMediaStorageConfiguration,
  identity: MediaObjectIdentity,
  range?: Readonly<{ start: number; end: number }>,
) {
  return createReadStream(resolveFilesystemMediaObjectPath(configuration, identity), range);
}

export async function promoteFilesystemMediaObject(
  configuration: FilesystemMediaStorageConfiguration,
  input: {
    source: MediaObjectIdentity;
    target: MediaObjectIdentity;
    expectedSha256: string;
    signal?: AbortSignal;
  },
) {
  input.signal?.throwIfAborted();
  const source = resolveFilesystemMediaObjectPath(configuration, input.source);
  const target = resolveFilesystemMediaObjectPath(configuration, input.target);
  if (
    input.source.organizationId !== input.target.organizationId ||
    input.source.assetId !== input.target.assetId ||
    source === target
  ) {
    throw new FilesystemMediaStorageError(
      "invalid_storage_key",
      "The media promotion identity is invalid.",
    );
  }

  const sha256 = async (path: string) => {
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(path)) {
      input.signal?.throwIfAborted();
      hash.update(chunk);
    }
    return hash.digest("hex");
  };

  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.promotion-${randomUUID()}`;
  try {
    await copyFile(source, temporary, constants.COPYFILE_EXCL);
    input.signal?.throwIfAborted();
    const temporaryHandle = await open(temporary, "r+");
    await temporaryHandle.sync();
    await temporaryHandle.close();
    const promotedHash = await sha256(temporary);
    input.signal?.throwIfAborted();
    if (promotedHash !== input.expectedSha256) {
      throw new FilesystemMediaStorageError(
        "storage_unavailable",
        "The promoted media object failed its integrity check.",
      );
    }
    try {
      await link(temporary, target);
      input.signal?.throwIfAborted();
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "EEXIST"
      ) {
        const existingHash = await sha256(target).catch(() => null);
        if (existingHash === input.expectedSha256) {
          const existing = await stat(target);
          return { sizeBytes: existing.size, stagingDeleted: false };
        }
        throw new FilesystemMediaStorageError(
          "object_mismatch",
          "The final media object conflicts with this scan result.",
        );
      } else {
        throw error;
      }
    }
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    if (error instanceof FilesystemMediaStorageError) throw error;
    safeFilesystemFailure(error);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
  const promoted = await stat(target);
  return { sizeBytes: promoted.size, stagingDeleted: false };
}

export async function copyFilesystemMediaObject(
  configuration: FilesystemMediaStorageConfiguration,
  input: {
    source: MediaObjectIdentity;
    target: MediaObjectIdentity;
    expectedSha256: string;
    expectedSizeBytes: number;
    signal?: AbortSignal;
  },
) {
  input.signal?.throwIfAborted();
  const source = resolveFilesystemMediaObjectPath(configuration, input.source);
  const target = resolveFilesystemMediaObjectPath(configuration, input.target);
  if (
    input.source.organizationId === input.target.organizationId ||
    input.source.assetId === input.target.assetId ||
    source === target ||
    !/^[0-9a-f]{64}$/.test(input.expectedSha256) ||
    !Number.isSafeInteger(input.expectedSizeBytes) ||
    input.expectedSizeBytes <= 0
  ) {
    throw new FilesystemMediaStorageError(
      "invalid_storage_key",
      "The cross-tenant media copy identity is invalid.",
    );
  }

  const digest = async (filePath: string) => {
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(filePath)) {
      input.signal?.throwIfAborted();
      hash.update(chunk);
    }
    return hash.digest("hex");
  };

  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.orbit-copy-${randomUUID()}`;
  try {
    const sourceDetails = await stat(source);
    if (!sourceDetails.isFile() || sourceDetails.size !== input.expectedSizeBytes) {
      throw new FilesystemMediaStorageError(
        "object_mismatch",
        "The source media object does not match its recorded size.",
      );
    }
    await copyFile(source, temporary, constants.COPYFILE_EXCL);
    input.signal?.throwIfAborted();
    const temporaryHandle = await open(temporary, "r+");
    await temporaryHandle.sync();
    await temporaryHandle.close();
    if ((await digest(temporary)) !== input.expectedSha256) {
      throw new FilesystemMediaStorageError(
        "object_mismatch",
        "The copied media object failed its integrity check.",
      );
    }
    try {
      input.signal?.throwIfAborted();
      await link(temporary, target);
      input.signal?.throwIfAborted();
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "EEXIST" &&
        (await digest(target).catch(() => null)) === input.expectedSha256
      ) {
        return { sizeBytes: input.expectedSizeBytes };
      }
      throw error;
    }
    return { sizeBytes: input.expectedSizeBytes };
  } catch (error) {
    if (error instanceof FilesystemMediaStorageError) throw error;
    safeFilesystemFailure(error);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

export async function deleteFilesystemMediaObject(
  configuration: FilesystemMediaStorageConfiguration,
  identity: MediaObjectIdentity,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  try {
    await unlink(resolveFilesystemMediaObjectPath(configuration, identity));
    signal?.throwIfAborted();
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return;
    }
    safeFilesystemFailure(error);
  }
}
