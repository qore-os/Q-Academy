import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import webPush from "web-push";

import {
  ProductionEnvironmentError,
  validateProductionMediaWorkerEnvironment,
  validateProductionServerEnvironment,
  type EnvironmentSource,
} from "../src/lib/server-environment-validation";
import {
  assertDestructiveSeedAllowed,
  assertSeedDatabaseIdentity,
} from "../scripts/seed-guard";

const productionCompose = readFileSync(
  new URL("../compose.production.yml", import.meta.url),
  "utf8",
);
const continuousIntegration = readFileSync(
  new URL("../.github/workflows/ci.yml", import.meta.url),
  "utf8",
);
const playwrightConfiguration = readFileSync(
  new URL("../playwright.config.ts", import.meta.url),
  "utf8",
);
const dockerfile = readFileSync(
  new URL("../Dockerfile", import.meta.url),
  "utf8",
);
const localEnvironmentExample = readFileSync(
  new URL("../.env.example", import.meta.url),
  "utf8",
);
const productionEnvironmentExample = readFileSync(
  new URL("../deploy/.env.production.example", import.meta.url),
  "utf8",
);
const databaseConfigPreflight = readFileSync(
  new URL("../scripts/ops/database-config-preflight.sh", import.meta.url),
  "utf8",
);
const databaseRoleEntrypoint = readFileSync(
  new URL("../scripts/ops/database-role-entrypoint.sh", import.meta.url),
  "utf8",
);
const databasePermissionsEntrypoint = readFileSync(
  new URL(
    "../scripts/ops/database-permissions-entrypoint.sh",
    import.meta.url,
  ),
  "utf8",
);
const productionVapidKeys = webPush.generateVAPIDKeys();

function composeServiceBlock(serviceName: string) {
  const escapedName = serviceName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const start = new RegExp(`^  ${escapedName}:[^\\r\\n]*$`, "m").exec(
    productionCompose,
  );
  assert.ok(start?.index !== undefined, `Missing ${serviceName} service`);

  const remaining = productionCompose.slice(start.index + start[0].length);
  const nextServiceOffset = remaining.search(
    /\r?\n  [a-z0-9][a-z0-9-]*:[^\r\n]*\r?\n/m,
  );
  return productionCompose.slice(
    start.index,
    nextServiceOffset === -1
      ? productionCompose.length
      : start.index + start[0].length + nextServiceOffset,
  );
}

function validMediaWorkerEnvironment(): EnvironmentSource {
  return {
    NODE_ENV: "production",
    Q_ACADEMY_RUNTIME_ROLE: "media-worker",
    DATABASE_URL:
      "postgresql://academy_media:strong-media-db-password@db.internal.q-academy.de/q_academy_prod",
    CRON_SECRET: "Cr0nKey-6QwE2rT8yU4iO9pA1sD5fG7hJ3kLzXcV",
    METRICS_SECRET: "M3trics-8QwE4rT0yU6iO2pA9sD5fG1hJ7kLzXcV",
    MEDIA_STORAGE_DRIVER: "s3",
    MEDIA_S3_ENDPOINT: "https://objects.q-academy.de",
    MEDIA_S3_REGION: "eu-central-1",
    MEDIA_S3_BUCKET: "q-academy-prod-media",
    MEDIA_S3_ACCESS_KEY_ID: "QACADEMYPRODMEDIAWORKER",
    MEDIA_S3_SECRET_ACCESS_KEY:
      "M3diaKey-9QwE5rT1yU7iO3pA8sD4fG6hJ0kLzXcV",
    MEDIA_S3_FORCE_PATH_STYLE: "false",
    MEDIA_CLAMAV_HOST: "clamav.internal.q-academy.de",
    MEDIA_CLAMAV_PORT: "3310",
  };
}

function validProductionEnvironment(): EnvironmentSource {
  return {
    NODE_ENV: "production",
    DATABASE_URL:
      "postgresql://academy:strong-db-password@db.internal.q-academy.de/q_academy_prod",
    APP_DOMAIN: "academy.q-academy.de",
    NEXT_PUBLIC_APP_URL: "https://academy.q-academy.de",
    DEFAULT_ORGANIZATION_SLUG: "q-academy",
    TENANT_BASE_DOMAIN: "tenants.q-academy.de",
    API_ALLOWED_ORIGIN: "https://academy.q-academy.de",
    SESSION_SECRET: "S3ssion-9A5fX1qP7vK2mN8rT4yU6iO0aBcDeFgH",
    AUTH_RATE_LIMIT_SECRET: "R4teLim-2Q8wE6rT1yU9iO3pA7sD5fG0hJkLzXcV",
    CADDY_TLS_ASK_SECRET:
      "C4ddyAsk-3TyU9iO5pA1sD7fG2hJ8kL4zX0cVbNmQ",
    WEBHOOK_ENCRYPTION_KEY: "W3bhook-7ZxC5vB1nM9aS2dF8gH4jK6lQ0wErTyU",
    WEBHOOK_ENCRYPTION_KEY_ID: "webhook-prod-v1",
    DATA_ENCRYPTION_KEY: "D4taKey-8MnB2vC6xZ0aS5dF9gH1jK3lQ7wErTyU",
    DATA_ENCRYPTION_KEY_ID: "data-prod-v1",
    MFA_RECOVERY_PEPPER:
      "MfaCodes-5QwE1rT7yU3iO9pA6sD2fG8hJ4kLzXcV",
    MFA_RECOVERY_PEPPER_ID: "mfa-recovery-prod-v1",
    PRIVACY_SUBJECT_HMAC_SECRET:
      "Pr1vacy-3QwE9rT5yU1iO7pA4sD8fG2hJ6kLzXcV",
    EXAM_SELECTION_SECRET:
      "ExamPick-4WqE0rT6yU2iO8pA5sD9fG3hJ7kLzXcV",
    CRON_SECRET: "Cr0nKey-6QwE2rT8yU4iO9pA1sD5fG7hJ3kLzXcV",
    METRICS_SECRET: "M3trics-8QwE4rT0yU6iO2pA9sD5fG1hJ7kLzXcV",
    TRUST_PROXY_HEADERS: "true",
    ENABLE_DEMO_LOGIN: "false",
    EMAIL_DELIVERY_REQUIRED: "true",
    EMAIL_DELIVERY_WEBHOOK_URL:
      "https://mailer.q-academy.de/hooks/transactional-email",
    EMAIL_DELIVERY_WEBHOOK_SECRET:
      "M4ilKey-1QwE7rT3yU9iO5pA2sD8fG6hJ0kLzXcV",
    EMAIL_DELIVERY_INBOUND_SECRET:
      "M4ilInbound-8RwT4yU0iO6pA3sD9fG5hJ1kL7zXcVb",
    LEGAL_IMPRINT_URL: "https://legal.q-academy.de/impressum",
    LEGAL_PRIVACY_URL: "https://legal.q-academy.de/datenschutz",
    SUPPORT_EMAIL: "support@q-academy.de",
    WEB_PUSH_VAPID_PUBLIC_KEY: productionVapidKeys.publicKey,
    WEB_PUSH_VAPID_PRIVATE_KEY: productionVapidKeys.privateKey,
    WEB_PUSH_VAPID_SUBJECT: "mailto:push@q-academy.de",
    MEDIA_STORAGE_DRIVER: "s3",
    MEDIA_S3_ENDPOINT: "https://objects.q-academy.de",
    MEDIA_S3_REGION: "eu-central-1",
    MEDIA_S3_BUCKET: "q-academy-prod-media",
    MEDIA_S3_ACCESS_KEY_ID: "QACADEMYPRODMEDIA",
    MEDIA_S3_SECRET_ACCESS_KEY:
      "M3diaKey-9QwE5rT1yU7iO3pA8sD4fG6hJ0kLzXcV",
    MEDIA_S3_FORCE_PATH_STYLE: "false",
    MEDIA_CLAMAV_HOST: "clamav.internal.q-academy.de",
    MEDIA_CLAMAV_PORT: "3310",
  };
}

test("production environment accepts explicit secure and distinct values", () => {
  const result = validateProductionServerEnvironment(
    validProductionEnvironment(),
  );
  assert.ok(result);
  assert.equal(result.publicAppUrl, "https://academy.q-academy.de");
  assert.equal(result.trustProxyHeaders, true);
  assert.notEqual(result.metricsSecret, result.cronSecret);
  assert.equal(result.mfaRecoveryPepperId, "mfa-recovery-prod-v1");
  assert.deepEqual(result.mfaRecoveryPreviousPeppers, {});
  assert.equal(result.mediaStorage.driver, "s3");
  assert.equal(result.mediaStorage.bucket, "q-academy-prod-media");
  assert.equal(
    result.emailDeliveryWebhookUrl,
    "https://mailer.q-academy.de/hooks/transactional-email",
  );
  assert.equal(
    result.emailDeliveryInboundSecret,
    "M4ilInbound-8RwT4yU0iO6pA3sD9fG5hJ1kL7zXcVb",
  );
  assert.equal(result.webPush.publicKey, productionVapidKeys.publicKey);
  assert.equal(
    result.caddyTlsAskSecret,
    "C4ddyAsk-3TyU9iO5pA1sD7fG2hJ8kL4zX0cVbNmQ",
  );
});

test("canonical production tenant configuration is explicit and fail-closed", () => {
  const app = composeServiceBlock("app");
  assert.match(
    app,
    /APP_DOMAIN: \$\{APP_DOMAIN:\?Set APP_DOMAIN in the production env file\}/,
  );
  assert.match(localEnvironmentExample, /^APP_DOMAIN=localhost$/m);
  assert.match(productionEnvironmentExample, /^APP_DOMAIN=academy\.example\.com$/m);
  assert.match(
    productionEnvironmentExample,
    /^DEFAULT_ORGANIZATION_SLUG=q-academy$/m,
  );

  for (const [name, value, expected] of [
    ["APP_DOMAIN", undefined, /APP_DOMAIN is required/],
    ["APP_DOMAIN", "https://academy.q-academy.de", /APP_DOMAIN must be a publicly qualified/],
    ["DEFAULT_ORGANIZATION_SLUG", "Q Academy", /DEFAULT_ORGANIZATION_SLUG/],
    ["TENANT_BASE_DOMAIN", "https://tenants.q-academy.de", /TENANT_BASE_DOMAIN/],
    ["TENANT_BASE_DOMAIN", "tenants.internal", /TENANT_BASE_DOMAIN/],
  ] as const) {
    const environment = validProductionEnvironment();
    if (value === undefined) delete environment[name];
    else environment[name] = value;
    assert.throws(
      () => validateProductionServerEnvironment(environment),
      expected,
      name,
    );
  }

  const mismatch = validProductionEnvironment();
  mismatch.APP_DOMAIN = "login.q-academy.de";
  assert.throws(
    () => validateProductionServerEnvironment(mismatch),
    /APP_DOMAIN must exactly match the hostname in NEXT_PUBLIC_APP_URL/,
  );

  const missingAskSecret = validProductionEnvironment();
  delete missingAskSecret.CADDY_TLS_ASK_SECRET;
  assert.throws(
    () => validateProductionServerEnvironment(missingAskSecret),
    /CADDY_TLS_ASK_SECRET is required/,
  );
});

test("monitoring credentials cannot dispatch application or media jobs", () => {
  const application = validProductionEnvironment();
  application.METRICS_SECRET = application.CRON_SECRET;
  assert.throws(
    () => validateProductionServerEnvironment(application),
    /CRON_SECRET and METRICS_SECRET must use distinct values/,
  );

  const media = validMediaWorkerEnvironment();
  media.METRICS_SECRET = media.CRON_SECRET;
  assert.throws(
    () => validateProductionMediaWorkerEnvironment(media),
    /CRON_SECRET and METRICS_SECRET must use distinct values/,
  );
});

test("production media worker accepts only its database, job and storage secrets", () => {
  const environment = validMediaWorkerEnvironment();
  const result = validateProductionMediaWorkerEnvironment(environment);
  assert.ok(result);
  assert.equal(result.mediaStorage.bucket, "q-academy-prod-media");

  for (const [name, value] of [
    ["MFA_RECOVERY_PEPPER", "MfaWorkerLeak-1QwE7rT3yU9iO5pA2sD8fG4hJ0kLzXcV"],
    ["MFA_RECOVERY_PEPPER_ID", "mfa-recovery-leak-v1"],
    [
      "MFA_RECOVERY_PREVIOUS_PEPPERS",
      '{"mfa-recovery-old":"MfaWorkerOld-2WqE8rT4yU0iO6pA3sD9fG5hJ1kLzXcV"}',
    ],
    ["WEB_PUSH_VAPID_PUBLIC_KEY", productionVapidKeys.publicKey],
    ["WEB_PUSH_VAPID_PRIVATE_KEY", productionVapidKeys.privateKey],
    ["WEB_PUSH_VAPID_SUBJECT", "mailto:push@q-academy.de"],
    [
      "CADDY_TLS_ASK_SECRET",
      "C4ddyWorkerLeak-8TyU4iO0pA6sD2fG9hJ5kL1zX7cVbNmQ",
    ],
  ] as const) {
    const leaked = { ...validMediaWorkerEnvironment(), [name]: value };
    assert.throws(
      () => validateProductionMediaWorkerEnvironment(leaked),
      new RegExp(`${name} must be unset`),
    );
  }

  environment.SESSION_SECRET =
    "S3ssion-9A5fX1qP7vK2mN8rT4yU6iO0aBcDeFgH";
  assert.throws(
    () => validateProductionMediaWorkerEnvironment(environment),
    /SESSION_SECRET must be unset/,
  );
  assert.throws(
    () => validateProductionServerEnvironment(validMediaWorkerEnvironment()),
    /Q_ACADEMY_RUNTIME_ROLE must be 'app'/,
  );
});

test("production isolates media scans from the public app runtime", () => {
  const databaseRole = composeServiceBlock("database-role");
  const databasePermissions = composeServiceBlock("database-permissions");
  const databasePreflight = composeServiceBlock("database-config-preflight");
  const migrate = composeServiceBlock("migrate");
  const keyRotation = composeServiceBlock("key-rotation");
  const postgres = composeServiceBlock("postgres");
  const app = composeServiceBlock("app");
  const mediaRunner = composeServiceBlock("media-runner");
  const mediaWorker = composeServiceBlock("media-worker");
  const mediaMaintenance = composeServiceBlock("media-maintenance");
  const freshclam = composeServiceBlock("clamav-freshclam");
  const clamav = composeServiceBlock("clamav");

  assert.match(
    postgres,
    /POSTGRES_INITDB_ARGS: "--data-checksums --encoding=UTF8"/,
  );
  assert.match(postgres, /POSTGRES_USER: \$\{POSTGRES_BOOTSTRAP_USER:/);
  assert.match(postgres, /POSTGRES_PASSWORD: \$\{POSTGRES_BOOTSTRAP_PASSWORD:/);
  assert.doesNotMatch(postgres, /OWNER_POSTGRES_PASSWORD/);
  assert.match(
    postgres,
    /database-config-preflight:\s+condition: service_completed_successfully/,
  );
  assert.match(databasePreflight, /network_mode: none/);
  assert.match(
    databasePreflight,
    /\/opt\/q-academy\/database-config-preflight\.sh/,
  );
  assert.match(app, /^  app: &app-runtime$/m);
  assert.match(app, /Q_ACADEMY_RUNTIME_ROLE: app/);
  assert.match(app, /CRON_SECRET: \$\{CRON_SECRET:/);
  assert.match(app, /METRICS_SECRET: \$\{METRICS_SECRET:/);
  assert.match(app, /^      database:$/m);
  assert.match(app, /^      tls-ask:$/m);
  assert.match(app, /^          - tls-ask-app$/m);
  assert.doesNotMatch(app, /^      - media-database$/m);
  assert.match(app, /MEDIA_S3_APP_ACCESS_KEY_ID/);
  assert.match(app, /MEDIA_S3_APP_SECRET_ACCESS_KEY/);
  assert.match(app, /WEBHOOK_ENCRYPTION_KEY_ID/);
  assert.match(app, /WEBHOOK_ENCRYPTION_PREVIOUS_KEYS/);
  assert.match(app, /DATA_ENCRYPTION_KEY_ID/);
  assert.match(app, /DATA_ENCRYPTION_PREVIOUS_KEYS/);
  assert.match(app, /MFA_RECOVERY_PEPPER:/);
  assert.match(app, /MFA_RECOVERY_PEPPER_ID:/);
  assert.match(app, /MFA_RECOVERY_PREVIOUS_PEPPERS:/);
  assert.match(app, /PRIVACY_SUBJECT_HMAC_SECRET/);
  assert.match(app, /EXAM_SELECTION_SECRET/);
  assert.doesNotMatch(app, /^      - media$/m);
  assert.match(app, /cpus: "2\.0"/);
  assert.match(app, /memory: 2G/);
  assert.match(mediaRunner, /^    <<: \*app-runtime$/m);
  assert.match(mediaRunner, /Q_ACADEMY_RUNTIME_ROLE: media-worker/);
  assert.match(mediaRunner, /MEDIA_POSTGRES_USER/);
  assert.match(mediaRunner, /MEDIA_S3_ACCESS_KEY_ID/);
  assert.doesNotMatch(mediaRunner, /MEDIA_S3_APP_ACCESS_KEY_ID/);
  assert.doesNotMatch(mediaRunner, /SESSION_SECRET/);
  assert.doesNotMatch(mediaRunner, /AUTH_RATE_LIMIT_SECRET/);
  assert.doesNotMatch(mediaRunner, /WEBHOOK_ENCRYPTION_KEY/);
  assert.doesNotMatch(mediaRunner, /DATA_ENCRYPTION_KEY/);
  assert.doesNotMatch(mediaRunner, /MFA_RECOVERY_/);
  assert.doesNotMatch(mediaRunner, /PRIVACY_SUBJECT_HMAC_SECRET/);
  assert.doesNotMatch(mediaRunner, /EXAM_SELECTION_SECRET/);
  assert.doesNotMatch(mediaRunner, /EMAIL_DELIVERY_WEBHOOK/);
  assert.doesNotMatch(mediaRunner, /AI_API_KEY/);
  assert.match(mediaRunner, /CRON_SECRET: \$\{MEDIA_CRON_SECRET:/);
  assert.match(mediaRunner, /METRICS_SECRET: \$\{MEDIA_METRICS_SECRET:/);
  assert.match(mediaRunner, /^      - media-database$/m);
  assert.doesNotMatch(mediaRunner, /^      - database$/m);
  assert.match(mediaRunner, /^      - media$/m);
  assert.match(mediaRunner, /^      - jobs$/m);
  assert.match(mediaRunner, /^      - egress$/m);
  assert.doesNotMatch(mediaRunner, /^      - proxy$/m);
  assert.match(mediaRunner, /media_next_cache:\/app\/\.next\/cache/);
  assert.match(mediaRunner, /cpus: "2\.0"/);
  assert.match(mediaRunner, /memory: 2G/);
  assert.match(mediaRunner, /MEDIA_CLAMAV_SIGNATURE_DIRECTORY/);
  assert.match(mediaRunner, /clamav_signatures/);
  assert.match(mediaRunner, /read_only: true/);
  assert.match(mediaRunner, /^      clamav:$/m);
  assert.match(mediaRunner, /^        condition: service_healthy$/m);

  assert.match(mediaWorker, /deploy:\s+replicas: 2/);
  assert.match(mediaWorker, /CRON_SECRET: \$\{MEDIA_CRON_SECRET:/);
  assert.match(
    mediaWorker,
    /http:\/\/media-runner:3000\/api\/internal\/jobs\/media\/dispatch\?limit=1/,
  );
  assert.match(mediaWorker, /^      - jobs$/m);
  assert.doesNotMatch(mediaWorker, /^      - proxy$/m);
  assert.doesNotMatch(mediaWorker, /http:\/\/app:3000\/api\/internal\/jobs\/media/);
  assert.doesNotMatch(mediaWorker, /\/media\/maintenance/);

  assert.match(mediaMaintenance, /deploy:\s+replicas: 1/);
  assert.match(mediaMaintenance, /CRON_SECRET: \$\{MEDIA_CRON_SECRET:/);
  assert.match(
    mediaMaintenance,
    /http:\/\/media-runner:3000\/api\/internal\/jobs\/media\/maintenance\?limit=5/,
  );
  assert.match(mediaMaintenance, /^      - jobs$/m);
  assert.doesNotMatch(mediaMaintenance, /^      - proxy$/m);
  assert.doesNotMatch(mediaMaintenance, /http:\/\/app:3000/);
  assert.match(
    mediaMaintenance,
    /MEDIA_MAINTENANCE_INTERVAL_SECONDS.*-lt 30/,
  );
  assert.match(mediaMaintenance, /--max-time 550/);
  assert.equal(
    productionCompose.match(/\/api\/internal\/jobs\/media\/maintenance/g)
      ?.length,
    1,
  );

  assert.match(freshclam, /image: \$\{CLAMAV_IMAGE:\?/);
  assert.match(freshclam, /CLAMAV_NO_CLAMD: "true"/);
  assert.match(freshclam, /CLAMAV_NO_FRESHCLAMD: "false"/);
  assert.match(freshclam, /FRESHCLAM_CHECKS/);
  assert.match(freshclam, /^      - egress$/m);
  assert.doesNotMatch(freshclam, /^      - media$/m);
  assert.match(freshclam, /clamav_signatures:\/var\/lib\/clamav\s*$/m);
  assert.match(freshclam, /user: clamav/);
  assert.match(freshclam, /entrypoint: \["\/init-unprivileged"\]/);
  assert.match(freshclam, /read_only: true/);
  assert.match(freshclam, /cap_drop:\s+- ALL/);

  assert.match(clamav, /cpus: "3\.0"/);
  assert.match(clamav, /memory: 5G/);
  assert.match(clamav, /CLAMAV_NO_FRESHCLAMD: "true"/);
  assert.match(clamav, /clamav-freshclam:\s+condition: service_healthy/);
  assert.match(clamav, /clamav_signatures:\/var\/lib\/clamav:ro/);
  assert.match(clamav, /^      - media$/m);
  assert.doesNotMatch(clamav, /^      - egress$/m);
  assert.match(clamav, /user: clamav/);
  assert.match(clamav, /entrypoint: \["\/init-unprivileged"\]/);
  assert.match(clamav, /read_only: true/);
  assert.match(clamav, /cap_drop:\s+- ALL/);
  assert.match(productionCompose, /^  jobs:\s+driver: bridge\s+internal: true$/m);
  assert.match(productionCompose, /^  media-database:\s+driver: bridge\s+internal: true$/m);
  assert.match(postgres, /^      - database$/m);
  assert.match(postgres, /^      - media-database$/m);

  assert.match(databaseRole, /MEDIA_DATABASE_USER/);
  assert.match(databaseRole, /MEDIA_DATABASE_PASSWORD/);
  assert.match(databaseRole, /OWNER_DATABASE_USER: \$\{OWNER_POSTGRES_USER:/);
  assert.match(databaseRole, /OWNER_DATABASE_PASSWORD: \$\{OWNER_POSTGRES_PASSWORD:/);
  assert.match(databaseRole, /database-role-entrypoint\.sh/);
  assert.match(databaseRoleEntrypoint, /alter role :"owner_user" with login password/);
  assert.match(
    databaseRoleEntrypoint,
    /nosuperuser nocreatedb nocreaterole noreplication nobypassrls noinherit/,
  );
  assert.match(databaseRoleEntrypoint, /alter database :"db_name" owner to :"owner_user"/);
  assert.match(databaseRoleEntrypoint, /alter schema public owner to :"owner_user"/);
  assert.match(databaseRoleEntrypoint, /q_academy\.bootstrap_role/);
  assert.match(databaseRoleEntrypoint, /role names are immutable/);
  assert.match(databaseRoleEntrypoint, /pg_auth_members/);
  assert.match(databaseConfigPreflight, /exactly 64 hexadecimal characters/);
  assert.match(databaseConfigPreflight, /All PostgreSQL role names must be distinct/);
  assert.match(databaseConfigPreflight, /All PostgreSQL passwords must be distinct/);
  assert.match(migrate, /OWNER_POSTGRES_USER/);
  assert.match(migrate, /OWNER_POSTGRES_PASSWORD/);
  assert.doesNotMatch(migrate, /POSTGRES_BOOTSTRAP_/);
  assert.match(databasePermissions, /PGUSER: \$\{OWNER_POSTGRES_USER:/);
  assert.match(databasePermissions, /PGPASSWORD: \$\{OWNER_POSTGRES_PASSWORD:/);
  assert.match(databasePermissions, /database-permissions-entrypoint\.sh/);
  assert.match(databasePermissionsEntrypoint, /begin;[\s\S]*commit;/);
  assert.match(databasePermissionsEntrypoint, /grant select, update, delete on table public\.media_assets/);
  assert.match(databasePermissionsEntrypoint, /grant select \(id, organization_id, avatar_url\) on table public\.users/);
  assert.doesNotMatch(databasePermissionsEntrypoint, /grant select on table public\.users/);
  assert.match(databasePermissionsEntrypoint, /has_column_privilege\(:'media_user', 'public\.users', 'email'/);
  assert.match(databasePermissionsEntrypoint, /on table public\.submission_attachments to :"media_user"/);
  assert.match(databasePermissionsEntrypoint, /on table public\.course_media_assets to :"media_user"/);
  assert.match(databasePermissionsEntrypoint, /on table public\.community_asset_bindings to :"media_user"/);
  assert.doesNotMatch(databasePermissionsEntrypoint, /public\.community_post_attachments/);
  assert.doesNotMatch(databasePermissionsEntrypoint, /public\.community_comment_attachments/);
  assert.match(databasePermissionsEntrypoint, /custom_field_values enable row level security/);
  assert.match(databasePermissionsEntrypoint, /data_profile_values enable row level security/);
  assert.match(databasePermissionsEntrypoint, /platform_settings enable row level security/);
  assert.match(databasePermissionsEntrypoint, /definition\.type = 'media'/);
  assert.match(databasePermissionsEntrypoint, /using \(key = 'design'\)/);
  assert.match(databasePermissionsEntrypoint, /public\.media_processing_jobs/);
  assert.match(databasePermissionsEntrypoint, /public\.media_asset_derivatives/);
  assert.match(databasePermissionsEntrypoint, /public\.media_asset_transcripts/);
  assert.match(databasePermissionsEntrypoint, /security definer/);
  assert.match(databasePermissionsEntrypoint, /set search_path to pg_catalog, public/);
  assert.match(databasePermissionsEntrypoint, /revoke all on function[\s\S]*from public/);
  assert.match(keyRotation, /profiles: \["operations"\]/);
  assert.match(keyRotation, /target: key-rotation/);
  assert.match(keyRotation, /APP_POSTGRES_USER/);
  assert.match(keyRotation, /WEBHOOK_ENCRYPTION_PREVIOUS_KEYS/);
  assert.match(keyRotation, /DATA_ENCRYPTION_PREVIOUS_KEYS/);
  assert.doesNotMatch(keyRotation, /MFA_RECOVERY_/);
  assert.doesNotMatch(keyRotation, /SESSION_SECRET/);
  assert.doesNotMatch(keyRotation, /CRON_SECRET/);
  assert.doesNotMatch(keyRotation, /MEDIA_S3/);
  assert.doesNotMatch(keyRotation, /PRIVACY_SUBJECT_HMAC_SECRET/);
  assert.doesNotMatch(keyRotation, /EXAM_SELECTION_SECRET/);
  assert.doesNotMatch(
    databasePermissionsEntrypoint,
    /grant select, insert, update, delete on all tables in schema public\s+to :"media_user"/,
  );
  assert.match(continuousIntegration, /^          MEDIA_POSTGRES_PASSWORD:/m);
  assert.match(continuousIntegration, /^          POSTGRES_BOOTSTRAP_USER:/m);
  assert.match(continuousIntegration, /^          POSTGRES_BOOTSTRAP_PASSWORD: [a-f0-9]{64}$/m);
  assert.match(continuousIntegration, /^          OWNER_POSTGRES_USER:/m);
  assert.match(continuousIntegration, /^          OWNER_POSTGRES_PASSWORD: [a-f0-9]{64}$/m);
  assert.match(continuousIntegration, /^      CRON_SECRET: [a-f0-9]{64}$/m);
  assert.match(continuousIntegration, /^      METRICS_SECRET: [a-f0-9]{64}$/m);
  assert.match(continuousIntegration, /^      MFA_RECOVERY_PEPPER: \S{32,}$/m);
  assert.match(
    continuousIntegration,
    /^      MFA_RECOVERY_PEPPER_ID: mfa-recovery-ci-v1$/m,
  );
  assert.match(
    continuousIntegration,
    /^      MFA_RECOVERY_PREVIOUS_PEPPERS: '\{"mfa-recovery-ci-v0":/m,
  );
  assert.match(continuousIntegration, /^          MEDIA_CRON_SECRET: [a-f0-9]{64}$/m);
  assert.match(continuousIntegration, /^          MEDIA_METRICS_SECRET: [a-f0-9]{64}$/m);
  assert.match(continuousIntegration, /^          MEDIA_S3_APP_ACCESS_KEY_ID:/m);
  assert.match(continuousIntegration, /^          MEDIA_S3_APP_SECRET_ACCESS_KEY:/m);
  assert.match(
    continuousIntegration,
    /Q_ACADEMY_RUNTIME_ROLE=media-worker[^]*-e DATABASE_URL="\$RUNTIME_MEDIA_DATABASE_URL"/,
  );
  assert.match(continuousIntegration, /RUNTIME_OWNER_DATABASE_URL:/);
  assert.match(
    continuousIntegration,
    /-e DATABASE_URL="\$RUNTIME_OWNER_DATABASE_URL" \\[^]*"q-academy-migrator:\$Q_ACADEMY_CI_RELEASE_TAG"/,
  );
  assert.match(continuousIntegration, /q_academy_ci_app/);
  assert.match(continuousIntegration, /security definer/);
  assert.match(
    continuousIntegration,
    /grant select, update, delete on table public\.media_assets to q_academy_ci_media/,
  );
  for (const table of [
    "media_processing_jobs",
    "media_asset_derivatives",
    "media_asset_transcripts",
  ]) {
    assert.match(
      continuousIntegration,
      new RegExp(
        `grant select, insert, update, delete on table public\\.${table} to q_academy_ci_media`,
      ),
    );
  }
  for (const table of [
    "organizations",
    "users",
    "custom_field_definitions",
    "custom_field_values",
    "data_profile_values",
    "platform_settings",
  ]) {
    assert.match(continuousIntegration, new RegExp(`public\\.${table}`));
  }
  assert.match(
    continuousIntegration,
    /revoke all on all sequences in schema public from q_academy_ci_media/,
  );
  assert.match(
    continuousIntegration,
    /grant select \(course_id, organization_id, media_asset_id\) on table public\.course_media_assets to q_academy_ci_media/,
  );
  assert.doesNotMatch(
    continuousIntegration,
    /grant select .*public\.community_post_attachments to q_academy_ci_media/,
  );
  assert.doesNotMatch(
    continuousIntegration,
    /grant select .*public\.community_comment_attachments to q_academy_ci_media/,
  );
  assert.match(
    continuousIntegration,
    /grant select \(media_asset_id, organization_id\) on table public\.community_asset_bindings to q_academy_ci_media/,
  );
  assert.match(
    continuousIntegration,
    /api\/internal\/jobs\/media\/dispatch\?limit=1/,
  );
  assert.match(playwrightConfiguration, /^  workers: 1,$/m);
  assert.match(continuousIntegration, /run: npm run test:e2e$/m);
  assert.match(
    continuousIntegration,
    /--target key-rotation[^]*-t "q-academy-key-rotation:\$Q_ACADEMY_CI_RELEASE_TAG"/,
  );
  assert.match(
    continuousIntegration,
    /"q-academy-key-rotation:\$Q_ACADEMY_CI_RELEASE_TAG" --check/,
  );
  assert.match(
    continuousIntegration,
    /"q-academy-key-rotation:\$Q_ACADEMY_CI_RELEASE_TAG" --check\)"[^]*"mfaTotpSecrets":0/,
  );
  assert.match(
    continuousIntegration,
    /Q_ACADEMY_RUNTIME_ROLE=app[^]*-e MFA_RECOVERY_PEPPER="\$MFA_RECOVERY_PEPPER"[^]*-e MFA_RECOVERY_PEPPER_ID="\$MFA_RECOVERY_PEPPER_ID"[^]*-e MFA_RECOVERY_PREVIOUS_PEPPERS="\$MFA_RECOVERY_PREVIOUS_PEPPERS"/,
  );
  assert.match(continuousIntegration, /Generate disposable CI VAPID keys/);
  assert.match(
    continuousIntegration,
    /-e WEB_PUSH_VAPID_PRIVATE_KEY="\$WEB_PUSH_VAPID_PRIVATE_KEY"/,
  );
});

test("MFA rotation secrets are documented and packaged for the correct runtimes", () => {
  for (const name of [
    "DATA_ENCRYPTION_KEY_ID",
    "DATA_ENCRYPTION_PREVIOUS_KEYS",
    "MFA_RECOVERY_PEPPER",
    "MFA_RECOVERY_PEPPER_ID",
    "MFA_RECOVERY_PREVIOUS_PEPPERS",
  ]) {
    assert.match(localEnvironmentExample, new RegExp(`^${name}=`, "m"));
    assert.match(productionEnvironmentExample, new RegExp(`^${name}=`, "m"));
  }
  assert.match(
    productionEnvironmentExample,
    /mfaTotpSecrets: 0/,
  );
  assert.match(
    productionEnvironmentExample,
    /Recovery hashes cannot be rewritten without the original code/,
  );
  assert.match(dockerfile, /^FROM base AS key-rotation$/m);
  assert.match(
    dockerfile,
    /COPY --chown=nextjs:nodejs scripts\/rotate-encryption-keys\.ts \.\/scripts\//,
  );
  assert.match(
    dockerfile,
    /ENTRYPOINT \["\.\/node_modules\/\.bin\/tsx", "scripts\/rotate-encryption-keys\.ts"\]/,
  );
});

test("web push credentials are required only by the public app runtime", () => {
  for (const name of [
    "WEB_PUSH_VAPID_PUBLIC_KEY",
    "WEB_PUSH_VAPID_PRIVATE_KEY",
    "WEB_PUSH_VAPID_SUBJECT",
  ]) {
    assert.match(localEnvironmentExample, new RegExp(`^${name}=`, "m"));
    assert.match(productionEnvironmentExample, new RegExp(`^${name}=`, "m"));
    assert.match(composeServiceBlock("app"), new RegExp(`${name}:`));
  }
  const missing = validProductionEnvironment();
  delete missing.WEB_PUSH_VAPID_PRIVATE_KEY;
  assert.throws(
    () => validateProductionServerEnvironment(missing),
    /WEB_PUSH_VAPID_PRIVATE_KEY is required/,
  );
});

test("production environment rejects local defaults, insecure origins and placeholders", () => {
  const environment = validProductionEnvironment();
  environment.DATABASE_URL =
    "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";
  environment.NEXT_PUBLIC_APP_URL = "http://localhost:3000";
  environment.API_ALLOWED_ORIGIN = "*";
  environment.SESSION_SECRET = "replace-with-at-least-32-random-characters";
  environment.AUTH_RATE_LIMIT_SECRET = environment.WEBHOOK_ENCRYPTION_KEY;
  environment.ENABLE_DEMO_LOGIN = "true";
  environment.DEMO_API_KEY = "qak_demo_qacademy_2026_local_development";

  assert.throws(
    () => validateProductionServerEnvironment(environment),
    (error: unknown) => {
      assert.ok(error instanceof ProductionEnvironmentError);
      const message = error.message;
      assert.match(message, /DATABASE_URL/);
      assert.match(message, /NEXT_PUBLIC_APP_URL/);
      assert.match(message, /API_ALLOWED_ORIGIN/);
      assert.match(message, /SESSION_SECRET/);
      assert.match(message, /distinct/);
      assert.match(message, /ENABLE_DEMO_LOGIN/);
      assert.match(message, /DEMO_API_KEY/);
      assert.doesNotMatch(message, /S3ssion-/);
      return true;
    },
  );
});

test("production environment rejects reserved example hostnames", () => {
  const environment = validProductionEnvironment();
  environment.NEXT_PUBLIC_APP_URL = "https://academy.example.com";
  environment.API_ALLOWED_ORIGIN = "https://academy.test";
  environment.EMAIL_DELIVERY_WEBHOOK_URL =
    "https://mailer.example.org/hooks/transactional-email";
  environment.LEGAL_IMPRINT_URL = "https://legal.invalid/impressum";
  environment.SUPPORT_EMAIL = "support@example.com";

  assert.throws(
    () => validateProductionServerEnvironment(environment),
    (error: unknown) => {
      assert.ok(error instanceof ProductionEnvironmentError);
      assert.match(error.message, /reserved example/);
      assert.match(error.message, /SUPPORT_EMAIL/);
      return true;
    },
  );
});

test("production environment requires least-privilege database credentials", () => {
  const missingCredentials = validProductionEnvironment();
  missingCredentials.DATABASE_URL =
    "postgresql://db.internal.q-academy.de/q_academy_prod";
  assert.throws(
    () => validateProductionServerEnvironment(missingCredentials),
    /explicit database credentials/,
  );

  const superuser = validProductionEnvironment();
  superuser.DATABASE_URL =
    "postgresql://postgres:Strong-7QwE2rT8yU4iO9pA@db.internal.q-academy.de/q_academy_prod";
  assert.throws(
    () => validateProductionServerEnvironment(superuser),
    /must not use the PostgreSQL superuser/,
  );

  const weakPassword = validProductionEnvironment();
  weakPassword.DATABASE_URL =
    "postgresql://academy:short@db.internal.q-academy.de/q_academy_prod";
  assert.throws(
    () => validateProductionServerEnvironment(weakPassword),
    /at least 16 characters/,
  );
});

test("production requires complete and authenticated mail delivery", () => {
  const incomplete = validProductionEnvironment();
  delete incomplete.EMAIL_DELIVERY_WEBHOOK_URL;
  assert.throws(
    () => validateProductionServerEnvironment(incomplete),
    /EMAIL_DELIVERY_WEBHOOK_URL/,
  );

  const missingInbound = validProductionEnvironment();
  delete missingInbound.EMAIL_DELIVERY_INBOUND_SECRET;
  assert.throws(
    () => validateProductionServerEnvironment(missingInbound),
    /EMAIL_DELIVERY_INBOUND_SECRET/,
  );

  const reusedInbound = validProductionEnvironment();
  reusedInbound.EMAIL_DELIVERY_INBOUND_SECRET =
    reusedInbound.EMAIL_DELIVERY_WEBHOOK_SECRET;
  assert.throws(
    () => validateProductionServerEnvironment(reusedInbound),
    /must use distinct values/,
  );

  const disabled = validProductionEnvironment();
  disabled.EMAIL_DELIVERY_REQUIRED = "false";
  assert.throws(
    () => validateProductionServerEnvironment(disabled),
    /EMAIL_DELIVERY_REQUIRED must be true/,
  );

  const configured = validateProductionServerEnvironment(
    validProductionEnvironment(),
  );
  assert.equal(configured?.emailDeliveryRequired, true);
  assert.equal(
    configured?.emailDeliveryWebhookUrl,
    "https://mailer.q-academy.de/hooks/transactional-email",
  );
});

test("production environment rejects invalid operational retention policies", () => {
  const environment = validProductionEnvironment();
  environment.EMAIL_DELIVERY_RETENTION_DAYS = "0";
  environment.WEBHOOK_DELIVERY_RETENTION_DAYS = "forever";

  assert.throws(
    () => validateProductionServerEnvironment(environment),
    (error: unknown) => {
      assert.ok(error instanceof ProductionEnvironmentError);
      assert.match(error.message, /EMAIL_DELIVERY_RETENTION_DAYS/);
      return true;
    },
  );
});

test("production encryption keyrings require keyed distinct strong read keys", () => {
  const valid = validProductionEnvironment();
  valid.DATA_ENCRYPTION_PREVIOUS_KEYS = JSON.stringify({
    "data-prod-legacy": "L3gacyData-7QwE2rT8yU4iO9pA1sD5fG6hJ0kLzXcV",
  });
  valid.MFA_RECOVERY_PREVIOUS_PEPPERS = JSON.stringify({
    "mfa-recovery-prod-legacy":
      "L3gacyMfa-6QwE2rT8yU4iO0pA1sD5fG7hJ3kLzXcV",
  });
  const parsed = validateProductionServerEnvironment(valid);
  assert.equal(parsed?.dataEncryptionKeyId, "data-prod-v1");
  assert.equal(
    parsed?.dataEncryptionPreviousKeys["data-prod-legacy"],
    "L3gacyData-7QwE2rT8yU4iO9pA1sD5fG6hJ0kLzXcV",
  );
  assert.equal(parsed?.mfaRecoveryPepperId, "mfa-recovery-prod-v1");
  assert.equal(
    parsed?.mfaRecoveryPreviousPeppers["mfa-recovery-prod-legacy"],
    "L3gacyMfa-6QwE2rT8yU4iO0pA1sD5fG7hJ3kLzXcV",
  );

  const missingId = validProductionEnvironment();
  delete missingId.DATA_ENCRYPTION_KEY_ID;
  assert.throws(
    () => validateProductionServerEnvironment(missingId),
    /DATA_ENCRYPTION_KEY_ID is required/,
  );

  const missingPepperId = validProductionEnvironment();
  delete missingPepperId.MFA_RECOVERY_PEPPER_ID;
  assert.throws(
    () => validateProductionServerEnvironment(missingPepperId),
    /MFA_RECOVERY_PEPPER_ID is required/,
  );

  const malformed = validProductionEnvironment();
  malformed.WEBHOOK_ENCRYPTION_PREVIOUS_KEYS = "not-json";
  assert.throws(
    () => validateProductionServerEnvironment(malformed),
    /WEBHOOK_ENCRYPTION_PREVIOUS_KEYS must be a JSON object/,
  );

  const malformedPeppers = validProductionEnvironment();
  malformedPeppers.MFA_RECOVERY_PREVIOUS_PEPPERS = "not-json";
  assert.throws(
    () => validateProductionServerEnvironment(malformedPeppers),
    /MFA_RECOVERY_PREVIOUS_PEPPERS must be a JSON object/,
  );

  const reused = validProductionEnvironment();
  reused.DATA_ENCRYPTION_PREVIOUS_KEYS = JSON.stringify({
    "data-prod-old": reused.DATA_ENCRYPTION_KEY,
  });
  assert.throws(
    () => validateProductionServerEnvironment(reused),
    /reuses another key's secret|must use distinct values/,
  );

  const reusedPepper = validProductionEnvironment();
  reusedPepper.MFA_RECOVERY_PREVIOUS_PEPPERS = JSON.stringify({
    "mfa-recovery-prod-old": reusedPepper.DATA_ENCRYPTION_KEY,
  });
  assert.throws(
    () => validateProductionServerEnvironment(reusedPepper),
    /must use distinct values/,
  );
});

test("production requires public legal and support contacts", () => {
  const environment = validProductionEnvironment();
  delete environment.LEGAL_IMPRINT_URL;
  environment.LEGAL_PRIVACY_URL = "http://localhost/privacy";
  environment.SUPPORT_EMAIL = "not-an-email";

  assert.throws(
    () => validateProductionServerEnvironment(environment),
    (error: unknown) => {
      assert.ok(error instanceof ProductionEnvironmentError);
      assert.match(error.message, /LEGAL_IMPRINT_URL/);
      assert.match(error.message, /LEGAL_PRIVACY_URL/);
      assert.match(error.message, /SUPPORT_EMAIL/);
      return true;
    },
  );
});

test("destructive seed requires local target and exact explicit confirmation", () => {
  const allowed = assertDestructiveSeedAllowed({
    NODE_ENV: "development",
    ALLOW_DESTRUCTIVE_SEED: "true",
    SEED_EXPECTED_DATABASE: "q_academy",
    DATABASE_URL:
      "postgresql://postgres:postgres@127.0.0.1:54329/q_academy",
  });
  assert.equal(allowed.databaseName, "q_academy");

  assert.throws(
    () =>
      assertDestructiveSeedAllowed({
        NODE_ENV: "test",
        SEED_EXPECTED_DATABASE: "q_academy_ci_test",
        DATABASE_URL:
          "postgresql://academy:password@127.0.0.1:54329/q_academy_ci_test",
      }),
    /ALLOW_DESTRUCTIVE_SEED=true/,
  );

  assert.throws(
    () =>
      assertDestructiveSeedAllowed({
        NODE_ENV: "production",
        ALLOW_DESTRUCTIVE_SEED: "true",
        SEED_EXPECTED_DATABASE: "q_academy",
      }),
    /disabled/,
  );
  assert.throws(
    () =>
      assertDestructiveSeedAllowed({
        NODE_ENV: "development",
        ALLOW_DESTRUCTIVE_SEED: "true",
        SEED_EXPECTED_DATABASE: "q_academy",
        DATABASE_URL:
          "postgresql://academy:password@db.example.com/q_academy",
      }),
    /loopback/,
  );
  assert.throws(
    () =>
      assertDestructiveSeedAllowed({
        NODE_ENV: "development",
        ALLOW_DESTRUCTIVE_SEED: "true",
        SEED_EXPECTED_DATABASE: "wrong_database",
      }),
    /exactly match/,
  );
});

test("destructive seed verifies the actual PostgreSQL connection identity", () => {
  assert.doesNotThrow(() =>
    assertSeedDatabaseIdentity({
      expectedDatabaseName: "q_academy",
      actualDatabaseName: "q_academy",
      serverAddress: "127.0.0.1",
    }),
  );
  assert.throws(
    () =>
      assertSeedDatabaseIdentity({
        expectedDatabaseName: "q_academy",
        actualDatabaseName: "q_academy_prod",
        serverAddress: "127.0.0.1",
      }),
    /does not match/,
  );
  assert.throws(
    () =>
      assertSeedDatabaseIdentity({
        expectedDatabaseName: "q_academy",
        actualDatabaseName: "q_academy",
        serverAddress: "10.0.0.8",
      }),
    /not a loopback/,
  );
});
