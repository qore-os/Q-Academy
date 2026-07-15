import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { completeMemberWelcomeIfVisible } from "./helpers/member-welcome";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";

async function loginAsOwner(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: /Admin-Demo|Als Admin testen/ }).click();
  await page.waitForURL("**/admin");
}

async function loginAsMember(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: /Lernenden-Demo|Als Mitglied testen/ }).click();
  await page.waitForURL("**/academy");
  await completeMemberWelcomeIfVisible(page);
}

test("parallel profile switches keep one default and an exact legacy mirror", async ({
  page,
  context,
  request,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "parallel mutation flow runs once");
  const client = postgres(databaseUrl, { max: 4, prepare: false });
  const suffix = randomUUID().slice(0, 8);
  let definitionId: string | null = null;
  let fieldId: string | null = null;
  let apiRequestId: string | undefined;
  let originalDefaultId: string | null = null;
  const profileIds: string[] = [];

  const [member] = await client<
    { id: string; organization_id: string }[]
  >`
    select id, organization_id from users
    where role = 'member' and status = 'active'
    order by created_at limit 1
  `;
  const originalLegacyValues = await client<
    { field_id: string; value: unknown; updated_at: Date }[]
  >`
    select field_id, value, updated_at from custom_field_values
    where organization_id = ${member.organization_id} and user_id = ${member.id}
  `;

  try {
    await loginAsOwner(page);
    await page.goto(`/admin/members/${member.id}`);
    await expect(page.getByRole("heading", { name: "Datenprofile" })).toBeVisible();
    const [originalDefault] = await client<{ id: string }[]>`
      select id from member_data_profiles
      where organization_id = ${member.organization_id}
        and user_id = ${member.id} and is_default = true
      limit 1
    `;
    originalDefaultId = originalDefault.id;

    const [field] = await client<{ id: string }[]>`
      insert into custom_field_definitions (
        organization_id, key, label, type, category, visibility
      ) values (
        ${member.organization_id}, ${`parallel_value_${suffix}`},
        ${`Parallel Value ${suffix}`}, 'text', 'Parallel Test', 'member'
      ) returning id
    `;
    fieldId = field.id;
    const [definition] = await client<{ id: string }[]>`
      insert into data_profile_definitions (
        organization_id, key, name, allow_member_creation, sort_order
      ) values (
        ${member.organization_id},
        ${`parallel_${suffix}`},
        ${`Parallel ${suffix}`},
        true,
        50
      ) returning id
    `;
    definitionId = definition.id;
    await client`
      insert into data_profile_fields (
        organization_id, profile_definition_id, field_id, sort_order
      ) values (${member.organization_id}, ${definition.id}, ${field.id}, 0)
    `;
    for (const [index, name] of [`Parallel A ${suffix}`, `Parallel B ${suffix}`].entries()) {
      const [profile] = await client<{ id: string }[]>`
        insert into member_data_profiles (
          organization_id, user_id, definition_id, name, is_default
        ) values (
          ${member.organization_id}, ${member.id}, ${definition.id}, ${name}, false
        ) returning id
      `;
      profileIds.push(profile.id);
      await client`
        insert into data_profile_values (
          organization_id, user_id, profile_id, field_id, value
        ) values (
          ${member.organization_id}, ${member.id}, ${profile.id}, ${field.id},
          to_jsonb(${`parallel-value-${index}`}::text)
        )
      `;
    }

    const secondPage = await context.newPage();
    await Promise.all([
      page.goto(`/admin/members/${member.id}?profile=${profileIds[0]}`),
      secondPage.goto(`/admin/members/${member.id}?profile=${profileIds[1]}`),
    ]);
    const switchA = page.getByRole("button", {
      name: "Als aktives Profil festlegen",
    });
    const switchB = secondPage.getByRole("button", {
      name: "Als aktives Profil festlegen",
    });
    const apiWrite = request.put(`/api/v1/members/${member.id}/custom-fields`, {
      headers: {
        Authorization: `Bearer ${process.env.DEMO_API_KEY ?? "qak_demo_qacademy_2026_local_development"}`,
        "Idempotency-Key": `profile-race-${randomUUID()}`,
      },
      data: { values: [{ fieldId: field.id, value: "REST parallel" }] },
    });
    const [, , apiResponse] = await Promise.all([
      switchA.click(),
      switchB.click(),
      apiWrite,
    ]);
    apiRequestId = apiResponse.headers()["x-request-id"];
    expect(apiResponse.status()).toBe(200);
    await expect
      .poll(async () => {
        const rows = await client<{ count: number }[]>`
          select count(*)::int as count from member_data_profiles
          where organization_id = ${member.organization_id}
            and user_id = ${member.id} and is_default = true
        `;
        return rows[0].count;
      })
      .toBe(1);
    await Promise.all([
      expect(page.getByText(/ist jetzt das aktive Profil\./)).toBeVisible(),
      expect(secondPage.getByText(/ist jetzt das aktive Profil\./)).toBeVisible(),
    ]);

    const [defaultProfile] = await client<{ id: string }[]>`
      select id from member_data_profiles
      where organization_id = ${member.organization_id}
        and user_id = ${member.id} and is_default = true
    `;
    const [legacyRows, profileRows] = await Promise.all([
      client<{ field_id: string; value: unknown }[]>`
        select field_id, value from custom_field_values
        where organization_id = ${member.organization_id} and user_id = ${member.id}
        order by field_id
      `,
      client<{ field_id: string; value: unknown }[]>`
        select field_id, value from data_profile_values
        where organization_id = ${member.organization_id}
          and user_id = ${member.id} and profile_id = ${defaultProfile.id}
        order by field_id
      `,
    ]);
    expect(legacyRows).toEqual(profileRows);
    await secondPage.close();
  } finally {
    if (originalDefaultId) {
      await client.begin(async (tx) => {
        await tx`
          update member_data_profiles set is_default = false
          where organization_id = ${member.organization_id} and user_id = ${member.id}
        `;
        await tx`
          update member_data_profiles set is_default = true
          where id = ${originalDefaultId} and organization_id = ${member.organization_id}
        `;
      });
    }
    if (profileIds.length) {
      await client`delete from member_data_profiles where id = any(${profileIds})`;
    }
    await client`
      delete from custom_field_values
      where organization_id = ${member.organization_id} and user_id = ${member.id}
    `;
    if (originalLegacyValues.length) {
      for (const entry of originalLegacyValues) {
        await client`
          insert into custom_field_values (
            organization_id, user_id, field_id, value, updated_at
          ) values (
            ${member.organization_id}, ${member.id}, ${entry.field_id},
            ${JSON.stringify(entry.value)}::jsonb, ${entry.updated_at}
          )
        `;
      }
    }
    if (definitionId) {
      await client`delete from data_profile_definitions where id = ${definitionId}`;
    }
    if (fieldId) {
      await client`delete from custom_field_definitions where id = ${fieldId}`;
    }
    if (apiRequestId) {
      await client`delete from api_audit_logs where request_id = ${apiRequestId}`;
    }
    await client`
      delete from activity_events
      where organization_id = ${member.organization_id}
        and entity_id = any(${profileIds.length ? profileIds : [randomUUID()]})
    `;
    await client.end();
  }
});

test("member creation dialog starts with an allowed profile definition", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "self-service flow runs once");
  const client = postgres(databaseUrl, { prepare: false });
  const suffix = randomUUID().slice(0, 8);
  const definitionIds: string[] = [];
  try {
    const [member] = await client<{ organization_id: string }[]>`
      select organization_id from users
      where role = 'member' and status = 'active'
      order by created_at limit 1
    `;
    const [field] = await client<{ id: string }[]>`
      select id from custom_field_definitions
      where organization_id = ${member.organization_id} and active = true
      order by created_at limit 1
    `;
    for (const [index, allowed] of [false, true].entries()) {
      const [definition] = await client<{ id: string }[]>`
        insert into data_profile_definitions (
          organization_id, key, name, allow_member_creation, sort_order
        ) values (
          ${member.organization_id},
          ${`selfservice_${suffix}_${index}`},
          ${allowed ? `Allowed ${suffix}` : `Blocked ${suffix}`},
          ${allowed},
          ${index}
        ) returning id
      `;
      definitionIds.push(definition.id);
      await client`
        insert into data_profile_fields (
          organization_id, profile_definition_id, field_id, sort_order
        ) values (${member.organization_id}, ${definition.id}, ${field.id}, 0)
      `;
    }

    await loginAsMember(page);
    await page.goto("/academy/profile");
    await page.getByRole("button", { name: "Neues Profil" }).click();
    const dialog = page.getByRole("dialog", { name: "Datenprofil anlegen" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel("Profilvorlage")).toHaveValue(definitionIds[1]);
    await expect(
      dialog.getByLabel("Profilvorlage").locator(`option[value="${definitionIds[0]}"]`),
    ).toHaveCount(0);
  } finally {
    if (definitionIds.length) {
      await client`delete from data_profile_definitions where id = any(${definitionIds})`;
    }
    await client.end();
  }
});

test("owner assigns fields to profile definitions and active forms", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "settings lifecycle runs once");
  const client = postgres(databaseUrl, { prepare: false });
  const suffix = randomUUID().slice(0, 8);
  const definitionKey = `settings_${suffix}`;
  const formKey = `form_${suffix}`;
  let definitionId: string | null = null;
  let formId: string | null = null;
  try {
    const [field] = await client<
      { id: string; label: string; organization_id: string }[]
    >`
      select id, label, organization_id from custom_field_definitions
      where active = true and visibility = 'member'
      order by created_at limit 1
    `;
    expect(field).toBeTruthy();
    await loginAsOwner(page);
    await page.goto("/admin/settings#datenprofile");

    await page.getByRole("button", { name: "Profilvorlage", exact: true }).click();
    const definitionDialog = page.getByRole("dialog", {
      name: "Profilvorlage anlegen",
    });
    await definitionDialog.getByLabel("Name").fill(`Settings ${suffix}`);
    await definitionDialog.getByLabel("Technischer Key").fill(definitionKey);
    await definitionDialog
      .locator(`input[name="fieldIds"][value="${field.id}"]`)
      .check();
    await definitionDialog.getByRole("button", { name: "Speichern" }).click();
    await expect(definitionDialog).not.toBeVisible();

    const [definition] = await client<{ id: string }[]>`
      select id from data_profile_definitions
      where organization_id = ${field.organization_id} and key = ${definitionKey}
    `;
    definitionId = definition.id;
    const [assignment] = await client<{ count: number }[]>`
      select count(*)::int as count from data_profile_fields
      where organization_id = ${field.organization_id}
        and profile_definition_id = ${definition.id} and field_id = ${field.id}
    `;
    expect(assignment.count).toBe(1);

    await page.getByRole("button", { name: "Formular", exact: true }).click();
    const formDialog = page.getByRole("dialog", { name: "Formular anlegen" });
    await formDialog.getByLabel("Name").fill(`Form ${suffix}`);
    await formDialog.getByLabel("Technischer Key").fill(formKey);
    await formDialog
      .getByLabel("Profilvorlage")
      .selectOption({ label: `Settings ${suffix}` });
    await formDialog
      .locator(`input[name="fieldIds"][value="${field.id}"]`)
      .check();
    await formDialog.getByRole("button", { name: "Speichern" }).click();
    await expect(formDialog).not.toBeVisible();

    const [form] = await client<{ id: string; active: boolean }[]>`
      select id, active from data_forms
      where organization_id = ${field.organization_id} and key = ${formKey}
    `;
    formId = form.id;
    expect(form.active).toBe(true);
    const [formAssignment] = await client<{ count: number }[]>`
      select count(*)::int as count from data_form_fields
      where organization_id = ${field.organization_id}
        and form_id = ${form.id} and field_id = ${field.id}
    `;
    expect(formAssignment.count).toBe(1);
  } finally {
    if (formId) await client`delete from data_forms where id = ${formId}`;
    if (definitionId) {
      await client`delete from data_profile_definitions where id = ${definitionId}`;
    }
    const entityIds = [formId, definitionId].filter(
      (value): value is string => Boolean(value),
    );
    if (entityIds.length) {
      await client`delete from activity_events where entity_id = any(${entityIds})`;
    }
    await client.end();
  }
});

test("data-profile pages fit mobile and reject cross-tenant members", async ({
  page,
}, testInfo) => {
  const client = postgres(databaseUrl, { prepare: false });
  let foreignOrganizationId: string | null = null;
  try {
    const [member] = await client<{ id: string }[]>`
      select id from users where role = 'member' and status = 'active'
      order by created_at limit 1
    `;
    await loginAsOwner(page);
    await page.goto(`/admin/members/${member.id}`);
    await expect(page.getByRole("heading", { name: "Datenprofile" })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);

    if (testInfo.project.name === "chromium") {
      const [organization] = await client<{ id: string }[]>`
        insert into organizations (name, slug)
        values ('Foreign data profile', ${`foreign-profile-${randomUUID()}`})
        returning id
      `;
      foreignOrganizationId = organization.id;
      const [foreignMember] = await client<{ id: string }[]>`
        insert into users (
          organization_id, email, password_hash, first_name, last_name, role
        ) values (
          ${organization.id}, ${`foreign-${randomUUID()}@example.test`},
          'not-used', 'Foreign', 'Member', 'member'
        ) returning id
      `;
      const response = await page.goto(`/admin/members/${foreignMember.id}`);
      expect(response?.status()).toBe(404);
    }
  } finally {
    if (foreignOrganizationId) {
      await client`delete from organizations where id = ${foreignOrganizationId}`;
    }
    await client.end();
  }
});
