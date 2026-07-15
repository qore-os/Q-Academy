import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import postgres from "postgres";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";
const apiSecret =
  process.env.DEMO_API_KEY ?? "qak_demo_qacademy_2026_local_development";

type Fixture = {
  organizationId: string;
  reviewerId: string;
  memberId: string;
  courseId: string;
  moduleId: string;
  lessonId: string;
  blockId: string;
  webhookId: string;
};

async function createFixture(sql: postgres.Sql, suffix: string): Promise<Fixture> {
  const [identity] = await sql<
    Array<{ organization_id: string; reviewer_id: string }>
  >`
    select organization_id, id as reviewer_id
    from users
    where email = 'admin@q-academy.de'
    limit 1
  `;
  if (!identity) throw new Error("Submission test owner was not found.");

  return sql.begin(async (tx) => {
    const [member] = await tx<Array<{ id: string }>>`
      insert into users (
        organization_id, email, password_hash, first_name, last_name, role, status
      ) values (
        ${identity.organization_id},
        ${`submission-atomicity-${suffix}@example.test`},
        'unused-test-hash', 'Atomicity', ${`Member ${suffix}`}, 'member', 'active'
      )
      returning id
    `;
    const [course] = await tx<Array<{ id: string }>>`
      insert into courses (
        organization_id, title, slug, short_description, description, status,
        certificate_enabled, created_by_id
      ) values (
        ${identity.organization_id}, ${`Submission Atomicity ${suffix}`},
        ${`submission-atomicity-${suffix}`}, 'Transactional submission fixture',
        'Crash safety, immutable reviews and row-lock concurrency.',
        'draft', true, ${identity.reviewer_id}
      )
      returning id
    `;
    const [learningModule] = await tx<Array<{ id: string }>>`
      insert into modules (
        organization_id, title, description, folder, is_reusable,
        estimated_minutes
      ) values (
        ${identity.organization_id}, ${`Atomicity module ${suffix}`},
        'Isolated required submission module.', 'E2E', false, 10
      )
      returning id
    `;
    await tx`
      insert into course_modules (
        organization_id, course_id, module_id, sort_order, is_required
      )
      values (
        ${identity.organization_id}, ${course.id}, ${learningModule.id}, 0, true
      )
    `;
    const [lesson] = await tx<Array<{ id: string }>>`
      insert into lessons (
        organization_id, module_id, title, slug, summary, type,
        duration_minutes, sort_order, status
      ) values (
        ${identity.organization_id}, ${learningModule.id},
        'Transactional assignment',
        ${`transactional-assignment-${suffix}`},
        'A required assignment with an immutable review decision.',
        'assignment', 10, 0, 'published'
      )
      returning id
    `;
    const [block] = await tx<Array<{ id: string }>>`
      insert into content_blocks (
        lesson_id, type, title, sort_order, required, data
      ) values (
        ${lesson.id}, 'submission', 'Required solution', 0, true,
        ${tx.json({ prompt: "Document the reviewed solution." })}
      )
      returning id
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
    const [webhook] = await tx<Array<{ id: string }>>`
      insert into webhooks (
        organization_id, name, url, signing_secret_encrypted, events, active
      ) values (
        ${identity.organization_id}, ${`Submission atomicity ${suffix}`},
        'https://hooks.invalid/submission-atomicity',
        'test-only-not-deliverable',
        ${["submission.created", "submission.reviewed"]}, true
      )
      returning id
    `;

    return {
      organizationId: identity.organization_id,
      reviewerId: identity.reviewer_id,
      memberId: member.id,
      courseId: course.id,
      moduleId: learningModule.id,
      lessonId: lesson.id,
      blockId: block.id,
      webhookId: webhook.id,
    };
  });
}

async function installAuditFailure(sql: postgres.Sql, requestId: string) {
  const suffix = randomUUID().replaceAll("-", "");
  const functionName = `qa_sub_audit_fn_${suffix}`;
  const triggerName = `qa_sub_audit_tr_${suffix}`;

  await sql.unsafe(`
    create function ${functionName}()
    returns trigger
    language plpgsql
    as $$
    begin
      raise exception 'submission command audit failure';
    end;
    $$
  `);
  await sql.unsafe(`
    create trigger ${triggerName}
    before insert on api_audit_logs
    for each row
    when (new.request_id = '${requestId}'::uuid)
    execute function ${functionName}()
  `);

  return async () => {
    await sql.unsafe(
      `drop trigger if exists ${triggerName} on api_audit_logs`,
    );
    await sql.unsafe(`drop function if exists ${functionName}()`);
  };
}

test("submission commands roll back, replay once and serialize review versus delete", async ({
  request,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "focused transaction test");
  test.setTimeout(120_000);

  const sql = postgres(databaseUrl, { max: 4, prepare: false });
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const keyPrefix = `submission-atomicity-${suffix}`;
  const requestIds: string[] = [];
  let fixture: Fixture | null = null;
  let removeAuditFailure: (() => Promise<void>) | null = null;

  try {
    fixture = await createFixture(sql, suffix);
    const authorization = { Authorization: `Bearer ${apiSecret}` };
    const publish = await request.post(
      `/api/v1/courses/${fixture.courseId}/publish`,
      {
        headers: {
          ...authorization,
          "Idempotency-Key": `${keyPrefix}-publish`,
        },
        data: { changelog: "Submission transaction integrity fixture" },
      },
    );
    requestIds.push(publish.headers()["x-request-id"]);
    expect(publish.status()).toBe(201);

    const emptyRequestId = randomUUID();
    requestIds.push(emptyRequestId);
    const empty = await request.post("/api/v1/submissions", {
      headers: {
        ...authorization,
        "Idempotency-Key": `${keyPrefix}-empty`,
        "X-Request-Id": emptyRequestId,
      },
      data: {
        userId: fixture.memberId,
        courseId: fixture.courseId,
        lessonId: fixture.lessonId,
        blockId: fixture.blockId,
        title: "Whitespace must not count",
        content: " \n\t ",
      },
    });
    expect(empty.status()).toBe(422);
    await expect(empty.json()).resolves.toMatchObject({
      code: "validation_error",
      detail:
        "Die Abgabe benoetigt aussagekraeftigen Text oder mindestens einen Dateianhang.",
    });

    const createRequestId = randomUUID();
    requestIds.push(createRequestId);
    const createKey = `${keyPrefix}-create`;
    const createHeaders = {
      ...authorization,
      "Idempotency-Key": createKey,
      "X-Request-Id": createRequestId,
    };
    const createData = {
      userId: fixture.memberId,
      courseId: fixture.courseId,
      lessonId: fixture.lessonId,
      blockId: fixture.blockId,
      title: `Atomic solution ${suffix}`,
      content: "The complete solution is ready for an immutable review.",
    };

    removeAuditFailure = await installAuditFailure(sql, createRequestId);
    const failedCreate = await request.post("/api/v1/submissions", {
      headers: createHeaders,
      data: createData,
    });
    expect(failedCreate.status()).toBe(500);

    const [rolledBackCreate] = await sql<
      Array<{
        submission_count: number;
        activity_count: number;
        delivery_count: number;
        idempotency_count: number;
      }>
    >`
      select
        (select count(*)::int from submissions
          where course_id = ${fixture.courseId}) as submission_count,
        (select count(*)::int from activity_events
          where type = 'submission.created'
            and user_id = ${fixture.memberId}) as activity_count,
        (select count(*)::int from webhook_deliveries
          where webhook_id = ${fixture.webhookId}
            and event = 'submission.created') as delivery_count,
        (select count(*)::int from api_idempotency_keys
          where key = ${createKey}) as idempotency_count
    `;
    expect(rolledBackCreate).toEqual({
      submission_count: 0,
      activity_count: 0,
      delivery_count: 0,
      idempotency_count: 0,
    });

    await removeAuditFailure();
    removeAuditFailure = null;
    const created = await request.post("/api/v1/submissions", {
      headers: createHeaders,
      data: createData,
    });
    expect(created.status()).toBe(201);
    const createdText = await created.text();
    const createdBody = JSON.parse(createdText) as { data: { id: string } };
    const replayedCreate = await request.post("/api/v1/submissions", {
      headers: createHeaders,
      data: createData,
    });
    expect(replayedCreate.status()).toBe(201);
    expect(replayedCreate.headers()["idempotent-replayed"]).toBe("true");
    expect(await replayedCreate.text()).toBe(createdText);

    const [committedCreate] = await sql<
      Array<{
        submission_count: number;
        activity_count: number;
        delivery_count: number;
        idempotency_count: number;
      }>
    >`
      select
        (select count(*)::int from submissions
          where id = ${createdBody.data.id}) as submission_count,
        (select count(*)::int from activity_events
          where entity_id = ${createdBody.data.id}
            and type = 'submission.created') as activity_count,
        (select count(*)::int from webhook_deliveries
          where webhook_id = ${fixture.webhookId}
            and event = 'submission.created'
            and payload -> 'data' ->> 'id' = ${createdBody.data.id}) as delivery_count,
        (select count(*)::int from api_idempotency_keys
          where key = ${createKey} and status = 'completed') as idempotency_count
    `;
    expect(committedCreate).toEqual({
      submission_count: 1,
      activity_count: 1,
      delivery_count: 1,
      idempotency_count: 1,
    });

    // A forged mutable parent status cannot replace an immutable approval.
    await sql`
      update submissions set status = 'approved'
      where id = ${createdBody.data.id}
    `;
    const forgedCompletionId = randomUUID();
    requestIds.push(forgedCompletionId);
    const forgedCompletion = await request.put(
      `/api/v1/members/${fixture.memberId}/progress/${fixture.lessonId}`,
      {
        headers: {
          ...authorization,
          "Idempotency-Key": `${keyPrefix}-forged-completion`,
          "X-Request-Id": forgedCompletionId,
        },
        data: { status: "completed", percent: 100 },
      },
    );
    expect(forgedCompletion.status()).toBe(409);
    await expect(forgedCompletion.json()).resolves.toMatchObject({
      errors: { reason: "required_submission_pending" },
    });
    await sql`
      update submissions set status = 'in_review'
      where id = ${createdBody.data.id}
    `;

    const reviewRequestId = randomUUID();
    requestIds.push(reviewRequestId);
    const reviewKey = `${keyPrefix}-review`;
    const reviewHeaders = {
      ...authorization,
      "Idempotency-Key": reviewKey,
      "X-Request-Id": reviewRequestId,
    };
    const reviewData = {
      reviewerId: fixture.reviewerId,
      decision: "approved",
      feedback: "The required solution is approved and immutable.",
      score: 96,
    };

    removeAuditFailure = await installAuditFailure(sql, reviewRequestId);
    const failedReview = await request.post(
      `/api/v1/submissions/${createdBody.data.id}/review`,
      { headers: reviewHeaders, data: reviewData },
    );
    expect(failedReview.status()).toBe(500);

    const [rolledBackReview] = await sql<
      Array<{
        status: string;
        review_count: number;
        notification_count: number;
        activity_count: number;
        delivery_count: number;
        idempotency_count: number;
      }>
    >`
      select
        s.status::text,
        (select count(*)::int from submission_reviews
          where submission_id = s.id) as review_count,
        (select count(*)::int from notifications
          where user_id = s.user_id and type = 'submission') as notification_count,
        (select count(*)::int from activity_events
          where entity_id = s.id and type = 'submission.reviewed') as activity_count,
        (select count(*)::int from webhook_deliveries
          where webhook_id = ${fixture.webhookId}
            and event = 'submission.reviewed'
            and payload -> 'data' ->> 'id' = s.id::text) as delivery_count,
        (select count(*)::int from api_idempotency_keys
          where key = ${reviewKey}) as idempotency_count
      from submissions s
      where s.id = ${createdBody.data.id}
    `;
    expect(rolledBackReview).toEqual({
      status: "in_review",
      review_count: 0,
      notification_count: 0,
      activity_count: 0,
      delivery_count: 0,
      idempotency_count: 0,
    });

    await removeAuditFailure();
    removeAuditFailure = null;
    const reviewed = await request.post(
      `/api/v1/submissions/${createdBody.data.id}/review`,
      { headers: reviewHeaders, data: reviewData },
    );
    expect(reviewed.status()).toBe(200);
    const reviewedText = await reviewed.text();
    const replayedReview = await request.post(
      `/api/v1/submissions/${createdBody.data.id}/review`,
      { headers: reviewHeaders, data: reviewData },
    );
    expect(replayedReview.status()).toBe(200);
    expect(replayedReview.headers()["idempotent-replayed"]).toBe("true");
    expect(await replayedReview.text()).toBe(reviewedText);

    const [committedReview] = await sql<
      Array<{
        status: string;
        review_count: number;
        notification_count: number;
        activity_count: number;
        delivery_count: number;
        idempotency_count: number;
      }>
    >`
      select
        s.status::text,
        (select count(*)::int from submission_reviews
          where submission_id = s.id) as review_count,
        (select count(*)::int from notifications
          where user_id = s.user_id and type = 'submission') as notification_count,
        (select count(*)::int from activity_events
          where entity_id = s.id and type = 'submission.reviewed') as activity_count,
        (select count(*)::int from webhook_deliveries
          where webhook_id = ${fixture.webhookId}
            and event = 'submission.reviewed'
            and payload -> 'data' ->> 'id' = s.id::text) as delivery_count,
        (select count(*)::int from api_idempotency_keys
          where key = ${reviewKey} and status = 'completed') as idempotency_count
      from submissions s
      where s.id = ${createdBody.data.id}
    `;
    expect(committedReview).toEqual({
      status: "approved",
      review_count: 1,
      notification_count: 1,
      activity_count: 1,
      delivery_count: 1,
      idempotency_count: 1,
    });

    // The review ledger remains authoritative even if the mutable read model drifts.
    await sql`
      update submissions set status = 'revision'
      where id = ${createdBody.data.id}
    `;
    const reviewedCompletionId = randomUUID();
    requestIds.push(reviewedCompletionId);
    const reviewedCompletion = await request.put(
      `/api/v1/members/${fixture.memberId}/progress/${fixture.lessonId}`,
      {
        headers: {
          ...authorization,
          "Idempotency-Key": `${keyPrefix}-reviewed-completion`,
          "X-Request-Id": reviewedCompletionId,
        },
        data: { status: "completed", percent: 100 },
      },
    );
    expect(reviewedCompletion.status()).toBe(200);
    await sql`
      update submissions set status = 'approved'
      where id = ${createdBody.data.id}
    `;

    const [raceSubmission] = await sql<Array<{ id: string }>>`
      insert into submissions (
        organization_id, user_id, course_id, lesson_id, title, type, content,
        status
      ) values (
        ${fixture.organizationId}, ${fixture.memberId}, ${fixture.courseId},
        ${fixture.lessonId}, ${`Review delete race ${suffix}`}, 'text',
        'Only one concurrent terminal operation may win.', 'in_review'
      )
      returning id
    `;
    const raceReviewId = randomUUID();
    const raceDeleteId = randomUUID();
    requestIds.push(raceReviewId, raceDeleteId);
    const [raceReview, raceDelete] = await Promise.all([
      request.post(`/api/v1/submissions/${raceSubmission.id}/review`, {
        headers: {
          ...authorization,
          "Idempotency-Key": `${keyPrefix}-race-review`,
          "X-Request-Id": raceReviewId,
        },
        data: {
          reviewerId: fixture.reviewerId,
          decision: "approved",
          feedback: "Concurrent review decision.",
          score: 88,
        },
      }),
      request.delete(`/api/v1/submissions/${raceSubmission.id}`, {
        headers: {
          ...authorization,
          "Idempotency-Key": `${keyPrefix}-race-delete`,
          "X-Request-Id": raceDeleteId,
        },
      }),
    ]);

    if (raceReview.status() === 200) {
      expect(raceDelete.status()).toBe(409);
    } else {
      expect(raceReview.status()).toBe(404);
      expect(raceDelete.status()).toBe(200);
    }

    const [raceState] = await sql<
      Array<{
        submission_count: number;
        review_count: number;
        reviewed_activity_count: number;
        deleted_activity_count: number;
      }>
    >`
      select
        (select count(*)::int from submissions
          where id = ${raceSubmission.id}) as submission_count,
        (select count(*)::int from submission_reviews
          where submission_id = ${raceSubmission.id}) as review_count,
        (select count(*)::int from activity_events
          where entity_id = ${raceSubmission.id}
            and type = 'submission.reviewed') as reviewed_activity_count,
        (select count(*)::int from activity_events
          where entity_id = ${raceSubmission.id}
            and type = 'submission.deleted') as deleted_activity_count
    `;
    expect(raceState).toEqual(
      raceReview.status() === 200
        ? {
            submission_count: 1,
            review_count: 1,
            reviewed_activity_count: 1,
            deleted_activity_count: 0,
          }
        : {
            submission_count: 0,
            review_count: 0,
            reviewed_activity_count: 0,
            deleted_activity_count: 1,
          },
    );
  } finally {
    if (removeAuditFailure) await removeAuditFailure();
    if (fixture) {
      for (const requestId of requestIds.filter(Boolean)) {
        await sql`delete from api_audit_logs where request_id = ${requestId}`;
      }
      await sql`
        delete from api_idempotency_keys where key like ${`${keyPrefix}%`}
      `;
      await sql`
        delete from activity_events
        where user_id = ${fixture.memberId}
           or entity_id in (${fixture.courseId}, ${fixture.lessonId})
           or entity_id in (
             select id from submissions where course_id = ${fixture.courseId}
           )
      `;
      await sql`delete from webhooks where id = ${fixture.webhookId}`;
      await sql`delete from courses where id = ${fixture.courseId}`;
      await sql`delete from modules where id = ${fixture.moduleId}`;
      await sql`delete from users where id = ${fixture.memberId}`;
    }
    await sql.end();
  }
});
