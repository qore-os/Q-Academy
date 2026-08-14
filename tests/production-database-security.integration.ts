import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const projectRoot = fileURLToPath(new URL("../", import.meta.url));
const adminUrl =
  process.env.POSTGRES_ADMIN_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/postgres";
const databaseName = "q_academy_production_security_test";
const ownerRole = "q_academy_security_owner_test";
const appRole = "q_academy_security_app_test";
const mediaRole = "q_academy_security_media_test";
const staleRole = "q_academy_security_stale_test";
const password = "ProductionSecurityTest-7f1e5d3c9b";

function roleUrl(role: string) {
  const url = new URL(adminUrl);
  url.username = role;
  url.password = password;
  url.pathname = `/${databaseName}`;
  return url.toString();
}

function databaseErrorCode(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error
    ? String(error.code)
    : null;
}

function permissionsMutationSql() {
  const script = readFileSync(
    path.join(
      projectRoot,
      "scripts",
      "ops",
      "database-permissions-entrypoint.sh",
    ),
    "utf8",
  );
  const blocks = [...script.matchAll(/<<'SQL'\r?\n([\s\S]*?)\r?\nSQL/g)];
  const mutation = blocks[0]?.[1];
  assert.ok(mutation, "permissions mutation SQL block is missing");
  return mutation
    .replaceAll(':"db_name"', `"${databaseName}"`)
    .replaceAll(':"owner_user"', `"${ownerRole}"`)
    .replaceAll(':"app_user"', `"${appRole}"`)
    .replaceAll(':"media_user"', `"${mediaRole}"`);
}

function orbitReconciliationVerificationSql() {
  const script = readFileSync(
    path.join(
      projectRoot,
      "scripts",
      "ops",
      "database-permissions-entrypoint.sh",
    ),
    "utf8",
  );
  const blocks = [...script.matchAll(/<<'SQL'\r?\n([\s\S]*?)\r?\nSQL/g)];
  const verification = blocks[1]?.[1];
  assert.ok(verification, "permissions verification SQL block is missing");
  const query =
    /with expected_orbit_column_privileges[\s\S]*?as orbit_reconciliation_privileges_are_minimal/.exec(
      verification,
    )?.[0];
  assert.ok(query, "Orbit permissions verification query is missing");
  return query
    .replaceAll(":'owner_user'", `'${ownerRole}'`)
    .replaceAll(":'media_user'", `'${mediaRole}'`);
}

function roleIdentityQuery() {
  const script = readFileSync(
    path.join(projectRoot, "scripts", "ops", "database-role-entrypoint.sh"),
    "utf8",
  );
  const block = /<<'SQL'\r?\n([\s\S]*?)\r?\nSQL/.exec(script)?.[1];
  assert.ok(block, "database role identity SQL block is missing");
  return block
    .replaceAll(":'db_name'", `'${databaseName}'`)
    .replaceAll(":'bootstrap_user'", "'postgres'")
    .replaceAll(":'owner_user'", `'${ownerRole}'`)
    .replaceAll(":'app_user'", `'${appRole}'`)
    .replaceAll(":'media_user'", `'${mediaRole}'`);
}

test(
  "production runtime permissions execute hardened integrity triggers without broad data access",
  { timeout: 120_000 },
  async () => {
    const admin = postgres(adminUrl, { max: 1 });
    let databaseAdmin: ReturnType<typeof postgres> | undefined;
    let owner: ReturnType<typeof postgres> | undefined;
    let app: ReturnType<typeof postgres> | undefined;
    let media: ReturnType<typeof postgres> | undefined;
    let mediaReconciliationClient: ReturnType<typeof postgres> | undefined;
    try {
      await admin.unsafe(
        `drop database if exists "${databaseName}" with (force)`,
      );
      for (const role of [staleRole, mediaRole, appRole, ownerRole]) {
        await admin.unsafe(`drop role if exists "${role}"`);
      }
      for (const role of [ownerRole, appRole, mediaRole]) {
        await admin.unsafe(
          `create role "${role}" login password '${password}' nosuperuser nocreatedb nocreaterole noreplication nobypassrls noinherit`,
        );
      }
      await admin.unsafe(
        `create database "${databaseName}" with owner "${ownerRole}" template template0 encoding 'UTF8' lc_collate 'C' lc_ctype 'C'`,
      );
      const databaseAdminUrl = new URL(adminUrl);
      databaseAdminUrl.pathname = `/${databaseName}`;
      databaseAdmin = postgres(databaseAdminUrl.toString(), { max: 1 });
      await admin.begin(async (transaction) => {
        await transaction.unsafe(
          `alter database "${databaseName}" set q_academy.bootstrap_role to 'postgres'`,
        );
        await transaction.unsafe(
          `alter database "${databaseName}" set q_academy.owner_role to '${ownerRole}'`,
        );
        await transaction.unsafe(
          `alter database "${databaseName}" set q_academy.app_role to '${appRole}'`,
        );
        await transaction.unsafe(
          `alter database "${databaseName}" set q_academy.media_role to '${mediaRole}'`,
        );
      });

      owner = postgres(roleUrl(ownerRole), { max: 1 });
      await migrate(drizzle(owner), {
        migrationsFolder: path.join(projectRoot, "drizzle"),
      });
      await owner.unsafe(permissionsMutationSql());
      const [verifiedOrbitPrivileges] = await owner.unsafe(
        orbitReconciliationVerificationSql(),
      );
      assert.equal(
        verifiedOrbitPrivileges.orbit_reconciliation_privileges_are_minimal,
        true,
      );
      await databaseAdmin.unsafe(
        `alter table orbit_transfer_jobs owner to "${mediaRole}"`,
      );
      const [ownershipDrift] = await owner.unsafe(
        orbitReconciliationVerificationSql(),
      );
      assert.equal(
        ownershipDrift.orbit_reconciliation_privileges_are_minimal,
        false,
      );
      await databaseAdmin.unsafe(
        `alter table orbit_transfer_jobs owner to "${ownerRole}"`,
      );
      await owner.unsafe(permissionsMutationSql());
      const [restoredOrbitPrivileges] = await owner.unsafe(
        orbitReconciliationVerificationSql(),
      );
      assert.equal(
        restoredOrbitPrivileges.orbit_reconciliation_privileges_are_minimal,
        true,
      );

      const [catalog] = await owner<
        Array<{
          hardenedFunctions: number;
          hardenedConstraintTriggers: number;
          communityMediaGuardUsesRegistry: boolean;
          mediaContractAccess: boolean;
          mediaFunctionAccess: number;
          appFunctionAccess: number;
          publicFunctionAccess: number;
          runtimeDatabaseAccessIsMinimal: boolean;
          roleSettings: string[];
          verifiedPolicies: number;
        }>
      >`
        select
          (
            select count(*)::integer
            from pg_proc procedure_record
            join pg_namespace namespace_record
              on namespace_record.oid = procedure_record.pronamespace
            where namespace_record.nspname = 'public'
              and procedure_record.proname in (
                'q_academy_enforce_media_asset_storage_limit',
                'q_academy_enforce_media_derivative_storage_limit'
              )
              and procedure_record.prosecdef
              and pg_get_userbyid(procedure_record.proowner) = ${ownerRole}
              and procedure_record.proconfig = array['search_path=pg_catalog, public']
              and not exists (
                select 1 from aclexplode(procedure_record.proacl) function_acl
                where function_acl.grantee = 0
                  and function_acl.privilege_type = 'EXECUTE'
              )
          ) as "hardenedFunctions",
          (
            select count(*)::integer
            from pg_proc procedure_record
            join pg_namespace namespace_record
              on namespace_record.oid = procedure_record.pronamespace
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
              and pg_get_userbyid(procedure_record.proowner) = ${ownerRole}
              and procedure_record.proconfig = array['search_path=pg_catalog, public']
              and not exists (
                select 1 from aclexplode(procedure_record.proacl) function_acl
                where function_acl.grantee = 0
                  and function_acl.privilege_type = 'EXECUTE'
              )
          ) as "hardenedConstraintTriggers",
          (
            select count(*) = 1
            from pg_proc procedure_record
            join pg_namespace namespace_record
              on namespace_record.oid = procedure_record.pronamespace
            where namespace_record.nspname = 'public'
              and procedure_record.proname = 'prevent_bound_community_media_update'
              and pg_get_function_identity_arguments(procedure_record.oid) = ''
              and not procedure_record.prosecdef
              and pg_get_userbyid(procedure_record.proowner) = ${ownerRole}
              and procedure_record.proconfig = array['search_path=pg_catalog, public']
              and position('community_asset_bindings' in pg_get_functiondef(procedure_record.oid)) > 0
              and position('community_post_attachments' in pg_get_functiondef(procedure_record.oid)) = 0
              and position('community_comment_attachments' in pg_get_functiondef(procedure_record.oid)) = 0
          ) as "communityMediaGuardUsesRegistry",
          has_table_privilege(${mediaRole}, 'public.organization_contracts', 'SELECT')
            as "mediaContractAccess",
          (
            select count(*)::integer
            from pg_proc procedure_record
            join pg_namespace namespace_record on namespace_record.oid = procedure_record.pronamespace
            cross join lateral aclexplode(
              coalesce(procedure_record.proacl, acldefault('f', procedure_record.proowner))
            ) function_acl
            where namespace_record.nspname = 'public'
              and function_acl.grantee = (select oid from pg_roles where rolname = ${mediaRole})
              and function_acl.privilege_type = 'EXECUTE'
          ) as "mediaFunctionAccess",
          (
            select count(*)::integer
            from pg_proc procedure_record
            join pg_namespace namespace_record on namespace_record.oid = procedure_record.pronamespace
            cross join lateral aclexplode(
              coalesce(procedure_record.proacl, acldefault('f', procedure_record.proowner))
            ) function_acl
            where namespace_record.nspname = 'public'
              and function_acl.grantee = (select oid from pg_roles where rolname = ${appRole})
              and function_acl.privilege_type = 'EXECUTE'
          ) as "appFunctionAccess",
          (
            select count(*)::integer
            from pg_proc procedure_record
            join pg_namespace namespace_record on namespace_record.oid = procedure_record.pronamespace
            cross join lateral aclexplode(
              coalesce(procedure_record.proacl, acldefault('f', procedure_record.proowner))
            ) function_acl
            where namespace_record.nspname in ('public', 'drizzle')
              and function_acl.grantee = 0
              and function_acl.privilege_type = 'EXECUTE'
          ) as "publicFunctionAccess",
          has_database_privilege(${appRole}, ${databaseName}, 'CONNECT')
            and not has_database_privilege(${appRole}, ${databaseName}, 'CREATE')
            and not has_database_privilege(${appRole}, ${databaseName}, 'TEMPORARY')
            and has_database_privilege(${mediaRole}, ${databaseName}, 'CONNECT')
            and not has_database_privilege(${mediaRole}, ${databaseName}, 'CREATE')
            and not has_database_privilege(${mediaRole}, ${databaseName}, 'TEMPORARY')
            and not has_schema_privilege(${appRole}, 'public', 'CREATE')
            and not has_schema_privilege(${mediaRole}, 'public', 'CREATE')
            as "runtimeDatabaseAccessIsMinimal",
          array[
            current_setting('q_academy.bootstrap_role'),
            current_setting('q_academy.owner_role'),
            current_setting('q_academy.app_role'),
            current_setting('q_academy.media_role')
          ] as "roleSettings",
          (
            select count(*)::integer
            from pg_policy policy_record
            join pg_class relation_record
              on relation_record.oid = policy_record.polrelid
            where (
              policy_record.polname = 'q_academy_app_full_access'
              and policy_record.polroles = array[(select oid from pg_roles where rolname = ${appRole})]
              and pg_get_expr(policy_record.polqual, policy_record.polrelid) = 'true'
              and pg_get_expr(policy_record.polwithcheck, policy_record.polrelid) = 'true'
            ) or (
              policy_record.polname = 'q_academy_media_bindings_only'
              and policy_record.polroles = array[(select oid from pg_roles where rolname = ${mediaRole})]
              and pg_get_expr(policy_record.polqual, policy_record.polrelid) like '%definition.type = ''media''%'
            ) or (
              policy_record.polname = 'q_academy_media_design_only'
              and policy_record.polroles = array[(select oid from pg_roles where rolname = ${mediaRole})]
              and pg_get_expr(policy_record.polqual, policy_record.polrelid) like '%key%''design''%'
            )
          ) as "verifiedPolicies"
      `;
      assert.equal(catalog?.hardenedFunctions, 2);
      assert.equal(catalog?.hardenedConstraintTriggers, 7);
      assert.equal(catalog?.communityMediaGuardUsesRegistry, true);
      assert.equal(catalog?.mediaContractAccess, false);
      assert.equal(catalog?.mediaFunctionAccess, 2);
      assert.equal(catalog?.appFunctionAccess, 3);
      assert.equal(catalog?.publicFunctionAccess, 0);
      assert.equal(catalog?.runtimeDatabaseAccessIsMinimal, true);
      if (catalog?.verifiedPolicies !== 6) {
        const policyDetails = await owner.unsafe(`
          select relation_record.relname, policy_record.polname,
            pg_get_expr(policy_record.polqual, policy_record.polrelid) as using_expression,
            pg_get_expr(policy_record.polwithcheck, policy_record.polrelid) as check_expression
          from pg_policy policy_record
          join pg_class relation_record on relation_record.oid = policy_record.polrelid
          where policy_record.polname like 'q_academy_%'
          order by relation_record.relname, policy_record.polname
        `);
        assert.fail(JSON.stringify(policyDetails));
      }
      assert.deepEqual(catalog?.roleSettings, [
        "postgres",
        ownerRole,
        appRole,
        mediaRole,
      ]);
      const orbitColumnPrivileges = await owner<
        Array<{
          tableName: string;
          columnName: string;
          privilegeType: string;
          isGrantable: boolean;
        }>
      >`
        select relation_record.relname as "tableName",
               column_record.attname as "columnName",
               column_acl.privilege_type as "privilegeType",
               column_acl.is_grantable as "isGrantable"
        from pg_attribute column_record
        join pg_class relation_record on relation_record.oid = column_record.attrelid
        join pg_namespace namespace_record on namespace_record.oid = relation_record.relnamespace
        cross join lateral aclexplode(column_record.attacl) column_acl
        join pg_roles acl_role on acl_role.oid = column_acl.grantee
        where namespace_record.nspname = 'public'
          and relation_record.relname in (
            'orbit_transfer_jobs', 'orbit_transfer_items', 'orbit_audit_events'
          )
          and acl_role.rolname = ${mediaRole}
      `;
      const expectedOrbitColumnPrivileges = [
        ...[
          "id",
          "workspace_id",
          "source_organization_id",
          "target_organization_id",
          "requested_by_account_id",
          "status",
          "claim_token",
          "lease_expires_at",
        ].map((column) => `orbit_transfer_jobs.${column}.SELECT`),
        ...[
          "status",
          "failure_code",
          "claim_token",
          "lease_expires_at",
          "completed_at",
          "updated_at",
        ].map((column) => `orbit_transfer_jobs.${column}.UPDATE`),
        ...["job_id", "kind", "target_id"].map(
          (column) => `orbit_transfer_items.${column}.SELECT`,
        ),
        ...[
          "workspace_id",
          "actor_account_id",
          "action",
          "resource_type",
          "resource_id",
          "source_organization_id",
          "target_organization_id",
          "outcome",
          "metadata",
        ].map((column) => `orbit_audit_events.${column}.INSERT`),
      ].sort();
      assert.deepEqual(
        orbitColumnPrivileges
          .map(
            (entry) =>
              `${entry.tableName}.${entry.columnName}.${entry.privilegeType}`,
          )
          .sort(),
        expectedOrbitColumnPrivileges,
      );
      assert.ok(orbitColumnPrivileges.every((entry) => !entry.isGrantable));
      const [orbitTablePrivileges] = await owner<
        Array<{ privilegeCount: number }>
      >`
        select count(*)::integer as "privilegeCount"
        from pg_class relation_record
        join pg_namespace namespace_record on namespace_record.oid = relation_record.relnamespace
        cross join lateral aclexplode(relation_record.relacl) relation_acl
        join pg_roles acl_role on acl_role.oid = relation_acl.grantee
        where namespace_record.nspname = 'public'
          and relation_record.relname in (
            'orbit_transfer_jobs', 'orbit_transfer_items', 'orbit_audit_events'
          )
          and acl_role.rolname = ${mediaRole}
      `;
      assert.equal(orbitTablePrivileges.privilegeCount, 0);
      const [reconciledIdentity] = await owner.unsafe(roleIdentityQuery());
      assert.equal(reconciledIdentity.legacy_role_count, 0);
      assert.equal(reconciledIdentity.stored_owner, ownerRole);
      await admin.unsafe(
        `create role "${staleRole}" login nosuperuser nocreatedb nocreaterole noreplication nobypassrls noinherit`,
      );
      await admin.unsafe(
        `grant connect on database "${databaseName}" to "${staleRole}"`,
      );
      const [staleIdentity] = await owner.unsafe(roleIdentityQuery());
      assert.equal(staleIdentity.legacy_role_count, 1);

      const organizationId = "10000000-0000-4000-8000-000000000001";
      const courseId = "11000000-0000-4000-8000-000000000001";
      const moduleId = "12000000-0000-4000-8000-000000000001";
      const assetId = "20000000-0000-4000-8000-000000000001";
      const firstJobId = "30000000-0000-4000-8000-000000000001";
      const secondJobId = "30000000-0000-4000-8000-000000000002";
      const sourceOrganizationId = "10000000-0000-4000-8000-000000000002";
      const workspaceId = "40000000-0000-4000-8000-000000000001";
      const transferJobId = "50000000-0000-4000-8000-000000000001";
      const transferClaimToken = "50000000-0000-4000-8000-000000000002";
      const transferAssetId = "20000000-0000-4000-8000-000000000002";
      await owner.unsafe(`
        insert into organizations (id, name, slug)
        values ('${organizationId}', 'Security test', 'security-test');
        insert into organization_contracts (
          organization_id, plan_code, storage_limit_bytes
        ) values ('${organizationId}', 'security_test', 1048576);
        insert into courses (
          id, organization_id, title, slug, short_description, description
        ) values (
          '${courseId}', '${organizationId}', 'Runtime security course',
          'runtime-security-course', 'Runtime security course',
          'Runtime security course'
        );
        insert into media_assets (
          id, organization_id, purpose, kind, status, storage_driver,
          storage_key, staging_storage_key, original_file_name, safe_file_name,
          declared_mime_type, declared_size_bytes, quota_bytes, upload_expires_at
        ) values (
          '${assetId}', '${organizationId}', 'course_content', 'image', 'pending',
          'filesystem',
          'tenants/${organizationId}/assets/${assetId}/original.png',
          'incoming/tenants/${organizationId}/assets/${assetId}/original.png',
          'original.png', 'original.png', 'image/png', 100, 100, now() + interval '1 hour'
        );
        insert into media_upload_sessions (
          asset_id, organization_id, provider_upload_id, part_size_bytes,
          expected_part_count, expires_at, upload_deadline_at
        ) values (
          '${assetId}', '${organizationId}', 'security-upload-id', 5242880,
          1, now() + interval '1 hour', now() + interval '1 hour'
        );
        insert into media_processing_jobs (
          id, organization_id, source_asset_id, type, request_key,
          source_content_sha256, provider
        ) values
          ('${firstJobId}', '${organizationId}', '${assetId}', 'thumbnail',
           'security-test-first', repeat('a', 64), 'security-test'),
          ('${secondJobId}', '${organizationId}', '${assetId}', 'thumbnail',
           'security-test-second', repeat('b', 64), 'security-test');
        insert into organizations (id, name, slug)
        values (
          '${sourceOrganizationId}', 'Orbit security source',
          'orbit-security-source'
        );
        insert into orbit_workspaces (id, name, slug, instance_slot_limit)
        values (
          '${workspaceId}', 'Orbit security workspace',
          'orbit-security-workspace', 2
        );
        insert into orbit_instances (
          workspace_id, organization_id, status, seat_limit, course_limit,
          entitlements
        ) values
          (
            '${workspaceId}', '${sourceOrganizationId}', 'active', 100, 100,
            array['content_transfer']::text[]
          ),
          (
            '${workspaceId}', '${organizationId}', 'active', 100, 100,
            array['content_transfer']::text[]
          );
        insert into media_assets (
          id, organization_id, purpose, kind, status, storage_driver,
          storage_key, staging_storage_key, original_file_name, safe_file_name,
          declared_mime_type, declared_size_bytes, quota_bytes,
          upload_expires_at
        ) values (
          '${transferAssetId}', '${organizationId}', 'course_content', 'video',
          'pending', 'filesystem',
          'tenants/${organizationId}/assets/${transferAssetId}/video.mp4',
          'incoming/tenants/${organizationId}/assets/${transferAssetId}/video.mp4',
          'video.mp4', 'video.mp4', 'video/mp4', 100, 100,
          now() - interval '1 hour'
        );
        insert into orbit_transfer_jobs (
          id, workspace_id, source_organization_id, target_organization_id,
          source_course_ids, target_course_ids, idempotency_key, request_hash,
          status, preflight, started_at, claim_token, lease_expires_at,
          created_at, updated_at
        ) values (
          '${transferJobId}', '${workspaceId}', '${sourceOrganizationId}',
          '${organizationId}', array['${courseId}'::uuid], array[]::uuid[],
          'security-reconciliation', repeat('e', 64), 'processing',
          '{"sourceCourseCount":1,"targetCourseCount":0,"targetCourseLimit":100,"mediaAssetCount":1,"mediaBytes":100,"warnings":[]}'::jsonb,
          now() - interval '1 hour', '${transferClaimToken}',
          now() - interval '5 minutes', now() - interval '1 hour', now()
        );
        insert into orbit_transfer_items (
          job_id, kind, source_id, target_id, checksum
        ) values (
          '${transferJobId}', 'media_asset',
          '60000000-0000-4000-8000-000000000001', '${transferAssetId}',
          repeat('f', 64)
        );
      `);

      app = postgres(roleUrl(appRole), { max: 1 });
      await app.begin(async (transaction) => {
        await transaction.unsafe(
          `select public.q_academy_lock_course_link_graph('${organizationId}'::uuid)`,
        );
        await transaction.unsafe(`
          insert into modules (
            id, organization_id, title, kind, description, folder,
            is_reusable, estimated_minutes
          ) values (
            '${moduleId}', '${organizationId}', 'Runtime security module',
            'learning', 'Runtime role trigger verification', 'Security',
            false, 30
          )
        `);
        await transaction.unsafe(`
          insert into course_modules (
            organization_id, course_id, module_id, sort_order, indent_level,
            drip_days, is_required
          ) values (
            '${organizationId}', '${courseId}', '${moduleId}', 0, 0, 0, true
          )
        `);
      });
      const [moduleFixture] = await owner<
        Array<{ modules: number; assignments: number }>
      >`
        select
          (select count(*)::integer from modules where id = ${moduleId}) as modules,
          (
            select count(*)::integer from course_modules
            where course_id = ${courseId} and module_id = ${moduleId}
          ) as assignments
      `;
      assert.deepEqual(moduleFixture, {
        modules: 1,
        assignments: 1,
      });

      media = postgres(roleUrl(mediaRole), { max: 1 });
      const selectedTransferJobs = await media.unsafe(`
        select id, workspace_id, source_organization_id,
               target_organization_id, requested_by_account_id, status,
               claim_token, lease_expires_at
        from orbit_transfer_jobs
        where id = '${transferJobId}'
      `);
      assert.equal(selectedTransferJobs.length, 1);
      const selectedTransferItems = await media.unsafe(`
        select job_id, kind, target_id
        from orbit_transfer_items
        where job_id = '${transferJobId}' and kind = 'media_asset'
      `);
      assert.equal(selectedTransferItems.length, 1);
      await media.unsafe(`
        update orbit_transfer_jobs
        set status = 'failed', failure_code = 'permission_probe',
            claim_token = null, lease_expires_at = null,
            completed_at = now(), updated_at = now()
        where false
      `);
      await assert.rejects(
        media.unsafe(
          `select source_course_ids from orbit_transfer_jobs where id = '${transferJobId}'`,
        ),
        (error) => databaseErrorCode(error) === "42501",
      );
      await assert.rejects(
        media.unsafe(
          `select source_id from orbit_transfer_items where job_id = '${transferJobId}'`,
        ),
        (error) => databaseErrorCode(error) === "42501",
      );
      await assert.rejects(
        media.unsafe(
          `update orbit_transfer_jobs set started_at = now() where id = '${transferJobId}'`,
        ),
        (error) => databaseErrorCode(error) === "42501",
      );
      await assert.rejects(
        media.unsafe(
          `select action from orbit_audit_events where workspace_id = '${workspaceId}'`,
        ),
        (error) => databaseErrorCode(error) === "42501",
      );
      await assert.rejects(
        media.unsafe(
          `insert into orbit_audit_events (
             id, workspace_id, action, resource_type, resource_id, outcome,
             metadata
           ) values (
             '70000000-0000-4000-8000-000000000001', '${workspaceId}',
             'forbidden', 'transfer_job', '${transferJobId}', 'failed',
             '{}'::jsonb
           )`,
        ),
        (error) => databaseErrorCode(error) === "42501",
      );

      const previousDatabaseUrl = process.env.DATABASE_URL;
      process.env.DATABASE_URL = roleUrl(mediaRole);
      try {
        const [{ reconcileStaleOrbitTransfers }, databaseModule] =
          await Promise.all([
            import("../src/lib/orbit/transfer-reconciliation"),
            import("../src/db/index"),
          ]);
        mediaReconciliationClient = databaseModule.postgresClient;
        const [runtimeIdentity] = await databaseModule.postgresClient.unsafe(
          "select current_user",
        );
        assert.equal(runtimeIdentity.current_user, mediaRole);
        const reconciliationTime = new Date(Date.now() + 60_000);
        assert.equal(
          await reconcileStaleOrbitTransfers(10, reconciliationTime),
          1,
        );
        const [reconciledTransfer] = await owner<
          Array<{
            status: string;
            failureCode: string | null;
            claimToken: string | null;
            leaseExpiresAt: string | null;
            completedAt: string | null;
            auditEvents: number;
          }>
        >`
          select job.status, job.failure_code as "failureCode",
                 job.claim_token as "claimToken",
                 job.lease_expires_at as "leaseExpiresAt",
                 job.completed_at as "completedAt",
                 (
                   select count(*)::integer
                   from orbit_audit_events audit_event
                   where audit_event.workspace_id = ${workspaceId}
                     and audit_event.resource_id = ${transferJobId}
                     and audit_event.action = 'transfer.failed'
                 ) as "auditEvents"
          from orbit_transfer_jobs job
          where job.id = ${transferJobId}
        `;
        assert.deepEqual(
          { ...reconciledTransfer, completedAt: undefined },
          {
            status: "failed",
            failureCode: "transfer_reservation_expired",
            claimToken: null,
            leaseExpiresAt: null,
            completedAt: undefined,
            auditEvents: 1,
          },
        );
        assert.equal(
          new Date(reconciledTransfer.completedAt!).toISOString(),
          reconciliationTime.toISOString(),
        );
      } finally {
        if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
        else process.env.DATABASE_URL = previousDatabaseUrl;
      }
      await assert.rejects(
        media.unsafe("select storage_limit_bytes from organization_contracts"),
        (error) => databaseErrorCode(error) === "42501",
      );
      await assert.rejects(
        media.unsafe(
          "select media_asset_id from community_post_attachments limit 1",
        ),
        (error) => databaseErrorCode(error) === "42501",
      );
      await assert.rejects(
        media.unsafe(
          "select media_asset_id from community_comment_attachments limit 1",
        ),
        (error) => databaseErrorCode(error) === "42501",
      );
      await media.unsafe(`
        update media_assets
        set status = status
        where id = '${assetId}'
      `);
      const multipartSessions = await media.unsafe(`
        select provider_upload_id
        from media_upload_sessions
        where asset_id = '${assetId}'
      `);
      assert.equal(
        multipartSessions[0]?.provider_upload_id,
        "security-upload-id",
      );
      await media.unsafe(`
        update media_upload_sessions
        set state = 'aborting', updated_at = now()
        where asset_id = '${assetId}'
      `);
      await assert.rejects(
        media.unsafe(`
          update media_upload_sessions
          set expires_at = expires_at + interval '1 hour'
          where asset_id = '${assetId}'
        `),
        (error) => databaseErrorCode(error) === "42501",
      );
      await assert.rejects(
        media.unsafe(`
          insert into media_upload_sessions (
            asset_id, organization_id, provider_upload_id, part_size_bytes,
            expected_part_count, expires_at, upload_deadline_at
          ) values (
            '${assetId}', '${organizationId}', 'forbidden', 5242880, 1,
            now() + interval '1 hour', now() + interval '1 hour'
          )
        `),
        (error) => databaseErrorCode(error) === "42501",
      );
      await media.unsafe(`
        delete from media_upload_sessions where asset_id = '${assetId}'
      `);
      await media.unsafe(`
        insert into media_asset_derivatives (
          organization_id, source_asset_id, processing_job_id, kind,
          storage_driver, storage_key, mime_type, size_bytes, content_sha256,
          width, height
        ) values (
          '${organizationId}', '${assetId}', '${firstJobId}', 'thumbnail',
          'filesystem', 'security/first.png', 'image/png', 200, repeat('c', 64),
          10, 10
        )
      `);
      await assert.rejects(
        media.unsafe(`
          insert into media_asset_derivatives (
            organization_id, source_asset_id, processing_job_id, kind,
            storage_driver, storage_key, mime_type, size_bytes, content_sha256,
            width, height
          ) values (
            '${organizationId}', '${assetId}', '${secondJobId}', 'thumbnail',
            'filesystem', 'security/second.png', 'image/png', 1048500,
            repeat('d', 64), 10, 10
          )
        `),
        (error) => databaseErrorCode(error) === "23514",
      );
    } finally {
      await mediaReconciliationClient
        ?.end({ timeout: 5 })
        .catch(() => undefined);
      await databaseAdmin?.end().catch(() => undefined);
      await media?.end().catch(() => undefined);
      await app?.end().catch(() => undefined);
      await owner?.end().catch(() => undefined);
      await admin.unsafe(
        `drop database if exists "${databaseName}" with (force)`,
      );
      for (const role of [staleRole, mediaRole, appRole, ownerRole]) {
        await admin.unsafe(`drop role if exists "${role}"`);
      }
      await admin.end();
    }
  },
);
