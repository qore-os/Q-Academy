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
    path.join(projectRoot, "scripts", "ops", "database-permissions-entrypoint.sh"),
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
  "production media permissions execute hardened storage triggers without contract access",
  { timeout: 120_000 },
  async () => {
    const admin = postgres(adminUrl, { max: 1 });
    let owner: ReturnType<typeof postgres> | undefined;
    let media: ReturnType<typeof postgres> | undefined;
    try {
      await admin.unsafe(`drop database if exists "${databaseName}" with (force)`);
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

      const [catalog] = await owner<
        Array<{
          hardenedFunctions: number;
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
      const assetId = "20000000-0000-4000-8000-000000000001";
      const firstJobId = "30000000-0000-4000-8000-000000000001";
      const secondJobId = "30000000-0000-4000-8000-000000000002";
      await owner.unsafe(`
        insert into organizations (id, name, slug)
        values ('${organizationId}', 'Security test', 'security-test');
        insert into organization_contracts (
          organization_id, plan_code, storage_limit_bytes
        ) values ('${organizationId}', 'security_test', 1048576);
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
        insert into media_processing_jobs (
          id, organization_id, source_asset_id, type, request_key,
          source_content_sha256, provider
        ) values
          ('${firstJobId}', '${organizationId}', '${assetId}', 'thumbnail',
           'security-test-first', repeat('a', 64), 'security-test'),
          ('${secondJobId}', '${organizationId}', '${assetId}', 'thumbnail',
           'security-test-second', repeat('b', 64), 'security-test');
      `);

      media = postgres(roleUrl(mediaRole), { max: 1 });
      await assert.rejects(
        media.unsafe("select storage_limit_bytes from organization_contracts"),
        (error) => databaseErrorCode(error) === "42501",
      );
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
      await media?.end().catch(() => undefined);
      await owner?.end().catch(() => undefined);
      await admin.unsafe(`drop database if exists "${databaseName}" with (force)`);
      for (const role of [staleRole, mediaRole, appRole, ownerRole]) {
        await admin.unsafe(`drop role if exists "${role}"`);
      }
      await admin.end();
    }
  },
);
