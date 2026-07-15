import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const postgresDockerfile = readFileSync("deploy/postgres/Dockerfile", "utf8");
const postgresReadme = readFileSync("deploy/postgres/README.md", "utf8");
const continuousIntegration = readFileSync(".github/workflows/ci.yml", "utf8");
const createReleaseArtifact = readFileSync(
  "scripts/ops/create-release-artifact.sh",
  "utf8",
);
const publishReleaseImages = readFileSync(
  "scripts/ops/publish-release-images.sh",
  "utf8",
);
const releaseCommon = readFileSync("scripts/ops/release-common.sh", "utf8");
const deployRelease = readFileSync("scripts/ops/deploy-release.sh", "utf8");
const productionEnvironmentExample = readFileSync(
  "deploy/.env.production.example",
  "utf8",
);

const postgresBase =
  "postgres:16.14-alpine3.23@sha256:42b8b8b29c8a4e933d88943e5b03001a78794905cf786e6e7634e9f2abd5a0d3";
const golangBuilder =
  "golang:1.26.5-alpine3.23@sha256:622e56dbc11a8cfe87cafa2331e9a201877271cbff918af53d3be315f3da88cc";
const gosuCommit = "6456aaa0f3c854d199d0f037f068eb97515b7513";
const gosuSourceSha256 =
  "33d7537d588ea49458b9509bcf4554bdf5ceacc66da71e5caa1058ea3b689c3b";

test("PostgreSQL replaces gosu from immutable reproducible source inputs", () => {
  assert.match(
    postgresDockerfile,
    /^# syntax=docker\/dockerfile:1\.7@sha256:[a-f0-9]{64}$/m,
  );
  assert.match(
    postgresDockerfile,
    new RegExp(`ARG POSTGRES_BASE_IMAGE=${postgresBase}`),
  );
  assert.match(
    postgresDockerfile,
    new RegExp(`ARG GOLANG_BUILDER_IMAGE=${golangBuilder}`),
  );
  assert.match(postgresDockerfile, /ARG GOSU_VERSION=1\.19/);
  assert.match(
    postgresDockerfile,
    /test "\$GOLANG_BUILDER_IMAGE" = "golang:1\.26\.5-alpine3\.23@sha256:[a-f0-9]{64}"/,
  );
  assert.match(
    postgresDockerfile,
    /test "\$POSTGRES_BASE_IMAGE" = "postgres:16\.14-alpine3\.23@sha256:[a-f0-9]{64}"/,
  );
  assert.equal(postgresDockerfile.split(gosuCommit).length - 1, 4);
  assert.equal(postgresDockerfile.split(gosuSourceSha256).length - 1, 4);
  assert.match(postgresDockerfile, /ADD --checksum=sha256:[a-f0-9]{64}/);
  assert.match(postgresDockerfile, /go mod verify/);
  assert.equal(postgresDockerfile.match(/CGO_ENABLED=0/g)?.length, 2);
  assert.equal(postgresDockerfile.match(/GOCACHE=\/tmp\/gosu-cache-/g)?.length, 2);
  assert.match(postgresDockerfile, /-trimpath/);
  assert.match(postgresDockerfile, /-buildvcs=false/);
  assert.match(postgresDockerfile, /-ldflags='-buildid= -s -w'/);
  assert.match(postgresDockerfile, /cmp \/out\/gosu-one \/out\/gosu-two/);
  assert.match(postgresDockerfile, /program\.Type == elf\.PT_INTERP/);
  assert.match(
    postgresDockerfile,
    /COPY --from=gosu-builder --chmod=0555 \/out\/gosu \/usr\/local\/bin\/gosu/,
  );
  assert.match(postgresDockerfile, /gosu postgres id -u/);
  assert.match(postgresDockerfile, /gosu postgres id -g/);
  assert.match(postgresDockerfile, /test ! -u \/usr\/local\/bin\/gosu/);
  assert.match(postgresDockerfile, /test ! -g \/usr\/local\/bin\/gosu/);
  assert.match(postgresReadme, /Two builds use independent Go build caches/);
  assert.match(postgresReadme, /attested `release-images\.env`/);
});

test("CI smoke-tests and packages PostgreSQL with all release components", () => {
  assert.match(
    continuousIntegration,
    new RegExp(`CI_POSTGRES_BASE_IMAGE: ${postgresBase}`),
  );
  assert.match(
    continuousIntegration,
    new RegExp(`CI_GOLANG_BUILDER_IMAGE: ${golangBuilder}`),
  );
  assert.match(
    continuousIntegration,
    new RegExp(`CI_GOSU_SOURCE_COMMIT: ${gosuCommit}`),
  );
  assert.match(
    continuousIntegration,
    new RegExp(`CI_GOSU_SOURCE_SHA256: ${gosuSourceSha256}`),
  );
  assert.match(continuousIntegration, /--file deploy\/postgres\/Dockerfile/);
  assert.match(
    continuousIntegration,
    /q-academy-postgres:\$Q_ACADEMY_CI_RELEASE_TAG/,
  );
  assert.match(continuousIntegration, /gosu postgres id -u/);
  assert.match(continuousIntegration, /postgres \(PostgreSQL\) 16\.14/);
  assert.match(
    continuousIntegration,
    /--tmpfs \/var\/lib\/postgresql\/data:rw,nosuid,nodev,noexec,size=512m/,
  );
  assert.match(continuousIntegration, /pg_isready --username=postgres/);
  assert.match(continuousIntegration, /select current_user, 6 \* 7/);
  const ciReleaseComponentLists = continuousIntegration.match(
    /image_components=\([^)]*\bpostgres\b[^)]*\)/g,
  );
  assert.ok((ciReleaseComponentLists?.length ?? 0) >= 2);

  for (const source of [createReleaseArtifact, publishReleaseImages]) {
    assert.match(
      source,
      /image_components=\([^)]*\bpostgres\b[^)]*\)/,
    );
    assert.match(source, /Q_ACADEMY_POSTGRES_IMAGE_ID/);
  }
  assert.match(createReleaseArtifact, /Q_ACADEMY_POSTGRES_BASE_IMAGE/);
  assert.match(createReleaseArtifact, /Q_ACADEMY_GOLANG_BUILDER_IMAGE/);
  assert.match(createReleaseArtifact, /Q_ACADEMY_GOSU_SOURCE_COMMIT/);
  assert.match(createReleaseArtifact, /Q_ACADEMY_GOSU_SOURCE_SHA256/);
  assert.match(publishReleaseImages, /Q_ACADEMY_POSTGRES_IMAGE/);
});

test("verified manifests, not the untrusted env fallback, select PostgreSQL", () => {
  assert.match(releaseCommon, /Q_ACADEMY_POSTGRES_IMAGE/);
  assert.match(
    deployRelease,
    /verified_postgres_image="\$Q_ACADEMY_POSTGRES_IMAGE"/,
  );
  assert.match(
    deployRelease,
    /export POSTGRES_IMAGE="\$verified_postgres_image"/,
  );
  assert.match(
    deployRelease,
    /persist_app_image_tag "\$env_file" "\$release_tag" "\$verified_postgres_image"/,
  );
  assert.match(
    releaseCommon,
    /\^POSTGRES_IMAGE=\/ && postgres_image != ""/,
  );

  const manifestVerification = deployRelease.indexOf(
    'verify_release_image_manifest "$release_image_manifest"',
  );
  const postgresMapping = deployRelease.indexOf(
    'export POSTGRES_IMAGE="$verified_postgres_image"',
  );
  const firstComposeValidation = deployRelease.indexOf(
    'run "${compose[@]}" config --quiet',
  );
  assert.ok(manifestVerification >= 0);
  assert.ok(postgresMapping > manifestVerification);
  assert.ok(firstComposeValidation > postgresMapping);

  assert.match(
    deployRelease,
    /local-build\)[\s\S]*run "\$\{compose\[@\]\}" config --quiet[\s\S]*build --pull app migrate key-rotation tenant-admin-ops media-runner media-preflight s3-app-principal-preflight/,
  );
  assert.match(
    productionEnvironmentExample,
    /Fallback for drills and RELEASE_IMAGE_MODE=local-build/,
  );
});
