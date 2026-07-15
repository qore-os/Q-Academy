import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_MEDIA_STORAGE_LIMITS,
  MAX_SCANNABLE_MEDIA_BYTES,
  MediaStorageConfigurationError,
  resolveMediaStorageConfiguration,
  type MediaStorageEnvironment,
} from "../src/lib/media/storage-configuration";

function productionEnvironment(): MediaStorageEnvironment {
  return {
    NODE_ENV: "production",
    MEDIA_STORAGE_DRIVER: "s3",
    MEDIA_S3_ENDPOINT: "https://objects.q-academy.de",
    MEDIA_S3_REGION: "eu-central-1",
    MEDIA_S3_BUCKET: "q-academy-media-prod",
    MEDIA_S3_ACCESS_KEY_ID: "QACADEMYMEDIA",
    MEDIA_S3_SECRET_ACCESS_KEY: "8vQ2mR7xK4pL9sN6dF1wC5zT",
    MEDIA_S3_FORCE_PATH_STYLE: "false",
    MEDIA_CLAMAV_HOST: "clamav.internal",
    MEDIA_CLAMAV_PORT: "3310",
  };
}

test("media storage defaults to a bounded development filesystem policy", () => {
  const configuration = resolveMediaStorageConfiguration({
    NODE_ENV: "development",
  });

  assert.equal(configuration.driver, "filesystem");
  assert.equal(configuration.rootDirectory, ".data/media");
  assert.deepEqual(configuration.limits, DEFAULT_MEDIA_STORAGE_LIMITS);
  assert.deepEqual(configuration.clamAv, {
    host: "127.0.0.1",
    port: 3310,
    required: false,
  });
});

test("media storage resolves explicit production S3 and scanner settings", () => {
  const configuration = resolveMediaStorageConfiguration({
    ...productionEnvironment(),
    MEDIA_MAX_UPLOAD_BYTES: "1500000000",
    MEDIA_TENANT_QUOTA_BYTES: String(50 * 1024 * 1024 * 1024),
    MEDIA_SIGNED_UPLOAD_TTL_SECONDS: "300",
    MEDIA_SIGNED_DOWNLOAD_TTL_SECONDS: "1800",
    MEDIA_S3_FORCE_PATH_STYLE: "true",
  });

  assert.equal(configuration.driver, "s3");
  assert.equal(configuration.endpoint, "https://objects.q-academy.de");
  assert.equal(configuration.region, "eu-central-1");
  assert.equal(configuration.bucket, "q-academy-media-prod");
  assert.equal(configuration.forcePathStyle, true);
  assert.equal(configuration.limits.maxUploadBytes, 1_500_000_000);
  assert.equal(configuration.limits.tenantQuotaBytes, 50 * 1024 * 1024 * 1024);
  assert.equal(configuration.limits.signedUploadTtlSeconds, 300);
  assert.equal(configuration.limits.signedDownloadTtlSeconds, 1800);
  assert.deepEqual(configuration.clamAv, {
    host: "clamav.internal",
    port: 3310,
    required: true,
  });
});

test("media storage enforces filesystem outside production and S3 in production", () => {
  assert.throws(
    () =>
      resolveMediaStorageConfiguration({
        NODE_ENV: "development",
        MEDIA_STORAGE_DRIVER: "s3",
      }),
    /must be 'filesystem' outside production/,
  );

  assert.throws(
    () =>
      resolveMediaStorageConfiguration({
        ...productionEnvironment(),
        MEDIA_STORAGE_DRIVER: "filesystem",
      }),
    /must be 's3' in production/,
  );
});

test("media storage rejects unsafe filesystem paths and invalid limits", () => {
  assert.throws(
    () =>
      resolveMediaStorageConfiguration({
        NODE_ENV: "test",
        MEDIA_FILESYSTEM_ROOT: "../outside",
        MEDIA_MAX_UPLOAD_BYTES: String(20 * 1024 * 1024),
        MEDIA_TENANT_QUOTA_BYTES: String(10 * 1024 * 1024),
        MEDIA_SIGNED_UPLOAD_TTL_SECONDS: "59",
        MEDIA_SIGNED_DOWNLOAD_TTL_SECONDS: "86401",
        MEDIA_CLAMAV_PORT: "0",
      }),
    (error: unknown) => {
      assert.ok(error instanceof MediaStorageConfigurationError);
      assert.match(error.message, /MEDIA_FILESYSTEM_ROOT/);
      assert.match(error.message, /MEDIA_TENANT_QUOTA_BYTES/);
      assert.match(error.message, /MEDIA_SIGNED_UPLOAD_TTL_SECONDS/);
      assert.match(error.message, /MEDIA_SIGNED_DOWNLOAD_TTL_SECONDS/);
      assert.match(error.message, /MEDIA_CLAMAV_PORT/);
      return true;
    },
  );
});

test("media filesystem storage stays below the dedicated .data/media root", () => {
  for (const rootDirectory of [
    "uploads/media",
    ".data/postgres",
    ".data/media-backup",
  ]) {
    assert.throws(
      () =>
        resolveMediaStorageConfiguration({
          NODE_ENV: "development",
          MEDIA_STORAGE_DRIVER: "filesystem",
          MEDIA_FILESYSTEM_ROOT: rootDirectory,
        }),
      (error: unknown) => {
        assert.ok(error instanceof MediaStorageConfigurationError);
        assert.match(error.message, /MEDIA_FILESYSTEM_ROOT/);
        assert.match(error.message, /'\.data\/media'/);
        return true;
      },
    );
  }

  const nested = resolveMediaStorageConfiguration({
    NODE_ENV: "development",
    MEDIA_STORAGE_DRIVER: "filesystem",
    MEDIA_FILESYSTEM_ROOT: ".data/media/local-shard",
  });
  assert.equal(nested.driver, "filesystem");
  assert.equal(nested.rootDirectory, ".data/media/local-shard");
});

test("media storage rejects incomplete or unsafe production endpoints", () => {
  const environment = {
    ...productionEnvironment(),
    MEDIA_S3_ENDPOINT: "http://127.0.0.1:9000/private?token=value",
    MEDIA_S3_BUCKET: "192.168.1.20",
    MEDIA_S3_REGION: "EU Central",
    MEDIA_S3_SECRET_ACCESS_KEY: "replace-with-secret-here",
    MEDIA_CLAMAV_HOST: "tcp://clamav:3310",
  };

  assert.throws(
    () => resolveMediaStorageConfiguration(environment),
    (error: unknown) => {
      assert.ok(error instanceof MediaStorageConfigurationError);
      assert.match(error.message, /MEDIA_S3_ENDPOINT/);
      assert.match(error.message, /MEDIA_S3_BUCKET/);
      assert.match(error.message, /MEDIA_S3_REGION/);
      assert.match(error.message, /MEDIA_S3_SECRET_ACCESS_KEY/);
      assert.match(error.message, /MEDIA_CLAMAV_HOST/);
      assert.doesNotMatch(error.message, /replace-with-secret-here/);
      assert.doesNotMatch(error.message, /token=value/);
      return true;
    },
  );
});

test("media storage rejects reserved example endpoints", () => {
  assert.throws(
    () =>
      resolveMediaStorageConfiguration({
        ...productionEnvironment(),
        MEDIA_S3_ENDPOINT: "https://objects.example.com",
      }),
    /reserved example hostname/,
  );
});

test("media storage never accepts files beyond the ClamAV 1.5 boundary", () => {
  assert.equal(
    DEFAULT_MEDIA_STORAGE_LIMITS.maxUploadBytes,
    MAX_SCANNABLE_MEDIA_BYTES,
  );
  assert.throws(
    () =>
      resolveMediaStorageConfiguration({
        NODE_ENV: "development",
        MEDIA_MAX_UPLOAD_BYTES: String(MAX_SCANNABLE_MEDIA_BYTES + 1),
      }),
    /MEDIA_MAX_UPLOAD_BYTES/,
  );
});

test("media storage requires explicit S3 and ClamAV production values", () => {
  assert.throws(
    () =>
      resolveMediaStorageConfiguration({
        NODE_ENV: "production",
      }),
    (error: unknown) => {
      assert.ok(error instanceof MediaStorageConfigurationError);
      const fields = new Set(error.issues.map((entry) => entry.field));
      for (const field of [
        "MEDIA_S3_ENDPOINT",
        "MEDIA_S3_REGION",
        "MEDIA_S3_BUCKET",
        "MEDIA_S3_ACCESS_KEY_ID",
        "MEDIA_S3_SECRET_ACCESS_KEY",
        "MEDIA_CLAMAV_HOST",
      ]) {
        assert.ok(fields.has(field), `${field} should be required`);
      }
      return true;
    },
  );
});

test("media storage rejects local IPv6 S3 and malformed scanner addresses", () => {
  assert.throws(
    () =>
      resolveMediaStorageConfiguration({
        ...productionEnvironment(),
        MEDIA_S3_ENDPOINT: "https://[::1]",
        MEDIA_CLAMAV_HOST: "999.999.1.1",
      }),
    (error: unknown) => {
      assert.ok(error instanceof MediaStorageConfigurationError);
      const fields = new Set(error.issues.map((entry) => entry.field));
      assert.ok(fields.has("MEDIA_S3_ENDPOINT"));
      assert.ok(fields.has("MEDIA_CLAMAV_HOST"));
      return true;
    },
  );
});
