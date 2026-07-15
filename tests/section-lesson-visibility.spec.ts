import { createHash, randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";
import { getCourseBuilderCopy } from "../src/lib/i18n/course-builder";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";
const demoSecret =
  process.env.DEMO_API_KEY ?? "qak_demo_qacademy_2026_local_development";
const courseBuilderCopy = getCourseBuilderCopy("de");

type DatabaseClient = ReturnType<typeof postgres>;

function hashSecret(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

async function loginAsAdmin(page: Page) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByRole("button", { name: /Admin-Demo|Als Admin testen/ }).click();
  await page.waitForURL("**/admin");
}

async function createCourseFixture(sql: DatabaseClient, prefix: string) {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const [owner] = await sql<
    Array<{ id: string; organization_id: string }>
  >`
    select id, organization_id
    from users
    where email = 'admin@q-academy.de'
    limit 1
  `;
  if (!owner) throw new Error("Demo owner not found.");

  const [course] = await sql<Array<{ id: string }>>`
    insert into courses (
      organization_id, title, slug, short_description, description, status,
      first_published_at, created_by_id
    ) values (
      ${owner.organization_id}, ${`${prefix} Kurs ${suffix}`},
      ${`section-visibility-course-${suffix}`}, 'Sichtbarkeitstest',
      'Temporarer Kurs fuer atomare Sektionssichtbarkeit.', 'published',
      now(), ${owner.id}
    )
    returning id
  `;
  const [learningModule] = await sql<Array<{ id: string }>>`
    insert into modules (organization_id, title, description)
    values (
      ${owner.organization_id}, ${`${prefix} Modul ${suffix}`},
      'Temporaeres Testmodul.'
    )
    returning id
  `;
  await sql`
    insert into course_modules (organization_id, course_id, module_id)
    values (${owner.organization_id}, ${course.id}, ${learningModule.id})
  `;
  const [section] = await sql<Array<{ id: string; title: string }>>`
    insert into module_sections (organization_id, module_id, title)
    values (
      ${owner.organization_id}, ${learningModule.id},
      ${`${prefix} Sektion ${suffix}`}
    )
    returning id, title
  `;
  const lessonRows = await sql<Array<{ id: string }>>`
    insert into lessons (
      organization_id, module_id, section_id, title, slug, sort_order,
      visibility
    ) values
      (
        ${owner.organization_id}, ${learningModule.id}, ${section.id},
        'Sichtbare Lektion', ${`visible-${suffix}`}, 0, 'visible'
      ),
      (
        ${owner.organization_id}, ${learningModule.id}, ${section.id},
        'Entwurfslektion', ${`draft-${suffix}`}, 1, 'draft'
      ),
      (
        ${owner.organization_id}, ${learningModule.id}, ${section.id},
        'Kommende Lektion', ${`coming-${suffix}`}, 2, 'coming_soon'
      )
    returning id
  `;
  const [otherSection] = await sql<Array<{ id: string }>>`
    insert into module_sections (organization_id, module_id, title, sort_order)
    values (
      ${owner.organization_id}, ${learningModule.id},
      ${`Andere Sektion ${suffix}`}, 1
    )
    returning id
  `;
  const [otherLesson] = await sql<Array<{ id: string }>>`
    insert into lessons (
      organization_id, module_id, section_id, title, slug, sort_order,
      visibility
    ) values (
      ${owner.organization_id}, ${learningModule.id}, ${otherSection.id},
      'Unveraenderte Lektion', ${`unchanged-${suffix}`}, 3, 'visible'
    )
    returning id
  `;
  const snapshotMarker = {
    marker: `snapshot-${suffix}`,
    lessonVisibilities: ["visible", "draft", "coming_soon"],
  };
  await sql`
    insert into course_versions (
      organization_id, course_id, version, snapshot, published_at,
      created_by_id
    ) values (
      ${owner.organization_id}, ${course.id}, 1,
      ${sql.json(snapshotMarker)}, now(), ${owner.id}
    )
  `;

  return {
    courseId: course.id,
    moduleId: learningModule.id,
    organizationId: owner.organization_id,
    ownerId: owner.id,
    sectionId: section.id,
    sectionTitle: section.title,
    lessonIds: lessonRows.map((lesson) => lesson.id),
    otherLessonId: otherLesson.id,
    snapshotMarker,
    suffix,
  };
}

async function cleanupCourseFixture(
  sql: DatabaseClient,
  fixture: Awaited<ReturnType<typeof createCourseFixture>> | null,
) {
  if (!fixture) return;
  await sql`
    delete from activity_events
    where entity_id = ${fixture.sectionId}
       or metadata ->> 'courseId' = ${fixture.courseId}
  `;
  await sql`delete from courses where id = ${fixture.courseId}`;
  await sql`delete from modules where id = ${fixture.moduleId}`;
}

test("admin setzt alle Sektionslektionen responsiv mit einer Schnellaktion", async ({
  page,
}, testInfo) => {
  const sql = postgres(databaseUrl, { prepare: false });
  let fixture: Awaited<ReturnType<typeof createCourseFixture>> | null = null;

  try {
    fixture = await createCourseFixture(sql, "UI");
    await loginAsAdmin(page);
    await page.goto(`/admin/courses/${fixture.courseId}`);
    await page
      .getByRole("tab", { name: courseBuilderCopy.tabs.access })
      .click();

    const group = page.getByRole("group", {
      name: `Sichtbarkeit aller Lektionen in ${fixture.sectionTitle}`,
    });
    await expect(group).toBeVisible();
    const visibleButton = group.getByRole("button", {
      name: "Alle Lektionen sichtbar schalten",
    });
    const draftButton = group.getByRole("button", {
      name: "Alle Lektionen als Entwurf ausblenden",
    });
    const comingSoonButton = group.getByRole("button", {
      name: "Alle Lektionen auf Erscheint bald setzen",
    });

    await visibleButton.click();
    await expect(
      page.getByText("3 Lektionen auf Sichtbar gesetzt."),
    ).toBeVisible();
    await expect(visibleButton).toHaveAttribute("aria-pressed", "true");
    await expect
      .poll(async () => {
        const [row] = await sql<Array<{ count: number }>>`
          select count(*)::int as count
          from lessons
          where id = any(${fixture!.lessonIds}::uuid[])
            and visibility = 'visible'
        `;
        return row.count;
      })
      .toBe(3);

    await draftButton.click();
    await expect(
      page.getByText("3 Lektionen auf Entwurf gesetzt."),
    ).toBeVisible();
    await expect(draftButton).toHaveAttribute("aria-pressed", "true");
    await expect
      .poll(async () => {
        const [row] = await sql<Array<{ count: number }>>`
          select count(*)::int as count
          from lessons
          where id = any(${fixture!.lessonIds}::uuid[])
            and visibility = 'draft'
        `;
        return row.count;
      })
      .toBe(3);

    await comingSoonButton.click();
    await expect(
      page.getByText("3 Lektionen auf Erscheint bald gesetzt."),
    ).toBeVisible();
    await expect(comingSoonButton).toHaveAttribute("aria-pressed", "true");

    const viewport = page.viewportSize();
    const groupBox = await group.boundingBox();
    expect(groupBox).toBeTruthy();
    if (viewport && groupBox) {
      expect(groupBox.x).toBeGreaterThanOrEqual(0);
      expect(groupBox.x + groupBox.width).toBeLessThanOrEqual(viewport.width);
    }
    await page.screenshot({
      path: testInfo.outputPath(
        `section-visibility-${testInfo.project.name}.png`,
      ),
      fullPage: true,
    });

    const lessonStates = await sql<Array<{ id: string; visibility: string }>>`
      select id, visibility
      from lessons
      where id = any(${fixture.lessonIds}::uuid[])
      order by id
    `;
    expect(lessonStates).toHaveLength(3);
    expect(
      lessonStates.every((lesson) => lesson.visibility === "coming_soon"),
    ).toBe(true);
    const [otherLesson] = await sql<Array<{ visibility: string }>>`
      select visibility from lessons where id = ${fixture.otherLessonId}
    `;
    expect(otherLesson.visibility).toBe("visible");
    const [version] = await sql<Array<{ snapshot: unknown }>>`
      select snapshot
      from course_versions
      where course_id = ${fixture.courseId} and version = 1
    `;
    expect(version.snapshot).toEqual(fixture.snapshotMarker);
    await page
      .getByRole("button", { name: "Aenderungen veroeffentlichen" })
      .click();
    await expect
      .poll(async () => {
        const [row] = await sql<Array<{ count: number }>>`
          select count(*)::int as count
          from course_versions
          where course_id = ${fixture!.courseId}
        `;
        return row.count;
      })
      .toBe(2);
    const [republishedVersion] = await sql<
      Array<{
        snapshot: {
          modules?: Array<{
            lessons?: Array<{ id: string; visibility: string }>;
            sections?: Array<{
              lessons?: Array<{ id: string; visibility: string }>;
            }>;
          }>;
        };
      }>
    >`
      select snapshot
      from course_versions
      where course_id = ${fixture.courseId}
      order by version desc
      limit 1
    `;
    const republishedLessons =
      republishedVersion.snapshot.modules?.flatMap((learningModule) => [
        ...(learningModule.lessons ?? []),
        ...(learningModule.sections?.flatMap(
          (section) => section.lessons ?? [],
        ) ?? []),
      ]) ?? [];
    expect(
      republishedLessons
        .filter((lesson) => fixture!.lessonIds.includes(lesson.id))
        .map((lesson) => lesson.visibility),
    ).toEqual(["coming_soon", "coming_soon", "coming_soon"]);
    const [event] = await sql<
      Array<{ type: string; user_id: string | null; count: number }>
    >`
      select
        type,
        user_id,
        (metadata ->> 'updatedLessonCount')::int as count
      from activity_events
      where entity_id = ${fixture.sectionId}
        and type = 'section.lesson_visibility.updated'
      order by created_at desc
      limit 1
    `;
    expect(event).toEqual({
      type: "section.lesson_visibility.updated",
      user_id: fixture.ownerId,
      count: 3,
    });
  } finally {
    await cleanupCourseFixture(sql, fixture);
    await sql.end({ timeout: 5 });
  }
});

test("Sektionssichtbarkeits-API ist idempotent, tenant-sicher und TOCTOU-fest", async ({
  request,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Focused API lifecycle runs once.");
  test.setTimeout(90_000);

  const sql = postgres(databaseUrl, { max: 4, prepare: false });
  let fixture: Awaited<ReturnType<typeof createCourseFixture>> | null = null;
  let foreignOrganizationId = "";
  let raceSectionId = "";
  const requestIds = Array.from({ length: 5 }, () => randomUUID());
  const idempotencyKeys = requestIds.map((id) => `section-visibility-${id}`);

  try {
    fixture = await createCourseFixture(sql, "API");
    const [apiIdentity] = await sql<Array<{ id: string }>>`
      select id
      from api_keys
      where key_hash = ${hashSecret(demoSecret)}
        and organization_id = ${fixture.organizationId}
        and status = 'active'
      limit 1
    `;
    expect(apiIdentity).toBeTruthy();

    const responses = await Promise.all(
      requestIds.slice(0, 2).map((requestId) =>
        request.patch(
          `/api/v1/sections/${fixture!.sectionId}/lesson-visibility`,
          {
            headers: {
              Authorization: `Bearer ${demoSecret}`,
              "Idempotency-Key": idempotencyKeys[0],
              "X-Request-Id": requestId,
            },
            data: { visibility: "coming_soon" },
          },
        ),
      ),
    );
    expect(responses.map((response) => response.status())).toEqual([200, 200]);
    const responseTexts = await Promise.all(
      responses.map((response) => response.text()),
    );
    expect(responseTexts[1]).toBe(responseTexts[0]);
    expect(
      responses.filter(
        (response) => response.headers()["idempotent-replayed"] === "true",
      ),
    ).toHaveLength(1);
    const responseBody = JSON.parse(responseTexts[0]) as {
      data: {
        sectionId: string;
        visibility: string;
        updatedLessonCount: number;
        updatedLessonIds: string[];
      };
    };
    expect(responseBody.data).toMatchObject({
      sectionId: fixture.sectionId,
      visibility: "coming_soon",
      updatedLessonCount: 3,
    });
    expect(responseBody.data.updatedLessonIds.sort()).toEqual(
      [...fixture.lessonIds].sort(),
    );

    const [committed] = await sql<
      Array<{
        activity_count: number;
        audit_count: number;
        idempotency_count: number;
        lesson_count: number;
      }>
    >`
      select
        (select count(*)::int from activity_events
          where entity_id = ${fixture.sectionId}
            and type = 'section.lesson_visibility.updated'
            and metadata ->> 'source' = 'api') as activity_count,
        (select count(*)::int from api_audit_logs
          where request_id = any(${requestIds.slice(0, 2)}::uuid[])
            and action = 'section.lesson_visibility.update'
            and response_status = 200) as audit_count,
        (select count(*)::int from api_idempotency_keys
          where api_key_id = ${apiIdentity.id}
            and key = ${idempotencyKeys[0]}
            and status = 'completed') as idempotency_count,
        (select count(*)::int from lessons
          where id = any(${fixture.lessonIds}::uuid[])
            and visibility = 'coming_soon') as lesson_count
    `;
    expect(committed).toEqual({
      activity_count: 1,
      audit_count: 2,
      idempotency_count: 1,
      lesson_count: 3,
    });

    const [foreignOrganization] = await sql<Array<{ id: string }>>`
      insert into organizations (name, slug)
      values (
        ${`Foreign section ${fixture.suffix}`},
        ${`foreign-section-${fixture.suffix}`}
      )
      returning id
    `;
    foreignOrganizationId = foreignOrganization.id;
    const [foreignModule] = await sql<Array<{ id: string }>>`
      insert into modules (organization_id, title)
      values (${foreignOrganizationId}, 'Foreign visibility module')
      returning id
    `;
    const [foreignSection] = await sql<Array<{ id: string }>>`
      insert into module_sections (organization_id, module_id, title)
      values (${foreignOrganizationId}, ${foreignModule.id}, 'Foreign section')
      returning id
    `;
    const [foreignLesson] = await sql<Array<{ id: string }>>`
      insert into lessons (
        organization_id, module_id, section_id, title, slug, visibility
      ) values (
        ${foreignOrganizationId}, ${foreignModule.id}, ${foreignSection.id},
        'Foreign lesson', 'foreign-lesson', 'visible'
      )
      returning id
    `;
    const foreignResponse = await request.patch(
      `/api/v1/sections/${foreignSection.id}/lesson-visibility`,
      {
        headers: {
          Authorization: `Bearer ${demoSecret}`,
          "Idempotency-Key": idempotencyKeys[2],
          "X-Request-Id": requestIds[2],
        },
        data: { visibility: "draft" },
      },
    );
    expect(foreignResponse.status()).toBe(404);
    const [foreignAfter] = await sql<Array<{ visibility: string }>>`
      select visibility from lessons where id = ${foreignLesson.id}
    `;
    expect(foreignAfter.visibility).toBe("visible");

    const [raceSection] = await sql<Array<{ id: string }>>`
      insert into module_sections (
        organization_id, module_id, title, sort_order
      ) values (
        ${fixture.organizationId}, ${fixture.moduleId},
        ${`Race section ${fixture.suffix}`}, 20
      )
      returning id
    `;
    raceSectionId = raceSection.id;
    await sql`
      insert into lessons (
        organization_id, module_id, section_id, title, slug, visibility
      ) values (
        ${fixture.organizationId}, ${fixture.moduleId}, ${raceSectionId},
        'Race lesson', ${`race-${fixture.suffix}`}, 'visible'
      )
    `;
    let pendingRaceResponse: ReturnType<typeof request.patch> | undefined;
    await sql.begin(async (transaction) => {
      await transaction`
        select id from module_sections where id = ${raceSectionId} for update
      `;
      pendingRaceResponse = request.patch(
        `/api/v1/sections/${raceSectionId}/lesson-visibility`,
        {
          headers: {
            Authorization: `Bearer ${demoSecret}`,
            "Idempotency-Key": idempotencyKeys[3],
            "X-Request-Id": requestIds[3],
          },
          data: { visibility: "draft" },
        },
      );
      await expect
        .poll(
          async () => {
            const [waiting] = await sql<Array<{ count: number }>>`
              select count(*)::int as count
              from pg_stat_activity
              where datname = current_database()
                and pid <> pg_backend_pid()
                and wait_event_type = 'Lock'
                and query ilike '%module_sections%for update%'
            `;
            return waiting.count;
          },
          { timeout: 10_000 },
        )
        .toBeGreaterThan(0);
      await transaction`delete from lessons where section_id = ${raceSectionId}`;
      await transaction`delete from module_sections where id = ${raceSectionId}`;
    });
    if (!pendingRaceResponse) throw new Error("Race request was not started.");
    const raceResponse = await pendingRaceResponse;
    expect(raceResponse.status()).toBe(404);
    const [raceEvent] = await sql<Array<{ count: number }>>`
      select count(*)::int as count
      from activity_events
      where entity_id = ${raceSectionId}
        and type = 'section.lesson_visibility.updated'
    `;
    expect(raceEvent.count).toBe(0);
    raceSectionId = "";

    const invalidResponse = await request.patch(
      `/api/v1/sections/${fixture.sectionId}/lesson-visibility`,
      {
        headers: {
          Authorization: `Bearer ${demoSecret}`,
          "Idempotency-Key": idempotencyKeys[4],
          "X-Request-Id": requestIds[4],
        },
        data: { visibility: "hidden" },
      },
    );
    expect(invalidResponse.status()).toBe(422);
  } finally {
    await sql`
      delete from api_audit_logs
      where request_id = any(${requestIds}::uuid[])
    `;
    await sql`
      delete from api_idempotency_keys
      where key = any(${idempotencyKeys}::text[])
    `;
    if (raceSectionId) {
      await sql`delete from lessons where section_id = ${raceSectionId}`;
      await sql`delete from module_sections where id = ${raceSectionId}`;
    }
    if (foreignOrganizationId) {
      await sql`delete from organizations where id = ${foreignOrganizationId}`;
    }
    await cleanupCourseFixture(sql, fixture);
    await sql.end({ timeout: 5 });
  }
});
