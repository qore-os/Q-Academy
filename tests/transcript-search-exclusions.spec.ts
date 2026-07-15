import { createHash, randomUUID } from "node:crypto";
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import postgres from "postgres";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";

function hashSecret(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

type TenantFixture = {
  organizationId: string;
  organizationSlug: string;
  adminId: string;
  adminEmail: string;
  memberId: string;
  memberEmail: string;
  apiSecret: string;
};

type CourseFixture = {
  courseId: string;
  courseSlug: string;
  moduleId: string;
  lessonId: string;
  blockId: string;
  videoTitle: string;
  videoUrl: string;
};

const transcriptSegments = [
  { startMs: 0, endMs: 5_000, text: "KI Grundlagen und Kinder verstehen." },
  {
    startMs: 6_000,
    endMs: 11_000,
    text: "Die interne Roadmap bleibt vertraulich.",
  },
  {
    startMs: 12_000,
    endMs: 18_000,
    text: "Eine interne neue Roadmap wird offen diskutiert.",
  },
  {
    startMs: 19_000,
    endMs: 25_000,
    text: "Grundlagen ohne Abkuerzungen bleiben auffindbar.",
  },
];

async function createTenant(
  sql: postgres.Sql,
  passwordHash: string,
  suffix: string,
): Promise<TenantFixture> {
  const organizationSlug = `transcript-${suffix}`.toLowerCase();
  const adminEmail = `transcript-admin-${suffix}@example.test`.toLowerCase();
  const memberEmail = `transcript-member-${suffix}@example.test`.toLowerCase();
  const [organization] = await sql<Array<{ id: string }>>`
    insert into organizations (name, slug)
    values (${`Transcript E2E ${suffix}`}, ${organizationSlug})
    returning id
  `;
  const users = await sql<
    Array<{ id: string; email: string; role: "admin" | "member" }>
  >`
    insert into users (
      organization_id, email, password_hash, first_name, last_name, role, status
    ) values
      (${organization.id}, ${adminEmail}, ${passwordHash}, 'Transcript', 'Admin', 'admin', 'active'),
      (${organization.id}, ${memberEmail}, ${passwordHash}, 'Transcript', 'Member', 'member', 'active')
    returning id, email, role
  `;
  const admin = users.find((user) => user.role === "admin")!;
  const member = users.find((user) => user.role === "member")!;
  const apiSecret = `qak_transcript_${randomUUID().replaceAll("-", "")}`;
  await sql`
    insert into api_keys (
      organization_id, created_by_id, name, prefix, key_hash, scopes
    ) values (
      ${organization.id}, ${admin.id}, 'Transcript E2E API',
      ${apiSecret.slice(0, 20)}, ${hashSecret(apiSecret)},
      array['organization:read', 'organization:write', 'courses:write']
    )
  `;
  return {
    organizationId: organization.id,
    organizationSlug,
    adminId: admin.id,
    adminEmail,
    memberId: member.id,
    memberEmail,
    apiSecret,
  };
}

async function createVideoCourse(
  sql: postgres.Sql,
  tenant: TenantFixture,
  suffix: string,
  enrollMember: boolean,
): Promise<CourseFixture> {
  const courseSlug = `video-${suffix}`.toLowerCase();
  const videoTitle = `Lernvideo ${suffix}`;
  const videoUrl = `https://media.test/${suffix}/lesson.mp4`;
  const [course] = await sql<Array<{ id: string }>>`
    insert into courses (
      organization_id, title, slug, short_description, description, status,
      certificate_enabled, created_by_id
    ) values (
      ${tenant.organizationId}, ${`Videokurs ${suffix}`}, ${courseSlug},
      'Durchsuchbares Video fuer den E2E-Test.',
      'Isolierter Kurs fuer serverseitige Transkript-Suchausschluesse.',
      'draft', false, ${tenant.adminId}
    )
    returning id
  `;
  const [module] = await sql<Array<{ id: string }>>`
    insert into modules (
      organization_id, title, description, is_reusable, estimated_minutes
    ) values (
      ${tenant.organizationId}, ${`Videomodul ${suffix}`},
      'E2E-Modul fuer die Videosuche.', false, 10
    )
    returning id
  `;
  await sql`
    insert into course_modules (
      organization_id, course_id, module_id, sort_order, is_required
    ) values (${tenant.organizationId}, ${course.id}, ${module.id}, 0, true)
  `;
  const [lesson] = await sql<Array<{ id: string }>>`
    insert into lessons (
      organization_id, module_id, title, slug, summary, type,
      duration_minutes, passing_score, sort_order, status
    ) values (
      ${tenant.organizationId}, ${module.id}, ${`Videolektion ${suffix}`},
      ${`lesson-${suffix}`.toLowerCase()},
      'Lektion mit sicher gepruefter Videosuche.', 'lesson', 10, 100, 0,
      'published'
    )
    returning id
  `;
  const [block] = await sql<Array<{ id: string }>>`
    insert into content_blocks (
      lesson_id, type, title, sort_order, required, data
    ) values (
      ${lesson.id}, 'video', ${videoTitle}, 0, false,
      ${sql.json({
        videoUrl,
        caption: "Redaktionell geprueftes Transkript.",
        transcript: { version: 1, language: "de", segments: transcriptSegments },
      })}
    )
    returning id
  `;
  if (enrollMember) {
    const [enrollment] = await sql<Array<{ id: string }>>`
      insert into enrollments (user_id, course_id, access_active)
      values (${tenant.memberId}, ${course.id}, true)
      returning id
    `;
    await sql`
      insert into course_access_grants (
        organization_id, user_id, course_id, source
      ) values (
        ${tenant.organizationId}, ${tenant.memberId}, ${course.id},
        ${`direct:${enrollment.id}`}
      )
    `;
  }
  return {
    courseId: course.id,
    courseSlug,
    moduleId: module.id,
    lessonId: lesson.id,
    blockId: block.id,
    videoTitle,
    videoUrl,
  };
}

async function publishCourse(
  request: APIRequestContext,
  tenant: TenantFixture,
  course: CourseFixture,
) {
  const response = await request.post(
    `/api/v1/courses/${course.courseId}/publish`,
    {
      headers: {
        Authorization: `Bearer ${tenant.apiSecret}`,
        "Idempotency-Key": `publish-transcript-${course.courseId}`,
      },
      data: { changelog: "Transkript-Suchtest" },
    },
  );
  const body = await response.text();
  expect(response.status(), body).toBe(201);
}

async function login(
  page: Page,
  tenant: TenantFixture,
  role: "admin" | "member",
) {
  await page.context().clearCookies();
  const response = await page.context().request.post("/api/v1/auth/login", {
    data: {
      organizationSlug: tenant.organizationSlug,
      email: role === "admin" ? tenant.adminEmail : tenant.memberEmail,
      password: "Demo123!",
    },
  });
  const body = await response.text();
  expect(response.ok(), body).toBe(true);
}

async function searchTranscript(
  page: Page,
  input: ReturnType<Page["getByRole"]>,
  query: string,
) {
  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === "/api/transcript-search",
  );
  await input.fill(query);
  const response = await responsePromise;
  return {
    status: response.status(),
    body: (await response.json()) as {
      allowed: boolean;
      segments: typeof transcriptSegments;
    },
  };
}

test("tenant transcript exclusions stay server-side and suppress only matching searches", async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(180_000);
  const sql = postgres(databaseUrl, { prepare: false });
  const startedAt = new Date();
  const suffix = `${testInfo.project.name}-${randomUUID().slice(0, 8)}`;
  const policySentinel = `payloadguard${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const foreignSentinel = `foreignpolicy${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  let tenant: TenantFixture | null = null;
  let foreignTenant: TenantFixture | null = null;

  try {
    const [passwordSource] = await sql<Array<{ passwordHash: string }>>`
      select password_hash as "passwordHash"
      from users
      where email = 'lea@q-academy.de'
      limit 1
    `;
    expect(passwordSource).toBeTruthy();
    tenant = await createTenant(sql, passwordSource.passwordHash, suffix);
    foreignTenant = await createTenant(
      sql,
      passwordSource.passwordHash,
      `foreign-${suffix}`,
    );
    const course = await createVideoCourse(sql, tenant, `open-${suffix}`, true);
    const deniedCourse = await createVideoCourse(
      sql,
      tenant,
      `denied-${suffix}`,
      false,
    );
    const foreignCourse = await createVideoCourse(
      sql,
      foreignTenant,
      `foreign-${suffix}`,
      true,
    );
    await publishCourse(request, tenant, course);
    await publishCourse(request, tenant, deniedCourse);
    await publishCourse(request, foreignTenant, foreignCourse);

    await login(page, tenant, "admin");
    await page.goto("/admin/settings#transkripte");
    const form = page.locator("form#transkripte");
    await expect(form).toBeVisible();
    const textarea = form.getByLabel("Ausgeschlossene Suchbegriffe");
    await textarea.fill(`KI\nInterne Roadmap\n${policySentinel}\nki`);
    await expect(form.getByText("3 / 100", { exact: true })).toBeVisible();
    await expect(form.getByText(policySentinel, { exact: true })).toBeVisible();
    await form.getByRole("button", { name: "Einstellungen speichern" }).click();
    await expect(
      form.getByText("3 Suchausschlüsse gespeichert.", { exact: true }),
    ).toBeVisible();

    const [stored] = await sql<Array<{ value: { excludedSearchTerms: string[] } }>>`
      select value
      from platform_settings
      where organization_id = ${tenant.organizationId} and key = 'transcripts'
    `;
    expect(stored.value.excludedSearchTerms).toEqual([
      "interne roadmap",
      "ki",
      policySentinel,
    ]);
    const firstEvents = await sql<Array<{ id: string; metadata: Record<string, unknown> }>>`
      select id, metadata
      from activity_events
      where organization_id = ${tenant.organizationId}
        and type = 'platform.transcript_search.updated'
      order by created_at
    `;
    expect(firstEvents).toHaveLength(1);
    expect(firstEvents[0].metadata).toMatchObject({
      source: "admin_ui",
      excludedTermCount: 3,
      addedCount: 3,
      removedCount: 0,
    });
    expect(firstEvents[0].metadata.configurationHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(firstEvents[0].metadata)).not.toContain(policySentinel);
    expect(JSON.stringify(firstEvents[0].metadata)).not.toContain("interne roadmap");

    await expect(
      form.getByRole("button", { name: "Einstellungen speichern" }),
    ).toBeDisabled();
    const [noOpAudit] = await sql<Array<{ count: number }>>`
      select count(*)::int as count
      from activity_events
      where organization_id = ${tenant.organizationId}
        and type = 'platform.transcript_search.updated'
    `;
    expect(noOpAudit.count).toBe(1);
    await form.screenshot({
      path: testInfo.outputPath(
        `transcript-search-admin-${testInfo.project.name}.png`,
      ),
    });

    let expectedTerms = ["interne roadmap", "ki", policySentinel];
    if (testInfo.project.name === "chromium") {
      expectedTerms = [...expectedTerms, "streng"];
      const idempotencyKey = `transcript-settings-${randomUUID()}`;
      const patch = () =>
        request.patch("/api/v1/organization/transcript-search", {
          headers: {
            Authorization: `Bearer ${tenant!.apiSecret}`,
            "Idempotency-Key": idempotencyKey,
          },
          data: {
            excludedSearchTerms: [
              "KI",
              "Interne Roadmap",
              policySentinel,
              "streng",
            ],
          },
        });
      const first = await patch();
      expect(first.status(), await first.text()).toBe(200);
      const replay = await patch();
      expect(replay.status(), await replay.text()).toBe(200);
      expect(replay.headers()["idempotent-replayed"]).toBe("true");

      const bypass = await request.patch("/api/v1/organization", {
        headers: {
          Authorization: `Bearer ${tenant.apiSecret}`,
          "Idempotency-Key": `transcript-bypass-${randomUUID()}`,
        },
        data: {
          settings: {
            transcripts: { excludedSearchTerms: ["ungueltig"] },
          },
        },
      });
      expect(bypass.status()).toBe(422);

      const htmlInput = await request.patch(
        "/api/v1/organization/transcript-search",
        {
          headers: {
            Authorization: `Bearer ${tenant.apiSecret}`,
            "Idempotency-Key": `transcript-html-${randomUUID()}`,
          },
          data: { excludedSearchTerms: ["<script>alert(1)</script>"] },
        },
      );
      expect(htmlInput.status()).toBe(422);

      const foreignUpdate = await request.patch(
        "/api/v1/organization/transcript-search",
        {
          headers: {
            Authorization: `Bearer ${foreignTenant.apiSecret}`,
            "Idempotency-Key": `transcript-foreign-${randomUUID()}`,
          },
          data: { excludedSearchTerms: [foreignSentinel] },
        },
      );
      expect(foreignUpdate.status(), await foreignUpdate.text()).toBe(200);
      const ownRead = await request.get(
        "/api/v1/organization/transcript-search",
        { headers: { Authorization: `Bearer ${tenant.apiSecret}` } },
      );
      const foreignRead = await request.get(
        "/api/v1/organization/transcript-search",
        { headers: { Authorization: `Bearer ${foreignTenant.apiSecret}` } },
      );
      expect((await ownRead.json()).data.excludedSearchTerms).toEqual(
        expectedTerms,
      );
      expect((await foreignRead.json()).data.excludedSearchTerms).toEqual([
        foreignSentinel,
      ]);

      const openApi = await request.get("/api/v1/openapi");
      expect((await openApi.json()).paths["/organization/transcript-search"]).toMatchObject({
        get: { operationId: "getTranscriptSearchSettings" },
        patch: {
          operationId: "updateTranscriptSearchSettings",
          "x-required-scopes": ["organization:write"],
        },
      });
      const primaryEvents = await sql<
        Array<{ metadata: Record<string, unknown> }>
      >`
        select metadata
        from activity_events
        where organization_id = ${tenant.organizationId}
          and type = 'platform.transcript_search.updated'
        order by created_at
      `;
      expect(primaryEvents).toHaveLength(2);
      for (const event of primaryEvents) {
        const serialized = JSON.stringify(event.metadata);
        expect(serialized).not.toContain(policySentinel);
        expect(serialized).not.toContain("interne roadmap");
      }
    }

    await page.route("https://media.test/**", (route) => route.abort());
    await login(page, tenant, "member");
    const memberResponse = await page.goto(
      `/academy/courses/${course.courseSlug}/learn/${course.lessonId}`,
    );
    expect(memberResponse?.status()).toBe(200);
    const memberPayload = await memberResponse!.text();
    expect(memberPayload).not.toContain(policySentinel);
    expect(memberPayload).not.toContain("excludedSearchTerms");
    expect(await page.content()).not.toContain(policySentinel);
    expect((await page.locator("script").allTextContents()).join("\n")).not.toContain(
      policySentinel,
    );

    await expect(page.getByRole("heading", { name: course.videoTitle })).toBeVisible();
    await expect(page.locator("video track[kind='captions']")).toHaveCount(1);
    const transcriptList = page.getByRole("list", {
      name: "Zeitmarken im Transkript",
    });
    await expect(transcriptList.getByRole("listitem")).toHaveCount(4);
    const search = page.getByRole("searchbox", {
      name: "Transkript durchsuchen",
    });

    let result = await searchTranscript(page, search, "Grundlagen");
    expect(result).toMatchObject({ status: 200, body: { allowed: true } });
    await expect(transcriptList.getByRole("listitem")).toHaveCount(2);
    await expect(transcriptList).toContainText(transcriptSegments[0].text);

    result = await searchTranscript(page, search, "KI Grundlagen");
    expect(result).toEqual({ status: 200, body: { allowed: false, segments: [] } });
    await expect(transcriptList).toHaveCount(0);
    await expect(
      page.getByText("Keine passenden Transkriptstellen.", { exact: true }),
    ).toBeVisible();

    result = await searchTranscript(page, search, "Kinder");
    expect(result).toMatchObject({ status: 200, body: { allowed: true } });
    await expect(transcriptList.getByRole("listitem")).toHaveCount(1);
    await expect(transcriptList).toContainText(transcriptSegments[0].text);

    result = await searchTranscript(page, search, "Unsere interne Roadmap 2026");
    expect(result).toEqual({ status: 200, body: { allowed: false, segments: [] } });
    await expect(transcriptList).toHaveCount(0);

    result = await searchTranscript(page, search, "interne neue Roadmap");
    expect(result).toMatchObject({ status: 200, body: { allowed: true } });
    await expect(transcriptList.getByRole("listitem")).toHaveCount(1);
    await expect(transcriptList).toContainText(transcriptSegments[2].text);

    result = await searchTranscript(page, search, "Roadmap");
    expect(result).toMatchObject({ status: 200, body: { allowed: true } });
    await expect(transcriptList.getByRole("listitem")).toHaveCount(2);
    await expect(transcriptList).toContainText(transcriptSegments[1].text);
    await search.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath(
        `transcript-search-member-${testInfo.project.name}.png`,
      ),
      fullPage: false,
    });

    const denied = await page.context().request.post("/api/transcript-search", {
      data: {
        courseSlug: deniedCourse.courseSlug,
        lessonId: deniedCourse.lessonId,
        blockId: deniedCourse.blockId,
        query: "Grundlagen",
      },
    });
    expect(denied.status()).toBe(404);
    const foreign = await page.context().request.post("/api/transcript-search", {
      data: {
        courseSlug: foreignCourse.courseSlug,
        lessonId: foreignCourse.lessonId,
        blockId: foreignCourse.blockId,
        query: "Grundlagen",
      },
    });
    expect(foreign.status()).toBe(404);

    await search.fill("");
    await expect(transcriptList.getByRole("listitem")).toHaveCount(4);
    await page.route("**/api/transcript-search", (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "test failure" }),
      }),
    );
    await search.fill("Kinder");
    await expect(
      page.getByText("Keine passenden Transkriptstellen.", { exact: true }),
    ).toBeVisible();
    await expect(transcriptList).toHaveCount(0);
    await page.unroute("**/api/transcript-search");

    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(1);
    await page.screenshot({
      path: testInfo.outputPath(
        `transcript-search-fail-closed-${testInfo.project.name}.png`,
      ),
      fullPage: false,
    });
  } finally {
    if (tenant) {
      await sql`delete from organizations where id = ${tenant.organizationId}`;
    }
    if (foreignTenant) {
      await sql`delete from organizations where id = ${foreignTenant.organizationId}`;
    }
    await sql`
      delete from auth_rate_limits
      where action in ('transcript_search', 'transcript_search_tenant')
        and updated_at >= ${startedAt}
    `;
    await sql.end({ timeout: 5 });
  }
});
