import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";

async function loginAsAdmin(page: Page) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page
    .getByRole("button", { name: /Admin-Demo|Als Admin testen/i })
    .click();
  await page.waitForURL("**/admin");
}

test("experience controls are usable on desktop and mobile", async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  const sql = postgres(databaseUrl, { max: 1, prepare: false });
  const [fixture] = await sql<
    Array<{ organization_id: string; design: postgres.JSONValue }>
  >`
    select o.id as organization_id, coalesce(ps.value, '{}'::jsonb) as design
    from organizations o
    left join platform_settings ps
      on ps.organization_id = o.id and ps.key = 'design'
    where o.slug = 'q-academy'
    limit 1
  `;
  if (!fixture) throw new Error("Demo tenant is missing.");

  try {
    await loginAsAdmin(page);

    await page.goto("/admin/settings");
    await page
      .getByRole("radiogroup", { name: "Farbschema" })
      .getByText("Dunkel", { exact: true })
      .click();
    await expect(page.getByRole("radio", { name: "Dunkel" })).toBeChecked();
    await page.getByRole("button", { name: "Design speichern" }).click();
    await expect(page.getByText("Design gespeichert.")).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-color-mode", "dark");
    await expect(page.locator("body")).toHaveCSS("background-color", "rgb(14, 19, 25)");

    await page.goto("/admin/email/templates");
    await page.getByRole("tab", { name: "ES", exact: true }).click();
    await expect(page.getByRole("tab", { name: "ES", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.getByRole("tab", { name: "FR", exact: true })).toBeVisible();

    await page.goto("/admin/announcements");
    await page.getByRole("button", { name: "Neue Ankuendigung" }).click();
    const dialog = page.getByRole("dialog", { name: "Neue Ankuendigung" });
    await dialog.getByLabel("Ankuendigungsvorlage").selectOption("learning");
    await dialog
      .getByRole("button", { name: "Vorlage uebernehmen" })
      .click();
    await expect(dialog.getByLabel("Titel")).toHaveValue(
      "Setze deinen Lernpfad fort",
    );
    await dialog.getByRole("button", { name: "Editor schliessen" }).click();

    const viewportFits = await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
    );
    expect(viewportFits).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`experience-${testInfo.project.name}.png`),
      fullPage: true,
    });
  } finally {
    await sql`
      insert into platform_settings (organization_id, key, value, updated_at)
      values (${fixture.organization_id}, 'design', ${sql.json(fixture.design)}, now())
      on conflict (organization_id, key)
      do update set value = excluded.value, updated_at = excluded.updated_at
    `;
    await sql.end();
  }
});
