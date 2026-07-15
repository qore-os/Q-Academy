import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { completeMemberWelcomeIfVisible } from "./helpers/member-welcome";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";

test("member manages profile, custom fields and active sessions", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Focused profile lifecycle runs once");
  test.setTimeout(75_000);
  const client = postgres(databaseUrl, { prepare: false });
  const suffix = randomUUID().slice(0, 8);
  const email = `profile-${suffix}@example.com`;
  const fieldLabel = `Expertise ${suffix}`;
  let memberId = "";
  let fieldId = "";
  let secondarySessionId = "";

  try {
    const [fixture] = await client<
      { organization_id: string; password_hash: string }[]
    >`
      select organization_id, password_hash
      from users
      where email = 'lea@q-academy.de'
      limit 1
    `;
    const [member] = await client<{ id: string }[]>`
      insert into users (
        organization_id, email, password_hash, first_name, last_name,
        role, status, department
      ) values (
        ${fixture.organization_id}, ${email}, ${fixture.password_hash},
        'Profil', ${`Tester ${suffix}`}, 'member', 'active', 'E2E'
      ) returning id
    `;
    memberId = member.id;
    const [field] = await client<{ id: string }[]>`
      insert into custom_field_definitions (
        organization_id, key, label, description, type, category,
        required, options, active, sort_order
      ) values (
        ${fixture.organization_id}, ${`expertise_${suffix}`}, ${fieldLabel},
        'Temporare Selbstauskunft.', 'text', 'E2E Profil', false, '[]'::jsonb,
        true, 9999
      ) returning id
    `;
    fieldId = field.id;

    await page.goto("/login");
    await page.getByLabel("E-Mail-Adresse").fill(email);
    await page.getByLabel("Passwort", { exact: true }).fill("Demo123!");
    await page.getByRole("button", { name: "Bei Q-Academy anmelden" }).click();
    await page.waitForURL("**/academy");
    await completeMemberWelcomeIfVisible(page);
    await page.goto("/academy/profile");
    await expect(page.getByRole("heading", { name: "Mein Profil" })).toBeVisible();

    await page.getByLabel("Vorname").fill("Aktualisiert");
    await page.getByLabel("Position").fill("Learning Specialist");
    await page.getByLabel("Telefonnummer").fill("+49 (170) 123-4567");
    await page.getByLabel("Kurzprofil").fill("Profilpflege aus dem E2E-Test.");
    await page.getByRole("button", { name: "Profil speichern" }).click();
    await expect(page.getByText("Profil gespeichert.", { exact: true })).toBeVisible();

    await page.getByLabel("Community per E-Mail").uncheck();
    await page.getByRole("button", { name: "Einstellungen speichern" }).click();
    await expect(
      page.getByText("Benachrichtigungen gespeichert.", { exact: true }),
    ).toBeVisible();
    await expect(page.getByLabel("Community per In-App")).toBeChecked();
    await expect(page.getByLabel("Community per In-App")).toBeDisabled();

    await page.getByLabel(fieldLabel).fill("Adaptive Lernpfade");
    await page.getByRole("button", { name: "Profilfelder speichern" }).click();
    await expect(
      page.getByText("Profilfelder wurden gespeichert.", { exact: true }),
    ).toBeVisible();

    const [profile] = await client<
      {
        first_name: string;
        job_title: string;
        phone: string;
        bio: string;
        value: string;
        email_enabled: boolean;
        push_enabled: boolean;
      }[]
    >`
      select u.first_name, u.job_title, u.phone, u.bio,
             cfv.value #>> '{}' as value,
             preference.email_enabled, preference.push_enabled
      from users u
      inner join custom_field_values cfv on cfv.user_id = u.id
      inner join user_notification_preferences preference
        on preference.user_id = u.id
       and preference.organization_id = u.organization_id
       and preference.category = 'community'
      where u.id = ${memberId} and cfv.field_id = ${fieldId}
    `;
    expect(profile).toMatchObject({
      first_name: "Aktualisiert",
      job_title: "Learning Specialist",
      phone: "+491701234567",
      bio: "Profilpflege aus dem E2E-Test.",
      value: "Adaptive Lernpfade",
      email_enabled: false,
      push_enabled: true,
    });

    const [secondarySession] = await client<{ id: string }[]>`
      insert into user_sessions (
        organization_id, user_id, jti_hash, ip_address, user_agent, expires_at
      ) values (
        ${fixture.organization_id}, ${memberId}, ${randomUUID().replaceAll("-", "")},
        '203.0.113.42',
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile Safari/605.1',
        now() + interval '1 day'
      ) returning id
    `;
    secondarySessionId = secondarySession.id;
    await page.reload();
    await expect(page.getByText("2 angemeldete Geraete")).toBeVisible();
    await page.getByRole("button", { name: "Beenden" }).click();
    await expect(page.getByText("Sitzung beendet.", { exact: true })).toBeVisible();
    const [revoked] = await client<{ revoked: boolean }[]>`
      select revoked_at is not null as revoked
      from user_sessions where id = ${secondarySessionId}
    `;
    expect(revoked.revoked).toBe(true);

    await page.getByLabel("Aktuelles Passwort").fill("Falsch123!");
    await page.getByLabel("Neues Passwort").fill("NeuesDemo123!");
    await page.getByLabel("Passwort bestaetigen").fill("NeuesDemo123!");
    await page.getByRole("button", { name: "Passwort aendern" }).click();
    await expect(page.getByText("Das aktuelle Passwort ist nicht korrekt.")).toBeVisible();
  } finally {
    if (memberId) {
      await client`delete from activity_events where entity_id = ${memberId}`;
      await client`delete from users where id = ${memberId}`;
    }
    if (fieldId) {
      await client`delete from activity_events where entity_id = ${fieldId}`;
      await client`delete from custom_field_definitions where id = ${fieldId}`;
    }
    await client.end();
  }
});

test("profile page fits the mobile viewport", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "Mobile-only layout assertion");
  await page.goto("/login");
  await page.getByRole("button", { name: /Lernenden-Demo|Als Mitglied testen/ }).click();
  await page.waitForURL("**/academy");
  await completeMemberWelcomeIfVisible(page);
  await page.goto("/academy/profile");
  await expect(page.getByRole("heading", { name: "Mein Profil" })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(1);
  await page.screenshot({
    path: testInfo.outputPath("profile-mobile.png"),
    fullPage: true,
  });
});
