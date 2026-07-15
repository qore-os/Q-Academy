import { expect, test } from "@playwright/test";
import postgres from "postgres";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";
const authorization = {
  Authorization: `Bearer ${process.env.DEMO_API_KEY ?? "qak_demo_qacademy_2026_local_development"}`,
};

type SubmissionGateFixture = {
  organizationId: string;
  reviewerId: string;
  memberId: string;
  courseId: string;
  moduleId: string;
  lessonId: string;
  blockId: string;
  idempotencyPrefix: string;
};

async function createFixture(suffix: string): Promise<SubmissionGateFixture> {
  const sql = postgres(databaseUrl, { max: 1, prepare: false });
  try {
    const [identity] = await sql<
      Array<{ organization_id: string; reviewer_id: string }>
    >`
      select organization_id, id as reviewer_id
      from users
      where email = 'admin@q-academy.de'
      limit 1
    `;
    if (!identity) throw new Error("Submission gate test owner was not found.");

    return await sql.begin(async (tx) => {
      const [member] = await tx<Array<{ id: string }>>`
        insert into users (
          organization_id, email, password_hash, first_name, last_name, role, status
        ) values (
          ${identity.organization_id}, ${`progress-submission-${suffix}@example.test`},
          'unused-test-hash', 'Submission', ${`Gate ${suffix}`}, 'member', 'active'
        ) returning id
      `;
      const [course] = await tx<Array<{ id: string }>>`
        insert into courses (
          organization_id, title, slug, short_description, description, status,
          certificate_enabled, created_by_id
        ) values (
          ${identity.organization_id}, ${`Submission Gate ${suffix}`},
          ${`submission-gate-${suffix}`}, 'API submission gate fixture',
          'Required submissions protect progress and certificate issuance.',
          'draft', true, ${identity.reviewer_id}
        ) returning id
      `;
      const [learningModule] = await tx<Array<{ id: string }>>`
        insert into modules (
          organization_id, title, description, folder, is_reusable,
          estimated_minutes
        ) values (
          ${identity.organization_id}, ${`Submission Gate Modul ${suffix}`},
          'Isoliertes Pflichtmodul mit Review-Freigabe.', 'E2E', false, 10
        ) returning id
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
          ${identity.organization_id}, ${learningModule.id}, 'Pflichtabgabe',
          ${`pflichtabgabe-${suffix}`},
          'Die Lektion darf erst nach dem Review abgeschlossen werden.',
          'assignment', 10, 0, 'published'
        ) returning id
      `;
      const [block] = await tx<Array<{ id: string }>>`
        insert into content_blocks (
          lesson_id, type, title, sort_order, required, data
        ) values (
          ${lesson.id}, 'submission', 'Gepruefte Praxisloesung', 0, true,
          ${tx.json({ prompt: "Reiche eine gepruefte Praxisloesung ein." })}
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
        organizationId: identity.organization_id,
        reviewerId: identity.reviewer_id,
        memberId: member.id,
        courseId: course.id,
        moduleId: learningModule.id,
        lessonId: lesson.id,
        blockId: block.id,
        idempotencyPrefix: `progress-submission-${suffix}`,
      };
    });
  } finally {
    await sql.end();
  }
}

async function cleanupFixture(
  fixture: SubmissionGateFixture,
  requestIds: string[],
) {
  const sql = postgres(databaseUrl, { max: 1, prepare: false });
  try {
    await sql.begin(async (tx) => {
      for (const requestId of requestIds.filter(Boolean)) {
        await tx`delete from api_audit_logs where request_id = ${requestId}`;
      }
      await tx`
        delete from api_idempotency_keys
        where key like ${`${fixture.idempotencyPrefix}%`}
      `;
      await tx`
        delete from activity_events
        where user_id = ${fixture.memberId}
           or entity_id in (${fixture.courseId}, ${fixture.lessonId})
           or entity_id in (
             select id from submissions where course_id = ${fixture.courseId}
           )
      `;
      await tx`delete from courses where id = ${fixture.courseId}`;
      await tx`delete from modules where id = ${fixture.moduleId}`;
      await tx`delete from users where id = ${fixture.memberId}`;
    });
  } finally {
    await sql.end();
  }
}

test("REST completion waits for required submission approval before issuing progress and certificate", async ({
  request,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "targeted API gate flow");
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const fixture = await createFixture(suffix);
  const requestIds: string[] = [];
  const sql = postgres(databaseUrl, { max: 1, prepare: false });
  const progressPath =
    `/api/v1/members/${fixture.memberId}/progress/${fixture.lessonId}`;

  try {
    const published = await request.post(
      `/api/v1/courses/${fixture.courseId}/publish`,
      {
        headers: {
          ...authorization,
          "Idempotency-Key": `${fixture.idempotencyPrefix}-publish`,
        },
        data: { changelog: "Required submission progress gate fixture" },
      },
    );
    requestIds.push(published.headers()["x-request-id"]);
    expect(published.status()).toBe(201);

    // The published version remains authoritative while the builder has changes.
    await sql`
      update content_blocks
      set required = false
      where id = ${fixture.blockId}
    `;

    const created = await request.post("/api/v1/submissions", {
      headers: {
        ...authorization,
        "Idempotency-Key": `${fixture.idempotencyPrefix}-submit`,
      },
      data: {
        userId: fixture.memberId,
        courseId: fixture.courseId,
        lessonId: fixture.lessonId,
        blockId: fixture.blockId,
        title: `Praxisloesung ${suffix}`,
        content: "Die Loesung wartet auf die Freigabe durch einen Reviewer.",
      },
    });
    requestIds.push(created.headers()["x-request-id"]);
    expect(created.status()).toBe(201);
    const createdBody = (await created.json()) as { data: { id: string } };

    const completionBeforeReview = await request.put(progressPath, {
      headers: {
        ...authorization,
        "Idempotency-Key": `${fixture.idempotencyPrefix}-complete-before-review`,
      },
      data: { status: "completed", percent: 100 },
    });
    requestIds.push(completionBeforeReview.headers()["x-request-id"]);
    expect(completionBeforeReview.status()).toBe(409);
    expect(completionBeforeReview.headers()["content-type"]).toContain(
      "application/problem+json",
    );
    await expect(completionBeforeReview.json()).resolves.toMatchObject({
      status: 409,
      code: "conflict",
      errors: {
        reason: "required_submission_pending",
        courseId: fixture.courseId,
        lessonId: fixture.lessonId,
      },
    });

    const [blockedState] = await sql<
      Array<{
        status: string;
        progress: number;
        completed_at: Date | null;
        lesson_progress_count: number;
        certificate_count: number;
        submission_status: string;
      }>
    >`
      select
        e.status::text,
        e.progress,
        e.completed_at,
        (select count(*)::int from lesson_progress lp
          where lp.user_id = ${fixture.memberId}
            and lp.lesson_id = ${fixture.lessonId}) as lesson_progress_count,
        (select count(*)::int from course_certificates cc
          where cc.organization_id = ${fixture.organizationId}
            and cc.user_id = ${fixture.memberId}
            and cc.course_id = ${fixture.courseId}) as certificate_count,
        (select s.status::text from submissions s
          where s.id = ${createdBody.data.id}) as submission_status
      from enrollments e
      where e.user_id = ${fixture.memberId}
        and e.course_id = ${fixture.courseId}
    `;
    expect(blockedState).toEqual({
      status: "not_started",
      progress: 0,
      completed_at: null,
      lesson_progress_count: 0,
      certificate_count: 0,
      submission_status: "in_review",
    });

    const reviewed = await request.post(
      `/api/v1/submissions/${createdBody.data.id}/review`,
      {
        headers: {
          ...authorization,
          "Idempotency-Key": `${fixture.idempotencyPrefix}-approve`,
        },
        data: {
          reviewerId: fixture.reviewerId,
          decision: "approved",
          feedback: "Die Pflichtabgabe ist fachlich freigegeben.",
          score: 100,
        },
      },
    );
    requestIds.push(reviewed.headers()["x-request-id"]);
    expect(reviewed.status()).toBe(200);
    await expect(reviewed.json()).resolves.toMatchObject({
      data: {
        submission: { id: createdBody.data.id, status: "approved" },
        review: { decision: "approved", score: 100 },
      },
    });

    const completionAfterApproval = await request.put(progressPath, {
      headers: {
        ...authorization,
        "Idempotency-Key": `${fixture.idempotencyPrefix}-complete-after-approval`,
      },
      data: { status: "completed", percent: 100 },
    });
    requestIds.push(completionAfterApproval.headers()["x-request-id"]);
    expect(completionAfterApproval.status()).toBe(200);
    await expect(completionAfterApproval.json()).resolves.toMatchObject({
      data: {
        userId: fixture.memberId,
        lessonId: fixture.lessonId,
        status: "completed",
        percent: 100,
      },
    });

    const [completedState] = await sql<
      Array<{
        enrollment_status: string;
        enrollment_progress: number;
        enrollment_completed_at: Date | null;
        lesson_status: string;
        lesson_percent: number;
        active_certificate_count: number;
        certificate_matches_completion: boolean;
      }>
    >`
      select
        e.status::text as enrollment_status,
        e.progress as enrollment_progress,
        e.completed_at as enrollment_completed_at,
        lp.status::text as lesson_status,
        lp.percent as lesson_percent,
        (select count(*)::int from course_certificates cc
          where cc.organization_id = ${fixture.organizationId}
            and cc.user_id = ${fixture.memberId}
            and cc.course_id = ${fixture.courseId}
            and cc.revoked_at is null) as active_certificate_count,
        (select cc.completed_at = e.completed_at from course_certificates cc
          where cc.organization_id = ${fixture.organizationId}
            and cc.user_id = ${fixture.memberId}
            and cc.course_id = ${fixture.courseId}
            and cc.revoked_at is null) as certificate_matches_completion
      from enrollments e
      join lesson_progress lp
        on lp.user_id = e.user_id
       and lp.lesson_id = ${fixture.lessonId}
      where e.user_id = ${fixture.memberId}
        and e.course_id = ${fixture.courseId}
    `;
    expect(completedState).toMatchObject({
      enrollment_status: "completed",
      enrollment_progress: 100,
      lesson_status: "completed",
      lesson_percent: 100,
      active_certificate_count: 1,
      certificate_matches_completion: true,
    });
    expect(completedState.enrollment_completed_at).toBeTruthy();
  } finally {
    await sql.end();
    await cleanupFixture(fixture, requestIds);
  }
});
