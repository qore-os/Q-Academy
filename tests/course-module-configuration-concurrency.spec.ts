import { createHash, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import postgres from "postgres";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";
const demoSecret =
  process.env.DEMO_API_KEY ?? "qak_demo_qacademy_2026_local_development";

function hashSecret(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

test("concurrent course module partial patches preserve access policy invariants", async ({
  request,
}) => {
  const sql = postgres(databaseUrl, { max: 4, prepare: false });
  const suffix = randomUUID();
  let courseId = "";
  let moduleId = "";

  try {
    const [identity] = await sql<
      Array<{ organization_id: string; admin_id: string }>
    >`
      select api.organization_id, admin.id as admin_id
      from api_keys api
      join users admin
        on admin.organization_id = api.organization_id
       and admin.email = 'admin@q-academy.de'
      where api.key_hash = ${hashSecret(demoSecret)}
        and api.status = 'active'
      limit 1
    `;
    expect(identity).toBeTruthy();

    const [course] = await sql<Array<{ id: string }>>`
      insert into courses (
        organization_id, title, slug, short_description, description,
        status, created_by_id
      ) values (
        ${identity.organization_id}, ${`Concurrent module ${suffix}`},
        ${`concurrent-module-${suffix}`}, 'Concurrency test',
        'Concurrency test', 'draft', ${identity.admin_id}
      ) returning id
    `;
    courseId = course.id;

    const [learningModule] = await sql<Array<{ id: string }>>`
      insert into modules (
        organization_id, title, description, estimated_minutes
      ) values (
        ${identity.organization_id}, ${`Concurrent policy ${suffix}`},
        'Concurrency test', 5
      ) returning id
    `;
    moduleId = learningModule.id;

    await sql`
      insert into course_modules (
        organization_id, course_id, module_id, sort_order, access_mode,
        drip_days, delay_pending_state, available_from, available_until,
        window_default_state, window_state, request_access_enabled, is_required
      ) values (
        ${identity.organization_id}, ${courseId}, ${moduleId}, 0, 'visible',
        0, 'locked', null, null, 'locked', 'available', false, true
      )
    `;

    const path = `/api/v1/courses/${courseId}/modules/${moduleId}`;
    const availableFrom = new Date(Date.now() + 86_400_000).toISOString();
    const responses = await Promise.all([
      request.patch(path, {
        headers: {
          Authorization: `Bearer ${demoSecret}`,
          "Idempotency-Key": `module-delay-${suffix}`,
        },
        data: { accessMode: "delay_days", dripDays: 5 },
      }),
      request.patch(path, {
        headers: {
          Authorization: `Bearer ${demoSecret}`,
          "Idempotency-Key": `module-window-${suffix}`,
        },
        data: { accessMode: "date_window", availableFrom },
      }),
    ]);

    expect(responses.map((response) => response.status()).sort()).toEqual([
      200, 422,
    ]);
    const rejected = responses.find((response) => response.status() === 422);
    expect(await rejected!.json()).toMatchObject({
      status: 422,
      code: "validation_error",
    });

    const [configuration] = await sql<
      Array<{
        access_mode: string;
        drip_days: number;
        available_from: Date | null;
        available_until: Date | null;
      }>
    >`
      select access_mode, drip_days, available_from, available_until
      from course_modules
      where organization_id = ${identity.organization_id}
        and course_id = ${courseId}
        and module_id = ${moduleId}
    `;
    const validDelayConfiguration =
      configuration.access_mode === "delay_days" &&
      configuration.drip_days === 5 &&
      configuration.available_from === null &&
      configuration.available_until === null;
    const validWindowConfiguration =
      configuration.access_mode === "date_window" &&
      configuration.drip_days === 0 &&
      configuration.available_from !== null &&
      configuration.available_until === null;
    expect(validDelayConfiguration || validWindowConfiguration).toBe(true);
  } finally {
    if (courseId) {
      await sql`delete from api_audit_logs where path like ${`%${courseId}%`}`;
      await sql`delete from api_idempotency_keys where path like ${`%${courseId}%`}`;
      await sql`delete from courses where id = ${courseId}`;
    }
    if (moduleId) await sql`delete from modules where id = ${moduleId}`;
    await sql.end();
  }
});
