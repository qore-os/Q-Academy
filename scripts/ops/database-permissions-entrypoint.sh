#!/bin/sh
set -eu

: "${PGHOST:?PGHOST is required}"
: "${PGDATABASE:?PGDATABASE is required}"
: "${PGUSER:?PGUSER is required}"
: "${PGPASSWORD:?PGPASSWORD is required}"
: "${OWNER_DATABASE_USER:?OWNER_DATABASE_USER is required}"
: "${APP_DATABASE_USER:?APP_DATABASE_USER is required}"
: "${MEDIA_DATABASE_USER:?MEDIA_DATABASE_USER is required}"

psql --set=ON_ERROR_STOP=1 \
  --set=db_name="$PGDATABASE" \
  --set=owner_user="$OWNER_DATABASE_USER" \
  --set=app_user="$APP_DATABASE_USER" \
  --set=media_user="$MEDIA_DATABASE_USER" <<'SQL'
begin;
revoke all on database :"db_name" from public, :"app_user", :"media_user";
grant connect on database :"db_name" to :"app_user", :"media_user";
revoke all on schema public, drizzle from public, :"app_user", :"media_user";
grant usage on schema public, drizzle to :"app_user";
revoke all on all tables in schema public, drizzle from public;
revoke all on all sequences in schema public, drizzle from public;
revoke all on all functions in schema public, drizzle from public, :"app_user", :"media_user";
grant select, insert, update, delete on all tables in schema public
  to :"app_user";
revoke all on table public.tenant_erasure_receipts, public.tenant_erasure_events
  from :"app_user";
revoke delete on table public.organizations from :"app_user";
revoke update, delete on table public.webhook_delivery_attempts from :"app_user";
grant usage, select, update on all sequences in schema public
  to :"app_user";
grant select on all tables in schema drizzle to :"app_user";
grant execute on function public.q_academy_lock_course_link_graph(uuid)
  to :"app_user";

alter table public.custom_field_values enable row level security;
drop policy if exists q_academy_app_full_access on public.custom_field_values;
create policy q_academy_app_full_access on public.custom_field_values
  to :"app_user" using (true) with check (true);
drop policy if exists q_academy_media_bindings_only on public.custom_field_values;
create policy q_academy_media_bindings_only on public.custom_field_values
  to :"media_user" using (
    exists (
      select 1 from public.custom_field_definitions definition
      where definition.id = custom_field_values.field_id
        and definition.organization_id = custom_field_values.organization_id
        and definition.type = 'media'
    )
  );

alter table public.data_profile_values enable row level security;
drop policy if exists q_academy_app_full_access on public.data_profile_values;
create policy q_academy_app_full_access on public.data_profile_values
  to :"app_user" using (true) with check (true);
drop policy if exists q_academy_media_bindings_only on public.data_profile_values;
create policy q_academy_media_bindings_only on public.data_profile_values
  to :"media_user" using (
    exists (
      select 1 from public.custom_field_definitions definition
      where definition.id = data_profile_values.field_id
        and definition.organization_id = data_profile_values.organization_id
        and definition.type = 'media'
    )
  );

alter table public.platform_settings enable row level security;
drop policy if exists q_academy_app_full_access on public.platform_settings;
create policy q_academy_app_full_access on public.platform_settings
  to :"app_user" using (true) with check (true);
drop policy if exists q_academy_media_design_only on public.platform_settings;
create policy q_academy_media_design_only on public.platform_settings
  to :"media_user" using (key = 'design');

grant usage on schema public, drizzle to :"media_user";
revoke all on all tables in schema public from :"media_user";
revoke all on all sequences in schema public from :"media_user";
grant select, update, delete on table public.media_assets to :"media_user";
grant select, delete on table public.media_upload_sessions to :"media_user";
grant update (state, updated_at) on table public.media_upload_sessions to :"media_user";
grant select, insert, update, delete on table public.media_processing_jobs to :"media_user";
grant select, insert, update, delete on table public.media_asset_derivatives to :"media_user";
grant select, insert, update, delete on table public.media_asset_transcripts to :"media_user";
grant select (id, default_locale) on table public.organizations to :"media_user";
grant select (id, organization_id, avatar_url) on table public.users to :"media_user";
grant select (id, organization_id, type) on table public.custom_field_definitions to :"media_user";
grant select (id, organization_id, user_id, field_id, value)
  on table public.custom_field_values to :"media_user";
grant select (id, organization_id, user_id, field_id, value)
  on table public.data_profile_values to :"media_user";
grant select (id, organization_id, key, value)
  on table public.platform_settings to :"media_user";
grant select (id, organization_id, media_asset_id)
  on table public.submission_attachments to :"media_user";
grant select (course_id, organization_id, media_asset_id)
  on table public.course_media_assets to :"media_user";
grant select (media_asset_id, organization_id)
  on table public.community_asset_bindings to :"media_user";
grant select (
  id, workspace_id, source_organization_id, target_organization_id,
  requested_by_account_id, status, claim_token, lease_expires_at
) on table public.orbit_transfer_jobs to :"media_user";
grant update (
  status, failure_code, claim_token, lease_expires_at, completed_at, updated_at
) on table public.orbit_transfer_jobs to :"media_user";
grant select (job_id, kind, target_id)
  on table public.orbit_transfer_items to :"media_user";
grant insert (
  workspace_id, actor_account_id, action, resource_type, resource_id,
  source_organization_id, target_organization_id, outcome, metadata
) on table public.orbit_audit_events to :"media_user";
grant select on all tables in schema drizzle to :"media_user";

alter function public.q_academy_enforce_media_asset_storage_limit() owner to :"owner_user";
alter function public.q_academy_enforce_media_asset_storage_limit() security definer;
alter function public.q_academy_enforce_media_asset_storage_limit()
  set search_path to pg_catalog, public;
revoke all on function public.q_academy_enforce_media_asset_storage_limit() from public;
grant execute on function public.q_academy_enforce_media_asset_storage_limit()
  to :"app_user", :"media_user";

alter function public.q_academy_enforce_media_derivative_storage_limit() owner to :"owner_user";
alter function public.q_academy_enforce_media_derivative_storage_limit() security definer;
alter function public.q_academy_enforce_media_derivative_storage_limit()
  set search_path to pg_catalog, public;
revoke all on function public.q_academy_enforce_media_derivative_storage_limit() from public;
grant execute on function public.q_academy_enforce_media_derivative_storage_limit()
  to :"app_user", :"media_user";
commit;
SQL

psql --set=ON_ERROR_STOP=1 \
  --set=db_name="$PGDATABASE" \
  --set=owner_user="$OWNER_DATABASE_USER" \
  --set=app_user="$APP_DATABASE_USER" \
  --set=media_user="$MEDIA_DATABASE_USER" <<'SQL'
select count(*) = 2 as storage_functions_are_hardened
from pg_proc procedure_record
join pg_namespace namespace_record on namespace_record.oid = procedure_record.pronamespace
join pg_roles owner_role on owner_role.oid = procedure_record.proowner
where namespace_record.nspname = 'public'
  and procedure_record.proname in (
    'q_academy_enforce_media_asset_storage_limit',
    'q_academy_enforce_media_derivative_storage_limit'
  )
  and pg_get_function_identity_arguments(procedure_record.oid) = ''
  and procedure_record.prosecdef
  and owner_role.rolname = :'owner_user'
  and procedure_record.proconfig = array['search_path=pg_catalog, public']
  and exists (
    select 1 from aclexplode(procedure_record.proacl) function_acl
    join pg_roles acl_role on acl_role.oid = function_acl.grantee
    where acl_role.rolname = :'app_user'
      and function_acl.privilege_type = 'EXECUTE'
  )
  and exists (
    select 1 from aclexplode(procedure_record.proacl) function_acl
    join pg_roles acl_role on acl_role.oid = function_acl.grantee
    where acl_role.rolname = :'media_user'
      and function_acl.privilege_type = 'EXECUTE'
  )
  and not exists (
    select 1 from aclexplode(procedure_record.proacl) function_acl
    where function_acl.grantee = 0
      and function_acl.privilege_type = 'EXECUTE'
  )
\gset
\if :storage_functions_are_hardened
\else
  do $verification$
  begin
    raise exception 'Storage trigger function hardening verification failed.';
  end
  $verification$;
\endif

select count(*) = 7 as constraint_trigger_functions_are_hardened
from pg_proc procedure_record
join pg_namespace namespace_record on namespace_record.oid = procedure_record.pronamespace
join pg_roles owner_role on owner_role.oid = procedure_record.proowner
where namespace_record.nspname = 'public'
  and procedure_record.proname in (
    'q_academy_check_exam_module_row',
    'q_academy_check_exam_lesson_row',
    'q_academy_check_exam_page_row',
    'q_academy_check_link_module_row',
    'q_academy_check_link_content_row',
    'q_academy_check_course_module_outline_row',
    'q_academy_check_published_course_link_edge_row'
  )
  and pg_get_function_identity_arguments(procedure_record.oid) = ''
  and procedure_record.prorettype = 'pg_catalog.trigger'::regtype
  and procedure_record.prosecdef
  and owner_role.rolname = :'owner_user'
  and procedure_record.proconfig = array['search_path=pg_catalog, public']
\gset
\if :constraint_trigger_functions_are_hardened
\else
  do $verification$
  begin
    raise exception 'Constraint trigger function hardening verification failed.';
  end
  $verification$;
\endif

select count(*) = 1 as community_media_guard_uses_runtime_registry
from pg_proc procedure_record
join pg_namespace namespace_record on namespace_record.oid = procedure_record.pronamespace
join pg_roles owner_role on owner_role.oid = procedure_record.proowner
where namespace_record.nspname = 'public'
  and procedure_record.proname = 'prevent_bound_community_media_update'
  and pg_get_function_identity_arguments(procedure_record.oid) = ''
  and procedure_record.prorettype = 'pg_catalog.trigger'::regtype
  and not procedure_record.prosecdef
  and owner_role.rolname = :'owner_user'
  and procedure_record.proconfig = array['search_path=pg_catalog, public']
  and position('community_asset_bindings' in pg_get_functiondef(procedure_record.oid)) > 0
  and position('community_post_attachments' in pg_get_functiondef(procedure_record.oid)) = 0
  and position('community_comment_attachments' in pg_get_functiondef(procedure_record.oid)) = 0
\gset
\if :community_media_guard_uses_runtime_registry
\else
  do $verification$
  begin
    raise exception 'Community media guard runtime registry verification failed.';
  end
  $verification$;
\endif

select
  not has_table_privilege(:'app_user', 'public.tenant_erasure_receipts', 'SELECT')
  and not has_table_privilege(:'app_user', 'public.tenant_erasure_receipts', 'INSERT')
  and not has_table_privilege(:'app_user', 'public.tenant_erasure_receipts', 'UPDATE')
  and not has_table_privilege(:'app_user', 'public.tenant_erasure_receipts', 'DELETE')
  and not has_table_privilege(:'app_user', 'public.tenant_erasure_events', 'SELECT')
  and not has_table_privilege(:'app_user', 'public.tenant_erasure_events', 'INSERT')
  and not has_table_privilege(:'app_user', 'public.tenant_erasure_events', 'UPDATE')
  and not has_table_privilege(:'app_user', 'public.tenant_erasure_events', 'DELETE')
  and not has_table_privilege(:'app_user', 'public.organizations', 'DELETE')
  and has_table_privilege(:'app_user', 'public.webhook_delivery_attempts', 'SELECT')
  and has_table_privilege(:'app_user', 'public.webhook_delivery_attempts', 'INSERT')
  and not has_table_privilege(:'app_user', 'public.webhook_delivery_attempts', 'UPDATE')
  and not has_table_privilege(:'app_user', 'public.webhook_delivery_attempts', 'DELETE')
  and has_table_privilege(:'app_user', 'public.organizations', 'SELECT')
  and has_table_privilege(:'app_user', 'public.organizations', 'UPDATE')
  as tenant_erasure_privileges_are_operator_only
\gset
\if :tenant_erasure_privileges_are_operator_only
\else
  do $verification$
  begin
    raise exception 'Tenant erasure privilege verification failed.';
  end
  $verification$;
\endif

select
  not exists (
    select 1
    from pg_database database_record
    cross join lateral aclexplode(
      coalesce(database_record.datacl, acldefault('d', database_record.datdba))
    ) database_acl
    where database_record.datname = :'db_name'
      and database_acl.grantee = 0
      and database_acl.privilege_type in ('CONNECT', 'CREATE', 'TEMPORARY')
  )
  and not exists (
    select 1
    from pg_namespace namespace_record
    cross join lateral aclexplode(
      coalesce(namespace_record.nspacl, acldefault('n', namespace_record.nspowner))
    ) namespace_acl
    where namespace_record.nspname in ('public', 'drizzle')
      and namespace_acl.grantee = 0
  )
  and not exists (
    select 1
    from pg_class relation_record
    join pg_namespace namespace_record on namespace_record.oid = relation_record.relnamespace
    cross join lateral aclexplode(relation_record.relacl) relation_acl
    where namespace_record.nspname in ('public', 'drizzle')
      and relation_acl.grantee = 0
  )
  and not exists (
    select 1
    from pg_attribute column_record
    join pg_class relation_record on relation_record.oid = column_record.attrelid
    join pg_namespace namespace_record on namespace_record.oid = relation_record.relnamespace
    cross join lateral aclexplode(column_record.attacl) column_acl
    where namespace_record.nspname in ('public', 'drizzle')
      and column_acl.grantee = 0
  )
  and not exists (
    select 1
    from pg_proc procedure_record
    join pg_namespace namespace_record on namespace_record.oid = procedure_record.pronamespace
    cross join lateral aclexplode(
      coalesce(procedure_record.proacl, acldefault('f', procedure_record.proowner))
    ) function_acl
    where namespace_record.nspname in ('public', 'drizzle')
      and function_acl.grantee = 0
      and function_acl.privilege_type = 'EXECUTE'
  ) as public_access_is_revoked
\gset
\if :public_access_is_revoked
\else
  do $verification$
  begin
    raise exception 'PUBLIC database privilege reconciliation failed.';
  end
  $verification$;
\endif

select
  has_database_privilege(:'app_user', :'db_name', 'CONNECT')
  and not has_database_privilege(:'app_user', :'db_name', 'CREATE')
  and not has_database_privilege(:'app_user', :'db_name', 'TEMPORARY')
  and has_database_privilege(:'media_user', :'db_name', 'CONNECT')
  and not has_database_privilege(:'media_user', :'db_name', 'CREATE')
  and not has_database_privilege(:'media_user', :'db_name', 'TEMPORARY')
  and has_schema_privilege(:'app_user', 'public', 'USAGE')
  and not has_schema_privilege(:'app_user', 'public', 'CREATE')
  and has_schema_privilege(:'media_user', 'public', 'USAGE')
  and not has_schema_privilege(:'media_user', 'public', 'CREATE')
  as runtime_database_privileges_are_minimal
\gset
\if :runtime_database_privileges_are_minimal
\else
  do $verification$
  begin
    raise exception 'Runtime database or schema privilege verification failed.';
  end
  $verification$;
\endif

select
  count(*) filter (
    where acl_role.rolname = :'media_user'
      and procedure_record.proname in (
        'q_academy_enforce_media_asset_storage_limit',
        'q_academy_enforce_media_derivative_storage_limit'
      )
  ) = 2
  and count(*) filter (where acl_role.rolname = :'media_user') = 2
  and count(*) filter (
    where acl_role.rolname = :'app_user'
      and procedure_record.proname in (
        'q_academy_enforce_media_asset_storage_limit',
        'q_academy_enforce_media_derivative_storage_limit',
        'q_academy_lock_course_link_graph'
      )
  ) = 3
  and count(*) filter (where acl_role.rolname = :'app_user') = 3
  as runtime_function_execution_is_minimal
from pg_proc procedure_record
join pg_namespace namespace_record on namespace_record.oid = procedure_record.pronamespace
cross join lateral aclexplode(
  coalesce(procedure_record.proacl, acldefault('f', procedure_record.proowner))
) function_acl
join pg_roles acl_role on acl_role.oid = function_acl.grantee
where namespace_record.nspname = 'public'
  and function_acl.privilege_type = 'EXECUTE'
  and acl_role.rolname in (:'app_user', :'media_user')
\gset
\if :runtime_function_execution_is_minimal
\else
  do $verification$
  begin
    raise exception 'Runtime function EXECUTE privilege verification failed.';
  end
  $verification$;
\endif

select count(*) = 3 as row_security_is_enabled
from pg_class relation_record
join pg_namespace namespace_record on namespace_record.oid = relation_record.relnamespace
where namespace_record.nspname = 'public'
  and relation_record.relname in ('custom_field_values', 'data_profile_values', 'platform_settings')
  and relation_record.relrowsecurity
\gset
\if :row_security_is_enabled
\else
  do $verification$
  begin
    raise exception 'Row-level security verification failed.';
  end
  $verification$;
\endif

select
  not has_table_privilege(:'media_user', 'public.organization_contracts', 'SELECT')
  and not has_column_privilege(:'media_user', 'public.users', 'email', 'SELECT')
  and not has_column_privilege(:'media_user', 'public.users', 'password_hash', 'SELECT')
  and not has_table_privilege(:'media_user', 'public.users', 'SELECT')
  and not has_table_privilege(:'media_user', 'public.organizations', 'SELECT')
  and has_column_privilege(:'media_user', 'public.users', 'avatar_url', 'SELECT')
  and has_column_privilege(:'media_user', 'public.organizations', 'default_locale', 'SELECT')
  and has_table_privilege(:'media_user', 'public.media_upload_sessions', 'SELECT')
  and has_table_privilege(:'media_user', 'public.media_upload_sessions', 'DELETE')
  and not has_table_privilege(:'media_user', 'public.media_upload_sessions', 'INSERT')
  and not has_table_privilege(:'media_user', 'public.media_upload_sessions', 'UPDATE')
  and has_column_privilege(:'media_user', 'public.media_upload_sessions', 'state', 'UPDATE')
  and has_column_privilege(:'media_user', 'public.media_upload_sessions', 'updated_at', 'UPDATE')
  and not has_column_privilege(:'media_user', 'public.media_upload_sessions', 'provider_upload_id', 'UPDATE')
  and not has_column_privilege(:'media_user', 'public.media_upload_sessions', 'expires_at', 'UPDATE')
  as media_columns_are_restricted
\gset
\if :media_columns_are_restricted
\else
  do $verification$
  begin
    raise exception 'Media database column restriction verification failed.';
  end
  $verification$;
\endif

with expected_orbit_column_privileges (
  table_name, column_name, privilege_type
) as (
  values
    ('orbit_transfer_jobs', 'id', 'SELECT'),
    ('orbit_transfer_jobs', 'workspace_id', 'SELECT'),
    ('orbit_transfer_jobs', 'source_organization_id', 'SELECT'),
    ('orbit_transfer_jobs', 'target_organization_id', 'SELECT'),
    ('orbit_transfer_jobs', 'requested_by_account_id', 'SELECT'),
    ('orbit_transfer_jobs', 'status', 'SELECT'),
    ('orbit_transfer_jobs', 'claim_token', 'SELECT'),
    ('orbit_transfer_jobs', 'lease_expires_at', 'SELECT'),
    ('orbit_transfer_jobs', 'status', 'UPDATE'),
    ('orbit_transfer_jobs', 'failure_code', 'UPDATE'),
    ('orbit_transfer_jobs', 'claim_token', 'UPDATE'),
    ('orbit_transfer_jobs', 'lease_expires_at', 'UPDATE'),
    ('orbit_transfer_jobs', 'completed_at', 'UPDATE'),
    ('orbit_transfer_jobs', 'updated_at', 'UPDATE'),
    ('orbit_transfer_items', 'job_id', 'SELECT'),
    ('orbit_transfer_items', 'kind', 'SELECT'),
    ('orbit_transfer_items', 'target_id', 'SELECT'),
    ('orbit_audit_events', 'workspace_id', 'INSERT'),
    ('orbit_audit_events', 'actor_account_id', 'INSERT'),
    ('orbit_audit_events', 'action', 'INSERT'),
    ('orbit_audit_events', 'resource_type', 'INSERT'),
    ('orbit_audit_events', 'resource_id', 'INSERT'),
    ('orbit_audit_events', 'source_organization_id', 'INSERT'),
    ('orbit_audit_events', 'target_organization_id', 'INSERT'),
    ('orbit_audit_events', 'outcome', 'INSERT'),
    ('orbit_audit_events', 'metadata', 'INSERT')
), orbit_relations as (
  select
    relation_record.oid,
    relation_record.relname as table_name,
    relation_record.relowner,
    relation_record.relkind,
    relation_record.relacl
  from pg_class relation_record
  join pg_namespace namespace_record on namespace_record.oid = relation_record.relnamespace
  where namespace_record.nspname = 'public'
    and relation_record.relname in (
      'orbit_transfer_jobs', 'orbit_transfer_items', 'orbit_audit_events'
    )
), orbit_column_privileges as (
  select
    relation_record.table_name,
    column_record.attname as column_name,
    column_acl.privilege_type,
    column_acl.is_grantable
  from pg_attribute column_record
  join orbit_relations relation_record on relation_record.oid = column_record.attrelid
  cross join lateral aclexplode(column_record.attacl) column_acl
  join pg_roles acl_role on acl_role.oid = column_acl.grantee
  where acl_role.rolname = :'media_user'
), orbit_table_privileges as (
  select 1
  from orbit_relations relation_record
  cross join lateral aclexplode(relation_record.relacl) relation_acl
  join pg_roles acl_role on acl_role.oid = relation_acl.grantee
  where acl_role.rolname = :'media_user'
), orbit_effective_column_privileges as (
  select
    relation_record.table_name,
    column_record.attname as column_name,
    privilege.privilege_type
  from orbit_relations relation_record
  join pg_attribute column_record on column_record.attrelid = relation_record.oid
  cross join (
    values ('SELECT'), ('INSERT'), ('UPDATE'), ('REFERENCES')
  ) privilege (privilege_type)
  where column_record.attnum > 0
    and not column_record.attisdropped
    and has_column_privilege(
      :'media_user', relation_record.oid, column_record.attnum,
      privilege.privilege_type
    )
), orbit_effective_table_privileges as (
  select 1
  from orbit_relations relation_record
  cross join (
    values
      ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'),
      ('REFERENCES'), ('TRIGGER')
  ) privilege (privilege_type)
  where has_table_privilege(
    :'media_user', relation_record.oid, privilege.privilege_type
  )
)
select
  (select count(*) from orbit_relations) = 3
  and (
    select count(*)
    from orbit_relations
    where relkind = 'r'
      and pg_get_userbyid(relowner) = :'owner_user'
  ) = 3
  and not exists (select 1 from orbit_table_privileges)
  and (select count(*) from orbit_column_privileges) = 26
  and not exists (
    select 1 from orbit_column_privileges where is_grantable
  )
  and not exists (
    select table_name, column_name, privilege_type
    from orbit_column_privileges
    except
    select table_name, column_name, privilege_type
    from expected_orbit_column_privileges
  )
  and not exists (
    select table_name, column_name, privilege_type
    from expected_orbit_column_privileges
    except
    select table_name, column_name, privilege_type
    from orbit_column_privileges
  )
  and not exists (select 1 from orbit_effective_table_privileges)
  and (select count(*) from orbit_effective_column_privileges) = 26
  and not exists (
    select table_name, column_name, privilege_type
    from orbit_effective_column_privileges
    except
    select table_name, column_name, privilege_type
    from expected_orbit_column_privileges
  )
  and not exists (
    select table_name, column_name, privilege_type
    from expected_orbit_column_privileges
    except
    select table_name, column_name, privilege_type
    from orbit_effective_column_privileges
  ) as orbit_reconciliation_privileges_are_minimal
\gset
\if :orbit_reconciliation_privileges_are_minimal
\else
  do $verification$
  begin
    raise exception 'Orbit reconciliation privilege verification failed.';
  end
  $verification$;
\endif

select count(*) = 6 as expected_policies_exist
from pg_policy policy_record
join pg_class relation_record on relation_record.oid = policy_record.polrelid
join pg_namespace namespace_record on namespace_record.oid = relation_record.relnamespace
where namespace_record.nspname = 'public'
  and (
    (
      policy_record.polname = 'q_academy_app_full_access'
      and relation_record.relname in ('custom_field_values', 'data_profile_values', 'platform_settings')
      and policy_record.polroles = array[(select oid from pg_roles where rolname = :'app_user')]
      and pg_get_expr(policy_record.polqual, policy_record.polrelid) = 'true'
      and pg_get_expr(policy_record.polwithcheck, policy_record.polrelid) = 'true'
    )
    or (
      policy_record.polname = 'q_academy_media_bindings_only'
      and relation_record.relname in ('custom_field_values', 'data_profile_values')
      and policy_record.polroles = array[(select oid from pg_roles where rolname = :'media_user')]
      and pg_get_expr(policy_record.polqual, policy_record.polrelid) like '%definition.type = ''media''%'
    )
    or (
      policy_record.polname = 'q_academy_media_design_only'
      and relation_record.relname = 'platform_settings'
      and policy_record.polroles = array[(select oid from pg_roles where rolname = :'media_user')]
      and pg_get_expr(policy_record.polqual, policy_record.polrelid) like '%key%''design''%'
    )
  )
\gset
\if :expected_policies_exist
\else
  do $verification$
  begin
    raise exception 'Database policy verification failed.';
  end
  $verification$;
\endif
SQL

printf 'Database permissions and security catalog are reconciled.\n'
