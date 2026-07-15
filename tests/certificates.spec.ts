import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";
import { completeMemberWelcomeIfVisible } from "./helpers/member-welcome";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";

type CertificateFixture = {
  organizationId: string;
  userId: string;
  courseId: string;
  moduleId: string;
  lessonId: string;
  slug: string;
  title: string;
};

async function login(page: Page, role: "member" | "admin") {
  await page.context().clearCookies();
  await page.goto("/login");
  await page
    .getByRole("button", {
      name: role === "member" ? /Lernenden-Demo|Als Mitglied testen/ : /Admin-Demo|Als Admin testen/,
    })
    .click();
  await page.waitForURL(role === "member" ? "**/academy" : "**/admin");
  if (role === "member") await completeMemberWelcomeIfVisible(page);
}

async function createFixture(): Promise<CertificateFixture> {
  const sql = postgres(databaseUrl, { max: 1, prepare: false });
  try {
    const [identity] = await sql<
      Array<{ organization_id: string; user_id: string }>
    >`
      select organization_id, id as user_id
      from users
      where email = 'lea@q-academy.de'
      limit 1
    `;
    if (!identity) throw new Error("Certificate test member was not found.");
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const slug = `zertifikat-test-${suffix}`;
    const title = `Zertifikat Testkurs ${suffix}`;
    return await sql.begin(async (tx) => {
      const [course] = await tx<Array<{ id: string }>>`
        insert into courses (
          organization_id, title, slug, short_description, description,
          status, certificate_enabled, created_by_id
        ) values (
          ${identity.organization_id}, ${title}, ${slug}, 'Testkurs',
          'Isolierter Kurs fuer den Zertifikatstest.', 'published', true,
          ${identity.user_id}
        ) returning id
      `;
      const [module] = await tx<Array<{ id: string }>>`
        insert into modules (
          organization_id, title, folder, is_reusable, estimated_minutes
        ) values (
          ${identity.organization_id}, ${`Modul ${suffix}`}, 'Tests', false, 5
        ) returning id
      `;
      await tx`
        insert into course_modules (
          organization_id, course_id, module_id, sort_order, is_required
        )
        values (${identity.organization_id}, ${course.id}, ${module.id}, 0, true)
      `;
      const [lesson] = await tx<Array<{ id: string }>>`
        insert into lessons (
          organization_id, module_id, title, slug, summary, type,
          duration_minutes, sort_order, status
        ) values (
          ${identity.organization_id}, ${module.id}, 'Abschlusslektion',
          'abschlusslektion',
          'Diese Lektion schliesst den Testkurs ab.', 'lesson', 5, 0, 'published'
        ) returning id
      `;
      await tx`
        insert into content_blocks (lesson_id, type, title, sort_order, data)
        values (
          ${lesson.id}, 'heading', 'Abschlusslektion', 0,
          ${tx.json({ text: "Abschlusslektion" })}
        )
      `;
      const [enrollment] = await tx<Array<{ id: string }>>`
        insert into enrollments (user_id, course_id, access_active)
        values (${identity.user_id}, ${course.id}, true)
        returning id
      `;
      await tx`
        insert into course_access_grants (
          organization_id, user_id, course_id, source
        ) values (
          ${identity.organization_id}, ${identity.user_id}, ${course.id},
          ${`direct:${enrollment.id}`}
        )
      `;
      return {
        organizationId: identity.organization_id,
        userId: identity.user_id,
        courseId: course.id,
        moduleId: module.id,
        lessonId: lesson.id,
        slug,
        title,
      };
    });
  } finally {
    await sql.end();
  }
}

async function cleanupFixture(fixture: CertificateFixture) {
  const sql = postgres(databaseUrl, { max: 1, prepare: false });
  try {
    await sql.begin(async (tx) => {
      const certificates = await tx<Array<{ id: string }>>`
        select id from course_certificates where course_id = ${fixture.courseId}
      `;
      const certificateIds = certificates.map((certificate) => certificate.id);
      if (certificateIds.length) {
        await tx`
          delete from activity_events
          where entity_type = 'course_certificate'
            and entity_id = any(${certificateIds}::uuid[])
        `;
      }
      await tx`
        delete from notifications
        where user_id = ${fixture.userId}
          and (
            body like ${`%${fixture.title}%`}
            or href = any(${certificateIds.map((id) => `/academy/certificates/${id}`)}::text[])
          )
      `;
      const [awardedPoints] = await tx<Array<{ amount: number }>>`
        select coalesce(sum(amount), 0)::int as amount
        from point_transactions
        where user_id = ${fixture.userId}
          and entity_id = ${fixture.lessonId}
      `;
      await tx`
        delete from point_transactions
        where user_id = ${fixture.userId}
          and entity_id = ${fixture.lessonId}
      `;
      if (awardedPoints.amount) {
        await tx`
          update users
          set points = points - ${awardedPoints.amount}
          where id = ${fixture.userId}
        `;
      }
      await tx`
        delete from activity_events
        where entity_id in (${fixture.lessonId}, ${fixture.courseId})
      `;
      await tx`
        delete from api_audit_logs
        where path like ${`%${fixture.courseId}%`}
      `;
      await tx`
        delete from api_idempotency_keys
        where path like ${`%${fixture.courseId}%`}
      `;
      await tx`delete from courses where id = ${fixture.courseId}`;
      await tx`delete from modules where id = ${fixture.moduleId}`;
    });
  } finally {
    await sql.end();
  }
}

test("course completion issues one certificate and admin can revoke and reissue it", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "desktop mutation flow");
  const fixture = await createFixture();
  const sql = postgres(databaseUrl, { max: 1, prepare: false });
  try {
    const published = await page.request.post(
      `/api/v1/courses/${fixture.courseId}/publish`,
      {
        headers: {
          authorization: `Bearer ${process.env.DEMO_API_KEY ?? "qak_demo_qacademy_2026_local_development"}`,
          "idempotency-key": `certificate-publish-${fixture.courseId}`,
        },
        data: { changelog: "Certificate lifecycle test publication" },
      },
    );
    expect(published.status()).toBe(201);
    const prematureCompletion = await page.request.patch(
      `/api/v1/members/${fixture.userId}/enrollments/${fixture.courseId}`,
      {
        headers: {
          authorization: `Bearer ${process.env.DEMO_API_KEY ?? "qak_demo_qacademy_2026_local_development"}`,
          "content-type": "application/json",
          "idempotency-key": `certificate-premature-${fixture.courseId}`,
        },
        data: { status: "completed", progress: 100 },
      },
    );
    expect(prematureCompletion.status()).toBe(409);
    await expect(prematureCompletion.json()).resolves.toMatchObject({
      status: 409,
      code: "conflict",
      errors: {
        reason: "derived_progress_mismatch",
        actual: { status: "not_started", progress: 0 },
      },
    });
    const [prematureCertificate] = await sql<Array<{ count: number }>>`
      select count(*)::int as count
      from course_certificates
      where user_id = ${fixture.userId} and course_id = ${fixture.courseId}
    `;
    expect(prematureCertificate.count).toBe(0);

    await login(page, "member");
    await page.goto(
      `/academy/courses/${fixture.slug}/learn/${fixture.lessonId}`,
    );
    await expect(
      page.getByRole("heading", { name: "Abschlusslektion" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Lektion abschliessen" }).click();
    await expect(
      page.getByRole("button", { name: "Lektion abgeschlossen" }),
    ).toBeDisabled();

    const issued = await sql<
      Array<{ id: string; certificate_number: string }>
    >`
      select id, certificate_number
      from course_certificates
      where organization_id = ${fixture.organizationId}
        and user_id = ${fixture.userId}
        and course_id = ${fixture.courseId}
        and revoked_at is null
    `;
    expect(issued).toHaveLength(1);

    await page.reload();
    const afterReload = await sql<Array<{ count: number }>>`
      select count(*)::int as count
      from course_certificates
      where user_id = ${fixture.userId} and course_id = ${fixture.courseId}
    `;
    expect(afterReload[0].count).toBe(1);

    await page.goto("/academy/certificates");
    const memberCard = page.locator("article").filter({ hasText: fixture.title });
    await expect(memberCard).toBeVisible();
    await memberCard.getByRole("link", { name: "Zertifikat ansehen" }).click();
    await expect(
      page.getByRole("heading", { name: "Zertifikat", exact: true }),
    ).toBeVisible();
    await expect(page.getByText(issued[0].certificate_number)).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Drucken / als PDF sichern" }),
    ).toBeVisible();

    await login(page, "admin");
    const foreignResponse = await page.goto(
      `/academy/certificates/${issued[0].id}`,
    );
    expect(foreignResponse?.status()).toBe(404);

    await page.goto(`/admin/certificates?q=${encodeURIComponent(fixture.title)}`);
    const adminRow = page.locator("article").filter({ hasText: fixture.title });
    await expect(adminRow).toBeVisible();
    await adminRow.getByText("Widerrufen", { exact: true }).click();
    await adminRow.getByLabel("Begruendung").fill("Korrektur des Nachweises");
    await adminRow.getByRole("button", { name: "Widerruf bestaetigen" }).click();
    await expect(page.getByText("Zertifikat widerrufen.", { exact: true })).toBeVisible();

    await expect
      .poll(async () => {
        const [result] = await sql<Array<{ active: number }>>`
          select count(*) filter (where revoked_at is null)::int as active
          from course_certificates
          where user_id = ${fixture.userId} and course_id = ${fixture.courseId}
        `;
        return result.active;
      })
      .toBe(0);

    const refreshedRow = page.locator("article").filter({ hasText: fixture.title });
    await refreshedRow.getByRole("button", { name: "Neu ausstellen" }).click();
    await expect(page.getByText("Zertifikat neu ausgestellt.", { exact: true })).toBeVisible();
    const history = await sql<
      Array<{ certificate_number: string; revoked_at: Date | null }>
    >`
      select certificate_number, revoked_at
      from course_certificates
      where user_id = ${fixture.userId} and course_id = ${fixture.courseId}
      order by issued_at
    `;
    expect(history).toHaveLength(2);
    expect(new Set(history.map((entry) => entry.certificate_number)).size).toBe(2);
    expect(history.filter((entry) => entry.revoked_at === null)).toHaveLength(1);
  } finally {
    await sql.end();
    await cleanupFixture(fixture);
  }
});

test("certificate views remain usable without horizontal overflow on mobile", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "mobile certificate view");
  const fixture = await createFixture();
  const sql = postgres(databaseUrl, { max: 1, prepare: false });
  try {
    const [certificate] = await sql<Array<{ id: string }>>`
      insert into course_certificates (
        organization_id, user_id, course_id, certificate_number,
        recipient_name, course_title, organization_name, completed_at
      ) values (
        ${fixture.organizationId}, ${fixture.userId}, ${fixture.courseId},
        ${`QA-2026-MOBILE-${Date.now()}`}, 'Lea Hartmann', ${fixture.title},
        'Q-Academy', now()
      ) returning id
    `;
    await login(page, "member");
    await page.goto("/academy/certificates");
    await expect(page.getByText(fixture.title)).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(1);
    await page.goto(`/academy/certificates/${certificate.id}`);
    await expect(
      page.getByRole("heading", { name: "Zertifikat", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(1);
  } finally {
    await sql.end();
    await cleanupFixture(fixture);
  }
});
