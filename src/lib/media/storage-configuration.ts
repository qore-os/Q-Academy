export const MEDIA_STORAGE_DRIVERS = ["filesystem", "s3"] as const;
export const MEDIA_S3_COMPATIBILITY_MODES = [
  "versioned",
  "strato-hidrive",
] as const;

export type MediaStorageDriver = (typeof MEDIA_STORAGE_DRIVERS)[number];
export type MediaS3CompatibilityMode =
  (typeof MEDIA_S3_COMPATIBILITY_MODES)[number];
export type MediaRuntimeEnvironment = "development" | "test" | "production";
export type MediaStorageEnvironment = Readonly<
  Record<string, string | undefined>
>;

export type MediaStorageLimits = Readonly<{
  maxUploadBytes: number;
  tenantQuotaBytes: number;
  signedUploadTtlSeconds: number;
  signedDownloadTtlSeconds: number;
}>;

export type ClamAvConfiguration = Readonly<{
  host: string;
  port: number;
  required: boolean;
}>;

type MediaStorageConfigurationBase = Readonly<{
  runtimeEnvironment: MediaRuntimeEnvironment;
  limits: MediaStorageLimits;
  clamAv: ClamAvConfiguration;
}>;

export type FilesystemMediaStorageConfiguration =
  MediaStorageConfigurationBase &
    Readonly<{
      driver: "filesystem";
      rootDirectory: string;
    }>;

export type S3MediaStorageConfiguration = MediaStorageConfigurationBase &
  Readonly<{
    driver: "s3";
    endpoint: string;
    region: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
    forcePathStyle: boolean;
    compatibilityMode: MediaS3CompatibilityMode;
  }>;

export type MediaStorageConfiguration =
  | FilesystemMediaStorageConfiguration
  | S3MediaStorageConfiguration;

export type MediaStorageConfigurationIssue = Readonly<{
  field: string;
  message: string;
}>;

export class MediaStorageConfigurationError extends Error {
  readonly issues: readonly MediaStorageConfigurationIssue[];

  constructor(issues: readonly MediaStorageConfigurationIssue[]) {
    super(
      `Invalid media storage configuration:\n${issues
        .map((issue) => `- ${issue.field}: ${issue.message}`)
        .join("\n")}`,
    );
    this.name = "MediaStorageConfigurationError";
    this.issues = [...issues];
  }
}

const MEBIBYTE = 1024 * 1024;
const GIBIBYTE = 1024 * MEBIBYTE;
const TEBIBYTE = 1024 * GIBIBYTE;

// ClamAV 1.5 cannot scan files larger than 2 GB. Every accepted upload must
// remain within the scanner's hard technical boundary.
export const MAX_SCANNABLE_MEDIA_BYTES = 2_000_000_000;

export const DEFAULT_MEDIA_STORAGE_LIMITS: MediaStorageLimits = Object.freeze({
  maxUploadBytes: MAX_SCANNABLE_MEDIA_BYTES,
  tenantQuotaBytes: 500 * GIBIBYTE,
  signedUploadTtlSeconds: 15 * 60,
  signedDownloadTtlSeconds: 15 * 60,
});

const MAX_UPLOAD_BYTES = MAX_SCANNABLE_MEDIA_BYTES;
const MAX_TENANT_QUOTA_BYTES = 100 * TEBIBYTE;
export const FILESYSTEM_MEDIA_ROOT = ".data/media";
const DEFAULT_CLAMAV_PORT = 3310;

function valueOf(environment: MediaStorageEnvironment, name: string) {
  return environment[name]?.trim() ?? "";
}

function issue(
  issues: MediaStorageConfigurationIssue[],
  field: string,
  message: string,
) {
  issues.push({ field, message });
}

function runtimeEnvironment(
  environment: MediaStorageEnvironment,
  issues: MediaStorageConfigurationIssue[],
): MediaRuntimeEnvironment {
  const value = valueOf(environment, "NODE_ENV") || "development";
  if (value === "development" || value === "test" || value === "production") {
    return value;
  }
  issue(
    issues,
    "NODE_ENV",
    "must be 'development', 'test', or 'production'.",
  );
  return "development";
}

function wholeNumber(
  environment: MediaStorageEnvironment,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
  issues: MediaStorageConfigurationIssue[],
) {
  const raw = valueOf(environment, name);
  if (!raw) return fallback;
  if (!/^\d+$/.test(raw)) {
    issue(
      issues,
      name,
      `must be a whole number between ${minimum} and ${maximum}.`,
    );
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    issue(issues, name, `must be between ${minimum} and ${maximum}.`);
    return fallback;
  }
  return parsed;
}

function booleanValue(
  environment: MediaStorageEnvironment,
  name: string,
  fallback: boolean,
  issues: MediaStorageConfigurationIssue[],
) {
  const raw = valueOf(environment, name);
  if (!raw) return fallback;
  if (raw === "true") return true;
  if (raw === "false") return false;
  issue(issues, name, "must be either 'true' or 'false'.");
  return fallback;
}

function storageLimits(
  environment: MediaStorageEnvironment,
  issues: MediaStorageConfigurationIssue[],
): MediaStorageLimits {
  const maxUploadBytes = wholeNumber(
    environment,
    "MEDIA_MAX_UPLOAD_BYTES",
    DEFAULT_MEDIA_STORAGE_LIMITS.maxUploadBytes,
    MEBIBYTE,
    MAX_UPLOAD_BYTES,
    issues,
  );
  const tenantQuotaBytes = wholeNumber(
    environment,
    "MEDIA_TENANT_QUOTA_BYTES",
    DEFAULT_MEDIA_STORAGE_LIMITS.tenantQuotaBytes,
    MEBIBYTE,
    MAX_TENANT_QUOTA_BYTES,
    issues,
  );
  const signedUploadTtlSeconds = wholeNumber(
    environment,
    "MEDIA_SIGNED_UPLOAD_TTL_SECONDS",
    DEFAULT_MEDIA_STORAGE_LIMITS.signedUploadTtlSeconds,
    60,
    3600,
    issues,
  );
  const signedDownloadTtlSeconds = wholeNumber(
    environment,
    "MEDIA_SIGNED_DOWNLOAD_TTL_SECONDS",
    DEFAULT_MEDIA_STORAGE_LIMITS.signedDownloadTtlSeconds,
    60,
    86_400,
    issues,
  );

  if (tenantQuotaBytes < maxUploadBytes) {
    issue(
      issues,
      "MEDIA_TENANT_QUOTA_BYTES",
      "must be greater than or equal to MEDIA_MAX_UPLOAD_BYTES.",
    );
  }

  return {
    maxUploadBytes,
    tenantQuotaBytes,
    signedUploadTtlSeconds,
    signedDownloadTtlSeconds,
  };
}

function storageDriver(
  environment: MediaStorageEnvironment,
  runtime: MediaRuntimeEnvironment,
  issues: MediaStorageConfigurationIssue[],
): MediaStorageDriver {
  const expected: MediaStorageDriver =
    runtime === "production" ? "s3" : "filesystem";
  const configured = valueOf(environment, "MEDIA_STORAGE_DRIVER");
  if (
    configured &&
    !MEDIA_STORAGE_DRIVERS.includes(configured as MediaStorageDriver)
  ) {
    issue(
      issues,
      "MEDIA_STORAGE_DRIVER",
      "must be either 'filesystem' or 's3'.",
    );
    return expected;
  }
  if (configured && configured !== expected) {
    issue(
      issues,
      "MEDIA_STORAGE_DRIVER",
      runtime === "production"
        ? "must be 's3' in production."
        : "must be 'filesystem' outside production.",
    );
  }
  return expected;
}

function filesystemRoot(
  environment: MediaStorageEnvironment,
  issues: MediaStorageConfigurationIssue[],
) {
  const raw = valueOf(environment, "MEDIA_FILESYSTEM_ROOT") ||
    FILESYSTEM_MEDIA_ROOT;
  if (raw.includes("\0")) {
    issue(issues, "MEDIA_FILESYSTEM_ROOT", "must not contain null bytes.");
    return FILESYSTEM_MEDIA_ROOT;
  }

  const normalized = raw.replace(/\\/g, "/").replace(/^\.\//, "");
  const segments = normalized.split("/");
  if (
    normalized.startsWith("/") ||
    /^[a-z]:\//i.test(normalized) ||
    (normalized !== FILESYSTEM_MEDIA_ROOT &&
      !normalized.startsWith(`${FILESYSTEM_MEDIA_ROOT}/`)) ||
    normalized === "." ||
    normalized === "" ||
    segments.some(
      (segment) => segment === "" || segment === "." || segment === "..",
    )
  ) {
    issue(
      issues,
      "MEDIA_FILESYSTEM_ROOT",
      "must be '.data/media' or a relative directory below it without '..' segments.",
    );
    return FILESYSTEM_MEDIA_ROOT;
  }
  return normalized;
}

function connectHost(
  environment: MediaStorageEnvironment,
  runtime: MediaRuntimeEnvironment,
  issues: MediaStorageConfigurationIssue[],
) {
  const configured = valueOf(environment, "MEDIA_CLAMAV_HOST");
  if (runtime === "production" && !configured) {
    issue(issues, "MEDIA_CLAMAV_HOST", "is required in production.");
  }
  const raw = configured || "127.0.0.1";
  const bracketed = raw.startsWith("[") && raw.endsWith("]");
  const mismatchedBrackets = raw.startsWith("[") !== raw.endsWith("]");
  const normalized = (bracketed ? raw.slice(1, -1) : raw).toLowerCase();
  const ipv4Shape = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(normalized);
  const ipv4 = ipv4Shape &&
    normalized.split(".").every((part) => Number(part) <= 255);
  const ipv6Shape = normalized.includes(":");
  let ipv6 = false;
  if (ipv6Shape && /^[0-9a-f:]+$/.test(normalized)) {
    try {
      new URL(`http://[${normalized}]`);
      ipv6 = true;
    } catch {
      ipv6 = false;
    }
  }
  const hostname =
    !ipv4Shape &&
    !ipv6Shape &&
    /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(
      normalized,
    );

  if (
    mismatchedBrackets ||
    (!hostname && !ipv4 && !ipv6) ||
    normalized === "0.0.0.0" ||
    normalized === "::"
  ) {
    issue(
      issues,
      "MEDIA_CLAMAV_HOST",
      "must be a connectable hostname or IP address, not a URL or wildcard address.",
    );
    return "127.0.0.1";
  }
  return normalized;
}

function clamAvConfiguration(
  environment: MediaStorageEnvironment,
  runtime: MediaRuntimeEnvironment,
  issues: MediaStorageConfigurationIssue[],
): ClamAvConfiguration {
  return {
    host: connectHost(environment, runtime, issues),
    port: wholeNumber(
      environment,
      "MEDIA_CLAMAV_PORT",
      DEFAULT_CLAMAV_PORT,
      1,
      65_535,
      issues,
    ),
    required: runtime === "production",
  };
}

export function resolveClamAvConfiguration(
  environment: MediaStorageEnvironment,
): ClamAvConfiguration {
  const issues: MediaStorageConfigurationIssue[] = [];
  const runtime = runtimeEnvironment(environment, issues);
  const configuration = clamAvConfiguration(environment, runtime, issues);
  if (issues.length > 0) throw new MediaStorageConfigurationError(issues);
  return configuration;
}

function s3Endpoint(
  environment: MediaStorageEnvironment,
  issues: MediaStorageConfigurationIssue[],
) {
  const raw = valueOf(environment, "MEDIA_S3_ENDPOINT");
  if (!raw) {
    issue(issues, "MEDIA_S3_ENDPOINT", "is required in production.");
    return "https://invalid.invalid";
  }
  try {
    const url = new URL(raw);
    const endpointHost = url.hostname
      .replace(/^\[|\]$/g, "")
      .toLowerCase();
    if (url.protocol !== "https:") {
      issue(issues, "MEDIA_S3_ENDPOINT", "must use HTTPS.");
    }
    if (url.username || url.password) {
      issue(issues, "MEDIA_S3_ENDPOINT", "must not contain credentials.");
    }
    if (url.pathname !== "/" || url.search || url.hash) {
      issue(
        issues,
        "MEDIA_S3_ENDPOINT",
        "must be an origin without path, query, or fragment.",
      );
    }
    if (
      endpointHost === "localhost" ||
      endpointHost.endsWith(".localhost") ||
      endpointHost === "host.docker.internal" ||
      endpointHost === "0.0.0.0" ||
      endpointHost === "::" ||
      endpointHost === "::1" ||
      /^127(?:\.\d{1,3}){3}$/.test(endpointHost)
    ) {
      issue(
        issues,
        "MEDIA_S3_ENDPOINT",
        "must not target a loopback or wildcard address in production.",
      );
    }
    if (
      endpointHost === "example.com" ||
      endpointHost.endsWith(".example.com") ||
      endpointHost === "example.net" ||
      endpointHost.endsWith(".example.net") ||
      endpointHost === "example.org" ||
      endpointHost.endsWith(".example.org") ||
      endpointHost.endsWith(".example") ||
      endpointHost.endsWith(".invalid") ||
      endpointHost.endsWith(".test")
    ) {
      issue(
        issues,
        "MEDIA_S3_ENDPOINT",
        "must not use a reserved example hostname in production.",
      );
    }
    return url.origin;
  } catch {
    issue(issues, "MEDIA_S3_ENDPOINT", "must be a valid HTTPS origin.");
    return "https://invalid.invalid";
  }
}

function requiredValue(
  environment: MediaStorageEnvironment,
  name: string,
  issues: MediaStorageConfigurationIssue[],
) {
  const value = valueOf(environment, name);
  if (!value) issue(issues, name, "is required in production.");
  return value;
}

function s3Region(
  environment: MediaStorageEnvironment,
  issues: MediaStorageConfigurationIssue[],
) {
  const value = requiredValue(environment, "MEDIA_S3_REGION", issues);
  if (value && !/^[a-z0-9][a-z0-9-]{0,62}$/.test(value)) {
    issue(
      issues,
      "MEDIA_S3_REGION",
      "must contain only lowercase letters, numbers, and hyphens.",
    );
  }
  return value;
}

function s3Bucket(
  environment: MediaStorageEnvironment,
  issues: MediaStorageConfigurationIssue[],
) {
  const value = requiredValue(environment, "MEDIA_S3_BUCKET", issues);
  const ipv4Shape = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(value);
  if (
    value &&
    (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(value) ||
      value.includes("..") ||
      ipv4Shape)
  ) {
    issue(
      issues,
      "MEDIA_S3_BUCKET",
      "must be a 3-63 character DNS-compatible bucket name.",
    );
  }
  return value;
}

function s3AccessKeyId(
  environment: MediaStorageEnvironment,
  issues: MediaStorageConfigurationIssue[],
) {
  const value = requiredValue(environment, "MEDIA_S3_ACCESS_KEY_ID", issues);
  if (
    value &&
    (value.length < 3 || value.length > 128 || /[\s\u0000-\u001f]/.test(value))
  ) {
    issue(
      issues,
      "MEDIA_S3_ACCESS_KEY_ID",
      "must contain 3-128 non-whitespace characters.",
    );
  }
  return value;
}

function s3SecretAccessKey(
  environment: MediaStorageEnvironment,
  issues: MediaStorageConfigurationIssue[],
) {
  const value = requiredValue(
    environment,
    "MEDIA_S3_SECRET_ACCESS_KEY",
    issues,
  );
  if (value && (value.length < 16 || value.length > 512)) {
    issue(
      issues,
      "MEDIA_S3_SECRET_ACCESS_KEY",
      "must contain between 16 and 512 characters.",
    );
  }
  if (value && /[\u0000-\u001f\u007f]/.test(value)) {
    issue(
      issues,
      "MEDIA_S3_SECRET_ACCESS_KEY",
      "must not contain control characters.",
    );
  }
  if (
    value &&
    /replace|placeholder|change[-_ ]?me|development|example|sample|demo|todo|secret[-_ ]?here/i.test(
      value,
    )
  ) {
    issue(
      issues,
      "MEDIA_S3_SECRET_ACCESS_KEY",
      "must not contain a placeholder value.",
    );
  }
  return value;
}

function s3CompatibilityMode(
  environment: MediaStorageEnvironment,
  configuration: Readonly<{
    endpoint: string;
    region: string;
    forcePathStyle: boolean;
  }>,
  issues: MediaStorageConfigurationIssue[],
): MediaS3CompatibilityMode {
  const raw = valueOf(environment, "MEDIA_S3_COMPATIBILITY_MODE") ||
    "versioned";
  const mode = MEDIA_S3_COMPATIBILITY_MODES.includes(
    raw as MediaS3CompatibilityMode,
  )
    ? (raw as MediaS3CompatibilityMode)
    : "versioned";
  if (raw !== mode) {
    issue(
      issues,
      "MEDIA_S3_COMPATIBILITY_MODE",
      "must be either 'versioned' or 'strato-hidrive'.",
    );
  }

  const limitationsAccepted = booleanValue(
    environment,
    "MEDIA_S3_STRATO_LIMITATIONS_ACCEPTED",
    false,
    issues,
  );
  if (mode !== "strato-hidrive") return mode;

  if (!limitationsAccepted) {
    issue(
      issues,
      "MEDIA_S3_STRATO_LIMITATIONS_ACCEPTED",
      "must be explicitly true for the reduced STRATO HiDrive provider contract.",
    );
  }
  if (configuration.endpoint !== "https://s3.hidrive.strato.com") {
    issue(
      issues,
      "MEDIA_S3_ENDPOINT",
      "must be 'https://s3.hidrive.strato.com' in STRATO HiDrive mode.",
    );
  }
  if (configuration.region !== "eu-central-1") {
    issue(
      issues,
      "MEDIA_S3_REGION",
      "must be 'eu-central-1' in STRATO HiDrive mode.",
    );
  }
  if (!configuration.forcePathStyle) {
    issue(
      issues,
      "MEDIA_S3_FORCE_PATH_STYLE",
      "must be true in STRATO HiDrive mode.",
    );
  }
  return mode;
}

export function resolveMediaStorageConfiguration(
  environment: MediaStorageEnvironment,
): MediaStorageConfiguration {
  const issues: MediaStorageConfigurationIssue[] = [];
  const runtime = runtimeEnvironment(environment, issues);
  const driver = storageDriver(environment, runtime, issues);
  const limits = storageLimits(environment, issues);
  const clamAv = clamAvConfiguration(environment, runtime, issues);

  if (driver === "filesystem") {
    const rootDirectory = filesystemRoot(environment, issues);
    if (issues.length > 0) throw new MediaStorageConfigurationError(issues);
    return {
      driver,
      runtimeEnvironment: runtime,
      rootDirectory,
      limits,
      clamAv,
    };
  }

  const endpoint = s3Endpoint(environment, issues);
  const region = s3Region(environment, issues);
  const bucket = s3Bucket(environment, issues);
  const accessKeyId = s3AccessKeyId(environment, issues);
  const secretAccessKey = s3SecretAccessKey(environment, issues);
  const forcePathStyle = booleanValue(
    environment,
    "MEDIA_S3_FORCE_PATH_STYLE",
    false,
    issues,
  );
  const compatibilityMode = s3CompatibilityMode(
    environment,
    { endpoint, region, forcePathStyle },
    issues,
  );

  if (issues.length > 0) throw new MediaStorageConfigurationError(issues);
  return {
    driver,
    runtimeEnvironment: runtime,
    endpoint,
    region,
    bucket,
    accessKeyId,
    secretAccessKey,
    forcePathStyle,
    compatibilityMode,
    limits,
    clamAv,
  };
}
