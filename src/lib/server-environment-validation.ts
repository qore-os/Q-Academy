import { isIP } from "node:net";
import {
  OperationalCleanupConfigurationError,
  resolveOperationalCleanupPolicy,
} from "./operational-cleanup-policy";
import {
  MediaStorageConfigurationError,
  resolveMediaStorageConfiguration,
  type S3MediaStorageConfiguration,
} from "./media/storage-configuration";
import {
  createEncryptionKeyring,
  EncryptionKeyringConfigurationError,
  parsePreviousEncryptionKeys,
} from "./encryption-keyring";
import {
  resolveWebPushConfiguration,
  WebPushConfigurationError,
  type WebPushConfiguration,
} from "./push/configuration";
import {
  normalizeConfiguredHostname,
  resolveCanonicalAppHostname,
} from "./branding-host-policy";

export type EnvironmentSource = Record<string, string | undefined>;

export const LOCAL_DATABASE_URL =
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";

const REQUIRED_SECRET_NAMES = [
  "SESSION_SECRET",
  "AUTH_RATE_LIMIT_SECRET",
  "CADDY_TLS_ASK_SECRET",
  "WEBHOOK_ENCRYPTION_KEY",
  "DATA_ENCRYPTION_KEY",
  "MFA_RECOVERY_PEPPER",
  "PRIVACY_SUBJECT_HMAC_SECRET",
  "EXAM_SELECTION_SECRET",
  "CRON_SECRET",
  "METRICS_SECRET",
] as const;

type RequiredSecretName = (typeof REQUIRED_SECRET_NAMES)[number];

export type ProductionServerEnvironment = {
  databaseUrl: string;
  publicAppUrl: string;
  apiAllowedOrigin: string;
  sessionSecret: string;
  authRateLimitSecret: string;
  caddyTlsAskSecret: string;
  webhookEncryptionKey: string;
  webhookEncryptionKeyId: string;
  webhookEncryptionPreviousKeys: Readonly<Record<string, string>>;
  dataEncryptionKey: string;
  dataEncryptionKeyId: string;
  dataEncryptionPreviousKeys: Readonly<Record<string, string>>;
  mfaRecoveryPepper: string;
  mfaRecoveryPepperId: string;
  mfaRecoveryPreviousPeppers: Readonly<Record<string, string>>;
  privacySubjectHmacSecret: string;
  examSelectionSecret: string;
  cronSecret: string;
  metricsSecret: string;
  trustProxyHeaders: boolean;
  emailDeliveryRequired: boolean;
  emailDeliveryWebhookUrl: string | null;
  emailDeliveryWebhookSecret: string | null;
  emailDeliveryInboundSecret: string;
  legalImprintUrl: string;
  legalPrivacyUrl: string;
  supportEmail: string;
  webPush: WebPushConfiguration;
  mediaStorage: S3MediaStorageConfiguration;
};

export type ProductionMediaWorkerEnvironment = {
  databaseUrl: string;
  cronSecret: string;
  metricsSecret: string;
  mediaStorage: S3MediaStorageConfiguration;
};

export class ProductionEnvironmentError extends Error {
  readonly issues: readonly string[];

  constructor(issues: string[]) {
    super(
      `Invalid production server configuration:\n${issues
        .map((issue) => `- ${issue}`)
        .join("\n")}`,
    );
    this.name = "ProductionEnvironmentError";
    this.issues = issues;
  }
}

function valueOf(environment: EnvironmentSource, name: string) {
  return environment[name]?.trim() ?? "";
}

function localHostname(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized === "0.0.0.0" ||
    normalized === "::" ||
    normalized === "::1" ||
    normalized === "host.docker.internal" ||
    /^127(?:\.\d{1,3}){3}$/.test(normalized)
  );
}

function reservedExampleHostname(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  return (
    normalized === "example.com" ||
    normalized.endsWith(".example.com") ||
    normalized === "example.net" ||
    normalized.endsWith(".example.net") ||
    normalized === "example.org" ||
    normalized.endsWith(".example.org") ||
    normalized.endsWith(".example") ||
    normalized.endsWith(".invalid") ||
    normalized.endsWith(".test")
  );
}

function productionOrigin(
  environment: EnvironmentSource,
  name: string,
  issues: string[],
) {
  const raw = valueOf(environment, name);
  if (!raw) {
    issues.push(`${name} is required.`);
    return null;
  }
  if (raw === "*") {
    issues.push(`${name} must be one explicit HTTPS origin, not '*'.`);
    return null;
  }
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") {
      issues.push(`${name} must use HTTPS.`);
      return null;
    }
    if (url.username || url.password) {
      issues.push(`${name} must not contain credentials.`);
      return null;
    }
    if (localHostname(url.hostname)) {
      issues.push(`${name} must not target a local hostname in production.`);
      return null;
    }
    if (reservedExampleHostname(url.hostname)) {
      issues.push(`${name} must not use a reserved example hostname.`);
      return null;
    }
    if (url.pathname !== "/" || url.search || url.hash) {
      issues.push(`${name} must contain only an origin without path, query, or fragment.`);
      return null;
    }
    return url.origin;
  } catch {
    issues.push(`${name} must be a valid HTTPS origin.`);
    return null;
  }
}

function productionHostname(
  environment: EnvironmentSource,
  name: string,
  issues: string[],
  options: { required: boolean },
) {
  const raw = valueOf(environment, name);
  if (!raw) {
    if (options.required) issues.push(`${name} is required.`);
    return null;
  }
  const hostname = normalizeConfiguredHostname(raw);
  if (
    !hostname ||
    isIP(hostname) > 0 ||
    !hostname.includes(".") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal")
  ) {
    issues.push(
      `${name} must be a publicly qualified DNS hostname without protocol, path, wildcard, or port.`,
    );
    return null;
  }
  if (localHostname(hostname)) {
    issues.push(`${name} must not target a local hostname in production.`);
    return null;
  }
  if (reservedExampleHostname(hostname)) {
    issues.push(`${name} must not use a reserved example hostname.`);
    return null;
  }
  return hostname;
}

function productionOrganizationSlug(
  environment: EnvironmentSource,
  issues: string[],
) {
  const slug = valueOf(environment, "DEFAULT_ORGANIZATION_SLUG");
  if (!slug) {
    issues.push("DEFAULT_ORGANIZATION_SLUG is required.");
    return null;
  }
  if (
    slug.length < 2 ||
    slug.length > 100 ||
    !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])$/.test(slug)
  ) {
    issues.push(
      "DEFAULT_ORGANIZATION_SLUG must be a lowercase tenant slug with 2 to 100 characters.",
    );
    return null;
  }
  return slug;
}

function productionDatabaseUrl(
  environment: EnvironmentSource,
  issues: string[],
) {
  const raw = valueOf(environment, "DATABASE_URL");
  if (!raw) {
    issues.push("DATABASE_URL is required and has no production fallback.");
    return null;
  }
  if (raw === LOCAL_DATABASE_URL) {
    issues.push("DATABASE_URL must not use the local development default.");
    return null;
  }
  try {
    const url = new URL(raw);
    if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
      issues.push("DATABASE_URL must use the postgres or postgresql protocol.");
      return null;
    }
    if (localHostname(url.hostname)) {
      issues.push("DATABASE_URL must not target localhost in production.");
      return null;
    }
    if (reservedExampleHostname(url.hostname)) {
      issues.push("DATABASE_URL must not use a reserved example hostname.");
      return null;
    }
    const databaseUser = decodeURIComponent(url.username);
    const databasePassword = decodeURIComponent(url.password);
    if (!databaseUser || !databasePassword) {
      issues.push("DATABASE_URL must contain explicit database credentials.");
      return null;
    }
    if (databaseUser.toLowerCase() === "postgres") {
      issues.push("DATABASE_URL must not use the PostgreSQL superuser.");
      return null;
    }
    if (databasePassword.length < 16) {
      issues.push("DATABASE_URL must use a database password with at least 16 characters.");
      return null;
    }
    if (
      /replace|placeholder|change[-_ ]?me|development|example|sample|local|demo|todo/i.test(
        databasePassword,
      )
    ) {
      issues.push("DATABASE_URL must not contain a placeholder database password.");
      return null;
    }
    const databaseName = decodeURIComponent(url.pathname.replace(/^\//, ""));
    if (!databaseName || ["postgres", "template0", "template1"].includes(databaseName)) {
      issues.push("DATABASE_URL must target a dedicated application database.");
      return null;
    }
    return raw;
  } catch {
    issues.push("DATABASE_URL must be a valid PostgreSQL URL.");
    return null;
  }
}

export function databaseUrlForEnvironment(environment: EnvironmentSource) {
  if (environment.NODE_ENV !== "production") {
    return valueOf(environment, "DATABASE_URL") || LOCAL_DATABASE_URL;
  }
  const issues: string[] = [];
  const databaseUrl = productionDatabaseUrl(environment, issues);
  if (issues.length > 0) throw new ProductionEnvironmentError(issues);
  return databaseUrl!;
}

function booleanValue(
  environment: EnvironmentSource,
  name: string,
  fallback: boolean,
  issues: string[],
) {
  const raw = valueOf(environment, name);
  if (!raw) return fallback;
  if (raw === "true") return true;
  if (raw === "false") return false;
  issues.push(`${name} must be either 'true' or 'false'.`);
  return fallback;
}

function strongSecretValue(
  value: string,
  name: string,
  issues: string[],
) {
  if (!value) {
    issues.push(`${name} is required.`);
    return null;
  }
  if (value.length < 32) {
    issues.push(`${name} must contain at least 32 characters.`);
    return null;
  }
  if (
    /replace|placeholder|change[-_ ]?me|development|example|sample|local|demo|todo|secret[-_ ]?here/i.test(
      value,
    )
  ) {
    issues.push(`${name} must not contain a known placeholder value.`);
    return null;
  }
  if (new Set(value).size < 10) {
    issues.push(`${name} must contain sufficiently varied random material.`);
    return null;
  }
  return value;
}

function strongSecret(
  environment: EnvironmentSource,
  name: string,
  issues: string[],
) {
  return strongSecretValue(valueOf(environment, name), name, issues);
}

function encryptionKeyId(
  environment: EnvironmentSource,
  name: string,
  issues: string[],
) {
  const value = valueOf(environment, name);
  if (!value) {
    issues.push(`${name} is required.`);
    return null;
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value)) {
    issues.push(
      `${name} must contain 1 to 64 letters, digits, dots, underscores, or hyphens.`,
    );
    return null;
  }
  return value;
}

function previousEncryptionKeys(
  environment: EnvironmentSource,
  name: string,
  issues: string[],
) {
  let keys: Record<string, string>;
  try {
    keys = parsePreviousEncryptionKeys(environment[name], name);
  } catch (error) {
    if (error instanceof EncryptionKeyringConfigurationError) {
      issues.push(error.message);
      return {};
    }
    throw error;
  }
  for (const [keyId, secret] of Object.entries(keys)) {
    strongSecretValue(secret, `${name}.${keyId}`, issues);
  }
  return keys;
}

function productionWebhookUrl(
  environment: EnvironmentSource,
  name: string,
  issues: string[],
) {
  const raw = valueOf(environment, name);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") {
      issues.push(`${name} must use HTTPS in production.`);
      return null;
    }
    if (url.username || url.password) {
      issues.push(`${name} must not contain credentials.`);
      return null;
    }
    if (localHostname(url.hostname)) {
      issues.push(`${name} must not target a local hostname in production.`);
      return null;
    }
    if (reservedExampleHostname(url.hostname)) {
      issues.push(`${name} must not use a reserved example hostname.`);
      return null;
    }
    return url.toString();
  } catch {
    issues.push(`${name} must be a valid HTTPS URL.`);
    return null;
  }
}

function productionPublicUrl(
  environment: EnvironmentSource,
  name: string,
  issues: string[],
) {
  const url = productionWebhookUrl(environment, name, issues);
  if (!url) {
    if (!valueOf(environment, name)) issues.push(`${name} is required.`);
    return null;
  }
  const parsed = new URL(url);
  if (parsed.search || parsed.hash) {
    issues.push(`${name} must not contain a query or fragment.`);
    return null;
  }
  return parsed.toString();
}

function productionSupportEmail(
  environment: EnvironmentSource,
  issues: string[],
) {
  const value = valueOf(environment, "SUPPORT_EMAIL").toLowerCase();
  if (!value) {
    issues.push("SUPPORT_EMAIL is required.");
    return null;
  }
  if (value.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    issues.push("SUPPORT_EMAIL must be a valid email address.");
    return null;
  }
  const hostname = value.slice(value.lastIndexOf("@") + 1);
  if (reservedExampleHostname(hostname) || localHostname(hostname)) {
    issues.push("SUPPORT_EMAIL must not use a local or reserved example domain.");
    return null;
  }
  return value;
}

export function validateProductionServerEnvironment(
  environment: EnvironmentSource,
): ProductionServerEnvironment | null {
  if (environment.NODE_ENV !== "production") return null;

  const issues: string[] = [];
  const runtimeRole = valueOf(environment, "Q_ACADEMY_RUNTIME_ROLE");
  if (runtimeRole && runtimeRole !== "app") {
    issues.push("Q_ACADEMY_RUNTIME_ROLE must be 'app' for the public runtime.");
  }
  const databaseUrl = productionDatabaseUrl(environment, issues);
  const publicAppUrl = productionOrigin(
    environment,
    "NEXT_PUBLIC_APP_URL",
    issues,
  );
  const appDomain = productionHostname(
    environment,
    "APP_DOMAIN",
    issues,
    { required: true },
  );
  productionOrganizationSlug(environment, issues);
  productionHostname(environment, "TENANT_BASE_DOMAIN", issues, {
    required: false,
  });
  if (publicAppUrl && appDomain) {
    const canonicalHostname = resolveCanonicalAppHostname({
      appDomain,
      publicAppUrl,
    });
    if (canonicalHostname.status !== "resolved") {
      issues.push(
        "APP_DOMAIN must exactly match the hostname in NEXT_PUBLIC_APP_URL.",
      );
    }
  }
  const apiAllowedOrigin = productionOrigin(
    environment,
    "API_ALLOWED_ORIGIN",
    issues,
  );
  const trustProxyHeaders = booleanValue(
    environment,
    "TRUST_PROXY_HEADERS",
    false,
    issues,
  );
  const demoLoginEnabled = booleanValue(
    environment,
    "ENABLE_DEMO_LOGIN",
    false,
    issues,
  );
  if (demoLoginEnabled) {
    issues.push("ENABLE_DEMO_LOGIN must be false in production.");
  }
  if (valueOf(environment, "DEMO_API_KEY")) {
    issues.push("DEMO_API_KEY must be unset in production.");
  }

  const secrets = Object.fromEntries(
    REQUIRED_SECRET_NAMES.map((name) => [
      name,
      strongSecret(environment, name, issues),
    ]),
  ) as Record<RequiredSecretName, string | null>;
  const webhookEncryptionKeyId = encryptionKeyId(
    environment,
    "WEBHOOK_ENCRYPTION_KEY_ID",
    issues,
  );
  const dataEncryptionKeyId = encryptionKeyId(
    environment,
    "DATA_ENCRYPTION_KEY_ID",
    issues,
  );
  const mfaRecoveryPepperId = encryptionKeyId(
    environment,
    "MFA_RECOVERY_PEPPER_ID",
    issues,
  );
  const webhookEncryptionPreviousKeys = previousEncryptionKeys(
    environment,
    "WEBHOOK_ENCRYPTION_PREVIOUS_KEYS",
    issues,
  );
  const dataEncryptionPreviousKeys = previousEncryptionKeys(
    environment,
    "DATA_ENCRYPTION_PREVIOUS_KEYS",
    issues,
  );
  const mfaRecoveryPreviousPeppers = previousEncryptionKeys(
    environment,
    "MFA_RECOVERY_PREVIOUS_PEPPERS",
    issues,
  );
  if (webhookEncryptionKeyId && secrets.WEBHOOK_ENCRYPTION_KEY) {
    try {
      createEncryptionKeyring({
        activeKeyId: webhookEncryptionKeyId,
        activeSecret: secrets.WEBHOOK_ENCRYPTION_KEY,
        previousKeys: webhookEncryptionPreviousKeys,
      });
    } catch (error) {
      if (error instanceof EncryptionKeyringConfigurationError) {
        issues.push(`WEBHOOK_ENCRYPTION_PREVIOUS_KEYS: ${error.message}`);
      } else {
        throw error;
      }
    }
  }
  if (dataEncryptionKeyId && secrets.DATA_ENCRYPTION_KEY) {
    try {
      createEncryptionKeyring({
        activeKeyId: dataEncryptionKeyId,
        activeSecret: secrets.DATA_ENCRYPTION_KEY,
        previousKeys: dataEncryptionPreviousKeys,
      });
    } catch (error) {
      if (error instanceof EncryptionKeyringConfigurationError) {
        issues.push(`DATA_ENCRYPTION_PREVIOUS_KEYS: ${error.message}`);
      } else {
        throw error;
      }
    }
  }
  if (mfaRecoveryPepperId && secrets.MFA_RECOVERY_PEPPER) {
    try {
      createEncryptionKeyring({
        activeKeyId: mfaRecoveryPepperId,
        activeSecret: secrets.MFA_RECOVERY_PEPPER,
        previousKeys: mfaRecoveryPreviousPeppers,
      });
    } catch (error) {
      if (error instanceof EncryptionKeyringConfigurationError) {
        issues.push(`MFA_RECOVERY_PREVIOUS_PEPPERS: ${error.message}`);
      } else {
        throw error;
      }
    }
  }

  const emailDeliveryRequired = booleanValue(
    environment,
    "EMAIL_DELIVERY_REQUIRED",
    false,
    issues,
  );
  if (!emailDeliveryRequired) {
    issues.push("EMAIL_DELIVERY_REQUIRED must be true in production.");
  }
  const emailDeliveryWebhookUrl = productionWebhookUrl(
    environment,
    "EMAIL_DELIVERY_WEBHOOK_URL",
    issues,
  );
  const configuredEmailSecret = valueOf(
    environment,
    "EMAIL_DELIVERY_WEBHOOK_SECRET",
  );
  const emailDeliveryWebhookSecret = configuredEmailSecret
    ? strongSecret(environment, "EMAIL_DELIVERY_WEBHOOK_SECRET", issues)
    : null;
  const emailDeliveryInboundSecret = strongSecret(
    environment,
    "EMAIL_DELIVERY_INBOUND_SECRET",
    issues,
  );
  const legalImprintUrl = productionPublicUrl(
    environment,
    "LEGAL_IMPRINT_URL",
    issues,
  );
  const legalPrivacyUrl = productionPublicUrl(
    environment,
    "LEGAL_PRIVACY_URL",
    issues,
  );
  const supportEmail = productionSupportEmail(environment, issues);
  let webPush: WebPushConfiguration | null = null;
  try {
    webPush = resolveWebPushConfiguration(environment, {
      required: true,
      production: true,
    });
  } catch (error) {
    if (error instanceof WebPushConfigurationError) {
      issues.push(...error.issues);
    } else {
      throw error;
    }
  }
  let mediaStorage: S3MediaStorageConfiguration | null = null;
  try {
    const resolvedMediaStorage = resolveMediaStorageConfiguration(environment);
    if (resolvedMediaStorage.driver === "s3") {
      mediaStorage = resolvedMediaStorage;
    }
  } catch (error) {
    if (error instanceof MediaStorageConfigurationError) {
      issues.push(
        ...error.issues.map(
          (entry) => `${entry.field} ${entry.message}`,
        ),
      );
    } else {
      throw error;
    }
  }

  if (!emailDeliveryWebhookUrl) {
    issues.push(
      "EMAIL_DELIVERY_WEBHOOK_URL is required in production.",
    );
  }
  if (emailDeliveryWebhookUrl && !emailDeliveryWebhookSecret) {
    issues.push(
      "EMAIL_DELIVERY_WEBHOOK_SECRET is required when EMAIL_DELIVERY_WEBHOOK_URL is configured.",
    );
  }
  if (!emailDeliveryWebhookUrl && configuredEmailSecret) {
    issues.push(
      "EMAIL_DELIVERY_WEBHOOK_URL is required when EMAIL_DELIVERY_WEBHOOK_SECRET is configured.",
    );
  }

  try {
    resolveOperationalCleanupPolicy(environment);
  } catch (error) {
    if (error instanceof OperationalCleanupConfigurationError) {
      issues.push(error.message);
    } else {
      throw error;
    }
  }

  const secretEntries: Array<readonly [string, string]> = [];
  for (const name of REQUIRED_SECRET_NAMES) {
    const secret = secrets[name];
    if (secret) secretEntries.push([name, secret]);
  }
  if (emailDeliveryWebhookSecret) {
    secretEntries.push([
      "EMAIL_DELIVERY_WEBHOOK_SECRET",
      emailDeliveryWebhookSecret,
    ]);
  }
  if (emailDeliveryInboundSecret) {
    secretEntries.push([
      "EMAIL_DELIVERY_INBOUND_SECRET",
      emailDeliveryInboundSecret,
    ]);
  }
  if (webPush?.privateKey) {
    secretEntries.push(["WEB_PUSH_VAPID_PRIVATE_KEY", webPush.privateKey]);
  }
  if (mediaStorage?.secretAccessKey) {
    secretEntries.push([
      "MEDIA_S3_SECRET_ACCESS_KEY",
      mediaStorage.secretAccessKey,
    ]);
  }
  for (const [keyId, secret] of Object.entries(
    webhookEncryptionPreviousKeys,
  )) {
    secretEntries.push([`WEBHOOK_ENCRYPTION_PREVIOUS_KEYS.${keyId}`, secret]);
  }
  for (const [keyId, secret] of Object.entries(dataEncryptionPreviousKeys)) {
    secretEntries.push([`DATA_ENCRYPTION_PREVIOUS_KEYS.${keyId}`, secret]);
  }
  for (const [keyId, secret] of Object.entries(mfaRecoveryPreviousPeppers)) {
    secretEntries.push([`MFA_RECOVERY_PREVIOUS_PEPPERS.${keyId}`, secret]);
  }
  for (let left = 0; left < secretEntries.length; left += 1) {
    for (let right = left + 1; right < secretEntries.length; right += 1) {
      if (secretEntries[left]?.[1] === secretEntries[right]?.[1]) {
        issues.push(
          `${secretEntries[left]?.[0]} and ${secretEntries[right]?.[0]} must use distinct values.`,
        );
      }
    }
  }

  if (issues.length > 0) throw new ProductionEnvironmentError(issues);

  return {
    databaseUrl: databaseUrl!,
    publicAppUrl: publicAppUrl!,
    apiAllowedOrigin: apiAllowedOrigin!,
    sessionSecret: secrets.SESSION_SECRET!,
    authRateLimitSecret: secrets.AUTH_RATE_LIMIT_SECRET!,
    caddyTlsAskSecret: secrets.CADDY_TLS_ASK_SECRET!,
    webhookEncryptionKey: secrets.WEBHOOK_ENCRYPTION_KEY!,
    webhookEncryptionKeyId: webhookEncryptionKeyId!,
    webhookEncryptionPreviousKeys,
    dataEncryptionKey: secrets.DATA_ENCRYPTION_KEY!,
    dataEncryptionKeyId: dataEncryptionKeyId!,
    dataEncryptionPreviousKeys,
    mfaRecoveryPepper: secrets.MFA_RECOVERY_PEPPER!,
    mfaRecoveryPepperId: mfaRecoveryPepperId!,
    mfaRecoveryPreviousPeppers,
    privacySubjectHmacSecret: secrets.PRIVACY_SUBJECT_HMAC_SECRET!,
    examSelectionSecret: secrets.EXAM_SELECTION_SECRET!,
    cronSecret: secrets.CRON_SECRET!,
    metricsSecret: secrets.METRICS_SECRET!,
    trustProxyHeaders,
    emailDeliveryRequired,
    emailDeliveryWebhookUrl,
    emailDeliveryWebhookSecret,
    emailDeliveryInboundSecret: emailDeliveryInboundSecret!,
    legalImprintUrl: legalImprintUrl!,
    legalPrivacyUrl: legalPrivacyUrl!,
    supportEmail: supportEmail!,
    webPush: webPush!,
    mediaStorage: mediaStorage!,
  };
}

const MEDIA_WORKER_FORBIDDEN_ENVIRONMENT = [
  "SESSION_SECRET",
  "AUTH_RATE_LIMIT_SECRET",
  "CADDY_TLS_ASK_SECRET",
  "WEBHOOK_ENCRYPTION_KEY",
  "WEBHOOK_ENCRYPTION_KEY_ID",
  "WEBHOOK_ENCRYPTION_PREVIOUS_KEYS",
  "DATA_ENCRYPTION_KEY",
  "DATA_ENCRYPTION_KEY_ID",
  "DATA_ENCRYPTION_PREVIOUS_KEYS",
  "MFA_RECOVERY_PEPPER",
  "MFA_RECOVERY_PEPPER_ID",
  "MFA_RECOVERY_PREVIOUS_PEPPERS",
  "PRIVACY_SUBJECT_HMAC_SECRET",
  "EXAM_SELECTION_SECRET",
  "EMAIL_DELIVERY_WEBHOOK_URL",
  "EMAIL_DELIVERY_WEBHOOK_SECRET",
  "EMAIL_DELIVERY_INBOUND_SECRET",
  "WEB_PUSH_VAPID_PUBLIC_KEY",
  "WEB_PUSH_VAPID_PRIVATE_KEY",
  "WEB_PUSH_VAPID_SUBJECT",
  "MEDIA_S3_APP_ACCESS_KEY_ID",
  "MEDIA_S3_APP_SECRET_ACCESS_KEY",
  "AI_API_KEY",
  "DEMO_API_KEY",
] as const;

export function validateProductionMediaWorkerEnvironment(
  environment: EnvironmentSource,
): ProductionMediaWorkerEnvironment | null {
  if (environment.NODE_ENV !== "production") return null;

  const issues: string[] = [];
  if (valueOf(environment, "Q_ACADEMY_RUNTIME_ROLE") !== "media-worker") {
    issues.push("Q_ACADEMY_RUNTIME_ROLE must be 'media-worker'.");
  }
  const databaseUrl = productionDatabaseUrl(environment, issues);
  const cronSecret = strongSecret(environment, "CRON_SECRET", issues);
  const metricsSecret = strongSecret(environment, "METRICS_SECRET", issues);
  for (const name of MEDIA_WORKER_FORBIDDEN_ENVIRONMENT) {
    if (valueOf(environment, name)) {
      issues.push(`${name} must be unset in the media worker runtime.`);
    }
  }

  let mediaStorage: S3MediaStorageConfiguration | null = null;
  try {
    const resolved = resolveMediaStorageConfiguration(environment);
    if (resolved.driver === "s3") {
      mediaStorage = resolved;
    } else {
      issues.push("MEDIA_STORAGE_DRIVER must be 's3' in production.");
    }
  } catch (error) {
    if (error instanceof MediaStorageConfigurationError) {
      issues.push(
        ...error.issues.map((entry) => `${entry.field} ${entry.message}`),
      );
    } else {
      throw error;
    }
  }
  if (cronSecret && mediaStorage?.secretAccessKey === cronSecret) {
    issues.push(
      "CRON_SECRET and MEDIA_S3_SECRET_ACCESS_KEY must use distinct values.",
    );
  }
  if (metricsSecret && mediaStorage?.secretAccessKey === metricsSecret) {
    issues.push(
      "METRICS_SECRET and MEDIA_S3_SECRET_ACCESS_KEY must use distinct values.",
    );
  }
  if (cronSecret && metricsSecret && cronSecret === metricsSecret) {
    issues.push("CRON_SECRET and METRICS_SECRET must use distinct values.");
  }
  if (issues.length > 0) throw new ProductionEnvironmentError(issues);

  return {
    databaseUrl: databaseUrl!,
    cronSecret: cronSecret!,
    metricsSecret: metricsSecret!,
    mediaStorage: mediaStorage!,
  };
}
