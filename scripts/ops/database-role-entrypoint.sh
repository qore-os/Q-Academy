#!/bin/sh
set -eu

validation_script=/opt/q-academy/database-config-preflight.sh
if [ ! -r "$validation_script" ]; then
  printf 'Database configuration validation script is unavailable.\n' >&2
  exit 1
fi
sh "$validation_script" >/dev/null

: "${PGHOST:?PGHOST is required}"
: "${PGDATABASE:?PGDATABASE is required}"
: "${PGUSER:?PGUSER is required}"
: "${PGPASSWORD:?PGPASSWORD is required}"

role_mode="${DATABASE_ROLE_MODE:-reconcile}"
case "$role_mode" in
  validate|reconcile) ;;
  *)
    printf 'DATABASE_ROLE_MODE must be validate or reconcile.\n' >&2
    exit 1
    ;;
esac

if [ "$PGUSER" != "$POSTGRES_BOOTSTRAP_USER" ] ||
   [ "$PGPASSWORD" != "$POSTGRES_BOOTSTRAP_PASSWORD" ] ||
   [ "$OWNER_DATABASE_USER" != "$OWNER_POSTGRES_USER" ] ||
   [ "$OWNER_DATABASE_PASSWORD" != "$OWNER_POSTGRES_PASSWORD" ] ||
   [ "$APP_DATABASE_USER" != "$APP_POSTGRES_USER" ] ||
   [ "$APP_DATABASE_PASSWORD" != "$APP_POSTGRES_PASSWORD" ] ||
   [ "$MEDIA_DATABASE_USER" != "$MEDIA_POSTGRES_USER" ] ||
   [ "$MEDIA_DATABASE_PASSWORD" != "$MEDIA_POSTGRES_PASSWORD" ]; then
  printf 'Database role aliases disagree with the validated production configuration.\n' >&2
  exit 1
fi

identity_state="$(
  psql --set=ON_ERROR_STOP=1 --tuples-only --no-align --field-separator='|' \
    --set=db_name="$PGDATABASE" \
    --set=bootstrap_user="$PGUSER" \
    --set=owner_user="$OWNER_DATABASE_USER" \
    --set=app_user="$APP_DATABASE_USER" \
    --set=media_user="$MEDIA_DATABASE_USER" <<'SQL'
with database_settings as (
  select
    split_part(setting, '=', 1) as setting_name,
    substring(setting from strpos(setting, '=') + 1) as setting_value
  from pg_db_role_setting role_setting
  cross join lateral unnest(role_setting.setconfig) as setting
  where role_setting.setdatabase = (
    select oid from pg_database where datname = :'db_name'
  )
    and role_setting.setrole = 0
), target_namespaces as (
  select oid
  from pg_namespace
  where nspname in ('public', 'drizzle')
), referenced_roles as (
  select database_record.datdba as role_oid
  from pg_database database_record
  where database_record.datname = :'db_name'
  union
  select namespace_record.nspowner
  from pg_namespace namespace_record
  where namespace_record.oid in (select oid from target_namespaces)
  union
  select relation_record.relowner
  from pg_class relation_record
  where relation_record.relnamespace in (select oid from target_namespaces)
  union
  select procedure_record.proowner
  from pg_proc procedure_record
  where procedure_record.pronamespace in (select oid from target_namespaces)
  union
  select type_record.typowner
  from pg_type type_record
  where type_record.typnamespace in (select oid from target_namespaces)
  union
  select default_acl.defaclrole
  from pg_default_acl default_acl
  where default_acl.defaclnamespace = 0
     or default_acl.defaclnamespace in (select oid from target_namespaces)
  union
  select database_acl.grantee
  from pg_database database_record
  cross join lateral aclexplode(database_record.datacl) database_acl
  where database_record.datname = :'db_name'
  union
  select namespace_acl.grantee
  from pg_namespace namespace_record
  cross join lateral aclexplode(namespace_record.nspacl) namespace_acl
  where namespace_record.oid in (select oid from target_namespaces)
  union
  select relation_acl.grantee
  from pg_class relation_record
  cross join lateral aclexplode(relation_record.relacl) relation_acl
  where relation_record.relnamespace in (select oid from target_namespaces)
  union
  select column_acl.grantee
  from pg_attribute column_record
  join pg_class relation_record on relation_record.oid = column_record.attrelid
  cross join lateral aclexplode(column_record.attacl) column_acl
  where relation_record.relnamespace in (select oid from target_namespaces)
  union
  select function_acl.grantee
  from pg_proc procedure_record
  cross join lateral aclexplode(procedure_record.proacl) function_acl
  where procedure_record.pronamespace in (select oid from target_namespaces)
  union
  select type_acl.grantee
  from pg_type type_record
  cross join lateral aclexplode(type_record.typacl) type_acl
  where type_record.typnamespace in (select oid from target_namespaces)
  union
  select default_acl_entry.grantee
  from pg_default_acl default_acl
  cross join lateral aclexplode(default_acl.defaclacl) default_acl_entry
  where default_acl.defaclnamespace = 0
     or default_acl.defaclnamespace in (select oid from target_namespaces)
  union
  select unnest(policy_record.polroles)
  from pg_policy policy_record
  join pg_class relation_record on relation_record.oid = policy_record.polrelid
  where relation_record.relnamespace in (select oid from target_namespaces)
  union
  select membership.roleid
  from pg_auth_members membership
  join pg_roles member_role on member_role.oid = membership.member
  where member_role.rolname in (:'bootstrap_user', :'owner_user', :'app_user', :'media_user')
  union
  select membership.member
  from pg_auth_members membership
  join pg_roles granted_role on granted_role.oid = membership.roleid
  where granted_role.rolname in (:'bootstrap_user', :'owner_user', :'app_user', :'media_user')
)
select
  coalesce((select setting_value from database_settings where setting_name = 'q_academy.bootstrap_role'), '') as stored_bootstrap,
  coalesce((select setting_value from database_settings where setting_name = 'q_academy.owner_role'), '') as stored_owner,
  coalesce((select setting_value from database_settings where setting_name = 'q_academy.app_role'), '') as stored_app,
  coalesce((select setting_value from database_settings where setting_name = 'q_academy.media_role'), '') as stored_media,
  pg_get_userbyid(database_record.datdba) as current_owner,
  (
    select count(*)::integer
    from (select distinct role_oid from referenced_roles where role_oid <> 0) referenced_role
    join pg_roles role_record on role_record.oid = referenced_role.role_oid
    where role_record.rolname not in (:'bootstrap_user', :'owner_user', :'app_user', :'media_user')
      and left(role_record.rolname, 3) <> 'pg_'
  ) as legacy_role_count
from pg_database database_record
where database_record.datname = :'db_name';
SQL
)"

IFS='|' read -r stored_bootstrap stored_owner stored_app stored_media current_owner legacy_role_count <<EOF
$identity_state
EOF

if [ "${legacy_role_count:-missing}" != "0" ]; then
  printf 'Unreconciled legacy database owners, grants, policies, or memberships were detected.\n' >&2
  exit 1
fi

marker_count=0
[ -n "${stored_bootstrap:-}" ] && marker_count=$((marker_count + 1))
[ -n "${stored_owner:-}" ] && marker_count=$((marker_count + 1))
[ -n "${stored_app:-}" ] && marker_count=$((marker_count + 1))
[ -n "${stored_media:-}" ] && marker_count=$((marker_count + 1))

if [ "$marker_count" -eq 0 ]; then
  if [ "${current_owner:-}" != "$PGUSER" ] && [ "${current_owner:-}" != "$OWNER_DATABASE_USER" ]; then
    printf 'Database role identity is unmarked and its current owner is unexpected.\n' >&2
    exit 1
  fi
elif [ "$marker_count" -ne 4 ] ||
     [ "$stored_bootstrap" != "$PGUSER" ] ||
     [ "$stored_owner" != "$OWNER_DATABASE_USER" ] ||
     [ "$stored_app" != "$APP_DATABASE_USER" ] ||
     [ "$stored_media" != "$MEDIA_DATABASE_USER" ]; then
  printf 'PostgreSQL role names are immutable after database initialization.\n' >&2
  exit 1
fi

if [ "$role_mode" = "validate" ]; then
  printf 'Database role identities and legacy references are valid; no roles or grants were changed.\n'
  exit 0
fi

psql --set=ON_ERROR_STOP=1 \
  --set=bootstrap_user="$PGUSER" \
  --set=owner_user="$OWNER_DATABASE_USER" \
  --set=app_user="$APP_DATABASE_USER" \
  --set=media_user="$MEDIA_DATABASE_USER" \
  --set=db_name="$PGDATABASE" <<SQL
begin;
select format('create role %I login', :'owner_user')
where not exists (select 1 from pg_roles where rolname = :'owner_user')
\gexec
select format('create role %I login', :'app_user')
where not exists (select 1 from pg_roles where rolname = :'app_user')
\gexec
select format('create role %I login', :'media_user')
where not exists (select 1 from pg_roles where rolname = :'media_user')
\gexec

alter role :"owner_user" with login password '$OWNER_DATABASE_PASSWORD'
  nosuperuser nocreatedb nocreaterole noreplication nobypassrls noinherit;
alter role :"app_user" with login password '$APP_DATABASE_PASSWORD'
  nosuperuser nocreatedb nocreaterole noreplication nobypassrls noinherit;
alter role :"media_user" with login password '$MEDIA_DATABASE_PASSWORD'
  nosuperuser nocreatedb nocreaterole noreplication nobypassrls noinherit;

select format('revoke %I from %I', granted_role.rolname, member_role.rolname)
from pg_auth_members membership
join pg_roles granted_role on granted_role.oid = membership.roleid
join pg_roles member_role on member_role.oid = membership.member
where granted_role.rolname in (:'bootstrap_user', :'owner_user', :'app_user', :'media_user')
   or member_role.rolname in (:'bootstrap_user', :'owner_user', :'app_user', :'media_user')
\gexec

revoke all on database :"db_name" from public, :"app_user", :"media_user";
grant connect on database :"db_name" to :"owner_user", :"app_user", :"media_user";
alter database :"db_name" owner to :"owner_user";
alter schema public owner to :"owner_user";
revoke all on schema public from public, :"app_user", :"media_user";
grant usage on schema public to :"app_user";
alter default privileges for role :"owner_user" in schema public
  grant select, insert, update, delete on tables to :"app_user";
alter default privileges for role :"owner_user" in schema public
  grant usage, select, update on sequences to :"app_user";
alter default privileges for role :"owner_user" in schema public
  revoke execute on functions from public;

select format('alter database %I set q_academy.bootstrap_role to %L', :'db_name', :'bootstrap_user')
\gexec
select format('alter database %I set q_academy.owner_role to %L', :'db_name', :'owner_user')
\gexec
select format('alter database %I set q_academy.app_role to %L', :'db_name', :'app_user')
\gexec
select format('alter database %I set q_academy.media_role to %L', :'db_name', :'media_user')
\gexec
commit;
SQL

psql --set=ON_ERROR_STOP=1 \
  --set=bootstrap_user="$PGUSER" \
  --set=owner_user="$OWNER_DATABASE_USER" \
  --set=app_user="$APP_DATABASE_USER" \
  --set=media_user="$MEDIA_DATABASE_USER" \
  --set=db_name="$PGDATABASE" <<'SQL'
select count(*) = 3 as roles_are_hardened
from pg_roles
where rolname in (:'owner_user', :'app_user', :'media_user')
  and rolcanlogin
  and not rolsuper
  and not rolcreatedb
  and not rolcreaterole
  and not rolreplication
  and not rolbypassrls
  and not rolinherit
\gset
\if :roles_are_hardened
\else
  \echo 'Database role hardening verification failed.'
  \quit 1
\endif

select count(*) = 0 as memberships_are_empty
from pg_auth_members membership
join pg_roles granted_role on granted_role.oid = membership.roleid
join pg_roles member_role on member_role.oid = membership.member
where granted_role.rolname in (:'bootstrap_user', :'owner_user', :'app_user', :'media_user')
   or member_role.rolname in (:'bootstrap_user', :'owner_user', :'app_user', :'media_user')
\gset
\if :memberships_are_empty
\else
  \echo 'Database role membership verification failed.'
  \quit 1
\endif

select
  pg_get_userbyid(database_record.datdba) = :'owner_user'
  and pg_get_userbyid(namespace_record.nspowner) = :'owner_user'
  and current_setting('q_academy.bootstrap_role') = :'bootstrap_user'
  and current_setting('q_academy.owner_role') = :'owner_user'
  and current_setting('q_academy.app_role') = :'app_user'
  and current_setting('q_academy.media_role') = :'media_user'
  as ownership_and_identity_are_valid
from pg_database database_record
join pg_namespace namespace_record on namespace_record.nspname = 'public'
where database_record.datname = :'db_name'
\gset
\if :ownership_and_identity_are_valid
\else
  \echo 'Database ownership or immutable role identity verification failed.'
  \quit 1
\endif
SQL

printf 'Database roles and immutable identities are reconciled.\n'
