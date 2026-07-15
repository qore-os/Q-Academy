import { createHash, randomUUID } from "node:crypto";
import { expect, test, type APIResponse, type Page } from "@playwright/test";
import postgres from "postgres";
import { publicHubLayout } from "../src/lib/hub-layout";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";
const demoSecret =
  process.env.DEMO_API_KEY ?? "qak_demo_qacademy_2026_local_development";

function hashSecret(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

async function loginAsAdmin(page: Page) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByRole("button", { name: /Admin-Demo|Als Admin testen/ }).click();
  await page.waitForURL("**/admin");
}

test("hub clone creates an independent draft without access grants", async ({
  page,
}) => {
  const sql = postgres(databaseUrl, { prepare: false });
  let clonedHubId = "";
  let sourceHubId = "";
  try {
    const [source] = await sql<
      Array<{
        id: string;
        title: string;
        description: string | null;
        layout: unknown;
      }>
    >`
      select h.id, h.title, h.description, h.layout
      from hubs h
      join users u on u.organization_id = h.organization_id
      where h.slug = 'lern-dashboard'
        and u.email = 'admin@q-academy.de'
      limit 1
    `;
    expect(source).toBeTruthy();
    sourceHubId = source.id;

    await loginAsAdmin(page);
    await page.goto(`/admin/hubs/${source.id}`);
    await page.getByRole("button", { name: "Hub duplizieren" }).click();
    await page.waitForURL((url) => {
      const currentHubId = url.pathname.split("/").at(-1);
      return (
        /^\/admin\/hubs\/[0-9a-f-]+$/.test(url.pathname) &&
        currentHubId !== source.id
      );
    });
    clonedHubId = new URL(page.url()).pathname.split("/").at(-1) ?? "";
    expect(clonedHubId).not.toBe(source.id);
    await expect(page.getByText("Hub als Entwurf dupliziert.")).toBeVisible();

    const [clone] = await sql<
      Array<{
        title: string;
        description: string | null;
        status: string;
        layout: unknown;
      }>
    >`
      select title, description, status, layout
      from hubs
      where id = ${clonedHubId}
    `;
    expect(clone.title).toBe(`${source.title} (Kopie)`);
    expect(clone.description).toBe(source.description);
    expect(clone.status).toBe("draft");
    expect(clone.layout).toEqual(publicHubLayout(source.layout));

    const [grantCount] = await sql<Array<{ count: number }>>`
      select count(*)::int as count
      from hub_access_grants
      where hub_id = ${clonedHubId}
    `;
    expect(grantCount.count).toBe(0);

    await sql`
      update hubs
      set description = 'Clone-only mutation', layout = '[]'::jsonb
      where id = ${clonedHubId}
    `;
    const [sourceAfterCloneMutation] = await sql<
      Array<{ description: string | null; layout: unknown }>
    >`
      select description, layout
      from hubs
      where id = ${source.id}
    `;
    expect(sourceAfterCloneMutation).toEqual({
      description: source.description,
      layout: source.layout,
    });
  } finally {
    if (clonedHubId && clonedHubId !== sourceHubId) {
      await sql`delete from activity_events where entity_id = ${clonedHubId}`;
      await sql`delete from hubs where id = ${clonedHubId}`;
    }
    await sql.end();
  }
});

test("hub clone API is tenant-safe, form-safe and idempotently atomic", async ({
  request,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "focused API clone flow");
  test.setTimeout(90_000);

  const sql = postgres(databaseUrl, { max: 4, prepare: false });
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
  const cloneKey = `hub-clone-${suffix}`;
  const slugRaceKey = `hub-clone-slug-race-${suffix}`;
  const tenantKey = `hub-clone-tenant-${suffix}`;
  const inactiveFormKey = `hub-clone-form-${suffix}`;
  const requestIds = [
    randomUUID(),
    randomUUID(),
    randomUUID(),
    randomUUID(),
    randomUUID(),
    randomUUID(),
  ];
  const cloneIds: string[] = [];
  let webhookId = "";
  let foreignOrganizationId = "";
  let invalidSourceHubId = "";
  let inactiveFormId = "";
  let profileDefinitionId = "";
  let slugRaceBlockerId = "";
  let slugRaceCloneId = "";
  let slugRaceRequest: Promise<APIResponse> | undefined;

  try {
    const [identity] = await sql<
      Array<{ api_key_id: string; organization_id: string }>
    >`
      select id as api_key_id, organization_id
      from api_keys
      where key_hash = ${hashSecret(demoSecret)}
        and status = 'active'
      limit 1
    `;
    if (!identity) throw new Error("Demo API identity was not found.");

    const [source] = await sql<
      Array<{ id: string; title: string; layout: unknown }>
    >`
      select id, title, layout
      from hubs
      where organization_id = ${identity.organization_id}
        and slug = 'lern-dashboard'
      limit 1
    `;
    if (!source) throw new Error("Demo hub was not found.");

    const [webhook] = await sql<Array<{ id: string }>>`
      insert into webhooks (
        organization_id, name, url, signing_secret_encrypted, events, active
      ) values (
        ${identity.organization_id}, ${`Hub clone ${suffix}`},
        'https://hooks.invalid/hub-clone-test', 'test-only-not-deliverable',
        ${["hub.updated"]}, true
      )
      returning id
    `;
    webhookId = webhook.id;

    const apiTitle = `API Hub Clone ${suffix}`;
    const body = { title: apiTitle };
    const responses = await Promise.all(
      requestIds.slice(0, 2).map((requestId) =>
        request.post(`/api/v1/hubs/${source.id}/clone`, {
          headers: {
            Authorization: `Bearer ${demoSecret}`,
            "Idempotency-Key": cloneKey,
            "X-Request-Id": requestId,
          },
          data: body,
        }),
      ),
    );
    expect(responses.map((response) => response.status())).toEqual([201, 201]);
    const responseTexts = await Promise.all(
      responses.map((response) => response.text()),
    );
    expect(responseTexts[1]).toBe(responseTexts[0]);
    expect(
      responses.filter(
        (response) => response.headers()["idempotent-replayed"] === "true",
      ),
    ).toHaveLength(1);
    const cloned = JSON.parse(responseTexts[0]) as {
      data: { id: string; layout: unknown; slug: string; status: string };
    };
    cloneIds.push(cloned.data.id);
    expect(cloned.data).toMatchObject({
      layout: publicHubLayout(source.layout),
      status: "draft",
    });

    const [committed] = await sql<
      Array<{
        activity_count: number;
        audit_count: number;
        audit_resource_count: number;
        clone_count: number;
        delivery_count: number;
        grant_count: number;
        idempotency_count: number;
      }>
    >`
      select
        (select count(*)::int from hubs where id = ${cloned.data.id}) as clone_count,
        (select count(*)::int from hub_access_grants where hub_id = ${cloned.data.id}) as grant_count,
        (select count(*)::int from activity_events
          where entity_id = ${cloned.data.id}
            and type = 'hub.created'
            and metadata ->> 'operation' = 'hub.cloned'
            and metadata ->> 'sourceHubId' = ${source.id}) as activity_count,
        (select count(*)::int from webhook_deliveries
          where webhook_id = ${webhookId}
            and event = 'hub.updated'
            and payload #>> '{data,id}' = ${cloned.data.id}
            and payload #>> '{data,clonedFromId}' = ${source.id}) as delivery_count,
        (select count(*)::int from api_audit_logs
          where request_id = any(${requestIds.slice(0, 2)}::uuid[])
            and action = 'hub.clone'
            and response_status = 201) as audit_count,
        (select count(*)::int from api_audit_logs
          where request_id = any(${requestIds.slice(0, 2)}::uuid[])
            and resource_id = ${cloned.data.id}) as audit_resource_count,
        (select count(*)::int from api_idempotency_keys
          where api_key_id = ${identity.api_key_id}
            and key = ${cloneKey}
            and status = 'completed') as idempotency_count
    `;
    expect(committed).toEqual({
      activity_count: 1,
      audit_count: 2,
      audit_resource_count: 1,
      clone_count: 1,
      delivery_count: 1,
      grant_count: 0,
      idempotency_count: 1,
    });

    const conflictingReplay = await request.post(
      `/api/v1/hubs/${source.id}/clone`,
      {
        headers: {
          Authorization: `Bearer ${demoSecret}`,
          "Idempotency-Key": cloneKey,
          "X-Request-Id": requestIds[2],
        },
        data: { title: `${apiTitle} conflict` },
      },
    );
    expect(conflictingReplay.status()).toBe(409);
    await expect(conflictingReplay.json()).resolves.toMatchObject({
      code: "idempotency_conflict",
    });

    const raceTitle = `Race Hub ${suffix}`;
    const raceSlug = `race-hub-${suffix}`;
    await sql.begin(async (transaction) => {
      const [blocker] = await transaction<Array<{ id: string }>>`
        insert into hubs (organization_id, title, slug, status, layout)
        values (
          ${identity.organization_id}, ${`Slug blocker ${suffix}`},
          ${raceSlug}, 'draft', '[]'::jsonb
        )
        returning id
      `;
      slugRaceBlockerId = blocker.id;
      slugRaceRequest = request.post(`/api/v1/hubs/${source.id}/clone`, {
        headers: {
          Authorization: `Bearer ${demoSecret}`,
          "Idempotency-Key": slugRaceKey,
          "X-Request-Id": requestIds[3],
        },
        data: { title: raceTitle },
      });

      await expect
        .poll(
          async () => {
            const [waiting] = await sql<Array<{ count: number }>>`
              select count(*)::int as count
              from pg_stat_activity
              where datname = current_database()
                and pid <> pg_backend_pid()
                and wait_event_type = 'Lock'
                and query ilike '%insert into "hubs"%'
            `;
            return waiting.count;
          },
          { timeout: 10_000 },
        )
        .toBeGreaterThan(0);
    });
    if (!slugRaceRequest) throw new Error("Slug race request was not started.");
    const slugRaceResponse = await slugRaceRequest;
    expect(slugRaceResponse.status()).toBe(201);
    const slugRaceClone = (await slugRaceResponse.json()) as {
      data: { id: string; slug: string; status: string };
    };
    slugRaceCloneId = slugRaceClone.data.id;
    cloneIds.push(slugRaceCloneId);
    expect(slugRaceClone.data).toMatchObject({
      slug: `${raceSlug}-2`,
      status: "draft",
    });

    const [foreignOrganization] = await sql<Array<{ id: string }>>`
      insert into organizations (name, slug)
      values (${`Foreign clone ${suffix}`}, ${`foreign-clone-${suffix}`})
      returning id
    `;
    foreignOrganizationId = foreignOrganization.id;
    const foreignTitle = `Foreign Hub ${suffix}`;
    const [foreignHub] = await sql<Array<{ id: string }>>`
      insert into hubs (organization_id, title, slug, status, layout)
      values (
        ${foreignOrganizationId}, ${foreignTitle}, ${`foreign-hub-${suffix}`},
        'published', '[]'::jsonb
      )
      returning id
    `;
    const foreignResponse = await request.post(
      `/api/v1/hubs/${foreignHub.id}/clone`,
      {
        headers: {
          Authorization: `Bearer ${demoSecret}`,
          "Idempotency-Key": tenantKey,
          "X-Request-Id": requestIds[4],
        },
        data: {},
      },
    );
    expect(foreignResponse.status()).toBe(404);
    const [tenantLeak] = await sql<Array<{ count: number }>>`
      select count(*)::int as count
      from hubs
      where organization_id = ${identity.organization_id}
        and title = ${`${foreignTitle} (Kopie)`}
    `;
    expect(tenantLeak.count).toBe(0);

    const [profileDefinition] = await sql<Array<{ id: string }>>`
      insert into data_profile_definitions (
        organization_id, key, name, allow_member_creation, active
      ) values (
        ${identity.organization_id}, ${`clone_${suffix}`},
        ${`Clone profile ${suffix}`}, false, true
      )
      returning id
    `;
    profileDefinitionId = profileDefinition.id;
    const [inactiveForm] = await sql<Array<{ id: string }>>`
      insert into data_forms (
        organization_id, profile_definition_id, key, name, active
      ) values (
        ${identity.organization_id}, ${profileDefinitionId},
        ${`clone_form_${suffix}`}, ${`Inactive clone form ${suffix}`}, false
      )
      returning id
    `;
    inactiveFormId = inactiveForm.id;
    const invalidSourceTitle = `Inactive Form Hub ${suffix}`;
    const [invalidSource] = await sql<Array<{ id: string }>>`
      insert into hubs (organization_id, title, slug, status, layout)
      values (
        ${identity.organization_id}, ${invalidSourceTitle},
        ${`inactive-form-hub-${suffix}`}, 'draft',
        ${sql.json([
          {
            id: "row-1",
            columns: [
              {
                type: "data_form",
                title: "Inactive form",
                formId: inactiveFormId,
              },
            ],
          },
        ])}
      )
      returning id
    `;
    invalidSourceHubId = invalidSource.id;
    const inactiveResponse = await request.post(
      `/api/v1/hubs/${invalidSourceHubId}/clone`,
      {
        headers: {
          Authorization: `Bearer ${demoSecret}`,
          "Idempotency-Key": inactiveFormKey,
          "X-Request-Id": requestIds[5],
        },
        data: {},
      },
    );
    expect(inactiveResponse.status()).toBe(409);
    await expect(inactiveResponse.json()).resolves.toMatchObject({
      code: "conflict",
      detail: "Der Hub enthaelt ein nicht mehr aktives Formular.",
    });
    const [rolledBack] = await sql<
      Array<{
        activity_count: number;
        clone_count: number;
        delivery_count: number;
        failure_audit_count: number;
        idempotency_count: number;
      }>
    >`
      select
        (select count(*)::int from hubs
          where organization_id = ${identity.organization_id}
            and title = ${`${invalidSourceTitle} (Kopie)`}) as clone_count,
        (select count(*)::int from activity_events
          where metadata ->> 'sourceHubId' = ${invalidSourceHubId}
            and metadata ->> 'operation' = 'hub.cloned') as activity_count,
        (select count(*)::int from webhook_deliveries
          where webhook_id = ${webhookId}
            and payload #>> '{data,clonedFromId}' = ${invalidSourceHubId}) as delivery_count,
        (select count(*)::int from api_audit_logs
          where request_id = ${requestIds[5]}
            and action = 'hub.clone'
            and response_status = 409) as failure_audit_count,
        (select count(*)::int from api_idempotency_keys
          where api_key_id = ${identity.api_key_id}
            and key = ${inactiveFormKey}) as idempotency_count
    `;
    expect(rolledBack).toEqual({
      activity_count: 0,
      clone_count: 0,
      delivery_count: 0,
      failure_audit_count: 1,
      idempotency_count: 0,
    });
  } finally {
    if (slugRaceRequest && !slugRaceCloneId) {
      try {
        const response = await slugRaceRequest;
        if (response.status() === 201) {
          const body = (await response.json()) as { data?: { id?: string } };
          if (body.data?.id) cloneIds.push(body.data.id);
        }
      } catch {
        // The regular cleanup below still removes the blocker and request state.
      }
    }
    await sql`
      delete from api_audit_logs
      where request_id = any(${requestIds}::uuid[])
    `;
    await sql`
      delete from api_idempotency_keys
      where key = any(${[
        cloneKey,
        slugRaceKey,
        tenantKey,
        inactiveFormKey,
      ]})
    `;
    if (cloneIds.length) {
      await sql`
        delete from activity_events
        where entity_id = any(${cloneIds}::uuid[])
      `;
      await sql`delete from hubs where id = any(${cloneIds}::uuid[])`;
    }
    if (invalidSourceHubId) {
      await sql`delete from hubs where id = ${invalidSourceHubId}`;
    }
    if (slugRaceBlockerId) {
      await sql`delete from hubs where id = ${slugRaceBlockerId}`;
    }
    if (inactiveFormId) {
      await sql`delete from data_forms where id = ${inactiveFormId}`;
    }
    if (profileDefinitionId) {
      await sql`
        delete from data_profile_definitions where id = ${profileDefinitionId}
      `;
    }
    if (foreignOrganizationId) {
      await sql`delete from organizations where id = ${foreignOrganizationId}`;
    }
    if (webhookId) await sql`delete from webhooks where id = ${webhookId}`;
    await sql.end({ timeout: 5 });
  }
});
