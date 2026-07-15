import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import postgres from "postgres";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";
const sql = postgres(databaseUrl, { max: 1, prepare: false, connect_timeout: 2 });

after(async () => {
  await sql.end();
});

test("authoring revisions, styles, presence, and stock metadata stay tenant-bound", async (t) => {
  let ready = false;
  try {
    const [row] = await sql<{ ready: boolean }[]>`
      select to_regclass('public.editor_presences') is not null
        and to_regclass('public.stock_image_selections') is not null as ready
    `;
    ready = row?.ready ?? false;
  } catch {
    t.skip("PostgreSQL test database is unavailable.");
    return;
  }
  if (!ready) {
    t.skip("Authoring completion migration has not been applied.");
    return;
  }

  const organizationA = randomUUID();
  const organizationB = randomUUID();
  const userA = randomUUID();
  const userB = randomUUID();
  const courseA = randomUUID();
  const courseB = randomUUID();
  const moduleA = randomUUID();
  const lessonA = randomUUID();
  const pageA = randomUUID();
  const presenceId = randomUUID();
  try {
    await sql`
      insert into organizations (id, name, slug) values
        (${organizationA}, 'Authoring tenant A', ${`authoring-a-${organizationA.slice(0, 8)}`}),
        (${organizationB}, 'Authoring tenant B', ${`authoring-b-${organizationB.slice(0, 8)}`})
    `;
    await sql`
      insert into users (
        id, organization_id, email, password_hash, first_name, last_name, role, status
      ) values
        (${userA}, ${organizationA}, ${`${userA}@example.test`}, 'hash', 'Editor', 'A', 'owner', 'active'),
        (${userB}, ${organizationB}, ${`${userB}@example.test`}, 'hash', 'Editor', 'B', 'owner', 'active')
    `;
    await sql`
      insert into courses (
        id, organization_id, title, slug, short_description, description, status, created_by_id
      ) values
        (${courseA}, ${organizationA}, 'Course A', ${`course-a-${courseA.slice(0, 8)}`}, 'Course A', 'Course A', 'draft', ${userA}),
        (${courseB}, ${organizationB}, 'Course B', ${`course-b-${courseB.slice(0, 8)}`}, 'Course B', 'Course B', 'draft', ${userB})
    `;
    await sql`
      insert into modules (id, organization_id, title, is_reusable)
      values (${moduleA}, ${organizationA}, 'Module A', true)
    `;
    await sql`
      insert into course_modules (organization_id, course_id, module_id)
      values (${organizationA}, ${courseA}, ${moduleA})
    `;
    await sql`
      insert into lessons (id, organization_id, module_id, title, slug)
      values (${lessonA}, ${organizationA}, ${moduleA}, 'Lesson A', 'lesson-a')
    `;
    await sql`
      insert into lesson_pages (
        id, lesson_id, title, slug, status, layout_width, background_tone, content_spacing
      ) values (
        ${pageA}, ${lessonA}, 'Page A', 'page-a', 'published', 'standard', 'plain', 'comfortable'
      )
    `;
    const updated = await sql`
      update lesson_pages
      set title = 'Page A2', revision = revision + 1
      where id = ${pageA} and revision = 1
      returning revision
    `;
    assert.equal(updated[0]?.revision, 2);
    const stale = await sql`
      update lesson_pages set title = 'stale'
      where id = ${pageA} and revision = 1
      returning id
    `;
    assert.equal(stale.length, 0);

    await sql`
      insert into editor_presences (
        id, organization_id, course_id, user_id, lesson_id, page_id,
        last_seen_at, expires_at, created_at
      ) values (
        ${presenceId}, ${organizationA}, ${courseA}, ${userA}, ${lessonA}, ${pageA},
        now(), now() + interval '75 seconds', now()
      )
    `;
    await assert.rejects(sql`
      insert into editor_presences (
        id, organization_id, course_id, user_id, last_seen_at, expires_at, created_at
      ) values (
        ${randomUUID()}, ${organizationA}, ${courseA}, ${userB}, now(), now() + interval '75 seconds', now()
      )
    `);
    await assert.rejects(sql`
      insert into content_blocks (lesson_id, page_id, type, style)
      values (
        ${lessonA}, ${pageA}, 'text',
        '{"width":"full","alignment":"left","surface":"plain","css":"position:fixed"}'::jsonb
      )
    `);
    await sql`
      insert into stock_image_selections (
        organization_id, course_id, selected_by_id, provider, external_id,
        image_url, preview_url, width, height, author, source_url, attribution,
        download_tracked_at, expires_at, created_at
      ) values (
        ${organizationA}, ${courseA}, ${userA}, 'Test', 'image-1',
        'https://cdn.example.test/image.jpg', 'https://cdn.example.test/preview.jpg',
        1200, 800, 'Author', 'https://example.test/image-1', 'Photo by Author',
        now(), now() + interval '30 days', now()
      )
    `;
    await assert.rejects(sql`
      insert into stock_image_selections (
        organization_id, course_id, provider, external_id, image_url, preview_url,
        width, height, author, source_url, attribution, download_tracked_at,
        expires_at, created_at
      ) values (
        ${organizationA}, ${courseB}, 'Test', 'image-2',
        'https://cdn.example.test/image.jpg', 'https://cdn.example.test/preview.jpg',
        1200, 800, 'Author', 'https://example.test/image-2', 'Photo by Author',
        now(), now() + interval '30 days', now()
      )
    `);
  } finally {
    await sql`delete from organizations where id in (${organizationA}, ${organizationB})`;
  }
});
