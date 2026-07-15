import { createHmac, randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";
const demoPassword = "Demo123!";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("E-Mail-Adresse").fill(email);
  await page.getByLabel("Passwort", { exact: true }).fill(demoPassword);
  await page.getByRole("button", { name: /anmelden$/ }).click();
  await page.waitForURL("**/admin");
}

function privacyStepUpKeyHash(organizationId: string, userId: string) {
  const secret =
    process.env.AUTH_RATE_LIMIT_SECRET?.trim() ||
    process.env.SESSION_SECRET?.trim() ||
    "q-academy-local-development-secret-change-me";
  const material = [
    "v1",
    "privacy_step_up",
    `${organizationId}\0${userId}`,
    "",
  ].join("\0");
  return createHmac("sha256", secret).update(material).digest("hex");
}

test("privacy case UI is owner-only and password step-up fails closed", async ({
  page,
}, testInfo) => {
  const sql = postgres(databaseUrl, { max: 1, prepare: false });
  const requestId = randomUUID();
  const clientRequestId = `DSAR-E2E-${randomUUID()}`;
  let organizationId = "";
  let ownerId = "";

  try {
    const [fixture] = await sql<
      Array<{
        organization_id: string;
        owner_id: string;
        subject_id: string;
      }>
    >`
      select
        owner.organization_id,
        owner.id as owner_id,
        subject.id as subject_id
      from users owner
      join users subject
        on subject.organization_id = owner.organization_id
       and subject.email = 'lea@q-academy.de'
      where owner.email = 'admin@q-academy.de'
        and owner.role = 'owner'
        and owner.status = 'active'
      limit 1
    `;
    expect(fixture).toBeTruthy();
    organizationId = fixture.organization_id;
    ownerId = fixture.owner_id;
    await sql`
      insert into privacy_requests (
        id, organization_id, subject_user_id, subject_reference,
        requested_by_id, client_request_id, type, status, due_at,
        policy_version, policy_snapshot
      ) values (
        ${requestId}, ${organizationId}, ${fixture.subject_id},
        ${"a".repeat(64)}, ${ownerId}, ${clientRequestId},
        'access_export', 'received', now() + interval '30 days',
        'privacy-dsar-v1', ${sql.json({ fixture: true })}
      )
    `;

    await login(page, "admin@q-academy.de");
    await page.goto("/admin/privacy");
    await expect(
      page.getByRole("heading", { name: "Datenschutzfälle" }),
    ).toBeVisible();
    await expect(page.getByText(clientRequestId, { exact: true })).toBeVisible();
    await page.getByText(clientRequestId, { exact: true }).click();
    await expect(page).toHaveURL(`/admin/privacy/${requestId}`);
    await expect(
      page.getByRole("heading", { name: clientRequestId }),
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath(`privacy-detail-${testInfo.project.name}.png`),
      fullPage: true,
    });

    await page
      .getByRole("button", { name: "Bestätigen", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Aktuelles Owner-Passwort").fill("Wrong123!");
    await dialog
      .getByRole("button", { name: "Bestätigen", exact: true })
      .click();
    await expect(dialog.getByRole("status")).toContainText(
      "Das aktuelle Owner-Passwort ist nicht korrekt.",
    );
    const [unchanged] = await sql<Array<{ status: string; event_count: number }>>`
      select r.status, count(e.id)::int as event_count
      from privacy_requests r
      left join privacy_request_events e
        on e.request_id = r.id and e.organization_id = r.organization_id
      where r.id = ${requestId} and r.organization_id = ${organizationId}
      group by r.status
    `;
    expect(unchanged).toEqual({ status: "received", event_count: 0 });

    await page.context().clearCookies();
    await login(page, "sarah@q-academy.de");
    await page.goto(`/admin/privacy/${requestId}`);
    await expect(page).toHaveURL(/\/academy$/);
    await expect(
      page.getByRole("link", { name: "Datenschutz" }),
    ).toHaveCount(0);

    await page.context().clearCookies();
    await login(page, "marco@q-academy.de");
    await page.goto("/admin/privacy");
    await expect(page).toHaveURL(/\/academy$/);
  } finally {
    if (organizationId) {
      await sql`
        delete from privacy_requests
        where id = ${requestId} and organization_id = ${organizationId}
      `;
    }
    if (organizationId && ownerId) {
      await sql`
        delete from auth_rate_limits
        where action = 'privacy_step_up'
          and key_hash = ${privacyStepUpKeyHash(organizationId, ownerId)}
      `;
    }
    await sql.end({ timeout: 5 });
  }
});

test("privacy events are append-only and tenant-bound", async ({}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "database privacy invariants");
  const sql = postgres(databaseUrl, { max: 1, prepare: false });
  class RollbackFixture extends Error {}
  let assertions = 0;
  try {
    await sql.begin(async (tx) => {
      const [fixture] = await tx<
        Array<{ organization_id: string; subject_id: string }>
      >`
        select
          owner.organization_id,
          subject.id as subject_id
        from users owner
        join users subject
          on subject.organization_id = owner.organization_id
         and subject.email = 'lea@q-academy.de'
        where owner.email = 'admin@q-academy.de'
        limit 1
      `;
      if (!fixture) throw new Error("Privacy fixture is missing.");
      const [foreignOrganization] = await tx<Array<{ id: string }>>`
        insert into organizations (name, slug)
        values ('Privacy foreign', ${`privacy-foreign-${randomUUID()}`})
        returning id
      `;
      const [foreignUser] = await tx<Array<{ id: string }>>`
        insert into users (
          organization_id, email, password_hash, first_name, last_name,
          role, status
        ) values (
          ${foreignOrganization.id}, ${`foreign-${randomUUID()}@example.test`},
          'unused', 'Foreign', 'Subject', 'member', 'active'
        ) returning id
      `;
      const requestId = randomUUID();
      await tx`
        insert into privacy_requests (
          id, organization_id, subject_user_id, subject_reference,
          client_request_id, type, status, due_at
        ) values (
          ${requestId}, ${fixture.organization_id}, ${fixture.subject_id},
          ${"b".repeat(64)}, ${`DSAR-INVARIANT-${requestId}`},
          'erasure', 'received', now() + interval '30 days'
        )
      `;
      const [event] = await tx<Array<{ id: string }>>`
        insert into privacy_request_events (
          organization_id, request_id, actor_reference, event, to_status
        ) values (
          ${fixture.organization_id}, ${requestId}, ${"c".repeat(64)},
          'request.received', 'received'
        ) returning id
      `;

      await expect(
        tx.savepoint(async (savepoint) => {
          await savepoint`
            update privacy_request_events
            set event = 'tampered'
            where id = ${event.id}
          `;
        }),
      ).rejects.toMatchObject({ code: "55000" });
      assertions += 1;
      await expect(
        tx.savepoint(async (savepoint) => {
          await savepoint`
            delete from privacy_request_events where id = ${event.id}
          `;
        }),
      ).rejects.toMatchObject({ code: "55000" });
      assertions += 1;
      await expect(
        tx.savepoint(async (savepoint) => {
          await savepoint`
            update privacy_requests
            set subject_user_id = ${foreignUser.id}
            where id = ${requestId}
          `;
        }),
      ).rejects.toMatchObject({ code: "23503" });
      assertions += 1;
      throw new RollbackFixture();
    });
  } catch (error) {
    if (!(error instanceof RollbackFixture)) throw error;
  } finally {
    await sql.end({ timeout: 5 });
  }
  expect(assertions).toBe(3);
});
