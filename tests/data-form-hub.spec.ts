import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";
import { getSettingsDataCopy } from "../src/lib/i18n/settings-data";
import { completeMemberWelcomeIfVisible } from "./helpers/member-welcome";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";
const apiKey =
  process.env.DEMO_API_KEY ?? "qak_demo_qacademy_2026_local_development";
const settingsDataCopy = getSettingsDataCopy("de");

async function login(page: Page, role: "admin" | "member") {
  await page.context().clearCookies();
  await page.goto("/login");
  await page
    .getByRole("button", {
      name: role === "admin" ? /Admin-Demo|Als Admin testen/ : /Lernenden-Demo|Als Mitglied testen/,
    })
    .click();
  await page.waitForURL(role === "admin" ? "**/admin" : "**/academy");
  if (role === "member") await completeMemberWelcomeIfVisible(page);
}

test("hub data forms configure, submit, audit, and stay tenant-safe", async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(120_000);
  const client = postgres(databaseUrl, { prepare: false });
  const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
  const hubTitle = `Profil-Hub ${suffix}`;
  const hubSlug = `profil-hub-${suffix}`;
  const formName = `Hub Formular ${suffix}`;
  const fieldLabel = `Hub Ziel ${suffix}`;
  const submitLabel = `Hub-Angaben speichern ${suffix}`;
  const submittedValue = `Hub Antwort ${suffix}`;
  const requestIds: string[] = [];
  let organizationId = "";
  let memberId = "";
  let profileId = "";
  let definitionId = "";
  let fieldId = "";
  let formId = "";
  let inactiveFormId = "";
  let hubId = "";
  let foreignOrganizationId = "";

  try {
    const [fixture] = await client<
      Array<{
        organization_id: string;
        member_id: string;
        profile_id: string;
        definition_id: string;
      }>
    >`
      select
        member.organization_id,
        member.id as member_id,
        profile.id as profile_id,
        profile.definition_id
      from users member
      join member_data_profiles profile
        on profile.organization_id = member.organization_id
       and profile.user_id = member.id
       and profile.is_default = true
       and profile.active = true
      where member.email = 'lea@q-academy.de'
      limit 1
    `;
    expect(fixture).toBeTruthy();
    organizationId = fixture.organization_id;
    memberId = fixture.member_id;
    profileId = fixture.profile_id;
    definitionId = fixture.definition_id;

    const [field] = await client<Array<{ id: string }>>`
      insert into custom_field_definitions (
        organization_id, key, label, description, type, category,
        required, visibility, active, sort_order
      ) values (
        ${organizationId}, ${`hub_form_${suffix}`}, ${fieldLabel},
        'Wird aus einem Hub in das aktive Datenprofil geschrieben.',
        'text', 'Hub Test', true, 'member', true, 700
      ) returning id
    `;
    fieldId = field.id;
    await client`
      insert into data_profile_fields (
        organization_id, profile_definition_id, field_id,
        required_override, sort_order
      ) values (${organizationId}, ${definitionId}, ${fieldId}, true, 700)
    `;
    const [form] = await client<Array<{ id: string }>>`
      insert into data_forms (
        organization_id, profile_definition_id, key, name,
        description, submit_label, active
      ) values (
        ${organizationId}, ${definitionId}, ${`hub_form_${suffix}`},
        ${formName}, 'Ein eingebettetes Formular fuer den Mitglieder-Hub.',
        ${submitLabel}, true
      ) returning id
    `;
    formId = form.id;
    await client`
      insert into data_form_fields (
        organization_id, form_id, field_id, required_override, sort_order
      ) values (${organizationId}, ${formId}, ${fieldId}, true, 0)
    `;
    const [inactiveForm] = await client<Array<{ id: string }>>`
      insert into data_forms (
        organization_id, profile_definition_id, key, name, active
      ) values (
        ${organizationId}, ${definitionId}, ${`inactive_hub_form_${suffix}`},
        ${`Inaktives Hub Formular ${suffix}`}, false
      ) returning id
    `;
    inactiveFormId = inactiveForm.id;
    const [hub] = await client<Array<{ id: string }>>`
      insert into hubs (
        organization_id, title, slug, description, status, layout
      ) values (
        ${organizationId}, ${hubTitle}, ${hubSlug},
        'Hub mit einem sicher eingebetteten Datenformular.',
        'published', '[]'::jsonb
      ) returning id
    `;
    hubId = hub.id;

    await login(page, "admin");
    await page.goto(`/admin/hubs/${hubId}`);
    await page.getByRole("button", { name: "Zeile hinzufuegen" }).click();
    await page.getByRole("button", { name: "Widget hinzufuegen" }).click();
    const dialog = page.getByRole("dialog", { name: "Widget hinzufuegen" });
    await dialog.getByLabel("Typ").selectOption("data_form");
    const formSelect = dialog.getByRole("combobox", {
      name: "Formular",
      exact: true,
    });
    await expect(formSelect).toBeVisible();
    await formSelect.selectOption(formId);
    await dialog.getByLabel("Titel").fill(`Profilangaben ${suffix}`);
    await dialog
      .getByLabel("Beschreibung")
      .fill("Aktualisiert das ausgewaehlte Datenprofil.");
    await dialog.getByRole("button", { name: "Widget anlegen" }).click();
    await expect(dialog).toBeHidden();

    const [storedHub] = await client<
      Array<{
        layout: Array<{
          columns: Array<{ type: string; formId?: string }>;
        }>;
      }>
    >`select layout from hubs where id = ${hubId}`;
    expect(storedHub.layout[0]?.columns[0]).toMatchObject({
      type: "data_form",
      formId,
    });

    if (testInfo.project.name === "chromium") {
      await page.goto("/admin/settings#datenprofile");
      const deactivateForm = page.getByRole("switch", {
        name: `${formName} deaktivieren`,
      });
      await expect(deactivateForm).toBeVisible();
      await deactivateForm.click({ force: true });
      await expect(
        page.getByText("Das Formular wird in einem Kurs oder Hub verwendet."),
      ).toBeVisible();
      const [activeForm] = await client<Array<{ active: boolean }>>`
        select active from data_forms where id = ${formId}
      `;
      expect(activeForm.active).toBe(true);

      const [foreignOrganization] = await client<Array<{ id: string }>>`
        insert into organizations (name, slug)
        values (${`Foreign Hub ${suffix}`}, ${`foreign-hub-${suffix}`})
        returning id
      `;
      foreignOrganizationId = foreignOrganization.id;
      const [foreignDefinition] = await client<Array<{ id: string }>>`
        insert into data_profile_definitions (
          organization_id, key, name, allow_member_creation, sort_order
        ) values (
          ${foreignOrganizationId}, 'default', 'Default', false, 0
        ) returning id
      `;
      const [foreignForm] = await client<Array<{ id: string }>>`
        insert into data_forms (
          organization_id, profile_definition_id, key, name, active
        ) values (
          ${foreignOrganizationId}, ${foreignDefinition.id},
          'foreign_hub_form', 'Foreign Hub Form', true
        ) returning id
      `;
      const foreignResponse = await request.post("/api/v1/hubs", {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Idempotency-Key": `foreign-hub-form-${suffix}`,
        },
        data: {
          title: `Foreign form hub ${suffix}`,
          slug: `foreign-form-hub-${suffix}`,
          layout: [
            {
              id: "row-1",
              columns: [
                {
                  type: "data_form",
                  title: "Foreign form",
                  formId: foreignForm.id,
                },
              ],
            },
          ],
        },
      });
      requestIds.push(foreignResponse.headers()["x-request-id"]);
      expect(foreignResponse.status()).toBe(422);
      await expect(foreignResponse.json()).resolves.toMatchObject({
        code: "validation_error",
        detail: "Hub-Formular ist nicht verfuegbar.",
      });

      const inactiveResponse = await request.patch(`/api/v1/hubs/${hubId}`, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Idempotency-Key": `inactive-hub-form-${suffix}`,
        },
        data: {
          layout: [
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
          ],
        },
      });
      requestIds.push(inactiveResponse.headers()["x-request-id"]);
      expect(inactiveResponse.status()).toBe(422);
    }

    await login(page, "member");
    await page.goto(`/academy/hub?hub=${hubSlug}`);
    await expect(page.getByRole("heading", { name: hubTitle })).toBeVisible();
    await expect(page.getByRole("heading", { name: formName })).toBeVisible();
    await page
      .getByRole("textbox", { name: fieldLabel, exact: true })
      .fill(submittedValue);
    await page.getByRole("button", { name: submitLabel }).click();
    await expect(page.getByText("Angaben wurden gespeichert.")).toBeVisible();

    const [profileValue] = await client<
      Array<{ value: string }>
    >`
      select value #>> '{}' as value
      from data_profile_values
      where organization_id = ${organizationId}
        and user_id = ${memberId}
        and profile_id = ${profileId}
        and field_id = ${fieldId}
    `;
    expect(profileValue.value).toBe(submittedValue);
    const [submission] = await client<
      Array<{
        id: string;
        source_type: string;
        source_id: string;
        response_snapshot: Array<{
          fieldId: string;
          label: string;
          value: string;
        }>;
      }>
    >`
      select id, source_type::text, source_id, response_snapshot
      from data_form_submissions
      where organization_id = ${organizationId}
        and form_id = ${formId}
        and user_id = ${memberId}
      order by submitted_at desc
      limit 1
    `;
    expect(submission).toMatchObject({
      source_type: "hub",
      source_id: hubId,
      response_snapshot: [
        { fieldId, label: fieldLabel, value: submittedValue },
      ],
    });
    const [audit] = await client<Array<{ count: number }>>`
      select count(*)::int as count
      from activity_events
      where organization_id = ${organizationId}
        and type = 'data_form.submitted'
        and entity_id = ${submission.id}
    `;
    expect(audit.count).toBe(1);
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(1);
  } finally {
    if (organizationId && formId) {
      await client`
        delete from activity_events
        where organization_id = ${organizationId}
          and (
            entity_id = any(${[hubId, formId, fieldId].filter(Boolean)})
            or metadata ->> 'formId' = ${formId}
          )
      `;
      await client`
        delete from data_form_submissions
        where organization_id = ${organizationId} and form_id = ${formId}
      `;
    }
    if (hubId) await client`delete from hubs where id = ${hubId}`;
    if (formId || inactiveFormId) {
      await client`
        delete from data_forms
        where id = any(${[formId, inactiveFormId].filter(Boolean)})
      `;
    }
    if (fieldId) {
      await client`delete from custom_field_definitions where id = ${fieldId}`;
    }
    for (const requestId of requestIds.filter(Boolean)) {
      await client`delete from api_audit_logs where request_id = ${requestId}`;
    }
    if (foreignOrganizationId) {
      await client`delete from organizations where id = ${foreignOrganizationId}`;
    }
    await client.end();
  }
});

test("form activation stays consistent with parallel field disable and delete", async ({
  page,
  context,
  request,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "concurrency regression runs once");
  test.setTimeout(120_000);
  const client = postgres(databaseUrl, { max: 4, prepare: false });
  const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
  const disableFieldLabel = `Race Disable ${suffix}`;
  const disableFormName = `Race Disable Form ${suffix}`;
  const deleteFieldLabel = `Race Delete ${suffix}`;
  const deleteFormName = `Race Delete Form ${suffix}`;
  const formIds: string[] = [];
  const fieldIds: string[] = [];
  const requestIds: string[] = [];
  let organizationId = "";
  let secondPage: Page | null = null;

  try {
    const [organization] = await client<
      Array<{ id: string; definition_id: string }>
    >`
      select organization.id, definition.id as definition_id
      from organizations organization
      join data_profile_definitions definition
        on definition.organization_id = organization.id
       and definition.key = 'default'
      where organization.slug = 'q-academy'
      limit 1
    `;
    organizationId = organization.id;

    for (const [index, values] of [
      { fieldLabel: disableFieldLabel, formName: disableFormName },
      { fieldLabel: deleteFieldLabel, formName: deleteFormName },
    ].entries()) {
      const [field] = await client<Array<{ id: string }>>`
        insert into custom_field_definitions (
          organization_id, key, label, type, category,
          visibility, active, sort_order
        ) values (
          ${organizationId}, ${`race_field_${suffix}_${index}`},
          ${values.fieldLabel}, 'text', 'Race Test', 'member', true,
          ${800 + index}
        ) returning id
      `;
      fieldIds.push(field.id);
      await client`
        insert into data_profile_fields (
          organization_id, profile_definition_id, field_id, sort_order
        ) values (
          ${organizationId}, ${organization.definition_id}, ${field.id},
          ${800 + index}
        )
      `;
      const [form] = await client<Array<{ id: string }>>`
        insert into data_forms (
          organization_id, profile_definition_id, key, name, active
        ) values (
          ${organizationId}, ${organization.definition_id},
          ${`race_form_${suffix}_${index}`}, ${values.formName}, false
        ) returning id
      `;
      formIds.push(form.id);
      await client`
        insert into data_form_fields (
          organization_id, form_id, field_id, sort_order
        ) values (${organizationId}, ${form.id}, ${field.id}, 0)
      `;
    }

    await login(page, "admin");
    await page.goto("/admin/settings#datenprofile");
    const activateDisableForm = page.getByRole("switch", {
      name: `${disableFormName} aktivieren`,
    });
    await expect(activateDisableForm).toBeVisible();
    const disableResponsePromise = request.delete(
      `/api/v1/custom-fields/${fieldIds[0]}`,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Idempotency-Key": `disable-field-race-${suffix}`,
        },
      },
    );
    const [, disableResponse] = await Promise.all([
      activateDisableForm.click({ force: true }),
      disableResponsePromise,
    ]);
    requestIds.push(disableResponse.headers()["x-request-id"]);
    expect([200, 409]).toContain(disableResponse.status());
    await expect
      .poll(async () => {
        const [state] = await client<
          Array<{ form_active: boolean; field_active: boolean }>
        >`
          select form.active as form_active, field.active as field_active
          from data_forms form
          join custom_field_definitions field on field.id = ${fieldIds[0]}
          where form.id = ${formIds[0]}
        `;
        return state.form_active === state.field_active;
      })
      .toBe(true);
    const [disableState] = await client<
      Array<{ form_active: boolean; field_active: boolean }>
    >`
      select form.active as form_active, field.active as field_active
      from data_forms form
      join custom_field_definitions field on field.id = ${fieldIds[0]}
      where form.id = ${formIds[0]}
    `;
    expect(disableState.form_active).toBe(disableState.field_active);
    expect(disableResponse.status()).toBe(
      disableState.form_active ? 409 : 200,
    );

    await page.reload();
    secondPage = await context.newPage();
    await secondPage.goto("/admin/settings#profilfelder");
    await secondPage
      .getByRole("button", {
        name: settingsDataCopy.common.deleteNamed(deleteFieldLabel),
      })
      .click();
    const confirmDelete = secondPage
      .getByRole("dialog", { name: settingsDataCopy.field.deleteTitle })
      .getByRole("button", {
        name: settingsDataCopy.field.deletePermanently,
      });
    const activateDeleteForm = page.getByRole("switch", {
      name: `${deleteFormName} aktivieren`,
    });
    await Promise.all([
      activateDeleteForm.click({ force: true }),
      confirmDelete.click(),
    ]);
    await expect
      .poll(async () => {
        const [state] = await client<Array<{ active: boolean }>>`
          select active from data_forms where id = ${formIds[1]}
        `;
        const field = await client<Array<{ id: string }>>`
          select id from custom_field_definitions where id = ${fieldIds[1]}
        `;
        return state.active === (field.length === 1);
      })
      .toBe(true);
    const [deleteFormState] = await client<Array<{ active: boolean }>>`
      select active from data_forms where id = ${formIds[1]}
    `;
    const deletedField = await client<Array<{ active: boolean }>>`
      select active from custom_field_definitions where id = ${fieldIds[1]}
    `;
    const [assignment] = await client<Array<{ count: number }>>`
      select count(*)::int as count
      from data_form_fields
      where form_id = ${formIds[1]} and field_id = ${fieldIds[1]}
    `;
    if (deleteFormState.active) {
      expect(deletedField).toHaveLength(1);
      expect(deletedField[0].active).toBe(true);
      expect(assignment.count).toBe(1);
    } else {
      expect(deletedField).toHaveLength(0);
      expect(assignment.count).toBe(0);
    }
  } finally {
    await secondPage?.close();
    if (formIds.length) {
      await client`delete from data_forms where id = any(${formIds})`;
    }
    if (fieldIds.length) {
      await client`
        delete from custom_field_definitions where id = any(${fieldIds})
      `;
      await client`
        delete from activity_events
        where organization_id = ${organizationId}
          and entity_id = any(${[...formIds, ...fieldIds]})
      `;
    }
    for (const requestId of requestIds.filter(Boolean)) {
      await client`delete from api_audit_logs where request_id = ${requestId}`;
    }
    await client.end();
  }
});
