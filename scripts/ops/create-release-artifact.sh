#!/usr/bin/env bash
set -euo pipefail

release_tag="${1:-}"
output_directory="${2:-}"

fail() { printf 'Release artifact creation failed: %s\n' "$*" >&2; exit 1; }

[[ "$release_tag" =~ ^git-[a-f0-9]{40,64}$ ]] || fail "release tag must be git-<full commit>"
[[ -n "$output_directory" ]] || fail "output directory is required"
for command in docker trivy sha256sum gzip git find sort xargs; do
  command -v "$command" >/dev/null 2>&1 || fail "required command is missing: $command"
done

release_commit="${release_tag#git-}"
head_commit="$(git rev-parse --verify HEAD^{commit} 2>/dev/null)" || fail "working directory is not a Git repository"
[[ "$head_commit" == "$release_commit" ]] || fail "release tag does not match Git HEAD"
image_platform="$(docker version --format '{{.Server.Os}}/{{.Server.Arch}}')"
[[ "$image_platform" =~ ^[A-Za-z0-9][A-Za-z0-9._/-]*$ ]] || fail "Docker server platform is invalid"
node_image="${CI_NODE_IMAGE:-}"
debian_snapshot="${CI_DEBIAN_SNAPSHOT:-}"
ca_certificates_version="${CI_CA_CERTIFICATES_VERSION:-}"
ffmpeg_version="${CI_FFMPEG_VERSION:-}"
mesa_version="${CI_MESA_VERSION:-}"
[[ "$node_image" =~ ^[A-Za-z0-9][A-Za-z0-9._:/-]*@sha256:[a-f0-9]{64}$ ]] || fail "CI_NODE_IMAGE must be digest-pinned"
[[ "$debian_snapshot" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] || fail "CI_DEBIAN_SNAPSHOT is invalid"
[[ "$ca_certificates_version" =~ ^[A-Za-z0-9][A-Za-z0-9.+:~_-]*$ ]] || fail "CI_CA_CERTIFICATES_VERSION is invalid"
[[ "$ffmpeg_version" =~ ^[0-9]+:[A-Za-z0-9][A-Za-z0-9.+:~_-]*$ ]] || fail "CI_FFMPEG_VERSION is invalid"
[[ "$mesa_version" =~ ^[A-Za-z0-9][A-Za-z0-9.+:~_-]*$ ]] || fail "CI_MESA_VERSION is invalid"

image_components=(app migrator key-rotation tenant-ops media-runner media-preflight s3-app-principal-preflight)
image_variables=(
  Q_ACADEMY_APP_IMAGE_ID
  Q_ACADEMY_MIGRATOR_IMAGE_ID
  Q_ACADEMY_KEY_ROTATION_IMAGE_ID
  Q_ACADEMY_TENANT_OPS_IMAGE_ID
  Q_ACADEMY_MEDIA_RUNNER_IMAGE_ID
  Q_ACADEMY_MEDIA_PREFLIGHT_IMAGE_ID
  Q_ACADEMY_S3_APP_PRINCIPAL_PREFLIGHT_IMAGE_ID
)

if [[ -e "$output_directory" ]]; then
  [[ -d "$output_directory" && ! -L "$output_directory" ]] || fail "output path is not a regular directory"
  [[ -z "$(find "$output_directory" -mindepth 1 -print -quit)" ]] || fail "output directory must be empty"
else
  mkdir -p -- "$output_directory"
fi
mkdir -- "$output_directory/evidence"

{
  printf 'Q_ACADEMY_RELEASE_TAG=%s\n' "$release_tag"
  printf 'Q_ACADEMY_SOURCE_COMMIT=%s\n' "$release_commit"
  printf 'Q_ACADEMY_IMAGE_PLATFORM=%s\n' "$image_platform"
  printf 'Q_ACADEMY_NODE_IMAGE=%s\n' "$node_image"
  printf 'Q_ACADEMY_DEBIAN_SNAPSHOT=%s\n' "$debian_snapshot"
  printf 'Q_ACADEMY_CA_CERTIFICATES_VERSION=%s\n' "$ca_certificates_version"
  printf 'Q_ACADEMY_FFMPEG_VERSION=%s\n' "$ffmpeg_version"
  printf 'Q_ACADEMY_MESA_VERSION=%s\n' "$mesa_version"
  for index in "${!image_components[@]}"; do
    image="q-academy-${image_components[$index]}:$release_tag"
    image_id="$(docker image inspect --format '{{.Id}}' "$image")" || fail "release image is unavailable: $image"
    [[ "$image_id" =~ ^sha256:[a-f0-9]{64}$ ]] || fail "release image has an invalid content ID: $image"
    printf '%s=%s\n' "${image_variables[$index]}" "$image_id"
  done
} >"$output_directory/release-build.env"

scan_failed=false
trivy --version >"$output_directory/evidence/trivy-version.txt"
for component in "${image_components[@]}"; do
  image="q-academy-$component:$release_tag"
  trivy image --quiet --scanners vuln --format json --list-all-pkgs --exit-code 0 \
    --output "$output_directory/evidence/vulnerabilities-$component.json" "$image"
  trivy convert --quiet --format cyclonedx \
    --output "$output_directory/evidence/sbom-$component.cdx.json" \
    "$output_directory/evidence/vulnerabilities-$component.json"
  if ! trivy image --quiet --scanners vuln --severity HIGH,CRITICAL \
    --ignore-unfixed --exit-code 1 --format table \
    --output "$output_directory/evidence/vulnerability-gate-$component.txt" "$image"; then
    scan_failed=true
  fi
done

if [[ "$scan_failed" == "true" ]]; then
  fail "one or more release images contain fixed high or critical vulnerabilities"
fi

release_images=()
for component in "${image_components[@]}"; do
  release_images+=("q-academy-$component:$release_tag")
done
docker save "${release_images[@]}" | gzip -1 >"$output_directory/release-images.tar.gz"

(
  cd -- "$output_directory"
  find . -type f ! -name SHA256SUMS -print0 \
    | sort -z \
    | xargs -0 sha256sum
) >"$output_directory/SHA256SUMS"

printf 'Created verified release artifact for %s at %s.\n' "$release_tag" "$output_directory"
