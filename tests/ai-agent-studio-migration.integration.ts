import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const databaseName = "q_academy_agent_studio_schema_test";
const adminUrl =
  process.env.POSTGRES_ADMIN_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/postgres";
const databaseUrl = new URL(adminUrl);
databaseUrl.pathname = `/${databaseName}`;

function errorCode(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error
    ? String(error.code)
    : null;
}

async function expectDatabaseError(
  operation: () => Promise<unknown>,
  expectedCodes: readonly string[],
) {
  try {
    await operation();
  } catch (error) {
    assert.ok(
      expectedCodes.includes(errorCode(error) ?? ""),
      `Expected ${expectedCodes.join(" or ")}, received ${errorCode(error)}`,
    );
    return;
  }
  assert.fail(`Expected database error ${expectedCodes.join(" or ")}`);
}

test(
  "0050 enforces tenant-bound version publication and immutable history",
  { timeout: 120_000 },
  async () => {
    const admin = postgres(adminUrl, { max: 1, onnotice: () => undefined });
    const stagedMigrationFolder = mkdtempSync(
      path.join(tmpdir(), "q-agent-studio-migrations-"),
    );
    let sql: ReturnType<typeof postgres> | null = null;

    try {
      await admin.unsafe(`drop database if exists "${databaseName}" with (force)`);
      await admin.unsafe(
        `create database "${databaseName}" with template template0 encoding 'UTF8' lc_collate 'C' lc_ctype 'C'`,
      );
      sql = postgres(databaseUrl.toString(), {
        max: 4,
        onnotice: () => undefined,
      });
      const migrationFolder = fileURLToPath(
        new URL("../drizzle", import.meta.url),
      );
      const journal = JSON.parse(
        readFileSync(
          path.join(migrationFolder, "meta", "_journal.json"),
          "utf8",
        ),
      ) as { entries: Array<{ idx: number; tag: string }> };
      const preAgentStudioJournal = {
        ...journal,
        entries: journal.entries.filter((entry) => entry.idx < 50),
      };
      mkdirSync(path.join(stagedMigrationFolder, "meta"), {
        recursive: true,
      });
      writeFileSync(
        path.join(stagedMigrationFolder, "meta", "_journal.json"),
        JSON.stringify(preAgentStudioJournal),
      );
      for (const entry of preAgentStudioJournal.entries) {
        copyFileSync(
          path.join(migrationFolder, `${entry.tag}.sql`),
          path.join(stagedMigrationFolder, `${entry.tag}.sql`),
        );
      }
      await migrate(drizzle(sql), {
        migrationsFolder: stagedMigrationFolder,
      });

      const [legacyOrganization] = await sql<Array<{ id: string }>>`
        insert into organizations (name, slug)
        values ('Legacy Agent Studio tenant', 'legacy-agent-studio-tenant')
        returning id
      `;
      const [legacyOwner] = await sql<Array<{ id: string }>>`
        insert into users (
          organization_id, email, password_hash, first_name, last_name, role
        ) values (
          ${legacyOrganization.id}, 'legacy-agent-owner@example.test',
          'not-a-secret', 'Legacy', 'Owner', 'owner'
        ) returning id
      `;
      const [legacyAgent] = await sql<Array<{ id: string }>>`
        insert into ai_agents (
          organization_id, name, description, system_prompt, color, icon
        ) values (
          ${legacyOrganization.id}, 'Legacy Coach', 'Unversioned coach',
          'You are the original learning coach.', '#123ABC', 'bot'
        ) returning id
      `;
      const [legacyConversation] = await sql<Array<{ id: string }>>`
        insert into ai_conversations (
          organization_id, agent_id, user_id, title
        ) values (
          ${legacyOrganization.id}, ${legacyAgent.id}, ${legacyOwner.id},
          'Legacy conversation'
        ) returning id
      `;

      await migrate(drizzle(sql), { migrationsFolder: migrationFolder });

      const legacyVersions = await sql<
        Array<{
          id: string;
          version: number;
          state: string;
          draftRevision: number;
          name: string;
          systemPrompt: string;
          color: string;
          icon: string;
        }>
      >`
        select id, version, state, draft_revision as "draftRevision", name,
               system_prompt as "systemPrompt", color, icon
        from ai_agent_versions
        where agent_id = ${legacyAgent.id}
        order by version
      `;
      assert.deepEqual(
        [...legacyVersions].map((version) => ({
          version: version.version,
          state: version.state,
          draftRevision: version.draftRevision,
          name: version.name,
          systemPrompt: version.systemPrompt,
          color: version.color,
          icon: version.icon,
        })),
        [
          {
            version: 1,
            state: "published",
            draftRevision: 1,
            name: "Legacy Coach",
            systemPrompt: "You are the original learning coach.",
            color: "#123ABC",
            icon: "bot",
          },
          {
            version: 2,
            state: "draft",
            draftRevision: 1,
            name: "Legacy Coach",
            systemPrompt: "You are the original learning coach.",
            color: "#123ABC",
            icon: "bot",
          },
        ],
      );
      const [legacyBindings] = await sql<
        Array<{
          draftVersionId: string;
          publishedVersionId: string;
          conversationVersionId: string;
        }>
      >`
        select agent.draft_version_id as "draftVersionId",
               agent.published_version_id as "publishedVersionId",
               conversation.agent_version_id as "conversationVersionId"
        from ai_agents as agent
        join ai_conversations as conversation
          on conversation.id = ${legacyConversation.id}
        where agent.id = ${legacyAgent.id}
      `;
      assert.equal(legacyBindings.publishedVersionId, legacyVersions[0].id);
      assert.equal(legacyBindings.draftVersionId, legacyVersions[1].id);
      assert.equal(
        legacyBindings.conversationVersionId,
        legacyVersions[0].id,
      );

      const organizations = await sql<Array<{ id: string }>>`
        insert into organizations (name, slug) values
          ('Agent Studio tenant', 'agent-studio-tenant'),
          ('Foreign Agent Studio tenant', 'foreign-agent-studio-tenant')
        returning id
      `;
      const organizationId = organizations[0].id;
      const foreignOrganizationId = organizations[1].id;
      const users = await sql<Array<{ id: string; organizationId: string }>>`
        insert into users (
          organization_id, email, password_hash, first_name, last_name, role
        ) values
          (
            ${organizationId}, 'agent-owner@example.test', 'not-a-secret',
            'Agent', 'Owner', 'owner'
          ),
          (
            ${foreignOrganizationId}, 'foreign-agent-owner@example.test',
            'not-a-secret', 'Foreign', 'Owner', 'owner'
          )
        returning id, organization_id as "organizationId"
      `;
      const ownerId = users.find(
        (user) => user.organizationId === organizationId,
      )!.id;
      const foreignOwnerId = users.find(
        (user) => user.organizationId === foreignOrganizationId,
      )!.id;

      const agentId = randomUUID();
      const firstDraftId = randomUUID();
      await sql.begin(async (tx) => {
        await tx`
          insert into ai_agents (
            id, organization_id, name, description, system_prompt,
            draft_version_id
          ) values (
            ${agentId}, ${organizationId}, 'Studio Coach', 'Versioned coach',
            'You are a careful learning coach.', ${firstDraftId}
          )
        `;
        await tx`
          insert into ai_agent_versions (
            id, organization_id, agent_id, version, state, type, name,
            description, system_prompt, knowledge_mode, access_mode,
            created_by_id
          ) values (
            ${firstDraftId}, ${organizationId}, ${agentId}, 1, 'draft',
            'learning_coach', 'Studio Coach', 'Versioned coach',
            'You are a careful learning coach.', 'all_accessible_courses',
            'open', ${ownerId}
          )
        `;
      });

      await expectDatabaseError(
        () => sql!`
          update ai_agent_versions
          set name = 'Skipped revision', draft_revision = draft_revision + 2
          where id = ${firstDraftId}
        `,
        ["23514"],
      );
      await sql`
        update ai_agent_versions
        set name = 'Studio Coach v1', draft_revision = draft_revision + 1,
            updated_at = statement_timestamp()
        where id = ${firstDraftId}
      `;
      const [manualSource] = await sql<Array<{ id: string }>>`
        insert into ai_agent_version_sources (
          organization_id, agent_version_id, source_type, title, content
        ) values (
          ${organizationId}, ${firstDraftId}, 'manual_text',
          'Studio handbook', 'Only answer from reviewed learning material.'
        )
        returning id
      `;
      await sql`
        insert into ai_agent_version_access_grants (
          organization_id, agent_version_id, subject_type, subject_role
        ) values (
          ${organizationId}, ${firstDraftId}, 'role', 'member'
        )
      `;

      await expectDatabaseError(
        () => sql!`
          insert into ai_agent_version_access_grants (
            organization_id, agent_version_id, subject_type, subject_user_id
          ) values (
            ${organizationId}, ${firstDraftId}, 'user', ${foreignOwnerId}
          )
        `,
        ["23503"],
      );
      await expectDatabaseError(
        () => sql!`
          insert into ai_agent_version_sources (
            organization_id, agent_version_id, source_type, title, content
          ) values (
            ${organizationId}, ${firstDraftId}, 'course_version',
            'Invalid mixed source', 'Invalid mixed source'
          )
        `,
        ["23514"],
      );
      await expectDatabaseError(
        () => sql!`
          insert into ai_agent_version_sources (
            organization_id, agent_version_id, source_type
          ) values (
            ${organizationId}, ${firstDraftId}, 'manual_text'
          )
        `,
        ["23514"],
      );

      const secondDraftId = randomUUID();
      await sql.begin(async (tx) => {
        await tx`
          update ai_agent_versions
          set state = 'published', published_at = statement_timestamp(),
              updated_at = statement_timestamp()
          where id = ${firstDraftId} and draft_revision = 2
        `;
        await tx`
          insert into ai_agent_versions (
            id, organization_id, agent_id, version, state, type, name,
            description, system_prompt, knowledge_mode, access_mode,
            created_by_id
          )
          select
            ${secondDraftId}, organization_id, agent_id, 2, 'draft', type,
            name, description, system_prompt, knowledge_mode, access_mode,
            ${ownerId}
          from ai_agent_versions where id = ${firstDraftId}
        `;
        await tx`
          update ai_agents
          set draft_version_id = ${secondDraftId},
              published_version_id = ${firstDraftId}
          where id = ${agentId} and organization_id = ${organizationId}
        `;
      });

      const [conversation] = await sql<Array<{ id: string }>>`
        insert into ai_conversations (
          organization_id, agent_id, agent_version_id, user_id, title
        ) values (
          ${organizationId}, ${agentId}, ${firstDraftId}, ${ownerId},
          'Version-bound conversation'
        ) returning id
      `;
      assert.ok(conversation.id);

      for (const operation of [
        () => sql!`
          update ai_agent_versions set name = 'Mutated history'
          where id = ${firstDraftId}
        `,
        () => sql!`
          insert into ai_agent_version_sources (
            organization_id, agent_version_id, source_type, title, content
          ) values (
            ${organizationId}, ${firstDraftId}, 'manual_text',
            'Late source', 'This source was added after publication.'
          )
        `,
        () => sql!`
          delete from ai_agent_version_access_grants
          where agent_version_id = ${firstDraftId}
        `,
        () => sql!`
          update ai_agent_version_sources
          set agent_version_id = ${secondDraftId}
          where id = ${manualSource.id}
        `,
        () => sql!`truncate table ai_agent_version_sources`,
      ]) {
        await expectDatabaseError(operation, ["55000"]);
      }

      await expectDatabaseError(
        () =>
          sql!.begin(async (tx) => {
            await tx`
              update ai_agents
              set draft_version_id = ${firstDraftId}, published_version_id = null
              where id = ${agentId} and organization_id = ${organizationId}
            `;
          }),
        ["23514"],
      );
      await expectDatabaseError(
        () => sql!`
          insert into ai_conversations (
            organization_id, agent_id, agent_version_id, user_id
          ) values (
            ${foreignOrganizationId}, ${agentId}, ${firstDraftId},
            ${foreignOwnerId}
          )
        `,
        ["23503"],
      );

      const versions = await sql<
        Array<{ version: number; state: string; draftRevision: number }>
      >`
        select version, state, draft_revision as "draftRevision"
        from ai_agent_versions
        where agent_id = ${agentId}
        order by version
      `;
      assert.deepEqual([...versions], [
        { version: 1, state: "published", draftRevision: 2 },
        { version: 2, state: "draft", draftRevision: 1 },
      ]);

      await expectDatabaseError(
        () => sql!`delete from ai_agent_versions where id = ${firstDraftId}`,
        ["55000"],
      );
      await expectDatabaseError(
        () => sql!`delete from ai_agents where id = ${agentId}`,
        ["55000"],
      );
      await sql`delete from organizations where id = ${organizationId}`;
      const [removedTenant] = await sql<Array<{ value: number }>>`
        select count(*)::int as value
        from ai_agent_versions
        where organization_id = ${organizationId}
      `;
      assert.equal(removedTenant.value, 0);
    } finally {
      if (sql) await sql.end();
      rmSync(stagedMigrationFolder, { recursive: true, force: true });
      await admin.unsafe(
        `drop database if exists "${databaseName}" with (force)`,
      );
      await admin.end();
    }
  },
);
