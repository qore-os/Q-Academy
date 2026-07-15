#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${Q_ACADEMY_ENV_FILE:-/etc/q-academy/production.env}"

# shellcheck source=scripts/ops/release-common.sh
source "${ROOT_DIR}/scripts/ops/release-common.sh"

[[ -r "$ENV_FILE" ]] || {
  printf 'Production environment file is not readable: %s\n' "$ENV_FILE" >&2
  exit 1
}
verify_and_export_pinned_images "$ENV_FILE"
printf 'Verified %s digest-pinned production image references.\n' "${#PINNED_IMAGE_VARIABLES[@]}"
