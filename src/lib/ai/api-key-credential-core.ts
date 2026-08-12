import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  type Stats,
} from "node:fs";

const MAXIMUM_AI_API_KEY_FILE_BYTES = 16 * 1024;
const PRODUCTION_RUNTIME_UID = 1001;
const PRODUCTION_RUNTIME_GID = 1001;

export class AiApiKeyCredentialError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiApiKeyCredentialError";
  }
}

export type AiApiKeyCredentialEnvironment = Record<
  string,
  string | undefined
>;

type CredentialFileAccess = {
  open: (path: string) => number;
  lstat: (path: string) => Stats;
  fstat: (descriptor: number) => Stats;
  read: (descriptor: number, maximumBytes: number) => Buffer;
  close: (descriptor: number) => void;
};

const credentialFileAccess: CredentialFileAccess = {
  open: (path) =>
    openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)),
  lstat: lstatSync,
  fstat: fstatSync,
  read(descriptor, maximumBytes) {
    const buffer = Buffer.alloc(maximumBytes + 1);
    let bytesRead = 0;
    while (bytesRead < buffer.length) {
      const chunk = readSync(
        descriptor,
        buffer,
        bytesRead,
        buffer.length - bytesRead,
        bytesRead,
      );
      if (chunk === 0) break;
      bytesRead += chunk;
    }
    return buffer.subarray(0, bytesRead);
  },
  close: closeSync,
};

export function loadAiApiKey(
  environment: AiApiKeyCredentialEnvironment = process.env,
  fileAccess: CredentialFileAccess = credentialFileAccess,
): string | null {
  const file = environment.AI_API_KEY_FILE?.trim() ?? "";
  if (file) {
    let descriptor: number | null = null;
    try {
      const pathStat = fileAccess.lstat(file);
      if (!pathStat.isFile() || pathStat.isSymbolicLink()) {
        throw new AiApiKeyCredentialError(
          "AI_API_KEY_FILE must be a regular, non-symlink file.",
        );
      }
      descriptor = fileAccess.open(file);
      const stat = fileAccess.fstat(descriptor);
      if (
        !stat.isFile() ||
        stat.ino !== pathStat.ino ||
        (pathStat.dev !== 0 && stat.dev !== pathStat.dev)
      ) {
        throw new AiApiKeyCredentialError(
          "AI_API_KEY_FILE changed while it was opened.",
        );
      }
      if (stat.size > MAXIMUM_AI_API_KEY_FILE_BYTES) {
        throw new AiApiKeyCredentialError("AI_API_KEY_FILE is too large.");
      }
      if (environment.NODE_ENV === "production") {
        if (
          stat.uid !== PRODUCTION_RUNTIME_UID ||
          stat.gid !== PRODUCTION_RUNTIME_GID ||
          (stat.mode & 0o777) !== 0o400
        ) {
          throw new AiApiKeyCredentialError(
            "AI_API_KEY_FILE must be owned by 1001:1001 with mode 0400.",
          );
        }
      }
      const bytes = fileAccess.read(
        descriptor,
        MAXIMUM_AI_API_KEY_FILE_BYTES,
      );
      if (bytes.byteLength > MAXIMUM_AI_API_KEY_FILE_BYTES) {
        throw new AiApiKeyCredentialError("AI_API_KEY_FILE is too large.");
      }
      const key = new TextDecoder("utf-8", { fatal: true })
        .decode(bytes)
        .trim();
      if (!key) {
        if (environment.NODE_ENV === "production") return null;
        throw new AiApiKeyCredentialError("AI_API_KEY_FILE is empty.");
      }
      return key;
    } catch (error) {
      if (error instanceof AiApiKeyCredentialError) throw error;
      throw new AiApiKeyCredentialError("AI_API_KEY_FILE cannot be read.");
    } finally {
      if (descriptor !== null) fileAccess.close(descriptor);
    }
  }

  if (environment.NODE_ENV === "production") return null;
  return environment.AI_API_KEY?.trim() || null;
}
