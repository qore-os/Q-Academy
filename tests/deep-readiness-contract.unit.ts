import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("routing readiness remains limited to runtime configuration and the database schema", async () => {
  const source = await readFile(
    new URL("src/app/api/v1/health/ready/route.ts", root),
    "utf8",
  );
  assert.match(source, /assertRuntimeServerEnvironment/);
  assert.match(source, /assertCurrentDatabaseSchema/);
  assert.doesNotMatch(source, /ClamAv|clamav|S3|s3-|media\/|scanMedia/);
});

test("deep provider checks are separate CLIs and the media preflight can reach ClamAV", async () => {
  const [packageSource, compose, mediaPreflight, appPreflight, clamAvPreflight, privacyStorage] = await Promise.all([
    readFile(new URL("package.json", root), "utf8"),
    readFile(new URL("compose.production.yml", root), "utf8"),
    readFile(new URL("scripts/media-processing-preflight.ts", root), "utf8"),
    readFile(new URL("scripts/s3-app-principal-preflight.ts", root), "utf8"),
    readFile(new URL("scripts/clamav-preflight.ts", root), "utf8"),
    readFile(new URL("src/lib/privacy/export-storage.ts", root), "utf8"),
  ]);
  const scripts = JSON.parse(packageSource) as {
    scripts: Record<string, string>;
  };
  assert.equal(
    scripts.scripts["media:s3:app-principal-preflight"],
    "tsx scripts/s3-app-principal-preflight.ts",
  );
  assert.equal(
    scripts.scripts["media:clamav:preflight"],
    "tsx scripts/clamav-preflight.ts",
  );
  const mediaService = compose.match(
    /^  media-preflight:\r?\n([\s\S]*?)(?=^  [a-z0-9][a-z0-9-]*:\r?$)/m,
  )?.[1] ?? "";
  const appPrincipalService = compose.match(
    /^  s3-app-principal-preflight:\r?\n([\s\S]*?)(?=^  [a-z0-9][a-z0-9-]*:\r?$)/m,
  )?.[1] ?? "";
  const freshClamService = compose.match(
    /^  clamav-freshclam:\r?\n([\s\S]*?)(?=^  [a-z0-9][a-z0-9-]*:\r?$)/m,
  )?.[1] ?? "";
  const clamAvService = compose.match(
    /^  clamav:\r?\n([\s\S]*?)(?=^  [a-z0-9][a-z0-9-]*:\r?$)/m,
  )?.[1] ?? "";
  assert.match(mediaService, /^      - media$/m);
  assert.match(mediaPreflight, /runClamAvPreflight/);
  assert.match(appPrincipalService, /MEDIA_S3_APP_ACCESS_KEY_ID/);
  assert.match(appPrincipalService, /MEDIA_S3_ACCESS_KEY_ID/);
  assert.match(appPrincipalService, /^      - egress$/m);
  assert.match(freshClamService, /^      - egress$/m);
  assert.doesNotMatch(freshClamService, /^      - media$/m);
  assert.match(freshClamService, /CLAMAV_NO_CLAMD: "true"/);
  assert.match(clamAvService, /^      - media$/m);
  assert.doesNotMatch(clamAvService, /^      - egress$/m);
  assert.match(clamAvService, /CLAMAV_NO_FRESHCLAMD: "true"/);
  assert.match(clamAvService, /clamav-signature-health/);
  assert.doesNotMatch(
    appPrincipalService,
    /DATABASE_URL|SESSION_SECRET|CRON_SECRET|MEDIA_CLAMAV_HOST/,
  );
  assert.doesNotMatch(appPreflight, /loadProjectEnvironment|@next\/env/);
  assert.doesNotMatch(clamAvPreflight, /loadProjectEnvironment|@next\/env/);
  const privacyDelete = privacyStorage.slice(
    privacyStorage.indexOf("export async function deletePrivacyExport"),
  );
  assert.match(privacyDelete, /new DeleteObjectCommand\(\{[\s\S]*VersionId: input\.storageVersionId/);
  assert.match(privacyDelete, /IfMatch: quotedEtag\(input\.storageEtag\)/);
  assert.doesNotMatch(privacyDelete, /HeadObjectCommand|ListObject/);
});
