import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { completeMemberWelcomeIfVisible } from "./helpers/member-welcome";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";

async function loginAsMember(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: /Lernenden-Demo|Als Mitglied testen/ }).click();
  await page.waitForURL("**/academy");
  await completeMemberWelcomeIfVisible(page);
}

async function loginAsAdmin(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: /Admin-Demo|Als Admin testen/ }).click();
  await page.waitForURL("**/admin");
}

test("trainer admin search exposes only assigned courses with permission-safe links", async ({
  request,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "API-only ACL integration runs once");
  const client = postgres(databaseUrl, { max: 1, prepare: false });
  const suffix = randomUUID().slice(0, 8);
  const trainerEmail = `search-trainer-${suffix}@example.test`;
  const assignedTitle = `Assigned Search Course ${suffix}`;
  const hiddenTitle = `Hidden Search Course ${suffix}`;
  let trainerId = "";
  let assignedCourseId = "";
  let hiddenCourseId = "";

  try {
    const [fixture] = await client<
      Array<{
        organizationId: string;
        organizationSlug: string;
        ownerId: string;
        passwordHash: string;
      }>
    >`
      select
        owner.organization_id as "organizationId",
        organization.slug as "organizationSlug",
        owner.id as "ownerId",
        password_source.password_hash as "passwordHash"
      from users owner
      join organizations organization on organization.id = owner.organization_id
      cross join users password_source
      where owner.email = 'admin@q-academy.de'
        and password_source.email = 'lea@q-academy.de'
      limit 1
    `;
    expect(fixture).toBeTruthy();
    const [trainer] = await client<Array<{ id: string }>>`
      insert into users (
        organization_id, email, password_hash, first_name, last_name, role, status
      ) values (
        ${fixture.organizationId}, ${trainerEmail}, ${fixture.passwordHash},
        'Search', 'Trainer', 'trainer', 'active'
      )
      returning id
    `;
    trainerId = trainer.id;
    const createdCourses = await client<Array<{ id: string; title: string }>>`
      insert into courses (
        organization_id, title, slug, short_description, description, status,
        created_by_id
      ) values
        (
          ${fixture.organizationId}, ${assignedTitle},
          ${`assigned-search-${suffix}`}, 'Explizit zugewiesener Suchkurs.',
          'Dieser Kurs darf in der Trainersuche erscheinen.', 'draft',
          ${fixture.ownerId}
        ),
        (
          ${fixture.organizationId}, ${hiddenTitle},
          ${`hidden-search-${suffix}`}, 'Nicht zugewiesener Suchkurs.',
          'Dieser Kurs darf nicht an den Trainer offengelegt werden.', 'draft',
          ${fixture.ownerId}
        )
      returning id, title
    `;
    assignedCourseId = createdCourses.find(
      (course) => course.title === assignedTitle,
    )!.id;
    hiddenCourseId = createdCourses.find(
      (course) => course.title === hiddenTitle,
    )!.id;
    await client`
      insert into course_collaborators (
        organization_id, course_id, user_id, permission, granted_by_id
      ) values (
        ${fixture.organizationId}, ${assignedCourseId}, ${trainerId}, 'view',
        ${fixture.ownerId}
      )
    `;

    const login = await request.post("/api/v1/auth/login", {
      data: {
        organizationSlug: fixture.organizationSlug,
        email: trainerEmail,
        password: "Demo123!",
      },
    });
    expect(login.status()).toBe(200);

    const assignedResponse = await request.get(
      `/api/navigation-search?q=${encodeURIComponent(assignedTitle)}&mode=admin`,
    );
    expect(assignedResponse.status()).toBe(200);
    const assignedBody = (await assignedResponse.json()) as {
      data: Array<{ id: string; kind: string; href: string }>;
    };
    expect(assignedBody.data).toContainEqual(
      expect.objectContaining({
        id: assignedCourseId,
        kind: "course",
        href: `/admin/courses/${assignedCourseId}/preview`,
      }),
    );

    const hiddenResponse = await request.get(
      `/api/navigation-search?q=${encodeURIComponent(hiddenTitle)}&mode=admin`,
    );
    const hiddenBody = (await hiddenResponse.json()) as {
      data: Array<{ id: string }>;
    };
    expect(hiddenBody.data.some((result) => result.id === hiddenCourseId)).toBe(
      false,
    );

    await client`
      update course_collaborators
      set permission = 'edit', updated_at = now()
      where course_id = ${assignedCourseId} and user_id = ${trainerId}
    `;
    const editResponse = await request.get(
      `/api/navigation-search?q=${encodeURIComponent(assignedTitle)}&mode=admin`,
    );
    const editBody = (await editResponse.json()) as {
      data: Array<{ id: string; href: string }>;
    };
    expect(editBody.data).toContainEqual(
      expect.objectContaining({
        id: assignedCourseId,
        href: `/admin/courses/${assignedCourseId}`,
      }),
    );
  } finally {
    if (assignedCourseId || hiddenCourseId) {
      await client`
        delete from courses
        where id = any(${[assignedCourseId, hiddenCourseId].filter(Boolean)}::uuid[])
      `;
    }
    if (trainerId) await client`delete from users where id = ${trainerId}`;
    await client.end();
  }
});

test("admin search finds management records and supports keyboard dismissal", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "desktop search flow");
  await loginAsAdmin(page);

  for (const [query, expectedKind] of [
    ["KI-Grundlagen", "course"],
    ["Prompting Basics", "module"],
    ["Lea Hartmann", "member"],
    ["Prompt Lab", "community"],
    ["Lern-Dashboard", "hub"],
    ["KI-Sprechstunde", "event"],
  ] as const) {
    const response = await page.request.get(
      `/api/navigation-search?q=${encodeURIComponent(query)}&mode=admin`,
    );
    expect(response.status(), query).toBe(200);
    const body = (await response.json()) as {
      data: Array<{ kind: string }>;
    };
    expect(
      body.data.some((result) => result.kind === expectedKind),
      `${query} should return ${expectedKind}`,
    ).toBe(true);
  }

  await page.getByRole("button", { name: "Globale Suche oeffnen" }).click();
  const dialog = page.getByRole("dialog", { name: "Globale Suche" });
  await expect(dialog).toBeVisible();

  await dialog.getByLabel("Globale Suche").fill("Lea Hartmann");
  await expect(
    dialog.getByRole("heading", { name: "Mitglieder" }),
  ).toBeVisible();
  const memberLink = dialog.getByRole("link", { name: /Lea Hartmann/ });
  await expect(memberLink).toHaveAttribute("href", /^\/admin\/members\//);

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Globale Suche oeffnen" }),
  ).toBeFocused();

  await page.keyboard.press("Control+k");
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Globale Suche").fill("Prompting Basics");
  await expect(
    dialog.getByRole("link", { name: /Prompting Basics/ }),
  ).toHaveAttribute("href", /^\/admin\/modules#module-/);
});

test("member search exposes only member-visible targets", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "desktop access flow");
  await loginAsMember(page);

  const forbiddenResponse = await page.request.get(
    "/api/navigation-search?q=Lea&mode=admin",
  );
  expect(forbiddenResponse.status()).toBe(403);

  await page.getByRole("button", { name: "Globale Suche oeffnen" }).click();
  const dialog = page.getByRole("dialog", { name: "Globale Suche" });
  const input = dialog.getByLabel("Globale Suche");
  await input.fill("KI-Grundlagen");
  await expect(
    dialog.getByRole("link", { name: /KI-Grundlagen/ }),
  ).toHaveAttribute("href", "/academy/courses/ki-grundlagen");

  await input.fill("AI Leadership");
  await expect(dialog.getByText(/Keine Treffer fuer/)).toBeVisible();

  const memberResponse = await page.request.get(
    "/api/navigation-search?q=Lea&mode=member",
  );
  expect(memberResponse.status()).toBe(200);
  const memberBody = (await memberResponse.json()) as {
    data: Array<{ kind: string }>;
  };
  expect(memberBody.data.every((result) => result.kind !== "member")).toBe(
    true,
  );

  for (const [query, expectedKind] of [
    ["KI-Grundlagen", "course"],
    ["Prompt Lab", "community"],
    ["Lern-Dashboard", "hub"],
    ["KI-Sprechstunde", "event"],
  ] as const) {
    const response = await page.request.get(
      `/api/navigation-search?q=${encodeURIComponent(query)}&mode=member`,
    );
    const body = (await response.json()) as {
      data: Array<{ kind: string }>;
    };
    expect(response.status(), query).toBe(200);
    expect(
      body.data.some((result) => result.kind === expectedKind),
      `${query} should return ${expectedKind}`,
    ).toBe(true);
  }

  const client = postgres(databaseUrl, { max: 1, prepare: false });
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  let hiddenCourseId: string | null = null;
  try {
    const [hiddenCourse] = await client<{ id: string }[]>`
      insert into courses (
        organization_id, title, slug, short_description, description, status
      )
      select
        organization_id,
        ${`Unzugewiesener Suchkurs ${suffix}`},
        ${`unzugewiesener-suchkurs-${suffix}`},
        'Nur fuer den Zugriffstest.',
        'Dieser veroeffentlichte Kurs hat keine Einschreibung.',
        'published'
      from users
      where email = 'lea@q-academy.de'
      returning id
    `;
    hiddenCourseId = hiddenCourse.id;

    const inaccessibleCourseResponse = await page.request.get(
      `/api/navigation-search?q=${encodeURIComponent(`Unzugewiesener Suchkurs ${suffix}`)}&mode=member`,
    );
    const inaccessibleCourseBody =
      (await inaccessibleCourseResponse.json()) as {
        data: Array<{ id: string; kind: string }>;
      };
    expect(
      inaccessibleCourseBody.data.some(
        (result) => result.kind === "course" && result.id === hiddenCourse.id,
      ),
    ).toBe(false);
  } finally {
    if (hiddenCourseId) {
      await client`delete from courses where id = ${hiddenCourseId}`;
    }
    await client.end();
  }
});

test("mobile search stays within the viewport and opens a result", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "mobile search flow");
  await loginAsMember(page);

  await page.getByRole("button", { name: "Globale Suche oeffnen" }).click();
  const dialog = page.getByRole("dialog", { name: "Globale Suche" });
  await expect(dialog).toBeVisible();
  const box = await dialog.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(
    page.viewportSize()!.width + 1,
  );

  await dialog.getByLabel("Globale Suche").fill("Responsible AI");
  const courseLink = dialog.getByRole("link", { name: /Responsible AI/ });
  await expect(courseLink).toBeVisible();
  await courseLink.click();
  await page.waitForURL("**/academy/courses/responsible-ai-dsgvo");
  await expect(
    page.getByRole("heading", { name: "Responsible AI & DSGVO" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(1);
});
