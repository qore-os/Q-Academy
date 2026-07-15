#!/usr/bin/env bash
set -Eeuo pipefail

umask 077

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=scripts/ops/release-common.sh
source "${ROOT_DIR}/scripts/ops/release-common.sh"
COMPOSE_FILE="${Q_ACADEMY_COMPOSE_FILE:-${ROOT_DIR}/compose.production.yml}"
ENV_FILE="${Q_ACADEMY_ENV_FILE:-/etc/q-academy/production.env}"
RELEASE_LOCK_FILE="${RELEASE_LOCK_FILE:-$RELEASE_LOCK_FILE_DEFAULT}"
BACKUP_LOCK_FILE="${BACKUP_LOCK_FILE:-$BACKUP_LOCK_FILE_DEFAULT}"

if [[ $# -ne 1 ]]; then
  printf 'Usage: %s /absolute/path/to/q-academy-TIMESTAMP.dump\n' "$0" >&2
  exit 2
fi

DUMP_PATH="$1"
if [[ ! -r "${DUMP_PATH}" || ! -s "${DUMP_PATH}" ]]; then
  printf 'Backup archive is not a readable non-empty file: %s\n' "${DUMP_PATH}" >&2
  exit 1
fi
if [[ ! -r "${ENV_FILE}" ]]; then
  printf 'Production environment file is not readable: %s\n' "${ENV_FILE}" >&2
  exit 1
fi
configured_release_tag="$(production_env_value "${ENV_FILE}" APP_IMAGE_TAG)" || exit 1
if [[ ! "${configured_release_tag}" =~ ^git-[a-f0-9]{40,64}$ ]]; then
  printf 'APP_IMAGE_TAG must identify the full deployed Git commit.\n' >&2
  exit 1
fi
export APP_IMAGE_TAG="${configured_release_tag}"
verify_and_export_pinned_images "${ENV_FILE}"

command -v flock >/dev/null 2>&1 || {
  printf 'flock is required for restore serialization.\n' >&2
  exit 1
}
if [[ "$RELEASE_LOCK_FILE" == "$BACKUP_LOCK_FILE" ]]; then
  printf 'Release and backup lock files must be distinct.\n' >&2
  exit 1
fi
mkdir -p -- "$(dirname -- "$RELEASE_LOCK_FILE")" "$(dirname -- "$BACKUP_LOCK_FILE")"
exec 8>"$RELEASE_LOCK_FILE"
if ! flock -n 8; then
  printf 'Another release or restore operation is active.\n' >&2
  exit 1
fi
exec 9>"$BACKUP_LOCK_FILE"
if ! flock -n 9; then
  printf 'Another backup or restore operation is active.\n' >&2
  exit 1
fi

compose() {
  docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" "$@"
}

compose run --rm --no-deps database-config-preflight

checksum_path="${DUMP_PATH}.sha256"
if [[ -r "${checksum_path}" ]]; then
  (
    cd -- "$(dirname -- "${DUMP_PATH}")"
    sha256sum --check "$(basename -- "${checksum_path}")"
  )
elif [[ "${ALLOW_UNVERIFIED_BACKUP:-false}" != "true" ]]; then
  printf 'Checksum file is missing: %s\n' "${checksum_path}" >&2
  printf 'Set ALLOW_UNVERIFIED_BACKUP=true only after an independent integrity check.\n' >&2
  exit 1
fi

compose exec -T postgres pg_restore --list <"${DUMP_PATH}" >/dev/null

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
target_database="${RESTORE_DATABASE:-q_academy_restore_${timestamp,,}}"
if [[ ! "${target_database}" =~ ^[a-z][a-z0-9_]{0,62}$ ]]; then
  printf 'RESTORE_DATABASE must match ^[a-z][a-z0-9_]{0,62}$.\n' >&2
  exit 1
fi

source_database="$(compose exec -T postgres sh -euc 'printf %s "$POSTGRES_DB"' | tr -d '\r\n')"
in_place=false
restore_ok=false
cleanup_failed_restore() {
  local running_writers=""

  if [[ "${restore_ok}" == "true" ]]; then
    return
  fi
  if [[ "${in_place}" == "true" ]]; then
    if compose stop -t 30 "${DATABASE_WRITER_SERVICES[@]}" >/dev/null 2>&1 &&
       running_writers="$(
         compose ps --status running --services \
           "${DATABASE_WRITER_SERVICES[@]}" 2>/dev/null
       )" &&
       [[ -z "${running_writers}" ]]; then
      printf 'Restore failed. All application and media writers remain stopped for investigation.\n' >&2
      return
    fi
    printf 'Restore failed and not all application and media writers could be confirmed stopped. Immediate operator intervention is required.\n' >&2
    return 1
  else
    printf 'Restore failed. The running production database was not changed.\n' >&2
  fi
}
trap cleanup_failed_restore EXIT

if [[ "${target_database}" == "${source_database}" ]]; then
  if [[ "${RESTORE_IN_PLACE:-false}" != "true" || "${CONFIRM_RESTORE_DATABASE:-}" != "${source_database}" ]]; then
    printf 'In-place restore refused. Set RESTORE_IN_PLACE=true and CONFIRM_RESTORE_DATABASE=%s.\n' "${source_database}" >&2
    exit 1
  fi
  verify_media_work_mount "${ENV_FILE}"
  in_place=true
  compose stop -t 30 "${DATABASE_WRITER_SERVICES[@]}"
fi

# Ensure the non-superuser owner exists before the bootstrap login creates a
# target database owned by it. This is safe to repeat for side-by-side restores.
compose run --rm --no-deps database-role

database_exists="$(compose exec -T -e TARGET_DATABASE="${target_database}" postgres sh -euc '
  export PGPASSWORD="$POSTGRES_PASSWORD"
  psql --host=127.0.0.1 --username="$POSTGRES_USER" --dbname=postgres --tuples-only --no-align --command="select 1 from pg_database where datname = '\''$TARGET_DATABASE'\''"
' | tr -d '[:space:]')"

if [[ "${database_exists}" == "1" && "${REPLACE_TARGET_DATABASE:-false}" != "true" && "${in_place}" != "true" ]]; then
  printf 'Target database already exists. Set REPLACE_TARGET_DATABASE=true to replace it: %s\n' "${target_database}" >&2
  exit 1
fi

compose run --rm --no-deps -T \
  -e TARGET_DATABASE="${target_database}" \
  --entrypoint /bin/sh database-role -euc '
  export PGPASSWORD
  dropdb --host=postgres --username="$PGUSER" --force --if-exists "$TARGET_DATABASE"
  createdb --host=postgres --username="$PGUSER" --owner="$OWNER_DATABASE_USER" --template=template0 "$TARGET_DATABASE"
'

compose run --rm --no-deps -T \
  -e TARGET_DATABASE="${target_database}" \
  --entrypoint /bin/sh database-role -euc '
  export PGPASSWORD="$OWNER_DATABASE_PASSWORD"
  pg_restore \
    --host=postgres \
    --username="$OWNER_DATABASE_USER" \
    --dbname="$TARGET_DATABASE" \
    --exit-on-error \
    --single-transaction \
    --no-owner \
    --no-privileges
' <"${DUMP_PATH}"

migration_count="$(compose exec -T -e TARGET_DATABASE="${target_database}" postgres sh -euc '
  export PGPASSWORD="$POSTGRES_PASSWORD"
  psql --host=127.0.0.1 --username="$POSTGRES_USER" --dbname="$TARGET_DATABASE" --tuples-only --no-align --command="select count(*) from drizzle.__drizzle_migrations"
' | tr -d '[:space:]')"
table_count="$(compose exec -T -e TARGET_DATABASE="${target_database}" postgres sh -euc '
  export PGPASSWORD="$POSTGRES_PASSWORD"
  psql --host=127.0.0.1 --username="$POSTGRES_USER" --dbname="$TARGET_DATABASE" --tuples-only --no-align --command="select count(*) from information_schema.tables where table_schema = '\''public'\''"
' | tr -d '[:space:]')"

if [[ ! "${migration_count}" =~ ^[1-9][0-9]*$ || ! "${table_count}" =~ ^[1-9][0-9]*$ ]]; then
  printf 'Restore verification failed: migrations=%s tables=%s.\n' "${migration_count}" "${table_count}" >&2
  exit 1
fi

compose run --rm --no-deps -e PGDATABASE="${target_database}" database-role
compose run --rm --no-deps -e PGDATABASE="${target_database}" database-permissions

if [[ "${in_place}" == "true" ]]; then
  compose up -d --no-deps --wait --wait-timeout 300 "${DATABASE_RUNTIME_SERVICES[@]}"
  for runtime_service in "${DATABASE_RUNTIME_SERVICES[@]}"; do
    compose exec -T "$runtime_service" node -e \
      "fetch('http://127.0.0.1:3000/api/v1/health/ready').then((response)=>{if(!response.ok)process.exit(1)}).catch(()=>process.exit(1))"
  done
  compose up -d --no-deps --wait \
    --wait-timeout "$DATABASE_DISPATCHER_WAIT_TIMEOUT_SECONDS" \
    "${DATABASE_DISPATCHER_SERVICES[@]}"
  printf 'In-place restore completed and all application and media writers restarted.\n'
else
  printf 'Side-by-side restore completed into database: %s\n' "${target_database}"
  printf 'Change POSTGRES_DB in the production env file only after application-level validation.\n'
fi
restore_ok=true
printf 'Verified restore: migrations=%s tables=%s.\n' "${migration_count}" "${table_count}"
