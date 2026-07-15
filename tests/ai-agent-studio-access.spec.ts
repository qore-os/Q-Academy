import { createHash, randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";
import { SignJWT } from "jose";
import postgres from "postgres";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";
const developmentSessionSecret =
  "q-academy-local-development-secret-change-me";

test("a new publication revokes member history access without rebinding the old chat", async ({
  context,
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium",
    "The focused access transition runs once against Chromium.",
  );
  test.setTimeout(90_000);

  const sql = postgres(databaseUrl, { max: 2, prepare: false });
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const organizationId = randomUUID();
  const organizationSlug = `agent-access-${suffix}`;
  const memberId = randomUUID();
  const replacementMemberId = randomUUID();
  const agentId = randomUUID();
  const firstVersionId = randomUUID();
  const secondVersionId = randomUUID();
  const thirdDraftId = randomUUID();
  const conversationId = randomUUID();
  const sessionId = randomUUID();
  const historyMarker = `HISTORY_VISIBLE_${suffix}`;

  try {
    await sql`
      insert into organizations (id, name, slug)
      values (${organizationId}, ${`Agent access ${suffix}`}, ${organizationSlug})
    `;
    await sql`
      insert into users (
        id, organization_id, email, password_hash, first_name, last_name, role
      ) values
        (
          ${memberId}, ${organizationId}, ${`history-${suffix}@example.test`},
          'session-only', 'History', 'Member', 'member'
        ),
        (
          ${replacementMemberId}, ${organizationId},
          ${`replacement-${suffix}@example.test`}, 'session-only',
          'Replacement', 'Member', 'member'
        )
    `;
    await sql.begin(async (transaction) => {
      await transaction`
        insert into ai_agents (
          id, organization_id, name, description, system_prompt, active,
          draft_version_id, published_version_id
        ) values (
          ${agentId}, ${organizationId}, ${`History Agent ${suffix}`},
          'Version-bound history access test.',
          'Answer only from sources available to this published version.', true,
          ${firstVersionId}, null
        )
      `;
      await transaction`
        insert into ai_agent_versions (
          id, organization_id, agent_id, version, state, name, description,
          system_prompt, knowledge_mode, access_mode, created_by_id
        ) values (
          ${firstVersionId}, ${organizationId}, ${agentId}, 1, 'draft',
          ${`History Agent ${suffix}`}, 'First publication.',
          'Answer only from sources available to this published version.',
          'all_accessible_courses', 'restricted', ${memberId}
        )
      `;
      await transaction`
        insert into ai_agent_version_access_grants (
          organization_id, agent_version_id, subject_type, subject_user_id
        ) values (${organizationId}, ${firstVersionId}, 'user', ${memberId})
      `;
      await transaction`
        update ai_agent_versions
        set state = 'published', published_at = statement_timestamp(),
            updated_at = statement_timestamp()
        where id = ${firstVersionId}
      `;
      await transaction`
        insert into ai_agent_versions (
          id, organization_id, agent_id, version, state, name, description,
          system_prompt, knowledge_mode, access_mode, created_by_id
        ) values (
          ${secondVersionId}, ${organizationId}, ${agentId}, 2, 'draft',
          ${`History Agent v2 ${suffix}`}, 'Second publication.',
          'Answer only from sources available to this published version.',
          'all_accessible_courses', 'restricted', ${memberId}
        )
      `;
      await transaction`
        update ai_agents
        set draft_version_id = ${secondVersionId},
            published_version_id = ${firstVersionId}
        where id = ${agentId}
      `;
    });
    await sql`
      insert into ai_conversations (
        id, organization_id, agent_id, agent_version_id, user_id, title,
        message_count, last_message_at
      ) values (
        ${conversationId}, ${organizationId}, ${agentId}, ${firstVersionId},
        ${memberId}, 'Version one history', 2, now()
      )
    `;
    await sql`
      insert into ai_messages (
        organization_id, conversation_id, role, content, created_at
      ) values
        (${organizationId}, ${conversationId}, 'user', ${historyMarker}, now() - interval '1 second'),
        (${organizationId}, ${conversationId}, 'assistant', 'Stored answer.', now())
    `;

    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt.getTime() + 60 * 60 * 1000);
    const jti = randomUUID();
    const sessionSecret =
      process.env.SESSION_SECRET?.trim() || developmentSessionSecret;
    const token = await new SignJWT({
      organizationId,
      role: "member",
      email: `history-${suffix}@example.test`,
      authMethod: "password",
    })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(memberId)
      .setIssuer("q-academy")
      .setAudience("q-academy-web")
      .setJti(jti)
      .setIssuedAt(Math.floor(issuedAt.getTime() / 1000))
      .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
      .sign(new TextEncoder().encode(sessionSecret));
    await sql`
      insert into user_sessions (
        id, organization_id, user_id, jti_hash, auth_method,
        authenticated_at, expires_at, last_seen_at
      ) values (
        ${sessionId}, ${organizationId}, ${memberId},
        ${createHash("sha256").update(jti).digest("hex")}, 'password',
        ${issuedAt}, ${expiresAt}, ${issuedAt}
      )
    `;
    const tenantOrigin = `http://${organizationSlug}.localhost:3000`;
    await context.addCookies([
      {
        name: "q_academy_session",
        value: token,
        url: tenantOrigin,
        httpOnly: true,
        sameSite: "Lax",
        expires: Math.floor(expiresAt.getTime() / 1000),
      },
    ]);

    const initialHistory = await page.goto(
      `${tenantOrigin}/api/ai?agentId=${agentId}&conversationId=${conversationId}`,
    );
    expect(initialHistory?.status()).toBe(200);
    expect(await initialHistory?.text()).toContain(historyMarker);

    await sql.begin(async (transaction) => {
      await transaction`
        insert into ai_agent_version_access_grants (
          organization_id, agent_version_id, subject_type, subject_user_id
        ) values (
          ${organizationId}, ${secondVersionId}, 'user', ${replacementMemberId}
        )
      `;
      await transaction`
        update ai_agent_versions
        set state = 'published', published_at = statement_timestamp(),
            updated_at = statement_timestamp()
        where id = ${secondVersionId}
      `;
      await transaction`
        insert into ai_agent_versions (
          id, organization_id, agent_id, version, state, name, description,
          system_prompt, knowledge_mode, access_mode, created_by_id
        ) values (
          ${thirdDraftId}, ${organizationId}, ${agentId}, 3, 'draft',
          ${`History Agent v2 ${suffix}`}, 'Third draft.',
          'Answer only from sources available to this published version.',
          'all_accessible_courses', 'restricted', ${memberId}
        )
      `;
      await transaction`
        update ai_agents
        set draft_version_id = ${thirdDraftId},
            published_version_id = ${secondVersionId}
        where id = ${agentId}
      `;
    });

    const revokedHistory = await page.goto(
      `${tenantOrigin}/api/ai?agentId=${agentId}&conversationId=${conversationId}`,
    );
    expect(revokedHistory?.status()).toBe(404);
    await expect(revokedHistory?.json()).resolves.toMatchObject({
      code: "not_found",
    });

    const [storedConversation] = await sql<
      Array<{ agentVersionId: string; messageCount: number }>
    >`
      select agent_version_id as "agentVersionId",
             message_count as "messageCount"
      from ai_conversations where id = ${conversationId}
    `;
    expect(storedConversation).toEqual({
      agentVersionId: firstVersionId,
      messageCount: 2,
    });
  } finally {
    await context.clearCookies();
    await sql.begin(async (transaction) => {
      await transaction`set local session_replication_role = 'replica'`;
      await transaction`
        delete from ai_messages where organization_id = ${organizationId}
      `;
      await transaction`
        delete from ai_conversations where organization_id = ${organizationId}
      `;
      await transaction`
        delete from ai_agent_version_sources where organization_id = ${organizationId}
      `;
      await transaction`
        delete from ai_agent_version_access_grants where organization_id = ${organizationId}
      `;
      await transaction`
        delete from ai_agent_versions where organization_id = ${organizationId}
      `;
    });
    await sql`delete from organizations where id = ${organizationId}`;
    await sql.end();
  }
});
