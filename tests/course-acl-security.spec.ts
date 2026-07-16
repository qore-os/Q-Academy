import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";
import postgres from "postgres";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";

test("trainer course pages and certificates enforce view edit and manage boundaries", async ({
  request,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "API-only ACL integration runs once");
  const sql = postgres(databaseUrl, { max: 1, prepare: false });
  const suffix = randomUUID().slice(0, 8);
  const trainerEmail = `course-acl-${suffix}@example.test`;
  const titles = {
    view: `ACL View ${suffix}`,
    edit: `ACL Edit ${suffix}`,
    manage: `ACL Manage ${suffix}`,
    hidden: `ACL Hidden ${suffix}`,
  } as const;
  let trainerId = "";
  let courseIds: Record<keyof typeof titles, string> | null = null;
  let certificateIds: Record<keyof typeof titles, string> | null = null;

  try {
    const [fixture] = await sql<
      Array<{
        organizationId: string;
        organizationSlug: string;
        organizationName: string;
        ownerId: string;
        memberId: string;
        passwordHash: string;
      }>
    >`
      select
        owner.organization_id as "organizationId",
        organization.slug as "organizationSlug",
        organization.name as "organizationName",
        owner.id as "ownerId",
        member.id as "memberId",
        member.password_hash as "passwordHash"
      from users owner
      join organizations organization on organization.id = owner.organization_id
      join users member
        on member.organization_id = owner.organization_id
       and member.email = 'lea@q-academy.de'
      where owner.email = 'admin@q-academy.de'
      limit 1
    `;
    expect(fixture).toBeTruthy();
    const [trainer] = await sql<Array<{ id: string }>>`
      insert into users (
        organization_id, email, password_hash, first_name, last_name, role, status
      ) values (
        ${fixture.organizationId}, ${trainerEmail}, ${fixture.passwordHash},
        'Kurs', 'Trainer', 'trainer', 'active'
      )
      returning id
    `;
    trainerId = trainer.id;

    const courseRows = await sql<Array<{ id: string; title: string }>>`
      insert into courses (
        organization_id, title, slug, short_description, description, status,
        created_by_id
      ) values
        (${fixture.organizationId}, ${titles.view}, ${`acl-view-${suffix}`}, 'View ACL', 'View ACL course', 'draft', ${fixture.ownerId}),
        (${fixture.organizationId}, ${titles.edit}, ${`acl-edit-${suffix}`}, 'Edit ACL', 'Edit ACL course', 'draft', ${fixture.ownerId}),
        (${fixture.organizationId}, ${titles.manage}, ${`acl-manage-${suffix}`}, 'Manage ACL', 'Manage ACL course', 'draft', ${fixture.ownerId}),
        (${fixture.organizationId}, ${titles.hidden}, ${`acl-hidden-${suffix}`}, 'Hidden ACL', 'Hidden ACL course', 'draft', ${fixture.ownerId})
      returning id, title
    `;
    courseIds = Object.fromEntries(
      Object.entries(titles).map(([permission, title]) => [
        permission,
        courseRows.find((course) => course.title === title)!.id,
      ]),
    ) as Record<keyof typeof titles, string>;
    await sql`
      insert into course_collaborators (
        organization_id, course_id, user_id, permission, granted_by_id
      ) values
        (${fixture.organizationId}, ${courseIds.view}, ${trainerId}, 'view', ${fixture.ownerId}),
        (${fixture.organizationId}, ${courseIds.edit}, ${trainerId}, 'edit', ${fixture.ownerId}),
        (${fixture.organizationId}, ${courseIds.manage}, ${trainerId}, 'manage', ${fixture.ownerId})
    `;

    const certificateRows = await sql<
      Array<{ id: string; courseId: string }>
    >`
      insert into course_certificates (
        organization_id, user_id, course_id, certificate_number,
        recipient_name, course_title, organization_name, completed_at
      ) values
        (${fixture.organizationId}, ${fixture.memberId}, ${courseIds.view}, ${`QA-ACL-VIEW-${suffix}`}, 'Lea Hartmann', ${titles.view}, ${fixture.organizationName}, now()),
        (${fixture.organizationId}, ${fixture.memberId}, ${courseIds.edit}, ${`QA-ACL-EDIT-${suffix}`}, 'Lea Hartmann', ${titles.edit}, ${fixture.organizationName}, now()),
        (${fixture.organizationId}, ${fixture.memberId}, ${courseIds.manage}, ${`QA-ACL-MANAGE-${suffix}`}, 'Lea Hartmann', ${titles.manage}, ${fixture.organizationName}, now()),
        (${fixture.organizationId}, ${fixture.memberId}, ${courseIds.hidden}, ${`QA-ACL-HIDDEN-${suffix}`}, 'Lea Hartmann', ${titles.hidden}, ${fixture.organizationName}, now())
      returning id, course_id as "courseId"
    `;
    certificateIds = Object.fromEntries(
      Object.entries(courseIds).map(([permission, courseId]) => [
        permission,
        certificateRows.find((certificate) => certificate.courseId === courseId)!
          .id,
      ]),
    ) as Record<keyof typeof titles, string>;

    const login = await request.post("/api/v1/auth/login", {
      data: {
        organizationSlug: fixture.organizationSlug,
        email: trainerEmail,
        password: "Demo123!",
      },
    });
    expect(login.status()).toBe(200);

    const list = await request.get("/admin/courses");
    const listHtml = await list.text();
    expect(listHtml).toContain(titles.view);
    expect(listHtml).toContain(titles.edit);
    expect(listHtml).toContain(titles.manage);
    expect(listHtml).not.toContain(titles.hidden);

    const preview = await request.get(
      `/admin/courses/${courseIds.view}/preview`,
    );
    expect(preview.status()).toBe(200);
    expect(await preview.text()).toContain(titles.view);

    for (const blockedCourseId of [courseIds.view, courseIds.hidden]) {
      const blocked = await request.get(`/admin/courses/${blockedCourseId}`, {
        maxRedirects: 0,
      });
      expect([303, 307, 308]).toContain(blocked.status());
      expect(blocked.headers().location).toContain("/admin/courses");
    }
    const hiddenPreview = await request.get(
      `/admin/courses/${courseIds.hidden}/preview`,
      { maxRedirects: 0 },
    );
    expect([303, 307, 308]).toContain(hiddenPreview.status());

    const editBuilder = await request.get(`/admin/courses/${courseIds.edit}`);
    const editHtml = await editBuilder.text();
    expect(editBuilder.status()).toBe(200);
    expect(editHtml).toContain(titles.edit);
    expect(editHtml).not.toContain("Kurs veröffentlichen");

    const manageBuilder = await request.get(
      `/admin/courses/${courseIds.manage}`,
    );
    const manageHtml = await manageBuilder.text();
    expect(manageBuilder.status()).toBe(200);
    expect(manageHtml).toContain("Kurs veröffentlichen");

    const certificates = await request.get("/admin/certificates");
    const certificatesHtml = await certificates.text();
    expect(certificatesHtml).not.toContain(titles.view);
    expect(certificatesHtml).toContain(titles.edit);
    expect(certificatesHtml).toContain(titles.manage);
    expect(certificatesHtml).not.toContain(titles.hidden);

    for (const allowed of [certificateIds.edit, certificateIds.manage]) {
      const response = await request.get(`/admin/certificates/${allowed}`);
      expect(response.status()).toBe(200);
    }
    for (const blocked of [certificateIds.view, certificateIds.hidden]) {
      const response = await request.get(`/admin/certificates/${blocked}`);
      expect(response.status()).toBe(404);
    }
  } finally {
    if (certificateIds) {
      await sql`
        delete from course_certificates
        where id = any(${Object.values(certificateIds)}::uuid[])
      `;
    }
    if (courseIds) {
      await sql`
        delete from courses where id = any(${Object.values(courseIds)}::uuid[])
      `;
    }
    if (trainerId) await sql`delete from users where id = ${trainerId}`;
    await sql.end();
  }
});
