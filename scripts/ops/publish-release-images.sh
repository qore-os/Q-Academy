#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=scripts/ops/release-common.sh
source "${ROOT_DIR}/scripts/ops/release-common.sh"

release_tag="${1:-}"
artifact_directory="${2:-}"
registry_root="${3:-}"
output_manifest="${4:-}"

fail() { printf 'Release image publication failed: %s\n' "$*" >&2; exit 1; }

[[ "$release_tag" =~ ^git-[a-f0-9]{40,64}$ ]] || fail "release tag must be git-<full commit>"
[[ -d "$artifact_directory" && ! -L "$artifact_directory" ]] || fail "artifact directory is invalid"
[[ "$registry_root" =~ ^[a-z0-9][a-z0-9._:/-]*$ ]] || fail "registry root is invalid"
[[ -n "$output_manifest" ]] || fail "output manifest is required"
for command in docker sha256sum gzip mktemp grep head ln rm; do
  command -v "$command" >/dev/null 2>&1 || fail "required command is missing: $command"
done

(
  cd -- "$artifact_directory"
  sha256sum --check --strict SHA256SUMS
) || fail "release artifact checksum verification failed"

build_manifest="$artifact_directory/release-build.env"
manifest_tag="$(production_env_value "$build_manifest" Q_ACADEMY_RELEASE_TAG)" || fail "build manifest tag is invalid"
manifest_commit="$(production_env_value "$build_manifest" Q_ACADEMY_SOURCE_COMMIT)" || fail "build manifest commit is invalid"
manifest_platform="$(production_env_value "$build_manifest" Q_ACADEMY_IMAGE_PLATFORM)" || fail "build manifest platform is invalid"
host_platform="$(docker version --format '{{.Server.Os}}/{{.Server.Arch}}')"
[[ "$manifest_tag" == "$release_tag" ]] || fail "build manifest tag does not match"
[[ "$manifest_commit" == "${release_tag#git-}" ]] || fail "build manifest commit does not match"
[[ "$manifest_platform" == "$host_platform" ]] || fail "build artifact platform does not match Docker server"

gzip --decompress --stdout "$artifact_directory/release-images.tar.gz" | docker load >/dev/null

image_components=(postgres app migrator key-rotation tenant-ops media-runner media-preflight s3-app-principal-preflight dispatcher caddy)
id_variables=(
  Q_ACADEMY_POSTGRES_IMAGE_ID
  Q_ACADEMY_APP_IMAGE_ID
  Q_ACADEMY_MIGRATOR_IMAGE_ID
  Q_ACADEMY_KEY_ROTATION_IMAGE_ID
  Q_ACADEMY_TENANT_OPS_IMAGE_ID
  Q_ACADEMY_MEDIA_RUNNER_IMAGE_ID
  Q_ACADEMY_MEDIA_PREFLIGHT_IMAGE_ID
  Q_ACADEMY_S3_APP_PRINCIPAL_PREFLIGHT_IMAGE_ID
  Q_ACADEMY_DISPATCHER_IMAGE_ID
  Q_ACADEMY_CADDY_IMAGE_ID
)
manifest_variables=(
  Q_ACADEMY_POSTGRES_IMAGE
  Q_ACADEMY_APP_IMAGE
  Q_ACADEMY_MIGRATOR_IMAGE
  Q_ACADEMY_KEY_ROTATION_IMAGE
  Q_ACADEMY_TENANT_OPS_IMAGE
  Q_ACADEMY_MEDIA_RUNNER_IMAGE
  Q_ACADEMY_MEDIA_PREFLIGHT_IMAGE
  Q_ACADEMY_S3_APP_PRINCIPAL_PREFLIGHT_IMAGE
  Q_ACADEMY_DISPATCHER_IMAGE
  Q_ACADEMY_CADDY_IMAGE
)
published_references=()

for index in "${!image_components[@]}"; do
  component="${image_components[$index]}"
  local_image="q-academy-$component:$release_tag"
  expected_id="$(production_env_value "$build_manifest" "${id_variables[$index]}")" || fail "build image ID is missing"
  [[ "$expected_id" =~ ^sha256:[a-f0-9]{64}$ ]] || fail "build image ID is invalid"
  local_id="$(docker image inspect --format '{{.Id}}' "$local_image")" || fail "loaded image is missing: $local_image"
  [[ "$local_id" == "$expected_id" ]] || fail "loaded image content differs from the tested build: $local_image"

  registry_repository="$registry_root-$component"
  registry_tag="$registry_repository:$release_tag"
  docker image tag "$local_image" "$registry_tag"
  if manifest_probe="$(docker manifest inspect "$registry_tag" 2>&1)"; then
    docker pull "$registry_tag" >/dev/null
    existing_id="$(docker image inspect --format '{{.Id}}' "$registry_tag")"
    [[ "$existing_id" == "$expected_id" ]] || fail "immutable registry tag already contains different content: $registry_tag"
  elif grep -Eqi 'manifest unknown|no such manifest|not found' <<<"$manifest_probe"; then
    docker push "$registry_tag"
    docker pull "$registry_tag" >/dev/null
  else
    fail "registry tag lookup failed without a definitive not-found response: $registry_tag"
  fi
  pinned_reference="$(
    docker image inspect --format '{{range .RepoDigests}}{{println .}}{{end}}' "$registry_tag" \
      | grep -F "$registry_repository@sha256:" \
      | head -n 1
  )"
  [[ "$pinned_reference" =~ ^[A-Za-z0-9][A-Za-z0-9._:/-]*@sha256:[a-f0-9]{64}$ ]] || fail "registry did not return an immutable digest: $registry_tag"
  docker pull "$pinned_reference" >/dev/null
  published_id="$(docker image inspect --format '{{.Id}}' "$pinned_reference")"
  [[ "$published_id" == "$expected_id" ]] || fail "published image content differs from the tested build: $registry_repository"
  published_references+=("$pinned_reference")
done

output_directory="$(dirname -- "$output_manifest")"
mkdir -p -- "$output_directory"
[[ -d "$output_directory" && ! -L "$output_directory" ]] || fail "output directory is unsafe"
[[ ! -e "$output_manifest" && ! -L "$output_manifest" ]] || fail "output manifest already exists"
[[ ! -e "${output_manifest}.sha256" && ! -L "${output_manifest}.sha256" ]] || fail "output checksum already exists"
temporary_manifest="$(mktemp "${output_directory}/.release-images.XXXXXX")"
{
  printf 'Q_ACADEMY_RELEASE_TAG=%s\n' "$release_tag"
  printf 'Q_ACADEMY_SOURCE_COMMIT=%s\n' "${release_tag#git-}"
  printf 'Q_ACADEMY_IMAGE_PLATFORM=%s\n' "$manifest_platform"
  for index in "${!published_references[@]}"; do
    printf '%s=%s\n' "${manifest_variables[$index]}" "${published_references[$index]}"
  done
} >"$temporary_manifest"
chmod 0644 "$temporary_manifest"
ln -- "$temporary_manifest" "$output_manifest" || fail "could not publish manifest exclusively"
rm -f -- "$temporary_manifest"
temporary_checksum="$(mktemp "${output_directory}/.release-images-sha256.XXXXXX")"
(
  cd -- "$output_directory"
  sha256sum "$(basename -- "$output_manifest")"
) >"$temporary_checksum"
chmod 0644 "$temporary_checksum"
ln -- "$temporary_checksum" "${output_manifest}.sha256" || fail "could not publish checksum exclusively"
rm -f -- "$temporary_checksum"

printf 'Published %s and wrote %s.\n' "$release_tag" "$output_manifest"
