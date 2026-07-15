import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { neutralizeSpreadsheetCell } from "../src/lib/event-csv";
import { completeMemberWelcomeIfVisible } from "./helpers/member-welcome";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";

async function loginAsOwner(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: /Admin-Demo|Als Admin testen/ }).click();
  await page.waitForURL("**/admin");
}

test("event CSV cells neutralize spreadsheet formula prefixes", ({}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "CSV unit contract runs once");
  expect(neutralizeSpreadsheetCell("=1+1")).toBe("'=1+1");
  expect(neutralizeSpreadsheetCell("  +SUM(A1:A2)")).toBe(
    "'  +SUM(A1:A2)",
  );
  expect(neutralizeSpreadsheetCell(" -2")).toBe("' -2");
  expect(neutralizeSpreadsheetCell("\t@command")).toBe("'\t@command");
  expect(neutralizeSpreadsheetCell("  \rvalue")).toBe("'  \rvalue");
  expect(neutralizeSpreadsheetCell("Sicherer Text")).toBe("Sicherer Text");
});

test("admin manages event details, capacity and attendance", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Focused event lifecycle runs once");
  test.setTimeout(75_000);
  const client = postgres(databaseUrl, { prepare: false });
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const initialTitle = `E2E Workshop ${suffix}`;
  const updatedTitle = `${initialTitle} Aktualisiert`;
  let eventId = "";
  const memberIds: string[] = [];

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
    expect(fixture).toBeTruthy();

    for (const index of [1, 2]) {
      const [member] = await client<{ id: string }[]>`
        insert into users (
          organization_id, email, password_hash, first_name, last_name, role, status
        ) values (
          ${fixture.organization_id},
          ${`event-${index}-${suffix}@example.com`},
          ${fixture.password_hash},
          ${`Event${index}`},
          ${`Tester ${suffix}`},
          'member',
          'active'
        ) returning id
      `;
      memberIds.push(member.id);
    }

    const [event] = await client<{ id: string }[]>`
      insert into events (
        organization_id, title, description, type, starts_at, ends_at,
        location, color, capacity, audience_mode, created_by_id
      ) values (
        ${fixture.organization_id}, ${initialTitle}, 'Temporarer Verwaltungstest.',
        'workshop', now() + interval '5 days', now() + interval '5 days 2 hours',
        'Raum E2E', '#4f7cac', 1, 'restricted', ${fixture.owner_id}
      ) returning id
    `;
    eventId = event.id;
    await client`
      insert into event_audience_grants (organization_id, event_id, user_id)
      select ${fixture.organization_id}, ${eventId}, id
      from users
      where id = any(${memberIds}::uuid[])
    `;

    await loginAsOwner(page);
    await page.goto("/admin/events");
    const row = page.locator(`#event-${eventId}`);
    await expect(row).toContainText(initialTitle);
    await row.getByRole("button", { name: "Verwalten" }).click();

    const dialog = page.getByRole("dialog", { name: new RegExp(initialTitle) });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Titel").fill(updatedTitle);
    await dialog.getByLabel("Ort").fill("Studio 4");
    await dialog
      .getByRole("textbox", { name: "Beginn", exact: true })
      .fill("2030-01-15T10:30");
    await dialog.getByLabel("Ende", { exact: true }).fill("2030-01-15T12:00");
    await dialog
      .getByRole("textbox", { name: "Grund bei Zeitänderung" })
      .fill("E2E prueft die nachvollziehbare Terminverschiebung.");
    await dialog.getByRole("button", { name: "Speichern" }).click();
    await expect(page.getByText("Termin gespeichert.", { exact: true })).toBeVisible();
    await expect(row).toContainText(updatedTitle);
    const [storedTimes] = await client<
      { starts_at: Date; ends_at: Date }[]
    >`
      select starts_at, ends_at from events where id = ${eventId}
    `;
    expect(storedTimes.starts_at.toISOString()).toBe(
      "2030-01-15T09:30:00.000Z",
    );
    expect(storedTimes.ends_at.toISOString()).toBe(
      "2030-01-15T11:00:00.000Z",
    );

    await dialog.getByRole("tab", { name: /Teilnehmende/ }).click();
    await dialog.getByLabel("Mitglied auswählen").selectOption(memberIds[0]);
    await dialog.getByLabel("Teilnahmestatus setzen").selectOption("going");
    await dialog.getByRole("button", { name: "Setzen" }).click();
    await expect(
      page.getByText("Teilnahmestatus gespeichert.", { exact: true }),
    ).toBeVisible();
    await expect(
      dialog.getByText(`Event1 Tester ${suffix}`, { exact: true }),
    ).toBeVisible();

    await dialog.getByLabel("Mitglied auswählen").selectOption(memberIds[1]);
    await dialog.getByLabel("Teilnahmestatus setzen").selectOption("going");
    await dialog.getByRole("button", { name: "Setzen" }).click();
    await expect(page.getByText("Der Termin ist bereits ausgebucht.")).toBeVisible();

    await dialog.getByLabel("Teilnahmestatus setzen").selectOption("maybe");
    await dialog.getByRole("button", { name: "Setzen" }).click();
    await expect(
      dialog.getByText(`Event2 Tester ${suffix}`, { exact: true }),
    ).toBeVisible();
    const csvLink = dialog.getByRole("link", { name: "CSV" });
    await expect(csvLink).toBeVisible();
    await expect(csvLink).toHaveAttribute(
      "href",
      `/admin/events/${eventId}/attendees.csv`,
    );
    await client`
      update users set first_name = '  =CMD()' where id = ${memberIds[0]}
    `;
    const csvResponse = await page.context().request.get(
      `/admin/events/${eventId}/attendees.csv`,
    );
    expect(csvResponse.ok()).toBe(true);
    expect(csvResponse.headers()["content-type"]).toContain("text/csv");
    expect(csvResponse.headers()["cache-control"]).toContain("no-store");
    expect(await csvResponse.text()).toContain(`"'  =CMD()"`);

    const attendance = await client<{ user_id: string; status: string }[]>`
      select user_id, status
      from event_attendees
      where event_id = ${eventId}
      order by user_id
    `;
    expect(attendance).toHaveLength(2);
    expect(attendance.filter((row) => row.status === "going")).toHaveLength(1);
    expect(attendance.filter((row) => row.status === "maybe")).toHaveLength(1);

    await dialog.getByRole("tab", { name: "Status & Planung" }).click();
    await dialog.getByLabel("Absagegrund").fill("E2E prueft die revisionssichere Absage.");
    await dialog.getByRole("button", { name: "Termin absagen" }).click();
    await expect(page.getByText(/Termin abgesagt\./)).toBeVisible();
    await expect(row).toContainText("Abgesagt");
  } finally {
    // Rescheduled event evidence is append-only and intentionally retained.
    if (memberIds.length) {
      await client`delete from users where id = any(${memberIds}::uuid[])`;
    }
    await client.end();
  }
});

test("event audiences protect member UI, RSVP, ICS and REST access", async ({
  page,
  request,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Audience lifecycle runs once");
  test.setTimeout(120_000);
  const client = postgres(databaseUrl, { prepare: false });
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const apiKey =
    process.env.DEMO_API_KEY ?? "qak_demo_qacademy_2026_local_development";
  const apiRequestId = randomUUID();
  const apiHeaders = {
    Authorization: `Bearer ${apiKey}`,
    "X-Request-Id": apiRequestId,
  };
  const targetTitle = `E2E Zielgruppen, Kalender; ${suffix} mit sehr langem Titel fuer Faltung`;
  const groupName = `Event Gruppe ${suffix}`;
  const bundleName = `Event Bundle ${suffix}`;
  const memberIds: string[] = [];
  const eventIds: string[] = [];
  const idempotencyKeys = [
    `event-audience-patch-${suffix}`,
    `event-audience-attendee-${suffix}`,
    `event-delete-rejected-${suffix}`,
  ];
  let organizationId = "";
  let groupId = "";
  let bundleId = "";
  let otherOrganizationId = "";

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
    organizationId = fixture.organization_id;

    for (const kind of ["Direct", "Group", "Bundle", "Denied"]) {
      const [member] = await client<{ id: string }[]>`
        insert into users (
          organization_id, email, password_hash, first_name, last_name, role, status
        ) values (
          ${organizationId},
          ${`${kind.toLowerCase()}-${suffix}@example.com`},
          ${fixture.password_hash},
          ${kind},
          ${`Event ${suffix}`},
          'member',
          'active'
        ) returning id
      `;
      memberIds.push(member.id);
    }
    const [directMemberId, groupMemberId, bundleMemberId, deniedMemberId] =
      memberIds;

    const [group] = await client<{ id: string }[]>`
      insert into groups (organization_id, name)
      values (${organizationId}, ${groupName})
      returning id
    `;
    groupId = group.id;
    await client`
      insert into group_members (group_id, user_id)
      values (${groupId}, ${groupMemberId})
    `;

    const [bundle] = await client<{ id: string }[]>`
      insert into bundles (organization_id, name)
      values (${organizationId}, ${bundleName})
      returning id
    `;
    bundleId = bundle.id;
    await client`
      insert into member_bundles (user_id, bundle_id)
      values (${bundleMemberId}, ${bundleId})
    `;

    const [targetEvent, liveEvent, expiredEvent] = await client<
      { id: string }[]
    >`
      insert into events (
        organization_id, title, description, type, starts_at, ends_at,
        meeting_url, location, color, capacity, created_by_id
      ) values
      (
        ${organizationId}, ${targetTitle}, ${"Zeile eins,\nZeile zwei; mit \\ Test."},
        'workshop', '2030-01-15T09:30:00Z', '2030-01-15T11:00:00Z',
        'https://meet.example.com/audience', 'Berlin, Raum; 4', '#4f7cac', 12,
        ${fixture.owner_id}
      ),
      (
        ${organizationId}, ${`E2E Live ${suffix}`}, 'Aktuell laufender Termin.',
        'live_call', now() - interval '5 minutes', now() + interval '55 minutes',
        null, 'Online', '#2bb7a9', null, ${fixture.owner_id}
      ),
      (
        ${organizationId}, ${`E2E Abgelaufen ${suffix}`}, 'Vergangener Termin.',
        'webinar', now() - interval '2 hours', now() - interval '1 hour',
        null, 'Online', '#ee6c5d', null, ${fixture.owner_id}
      )
      returning id
    `;
    eventIds.push(targetEvent.id, liveEvent.id, expiredEvent.id);

    const [otherOrganization] = await client<{ id: string }[]>`
      insert into organizations (name, slug)
      values (${`Other Events ${suffix}`}, ${`other-events-${suffix}`})
      returning id
    `;
    otherOrganizationId = otherOrganization.id;
    const [otherUser] = await client<{ id: string }[]>`
      insert into users (
        organization_id, email, password_hash, first_name, last_name, role, status
      ) values (
        ${otherOrganizationId}, ${`other-${suffix}@example.com`},
        ${fixture.password_hash}, 'Other', 'Member', 'member', 'active'
      ) returning id
    `;
    const [otherGroup] = await client<{ id: string }[]>`
      insert into groups (organization_id, name)
      values (${otherOrganizationId}, ${`Other Group ${suffix}`})
      returning id
    `;
    const [otherBundle] = await client<{ id: string }[]>`
      insert into bundles (organization_id, name)
      values (${otherOrganizationId}, ${`Other Bundle ${suffix}`})
      returning id
    `;

    await loginAsOwner(page);
    await page.goto("/admin/events");
    const adminRow = page.locator(`#event-${targetEvent.id}`);
    await adminRow.getByRole("button", { name: "Verwalten" }).click();
    const dialog = page.getByRole("dialog", { name: new RegExp(suffix) });
    await dialog.getByRole("tab", { name: "Zielgruppe" }).click();
    await dialog
      .getByLabel("Ausgewählte Zielgruppen", { exact: false })
      .check();
    await dialog.getByLabel(`Direct Event ${suffix}`, { exact: true }).check();
    await dialog.getByLabel(groupName, { exact: true }).check();
    await dialog.getByLabel(bundleName, { exact: true }).check();
    await dialog.getByRole("button", { name: "Zielgruppe speichern" }).click();
    await expect(page.getByText("Zielgruppe gespeichert.", { exact: true })).toBeVisible();

    const [storedEvent] = await client<{ audience_mode: string }[]>`
      select audience_mode from events where id = ${targetEvent.id}
    `;
    expect(storedEvent.audience_mode).toBe("restricted");
    const grants = await client<
      { organization_id: string; user_id: string | null; group_id: string | null; bundle_id: string | null }[]
    >`
      select organization_id, user_id, group_id, bundle_id
      from event_audience_grants
      where event_id = ${targetEvent.id}
      order by created_at
    `;
    expect(grants).toHaveLength(3);
    expect(grants.every((grant) => grant.organization_id === organizationId)).toBe(true);
    expect(grants.some((grant) => grant.user_id === directMemberId)).toBe(true);
    expect(grants.some((grant) => grant.group_id === groupId)).toBe(true);
    expect(grants.some((grant) => grant.bundle_id === bundleId)).toBe(true);

    await page.context().clearCookies();
    await page.goto("/login");
    await page.getByLabel("E-Mail-Adresse").fill(`direct-${suffix}@example.com`);
    await page.getByLabel("Passwort", { exact: true }).fill("Demo123!");
    await page.getByRole("button", { name: /anmelden/i }).click();
    await page.waitForURL("**/academy");
    await completeMemberWelcomeIfVisible(page);
    await page.goto("/academy/events");
    const memberRow = page.locator(`#event-${targetEvent.id}`);
    await expect(memberRow).toBeVisible();
    await expect(memberRow.getByText("Geplant", { exact: true })).toBeVisible();
    await expect(
      page.locator(`#event-${liveEvent.id}`).getByText("Live", { exact: true }),
    ).toBeVisible();
    await memberRow.getByRole("button", { name: "Dabei", exact: true }).click();
    await expect(page.getByText("Teilnahmestatus gespeichert.", { exact: true })).toBeVisible();
    const forbiddenCsv = await page.context().request.get(
      `/admin/events/${targetEvent.id}/attendees.csv`,
    );
    expect(forbiddenCsv.status()).toBe(403);

    const calendarResponse = await page.context().request.get(
      `/academy/events/${targetEvent.id}/calendar`,
    );
    expect(calendarResponse.ok()).toBe(true);
    expect(calendarResponse.headers()["content-type"]).toContain("text/calendar");
    expect(calendarResponse.headers()["cache-control"]).toContain("no-store");
    expect(calendarResponse.headers()["content-disposition"]).toBe(
      `attachment; filename="event-${targetEvent.id}.ics"`,
    );
    const calendar = await calendarResponse.text();
    const unfoldedCalendar = calendar.replaceAll("\r\n ", "");
    expect(unfoldedCalendar).toContain("DTSTART:20300115T093000Z");
    expect(unfoldedCalendar).toContain("DTEND:20300115T110000Z");
    expect(unfoldedCalendar).toContain(
      `SUMMARY:${targetTitle.replaceAll(",", "\\,").replaceAll(";", "\\;")}`,
    );
    expect(unfoldedCalendar).toContain(
      "DESCRIPTION:Zeile eins\\,\\nZeile zwei\\; mit \\\\ Test.",
    );
    for (const line of calendar.split("\r\n").filter(Boolean)) {
      expect(Buffer.byteLength(line, "utf8")).toBeLessThanOrEqual(75);
    }

    await page.getByRole("button", { name: "Vergangen" }).click();
    await expect(
      page
        .locator(`#event-${expiredEvent.id}`)
        .getByText("Abgelaufen", { exact: true }),
    ).toBeVisible();

    await page.context().clearCookies();
    await page.goto("/login");
    await page.getByLabel("E-Mail-Adresse").fill(`denied-${suffix}@example.com`);
    await page.getByLabel("Passwort", { exact: true }).fill("Demo123!");
    await page.getByRole("button", { name: /anmelden/i }).click();
    await page.waitForURL("**/academy");
    await completeMemberWelcomeIfVisible(page);
    await page.goto("/academy/events");
    await expect(page.locator(`#event-${targetEvent.id}`)).toHaveCount(0);
    const deniedCalendar = await page.context().request.get(
      `/academy/events/${targetEvent.id}/calendar`,
    );
    expect(deniedCalendar.status()).toBe(404);

    for (const eligibleUserId of [directMemberId, groupMemberId, bundleMemberId]) {
      const visible = await request.get(
        `/api/v1/events?search=${encodeURIComponent(suffix)}&userId=${eligibleUserId}`,
        { headers: apiHeaders },
      );
      expect(visible.ok()).toBe(true);
      expect((await visible.json()).data.map((event: { id: string }) => event.id)).toContain(
        targetEvent.id,
      );
    }
    const hidden = await request.get(
      `/api/v1/events?search=${encodeURIComponent(suffix)}&userId=${deniedMemberId}`,
      { headers: apiHeaders },
    );
    expect(hidden.ok()).toBe(true);
    expect((await hidden.json()).data.map((event: { id: string }) => event.id)).not.toContain(
      targetEvent.id,
    );
    const hiddenDetail = await request.get(
      `/api/v1/events/${targetEvent.id}?userId=${deniedMemberId}`,
      { headers: apiHeaders },
    );
    expect(hiddenDetail.status()).toBe(404);

    const rejectedDelete = await request.delete(
      `/api/v1/events/${targetEvent.id}`,
      {
        headers: {
          ...apiHeaders,
          "Idempotency-Key": idempotencyKeys[2],
        },
      },
    );
    expect(rejectedDelete.status()).toBe(409);
    await expect(rejectedDelete.json()).resolves.toMatchObject({
      code: "conflict",
    });

    const crossTenantPatch = await request.patch(
      `/api/v1/events/${targetEvent.id}`,
      {
        headers: {
          ...apiHeaders,
          "Idempotency-Key": idempotencyKeys[0],
        },
        data: {
          audience: {
            mode: "restricted",
            userIds: [otherUser.id],
            groupIds: [otherGroup.id],
            bundleIds: [otherBundle.id],
          },
        },
      },
    );
    expect(crossTenantPatch.status()).toBe(422);

    const deniedAttendance = await request.post(
      `/api/v1/events/${targetEvent.id}/attendees`,
      {
        headers: {
          ...apiHeaders,
          "Idempotency-Key": idempotencyKeys[1],
        },
        data: { userId: deniedMemberId, status: "going" },
      },
    );
    expect(deniedAttendance.status()).toBe(404);

    await client`
      insert into event_attendees (event_id, user_id, status)
      values (${targetEvent.id}, ${deniedMemberId}, 'going')
      on conflict (event_id, user_id) do update set status = 'going'
    `;
    const attendeeList = await request.get(
      `/api/v1/events/${targetEvent.id}/attendees`,
      { headers: apiHeaders },
    );
    expect(attendeeList.ok()).toBe(true);
    const attendees = (await attendeeList.json()).data as Array<{ userId: string }>;
    expect(attendees.map((attendee) => attendee.userId)).toContain(directMemberId);
    expect(attendees.map((attendee) => attendee.userId)).not.toContain(
      deniedMemberId,
    );
  } finally {
    await page.context().clearCookies();
    if (organizationId) {
      await client`
        delete from api_audit_logs
        where organization_id = ${organizationId}
          and request_id = ${apiRequestId}
      `;
      await client`
        delete from api_idempotency_keys
        where organization_id = ${organizationId}
          and key = any(${idempotencyKeys})
      `;
    }
    if (eventIds.length) {
      await client`delete from activity_events where entity_id = any(${eventIds}::uuid[])`;
      await client`delete from events where id = any(${eventIds}::uuid[])`;
    }
    if (groupId) await client`delete from groups where id = ${groupId}`;
    if (bundleId) await client`delete from bundles where id = ${bundleId}`;
    if (memberIds.length) {
      await client`delete from users where id = any(${memberIds}::uuid[])`;
    }
    if (otherOrganizationId) {
      await client`delete from organizations where id = ${otherOrganizationId}`;
    }
    await client.end();
  }
});

test("event management dialog fits the mobile viewport", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "Mobile-only layout assertion");
  await loginAsOwner(page);
  await page.goto("/admin/events");
  await page.getByRole("button", { name: "Verwalten" }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("tab", { name: "Status & Planung" }).click();
  await expect(dialog.getByText("Statusverlauf", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(1);
  await dialog.getByRole("tab", { name: "Zielgruppe" }).click();
  await expect(dialog.getByText("Sichtbarkeit", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(1);
  await dialog.getByRole("tab", { name: /Teilnehmende/ }).click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(1);
  await page.screenshot({
    path: testInfo.outputPath("event-management-mobile.png"),
    fullPage: true,
  });
});
