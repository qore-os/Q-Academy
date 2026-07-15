#!/usr/bin/env bash
set -Eeuo pipefail

umask 077

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="${ROOT_DIR}/compose.production.yml"
REQUIRE_PREREQUISITES="${Q_ACADEMY_DRILL_REQUIRED:-false}"
# shellcheck source=scripts/ops/drill-environment.sh
source "${ROOT_DIR}/scripts/ops/drill-environment.sh"

case "${REQUIRE_PREREQUISITES}" in
  true|false) ;;
  *)
    printf 'Q_ACADEMY_DRILL_REQUIRED must be true or false.\n' >&2
    exit 2
    ;;
esac

if [[ "${REQUIRE_PREREQUISITES}" == "true" ]]; then
  for pinned_image_name in \
    Q_ACADEMY_DRILL_NODE_IMAGE Q_ACADEMY_DRILL_POSTGRES_IMAGE; do
    pinned_image="${!pinned_image_name:-}"
    if [[ -z "${pinned_image}" ]]; then
      printf 'Required drill needs %s with an immutable sha256 digest.\n' \
        "${pinned_image_name}" >&2
      exit 1
    fi
    if [[ ! "${pinned_image}" =~ ^[A-Za-z0-9][A-Za-z0-9._:/-]*@sha256:[a-f0-9]{64}$ ]]; then
      printf 'Required drill rejects mutable %s: %s\n' \
        "${pinned_image_name}" "${pinned_image}" >&2
      exit 1
    fi
  done
fi

skip_or_fail() {
  local message="$1"
  if [[ "${REQUIRE_PREREQUISITES}" == "true" ]]; then
    printf 'PostgreSQL backup/restore drill prerequisite failed: %s\n' "${message}" >&2
    exit 1
  fi
  printf 'SKIP PostgreSQL backup/restore drill: %s\n' "${message}"
  exit 0
}

for required_command in \
  awk cut docker find flock grep mktemp node sed sha256sum stat; do
  command -v "${required_command}" >/dev/null 2>&1 ||
    skip_or_fail "${required_command} is unavailable."
done
docker compose version >/dev/null 2>&1 ||
  skip_or_fail "the Docker Compose plugin is unavailable."
docker info >/dev/null 2>&1 ||
  skip_or_fail "the Docker daemon is unavailable."

dockerfile_node_image="$(
  awk -F= '/^ARG NODE_IMAGE=/ { sub(/^ARG NODE_IMAGE=/, ""); print; exit }' \
    "${ROOT_DIR}/Dockerfile"
)"
node_image="${Q_ACADEMY_DRILL_NODE_IMAGE:-${dockerfile_node_image}}"
if [[ ! "${node_image}" =~ ^[A-Za-z0-9][A-Za-z0-9._:/-]*@sha256:[a-f0-9]{64}$ ]]; then
  printf 'The drill NODE_IMAGE must be pinned by a real sha256 digest.\n' >&2
  exit 1
fi
if ! docker image inspect "${node_image}" >/dev/null 2>&1; then
  printf 'Pulling pinned migrator base image %s...\n' "${node_image}"
  docker pull "${node_image}" >/dev/null
fi

requested_postgres_image="${Q_ACADEMY_DRILL_POSTGRES_IMAGE:-postgres:16.14-alpine3.23}"
if ! docker image inspect "${requested_postgres_image}" >/dev/null 2>&1; then
  printf 'Pulling disposable drill image %s...\n' "${requested_postgres_image}"
  docker pull "${requested_postgres_image}" >/dev/null
fi

if [[ "${requested_postgres_image}" =~ @sha256:[a-f0-9]{64}$ ]]; then
  postgres_image="${requested_postgres_image}"
else
  postgres_image="$({
    docker image inspect \
      --format '{{range .RepoDigests}}{{println .}}{{end}}' \
      "${requested_postgres_image}"
  } | awk 'NF { print; exit }')"
  if [[ ! "${postgres_image}" =~ ^[A-Za-z0-9][A-Za-z0-9._:/-]*@sha256:[a-f0-9]{64}$ ]]; then
    printf 'The drill image has no immutable repository digest: %s\n' \
      "${requested_postgres_image}" >&2
    exit 1
  fi
fi

token="$(
  printf '%s' "$(date -u +%s)-$$-${RANDOM:-0}" |
    sha256sum |
    cut -c1-12
)"
release_commit="$(printf '%s' "${token}" | sha256sum | cut -c1-40)"
project_name="qacademy-drill-${token}"
app_image_tag="git-${release_commit}"
migrator_image="q-academy-migrator:${app_image_tag}"
database_name="qa_drill_${token}"
restore_database="qa_drill_restore_${token}"
bootstrap_user="qa_bootstrap_${token}"
owner_user="qa_owner_${token}"
app_user="qa_app_${token}"
media_user="qa_media_${token}"
fixture_id="fixture-${token}"
fixture_payload="backup-restore-${token}"
work_dir="$(mktemp -d "${TMPDIR:-/tmp}/q-academy-backup-restore-drill.XXXXXX")"
env_file="${work_dir}/drill.env"
backup_dir="${work_dir}/backups"
media_work_dir="${work_dir}/media-work"
compose_ready=false
restore_created=false
migrator_built=false
drill_completed=false
restored_migration_count=""
declare -a compose

cleanup() {
  local status=$?
  local cleanup_failed=false
  trap - EXIT INT TERM
  if [[ "${compose_ready}" == "true" ]]; then
    if [[ "${restore_created}" == "true" ]]; then
      if ! "${compose[@]}" exec -T \
        -e TARGET_DATABASE="${restore_database}" postgres sh -euc '
          export PGPASSWORD="$POSTGRES_PASSWORD"
          dropdb --host=127.0.0.1 --username="$POSTGRES_USER" \
            --force --if-exists "$TARGET_DATABASE"
        ' >/dev/null 2>&1; then
        printf 'Cleanup failed to drop the disposable restore database: %s\n' \
          "${restore_database}" >&2
        cleanup_failed=true
      fi
    fi
    if ! "${compose[@]}" down --volumes --remove-orphans --timeout 10 \
      >/dev/null 2>&1; then
      printf 'Cleanup failed to remove Compose project and volumes: %s\n' \
        "${project_name}" >&2
      cleanup_failed=true
    fi
  fi
  if [[ "${migrator_built}" == "true" ]]; then
    if ! docker image rm "${migrator_image}" >/dev/null 2>&1; then
      printf 'Cleanup failed to remove disposable migrator image: %s\n' \
        "${migrator_image}" >&2
      cleanup_failed=true
    fi
  fi
  if ! rm -rf -- "${work_dir}" || [[ -e "${work_dir}" ]]; then
    printf 'Cleanup failed to remove temporary drill directory: %s\n' \
      "${work_dir}" >&2
    cleanup_failed=true
  fi
  if [[ "${cleanup_failed}" == "true" && "${status}" -eq 0 ]]; then
    status=1
  fi
  if [[ "${status}" -eq 0 && "${drill_completed}" == "true" ]]; then
    printf 'PASS PostgreSQL backup/restore drill: migrations=%s fixture=%s project=%s.\n' \
      "${restored_migration_count}" "${fixture_id}" "${project_name}"
  fi
  exit "${status}"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

mkdir -p -- "${backup_dir}" "${media_work_dir}"
cat >"${env_file}" <<ENV
COMPOSE_PROJECT_NAME=${project_name}
APP_IMAGE_TAG=${app_image_tag}
NODE_IMAGE=${node_image}
POSTGRES_IMAGE=${postgres_image}
CLAMAV_IMAGE=${postgres_image}
CURL_IMAGE=${postgres_image}
PROMETHEUS_IMAGE=${postgres_image}
NODE_EXPORTER_IMAGE=${postgres_image}
CADDY_IMAGE=${postgres_image}
APP_DOMAIN=drill.invalid
CADDY_SITE_ADDRESSES=drill.invalid
ACME_EMAIL=drill@invalid.example
POSTGRES_DB=${database_name}
POSTGRES_BOOTSTRAP_USER=${bootstrap_user}
POSTGRES_BOOTSTRAP_PASSWORD=1111111111111111111111111111111111111111111111111111111111111111
OWNER_POSTGRES_USER=${owner_user}
OWNER_POSTGRES_PASSWORD=2222222222222222222222222222222222222222222222222222222222222222
APP_POSTGRES_USER=${app_user}
APP_POSTGRES_PASSWORD=3333333333333333333333333333333333333333333333333333333333333333
MEDIA_POSTGRES_USER=${media_user}
MEDIA_POSTGRES_PASSWORD=4444444444444444444444444444444444444444444444444444444444444444
SESSION_SECRET=5555555555555555555555555555555555555555555555555555555555555555
AUTH_RATE_LIMIT_SECRET=6666666666666666666666666666666666666666666666666666666666666666
CADDY_TLS_ASK_SECRET=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
WEBHOOK_ENCRYPTION_KEY=7777777777777777777777777777777777777777777777777777777777777777
WEBHOOK_ENCRYPTION_KEY_ID=drill-webhook
DATA_ENCRYPTION_KEY=8888888888888888888888888888888888888888888888888888888888888888
DATA_ENCRYPTION_KEY_ID=drill-data
MFA_RECOVERY_PEPPER=9999999999999999999999999999999999999999999999999999999999999999
MFA_RECOVERY_PEPPER_ID=drill-mfa
PRIVACY_SUBJECT_HMAC_SECRET=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
EXAM_SELECTION_SECRET=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
CRON_SECRET=cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc
MEDIA_CRON_SECRET=dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd
METRICS_SECRET=eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee
MEDIA_METRICS_SECRET=ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff
EMAIL_DELIVERY_WEBHOOK_URL=https://mail.drill.invalid/delivery
EMAIL_DELIVERY_WEBHOOK_SECRET=1010101010101010101010101010101010101010101010101010101010101010
EMAIL_DELIVERY_INBOUND_SECRET=2020202020202020202020202020202020202020202020202020202020202020
LEGAL_IMPRINT_URL=https://drill.invalid/imprint
LEGAL_PRIVACY_URL=https://drill.invalid/privacy
SUPPORT_EMAIL=support@drill.invalid
WEB_PUSH_VAPID_PUBLIC_KEY=drill-public-key
WEB_PUSH_VAPID_PRIVATE_KEY=drill-private-key
WEB_PUSH_VAPID_SUBJECT=mailto:push@drill.invalid
MEDIA_PROCESSING_WORK_DIR=${media_work_dir}
MEDIA_S3_ENDPOINT=https://objects.drill.invalid
MEDIA_S3_REGION=eu-central-1
MEDIA_S3_BUCKET=q-academy-drill
MEDIA_S3_APP_ACCESS_KEY_ID=drill-app
MEDIA_S3_APP_SECRET_ACCESS_KEY=drill-app-secret
MEDIA_S3_ACCESS_KEY_ID=drill-media
MEDIA_S3_SECRET_ACCESS_KEY=drill-media-secret
ENV
chmod 600 -- "${env_file}"
activate_q_academy_drill_environment "${env_file}" "${project_name}"

compose=(
  docker compose
  --env-file "${env_file}"
  --project-name "${project_name}"
  -f "${COMPOSE_FILE}"
)
effective_images="$(
  "${compose[@]}" config --format json |
    node -e '
      const fs = require("node:fs");
      const config = JSON.parse(fs.readFileSync(0, "utf8"));
      const names = ["database-role", "database-permissions", "migrate"];
      process.stdout.write(
        names.map((name) => config.services?.[name]?.image ?? "").join("|"),
      );
    '
)"
IFS='|' read -r database_role_image database_permissions_image \
  effective_migrator_image <<IMAGES
${effective_images}
IMAGES
if [[ "${database_role_image}" != "${postgres_image}" ]] ||
   [[ "${database_permissions_image}" != "${postgres_image}" ]] ||
   [[ "${effective_migrator_image}" != "${migrator_image}" ]]; then
  printf 'Unexpected Compose service images: role=%s permissions=%s migrate=%s.\n' \
    "${database_role_image:-missing}" \
    "${database_permissions_image:-missing}" \
    "${effective_migrator_image:-missing}" >&2
  exit 1
fi
compose_ready=true

if docker image inspect "${migrator_image}" >/dev/null 2>&1; then
  printf 'Unique migrator image tag already exists: %s\n' "${migrator_image}" >&2
  exit 1
fi
printf 'Building the isolated production migrator target %s...\n' \
  "${migrator_image}"
migrator_built=true
"${compose[@]}" build migrate
migrator_image_id="$(
  docker image inspect --format '{{.Id}}' "${migrator_image}"
)"
if [[ ! "${migrator_image_id}" =~ ^sha256:[a-f0-9]{64}$ ]]; then
  printf 'Could not pin the built migrator to one local image ID.\n' >&2
  exit 1
fi

run_psql() {
  local target_database="$1"
  local target_user="$2"
  local target_password="$3"
  "${compose[@]}" run --rm --no-deps -T \
    -e PGDATABASE="${target_database}" \
    -e PGUSER="${target_user}" \
    -e PGPASSWORD="${target_password}" \
    --entrypoint /bin/sh database-role -euc '
      exec psql --host=postgres --username="$PGUSER" --dbname="$PGDATABASE" \
        --set=ON_ERROR_STOP=1 --no-psqlrc --tuples-only --no-align \
        --field-separator="|"
    '
}

printf 'Starting isolated PostgreSQL project %s with %s...\n' \
  "${project_name}" "${postgres_image}"
"${compose[@]}" up -d --wait --wait-timeout 180 postgres
"${compose[@]}" run --rm --no-deps database-role

printf 'Applying the complete migration history as the production owner role...\n'
"${compose[@]}" run --rm --no-deps migrate
used_migrator_image_id="$(
  docker image inspect --format '{{.Id}}' "${migrator_image}"
)"
if [[ "${used_migrator_image_id}" != "${migrator_image_id}" ]]; then
  printf 'The migrator image identity changed during the drill.\n' >&2
  exit 1
fi
"${compose[@]}" run --rm --no-deps database-permissions

run_psql "${database_name}" "${owner_user}" \
  2222222222222222222222222222222222222222222222222222222222222222 <<SQL
create table public.backup_restore_drill_records (
  id text primary key,
  payload text not null,
  created_at timestamp with time zone not null default now()
);
SQL
run_psql "${database_name}" "${app_user}" \
  3333333333333333333333333333333333333333333333333333333333333333 <<SQL
insert into public.backup_restore_drill_records (id, payload)
values ('${fixture_id}', '${fixture_payload}');
SQL
source_migration_count="$(
  run_psql "${database_name}" "${owner_user}" \
    2222222222222222222222222222222222222222222222222222222222222222 <<'SQL'
select count(*) from drizzle.__drizzle_migrations;
SQL
)"
source_migration_count="${source_migration_count//$'\r'/}"
if [[ ! "${source_migration_count}" =~ ^[1-9][0-9]*$ ]]; then
  printf 'The disposable source database has no migration history.\n' >&2
  exit 1
fi

printf 'Creating and restore-verifying the production-format backup...\n'
COMPOSE_PROJECT_NAME="${project_name}" \
Q_ACADEMY_COMPOSE_FILE="${COMPOSE_FILE}" \
Q_ACADEMY_ENV_FILE="${env_file}" \
Q_ACADEMY_APP_IMAGE_TAG_OVERRIDE="${app_image_tag}" \
BACKUP_DIR="${backup_dir}" \
BACKUP_LOCK_FILE="${work_dir}/backup.lock" \
BACKUP_RETENTION_DAYS=1 \
BACKUP_VERIFY_RESTORE=true \
BACKUP_METRICS_FILE="${work_dir}/backup.prom" \
  bash "${ROOT_DIR}/scripts/ops/postgres-backup.sh"

shopt -s nullglob
backup_archives=("${backup_dir}"/q-academy-*.dump)
shopt -u nullglob
if [[ "${#backup_archives[@]}" -ne 1 ]]; then
  printf 'Expected exactly one backup archive, found %s.\n' \
    "${#backup_archives[@]}" >&2
  exit 1
fi
backup_archive="${backup_archives[0]}"
(
  cd -- "${backup_dir}"
  sha256sum --check "$(basename -- "${backup_archive}.sha256")"
)
test -s "${backup_archive}.manifest"

printf 'Restoring with the production side-by-side orchestrator into %s...\n' \
  "${restore_database}"
restore_created=true
COMPOSE_PROJECT_NAME="${project_name}" \
Q_ACADEMY_COMPOSE_FILE="${COMPOSE_FILE}" \
Q_ACADEMY_ENV_FILE="${env_file}" \
RELEASE_LOCK_FILE="${work_dir}/restore-release.lock" \
BACKUP_LOCK_FILE="${work_dir}/backup.lock" \
RESTORE_IN_PLACE=false \
CONFIRM_RESTORE_DATABASE= \
REPLACE_TARGET_DATABASE=false \
ALLOW_UNVERIFIED_BACKUP=false \
RESTORE_DATABASE="${restore_database}" \
  bash "${ROOT_DIR}/scripts/ops/postgres-restore.sh" "${backup_archive}"

restored_payload="$(
  run_psql "${restore_database}" "${app_user}" \
    3333333333333333333333333333333333333333333333333333333333333333 <<SQL
select payload from public.backup_restore_drill_records
where id = '${fixture_id}';
SQL
)"
restored_payload="${restored_payload//$'\r'/}"
if [[ "${restored_payload}" != "${fixture_payload}" ]]; then
  printf 'Restored fixture payload mismatch.\n' >&2
  exit 1
fi
run_psql "${restore_database}" "${app_user}" \
  3333333333333333333333333333333333333333333333333333333333333333 <<SQL
insert into public.backup_restore_drill_records (id, payload)
values ('${fixture_id}-write-check', 'restored-app-write');
SQL
if run_psql "${restore_database}" "${media_user}" \
  4444444444444444444444444444444444444444444444444444444444444444 \
  >/dev/null 2>&1 <<'SQL'
select payload from public.backup_restore_drill_records limit 1;
SQL
then
  printf 'The media role unexpectedly read the restored drill table.\n' >&2
  exit 1
fi

catalog_result="$(
  run_psql "${restore_database}" "${owner_user}" \
    2222222222222222222222222222222222222222222222222222222222222222 <<SQL
select
  (select count(*) from drizzle.__drizzle_migrations),
  pg_get_userbyid(database_record.datdba),
  pg_get_userbyid(table_record.relowner),
  (
    select count(*) = 3
    from pg_roles
    where rolname in ('${owner_user}', '${app_user}', '${media_user}')
      and rolcanlogin
      and not rolsuper
      and not rolcreatedb
      and not rolcreaterole
      and not rolreplication
      and not rolbypassrls
      and not rolinherit
  ),
  (
    select count(*) = 0
    from pg_auth_members membership
    join pg_roles granted_role on granted_role.oid = membership.roleid
    join pg_roles member_role on member_role.oid = membership.member
    where granted_role.rolname in (
      '${bootstrap_user}', '${owner_user}', '${app_user}', '${media_user}'
    ) or member_role.rolname in (
      '${bootstrap_user}', '${owner_user}', '${app_user}', '${media_user}'
    )
  ),
  has_table_privilege(
    '${app_user}', 'public.backup_restore_drill_records',
    'SELECT,INSERT,UPDATE,DELETE'
  ),
  not has_table_privilege(
    '${media_user}', 'public.backup_restore_drill_records', 'SELECT'
  )
from pg_database database_record
join pg_class table_record
  on table_record.oid = 'public.backup_restore_drill_records'::regclass
where database_record.datname = current_database();
SQL
)"
catalog_result="${catalog_result//$'\r'/}"
IFS='|' read -r restored_migration_count restored_database_owner \
  restored_table_owner roles_hardened memberships_empty app_has_dml \
  media_is_denied <<RESULT
${catalog_result}
RESULT
if [[ "${restored_migration_count}" != "${source_migration_count}" ]] ||
   [[ "${restored_database_owner}" != "${owner_user}" ]] ||
   [[ "${restored_table_owner}" != "${owner_user}" ]] ||
   [[ "${roles_hardened}" != "t" ]] ||
   [[ "${memberships_empty}" != "t" ]] ||
   [[ "${app_has_dml}" != "t" ]] ||
   [[ "${media_is_denied}" != "t" ]]; then
  printf 'Restore contract failed: migrations=%s/%s db_owner=%s table_owner=%s roles=%s memberships=%s app_dml=%s media_denied=%s.\n' \
    "${restored_migration_count:-missing}" "${source_migration_count}" \
    "${restored_database_owner:-missing}" "${restored_table_owner:-missing}" \
    "${roles_hardened:-missing}" "${memberships_empty:-missing}" \
    "${app_has_dml:-missing}" "${media_is_denied:-missing}" >&2
  exit 1
fi

drill_completed=true
