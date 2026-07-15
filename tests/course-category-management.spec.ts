import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  expect,
  test,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import postgres from "postgres";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";
const demoKey =
  process.env.DEMO_API_KEY ??
  "qak_demo_qacademy_2026_local_development";
const authorization = { Authorization: `Bearer ${demoKey}` };

function hashSecret(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function mutationHeaders(idempotencyKey: string) {
  return {
    ...authorization,
    "Idempotency-Key": idempotencyKey,
  };
}

async function loginAsOwner(page: Page) {
  await page.goto("/login");
  await page
    .getByRole("button", { name: /Admin-Demo|Als Admin testen/ })
    .click();
  await page.waitForURL("**/admin");
}

async function loginWithPassword(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("E-Mail-Adresse").fill(email);
  await page.getByLabel("Passwort", { exact: true }).fill("Demo123!");
  await page.getByRole("button", { name: /anmelden$/i }).click();
  await page.waitForURL("**/admin");
}

async function createCategoryInUi(
  page: Page,
  input: { name: string; description: string; color: string },
) {
  await page.getByRole("button", { name: "Kategorie anlegen" }).click();
  const dialog = page.getByRole("dialog", { name: "Kategorie anlegen" });
  await dialog.getByLabel("Name").fill(input.name);
  await dialog.getByLabel("Beschreibung").fill(input.description);
  await dialog
    .getByLabel("Kategoriefarbe als Hex-Wert")
    .fill(input.color);
  await dialog
    .getByRole("button", { name: "Kategorie anlegen" })
    .click();
  await expect(dialog).toBeHidden();
  await expect(
    page.getByRole("button", { name: `${input.name} bearbeiten` }),
  ).toBeVisible();
}

async function closeContext(context: BrowserContext | null) {
  if (context) await context.close().catch(() => undefined);
}

test("course categories are manageable, permission-bound, atomic, and tenant-safe", async ({
  browser,
  page,
  request,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium",
    "The category lifecycle and API boundary run once on desktop Chromium.",
  );
  test.setTimeout(180_000);
  const client = postgres(databaseUrl, { max: 1, prepare: false });
  const suffix = randomUUID().slice(0, 8);
  const firstName = `E2E Kategorie A ${suffix}`;
  const editedFirstName = `E2E Kategorie A aktualisiert ${suffix}`;
  const secondName = `E2E Kategorie B ${suffix}`;
  const customName = `E2E Custom Kategorie ${suffix}`;
  const customEmail = `category-custom-${suffix}@example.test`;
  const deniedEmail = `category-denied-${suffix}@example.test`;
  const foreignSlug = `category-foreign-${suffix}`;
  const limitedSecret = `qak_test_${randomBytes(28).toString("base64url")}`;
  const requestIds: string[] = [];
  const categoryIds: string[] = [];
  let organizationId = "";
  let ownerId = "";
  let courseId = "";
  let customUserId = "";
  let deniedUserId = "";
  let customRoleId = "";
  let foreignOrganizationId = "";
  let foreignCategoryId = "";
  let limitedKeyId = "";
  let customContext: BrowserContext | null = null;
  let deniedContext: BrowserContext | null = null;

  try {
    const [fixture] = await client<
      Array<{
        organization_id: string;
        owner_id: string;
        password_hash: string;
      }>
    >`
      select
        owner.organization_id,
        owner.id as owner_id,
        owner.password_hash
      from users owner
      where owner.email = 'admin@q-academy.de'
      limit 1
    `;
    expect(fixture).toBeTruthy();
    organizationId = fixture.organization_id;
    ownerId = fixture.owner_id;

    const [course] = await client<Array<{ id: string }>>`
      insert into courses (
        organization_id, title, slug, short_description, description,
        status, created_by_id
      ) values (
        ${organizationId}, ${`Kategorie Kurs ${suffix}`},
        ${`kategorie-kurs-${suffix}`}, 'Kategoriebelegung im E2E-Test.',
        'Der Kurs bleibt beim Loeschen seiner Kategorie vollstaendig erhalten.',
        'draft', ${ownerId}
      )
      returning id
    `;
    courseId = course.id;

    const users = await client<Array<{ id: string; email: string }>>`
      insert into users (
        organization_id, email, password_hash, first_name, last_name,
        role, status
      ) values
        (
          ${organizationId}, ${customEmail}, ${fixture.password_hash},
          'Custom', 'Kategorien', 'trainer', 'active'
        ),
        (
          ${organizationId}, ${deniedEmail}, ${fixture.password_hash},
          'Ohne', 'Kategorienrolle', 'trainer', 'active'
        )
      returning id, email
    `;
    customUserId = users.find((user) => user.email === customEmail)!.id;
    deniedUserId = users.find((user) => user.email === deniedEmail)!.id;
    const [customRole] = await client<Array<{ id: string }>>`
      insert into team_roles (
        organization_id, name, description, permissions, created_by_id
      ) values (
        ${organizationId}, ${`Kategorien ${suffix}`},
        'Darf Kurskategorien verwalten.',
        array['courses.view', 'courses.manage'], ${ownerId}
      )
      returning id
    `;
    customRoleId = customRole.id;
    await client`
      insert into team_role_assignments (
        organization_id, user_id, role_id, assigned_by_id
      ) values (
        ${organizationId}, ${customUserId}, ${customRoleId}, ${ownerId}
      )
    `;

    const [foreignOrganization] = await client<Array<{ id: string }>>`
      insert into organizations (name, slug)
      values (${`Foreign categories ${suffix}`}, ${foreignSlug})
      returning id
    `;
    foreignOrganizationId = foreignOrganization.id;
    const [foreignCategory] = await client<Array<{ id: string }>>`
      insert into course_categories (
        organization_id, name, slug, color, sort_order
      ) values (
        ${foreignOrganizationId}, 'Fremde Kategorie',
        ${`fremde-kategorie-${suffix}`}, '#ab4477', 17
      )
      returning id
    `;
    foreignCategoryId = foreignCategory.id;

    const [limitedKey] = await client<Array<{ id: string }>>`
      insert into api_keys (
        organization_id, name, prefix, key_hash, scopes, created_by_id
      ) values (
        ${organizationId}, ${`Category read only ${suffix}`},
        ${limitedSecret.slice(0, 20)}, ${hashSecret(limitedSecret)},
        array['courses:read'], ${ownerId}
      )
      returning id
    `;
    limitedKeyId = limitedKey.id;

    await loginAsOwner(page);
    await page.goto("/admin/courses");
    await expect(
      page.getByRole("heading", { name: "Kategorien verwalten" }),
    ).toBeVisible();

    await createCategoryInUi(page, {
      name: firstName,
      description: "Erste Kategorie fuer den E2E-Lebenszyklus.",
      color: "#237c73",
    });
    await createCategoryInUi(page, {
      name: secondName,
      description: "Zweite Kategorie fuer die Reihenfolge.",
      color: "#365f8d",
    });

    const created = await client<
      Array<{ id: string; name: string; sort_order: number }>
    >`
      select id, name, sort_order
      from course_categories
      where organization_id = ${organizationId}
        and name in (${firstName}, ${secondName})
      order by sort_order, name
    `;
    expect(created).toHaveLength(2);
    const firstCategoryId = created.find(
      (category) => category.name === firstName,
    )!.id;
    const secondCategoryId = created.find(
      (category) => category.name === secondName,
    )!.id;
    categoryIds.push(firstCategoryId, secondCategoryId);
    await client`
      update courses set category_id = ${firstCategoryId}
      where id = ${courseId} and organization_id = ${organizationId}
    `;
    // The fixture assignment bypasses the application and therefore its route
    // revalidation. A unique URL forces a fresh server read of the DB fixture.
    await page.goto(`/admin/courses?fixture=${suffix}`);

    await page
      .getByRole("button", { name: `${firstName} bearbeiten` })
      .click();
    const editDialog = page.getByRole("dialog", {
      name: "Kategorie bearbeiten",
    });
    await editDialog.getByLabel("Name").fill(editedFirstName);
    await editDialog
      .getByLabel("Beschreibung")
      .fill("Aktualisierte, weiterhin belegte Kategorie.");
    await editDialog
      .getByLabel("Kategoriefarbe als Hex-Wert")
      .fill("#8d6a12");
    await editDialog.getByRole("button", { name: "Speichern" }).click();
    await expect(editDialog).toBeHidden();
    await expect(
      page.getByRole("button", { name: `${editedFirstName} bearbeiten` }),
    ).toBeVisible();

    await page
      .getByRole("button", { name: `${secondName} nach oben verschieben` })
      .click();
    await expect
      .poll(async () => {
        const positions = await client<
          Array<{ id: string; sort_order: number }>
        >`
          select id, sort_order from course_categories
          where id in (${firstCategoryId}, ${secondCategoryId})
        `;
        const first = positions.find(
          (category) => category.id === firstCategoryId,
        );
        const second = positions.find(
          (category) => category.id === secondCategoryId,
        );
        return Boolean(
          first && second && second.sort_order < first.sort_order,
        );
      })
      .toBe(true);

    await page
      .getByRole("button", { name: `${editedFirstName} loeschen` })
      .click();
    const deleteDialog = page.getByRole("dialog", {
      name: "Kategorie loeschen",
    });
    await expect(deleteDialog).toContainText("1 Kurs");
    await expect(deleteDialog).toContainText("vollstaendig erhalten");
    await deleteDialog
      .getByRole("button", { name: "Endgueltig loeschen" })
      .click();
    await expect(deleteDialog).toBeHidden();

    const [preservedCourse] = await client<
      Array<{ category_id: string | null; title: string }>
    >`
      select category_id, title from courses where id = ${courseId}
    `;
    expect(preservedCourse).toMatchObject({
      category_id: null,
      title: `Kategorie Kurs ${suffix}`,
    });
    const [deletedCategory] = await client<Array<{ count: number }>>`
      select count(*)::int as count from course_categories
      where id = ${firstCategoryId}
    `;
    expect(deletedCategory.count).toBe(0);
    const [deleteAudit] = await client<
      Array<{ count: number; unassigned: number }>
    >`
      select
        count(*)::int as count,
        max((metadata ->> 'unassignedCourseCount')::int)::int as unassigned
      from activity_events
      where organization_id = ${organizationId}
        and type = 'course_category.deleted'
        and entity_id = ${firstCategoryId}
    `;
    expect(deleteAudit).toMatchObject({ count: 1, unassigned: 1 });

    customContext = await browser.newContext();
    const customPage = await customContext.newPage();
    await loginWithPassword(customPage, customEmail);
    await customPage.goto("/admin/courses");
    await expect(
      customPage.getByRole("heading", { name: "Kategorien verwalten" }),
    ).toBeVisible();
    await createCategoryInUi(customPage, {
      name: customName,
      description: "Von einer berechtigten Custom-Rolle erstellt.",
      color: "#b84e42",
    });
    const [customCategory] = await client<Array<{ id: string }>>`
      select id from course_categories
      where organization_id = ${organizationId} and name = ${customName}
    `;
    expect(customCategory).toBeTruthy();
    categoryIds.push(customCategory.id);

    deniedContext = await browser.newContext();
    const deniedPage = await deniedContext.newPage();
    await loginWithPassword(deniedPage, deniedEmail);
    await deniedPage.goto("/admin/courses");
    await expect(deniedPage.getByRole("heading", { name: "Kurse" })).toBeVisible();
    await expect(
      deniedPage.getByRole("heading", { name: "Kategorien verwalten" }),
    ).toHaveCount(0);
    await expect(
      deniedPage.getByRole("button", { name: "Kategorie anlegen" }),
    ).toHaveCount(0);

    const currentOrder = await client<Array<{ id: string }>>`
      select id from course_categories
      where organization_id = ${organizationId}
      order by sort_order, name, id
    `;
    const positiveReorder = await request.patch(
      "/api/v1/course-categories/reorder",
      {
        headers: mutationHeaders(`category-positive-${suffix}`),
        data: { categoryIds: currentOrder.map((category) => category.id) },
      },
    );
    requestIds.push(positiveReorder.headers()["x-request-id"]);
    expect(positiveReorder.status()).toBe(200);

    const limitedReorder = await request.patch(
      "/api/v1/course-categories/reorder",
      {
        headers: {
          Authorization: `Bearer ${limitedSecret}`,
          "Idempotency-Key": `category-limited-${suffix}`,
        },
        data: { categoryIds: currentOrder.map((category) => category.id) },
      },
    );
    requestIds.push(limitedReorder.headers()["x-request-id"]);
    expect(limitedReorder.status()).toBe(403);
    await expect(limitedReorder.json()).resolves.toMatchObject({
      code: "insufficient_scope",
    });

    const beforeForeignAttempt = await client<
      Array<{ id: string; sort_order: number }>
    >`
      select id, sort_order from course_categories
      where organization_id = ${organizationId}
      order by id
    `;
    const foreignReorder = await request.patch(
      "/api/v1/course-categories/reorder",
      {
        headers: mutationHeaders(`category-foreign-order-${suffix}`),
        data: {
          categoryIds: [
            ...currentOrder.slice(1).map((category) => category.id),
            foreignCategoryId,
          ],
        },
      },
    );
    requestIds.push(foreignReorder.headers()["x-request-id"]);
    expect(foreignReorder.status()).toBe(409);
    await expect(foreignReorder.json()).resolves.toMatchObject({
      code: "conflict",
    });
    const afterForeignAttempt = await client<
      Array<{ id: string; sort_order: number }>
    >`
      select id, sort_order from course_categories
      where organization_id = ${organizationId}
      order by id
    `;
    expect(afterForeignAttempt).toEqual(beforeForeignAttempt);

    const foreignPatch = await request.patch(
      `/api/v1/course-categories/${foreignCategoryId}`,
      {
        headers: mutationHeaders(`category-foreign-patch-${suffix}`),
        data: { name: "Mandantenbruch" },
      },
    );
    requestIds.push(foreignPatch.headers()["x-request-id"]);
    expect(foreignPatch.status()).toBe(404);
    const [foreignStillIntact] = await client<
      Array<{ name: string; sort_order: number }>
    >`
      select name, sort_order from course_categories
      where id = ${foreignCategoryId}
        and organization_id = ${foreignOrganizationId}
    `;
    expect(foreignStillIntact).toEqual({
      name: "Fremde Kategorie",
      sort_order: 17,
    });
  } finally {
    await closeContext(customContext);
    await closeContext(deniedContext);
    const ids = requestIds.filter(Boolean);
    if (ids.length > 0) {
      await client`delete from api_audit_logs where request_id = any(${ids})`;
    }
    if (limitedKeyId) {
      await client`delete from api_keys where id = ${limitedKeyId}`;
    }
    if (courseId) {
      await client`delete from courses where id = ${courseId}`;
    }
    if (categoryIds.length > 0) {
      await client`
        delete from activity_events
        where organization_id = ${organizationId}
          and (
            entity_id = any(${categoryIds})
            or (
              type = 'course_category.reordered'
              and metadata -> 'categoryIds' ?| ${categoryIds}
            )
          )
      `;
      await client`
        delete from course_categories
        where organization_id = ${organizationId}
          and id = any(${categoryIds})
      `;
    }
    if (customUserId && customRoleId) {
      await client`
        delete from team_role_assignments
        where organization_id = ${organizationId}
          and user_id = ${customUserId}
          and role_id = ${customRoleId}
      `;
    }
    if (customRoleId) {
      await client`delete from team_roles where id = ${customRoleId}`;
    }
    if (customUserId || deniedUserId) {
      await client`
        delete from users
        where id = any(${[customUserId, deniedUserId].filter(Boolean)})
      `;
    }
    if (foreignOrganizationId) {
      await client`
        delete from organizations where id = ${foreignOrganizationId}
      `;
    }
    await client.end();
  }
});
