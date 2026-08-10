export const S3_BROWSER_UPLOAD_ORIGINS_ENV =
  "MEDIA_S3_BROWSER_ALLOWED_ORIGINS_JSON";

const MINIMUM_BROWSER_UPLOAD_ORIGINS = 1;
const MAXIMUM_BROWSER_UPLOAD_ORIGINS = 100;

type EnvironmentSource = Readonly<Record<string, string | undefined>>;

export class S3BrowserUploadOriginInventoryError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(issues.join(" "));
    this.name = "S3BrowserUploadOriginInventoryError";
    this.issues = issues;
  }
}

function exactHttpsOrigin(value: unknown, index: number) {
  if (typeof value !== "string" || !value) {
    throw new S3BrowserUploadOriginInventoryError([
      `${S3_BROWSER_UPLOAD_ORIGINS_ENV}[${index}] must be a non-empty string.`,
    ]);
  }
  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== "https:" ||
      parsed.origin !== value ||
      parsed.username ||
      parsed.password ||
      parsed.port ||
      value.includes("*")
    ) {
      throw new Error("invalid_origin");
    }
    return parsed.origin;
  } catch {
    throw new S3BrowserUploadOriginInventoryError([
      `${S3_BROWSER_UPLOAD_ORIGINS_ENV}[${index}] must be one canonical HTTPS origin without credentials, port, path, query, fragment, or wildcard.`,
    ]);
  }
}

export function normalizeS3BrowserUploadOrigins(
  values: readonly unknown[],
): readonly string[] {
  const issues: string[] = [];
  if (
    values.length < MINIMUM_BROWSER_UPLOAD_ORIGINS ||
    values.length > MAXIMUM_BROWSER_UPLOAD_ORIGINS
  ) {
    issues.push(
      `${S3_BROWSER_UPLOAD_ORIGINS_ENV} must contain between ${MINIMUM_BROWSER_UPLOAD_ORIGINS} and ${MAXIMUM_BROWSER_UPLOAD_ORIGINS} explicit origins.`,
    );
  }
  const normalized: string[] = [];
  for (const [index, value] of values.entries()) {
    try {
      normalized.push(exactHttpsOrigin(value, index));
    } catch (error) {
      if (error instanceof S3BrowserUploadOriginInventoryError) {
        issues.push(...error.issues);
      } else {
        throw error;
      }
    }
  }
  if (new Set(normalized).size !== normalized.length) {
    issues.push(`${S3_BROWSER_UPLOAD_ORIGINS_ENV} must not contain duplicates.`);
  }
  if (issues.length > 0) {
    throw new S3BrowserUploadOriginInventoryError(issues);
  }
  return Object.freeze(normalized);
}

export function resolveS3BrowserUploadOriginInventory(
  environment: EnvironmentSource,
): readonly string[] {
  const raw = environment[S3_BROWSER_UPLOAD_ORIGINS_ENV]?.trim();
  if (!raw) {
    throw new S3BrowserUploadOriginInventoryError([
      `${S3_BROWSER_UPLOAD_ORIGINS_ENV} is required.`,
    ]);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new S3BrowserUploadOriginInventoryError([
      `${S3_BROWSER_UPLOAD_ORIGINS_ENV} must be valid JSON.`,
    ]);
  }
  if (!Array.isArray(parsed)) {
    throw new S3BrowserUploadOriginInventoryError([
      `${S3_BROWSER_UPLOAD_ORIGINS_ENV} must be a JSON array.`,
    ]);
  }
  const origins = normalizeS3BrowserUploadOrigins(parsed);
  const requiredOrigins = new Set<string>();
  const publicAppUrl = environment.NEXT_PUBLIC_APP_URL?.trim();
  if (publicAppUrl) requiredOrigins.add(publicAppUrl);
  const tenantBaseDomain = environment.TENANT_BASE_DOMAIN?.trim().toLowerCase();
  const defaultOrganizationSlug =
    environment.DEFAULT_ORGANIZATION_SLUG?.trim().toLowerCase();
  if (tenantBaseDomain && defaultOrganizationSlug) {
    requiredOrigins.add(
      `https://${defaultOrganizationSlug}.${tenantBaseDomain}`,
    );
  }
  const missing = [...requiredOrigins].filter(
    (origin) => !origins.includes(origin),
  );
  if (missing.length > 0) {
    throw new S3BrowserUploadOriginInventoryError([
      `${S3_BROWSER_UPLOAD_ORIGINS_ENV} is missing required application origins: ${missing.join(", ")}.`,
    ]);
  }
  return origins;
}

export function assertS3BrowserUploadOriginAllowed(
  environment: EnvironmentSource,
  origin: string,
) {
  const origins = resolveS3BrowserUploadOriginInventory(environment);
  if (!origins.includes(origin)) {
    throw new S3BrowserUploadOriginInventoryError([
      `${origin} is not present in ${S3_BROWSER_UPLOAD_ORIGINS_ENV}.`,
    ]);
  }
}
