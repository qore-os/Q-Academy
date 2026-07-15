import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { completeMemberWelcomeIfVisible } from "./helpers/member-welcome";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";

async function loginAsOwner(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page
    .getByRole("button", { name: /Admin-Demo|Als Admin testen/i })
    .click();
  await page.waitForURL("**/admin");
}

test("event rescheduling and cancellation are revisioned and notify the audience", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Lifecycle workflow runs once");
  test.setTimeout(90_000);
  const client = postgres(databaseUrl, { prepare: false });
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const memberEmail = `event-lifecycle-${suffix}@example.com`;
  const title = `Lifecycle Workshop ${suffix}`;
  let eventId = "";
  let memberId = "";
  let otherOrganizationId = "";
  const tenantAuditRequestId = randomUUID();

  try {
    const [fixture] = await client<
      { organization_id: string; owner_id: string; password_hash: string }[]
    >`
      select owner.organization_id, owner.id as owner_id, template.password_hash
      from users owner
      cross join users template
      where owner.email = 'admin@q-academy.de'
        and template.email = 'lea@q-academy.de'
      limit 1
    `;
    const [member] = await client<{ id: string }[]>`
      insert into users (
        organization_id, email, password_hash, first_name, last_name, role, status
      ) values (
        ${fixture.organization_id}, ${memberEmail}, ${fixture.password_hash},
        'Event', ${`Lifecycle ${suffix}`}, 'member', 'active'
      ) returning id
    `;
    memberId = member.id;
    const [event] = await client<{ id: string }[]>`
      insert into events (
        organization_id, title, description, type, starts_at, ends_at,
        meeting_url, color, audience_mode, created_by_id
      ) values (
        ${fixture.organization_id}, ${title}, 'Lifecycle E2E', 'workshop',
        '2030-01-15T09:00:00Z', '2030-01-15T11:00:00Z',
        'https://meet.example.test/lifecycle', '#4f7cac', 'restricted',
        ${fixture.owner_id}
      ) returning id
    `;
    eventId = event.id;
    await client`
      insert into event_audience_grants (organization_id, event_id, user_id)
      values (${fixture.organization_id}, ${eventId}, ${memberId})
    `;
    await client`
      insert into event_lifecycle_history (
        organization_id, event_id, actor_reference, action, to_status,
        starts_at, ends_at, revision
      ) values (
        ${fixture.organization_id}, ${eventId}, ${"0".repeat(64)},
        'created', 'scheduled', '2030-01-15T09:00:00Z',
        '2030-01-15T11:00:00Z', 0
      )
    `;

    await loginAsOwner(page);
    await page.goto("/admin/events");
    const row = page.locator(`#event-${eventId}`);
    await row.getByRole("button", { name: "Verwalten" }).click();
    const dialog = page.getByRole("dialog", { name: new RegExp(title) });
    await dialog.getByRole("tab", { name: "Status & Planung" }).click();
    await dialog.getByLabel("Neuer Beginn").fill("2030-02-01T10:00");
    await dialog.getByLabel("Neues Ende").fill("2030-02-01T12:00");
    await dialog.getByLabel("Grund", { exact: true }).fill("Trainerwechsel fuer diesen Termin.");
    await dialog.getByRole("button", { name: "Verschieben" }).click();
    await expect(page.getByText("Termin neu geplant. 1 Mitglieder wurden informiert.")).toBeVisible();
    await expect(dialog.getByText("Rev. 1", { exact: false })).toBeVisible();

    await dialog.getByLabel("Absagegrund").fill("Der Ersatztrainer ist kurzfristig verhindert.");
    await dialog.getByRole("button", { name: "Termin absagen" }).click();
    await expect(page.getByText("Termin abgesagt. 1 Mitglieder wurden informiert.")).toBeVisible();
    await expect(dialog.getByText("Abgesagt", { exact: true }).first()).toBeVisible();

    const [stored] = await client<
      { status: string; lifecycle_revision: number; starts_at: Date }[]
    >`
      select status, lifecycle_revision, starts_at from events where id = ${eventId}
    `;
    expect(stored.status).toBe("cancelled");
    expect(stored.lifecycle_revision).toBe(2);
    expect(stored.starts_at.toISOString()).toBe("2030-02-01T09:00:00.000Z");
    const history = await client<
      { action: string; revision: number; reason: string | null }[]
    >`
      select action, revision, reason
      from event_lifecycle_history
      where event_id = ${eventId}
      order by revision
    `;
    expect(history.map((entry) => [entry.action, entry.revision])).toEqual([
      ["created", 0],
      ["rescheduled", 1],
      ["cancelled", 2],
    ]);
    expect(history[2]?.reason).toBe("Der Ersatztrainer ist kurzfristig verhindert.");
    const [outbox] = await client<
      { notifications: number; emails: number; audits: number }[]
    >`
      select
        (select count(*)::int from notifications where user_id = ${memberId} and href = ${`/academy/events#event-${eventId}`}) as notifications,
        (select count(*)::int from email_deliveries where user_id = ${memberId} and event in ('event.rescheduled', 'event.cancelled')) as emails,
        (select count(*)::int from activity_events where entity_id = ${eventId} and type in ('event.rescheduled', 'event.cancelled')) as audits
    `;
    expect(outbox).toEqual({ notifications: 2, emails: 2, audits: 2 });

    const [otherOrganization] = await client<{ id: string }[]>`
      insert into organizations (name, slug)
      values (${`Lifecycle Foreign ${suffix}`}, ${`lifecycle-foreign-${suffix}`})
      returning id
    `;
    otherOrganizationId = otherOrganization.id;
    const [foreignEvent] = await client<{ id: string }[]>`
      insert into events (
        organization_id, title, starts_at, ends_at, color
      ) values (
        ${otherOrganizationId}, 'Foreign lifecycle',
        '2030-03-01T09:00:00Z', '2030-03-01T10:00:00Z', '#4f7cac'
      ) returning id
    `;
    const foreignHistory = await page.context().request.get(
      `/api/v1/events/${foreignEvent.id}/lifecycle`,
      {
        headers: {
          Authorization: `Bearer ${process.env.DEMO_API_KEY ?? "qak_demo_qacademy_2026_local_development"}`,
          "X-Request-Id": tenantAuditRequestId,
        },
      },
    );
    expect(foreignHistory.status()).toBe(404);

    await page.context().clearCookies();
    await page.goto("/login");
    await page.getByLabel("E-Mail-Adresse").fill(memberEmail);
    await page.getByLabel("Passwort", { exact: true }).fill("Demo123!");
    await page.getByRole("button", { name: /anmelden/i }).click();
    await page.waitForURL("**/academy");
    await completeMemberWelcomeIfVisible(page);
    await page.goto("/academy/events");
    const memberEvent = page.locator(`#event-${eventId}`);
    await expect(
      memberEvent.getByText("Abgesagt", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      memberEvent.locator("p").filter({ hasText: "Absagegrund:" }),
    ).toContainText("Der Ersatztrainer ist kurzfristig verhindert.");
    await expect(memberEvent.getByRole("button", { name: "Dabei" })).toHaveCount(0);
    await expect(memberEvent.getByRole("link", { name: "Online teilnehmen" })).toHaveCount(0);
    await memberEvent.getByText(/Statusverlauf/).click();
    await expect(memberEvent.getByText("Neu geplant", { exact: true })).toBeVisible();

    const calendarResponse = await page.context().request.get(
      `/academy/events/${eventId}/calendar`,
    );
    expect(calendarResponse.ok()).toBe(true);
    const calendar = (await calendarResponse.text()).replaceAll("\r\n ", "");
    expect(calendar).toContain("METHOD:CANCEL");
    expect(calendar).toContain("SEQUENCE:2");
    expect(calendar).toContain("STATUS:CANCELLED");
  } finally {
    if (memberId) {
      await client`delete from notifications where user_id = ${memberId} and href = ${`/academy/events#event-${eventId}`}`;
      await client`delete from email_deliveries where user_id = ${memberId} and event in ('event.rescheduled', 'event.cancelled')`;
    }
    if (eventId) {
      await client`delete from activity_events where entity_id = ${eventId}`;
      // Lifecycle evidence is append-only. The isolated E2E event remains as
      // retained audit evidence and cannot be directly deleted by design.
    }
    await client`delete from api_audit_logs where request_id = ${tenantAuditRequestId}`;
    if (otherOrganizationId) {
      await client`delete from organizations where id = ${otherOrganizationId}`;
    }
    if (memberId) await client`delete from users where id = ${memberId}`;
    await client.end();
  }
});
