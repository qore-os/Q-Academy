import { lstat, open } from "node:fs/promises";
import { resolve } from "node:path";

const DAILY_SIGNATURE_FILES = ["daily.cvd", "daily.cld"] as const;
const CLAMAV_DATABASE_HEADER_BYTES = 512;
export const DEFAULT_CLAMAV_SIGNATURE_MAX_AGE_SECONDS = 36 * 60 * 60;

export type ClamAvSignatureStatus = Readonly<{
  timestampSeconds: number;
  ageSeconds: number;
  current: boolean;
}>;

function unavailable(nowSeconds: number): ClamAvSignatureStatus {
  return {
    timestampSeconds: 0,
    ageSeconds: nowSeconds,
    current: false,
  };
}

function readDatabaseTimestamp(header: Buffer): number | null {
  if (header.byteLength !== CLAMAV_DATABASE_HEADER_BYTES) return null;

  const fields = header.toString("latin1").split(":");
  if (fields.length !== 9 || fields[0] !== "ClamAV-VDB") return null;
  if (!fields[1]) return null;
  for (const field of fields.slice(2, 5)) {
    if (!/^\d+$/.test(field)) return null;
  }

  const timestampText = fields[8]?.trim() ?? "";
  if (!/^\d+$/.test(timestampText)) return null;
  const timestamp = Number(timestampText);
  return Number.isSafeInteger(timestamp) && timestamp > 0 ? timestamp : null;
}

async function readTimestampFromRegularDatabase(path: string) {
  const metadata = await lstat(path, { bigint: true });
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.size < BigInt(CLAMAV_DATABASE_HEADER_BYTES)
  ) {
    return null;
  }

  const handle = await open(path, "r");
  try {
    const openedMetadata = await handle.stat({ bigint: true });
    if (
      !openedMetadata.isFile() ||
      (process.platform !== "win32" && openedMetadata.dev !== metadata.dev) ||
      openedMetadata.ino !== metadata.ino ||
      openedMetadata.size !== metadata.size ||
      openedMetadata.mtimeNs !== metadata.mtimeNs
    ) {
      return null;
    }

    const header = Buffer.alloc(CLAMAV_DATABASE_HEADER_BYTES);
    const { bytesRead } = await handle.read(
      header,
      0,
      CLAMAV_DATABASE_HEADER_BYTES,
      0,
    );
    if (bytesRead !== CLAMAV_DATABASE_HEADER_BYTES) return null;

    const finalMetadata = await handle.stat({ bigint: true });
    if (
      (process.platform !== "win32" &&
        finalMetadata.dev !== openedMetadata.dev) ||
      finalMetadata.ino !== openedMetadata.ino ||
      finalMetadata.size !== openedMetadata.size ||
      finalMetadata.mtimeNs !== openedMetadata.mtimeNs
    ) {
      return null;
    }
    return readDatabaseTimestamp(header);
  } finally {
    await handle.close();
  }
}

export async function readClamAvSignatureStatus(input: {
  directory: string;
  maxAgeSeconds: number;
  now?: Date;
}): Promise<ClamAvSignatureStatus> {
  const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1_000);
  if (
    !input.directory ||
    !Number.isSafeInteger(input.maxAgeSeconds) ||
    input.maxAgeSeconds < 3_600 ||
    input.maxAgeSeconds > 604_800 ||
    !Number.isSafeInteger(nowSeconds) ||
    nowSeconds < 1
  ) {
    return unavailable(Math.max(0, nowSeconds));
  }

  let timestampSeconds = 0;
  for (const fileName of DAILY_SIGNATURE_FILES) {
    try {
      const candidate = await readTimestampFromRegularDatabase(
        resolve(input.directory, fileName),
      );
      if (candidate === null) return unavailable(nowSeconds);
      if (Number.isSafeInteger(candidate) && candidate > timestampSeconds) {
        timestampSeconds = candidate;
      }
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        continue;
      }
      return unavailable(nowSeconds);
    }
  }

  if (!timestampSeconds || timestampSeconds > nowSeconds + 300) {
    return unavailable(nowSeconds);
  }
  const ageSeconds = Math.max(0, nowSeconds - timestampSeconds);
  return {
    timestampSeconds,
    ageSeconds,
    current: ageSeconds <= input.maxAgeSeconds,
  };
}

export async function readClamAvSignatureStatusFromEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
  now = new Date(),
) {
  const directory = environment.MEDIA_CLAMAV_SIGNATURE_DIRECTORY?.trim() ?? "";
  const configuredAge = environment.CLAMAV_SIGNATURE_MAX_AGE_SECONDS?.trim();
  const maxAgeSeconds = configuredAge
    ? Number(configuredAge)
    : DEFAULT_CLAMAV_SIGNATURE_MAX_AGE_SECONDS;
  return readClamAvSignatureStatus({ directory, maxAgeSeconds, now });
}
