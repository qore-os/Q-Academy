import { createHash, randomBytes, randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";
import { completeMemberWelcomeIfVisible } from "./helpers/member-welcome";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";

function hashSecret(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

async function loginMember(page: Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: /Lernenden-Demo|Als Mitglied testen/ }).click();
  await page.waitForURL("**/academy");
  await completeMemberWelcomeIfVisible(page);
}

test("coming-soon subscriptions are tenant-safe and fulfill exactly once on publication", async ({
  page,
  request,
}) => {
  test.setTimeout(120_000);
  const sql = postgres(databaseUrl, { prepare: false });
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  const slug = `availability-${suffix}`;
  const courseTitle = `Freigabe Kurs ${suffix}`;
  const moduleTitle = `Freigabe Modul ${suffix}`;
  const lessonTitle = `Vorgemerkte Lektion ${suffix}`;
  const apiSecret = `qak_availability_${randomBytes(28).toString("base64url")}`;
  const foreignApiSecret = `qak_foreign_${randomBytes(28).toString("base64url")}`;
  let courseId = "";
  let moduleId = "";
  let lessonId = "";
  let organizationId = "";
  let memberId = "";
  let apiKeyId = "";
  let foreignOrganizationId = "";
  const startedAt = new Date();

  const headers = {
    Authorization: `Bearer ${apiSecret}`,
    "Content-Type": "application/json",
  };
  const publish = async (changelog: string) => {
    const response = await request.post(`/api/v1/courses/${courseId}/publish`, {
      headers: {
        ...headers,
        "Idempotency-Key": `publish-${suffix}-${randomUUID()}`,
      },
      data: { changelog },
    });
    expect(response.status(), await response.text()).toBe(201);
    return response;
  };
  const patchLesson = async (data: Record<string, unknown>) => {
    const response = await request.patch(`/api/v1/lessons/${lessonId}`, {
      headers: {
        ...headers,
        "Idempotency-Key": `lesson-${suffix}-${randomUUID()}`,
      },
      data,
    });
    expect(response.status(), await response.text()).toBe(200);
  };
  const patchModule = async (accessMode: "visible" | "hidden") => {
    const response = await request.patch(
      `/api/v1/courses/${courseId}/modules/${moduleId}`,
      {
        headers: {
          ...headers,
          "Idempotency-Key": `module-${suffix}-${randomUUID()}`,
        },
        data: { accessMode },
      },
    );
    expect(response.status(), await response.text()).toBe(200);
  };
  const setCourseDraft = async () => {
    const response = await request.patch(`/api/v1/courses/${courseId}`, {
      headers: {
        ...headers,
        "Idempotency-Key": `course-draft-${suffix}-${randomUUID()}`,
      },
      data: { status: "draft" },
    });
    expect(response.status(), await response.text()).toBe(200);
  };
  const subscriptionBody = () => ({ userId: memberId, courseId, lessonId });
  const notificationCounts = async () => {
    const [row] = await sql<
      Array<{ notifications: number; emails: number; fulfilled: number; active: number }>
    >`
      select
        (
          select count(*)::int
          from notifications n
          where n.user_id = ${memberId}
            and n.type = 'lesson_available'
            and n.created_at >= ${startedAt}
        ) as notifications,
        (
          select count(*)::int
          from email_deliveries d
          where d.organization_id = ${organizationId}
            and d.user_id = ${memberId}
            and d.event = 'lesson.available'
            and d.created_at >= ${startedAt}
        ) as emails,
        (
          select count(*)::int
          from lesson_availability_subscriptions s
          where s.organization_id = ${organizationId}
            and s.user_id = ${memberId}
            and s.course_id = ${courseId}
            and s.lesson_id = ${lessonId}
            and s.fulfilled_at is not null
        ) as fulfilled,
        (
          select count(*)::int
          from lesson_availability_subscriptions s
          where s.organization_id = ${organizationId}
            and s.user_id = ${memberId}
            and s.course_id = ${courseId}
            and s.lesson_id = ${lessonId}
            and s.cancelled_at is null
            and s.fulfilled_at is null
        ) as active
    `;
    return row;
  };

  try {
    const [fixture] = await sql<
      Array<{ owner_id: string; member_id: string; organization_id: string }>
    >`
      select owner.id as owner_id, member.id as member_id,
             owner.organization_id
      from users owner
      join users member
        on member.organization_id = owner.organization_id
       and member.email = 'lea@q-academy.de'
      where owner.email = 'admin@q-academy.de'
      limit 1
    `;
    expect(fixture).toBeTruthy();
    organizationId = fixture.organization_id;
    memberId = fixture.member_id;

    const [course] = await sql<Array<{ id: string }>>`
      insert into courses (
        organization_id, title, slug, short_description, description,
        status, certificate_enabled, created_by_id
      ) values (
        ${organizationId}, ${courseTitle}, ${slug},
        'Benachrichtigung fuer eine kommende Lektion.',
        'Isolierter Testkurs fuer atomare Freigabebenachrichtigungen.',
        'draft', false, ${fixture.owner_id}
      ) returning id
    `;
    courseId = course.id;
    const [learningModule] = await sql<Array<{ id: string }>>`
      insert into modules (
        organization_id, title, description, estimated_minutes
      ) values (
        ${organizationId}, ${moduleTitle},
        'Wiederverwendbares Modul fuer Freigabetests.', 10
      ) returning id
    `;
    moduleId = learningModule.id;
    await sql`
      insert into course_modules (
        organization_id, course_id, module_id, sort_order, access_mode,
        drip_days, is_required
      ) values (
        ${organizationId}, ${courseId}, ${moduleId}, 0, 'visible', 0, true
      )
    `;
    const [lesson] = await sql<Array<{ id: string }>>`
      insert into lessons (
        organization_id, module_id, title, slug, summary, type,
        duration_minutes, sort_order, status, visibility
      ) values (
        ${organizationId}, ${moduleId}, ${lessonTitle},
        ${`lesson-${suffix}`}, 'Noch nicht freigegeben.', 'lesson',
        10, 0, 'published', 'coming_soon'
      ) returning id
    `;
    lessonId = lesson.id;
    const [enrollment] = await sql<Array<{ id: string }>>`
      insert into enrollments (user_id, course_id, access_active, enrolled_at)
      values (${memberId}, ${courseId}, true, now() - interval '2 days')
      returning id
    `;
    await sql`
      insert into course_access_grants (
        organization_id, user_id, course_id, source
      ) values (
        ${organizationId}, ${memberId}, ${courseId},
        ${`direct:${enrollment.id}`}
      )
    `;
    const [apiKey] = await sql<Array<{ id: string }>>`
      insert into api_keys (
        organization_id, name, prefix, key_hash, scopes, created_by_id
      ) values (
        ${organizationId}, ${`Availability ${suffix}`},
        ${apiSecret.slice(0, 20)}, ${hashSecret(apiSecret)},
        array['courses:read', 'courses:write', 'modules:read', 'modules:write',
              'notifications:read', 'notifications:write'],
        ${fixture.owner_id}
      ) returning id
    `;
    apiKeyId = apiKey.id;
    const [foreignOrganization] = await sql<Array<{ id: string }>>`
      insert into organizations (name, slug)
      values (${`Foreign ${suffix}`}, ${`foreign-${suffix}`})
      returning id
    `;
    foreignOrganizationId = foreignOrganization.id;
    await sql`
      insert into api_keys (organization_id, name, prefix, key_hash, scopes)
      values (
        ${foreignOrganizationId}, ${`Foreign ${suffix}`},
        ${foreignApiSecret.slice(0, 20)}, ${hashSecret(foreignApiSecret)},
        array['notifications:read', 'notifications:write']
      )
    `;

    await publish("Kommende Lektion");

    const idempotencyKey = `subscribe-${suffix}`;
    const firstSubscription = await request.post(
      "/api/v1/lesson-availability-subscriptions",
      {
        headers: { ...headers, "Idempotency-Key": idempotencyKey },
        data: subscriptionBody(),
      },
    );
    expect(firstSubscription.status(), await firstSubscription.text()).toBe(201);
    const replayedSubscription = await request.post(
      "/api/v1/lesson-availability-subscriptions",
      {
        headers: { ...headers, "Idempotency-Key": idempotencyKey },
        data: subscriptionBody(),
      },
    );
    expect(replayedSubscription.status()).toBe(201);
    expect(replayedSubscription.headers()["idempotent-replayed"]).toBe("true");
    expect(await replayedSubscription.json()).toEqual(
      await firstSubscription.json(),
    );
    expect((await notificationCounts()).active).toBe(1);

    const foreignHeaders = {
      Authorization: `Bearer ${foreignApiSecret}`,
      "Content-Type": "application/json",
    };
    const foreignCreate = await request.post(
      "/api/v1/lesson-availability-subscriptions",
      {
        headers: {
          ...foreignHeaders,
          "Idempotency-Key": `foreign-${suffix}`,
        },
        data: subscriptionBody(),
      },
    );
    expect(foreignCreate.status()).toBe(404);
    const foreignList = await request.get(
      `/api/v1/lesson-availability-subscriptions?userId=${memberId}&courseId=${courseId}`,
      { headers: foreignHeaders },
    );
    expect(foreignList.status()).toBe(200);
    expect((await foreignList.json()).data).toEqual([]);

    await loginMember(page);
    await page.goto(`/academy/courses/${slug}`);
    await expect(page.getByText(lessonTitle, { exact: true })).toBeVisible();
    await page
      .getByRole("button", {
        name: "Lektionsbenachrichtigung deaktivieren",
      })
      .click();
    await expect(page.getByText("Benachrichtigung deaktiviert.")).toBeVisible();
    await page
      .getByRole("button", { name: "Bei Lektionsfreigabe benachrichtigen" })
      .click();
    await expect(
      page.getByText("Benachrichtigung aktiviert."),
    ).toBeVisible();
    await page
      .getByRole("button", {
        name: "Lektionsbenachrichtigung deaktivieren",
      })
      .click();
    await expect(page.getByText("Benachrichtigung deaktiviert.")).toBeVisible();
    await page
      .getByRole("button", { name: "Bei Lektionsfreigabe benachrichtigen" })
      .click();
    await expect(
      page.getByText("Benachrichtigung aktiviert."),
    ).toBeVisible();

    await patchLesson({ summary: "Noch immer nicht freigegeben." });
    await publish("Weiterhin erscheint bald");
    expect(await notificationCounts()).toMatchObject({
      notifications: 0,
      emails: 0,
      fulfilled: 0,
      active: 1,
    });

    await setCourseDraft();
    const cancelledWhileDraft = await request.delete(
      "/api/v1/lesson-availability-subscriptions",
      {
        headers: {
          ...headers,
          "Idempotency-Key": `draft-unsubscribe-${suffix}`,
        },
        data: subscriptionBody(),
      },
    );
    expect(cancelledWhileDraft.status(), await cancelledWhileDraft.text()).toBe(200);
    await publish("Erneut als kommende Lektion veroeffentlicht");
    const resubscribed = await request.post(
      "/api/v1/lesson-availability-subscriptions",
      {
        headers: {
          ...headers,
          "Idempotency-Key": `resubscribe-${suffix}`,
        },
        data: subscriptionBody(),
      },
    );
    expect(resubscribed.status(), await resubscribed.text()).toBe(201);

    await patchModule("hidden");
    await publish("Modul ausgeblendet");
    expect(await notificationCounts()).toMatchObject({
      notifications: 0,
      emails: 0,
      fulfilled: 0,
      active: 1,
    });
    await page.goto(`/academy/courses/${slug}`);
    await expect(page.getByText(lessonTitle, { exact: true })).toHaveCount(0);

    await patchModule("visible");
    await publish("Modul wieder sichtbar und Lektion weiter kommend");
    await patchLesson({ visibility: "draft" });
    await publish("Lektion als Entwurf");
    expect(await notificationCounts()).toMatchObject({
      notifications: 0,
      emails: 0,
      fulfilled: 0,
      active: 1,
    });
    await patchLesson({ visibility: "coming_soon" });
    await publish("Lektion wieder vorgemerkt");
    expect((await notificationCounts()).notifications).toBe(0);

    await setCourseDraft();
    await patchLesson({ visibility: "visible" });
    await publish("Lektion final freigegeben");
    expect(await notificationCounts()).toMatchObject({
      notifications: 1,
      emails: 1,
      fulfilled: 1,
      active: 0,
    });

    await patchLesson({ summary: "Nach der Freigabe aktualisiert." });
    await publish("Normale Aktualisierung nach Freigabe");
    expect(await notificationCounts()).toMatchObject({
      notifications: 1,
      emails: 1,
      fulfilled: 1,
      active: 0,
    });

    await page.goto(`/academy/courses/${slug}`);
    await expect(page.getByText(lessonTitle, { exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Bei Lektionsfreigabe benachrichtigen" }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: /Benachrichtigungen/ }).click();
    const notificationDialog = page.getByRole("dialog", {
      name: "Benachrichtigungen",
    });
    await expect(notificationDialog).toBeVisible();
    await expect(
      notificationDialog.getByText("Neue Lektion verfuegbar", { exact: true }),
    ).toHaveCount(1);

    const fulfilledList = await request.get(
      `/api/v1/lesson-availability-subscriptions?userId=${memberId}&courseId=${courseId}&lessonId=${lessonId}&status=fulfilled`,
      { headers },
    );
    expect(fulfilledList.status()).toBe(200);
    const fulfilledBody = await fulfilledList.json();
    expect(fulfilledBody.data).toHaveLength(1);
    expect(fulfilledBody.data[0]).toMatchObject({
      userId: memberId,
      courseId,
      lessonId,
      status: "fulfilled",
    });
  } finally {
    if (courseId) {
      await sql`
        delete from lesson_availability_subscriptions
        where course_id = ${courseId}
      `;
      await sql`
        delete from notifications
        where user_id = ${memberId}
          and type = 'lesson_available'
          and created_at >= ${startedAt}
      `;
      await sql`
        delete from email_deliveries
        where organization_id = ${organizationId}
          and user_id = ${memberId}
          and event = 'lesson.available'
          and created_at >= ${startedAt}
      `;
      await sql`delete from courses where id = ${courseId}`;
    }
    if (moduleId) await sql`delete from modules where id = ${moduleId}`;
    if (apiKeyId) await sql`delete from api_keys where id = ${apiKeyId}`;
    if (foreignOrganizationId) {
      await sql`delete from organizations where id = ${foreignOrganizationId}`;
    }
    await sql.end();
  }
});
