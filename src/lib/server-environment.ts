import "server-only";

import {
  LOCAL_DATABASE_URL,
  ProductionEnvironmentError,
  validateProductionMediaWorkerEnvironment,
  validateProductionServerEnvironment,
} from "@/lib/server-environment-validation";
import {
  resolveMediaStorageConfiguration,
  type MediaStorageConfiguration,
} from "@/lib/media/storage-configuration";
import { parsePreviousEncryptionKeys } from "@/lib/encryption-keyring";
import {
  resolveWebPushConfiguration,
  type WebPushConfiguration,
} from "@/lib/push/configuration";

const DEVELOPMENT_SESSION_SECRET =
  "q-academy-local-development-secret-change-me";
const DEVELOPMENT_WEBHOOK_SECRET =
  "q-academy-local-webhook-encryption-key";
const DEVELOPMENT_DATA_SECRET = "q-academy-local-data-encryption-key";
const DEVELOPMENT_MFA_RECOVERY_PEPPER =
  "q-academy-local-mfa-recovery-pepper-key";
const DEVELOPMENT_PRIVACY_HMAC_SECRET =
  "q-academy-local-privacy-subject-hmac-key";
const DEVELOPMENT_EXAM_SELECTION_SECRET =
  "q-academy-local-exam-selection-hmac-key";
const DEVELOPMENT_WEBHOOK_KEY_ID = "local-webhook-v1";
const DEVELOPMENT_DATA_KEY_ID = "local-data-v1";
const DEVELOPMENT_MFA_RECOVERY_PEPPER_ID = "local-mfa-recovery-v1";

type RuntimeServerEnvironment = {
  runtimeRole: "app" | "media-worker";
  databaseUrl: string;
  publicAppUrl: string | null;
  apiAllowedOrigin: string | null;
  sessionSecret: string | null;
  authRateLimitSecret: string | null;
  caddyTlsAskSecret: string | null;
  webhookEncryptionKey: string | null;
  webhookEncryptionKeyId: string | null;
  webhookEncryptionPreviousKeys: Readonly<Record<string, string>> | null;
  dataEncryptionKey: string | null;
  dataEncryptionKeyId: string | null;
  dataEncryptionPreviousKeys: Readonly<Record<string, string>> | null;
  mfaRecoveryPepper: string | null;
  mfaRecoveryPepperId: string | null;
  mfaRecoveryPreviousPeppers: Readonly<Record<string, string>> | null;
  privacySubjectHmacSecret: string | null;
  examSelectionSecret: string | null;
  cronSecret: string | null;
  metricsSecret: string | null;
  trustProxyHeaders: boolean;
  emailDeliveryRequired: boolean;
  emailDeliveryWebhookUrl: string | null;
  emailDeliveryWebhookSecret: string | null;
  emailDeliveryInboundSecret: string | null;
  legalImprintUrl: string | null;
  legalPrivacyUrl: string | null;
  supportEmail: string | null;
  webPush: WebPushConfiguration | null;
  mediaStorage: MediaStorageConfiguration;
};

let cachedEnvironment: Readonly<RuntimeServerEnvironment> | null = null;

function isProductionBuild() {
  return (
    process.env.Q_ACADEMY_BUILD_PHASE === "true" &&
    process.env.npm_lifecycle_event === "build"
  );
}

function optionalOrigin(value: string | undefined, fallback: string) {
  try {
    return new URL(value?.trim() || fallback).origin;
  } catch {
    return new URL(fallback).origin;
  }
}

function loadRuntimeServerEnvironment(): Readonly<RuntimeServerEnvironment> {
  if (cachedEnvironment) return cachedEnvironment;

  if (isProductionBuild()) {
    cachedEnvironment = Object.freeze({
      runtimeRole: "app",
      databaseUrl: process.env.DATABASE_URL?.trim() || LOCAL_DATABASE_URL,
      publicAppUrl: optionalOrigin(
        process.env.NEXT_PUBLIC_APP_URL,
        "http://localhost:3000",
      ),
      apiAllowedOrigin: process.env.API_ALLOWED_ORIGIN?.trim() || "*",
      sessionSecret: "q-academy-build-only-session-key",
      authRateLimitSecret: "q-academy-build-only-rate-limit-key",
      caddyTlsAskSecret: null,
      webhookEncryptionKey: "q-academy-build-only-webhook-key",
      webhookEncryptionKeyId: "build-webhook-v1",
      webhookEncryptionPreviousKeys: {},
      dataEncryptionKey: "q-academy-build-only-data-key",
      dataEncryptionKeyId: "build-data-v1",
      dataEncryptionPreviousKeys: {},
      mfaRecoveryPepper: "q-academy-build-only-mfa-recovery-pepper",
      mfaRecoveryPepperId: "build-mfa-recovery-v1",
      mfaRecoveryPreviousPeppers: {},
      privacySubjectHmacSecret: "q-academy-build-only-privacy-hmac-key",
      examSelectionSecret: "q-academy-build-only-exam-selection-key",
      cronSecret: null,
      metricsSecret: null,
      trustProxyHeaders: false,
      emailDeliveryRequired: false,
      emailDeliveryWebhookUrl: null,
      emailDeliveryWebhookSecret: null,
      emailDeliveryInboundSecret: null,
      legalImprintUrl: null,
      legalPrivacyUrl: null,
      supportEmail: null,
      webPush: null,
      mediaStorage: resolveMediaStorageConfiguration({
        NODE_ENV: "development",
      }),
    });
    return cachedEnvironment;
  }

  if (
    process.env.NODE_ENV === "production" &&
    process.env.Q_ACADEMY_RUNTIME_ROLE?.trim() === "media-worker"
  ) {
    const worker = validateProductionMediaWorkerEnvironment(process.env)!;
    cachedEnvironment = Object.freeze({
      runtimeRole: "media-worker",
      databaseUrl: worker.databaseUrl,
      publicAppUrl: null,
      apiAllowedOrigin: null,
      sessionSecret: null,
      authRateLimitSecret: null,
      caddyTlsAskSecret: null,
      webhookEncryptionKey: null,
      webhookEncryptionKeyId: null,
      webhookEncryptionPreviousKeys: null,
      dataEncryptionKey: null,
      dataEncryptionKeyId: null,
      dataEncryptionPreviousKeys: null,
      mfaRecoveryPepper: null,
      mfaRecoveryPepperId: null,
      mfaRecoveryPreviousPeppers: null,
      privacySubjectHmacSecret: null,
      examSelectionSecret: null,
      cronSecret: worker.cronSecret,
      metricsSecret: worker.metricsSecret,
      trustProxyHeaders: false,
      emailDeliveryRequired: false,
      emailDeliveryWebhookUrl: null,
      emailDeliveryWebhookSecret: null,
      emailDeliveryInboundSecret: null,
      legalImprintUrl: null,
      legalPrivacyUrl: null,
      supportEmail: null,
      webPush: null,
      mediaStorage: worker.mediaStorage,
    });
    return cachedEnvironment;
  }

  const production = validateProductionServerEnvironment(process.env);
  if (production) {
    cachedEnvironment = Object.freeze({ runtimeRole: "app", ...production });
    return cachedEnvironment;
  }

  const configuredSessionSecret = process.env.SESSION_SECRET?.trim();
  const sessionSecret = configuredSessionSecret || DEVELOPMENT_SESSION_SECRET;
  const webhookEncryptionKey =
    process.env.WEBHOOK_ENCRYPTION_KEY?.trim() ||
    process.env.DATA_ENCRYPTION_KEY?.trim() ||
    configuredSessionSecret ||
    DEVELOPMENT_WEBHOOK_SECRET;
  const dataEncryptionKey =
    process.env.DATA_ENCRYPTION_KEY?.trim() ||
    process.env.WEBHOOK_ENCRYPTION_KEY?.trim() ||
    configuredSessionSecret ||
    DEVELOPMENT_DATA_SECRET;
  const webhookEncryptionKeyId =
    process.env.WEBHOOK_ENCRYPTION_KEY_ID?.trim() ||
    DEVELOPMENT_WEBHOOK_KEY_ID;
  const dataEncryptionKeyId =
    process.env.DATA_ENCRYPTION_KEY_ID?.trim() || DEVELOPMENT_DATA_KEY_ID;
  const webhookEncryptionPreviousKeys = parsePreviousEncryptionKeys(
    process.env.WEBHOOK_ENCRYPTION_PREVIOUS_KEYS,
    "WEBHOOK_ENCRYPTION_PREVIOUS_KEYS",
  );
  const dataEncryptionPreviousKeys = parsePreviousEncryptionKeys(
    process.env.DATA_ENCRYPTION_PREVIOUS_KEYS,
    "DATA_ENCRYPTION_PREVIOUS_KEYS",
  );
  const mfaRecoveryPepper =
    process.env.MFA_RECOVERY_PEPPER?.trim() ||
    DEVELOPMENT_MFA_RECOVERY_PEPPER;
  const mfaRecoveryPepperId =
    process.env.MFA_RECOVERY_PEPPER_ID?.trim() ||
    DEVELOPMENT_MFA_RECOVERY_PEPPER_ID;
  const mfaRecoveryPreviousPeppers = parsePreviousEncryptionKeys(
    process.env.MFA_RECOVERY_PREVIOUS_PEPPERS,
    "MFA_RECOVERY_PREVIOUS_PEPPERS",
  );

  cachedEnvironment = Object.freeze({
    runtimeRole: "app",
    databaseUrl: process.env.DATABASE_URL?.trim() || LOCAL_DATABASE_URL,
    publicAppUrl: optionalOrigin(
      process.env.NEXT_PUBLIC_APP_URL,
      "http://localhost:3000",
    ),
    apiAllowedOrigin: process.env.API_ALLOWED_ORIGIN?.trim() || "*",
    sessionSecret,
    authRateLimitSecret:
      process.env.AUTH_RATE_LIMIT_SECRET?.trim() || sessionSecret,
    caddyTlsAskSecret: process.env.CADDY_TLS_ASK_SECRET?.trim() || null,
    webhookEncryptionKey,
    webhookEncryptionKeyId,
    webhookEncryptionPreviousKeys,
    dataEncryptionKey,
    dataEncryptionKeyId,
    dataEncryptionPreviousKeys,
    mfaRecoveryPepper,
    mfaRecoveryPepperId,
    mfaRecoveryPreviousPeppers,
    privacySubjectHmacSecret:
      process.env.PRIVACY_SUBJECT_HMAC_SECRET?.trim() ||
      DEVELOPMENT_PRIVACY_HMAC_SECRET,
    examSelectionSecret:
      process.env.EXAM_SELECTION_SECRET?.trim() ||
      DEVELOPMENT_EXAM_SELECTION_SECRET,
    cronSecret: process.env.CRON_SECRET?.trim() || null,
    metricsSecret:
      process.env.METRICS_SECRET?.trim() ||
      process.env.CRON_SECRET?.trim() ||
      null,
    trustProxyHeaders: process.env.TRUST_PROXY_HEADERS === "true",
    emailDeliveryRequired:
      process.env.EMAIL_DELIVERY_REQUIRED === "true",
    emailDeliveryWebhookUrl:
      process.env.EMAIL_DELIVERY_WEBHOOK_URL?.trim() || null,
    emailDeliveryWebhookSecret:
      process.env.EMAIL_DELIVERY_WEBHOOK_SECRET?.trim() || null,
    emailDeliveryInboundSecret:
      process.env.EMAIL_DELIVERY_INBOUND_SECRET?.trim() || null,
    legalImprintUrl: process.env.LEGAL_IMPRINT_URL?.trim() || null,
    legalPrivacyUrl: process.env.LEGAL_PRIVACY_URL?.trim() || null,
    supportEmail: process.env.SUPPORT_EMAIL?.trim() || null,
    webPush: resolveWebPushConfiguration(process.env, {
      required: false,
      production: false,
    }),
    mediaStorage: resolveMediaStorageConfiguration(process.env),
  });
  return cachedEnvironment;
}

function appRuntimeEnvironment() {
  const environment = loadRuntimeServerEnvironment();
  if (environment.runtimeRole !== "app") {
    throw new ProductionEnvironmentError([
      "The requested application secret is unavailable in the media worker runtime.",
    ]);
  }
  return environment;
}

export function assertRuntimeServerEnvironment() {
  // Builds compile server modules without runtime secrets. The wrapper sets
  // this process-only marker for Next.js and all of its build workers.
  if (isProductionBuild()) return;
  loadRuntimeServerEnvironment();
}

export function getDatabaseUrl() {
  return loadRuntimeServerEnvironment().databaseUrl;
}

export function getRuntimeRole() {
  return loadRuntimeServerEnvironment().runtimeRole;
}

export function getPublicAppUrl() {
  return appRuntimeEnvironment().publicAppUrl!;
}

export function getApiAllowedOrigin() {
  return appRuntimeEnvironment().apiAllowedOrigin!;
}

export function getSessionSecret() {
  return appRuntimeEnvironment().sessionSecret!;
}

export function getAuthRateLimitSecret() {
  return appRuntimeEnvironment().authRateLimitSecret!;
}

export function getCaddyTlsAskSecret() {
  return appRuntimeEnvironment().caddyTlsAskSecret;
}

export function getWebhookEncryptionKeyringConfiguration() {
  const environment = appRuntimeEnvironment();
  return {
    activeKeyId: environment.webhookEncryptionKeyId!,
    activeSecret: environment.webhookEncryptionKey!,
    previousKeys: environment.webhookEncryptionPreviousKeys!,
  };
}

export function getDataEncryptionKeyringConfiguration() {
  const environment = appRuntimeEnvironment();
  return {
    activeKeyId: environment.dataEncryptionKeyId!,
    activeSecret: environment.dataEncryptionKey!,
    previousKeys: environment.dataEncryptionPreviousKeys!,
  };
}

export function getMfaRecoveryPepperKeyringConfiguration() {
  const environment = appRuntimeEnvironment();
  return {
    activeKeyId: environment.mfaRecoveryPepperId!,
    activeSecret: environment.mfaRecoveryPepper!,
    previousKeys: environment.mfaRecoveryPreviousPeppers!,
  };
}

export function getPrivacySubjectHmacSecret() {
  return appRuntimeEnvironment().privacySubjectHmacSecret!;
}

export function getExamSelectionSecret() {
  return appRuntimeEnvironment().examSelectionSecret!;
}

export function getCronSecret() {
  return loadRuntimeServerEnvironment().cronSecret;
}

export function getMetricsSecret() {
  return loadRuntimeServerEnvironment().metricsSecret;
}

export function trustProxyHeaders() {
  return appRuntimeEnvironment().trustProxyHeaders;
}

export function getEmailDeliveryConfiguration() {
  const environment = appRuntimeEnvironment();
  if (!environment.emailDeliveryWebhookUrl) return null;
  return {
    url: environment.emailDeliveryWebhookUrl,
    secret: environment.emailDeliveryWebhookSecret,
    required: environment.emailDeliveryRequired,
  };
}

export function getEmailDeliveryInboundSecret() {
  return appRuntimeEnvironment().emailDeliveryInboundSecret;
}

export function getPublicLegalLinks() {
  const environment = appRuntimeEnvironment();
  return {
    imprintUrl: environment.legalImprintUrl,
    privacyUrl: environment.legalPrivacyUrl,
    supportEmail: environment.supportEmail,
  };
}

export function getWebPushConfiguration() {
  return appRuntimeEnvironment().webPush;
}

export function getMediaStorageConfiguration() {
  return loadRuntimeServerEnvironment().mediaStorage;
}
