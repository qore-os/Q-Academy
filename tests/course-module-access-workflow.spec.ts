import { createHash, randomUUID } from "node:crypto";
import {
  expect,
  test,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import postgres from "postgres";
import { completeMemberWelcomeIfVisible } from "./helpers/member-welcome";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";
const demoSecret =
  process.env.DEMO_API_KEY ?? "qak_demo_qacademy_2026_local_development";

function hashSecret(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

async function login(page: Page, role: "admin" | "member") {
  await page.goto("/login");
  await page
    .getByRole("button", {
      name: role === "admin" ? /Admin-Demo|Als Admin testen/ : /Lernenden-Demo|Als Mitglied testen/,
    })
    .click();
  await page.waitForURL(role === "admin" ? "**/admin" : "**/academy");
  if (role === "member") await completeMemberWelcomeIfVisible(page);
}

test("module access requests serialize, withdraw, approve and reject stale targets", async ({
  browser,
  page,
  request,
}) => {
  const sql = postgres(databaseUrl, { max: 2, prepare: false });
  const suffix = randomUUID();
  const slug = `module-access-${suffix}`;
  const courseTitle = `Module Access ${suffix}`;
  const moduleTitle = `Locked Module ${suffix}`;
  const startedAt = new Date();
  let courseId = "";
  let moduleId = "";
  let adminContext: BrowserContext | null = null;
  const requestIds: string[] = [];

  try {
    const [identity] = await sql<
      Array<{
        organization_id: string;
        admin_id: string;
        member_id: string;
      }>
    >`
      select
        api.organization_id,
        admin.id as admin_id,
        member.id as member_id
      from api_keys api
      join users admin
        on admin.organization_id = api.organization_id
       and admin.email = 'admin@q-academy.de'
      join users member
        on member.organization_id = api.organization_id
       and member.email = 'lea@q-academy.de'
      where api.key_hash = ${hashSecret(demoSecret)}
        and api.status = 'active'
      limit 1
    `;
    expect(identity).toBeTruthy();

    const [course] = await sql<Array<{ id: string }>>`
      insert into courses (
        organization_id, title, slug, short_description, description,
        status, first_published_at, created_by_id
      ) values (
        ${identity.organization_id}, ${courseTitle}, ${slug},
        'Isolierter Modulzugriffstest.', 'Isolierter Modulzugriffstest.',
        'draft', ${new Date(startedAt.getTime() - 60_000)}, ${identity.admin_id}
      ) returning id
    `;
    courseId = course.id;
    const [learningModule] = await sql<Array<{ id: string }>>`
      insert into modules (
        organization_id, title, description, estimated_minutes
      ) values (
        ${identity.organization_id}, ${moduleTitle},
        'Gesperrtes anfragbares Testmodul.', 10
      ) returning id
    `;
    moduleId = learningModule.id;
    await sql`
      insert into course_modules (
        organization_id, course_id, module_id, sort_order, access_mode,
        drip_days, delay_pending_state, window_default_state, window_state,
        request_access_enabled, is_required
      ) values (
        ${identity.organization_id}, ${courseId}, ${moduleId}, 0, 'locked',
        0, 'locked', 'locked', 'available', true, true
      )
    `;

    const publishedAt = new Date(startedAt.getTime() - 30_000);
    const snapshot = {
      schemaVersion: 6,
      accessPolicyVersion: 2,
      moduleKindVersion: 1,
      courseOutlineVersion: 1,
      capturedAt: publishedAt.toISOString(),
      course: {
        id: courseId,
        organizationId: identity.organization_id,
        title: courseTitle,
        slug,
        shortDescription: "Isolierter Modulzugriffstest.",
        description: "Isolierter Modulzugriffstest.",
        categoryId: null,
        coverImage: null,
        status: "published",
        difficulty: "Grundlagen",
        estimatedMinutes: 10,
        certificateEnabled: false,
        featured: false,
        visibleInCatalog: true,
        showProgressPercentage: true,
        publishedVersionId: null,
        firstPublishedAt: new Date(startedAt.getTime() - 60_000).toISOString(),
        createdById: identity.admin_id,
        createdAt: publishedAt.toISOString(),
        updatedAt: publishedAt.toISOString(),
      },
      learningGoals: [],
      authors: [],
      widgets: [],
      modules: [
        {
          id: moduleId,
          organizationId: identity.organization_id,
          title: moduleTitle,
          kind: "learning",
          linkedCourseId: null,
          targetVersionIdAtCapture: null,
          description: "Gesperrtes anfragbares Testmodul.",
          folder: "Tests",
          isReusable: true,
          estimatedMinutes: 10,
          createdAt: publishedAt.toISOString(),
          updatedAt: publishedAt.toISOString(),
          sortOrder: 0,
          indentLevel: 0,
          accessMode: "locked",
          dripDays: 0,
          delayPendingState: "locked",
          availableFrom: null,
          availableUntil: null,
          windowDefaultState: "locked",
          windowState: "available",
          requestAccessEnabled: true,
          isRequired: true,
          lessons: [],
        },
      ],
    };
    const [version] = await sql<Array<{ id: string }>>`
      insert into course_versions (
        organization_id, course_id, version, snapshot, changelog,
        published_at, created_by_id
      ) values (
        ${identity.organization_id}, ${courseId}, 1, ${sql.json(snapshot)},
        'Initial access policy', ${publishedAt}, ${identity.admin_id}
      ) returning id
    `;
    await sql`
      update courses
      set status = 'published', published_version_id = ${version.id}
      where id = ${courseId} and organization_id = ${identity.organization_id}
    `;
    await sql`
      insert into enrollments (user_id, course_id, access_active, enrolled_at)
      values (${identity.member_id}, ${courseId}, true, ${startedAt})
    `;
    await sql`
      insert into course_access_grants (
        organization_id, user_id, course_id, source
      ) values (
        ${identity.organization_id}, ${identity.member_id}, ${courseId},
        ${`test:${suffix}`}
      )
    `;

    const path = `/api/v1/courses/${courseId}/modules/${moduleId}/access-requests`;
    const createResponses = await Promise.all(
      [0, 1].map((index) =>
        request.post(path, {
          headers: {
            Authorization: `Bearer ${demoSecret}`,
            "Idempotency-Key": `module-access-create-${suffix}-${index}`,
          },
          data: { userId: identity.member_id, message: "Bitte freigeben." },
        }),
      ),
    );
    expect(createResponses.map((response) => response.status()).sort()).toEqual([
      201, 409,
    ]);
    const createdResponse = createResponses.find(
      (response) => response.status() === 201,
    );
    const createdBody = (await createdResponse!.json()) as {
      data: { id: string };
    };
    requestIds.push(createdBody.data.id);

    const [pendingState] = await sql<
      Array<{ pending_count: number; admin_notifications: number }>
    >`
      select
        (select count(*)::int from course_module_access_requests
          where course_id = ${courseId} and module_id = ${moduleId}
            and user_id = ${identity.member_id} and status = 'pending') as pending_count,
        (select count(*)::int from notifications n
          join users u on u.id = n.user_id
          where u.organization_id = ${identity.organization_id}
            and u.role in ('owner', 'admin')
            and n.type = 'course_access'
            and n.body like ${`%${moduleTitle}%`}) as admin_notifications
    `;
    expect(pendingState.pending_count).toBe(1);
    expect(pendingState.admin_notifications).toBeGreaterThan(0);

    await login(page, "member");
    await page.goto(`/academy/courses/${slug}`);
    await expect(page.getByRole("heading", { name: courseTitle })).toBeVisible();
    await expect(page.getByText("Zugriff angefragt", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Zurueckziehen" })).toBeVisible();

    const foreignWithdraw = await request.delete(
      `${path}/${createdBody.data.id}`,
      {
        headers: {
          Authorization: `Bearer ${demoSecret}`,
          "Idempotency-Key": `module-access-foreign-withdraw-${suffix}`,
        },
        data: { userId: identity.admin_id },
      },
    );
    const foreignWithdrawBody = await foreignWithdraw.text();
    expect(
      foreignWithdraw.headers()["content-type"],
      foreignWithdrawBody,
    ).toContain("application/problem+json");
    expect(foreignWithdraw.status(), foreignWithdrawBody).toBe(404);
    expect(JSON.parse(foreignWithdrawBody)).toMatchObject({
      code: "not_found",
      status: 404,
    });

    const withdraw = await request.delete(`${path}/${createdBody.data.id}`, {
      headers: {
        Authorization: `Bearer ${demoSecret}`,
        "Idempotency-Key": `module-access-withdraw-${suffix}`,
      },
      data: { userId: identity.member_id },
    });
    const withdrawBody = await withdraw.text();
    expect(withdraw.status(), withdrawBody).toBe(200);
    expect((JSON.parse(withdrawBody) as { data: { status: string } }).data.status).toBe(
      "cancelled",
    );

    const secondCreate = await request.post(path, {
      headers: {
        Authorization: `Bearer ${demoSecret}`,
        "Idempotency-Key": `module-access-second-${suffix}`,
      },
      data: { userId: identity.member_id },
    });
    expect(secondCreate.status()).toBe(201);
    const secondRequest = (await secondCreate.json()) as {
      data: { id: string };
    };
    requestIds.push(secondRequest.data.id);

    adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    await login(adminPage, "admin");
    await adminPage.goto(`/admin/courses/${courseId}/access`);
    await expect(adminPage.getByRole("heading", { name: courseTitle })).toBeVisible();
    await expect(adminPage.getByText(moduleTitle, { exact: true })).toBeVisible();
    await expect(adminPage.getByRole("button", { name: "Freigeben" })).toBeVisible();

    const approve = await request.patch(`${path}/${secondRequest.data.id}`, {
      headers: {
        Authorization: `Bearer ${demoSecret}`,
        "Idempotency-Key": `module-access-approve-${suffix}`,
      },
      data: {
        actorId: identity.admin_id,
        decision: "approved",
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      },
    });
    expect(approve.status()).toBe(200);
    const approvedBody = (await approve.json()) as {
      data: { stale: boolean; request: { status: string }; override: { state: string } };
    };
    expect(approvedBody.data).toMatchObject({
      stale: false,
      request: { status: "approved" },
      override: { state: "available" },
    });

    const removeOverride = await request.delete(
      `/api/v1/courses/${courseId}/modules/${moduleId}/access-overrides/${identity.member_id}`,
      {
        headers: {
          Authorization: `Bearer ${demoSecret}`,
          "Idempotency-Key": `module-access-override-delete-${suffix}`,
        },
        data: { actorId: identity.admin_id },
      },
    );
    expect(removeOverride.status()).toBe(200);

    const staleCreate = await request.post(path, {
      headers: {
        Authorization: `Bearer ${demoSecret}`,
        "Idempotency-Key": `module-access-stale-create-${suffix}`,
      },
      data: { userId: identity.member_id },
    });
    expect(staleCreate.status()).toBe(201);
    const staleRequest = (await staleCreate.json()) as {
      data: { id: string };
    };
    requestIds.push(staleRequest.data.id);

    const republishedAt = new Date(Date.now() + 2_000);
    const [republished] = await sql<Array<{ id: string }>>`
      insert into course_versions (
        organization_id, course_id, version, snapshot, changelog,
        published_at, created_by_id
      ) values (
        ${identity.organization_id}, ${courseId}, 2,
        ${sql.json({ ...snapshot, capturedAt: republishedAt.toISOString() })},
        'Republished access policy', ${republishedAt}, ${identity.admin_id}
      ) returning id
    `;
    await sql`
      update courses set published_version_id = ${republished.id}
      where id = ${courseId} and organization_id = ${identity.organization_id}
    `;

    const staleDecision = await request.patch(
      `${path}/${staleRequest.data.id}`,
      {
        headers: {
          Authorization: `Bearer ${demoSecret}`,
          "Idempotency-Key": `module-access-stale-decision-${suffix}`,
        },
        data: { actorId: identity.admin_id, decision: "approved" },
      },
    );
    expect(staleDecision.status()).toBe(200);
    expect(
      ((await staleDecision.json()) as {
        data: { stale: boolean; request: { status: string }; override: null };
      }).data,
    ).toMatchObject({ stale: true, request: { status: "rejected" }, override: null });

    const [finalState] = await sql<
      Array<{
        override_count: number;
        activity_count: number;
        audit_count: number;
        member_notifications: number;
      }>
    >`
      select
        (select count(*)::int from course_module_access_overrides
          where course_id = ${courseId} and module_id = ${moduleId}
            and user_id = ${identity.member_id}) as override_count,
        (select count(*)::int from activity_events
          where metadata ->> 'courseId' = ${courseId}) as activity_count,
        (select count(*)::int from api_audit_logs
          where path like ${`%${courseId}%`} and response_status < 500) as audit_count,
        (select count(*)::int from notifications
          where user_id = ${identity.member_id} and type = 'course_access'
            and created_at >= ${startedAt}) as member_notifications
    `;
    expect(finalState.override_count).toBe(0);
    expect(finalState.activity_count).toBeGreaterThanOrEqual(5);
    expect(finalState.audit_count).toBeGreaterThanOrEqual(7);
    expect(finalState.member_notifications).toBeGreaterThanOrEqual(3);
  } finally {
    await adminContext?.close();
    if (courseId) {
      await sql`delete from api_audit_logs where path like ${`%${courseId}%`}`;
      await sql`delete from api_idempotency_keys where path like ${`%${courseId}%`}`;
      await sql`delete from activity_events where metadata ->> 'courseId' = ${courseId}`;
      await sql`delete from notifications where type = 'course_access' and (body like ${`%${courseTitle}%`} or body like ${`%${moduleTitle}%`} or href = ${`/admin/courses/${courseId}`})`;
      await sql`delete from courses where id = ${courseId}`;
    }
    if (moduleId) await sql`delete from modules where id = ${moduleId}`;
    await sql.end();
  }
});
