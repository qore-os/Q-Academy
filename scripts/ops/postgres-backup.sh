#!/usr/bin/env bash
set -Eeuo pipefail

umask 077

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=scripts/ops/release-common.sh
source "${ROOT_DIR}/scripts/ops/release-common.sh"
COMPOSE_FILE="${Q_ACADEMY_COMPOSE_FILE:-${ROOT_DIR}/compose.production.yml}"
ENV_FILE="${Q_ACADEMY_ENV_FILE:-/etc/q-academy/production.env}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/q-academy}"
BACKUP_LOCK_FILE="${BACKUP_LOCK_FILE:-$BACKUP_LOCK_FILE_DEFAULT}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
VERIFY_RESTORE="${BACKUP_VERIFY_RESTORE:-true}"
BACKUP_METRICS_FILE="${BACKUP_METRICS_FILE:-/var/lib/q-academy-observability/q-academy-backup.prom}"

if [[ ! -r "${ENV_FILE}" ]]; then
  printf 'Production environment file is not readable: %s\n' "${ENV_FILE}" >&2
  exit 1
fi
configured_release_tag="$(production_env_value "${ENV_FILE}" APP_IMAGE_TAG)" || exit 1
active_release_tag="${Q_ACADEMY_APP_IMAGE_TAG_OVERRIDE:-${configured_release_tag}}"
if [[ ! "${active_release_tag}" =~ ^git-[a-f0-9]{40,64}$ ]]; then
  printf 'APP_IMAGE_TAG must identify the full deployed Git commit.\n' >&2
  exit 1
fi
export APP_IMAGE_TAG="${active_release_tag}"
verify_and_export_pinned_images "${ENV_FILE}"
if [[ ! "${RETENTION_DAYS}" =~ ^[0-9]+$ ]] || (( RETENTION_DAYS < 1 || RETENTION_DAYS > 3650 )); then
  printf 'BACKUP_RETENTION_DAYS must be an integer between 1 and 3650.\n' >&2
  exit 1
fi
if [[ "${VERIFY_RESTORE}" != "true" && "${VERIFY_RESTORE}" != "false" ]]; then
  printf 'BACKUP_VERIFY_RESTORE must be true or false.\n' >&2
  exit 1
fi

mkdir -p -- "${BACKUP_DIR}"
chmod 700 -- "${BACKUP_DIR}"

metrics_enabled=true
metrics_directory="$(dirname -- "${BACKUP_METRICS_FILE}")"
if [[ "${BACKUP_METRICS_FILE}" != *.prom ]]; then
  printf 'BACKUP_METRICS_FILE must use the .prom suffix; backup metrics are disabled.\n' >&2
  metrics_enabled=false
elif [[ ! -d "${metrics_directory}" ]]; then
  if ! mkdir -p -- "${metrics_directory}" || ! chmod 755 -- "${metrics_directory}"; then
    printf 'Backup metrics directory cannot be created; backup metrics are disabled.\n' >&2
    metrics_enabled=false
  fi
elif [[ ! -w "${metrics_directory}" ]]; then
  printf 'Backup metrics directory is not writable; backup metrics are disabled.\n' >&2
  metrics_enabled=false
fi

metric_value() {
  local metric_name="$1"
  local value=""
  if [[ -r "${BACKUP_METRICS_FILE}" ]]; then
    value="$(awk -v name="${metric_name}" '$1 == name { print $2; exit }' "${BACKUP_METRICS_FILE}")"
  fi
  if [[ "${value}" =~ ^[0-9]+$ ]]; then
    printf '%s' "${value}"
  else
    printf '0'
  fi
}

last_success_timestamp="$(metric_value q_academy_backup_last_success_timestamp_seconds)"
last_verified_timestamp="$(metric_value q_academy_backup_last_verified_timestamp_seconds)"
last_backup_size_bytes="$(metric_value q_academy_backup_size_bytes)"
last_run_timestamp="$(date +%s)"

write_backup_metrics() {
  [[ "${metrics_enabled}" == "true" ]] || return 0
  local run_success=0
  local temporary_metrics="${BACKUP_METRICS_FILE}.partial.$$"
  if [[ "${backup_complete}" == "true" ]]; then
    run_success=1
    last_success_timestamp="$(date +%s)"
    last_backup_size_bytes="$(stat --format='%s' -- "${dump_path}")"
    if [[ "${VERIFY_RESTORE}" == "true" ]]; then
      last_verified_timestamp="${last_success_timestamp}"
    fi
  fi
  cat >"${temporary_metrics}" <<METRICS
# HELP q_academy_backup_last_run_timestamp_seconds Unix timestamp when the latest PostgreSQL backup run started.
# TYPE q_academy_backup_last_run_timestamp_seconds gauge
q_academy_backup_last_run_timestamp_seconds ${last_run_timestamp}
# HELP q_academy_backup_last_run_success Whether the latest PostgreSQL backup run completed successfully.
# TYPE q_academy_backup_last_run_success gauge
q_academy_backup_last_run_success ${run_success}
# HELP q_academy_backup_last_success_timestamp_seconds Unix timestamp of the latest successful PostgreSQL backup.
# TYPE q_academy_backup_last_success_timestamp_seconds gauge
q_academy_backup_last_success_timestamp_seconds ${last_success_timestamp}
# HELP q_academy_backup_last_verified_timestamp_seconds Unix timestamp of the latest restore-verified PostgreSQL backup.
# TYPE q_academy_backup_last_verified_timestamp_seconds gauge
q_academy_backup_last_verified_timestamp_seconds ${last_verified_timestamp}
# HELP q_academy_backup_size_bytes Size of the latest successful PostgreSQL backup in bytes.
# TYPE q_academy_backup_size_bytes gauge
q_academy_backup_size_bytes ${last_backup_size_bytes}
METRICS
  chmod 644 -- "${temporary_metrics}"
  mv -- "${temporary_metrics}" "${BACKUP_METRICS_FILE}"
}

mkdir -p -- "$(dirname -- "$BACKUP_LOCK_FILE")"
inherited_backup_lock_fd="${Q_ACADEMY_BACKUP_LOCK_FD:-}"
if [[ -n "$inherited_backup_lock_fd" ]]; then
  if [[ ! "$inherited_backup_lock_fd" =~ ^([3-9]|[1-9][0-9]{1,2})$ ]]; then
    printf 'The inherited backup lock descriptor is invalid.\n' >&2
    exit 1
  fi
  inherited_backup_lock_path="/proc/$$/fd/${inherited_backup_lock_fd}"
  if [[ ! -e "$inherited_backup_lock_path" ]]; then
    printf 'The inherited backup lock descriptor is unavailable.\n' >&2
    exit 1
  fi
  if [[ ! -f "$BACKUP_LOCK_FILE" || -L "$BACKUP_LOCK_FILE" ]]; then
    printf 'The configured backup lock must be a regular non-symlink file.\n' >&2
    exit 1
  fi
  inherited_backup_lock_identity="$(stat -Lc '%d:%i' -- "$inherited_backup_lock_path")" || {
    printf 'The inherited backup lock descriptor cannot be inspected.\n' >&2
    exit 1
  }
  configured_backup_lock_identity="$(stat -Lc '%d:%i' -- "$BACKUP_LOCK_FILE")" || {
    printf 'The configured backup lock file cannot be inspected.\n' >&2
    exit 1
  }
  if [[ "$inherited_backup_lock_identity" != "$configured_backup_lock_identity" ]]; then
    printf 'The inherited backup lock descriptor does not match the configured lock file.\n' >&2
    exit 1
  fi
  if ! flock -n "$inherited_backup_lock_fd"; then
    printf 'The inherited backup lock descriptor could not be locked.\n' >&2
    exit 1
  fi
else
  exec 9>"${BACKUP_LOCK_FILE}"
  if [[ ! -f "$BACKUP_LOCK_FILE" || -L "$BACKUP_LOCK_FILE" ]]; then
    printf 'The backup lock must be a regular non-symlink file.\n' >&2
    exit 1
  fi
  if ! flock -n 9; then
    printf 'Another backup is already running.\n' >&2
    exit 1
  fi
fi

compose() {
  docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" "$@"
}

compose run --rm --no-deps database-config-preflight

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
base_name="q-academy-${timestamp}"
dump_path="${BACKUP_DIR}/${base_name}.dump"
manifest_path="${dump_path}.manifest"
checksum_path="${dump_path}.sha256"
temporary_dump="${dump_path}.partial"
temporary_manifest="${manifest_path}.partial"
verification_database="q_academy_backup_verify_${timestamp,,}"
verification_database="${verification_database//[^a-z0-9_]/_}"
verification_created=false
backup_complete=false

cleanup() {
  rm -f -- "${temporary_dump}" "${temporary_manifest}"
  if [[ "${backup_complete}" != "true" ]]; then
    rm -f -- "${dump_path}" "${manifest_path}" "${checksum_path}"
  fi
  if [[ "${verification_created}" == "true" ]]; then
    compose exec -T -e VERIFY_DATABASE="${verification_database}" postgres sh -euc '
      export PGPASSWORD="$POSTGRES_PASSWORD"
      dropdb --host=127.0.0.1 --username="$POSTGRES_USER" --force --if-exists "$VERIFY_DATABASE"
    ' >/dev/null 2>&1 || true
  fi
  write_backup_metrics || printf 'Could not update backup metrics.\n' >&2
}
trap cleanup EXIT

compose exec -T postgres sh -euc '
  export PGPASSWORD="$POSTGRES_PASSWORD"
  pg_dump \
    --host=127.0.0.1 \
    --username="$POSTGRES_USER" \
    --dbname="$POSTGRES_DB" \
    --format=custom \
    --compress=9 \
    --no-owner \
    --no-privileges
' >"${temporary_dump}"

if [[ ! -s "${temporary_dump}" ]]; then
  printf 'pg_dump produced an empty archive.\n' >&2
  exit 1
fi

compose exec -T postgres pg_restore --list <"${temporary_dump}" >"${temporary_manifest}"
mv -- "${temporary_dump}" "${dump_path}"
mv -- "${temporary_manifest}" "${manifest_path}"
(
  cd -- "${BACKUP_DIR}"
  sha256sum "$(basename -- "${dump_path}")" >"$(basename -- "${checksum_path}")"
)

if [[ "${VERIFY_RESTORE}" == "true" ]]; then
  compose run --rm --no-deps -T \
    -e VERIFY_DATABASE="${verification_database}" \
    --entrypoint /bin/sh database-role -euc '
    export PGPASSWORD
    dropdb --host=postgres --username="$PGUSER" --force --if-exists "$VERIFY_DATABASE"
    createdb --host=postgres --username="$PGUSER" --owner="$OWNER_DATABASE_USER" --template=template0 "$VERIFY_DATABASE"
  '
  verification_created=true

  compose run --rm --no-deps -T \
    -e VERIFY_DATABASE="${verification_database}" \
    --entrypoint /bin/sh database-role -euc '
    export PGPASSWORD="$OWNER_DATABASE_PASSWORD"
    pg_restore \
      --host=postgres \
      --username="$OWNER_DATABASE_USER" \
      --dbname="$VERIFY_DATABASE" \
      --exit-on-error \
      --single-transaction \
      --no-owner \
      --no-privileges
  ' <"${dump_path}"

  verification_result="$(compose run --rm --no-deps -T \
    -e VERIFY_DATABASE="${verification_database}" \
    --entrypoint /bin/sh database-role -euc '
    export PGPASSWORD="$OWNER_DATABASE_PASSWORD"
    psql --host=postgres --username="$OWNER_DATABASE_USER" --dbname="$VERIFY_DATABASE" \
      --set=ON_ERROR_STOP=1 --set=owner_user="$OWNER_DATABASE_USER" \
      --tuples-only --no-align --field-separator="|" <<'"'"'SQL'"'"'
    with owner_identity as (
      select oid from pg_roles where rolname = :'"'"'owner_user'"'"'
    ), misowned_objects as (
      select count(*)::bigint as object_count
      from (
        select namespace_record.oid
        from pg_namespace namespace_record, owner_identity
        where namespace_record.nspname in ('"'"'public'"'"', '"'"'drizzle'"'"')
          and namespace_record.nspowner <> owner_identity.oid
        union all
        select relation_record.oid
        from pg_class relation_record
        join pg_namespace namespace_record on namespace_record.oid = relation_record.relnamespace
        cross join owner_identity
        where namespace_record.nspname in ('"'"'public'"'"', '"'"'drizzle'"'"')
          and relation_record.relowner <> owner_identity.oid
        union all
        select procedure_record.oid
        from pg_proc procedure_record
        join pg_namespace namespace_record on namespace_record.oid = procedure_record.pronamespace
        cross join owner_identity
        where namespace_record.nspname in ('"'"'public'"'"', '"'"'drizzle'"'"')
          and procedure_record.proowner <> owner_identity.oid
        union all
        select type_record.oid
        from pg_type type_record
        join pg_namespace namespace_record on namespace_record.oid = type_record.typnamespace
        cross join owner_identity
        where namespace_record.nspname in ('"'"'public'"'"', '"'"'drizzle'"'"')
          and type_record.typowner <> owner_identity.oid
      ) unexpected_owner
    )
    select
      (select count(*) from drizzle.__drizzle_migrations),
      (select object_count from misowned_objects),
      pg_get_userbyid(database_record.datdba),
      owner_role.rolcanlogin
        and not owner_role.rolsuper
        and not owner_role.rolcreatedb
        and not owner_role.rolcreaterole
        and not owner_role.rolreplication
        and not owner_role.rolbypassrls
        and not owner_role.rolinherit,
      (
        select count(*)
        from pg_auth_members membership
        where membership.roleid = owner_role.oid or membership.member = owner_role.oid
      )
    from pg_database database_record
    join pg_roles owner_role on owner_role.rolname = :'"'"'owner_user'"'"'
    where database_record.datname = current_database();
SQL
  ' | tail -n 1 | tr -d '\r')"
  IFS='|' read -r migration_count misowned_count database_owner owner_role_hardened owner_memberships <<EOF
${verification_result}
EOF
  if [[ ! "${migration_count:-}" =~ ^[1-9][0-9]*$ ]] ||
     [[ "${misowned_count:-}" != "0" ]] ||
     [[ "${database_owner:-}" != "$(production_env_value "${ENV_FILE}" OWNER_POSTGRES_USER)" ]] ||
     [[ "${owner_role_hardened:-}" != "t" ]] ||
     [[ "${owner_memberships:-}" != "0" ]]; then
    printf 'Restore verification failed: migrations=%s misowned=%s owner=%s hardened=%s memberships=%s.\n' \
      "${migration_count:-missing}" "${misowned_count:-missing}" "${database_owner:-missing}" \
      "${owner_role_hardened:-missing}" "${owner_memberships:-missing}" >&2
    exit 1
  fi
fi

find "${BACKUP_DIR}" -maxdepth 1 -type f \
  \( -name 'q-academy-*.dump' -o -name 'q-academy-*.dump.sha256' -o -name 'q-academy-*.dump.manifest' \) \
  -mtime "+${RETENTION_DAYS}" -delete

backup_complete=true
if [[ "${VERIFY_RESTORE}" == "true" ]]; then
  printf 'Verified PostgreSQL backup created: %s\n' "${dump_path}"
else
  printf 'PostgreSQL backup created without restore verification: %s\n' "${dump_path}"
fi
