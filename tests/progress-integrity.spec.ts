import { expect, test, type APIRequestContext } from "@playwright/test";
import postgres from "postgres";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";
const demoKey =
  process.env.DEMO_API_KEY ?? "qak_demo_qacademy_2026_local_development";
const authorization = { Authorization: `Bearer ${demoKey}` };

type ProgressFixture = {
  organizationId: string;
  ownerId: string;
  memberId: string;
  courseId: string;
  protectedCourseId: string;
  moduleId: string;
  lessonId: string;
  idempotencyPrefix: string;
};

async function createFixture(
  request: APIRequestContext,
  suffix: string,
): Promise<ProgressFixture> {
  const sql = postgres(databaseUrl, { max: 1, prepare: false });
  const idempotencyPrefix = `progress-integrity-${suffix}`;
  try {
    const [identity] = await sql<
      Array<{ organization_id: string; owner_id: string }>
    >`
      select organization_id, id as owner_id
      from users
      where email = 'admin@q-academy.de'
      limit 1
    `;
    if (!identity) throw new Error("Progress integrity test owner was not found.");

    const fixture = await sql.begin(async (tx) => {
      const [member] = await tx<Array<{ id: string }>>`
        insert into users (
          organization_id, email, password_hash, first_name, last_name, role, status
        ) values (
          ${identity.organization_id}, ${`progress-integrity-${suffix}@example.test`},
          'unused-test-hash', 'Progress', ${`Integrity ${suffix}`}, 'member', 'active'
        ) returning id
      `;
      const [course] = await tx<Array<{ id: string }>>`
        insert into courses (
          organization_id, title, slug, short_description, description, status,
          certificate_enabled, created_by_id
        ) values (
          ${identity.organization_id}, ${`Progress Integrity ${suffix}`},
          ${`progress-integrity-${suffix}`}, 'API integrity fixture',
          'Server-derived progress and certificate locking.', 'draft', true,
          ${identity.owner_id}
        ) returning id
      `;
      const [protectedCourse] = await tx<Array<{ id: string }>>`
        insert into courses (
          organization_id, title, slug, short_description, description, status,
          certificate_enabled, created_by_id
        ) values (
          ${identity.organization_id}, ${`Protected Progress ${suffix}`},
          ${`protected-progress-${suffix}`}, 'Inactive shared-course fixture',
          'Shares published learning evidence with the active course.', 'draft',
          true, ${identity.owner_id}
        ) returning id
      `;
      const [learningModule] = await tx<Array<{ id: string }>>`
        insert into modules (
          organization_id, title, description, is_reusable, estimated_minutes
        ) values (
          ${identity.organization_id}, ${`Integrity Modul ${suffix}`},
          'Isoliertes Pflichtmodul.', false, 5
        ) returning id
      `;
      await tx`
        insert into course_modules (
          organization_id, course_id, module_id, sort_order, is_required
        )
        values
          (${identity.organization_id}, ${course.id}, ${learningModule.id}, 0, true),
          (${identity.organization_id}, ${protectedCourse.id}, ${learningModule.id}, 0, true)
      `;
      const [lesson] = await tx<Array<{ id: string }>>`
        insert into lessons (
          organization_id, module_id, title, slug, summary, type,
          duration_minutes, sort_order, status
        ) values (
          ${identity.organization_id}, ${learningModule.id},
          'Integritaetslektion', ${`integrity-${suffix}`},
          'Diese Pflichtlektion steuert den echten Kursfortschritt.',
          'lesson', 5, 0, 'published'
        ) returning id
      `;
      await tx`
        insert into content_blocks (lesson_id, type, title, sort_order, data)
        values (
          ${lesson.id}, 'heading', 'Integritaetslektion', 0,
          ${tx.json({ text: "Integritaetslektion" })}
        )
      `;
      const [enrollment] = await tx<Array<{ id: string }>>`
        insert into enrollments (user_id, course_id, access_active)
        values (${member.id}, ${course.id}, true)
        returning id
      `;
      await tx`
        insert into enrollments (
          user_id, course_id, status, access_active, progress, completed_at
        ) values (
          ${member.id}, ${protectedCourse.id}, 'completed', false, 100, now()
        )
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
        ownerId: identity.owner_id,
        memberId: member.id,
        courseId: course.id,
        protectedCourseId: protectedCourse.id,
        moduleId: learningModule.id,
        lessonId: lesson.id,
        idempotencyPrefix,
      };
    });

    const published = await request.post(
      `/api/v1/courses/${fixture.courseId}/publish`,
      {
        headers: {
          ...authorization,
          "Idempotency-Key": `${idempotencyPrefix}-publish`,
        },
        data: { changelog: "Progress integrity test publication" },
      },
    );
    expect(published.status()).toBe(201);
    const protectedPublished = await request.post(
      `/api/v1/courses/${fixture.protectedCourseId}/publish`,
      {
        headers: {
          ...authorization,
          "Idempotency-Key": `${idempotencyPrefix}-publish-protected`,
        },
        data: { changelog: "Shared certificate protection publication" },
      },
    );
    expect(protectedPublished.status()).toBe(201);
    return fixture;
  } finally {
    await sql.end();
  }
}

async function cleanupFixture(fixture: ProgressFixture) {
  const sql = postgres(databaseUrl, { max: 1, prepare: false });
  try {
    await sql.begin(async (tx) => {
      await tx`
        delete from api_audit_logs
        where path like ${`%${fixture.courseId}%`}
           or path like ${`%${fixture.protectedCourseId}%`}
           or path like ${`%${fixture.lessonId}%`}
           or resource_id in (
             ${fixture.courseId}, ${fixture.protectedCourseId}, ${fixture.lessonId}
           )
      `;
      await tx`
        delete from api_idempotency_keys
        where key like ${`${fixture.idempotencyPrefix}%`}
           or path like ${`%${fixture.courseId}%`}
           or path like ${`%${fixture.protectedCourseId}%`}
           or path like ${`%${fixture.lessonId}%`}
      `;
      await tx`
        delete from activity_events
        where user_id = ${fixture.memberId}
           or entity_id in (
             ${fixture.courseId}, ${fixture.protectedCourseId}, ${fixture.lessonId}
           )
      `;
      await tx`
        delete from courses
        where id in (${fixture.courseId}, ${fixture.protectedCourseId})
      `;
      await tx`delete from modules where id = ${fixture.moduleId}`;
      await tx`delete from users where id = ${fixture.memberId}`;
    });
  } finally {
    await sql.end();
  }
}

test("REST progress stays derived and active certificates block concurrent reductions", async ({
  request,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "targeted API transaction flow");
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const fixture = await createFixture(request, suffix);
  const sql = postgres(databaseUrl, { max: 1, prepare: false });
  const progressPath =
    `/api/v1/members/${fixture.memberId}/progress/${fixture.lessonId}`;
  const enrollmentPath =
    `/api/v1/members/${fixture.memberId}/enrollments/${fixture.courseId}`;
  try {
    const forgedCompletion = await request.patch(enrollmentPath, {
      headers: {
        ...authorization,
        "Idempotency-Key": `${fixture.idempotencyPrefix}-forged-completion`,
      },
      data: { status: "completed", progress: 100 },
    });
    expect(forgedCompletion.status()).toBe(409);
    expect(forgedCompletion.headers()["content-type"]).toContain(
      "application/problem+json",
    );
    await expect(forgedCompletion.json()).resolves.toMatchObject({
      status: 409,
      code: "conflict",
      errors: {
        reason: "derived_progress_mismatch",
        actual: { status: "not_started", progress: 0 },
      },
    });
    const [beforeCompletion] = await sql<
      Array<{ status: string; progress: number; completed_at: Date | null }>
    >`
      select status, progress, completed_at
      from enrollments
      where user_id = ${fixture.memberId} and course_id = ${fixture.courseId}
    `;
    expect(beforeCompletion).toEqual({
      status: "not_started",
      progress: 0,
      completed_at: null,
    });

    const completed = await request.put(progressPath, {
      headers: {
        ...authorization,
        "Idempotency-Key": `${fixture.idempotencyPrefix}-complete`,
      },
      data: { status: "completed", percent: 100 },
    });
    expect(completed.status()).toBe(200);

    const [issued] = await sql<
      Array<{
        certificate_id: string;
        certificate_number: string;
        status: string;
        progress: number;
        lesson_status: string;
      }>
    >`
      select
        cc.id as certificate_id,
        cc.certificate_number,
        e.status,
        e.progress,
        lp.status as lesson_status
      from enrollments e
      join lesson_progress lp
        on lp.user_id = e.user_id and lp.lesson_id = ${fixture.lessonId}
      join course_certificates cc
        on cc.organization_id = ${fixture.organizationId}
       and cc.user_id = e.user_id
       and cc.course_id = e.course_id
       and cc.revoked_at is null
      where e.user_id = ${fixture.memberId} and e.course_id = ${fixture.courseId}
    `;
    expect(issued).toMatchObject({
      status: "completed",
      progress: 100,
      lesson_status: "completed",
    });

    const [lowered, reset] = await Promise.all([
      request.put(progressPath, {
        headers: {
          ...authorization,
          "Idempotency-Key": `${fixture.idempotencyPrefix}-lower-concurrent`,
        },
        data: { status: "in_progress", percent: 50 },
      }),
      request.delete(progressPath, {
        headers: {
          ...authorization,
          "Idempotency-Key": `${fixture.idempotencyPrefix}-reset-concurrent`,
        },
      }),
    ]);
    for (const response of [lowered, reset]) {
      expect(response.status()).toBe(409);
      expect(response.headers()["content-type"]).toContain(
        "application/problem+json",
      );
      await expect(response.json()).resolves.toMatchObject({
        status: 409,
        code: "conflict",
        errors: {
          reason: "active_certificate",
          requiredAction: "revoke_certificate",
          certificateId: issued.certificate_id,
          courseId: fixture.courseId,
        },
      });
    }

    const [protectedState] = await sql<
      Array<{
        enrollment_status: string;
        enrollment_progress: number;
        lesson_status: string;
        lesson_percent: number;
        active_certificates: number;
      }>
    >`
      select
        e.status as enrollment_status,
        e.progress as enrollment_progress,
        lp.status as lesson_status,
        lp.percent as lesson_percent,
        (select count(*)::int from course_certificates cc
          where cc.organization_id = ${fixture.organizationId}
            and cc.user_id = ${fixture.memberId}
            and cc.course_id = ${fixture.courseId}
            and cc.revoked_at is null) as active_certificates
      from enrollments e
      join lesson_progress lp
        on lp.user_id = e.user_id and lp.lesson_id = ${fixture.lessonId}
      where e.user_id = ${fixture.memberId} and e.course_id = ${fixture.courseId}
    `;
    expect(protectedState).toEqual({
      enrollment_status: "completed",
      enrollment_progress: 100,
      lesson_status: "completed",
      lesson_percent: 100,
      active_certificates: 1,
    });

    await sql`
      update course_certificates
      set revoked_at = now(), revoked_by_id = ${fixture.ownerId},
          revocation_reason = 'Explicit test revocation before progress reset.'
      where id = ${issued.certificate_id} and revoked_at is null
    `;
    const [protectedCertificate] = await sql<Array<{ id: string }>>`
      insert into course_certificates (
        organization_id, user_id, course_id, certificate_number,
        recipient_name, course_title, organization_name, completed_at,
        issued_by_id
      ) values (
        ${fixture.organizationId}, ${fixture.memberId},
        ${fixture.protectedCourseId}, ${`QA-PROTECTED-${suffix}`},
        ${`Progress Integrity ${suffix}`}, ${`Protected Progress ${suffix}`},
        'Q-Academy', now(), ${fixture.ownerId}
      ) returning id
    `;
    const resetBlockedBySharedCertificate = await request.delete(progressPath, {
      headers: {
        ...authorization,
        "Idempotency-Key": `${fixture.idempotencyPrefix}-shared-certificate`,
      },
    });
    expect(resetBlockedBySharedCertificate.status()).toBe(409);
    await expect(resetBlockedBySharedCertificate.json()).resolves.toMatchObject({
      status: 409,
      code: "conflict",
      errors: {
        reason: "active_certificate",
        certificateId: protectedCertificate.id,
        courseId: fixture.protectedCourseId,
      },
    });
    const [stillCompleted] = await sql<Array<{ status: string; percent: number }>>`
      select status, percent
      from lesson_progress
      where user_id = ${fixture.memberId} and lesson_id = ${fixture.lessonId}
    `;
    expect(stillCompleted).toEqual({ status: "completed", percent: 100 });
    await sql`
      update course_certificates
      set revoked_at = now(), revoked_by_id = ${fixture.ownerId},
          revocation_reason = 'Explicit shared-course test revocation.'
      where id = ${protectedCertificate.id} and revoked_at is null
    `;
    const resetAfterRevocation = await request.delete(progressPath, {
      headers: {
        ...authorization,
        "Idempotency-Key": `${fixture.idempotencyPrefix}-reset-after-revoke`,
      },
    });
    expect(resetAfterRevocation.status()).toBe(200);

    const reconciled = await request.patch(enrollmentPath, {
      headers: {
        ...authorization,
        "Idempotency-Key": `${fixture.idempotencyPrefix}-reconcile`,
      },
      data: { status: "not_started", progress: 0 },
    });
    expect(reconciled.status()).toBe(200);
    await expect(reconciled.json()).resolves.toMatchObject({
      data: { status: "not_started", progress: 0, completedAt: null },
    });

    const [finalState] = await sql<
      Array<{
        status: string;
        progress: number;
        completed_at: Date | null;
        lesson_progress_count: number;
        active_certificates: number;
        certificate_history: number;
      }>
    >`
      select
        e.status,
        e.progress,
        e.completed_at,
        (select count(*)::int from lesson_progress lp
          where lp.user_id = ${fixture.memberId}
            and lp.lesson_id = ${fixture.lessonId}) as lesson_progress_count,
        (select count(*)::int from course_certificates cc
          where cc.organization_id = ${fixture.organizationId}
            and cc.user_id = ${fixture.memberId}
            and cc.course_id = ${fixture.courseId}
            and cc.revoked_at is null) as active_certificates,
        (select count(*)::int from course_certificates cc
          where cc.organization_id = ${fixture.organizationId}
            and cc.user_id = ${fixture.memberId}
            and cc.course_id = ${fixture.courseId}) as certificate_history
      from enrollments e
      where e.user_id = ${fixture.memberId} and e.course_id = ${fixture.courseId}
    `;
    expect(finalState).toEqual({
      status: "not_started",
      progress: 0,
      completed_at: null,
      lesson_progress_count: 0,
      active_certificates: 0,
      certificate_history: 1,
    });
  } finally {
    await sql.end();
    await cleanupFixture(fixture);
  }
});
