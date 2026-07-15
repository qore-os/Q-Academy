import { expect, test } from "@playwright/test";
import postgres from "postgres";

import { getSettingsDataCopy } from "../src/lib/i18n/settings-data";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";
const settingsDataCopy = getSettingsDataCopy("de");

async function loginAsOwner(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: /Admin-Demo|Als Admin testen/ }).click();
  await page.waitForURL("**/admin");
}

test("owner manages typed member profile fields end to end", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium",
    "Profile-field lifecycle runs once on desktop Chromium",
  );

  const client = postgres(databaseUrl, { prepare: false });
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const keyPrefix = `e2e_${suffix.replace(/-/g, "_")}`;
  const createdFieldIds: string[] = [];
  const startedAt = new Date();

  try {
    const [member] = await client<
      {
        id: string;
        organization_id: string;
        first_name: string;
        last_name: string;
      }[]
    >`
      select id, organization_id, first_name, last_name
      from users
      where role = 'member' and status = 'active'
      order by created_at
      limit 1
    `;
    expect(member).toBeTruthy();

    await loginAsOwner(page);
    await page.goto("/admin/settings#profilfelder");
    await expect(
      page.getByRole("heading", { name: settingsDataCopy.field.managerTitle }),
    ).toBeVisible();

    await page
      .getByRole("button", { name: settingsDataCopy.field.createTitle })
      .click();
    const createDialog = page.getByRole("dialog", {
      name: settingsDataCopy.field.createTitle,
    });
    await expect(createDialog).toBeVisible();
    await createDialog.getByLabel("Bezeichnung").fill(`E2E Auswahl ${suffix}`);
    await createDialog
      .getByLabel("Technischer Key")
      .fill(`${keyPrefix}_select`);
    await createDialog.getByLabel("Feldtyp").selectOption("select");
    await createDialog.getByLabel("Kategorie").fill("E2E Profil");
    await createDialog.getByLabel("Optionen").fill("Berlin\nHamburg");
    await createDialog.getByText("Pflichtfeld", { exact: true }).click();
    await createDialog
      .getByRole("button", { name: settingsDataCopy.field.createTitle })
      .click();
    await expect(createDialog).not.toBeVisible();

    const [selectField] = await client<{ id: string }[]>`
      select id from custom_field_definitions
      where organization_id = ${member.organization_id}
        and key = ${`${keyPrefix}_select`}
    `;
    expect(selectField).toBeTruthy();
    createdFieldIds.push(selectField.id);

    let fieldRow = page
      .getByRole("row")
      .filter({ hasText: `${keyPrefix}_select` });
    await expect(fieldRow).toHaveCount(1);
    await fieldRow
      .getByRole("button", {
        name: settingsDataCopy.common.editNamed(`E2E Auswahl ${suffix}`),
      })
      .click();
    const editDialog = page.getByRole("dialog", {
      name: settingsDataCopy.field.editTitle,
    });
    await editDialog
      .getByLabel("Beschreibung")
      .fill("Wird im E2E-Profil gepflegt.");
    await editDialog
      .getByRole("button", { name: settingsDataCopy.field.saveChanges })
      .click();
    await expect(editDialog).not.toBeVisible();

    fieldRow = page.getByRole("row").filter({ hasText: `${keyPrefix}_select` });
    const activeSwitch = fieldRow.getByRole("switch", {
      name: `E2E Auswahl ${suffix} deaktivieren`,
    });
    await expect(activeSwitch).toBeChecked();
    await fieldRow.locator("label").click();
    await expect(
      fieldRow.getByRole("switch", {
        name: `E2E Auswahl ${suffix} aktivieren`,
      }),
    ).not.toBeChecked();
    await fieldRow.locator("label").click();
    await expect(
      fieldRow.getByRole("switch", {
        name: `E2E Auswahl ${suffix} deaktivieren`,
      }),
    ).toBeChecked();

    const additional = [
      { type: "text", label: `E2E Text ${suffix}`, options: [] },
      { type: "number", label: `E2E Zahl ${suffix}`, options: [] },
      { type: "boolean", label: `E2E Boolean ${suffix}`, options: [] },
      { type: "date", label: `E2E Datum ${suffix}`, options: [] },
      {
        type: "multiselect",
        label: `E2E Multi ${suffix}`,
        options: ["Alpha", "Beta"],
      },
      { type: "url", label: `E2E URL ${suffix}`, options: [] },
    ] as const;

    for (const [index, field] of additional.entries()) {
      const [created] = await client<{ id: string }[]>`
        insert into custom_field_definitions (
          organization_id, key, label, type, category, required, options, active, sort_order
        ) values (
          ${member.organization_id},
          ${`${keyPrefix}_${field.type}`},
          ${field.label},
          ${field.type}::custom_field_type,
          'E2E Profil',
          false,
          ${JSON.stringify(field.options)}::jsonb,
          true,
          ${index + 1}
        ) returning id
      `;
      createdFieldIds.push(created.id);
    }

    await page.goto(`/admin/members/${member.id}`);
    await expect(
      page.getByRole("heading", {
        name: `${member.first_name} ${member.last_name}`,
        level: 1,
      }),
    ).toBeVisible();
    await page.getByLabel(`E2E Text ${suffix}`).fill("Team Nord");
    await page.getByLabel(`E2E Zahl ${suffix}`).fill("42.5");
    await page.locator(`input[name="field:${createdFieldIds[3]}"]`).check();
    await page.getByLabel(`E2E Datum ${suffix}`).fill("2026-07-10");
    await page.getByLabel(`E2E Auswahl ${suffix}`).selectOption("Berlin");
    const multiGroup = page.getByRole("group", {
      name: `E2E Multi ${suffix}`,
    });
    await multiGroup.getByLabel("Alpha").check();
    await multiGroup.getByLabel("Beta").check();
    await page
      .getByLabel(`E2E URL ${suffix}`)
      .fill("https://example.com/profile");
    await page.getByRole("button", { name: "Profilfelder speichern" }).click();
    await expect(
      page.getByText("Profilfelder wurden gespeichert.", { exact: true }),
    ).toBeVisible();

    const savedValues = await client<{ key: string; value: unknown }[]>`
      select d.key, v.value
      from custom_field_values v
      inner join custom_field_definitions d on d.id = v.field_id
      where v.user_id = ${member.id}
        and d.key like ${`${keyPrefix}%`}
      order by d.key
    `;
    expect(
      Object.fromEntries(savedValues.map((entry) => [entry.key, entry.value])),
    ).toMatchObject({
      [`${keyPrefix}_boolean`]: true,
      [`${keyPrefix}_date`]: "2026-07-10",
      [`${keyPrefix}_multiselect`]: ["Alpha", "Beta"],
      [`${keyPrefix}_number`]: 42.5,
      [`${keyPrefix}_select`]: "Berlin",
      [`${keyPrefix}_text`]: "Team Nord",
      [`${keyPrefix}_url`]: "https://example.com/profile",
    });

    await page.goto("/admin/settings#profilfelder");
    fieldRow = page.getByRole("row").filter({ hasText: `${keyPrefix}_select` });
    await fieldRow
      .getByRole("button", {
        name: settingsDataCopy.common.deleteNamed(`E2E Auswahl ${suffix}`),
      })
      .click();
    const deleteDialog = page.getByRole("dialog", {
      name: settingsDataCopy.field.deleteTitle,
    });
    await expect(deleteDialog).toBeVisible();
    await deleteDialog
      .getByRole("button", { name: settingsDataCopy.field.deletePermanently })
      .click();
    await expect(deleteDialog).not.toBeVisible();
    await expect(
      page.getByRole("row").filter({ hasText: `${keyPrefix}_select` }),
    ).toHaveCount(0);

    const deletedValue = await client<{ count: number }[]>`
      select count(*)::int as count from custom_field_values
      where field_id = ${selectField.id}
    `;
    expect(deletedValue[0].count).toBe(0);
  } finally {
    await client`
      delete from custom_field_definitions
      where key like ${`${keyPrefix}%`}
    `;
    for (const fieldId of createdFieldIds) {
      await client`delete from activity_events where entity_id = ${fieldId}`;
    }
    await client`
      delete from activity_events
      where type = 'member.custom_fields.updated'
        and created_at >= ${startedAt}
    `;
    await client.end();
  }
});

test("profile-field settings and member detail fit the mobile viewport", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "Mobile layout assertion");
  const client = postgres(databaseUrl, { prepare: false });

  try {
    const [member] = await client<{ id: string }[]>`
      select id from users
      where role = 'member' and status = 'active'
      order by created_at
      limit 1
    `;
    expect(member).toBeTruthy();

    await loginAsOwner(page);
    await page.goto("/admin/settings#profilfelder");
    await expect(
      page.getByRole("heading", { name: "Benutzerdefinierte Profilfelder" }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(1);
    await page.screenshot({
      path: testInfo.outputPath("profile-fields-settings-mobile.png"),
      fullPage: false,
    });

    await page.goto(`/admin/members/${member.id}`);
    await expect(
      page.getByRole("heading", { name: "Benutzerdefinierte Profilfelder" }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(1);
    await page.screenshot({
      path: testInfo.outputPath("member-profile-fields-mobile.png"),
      fullPage: false,
    });
  } finally {
    await client.end();
  }
});
