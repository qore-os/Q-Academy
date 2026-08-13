import { randomUUID } from "node:crypto";

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
const apiKey =
  process.env.DEMO_API_KEY ?? "qak_demo_qacademy_2026_local_development";
const authorization = { Authorization: `Bearer ${apiKey}` };

function mutationHeaders(key: string) {
  return { ...authorization, "Idempotency-Key": key };
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

async function closeContext(context: BrowserContext | null) {
  if (context) await context.close().catch(() => undefined);
}

test("course information is ordered, tenant-safe, snapshot-stable, and hidden only from discovery", async ({
  browser,
  request,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Desktop lifecycle runs once.");
  test.setTimeout(180_000);
  const client = postgres(databaseUrl, { prepare: false });
  const suffix = randomUUID().slice(0, 8);
  const title = `Informationskurs ${suffix}`;
  const slug = `informationskurs-${suffix}`;
  const firstGoal = `Grundlagen anwenden ${suffix}`;
  const leadingGoal = `Ergebnisse pruefen ${suffix}`;
  const draftGoal = `Risiken dokumentieren ${suffix}`;
  const apiPrefix = `course-information-${suffix}`;
  const requestIds: string[] = [];
  let organizationId = "";
  let ownerId = "";
  let trainerId = "";
  let memberId = "";
  let courseId = "";
  let cloneId = "";
  let foreignOrganizationId = "";
  let foreignUserId = "";
  let adminContext: BrowserContext | null = null;
  let memberContext: BrowserContext | null = null;

  try {
    const [fixture] = await client<
      Array<{
        organization_id: string;
        owner_id: string;
        trainer_id: string;
        member_id: string;
        password_hash: string;
      }>
    >`
      select
        owner.organization_id,
        owner.id as owner_id,
        trainer.id as trainer_id,
        member.id as member_id,
        owner.password_hash
      from users owner
      join users trainer
        on trainer.organization_id = owner.organization_id
       and trainer.email = 'marco@q-academy.de'
      join users member
        on member.organization_id = owner.organization_id
       and member.email = 'lea@q-academy.de'
      where owner.email = 'admin@q-academy.de'
      limit 1
    `;
    expect(fixture).toBeTruthy();
    organizationId = fixture.organization_id;
    ownerId = fixture.owner_id;
    trainerId = fixture.trainer_id;
    memberId = fixture.member_id;

    const [course] = await client<Array<{ id: string }>>`
      insert into courses (
        organization_id, title, slug, short_description, description,
        status, difficulty, estimated_minutes, certificate_enabled,
        visible_in_catalog, show_progress_percentage, created_by_id
      ) values (
        ${organizationId}, ${title}, ${slug},
        'Geordnete Kursinformationen fuer den Mitgliederbereich.',
        'Dieser Kurs prueft Lernziele, Kursleitung und die kontrollierte Sichtbarkeit.',
        'draft', 'Praxis', 45, false, true, true, ${ownerId}
      )
      returning id
    `;
    courseId = course.id;
    const [enrollment] = await client<Array<{ id: string }>>`
      insert into enrollments (user_id, course_id, progress, access_active)
      values (${memberId}, ${courseId}, 43, true)
      returning id
    `;
    await client`
      insert into course_access_grants (
        organization_id, user_id, course_id, source
      ) values (
        ${organizationId}, ${memberId}, ${courseId}, ${`direct:${enrollment.id}`}
      )
    `;

    const [foreignOrganization] = await client<Array<{ id: string }>>`
      insert into organizations (name, slug)
      values (
        ${`Foreign course information ${suffix}`},
        ${`foreign-course-information-${suffix}`}
      )
      returning id
    `;
    foreignOrganizationId = foreignOrganization.id;
    const [foreignUser] = await client<Array<{ id: string }>>`
      insert into users (
        organization_id, email, password_hash, first_name, last_name,
        role, status
      ) values (
        ${foreignOrganizationId}, ${`author-${suffix}@example.test`},
        ${fixture.password_hash}, 'Foreign', 'Author', 'trainer', 'active'
      )
      returning id
    `;
    foreignUserId = foreignUser.id;

    await expect(
      client`
        insert into course_authors (
          organization_id, course_id, user_id, sort_order
        ) values (${organizationId}, ${courseId}, ${foreignUserId}, 0)
      `,
    ).rejects.toThrow();

    adminContext = await browser.newContext();
    memberContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    const memberPage = await memberContext.newPage();
    await login(adminPage, "admin");
    await adminPage.goto(`/admin/courses/${courseId}`);
    await adminPage.getByRole("tab", { name: "Information" }).click();

    await adminPage
      .getByRole("button", { name: "Lernziel hinzufügen" })
      .click();
    await adminPage.getByLabel("Lernziel 1", { exact: true }).fill(firstGoal);
    await adminPage
      .getByRole("button", { name: "Lernziel hinzufügen" })
      .click();
    await adminPage
      .getByLabel("Lernziel 2", { exact: true })
      .fill(leadingGoal);
    await adminPage
      .getByRole("button", { name: "Lernziel 2 nach oben" })
      .click();

    const authorSelect = adminPage.getByLabel("Teammitglied als Kursautor");
    await authorSelect.selectOption(ownerId);
    await adminPage
      .getByRole("button", { name: "Kursautor hinzufügen" })
      .click();
    await authorSelect.selectOption(trainerId);
    await adminPage
      .getByRole("button", { name: "Kursautor hinzufügen" })
      .click();
    await adminPage
      .getByRole("button", { name: "Marco Stein nach oben" })
      .click();
    await adminPage.getByRole("button", { name: "Speichern" }).click();
    await expect(
      adminPage.getByText("Kursinformationen gespeichert."),
    ).toBeVisible();

    const detailResponse = await request.get(`/api/v1/courses/${courseId}`, {
      headers: authorization,
    });
    requestIds.push(detailResponse.headers()["x-request-id"]);
    expect(detailResponse.status()).toBe(200);
    const detail = (await detailResponse.json()).data as {
      status: string;
      visibleInCatalog: boolean;
      showProgressPercentage: boolean;
      learningGoals: Array<{ text: string; sortOrder: number }>;
      authors: Array<{ userId: string; sortOrder: number }>;
    };
    expect(detail).toMatchObject({
      status: "draft",
      visibleInCatalog: true,
      showProgressPercentage: true,
    });
    expect(detail.learningGoals.map((goal) => goal.text)).toEqual([
      leadingGoal,
      firstGoal,
    ]);
    expect(detail.authors.map((author) => author.userId)).toEqual([
      trainerId,
      ownerId,
    ]);

    const listResponse = await request.get(
      `/api/v1/courses?search=${encodeURIComponent(title)}`,
      { headers: authorization },
    );
    requestIds.push(listResponse.headers()["x-request-id"]);
    expect(listResponse.status()).toBe(200);
    await expect(listResponse.json()).resolves.toMatchObject({
      data: [
        {
          id: courseId,
          visibleInCatalog: true,
          showProgressPercentage: true,
        },
      ],
    });

    const minimalPatch = await request.patch(`/api/v1/courses/${courseId}`, {
      headers: mutationHeaders(`${apiPrefix}-minimal-patch`),
      data: { difficulty: "Fortgeschritten" },
    });
    requestIds.push(minimalPatch.headers()["x-request-id"]);
    expect(minimalPatch.status()).toBe(200);
    const afterMinimalResponse = await request.get(
      `/api/v1/courses/${courseId}`,
      { headers: authorization },
    );
    requestIds.push(afterMinimalResponse.headers()["x-request-id"]);
    const afterMinimal = (await afterMinimalResponse.json()).data as typeof detail;
    expect(afterMinimal).toMatchObject({
      status: "draft",
      visibleInCatalog: true,
      showProgressPercentage: true,
    });
    expect(afterMinimal.learningGoals.map((goal) => goal.text)).toEqual([
      leadingGoal,
      firstGoal,
    ]);
    expect(afterMinimal.authors.map((author) => author.userId)).toEqual([
      trainerId,
      ownerId,
    ]);

    const foreignAuthorPatch = await request.patch(
      `/api/v1/courses/${courseId}`,
      {
        headers: mutationHeaders(`${apiPrefix}-foreign-author`),
        data: { authorIds: [foreignUserId] },
      },
    );
    requestIds.push(foreignAuthorPatch.headers()["x-request-id"]);
    expect(foreignAuthorPatch.status()).toBe(422);
    const [authorsAfterRejectedPatch] = await client<
      Array<{ author_ids: string[] }>
    >`
      select array_agg(user_id order by sort_order, id) as author_ids
      from course_authors
      where organization_id = ${organizationId} and course_id = ${courseId}
    `;
    expect(authorsAfterRejectedPatch.author_ids).toEqual([trainerId, ownerId]);

    await adminPage.getByRole("button", { name: "Kurs veröffentlichen" }).click();
    await expect(
      adminPage.getByRole("button", { name: "Änderungen veröffentlichen" }),
    ).toBeVisible();
    await expect
      .poll(async () => {
        const [row] = await client<Array<{ version_count: number }>>`
          select count(cv.id)::int as version_count
          from courses c
          left join course_versions cv on cv.course_id = c.id
          where c.id = ${courseId} and c.status = 'published'
        `;
        return row.version_count;
      })
      .toBe(1);

    await login(memberPage, "member");
    await memberPage.goto("/academy/courses");
    const publishedCard = memberPage.locator(
      `a[href="/academy/courses/${slug}"]`,
    );
    await expect(publishedCard).toBeVisible();
    await expect(publishedCard.getByText("0%", { exact: true })).toBeVisible();
    await memberPage.goto(`/academy/courses/${slug}`);
    await expect(
      memberPage.getByRole("heading", { name: "Das lernst du" }),
    ).toBeVisible();
    await expect(memberPage.getByText(leadingGoal, { exact: true })).toBeVisible();
    await expect(memberPage.getByText(firstGoal, { exact: true })).toBeVisible();
    await expect(
      memberPage.getByRole("main").getByText("Marco Stein", { exact: true }),
    ).toBeVisible();
    await expect(
      memberPage.getByRole("main").getByText("Anna Berger", { exact: true }),
    ).toBeVisible();
    await expect(memberPage.getByText("0%", { exact: true })).toBeVisible();

    await adminPage.getByRole("tab", { name: "Information" }).click();
    await adminPage.getByLabel("Lernziel 1", { exact: true }).fill(draftGoal);
    await adminPage
      .getByLabel("In Mitglieder-Kursuebersicht anzeigen")
      .uncheck();
    await adminPage.getByLabel("Prozentualen Fortschritt anzeigen").uncheck();
    await adminPage.getByRole("button", { name: "Speichern" }).click();
    await expect(
      adminPage.getByText("Kursinformationen gespeichert."),
    ).toBeVisible();
    await expect
      .poll(async () => {
        const [row] = await client<
          Array<{ visible: boolean; progress: boolean; first_goal: string }>
        >`
          select
            c.visible_in_catalog as visible,
            c.show_progress_percentage as progress,
            (
              select text from course_learning_goals
              where course_id = c.id order by sort_order, id limit 1
            ) as first_goal
          from courses c where c.id = ${courseId}
        `;
        return row;
      })
      .toEqual({ visible: false, progress: false, first_goal: draftGoal });

    await memberPage.reload();
    await expect(memberPage.getByText(leadingGoal, { exact: true })).toBeVisible();
    await expect(memberPage.getByText(draftGoal, { exact: true })).toBeHidden();
    await expect(memberPage.getByText("0%", { exact: true })).toBeVisible();
    await memberPage.goto("/academy/courses");
    await expect(publishedCard).toBeVisible();
    await memberPage.goto("/academy");
    await expect(memberPage.getByText(title, { exact: true })).toBeVisible();

    await adminPage
      .getByRole("button", { name: "Änderungen veröffentlichen" })
      .click();
    await expect
      .poll(async () => {
        const [row] = await client<
          Array<{ version_count: number; visible: boolean }>
        >`
          select
            (select count(*)::int from course_versions where course_id = c.id)
              as version_count,
            (cv.snapshot -> 'course' ->> 'visibleInCatalog')::boolean as visible
          from courses c
          join course_versions cv on cv.id = c.published_version_id
          where c.id = ${courseId}
        `;
        return row;
      })
      .toEqual({ version_count: 2, visible: false });

    await memberPage.goto("/academy/courses");
    await expect(memberPage.getByText(title, { exact: true })).toBeHidden();
    await memberPage.goto("/academy");
    await expect(memberPage.getByText(title, { exact: true })).toBeHidden();
    const searchResponse = await memberPage.request.get(
      `/api/navigation-search?q=${encodeURIComponent(title)}&mode=member`,
    );
    expect(searchResponse.status()).toBe(200);
    const searchBody = (await searchResponse.json()) as {
      data: Array<{ id: string; kind: string }>;
    };
    expect(
      searchBody.data.some(
        (result) => result.kind === "course" && result.id === courseId,
      ),
    ).toBe(false);

    await memberPage.goto(`/academy/courses/${slug}`);
    await expect(memberPage.getByRole("heading", { name: title })).toBeVisible();
    await expect(memberPage.getByText(draftGoal, { exact: true })).toBeVisible();
    await expect(memberPage.getByText(leadingGoal, { exact: true })).toBeHidden();
    await expect(memberPage.getByText("0%", { exact: true })).toBeHidden();

    const [snapshot] = await client<
      Array<{
        schema_version: number;
        visible_in_catalog: boolean;
        show_progress_percentage: boolean;
        goal_texts: string[];
        author_ids: string[];
      }>
    >`
      select
        (cv.snapshot ->> 'schemaVersion')::int as schema_version,
        (cv.snapshot -> 'course' ->> 'visibleInCatalog')::boolean
          as visible_in_catalog,
        (cv.snapshot -> 'course' ->> 'showProgressPercentage')::boolean
          as show_progress_percentage,
        array(
          select goal ->> 'text'
          from jsonb_array_elements(cv.snapshot -> 'learningGoals') goal
        ) as goal_texts,
        array(
          select author ->> 'userId'
          from jsonb_array_elements(cv.snapshot -> 'authors') author
        ) as author_ids
      from courses c
      join course_versions cv on cv.id = c.published_version_id
      where c.id = ${courseId}
    `;
    expect(snapshot).toEqual({
      schema_version: 6,
      visible_in_catalog: false,
      show_progress_percentage: false,
      goal_texts: [draftGoal, firstGoal],
      author_ids: [trainerId, ownerId],
    });

    const cloneResponse = await request.post(`/api/v1/courses/${courseId}/clone`, {
      headers: mutationHeaders(`${apiPrefix}-clone`),
      data: { title: `${title} Kopie` },
    });
    requestIds.push(cloneResponse.headers()["x-request-id"]);
    expect(cloneResponse.status()).toBe(201);
    cloneId = ((await cloneResponse.json()).data as { id: string }).id;
    const cloneDetailResponse = await request.get(
      `/api/v1/courses/${cloneId}`,
      { headers: authorization },
    );
    requestIds.push(cloneDetailResponse.headers()["x-request-id"]);
    expect(cloneDetailResponse.status()).toBe(200);
    const cloneDetail = (await cloneDetailResponse.json()).data as typeof detail;
    expect(cloneDetail).toMatchObject({
      status: "draft",
      visibleInCatalog: false,
      showProgressPercentage: false,
    });
    expect(cloneDetail.learningGoals.map((goal) => goal.text)).toEqual([
      draftGoal,
      firstGoal,
    ]);
    expect(cloneDetail.authors.map((author) => author.userId)).toEqual([
      trainerId,
      ownerId,
    ]);

    const [evidence] = await client<
      Array<{ activity_count: number; audit_count: number }>
    >`
      select
        (select count(*)::int from activity_events
          where organization_id = ${organizationId}
            and entity_id = ${courseId}
            and type = 'course.information.updated') as activity_count,
        (select count(*)::int from api_audit_logs
          where request_id = any(${requestIds}::uuid[])) as audit_count
    `;
    expect(evidence.activity_count).toBeGreaterThanOrEqual(3);
    expect(evidence.audit_count).toBe(requestIds.length);
  } finally {
    await closeContext(adminContext);
    await closeContext(memberContext);
    if (requestIds.length) {
      await client`
        delete from api_audit_logs
        where request_id = any(${requestIds}::uuid[])
      `;
    }
    if (organizationId) {
      await client`
        delete from api_idempotency_keys
        where organization_id = ${organizationId}
          and key like ${`${apiPrefix}%`}
      `;
    }
    if (cloneId) await client`delete from courses where id = ${cloneId}`;
    if (courseId) {
      await client`
        delete from activity_events
        where entity_id = ${courseId}
           or metadata ->> 'courseId' = ${courseId}
      `;
      await client`delete from courses where id = ${courseId}`;
    }
    if (foreignOrganizationId) {
      await client`delete from organizations where id = ${foreignOrganizationId}`;
    }
    await client.end();
  }
});

test("course information controls and member details fit the mobile viewport", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "Mobile-only viewport audit.");
  test.setTimeout(120_000);
  const client = postgres(databaseUrl, { prepare: false });
  const suffix = randomUUID().slice(0, 8);
  const title = `Mobile Kursinfo ${suffix}`;
  const slug = `mobile-kursinfo-${suffix}`;
  const goal = `Mobile Lernziele sicher darstellen ${suffix}`;
  let courseId = "";

  try {
    const [fixture] = await client<
      Array<{ organization_id: string; owner_id: string; member_id: string }>
    >`
      select
        owner.organization_id,
        owner.id as owner_id,
        member.id as member_id
      from users owner
      join users member
        on member.organization_id = owner.organization_id
       and member.email = 'lea@q-academy.de'
      where owner.email = 'admin@q-academy.de'
      limit 1
    `;
    const [course] = await client<Array<{ id: string }>>`
      insert into courses (
        organization_id, title, slug, short_description, description,
        status, visible_in_catalog, show_progress_percentage, created_by_id
      ) values (
        ${fixture.organization_id}, ${title}, ${slug},
        'Mobile Kursinformationen ohne horizontalen Ueberlauf.',
        'Lernziel und Kursleitung bleiben auf kleinen Viewports vollstaendig nutzbar.',
        'draft', true, false, ${fixture.owner_id}
      ) returning id
    `;
    courseId = course.id;
    const [enrollment] = await client<Array<{ id: string }>>`
      insert into enrollments (user_id, course_id, access_active)
      values (${fixture.member_id}, ${courseId}, true)
      returning id
    `;
    await client`
      insert into course_access_grants (
        organization_id, user_id, course_id, source
      ) values (
        ${fixture.organization_id}, ${fixture.member_id}, ${courseId},
        ${`direct:${enrollment.id}`}
      )
    `;
    await client`
      insert into course_learning_goals (
        organization_id, course_id, text, sort_order
      ) values (${fixture.organization_id}, ${courseId}, ${goal}, 0)
    `;
    await client`
      insert into course_authors (
        organization_id, course_id, user_id, sort_order
      ) values (${fixture.organization_id}, ${courseId}, ${fixture.owner_id}, 0)
    `;

    await login(page, "admin");
    await page.goto(`/admin/courses/${courseId}`);
    await page.getByRole("tab", { name: "Information" }).click();
    await expect(page.getByLabel("Lernziel 1", { exact: true })).toHaveValue(
      goal,
    );
    await expect(
      page.getByRole("main").getByText("Anna Berger", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByLabel("Prozentualen Fortschritt anzeigen"),
    ).not.toBeChecked();
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(1);

    await page.getByRole("button", { name: "Kurs veröffentlichen" }).click();
    await expect(
      page.getByRole("button", { name: "Änderungen veröffentlichen" }),
    ).toBeVisible();
    await expect
      .poll(async () => {
        const [row] = await client<Array<{ published: boolean }>>`
          select published_version_id is not null as published
          from courses where id = ${courseId}
        `;
        return row.published;
      })
      .toBe(true);

    await page.context().clearCookies();
    await login(page, "member");
    await page.goto(`/academy/courses/${slug}`);
    await expect(page.getByText(goal, { exact: true })).toBeVisible();
    await expect(
      page.getByRole("main").getByText("Anna Berger", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("0%", { exact: true })).toBeHidden();
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(1);
    await page.screenshot({
      path: testInfo.outputPath("course-information-mobile.png"),
      fullPage: true,
    });
  } finally {
    if (courseId) {
      await client`
        delete from activity_events
        where entity_id = ${courseId}
           or metadata ->> 'courseId' = ${courseId}
      `;
      await client`delete from courses where id = ${courseId}`;
    }
    await client.end();
  }
});
