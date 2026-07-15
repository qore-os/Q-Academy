import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";
import postgres from "postgres";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";

test("organization admin selects the native start without crossing tenants", async ({
  page,
}) => {
  const sql = postgres(databaseUrl, { prepare: false });
  const foreignOrganizationId = randomUUID();
  let organizationId = "";
  let original: postgres.JSONValue = null;
  let originalExists = false;
  try {
    const [organization] = await sql<Array<{ id: string }>>`
      select id from organizations where slug = 'q-academy' limit 1
    `;
    organizationId = organization.id;
    const [current] = await sql<
      Array<{ value: { destination?: string } | null }>
    >`
      select value from platform_settings
      where organization_id = ${organizationId}
        and key = 'native_start_destination'
    `;
    originalExists = Boolean(current);
    original = current?.value;
    const targetDestination =
      current?.value?.destination === "community" ? "dashboard" : "community";
    const targetLabel =
      targetDestination === "community" ? "Community" : "Dashboard";
    await sql`
      insert into organizations (id, name, slug)
      values (${foreignOrganizationId}, 'Native start foreign', ${`native-start-${foreignOrganizationId.slice(0, 8)}`})
    `;
    await sql`
      insert into platform_settings (organization_id, key, value)
      values (
        ${foreignOrganizationId},
        'native_start_destination',
        ${sql.json({ destination: "dashboard" })}
      )
    `;

    await page.goto("/login");
    await page.getByRole("button", { name: /Admin-Demo|Als Admin testen/i }).click();
    await page.waitForURL("**/admin");
    await page.goto("/admin/settings#app-start");
    const form = page.locator("form#app-start");
    await expect(form).toBeVisible();
    await form.getByRole("radio", { name: targetLabel }).check();
    await form.getByRole("button", { name: "App-Start speichern" }).click();
    await expect(form.getByText("App-Start gespeichert.", { exact: true })).toBeVisible();
    await expect(
      form.getByRole("button", { name: "App-Start speichern" }),
    ).toBeDisabled();

    const [stored] = await sql<Array<{ destination: string }>>`
      select value->>'destination' as destination
      from platform_settings
      where organization_id = ${organizationId}
        and key = 'native_start_destination'
    `;
    expect(stored.destination).toBe(targetDestination);
    const [foreign] = await sql<Array<{ destination: string }>>`
      select value->>'destination' as destination
      from platform_settings
      where organization_id = ${foreignOrganizationId}
        and key = 'native_start_destination'
    `;
    expect(foreign.destination).toBe("dashboard");
    const [audit] = await sql<Array<{ value: number }>>`
      select count(*)::int as value from activity_events
      where organization_id = ${organizationId}
        and type = 'platform.native_start.updated'
        and metadata->>'destination' = ${targetDestination}
    `;
    expect(audit.value).toBeGreaterThan(0);
  } finally {
    if (organizationId) {
      await sql`
        delete from activity_events
        where organization_id = ${organizationId}
          and type = 'platform.native_start.updated'
      `;
      if (originalExists) {
        await sql`
          insert into platform_settings (organization_id, key, value)
          values (${organizationId}, 'native_start_destination', ${sql.json(original)})
          on conflict (organization_id, key)
          do update set value = excluded.value, updated_at = now()
        `;
      } else {
        await sql`
          delete from platform_settings
          where organization_id = ${organizationId}
            and key = 'native_start_destination'
        `;
      }
    }
    await sql`delete from organizations where id = ${foreignOrganizationId}`;
    await sql.end();
  }
});

test("trainer cannot manage the native organization start", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Authorization runs once");
  await page.goto("/login");
  await page.getByLabel("E-Mail-Adresse").fill("marco@q-academy.de");
  await page.getByLabel("Passwort", { exact: true }).fill("Demo123!");
  await page.getByRole("button", { name: /bei .* anmelden/i }).click();
  await page.waitForURL("**/admin");
  await page.goto("/admin/settings#app-start");
  await expect(page).toHaveURL((url) => url.pathname === "/admin/courses");
  await expect(page.locator("form#app-start")).toHaveCount(0);
});
