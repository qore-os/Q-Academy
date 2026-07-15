import { expect, test } from "@playwright/test";
import postgres from "postgres";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";

async function loginAsOwner(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: /Admin-Demo|Als Admin testen/ }).click();
  await page.waitForURL("**/admin");
}

test("group and bundle assignments synchronize access without losing progress", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium",
    "Focused access lifecycle runs once on desktop Chromium",
  );
  test.setTimeout(90_000);

  const client = postgres(databaseUrl, { prepare: false });
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const groupName = `E2E Gruppe ${suffix}`;
  const updatedGroupName = `${groupName} Aktiv`;
  const bundleName = `E2E Bundle ${suffix}`;
  const updatedBundleName = `${bundleName} Aktiv`;
  const courseTitle = `E2E Zugriffskurs ${suffix}`;
  const firstName = "Access";
  const lastName = `Member ${suffix}`;
  const email = `access-${suffix}@example.com`;
  let groupId = "";
  let bundleId = "";
  let courseId = "";
  let memberId = "";

  try {
    const [fixture] = await client<
      {
        owner_id: string;
        organization_id: string;
        password_hash: string;
      }[]
    >`
      select
        owner.id as owner_id,
        owner.organization_id,
        template.password_hash
      from users owner
      cross join users template
      where owner.email = 'admin@q-academy.de'
        and template.email = 'lea@q-academy.de'
      limit 1
    `;
    expect(fixture).toBeTruthy();

    const [member] = await client<{ id: string }[]>`
      insert into users (
        organization_id,
        email,
        password_hash,
        first_name,
        last_name,
        role,
        status
      ) values (
        ${fixture.organization_id},
        ${email},
        ${fixture.password_hash},
        ${firstName},
        ${lastName},
        'member',
        'active'
      )
      returning id
    `;
    memberId = member.id;
    const [course] = await client<{ id: string }[]>`
      insert into courses (
        organization_id,
        title,
        slug,
        short_description,
        description,
        status,
        created_by_id
      ) values (
        ${fixture.organization_id},
        ${courseTitle},
        ${`e2e-access-${suffix}`},
        'Temporarer Kurs fuer den Zugriffstest.',
        'Temporarer Kurs fuer den Zugriffstest mit mehreren unabhaengigen Zugriffsquellen.',
        'published',
        ${fixture.owner_id}
      )
      returning id
    `;
    courseId = course.id;
    const [group] = await client<{ id: string }[]>`
      insert into groups (organization_id, name, description, color)
      values (${fixture.organization_id}, ${groupName}, 'Temporare E2E-Gruppe.', '#4f7cac')
      returning id
    `;
    groupId = group.id;
    const [bundle] = await client<{ id: string }[]>`
      insert into bundles (organization_id, name, description, color, active)
      values (${fixture.organization_id}, ${bundleName}, 'Temporaeres E2E-Bundle.', '#ee6c5d', true)
      returning id
    `;
    bundleId = bundle.id;

    await loginAsOwner(page);
    await page.goto(`/admin/groups/${groupId}`);
    await expect(page.getByRole("heading", { name: groupName })).toBeVisible();

    const groupSettings = page
      .locator("form")
      .filter({ has: page.getByLabel("Gruppenname") });
    await groupSettings.getByLabel("Gruppenname").fill(updatedGroupName);
    await groupSettings
      .getByLabel("Beschreibung")
      .fill("Aktualisierte Gruppe mit synchronisiertem Zugriff.");
    await groupSettings
      .getByRole("button", { name: "Speichern", exact: true })
      .click();
    await expect(
      page.getByText("Gruppe gespeichert.", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: updatedGroupName }),
    ).toBeVisible();

    const memberForm = page
      .locator("form")
      .filter({ has: page.getByLabel("Mitglied auswaehlen") });
    await memberForm.getByLabel("Mitglied auswaehlen").selectOption(memberId);
    await memberForm
      .getByRole("button", { name: "Hinzufuegen", exact: true })
      .click();
    await expect(
      page.getByText("Mitglied hinzugefuegt.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: `${firstName} ${lastName}` }),
    ).toBeVisible();

    const courseForm = page
      .locator("form")
      .filter({ has: page.getByLabel("Kurs auswaehlen") });
    await courseForm.getByLabel("Kurs auswaehlen").selectOption(courseId);
    await courseForm
      .getByRole("button", { name: "Hinzufuegen", exact: true })
      .click();
    await expect(
      page.getByText("Kurs zugewiesen.", {
        exact: true,
      }),
    ).toBeVisible();

    const bundleForm = page
      .locator("form")
      .filter({ has: page.getByLabel("Bundle auswaehlen") });
    await bundleForm.getByLabel("Bundle auswaehlen").selectOption(bundleId);
    await bundleForm
      .getByRole("button", { name: "Hinzufuegen", exact: true })
      .click();
    await expect(
      page.getByText(
        "Bundle zugewiesen.",
        {
          exact: true,
        },
      ),
    ).toBeVisible();

    const [groupAssignments] = await client<
      {
        member_count: number;
        course_count: number;
        bundle_count: number;
        grant_count: number;
        access_active: boolean;
      }[]
    >`
      select
        (select count(*)::int from group_members where group_id = ${groupId}) as member_count,
        (select count(*)::int from group_courses where group_id = ${groupId}) as course_count,
        (select count(*)::int from group_bundles where group_id = ${groupId}) as bundle_count,
        (select count(*)::int from course_access_grants where user_id = ${memberId} and course_id = ${courseId}) as grant_count,
        (select access_active from enrollments where user_id = ${memberId} and course_id = ${courseId}) as access_active
    `;
    expect(groupAssignments).toMatchObject({
      member_count: 1,
      course_count: 1,
      bundle_count: 1,
      grant_count: 1,
      access_active: true,
    });

    await page.goto(`/admin/bundles/${bundleId}`);
    await expect(page.getByRole("heading", { name: bundleName })).toBeVisible();
    const bundleSettings = page
      .locator("form")
      .filter({ has: page.getByLabel("Bundle-Name") });
    await bundleSettings.getByLabel("Bundle-Name").fill(updatedBundleName);
    await bundleSettings
      .getByLabel("Beschreibung")
      .fill("Aktualisiertes Bundle mit automatisch synchronisierten Kursen.");
    await bundleSettings
      .getByRole("button", { name: "Speichern", exact: true })
      .click();
    await expect(
      page.getByText("Bundle gespeichert.", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: updatedBundleName }),
    ).toBeVisible();

    const bundleCourseForm = page
      .locator("form")
      .filter({ has: page.getByLabel("Kurs auswaehlen") });
    await bundleCourseForm.getByLabel("Kurs auswaehlen").selectOption(courseId);
    await bundleCourseForm
      .getByRole("button", { name: "Hinzufuegen", exact: true })
      .click();
    await expect(
      page.getByText("Kurs zum Bundle hinzugefuegt.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: courseTitle, exact: true }),
    ).toBeVisible();

    const policyForm = page.locator("form").filter({
      has: page.getByRole("button", {
        name: `Freigabe fuer ${courseTitle} speichern`,
      }),
    });
    await policyForm.getByLabel("Startdatum").fill("2028-01-15T09:30");
    await policyForm.getByLabel("Enddatum").fill("2028-02-15T09:30");
    await policyForm.getByLabel("Verzoegerung (Tage)").fill("4");
    await policyForm.getByLabel("Sichtbar").uncheck();
    await policyForm
      .getByRole("button", {
        name: `Freigabe fuer ${courseTitle} speichern`,
      })
      .click();
    await expect(
      page.getByText("Kursfreigabe gespeichert.", { exact: true }),
    ).toBeVisible();
    const [savedPolicy] = await client<
      {
        has_start: boolean;
        has_end: boolean;
        valid_window: boolean;
        delay_days: number;
        visible: boolean;
      }[]
    >`
      select
        available_from is not null as has_start,
        available_until is not null as has_end,
        available_until > available_from as valid_window,
        delay_days,
        visible
      from bundle_courses
      where bundle_id = ${bundleId}
        and course_id = ${courseId}
    `;
    expect(savedPolicy).toEqual({
      has_start: true,
      has_end: true,
      valid_window: true,
      delay_days: 4,
      visible: false,
    });
    await page.screenshot({
      path: testInfo.outputPath("bundle-access-management.png"),
      fullPage: true,
    });

    const grantsAfterBundle = await client<{ source: string }[]>`
      select source
      from course_access_grants
      where user_id = ${memberId}
        and course_id = ${courseId}
      order by source
    `;
    expect(grantsAfterBundle).toHaveLength(2);
    expect(grantsAfterBundle.map((grant) => grant.source)).toContain(
      `group:${groupId}:course:${courseId}`,
    );
    expect(grantsAfterBundle.map((grant) => grant.source)).toContain(
      `group:${groupId}:bundle:${bundleId}`,
    );

    await client`
      update enrollments
      set progress = 42, status = 'in_progress'
      where user_id = ${memberId}
        and course_id = ${courseId}
    `;

    await page.goto(`/admin/groups/${groupId}`);
    await page
      .getByRole("button", { name: `${courseTitle} entfernen` })
      .click();
    await page
      .getByRole("button", { name: `${courseTitle} wirklich entfernen` })
      .click();
    await expect(
      page.getByText("Kurszuweisung entfernt.", { exact: true }),
    ).toBeVisible();

    const [afterDirectRemoval] = await client<
      {
        grant_count: number;
        access_active: boolean;
        progress: number;
      }[]
    >`
      select
        (select count(*)::int from course_access_grants where user_id = ${memberId} and course_id = ${courseId}) as grant_count,
        access_active,
        progress
      from enrollments
      where user_id = ${memberId}
        and course_id = ${courseId}
    `;
    expect(afterDirectRemoval).toMatchObject({
      grant_count: 1,
      access_active: true,
      progress: 42,
    });

    await page
      .getByRole("button", { name: `${updatedBundleName} entfernen` })
      .click();
    await page
      .getByRole("button", { name: `${updatedBundleName} wirklich entfernen` })
      .click();
    await expect(
      page.getByText("Bundle-Zuweisung entfernt.", { exact: true }),
    ).toBeVisible();

    const [afterLastGrantRemoval] = await client<
      {
        grant_count: number;
        access_active: boolean;
        progress: number;
      }[]
    >`
      select
        (select count(*)::int from course_access_grants where user_id = ${memberId} and course_id = ${courseId}) as grant_count,
        access_active,
        progress
      from enrollments
      where user_id = ${memberId}
        and course_id = ${courseId}
    `;
    expect(afterLastGrantRemoval).toMatchObject({
      grant_count: 0,
      access_active: false,
      progress: 42,
    });

    await page
      .getByRole("button", { name: `${firstName} ${lastName} entfernen` })
      .click();
    await page
      .getByRole("button", {
        name: `${firstName} ${lastName} wirklich entfernen`,
      })
      .click();
    await expect(
      page.getByText("Mitglied entfernt.", { exact: true }),
    ).toBeVisible();

    await page.goto(`/admin/bundles/${bundleId}`);
    await page
      .getByRole("button", { name: `${courseTitle} entfernen` })
      .click();
    await page
      .getByRole("button", { name: `${courseTitle} wirklich entfernen` })
      .click();
    await expect(
      page.getByText("Kurs aus dem Bundle entfernt.", { exact: true }),
    ).toBeVisible();

    const [finalState] = await client<
      {
        member_count: number;
        course_count: number;
        bundle_count: number;
        bundle_course_count: number;
        access_active: boolean;
        progress: number;
        group_name: string;
        bundle_name: string;
      }[]
    >`
      select
        (select count(*)::int from group_members where group_id = ${groupId}) as member_count,
        (select count(*)::int from group_courses where group_id = ${groupId}) as course_count,
        (select count(*)::int from group_bundles where group_id = ${groupId}) as bundle_count,
        (select count(*)::int from bundle_courses where bundle_id = ${bundleId}) as bundle_course_count,
        e.access_active,
        e.progress,
        (select name from groups where id = ${groupId}) as group_name,
        (select name from bundles where id = ${bundleId}) as bundle_name
      from enrollments e
      where e.user_id = ${memberId}
        and e.course_id = ${courseId}
    `;
    expect(finalState).toMatchObject({
      member_count: 0,
      course_count: 0,
      bundle_count: 0,
      bundle_course_count: 0,
      access_active: false,
      progress: 42,
      group_name: updatedGroupName,
      bundle_name: updatedBundleName,
    });
  } finally {
    if (groupId) {
      await client`delete from activity_events where entity_id = ${groupId}`;
      await client`delete from groups where id = ${groupId}`;
    }
    if (bundleId) {
      await client`delete from activity_events where entity_id = ${bundleId}`;
      await client`delete from bundles where id = ${bundleId}`;
    }
    if (courseId) await client`delete from courses where id = ${courseId}`;
    if (memberId) await client`delete from users where id = ${memberId}`;
    await client.end();
  }
});

test("group and bundle detail pages fit the mobile viewport", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "Mobile-only layout assertion");
  const client = postgres(databaseUrl, { prepare: false });
  try {
    const [group] = await client<{ id: string }[]>`
      select id from groups order by created_at asc limit 1
    `;
    const [bundle] = await client<{ id: string }[]>`
      select id from bundles order by created_at asc limit 1
    `;
    expect(group).toBeTruthy();
    expect(bundle).toBeTruthy();
    await loginAsOwner(page);

    await page.goto(`/admin/groups/${group.id}`);
    await expect(
      page.getByText("Gruppenverwaltung", { exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(1);
    await page.screenshot({
      path: testInfo.outputPath("group-detail-mobile.png"),
      fullPage: true,
    });

    await page.goto(`/admin/bundles/${bundle.id}`);
    await expect(
      page.getByText("Bundle-Verwaltung", { exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(1);
    await page.screenshot({
      path: testInfo.outputPath("bundle-detail-mobile.png"),
      fullPage: true,
    });
  } finally {
    await client.end();
  }
});
