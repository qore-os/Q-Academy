import { expect, test } from "@playwright/test";
import postgres from "postgres";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";
const authorization = {
  Authorization: `Bearer ${process.env.DEMO_API_KEY ?? "qak_demo_qacademy_2026_local_development"}`,
};

test("rich submissions are projected, tenant-isolated and content-immutable", async ({
  request,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "focused backend contract");
  test.setTimeout(90_000);

  const sql = postgres(databaseUrl, { prepare: false });
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const keyPrefix = `submission-rich-${suffix}`;
  const requestIds: string[] = [];
  let memberId = "";
  let courseId = "";
  let moduleId = "";
  let lessonId = "";
  let blockId = "";
  let submissionId = "";
  let foreignOrganizationId = "";

  const rememberRequestId = (response: { headers(): Record<string, string> }) => {
    const requestId = response.headers()["x-request-id"];
    if (requestId) requestIds.push(requestId);
  };

  try {
    const [identity] = await sql<
      Array<{ organization_id: string; owner_id: string }>
    >`
      select organization_id, id as owner_id
      from users
      where email = 'admin@q-academy.de'
      limit 1
    `;
    expect(identity).toBeTruthy();

    const createdFixture = await sql.begin(async (tx) => {
      const [member] = await tx<Array<{ id: string }>>`
        insert into users (
          organization_id, email, password_hash, first_name, last_name,
          role, status
        ) values (
          ${identity.organization_id},
          ${`rich-submission-${suffix}@example.test`},
          'unused-test-hash', 'Rich', 'Learner', 'member', 'active'
        ) returning id
      `;
      const [course] = await tx<Array<{ id: string }>>`
        insert into courses (
          organization_id, title, slug, short_description, description,
          status, certificate_enabled, created_by_id
        ) values (
          ${identity.organization_id}, ${`Rich Submission ${suffix}`},
          ${`rich-submission-${suffix}`}, 'Structured response fixture',
          'Strict rich text, deterministic offsets and tenant isolation.',
          'draft', false, ${identity.owner_id}
        ) returning id
      `;
      const [learningModule] = await tx<Array<{ id: string }>>`
        insert into modules (
          organization_id, title, description, folder, is_reusable,
          estimated_minutes
        ) values (
          ${identity.organization_id}, ${`Rich module ${suffix}`},
          'Structured assignment module.', 'E2E', false, 10
        ) returning id
      `;
      await tx`
        insert into course_modules (
          organization_id, course_id, module_id, sort_order, is_required
        ) values (
          ${identity.organization_id}, ${course.id}, ${learningModule.id}, 0, true
        )
      `;
      const [lesson] = await tx<Array<{ id: string }>>`
        insert into lessons (
          organization_id, module_id, title, slug, summary, type,
          duration_minutes, sort_order, status
        ) values (
          ${identity.organization_id}, ${learningModule.id},
          'Structured assignment', ${`structured-assignment-${suffix}`},
          'Submit a rich response.', 'assignment', 10, 0, 'published'
        ) returning id
      `;
      const [block] = await tx<Array<{ id: string }>>`
        insert into content_blocks (
          lesson_id, type, title, sort_order, required, data
        ) values (
          ${lesson.id}, 'submission', 'Structured solution', 0, true,
          ${tx.json({ prompt: "Provide a structured answer." })}
        ) returning id
      `;
      const [enrollment] = await tx<Array<{ id: string }>>`
        insert into enrollments (user_id, course_id, access_active)
        values (${member.id}, ${course.id}, true)
        returning id
      `;
      await tx`
        insert into course_access_grants (
          organization_id, user_id, course_id, source
        ) values (
          ${identity.organization_id}, ${member.id}, ${course.id},
          ${`direct:${enrollment.id}`}
        )
      `;
      return {
        memberId: member.id,
        courseId: course.id,
        moduleId: learningModule.id,
        lessonId: lesson.id,
        blockId: block.id,
      };
    });
    ({ memberId, courseId, moduleId, lessonId, blockId } = createdFixture);

    const publish = await request.post(`/api/v1/courses/${courseId}/publish`, {
      headers: {
        ...authorization,
        "Idempotency-Key": `${keyPrefix}-publish`,
      },
      data: { changelog: "Structured submission backend fixture" },
    });
    rememberRequestId(publish);
    expect(publish.status()).toBe(201);

    const richText = {
      version: 1,
      blocks: [
        {
          type: "heading",
          level: 2,
          children: [{ type: "text", text: "Evidence v1" }],
        },
        {
          type: "paragraph",
          children: [
            { type: "text", text: "First line\r\n" },
            { type: "linebreak" },
            {
              type: "link",
              href: "javascript:alert(1)",
              children: [{ type: "text", text: "safe label" }],
            },
          ],
        },
        {
          type: "list",
          style: "bullet",
          items: [
            { children: [{ type: "text", text: "Control" }] },
            { children: [{ type: "text", text: "Approval" }] },
          ],
        },
      ],
    };
    const expectedProjection =
      "Evidence v1\n\nFirst line\n\nsafe label\n\nControl\nApproval";
    const create = await request.post("/api/v1/submissions", {
      headers: {
        ...authorization,
        "Idempotency-Key": `${keyPrefix}-create`,
      },
      data: {
        userId: memberId,
        courseId,
        lessonId,
        blockId,
        title: `Structured solution ${suffix}`,
        richText,
      },
    });
    rememberRequestId(create);
    const createText = await create.text();
    expect(create.status(), createText).toBe(201);
    const createBody = JSON.parse(createText) as {
      data: {
        id: string;
        content: string;
        contentFormat: string;
        contentProjectionVersion: number;
        richText: typeof richText;
      };
    };
    submissionId = createBody.data.id;
    expect(createBody.data).toMatchObject({
      content: expectedProjection,
      contentFormat: "rich_text",
      contentProjectionVersion: 1,
    });
    expect(createBody.data.richText.blocks[1]?.children?.[2]).toEqual({
      type: "text",
      text: "safe label",
    });

    const [stored] = await sql<
      Array<{
        content: string;
        content_format: string;
        content_projection_version: number;
        rich_text: typeof richText;
      }>
    >`
      select content, content_format, content_projection_version, rich_text
      from submissions
      where id = ${submissionId}
    `;
    expect(stored).toMatchObject({
      content: expectedProjection,
      content_format: "rich_text",
      content_projection_version: 1,
    });

    await expect(
      sql`
        update submissions
        set content = 'mutated projection'
        where id = ${submissionId}
      `,
    ).rejects.toMatchObject({ code: "55000" });

    const detail = await request.get(`/api/v1/submissions/${submissionId}`, {
      headers: authorization,
    });
    rememberRequestId(detail);
    expect(detail.status()).toBe(200);
    await expect(detail.json()).resolves.toMatchObject({
      data: {
        submission: {
          id: submissionId,
          content: expectedProjection,
          contentFormat: "rich_text",
          contentProjectionVersion: 1,
        },
      },
    });

    const review = await request.post(
      `/api/v1/submissions/${submissionId}/review`,
      {
        headers: {
          ...authorization,
          "Idempotency-Key": `${keyPrefix}-review`,
        },
        data: {
          decision: "approved",
          feedback: "Structured evidence is complete.",
          score: 97,
          annotations: [
            {
              type: "text_range",
              body: "Emoji and heading are bound to projection v1.",
              startOffset: 0,
              endOffset: "Evidence v1".length,
            },
          ],
        },
      },
    );
    rememberRequestId(review);
    expect(review.status()).toBe(200);
    await expect(review.json()).resolves.toMatchObject({
      data: {
        submission: { id: submissionId, status: "approved" },
        review: {
          annotations: [
            {
              type: "text_range",
              startOffset: 0,
              endOffset: 11,
            },
          ],
        },
      },
    });

    const conflict = await request.post("/api/v1/submissions", {
      headers: {
        ...authorization,
        "Idempotency-Key": `${keyPrefix}-conflict`,
      },
      data: {
        userId: memberId,
        courseId,
        lessonId,
        blockId,
        title: "Conflicting representations",
        content: "This must never coexist with structured content.",
        richText,
      },
    });
    rememberRequestId(conflict);
    expect(conflict.status()).toBe(422);

    const [foreignOrganization] = await sql<Array<{ id: string }>>`
      insert into organizations (name, slug)
      values (${`Foreign Rich ${suffix}`}, ${`foreign-rich-${suffix}`})
      returning id
    `;
    foreignOrganizationId = foreignOrganization.id;
    const [foreignUser] = await sql<Array<{ id: string }>>`
      insert into users (
        organization_id, email, password_hash, first_name, last_name,
        role, status
      ) values (
        ${foreignOrganizationId}, ${`foreign-rich-${suffix}@example.test`},
        'unused-test-hash', 'Foreign', 'Learner', 'member', 'active'
      ) returning id
    `;
    const [foreignCourse] = await sql<Array<{ id: string }>>`
      insert into courses (
        organization_id, title, slug, short_description, description, status
      ) values (
        ${foreignOrganizationId}, 'Foreign structured course',
        ${`foreign-structured-${suffix}`}, 'Foreign tenant fixture',
        'Must not cross the tenant boundary.', 'draft'
      ) returning id
    `;
    const [foreignSubmission] = await sql<Array<{ id: string }>>`
      insert into submissions (
        organization_id, user_id, course_id, title, type, content,
        content_format, rich_text, content_projection_version, status
      ) values (
        ${foreignOrganizationId}, ${foreignUser.id}, ${foreignCourse.id},
        'Foreign structured submission', 'text', 'Foreign body',
        'rich_text',
        ${sql.json({
          version: 1,
          blocks: [
            {
              type: "paragraph",
              children: [{ type: "text", text: "Foreign body" }],
            },
          ],
        })},
        1, 'in_review'
      ) returning id
    `;
    const foreignRead = await request.get(
      `/api/v1/submissions/${foreignSubmission.id}`,
      { headers: authorization },
    );
    rememberRequestId(foreignRead);
    expect(foreignRead.status()).toBe(404);
  } finally {
    if (requestIds.length) {
      await sql`
        delete from api_audit_logs
        where request_id in ${sql(requestIds)}
      `;
    }
    await sql`
      delete from api_idempotency_keys
      where key like ${`${keyPrefix}%`}
    `;
    if (submissionId) {
      await sql`
        delete from activity_events
        where entity_id = ${submissionId}
      `;
    }
    if (memberId) {
      await sql`delete from notifications where user_id = ${memberId}`;
      await sql`delete from activity_events where user_id = ${memberId}`;
    }
    if (courseId) {
      await sql`
        delete from webhook_deliveries
        where payload -> 'data' ->> 'courseId' = ${courseId}
           or payload -> 'data' ->> 'id' = ${courseId}
      `;
      await sql`delete from courses where id = ${courseId}`;
    }
    if (moduleId) await sql`delete from modules where id = ${moduleId}`;
    if (memberId) await sql`delete from users where id = ${memberId}`;
    if (foreignOrganizationId) {
      await sql`delete from organizations where id = ${foreignOrganizationId}`;
    }
    await sql.end();
  }
});
