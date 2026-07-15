import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";
import { getCourseBuilderCopy } from "../src/lib/i18n/course-builder";
import { completeMemberWelcomeIfVisible } from "./helpers/member-welcome";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";
const apiKey =
  process.env.DEMO_API_KEY ?? "qak_demo_qacademy_2026_local_development";
const courseBuilderCopy = getCourseBuilderCopy("de");

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

test("course data forms publish, submit into the active profile, and stay tenant-safe", async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(120_000);
  const client = postgres(databaseUrl, { prepare: false });
  const suffix = randomUUID().slice(0, 8);
  const courseTitle = `Kursformular ${suffix}`;
  const courseSlug = `kursformular-${suffix}`;
  const moduleTitle = `Formularmodul ${suffix}`;
  const lessonTitle = `Formularlektion ${suffix}`;
  const formName = `Transferformular ${suffix}`;
  const fieldLabel = `Transferziel ${suffix}`;
  const submittedValue = `Messbares Lernziel ${suffix}`;
  const submitLabel = `Transfer speichern ${suffix}`;
  const apiRequestIds: string[] = [];
  let organizationId = "";
  let memberId = "";
  let profileId = "";
  let profileDefinitionId = "";
  let fieldId = "";
  let formId = "";
  let inactiveFormId = "";
  let foreignOrganizationId = "";
  let foreignFormId = "";
  let courseId = "";
  let moduleId = "";
  let lessonId = "";

  try {
    const [fixture] = await client<
      Array<{
        owner_id: string;
        member_id: string;
        organization_id: string;
        profile_id: string;
        definition_id: string;
      }>
    >`
      select
        owner.id as owner_id,
        member.id as member_id,
        owner.organization_id,
        profile.id as profile_id,
        profile.definition_id
      from users owner
      join users member
        on member.organization_id = owner.organization_id
       and member.email = 'lea@q-academy.de'
      join member_data_profiles profile
        on profile.organization_id = member.organization_id
       and profile.user_id = member.id
       and profile.is_default = true
       and profile.active = true
      where owner.email = 'admin@q-academy.de'
      limit 1
    `;
    expect(fixture).toBeTruthy();
    organizationId = fixture.organization_id;
    memberId = fixture.member_id;
    profileId = fixture.profile_id;
    profileDefinitionId = fixture.definition_id;

    const [field] = await client<Array<{ id: string }>>`
      insert into custom_field_definitions (
        organization_id, key, label, description, type, category,
        required, visibility, active, sort_order
      ) values (
        ${organizationId}, ${`course_form_${suffix}`}, ${fieldLabel},
        'Wird aus einer publizierten Lektion in das aktive Profil geschrieben.',
        'text', 'Lerntransfer', true, 'member', true, 500
      )
      returning id
    `;
    fieldId = field.id;
    await client`
      insert into data_profile_fields (
        organization_id, profile_definition_id, field_id,
        required_override, sort_order
      ) values (${organizationId}, ${profileDefinitionId}, ${fieldId}, true, 500)
    `;

    const [form] = await client<Array<{ id: string }>>`
      insert into data_forms (
        organization_id, profile_definition_id, key, name,
        description, submit_label, active
      ) values (
        ${organizationId}, ${profileDefinitionId}, ${`course_form_${suffix}`},
        ${formName}, 'Formular fuer den Transfer aus der Kurslektion.',
        ${submitLabel}, true
      )
      returning id
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
        ${organizationId}, ${profileDefinitionId},
        ${`inactive_course_form_${suffix}`}, ${`Inaktiv ${suffix}`}, false
      )
      returning id
    `;
    inactiveFormId = inactiveForm.id;

    const [foreignOrganization] = await client<Array<{ id: string }>>`
      insert into organizations (name, slug)
      values (${`Foreign form ${suffix}`}, ${`foreign-form-${suffix}`})
      returning id
    `;
    foreignOrganizationId = foreignOrganization.id;
    const [foreignDefinition] = await client<Array<{ id: string }>>`
      insert into data_profile_definitions (
        organization_id, key, name, allow_member_creation, sort_order
      ) values (
        ${foreignOrganizationId}, 'foreign_default', 'Foreign default', false, 0
      )
      returning id
    `;
    const [foreignForm] = await client<Array<{ id: string }>>`
      insert into data_forms (
        organization_id, profile_definition_id, key, name, active
      ) values (
        ${foreignOrganizationId}, ${foreignDefinition.id},
        'foreign_course_form', 'Foreign course form', true
      )
      returning id
    `;
    foreignFormId = foreignForm.id;

    const [course] = await client<Array<{ id: string }>>`
      insert into courses (
        organization_id, title, slug, short_description, description,
        status, certificate_enabled, created_by_id
      ) values (
        ${organizationId}, ${courseTitle}, ${courseSlug},
        'Ein fokussierter Kurs fuer eingebettete Datenformulare.',
        'Prueft Auswahl, Publikation, Profilbindung und responsive Einreichung.',
        'draft', false, ${fixture.owner_id}
      )
      returning id
    `;
    courseId = course.id;
    const [learningModule] = await client<Array<{ id: string }>>`
      insert into modules (
        organization_id, title, description, estimated_minutes
      ) values (
        ${organizationId}, ${moduleTitle},
        'Isoliertes Modul fuer den Formular-Lernpfad.', 10
      )
      returning id
    `;
    moduleId = learningModule.id;
    await client`
      insert into course_modules (
        organization_id, course_id, module_id, sort_order, is_required
      ) values (${organizationId}, ${courseId}, ${moduleId}, 0, true)
    `;
    const [lesson] = await client<Array<{ id: string }>>`
      insert into lessons (
        organization_id, module_id, title, slug, summary, type,
        duration_minutes, sort_order, status
      ) values (
        ${organizationId}, ${moduleId}, ${lessonTitle}, 'formularlektion',
        'Das Formular schreibt sicher in das aktive Datenprofil.',
        'lesson', 10, 0, 'published'
      )
      returning id
    `;
    lessonId = lesson.id;
    const [enrollment] = await client<Array<{ id: string }>>`
      insert into enrollments (user_id, course_id, access_active)
      values (${memberId}, ${courseId}, true)
      returning id
    `;
    await client`
      insert into course_access_grants (
        organization_id, user_id, course_id, source
      ) values (
        ${organizationId}, ${memberId}, ${courseId},
        ${`direct:${enrollment.id}`}
      )
    `;

    await login(page, "admin");
    await page.goto(`/admin/courses/${courseId}`);
    await expect(page.getByRole("heading", { name: courseTitle })).toBeVisible();
    await page
      .getByRole("button", {
        name: courseBuilderCopy.palette.data_form,
        exact: true,
      })
      .click();
    await expect(
      page.getByText("Inhaltselement hinzugefuegt.", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", {
        name: `${courseBuilderCopy.palette.data_form}: ${courseBuilderCopy.common.edit}`,
        exact: true,
      })
      .click();
    const dialog = page.getByRole("dialog", {
      name: courseBuilderCopy.dialogs.editBlock,
    });
    await dialog
      .getByLabel(courseBuilderCopy.block.title)
      .fill(`Lerntransfer ${suffix}`);
    await dialog.getByLabel(courseBuilderCopy.block.dataForm).selectOption(formId);
    await dialog
      .getByRole("button", { name: courseBuilderCopy.dialogs.saveChanges })
      .click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText(formName, { exact: true })).toBeVisible();

    const [configuredBlock] = await client<
      Array<{
        id: string;
        type: string;
        title: string;
        revision: number;
        data: { formId?: string };
      }>
    >`
      select id, type, title, revision, data
      from content_blocks
      where lesson_id = ${lessonId} and type = 'data_form'
      limit 1
    `;
    expect(configuredBlock).toMatchObject({
      type: "data_form",
      title: `Lerntransfer ${suffix}`,
      data: { formId },
    });

    if (testInfo.project.name === "chromium") {
      const foreignResponse = await request.post(
        `/api/v1/lessons/${lessonId}/blocks`,
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Idempotency-Key": `foreign-data-form-${suffix}`,
          },
          data: {
            type: "data_form",
            title: "Foreign form",
            sortOrder: 10,
            required: false,
            data: { formId: foreignFormId },
          },
        },
      );
      apiRequestIds.push(foreignResponse.headers()["x-request-id"]);
      expect(foreignResponse.status()).toBe(422);
      await expect(foreignResponse.json()).resolves.toMatchObject({
        code: "validation_error",
        detail: "Das Datenformular ist nicht aktiv oder nicht verfuegbar.",
      });

      const inactiveResponse = await request.patch(
        `/api/v1/blocks/${configuredBlock.id}`,
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Idempotency-Key": `inactive-data-form-${suffix}`,
          },
          data: {
            revision: configuredBlock.revision,
            data: { formId: inactiveFormId },
          },
        },
      );
      apiRequestIds.push(inactiveResponse.headers()["x-request-id"]);
      expect(inactiveResponse.status()).toBe(422);
      await expect(inactiveResponse.json()).resolves.toMatchObject({
        code: "validation_error",
        detail: "Das Datenformular ist nicht aktiv oder nicht verfuegbar.",
      });
      const [unchanged] = await client<Array<{ data: { formId?: string } }>>`
        select data from content_blocks where id = ${configuredBlock.id}
      `;
      expect(unchanged.data.formId).toBe(formId);

      const [invalidPublicationBlock] = await client<Array<{ id: string }>>`
        insert into content_blocks (
          lesson_id, type, title, sort_order, required, data
        ) values (
          ${lessonId}, 'data_form', 'Inaktives Publikationsformular', 999,
          false, ${JSON.stringify({ formId: inactiveFormId })}::jsonb
        ) returning id
      `;
      const rejectedPublication = await request.post(
        `/api/v1/courses/${courseId}/publish`,
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Idempotency-Key": `inactive-form-publish-${suffix}`,
          },
          data: { changelog: "Inaktives Formular muss Publish verhindern." },
        },
      );
      apiRequestIds.push(rejectedPublication.headers()["x-request-id"]);
      expect(rejectedPublication.status()).toBe(422);
      await expect(rejectedPublication.json()).resolves.toMatchObject({
        code: "validation_error",
        detail:
          "Kurs enthaelt ein inaktives oder nicht verfuegbares Datenformular.",
      });
      const [unpublished] = await client<
        Array<{ published_version_id: string | null }>
      >`select published_version_id from courses where id = ${courseId}`;
      expect(unpublished.published_version_id).toBeNull();
      await client`
        delete from content_blocks where id = ${invalidPublicationBlock.id}
      `;
    }

    await page
      .getByRole("button", { name: "Kurs veroeffentlichen" })
      .click();
    await expect(
      page.getByRole("button", { name: "Aenderungen veroeffentlichen" }),
    ).toBeVisible();
    const [publication] = await client<
      Array<{
        published_version_id: string | null;
        snapshot_form_id: string | null;
      }>
    >`
      select
        c.published_version_id,
        block -> 'data' ->> 'formId' as snapshot_form_id
      from courses c
      join course_versions version on version.id = c.published_version_id
      cross join lateral jsonb_array_elements(version.snapshot -> 'modules') module
      cross join lateral jsonb_array_elements(module -> 'lessons') lesson
      cross join lateral jsonb_array_elements(lesson -> 'blocks') block
      where c.id = ${courseId} and block ->> 'type' = 'data_form'
      limit 1
    `;
    expect(publication).toMatchObject({
      published_version_id: expect.any(String),
      snapshot_form_id: formId,
    });

    await login(page, "member");
    await page.goto(`/academy/courses/${courseSlug}/learn/${lessonId}`);
    await expect(page.getByRole("heading", { name: formName })).toBeVisible();
    const formInput = page.getByLabel(fieldLabel);
    await expect(formInput).toBeVisible();
    await formInput.fill(submittedValue);
    await page.getByRole("button", { name: submitLabel }).click();
    await expect(
      page.getByText("Angaben wurden gespeichert.", { exact: true }),
    ).toBeVisible();

    await expect
      .poll(async () => {
        const [row] = await client<
          Array<{
            profile_value: string | null;
            legacy_value: string | null;
            submission_count: number;
            source_type: string | null;
            source_id: string | null;
            submission_profile_id: string | null;
          }>
        >`
          select
            (select value #>> '{}' from data_profile_values
              where organization_id = ${organizationId}
                and user_id = ${memberId}
                and profile_id = ${profileId}
                and field_id = ${fieldId}) as profile_value,
            (select value #>> '{}' from custom_field_values
              where organization_id = ${organizationId}
                and user_id = ${memberId}
                and field_id = ${fieldId}) as legacy_value,
            count(submission.id)::int as submission_count,
            max(submission.source_type) as source_type,
            max(submission.source_id::text) as source_id,
            max(submission.profile_id::text) as submission_profile_id
          from data_form_submissions submission
          where submission.organization_id = ${organizationId}
            and submission.form_id = ${formId}
            and submission.user_id = ${memberId}
        `;
        return row;
      })
      .toMatchObject({
        profile_value: submittedValue,
        legacy_value: submittedValue,
        submission_count: 1,
        source_type: "lesson",
        source_id: lessonId,
        submission_profile_id: profileId,
      });

    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(1);
    await page.screenshot({
      path: testInfo.outputPath(`course-data-form-${testInfo.project.name}.png`),
      fullPage: false,
    });
  } finally {
    if (apiRequestIds.filter(Boolean).length) {
      await client`
        delete from api_audit_logs
        where request_id = any(${apiRequestIds.filter(Boolean)})
      `;
    }
    if (organizationId && formId) {
      const submissions = await client<Array<{ id: string }>>`
        delete from data_form_submissions
        where organization_id = ${organizationId} and form_id = ${formId}
        returning id
      `;
      const eventIds = [
        courseId,
        moduleId,
        lessonId,
        formId,
        inactiveFormId,
        ...submissions.map((submission) => submission.id),
      ].filter(Boolean);
      if (eventIds.length) {
        await client`
          delete from activity_events
          where organization_id = ${organizationId}
            and (
              entity_id = any(${eventIds})
              or metadata ->> 'courseId' = ${courseId}
              or metadata ->> 'formId' = ${formId}
            )
        `;
      }
    }
    if (courseId) await client`delete from courses where id = ${courseId}`;
    if (moduleId) await client`delete from modules where id = ${moduleId}`;
    if (formId || inactiveFormId) {
      await client`
        delete from data_forms
        where id = any(${[formId, inactiveFormId].filter(Boolean)})
      `;
    }
    if (fieldId) {
      await client`delete from custom_field_definitions where id = ${fieldId}`;
    }
    if (foreignOrganizationId) {
      await client`delete from organizations where id = ${foreignOrganizationId}`;
    }
    await client.end({ timeout: 5 });
  }
});

test("page form attachment and form deactivation serialize to one valid state", async ({
  page,
  request,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "concurrency regression runs once");
  test.setTimeout(120_000);
  const client = postgres(databaseUrl, { max: 4, prepare: false });
  const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
  const formName = `Page Race Form ${suffix}`;
  const requestIds: string[] = [];
  let organizationId = "";
  let fieldId = "";
  let formId = "";
  let courseId = "";
  let moduleId = "";
  let lessonId = "";
  let pageId = "";

  try {
    const [fixture] = await client<
      Array<{
        organization_id: string;
        owner_id: string;
        definition_id: string;
      }>
    >`
      select
        owner.organization_id,
        owner.id as owner_id,
        definition.id as definition_id
      from users owner
      join data_profile_definitions definition
        on definition.organization_id = owner.organization_id
       and definition.key = 'default'
      where owner.email = 'admin@q-academy.de'
      limit 1
    `;
    organizationId = fixture.organization_id;
    const [field] = await client<Array<{ id: string }>>`
      insert into custom_field_definitions (
        organization_id, key, label, type, category,
        visibility, active, sort_order
      ) values (
        ${organizationId}, ${`page_race_${suffix}`},
        ${`Page Race Field ${suffix}`}, 'text', 'Race Test',
        'member', true, 950
      ) returning id
    `;
    fieldId = field.id;
    await client`
      insert into data_profile_fields (
        organization_id, profile_definition_id, field_id, sort_order
      ) values (
        ${organizationId}, ${fixture.definition_id}, ${fieldId}, 950
      )
    `;
    const [form] = await client<Array<{ id: string }>>`
      insert into data_forms (
        organization_id, profile_definition_id, key, name, active
      ) values (
        ${organizationId}, ${fixture.definition_id},
        ${`page_race_${suffix}`}, ${formName}, true
      ) returning id
    `;
    formId = form.id;
    await client`
      insert into data_form_fields (
        organization_id, form_id, field_id, sort_order
      ) values (${organizationId}, ${formId}, ${fieldId}, 0)
    `;
    const [course] = await client<Array<{ id: string }>>`
      insert into courses (
        organization_id, title, slug, short_description, description,
        status, created_by_id
      ) values (
        ${organizationId}, ${`Page Race Course ${suffix}`},
        ${`page-race-course-${suffix}`},
        'Parallelitaetstest fuer eingebettete Seitenformulare.',
        'Prueft die atomare Reihenfolge von Blockanlage und Deaktivierung.',
        'draft', ${fixture.owner_id}
      ) returning id
    `;
    courseId = course.id;
    const [learningModule] = await client<Array<{ id: string }>>`
      insert into modules (organization_id, title, estimated_minutes)
      values (${organizationId}, ${`Page Race Module ${suffix}`}, 5)
      returning id
    `;
    moduleId = learningModule.id;
    await client`
      insert into course_modules (
        organization_id, course_id, module_id, sort_order
      ) values (${organizationId}, ${courseId}, ${moduleId}, 0)
    `;
    const [lesson] = await client<Array<{ id: string }>>`
      insert into lessons (
        organization_id, module_id, title, slug, type,
        duration_minutes, sort_order, status
      ) values (
        ${organizationId}, ${moduleId}, ${`Page Race Lesson ${suffix}`},
        ${`page-race-lesson-${suffix}`}, 'lesson', 5, 0, 'published'
      ) returning id
    `;
    lessonId = lesson.id;
    const [lessonPage] = await client<Array<{ id: string }>>`
      insert into lesson_pages (lesson_id, title, slug, sort_order, status)
      values (
        ${lessonId}, ${`Page Race ${suffix}`}, ${`page-race-${suffix}`},
        0, 'published'
      ) returning id
    `;
    pageId = lessonPage.id;

    await login(page, "admin");
    await page.goto("/admin/settings#datenprofile");
    const deactivateForm = page.getByRole("switch", {
      name: `${formName} deaktivieren`,
    });
    await expect(deactivateForm).toBeVisible();
    const createBlockPromise = request.post(`/api/v1/pages/${pageId}/blocks`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Idempotency-Key": `page-form-race-${suffix}`,
      },
      data: {
        type: "data_form",
        title: `Page Race Block ${suffix}`,
        sortOrder: 0,
        required: false,
        data: { formId },
      },
    });
    const [, createBlockResponse] = await Promise.all([
      deactivateForm.click({ force: true }),
      createBlockPromise,
    ]);
    requestIds.push(createBlockResponse.headers()["x-request-id"]);
    expect([201, 422]).toContain(createBlockResponse.status());
    await expect(
      page.getByText(
        new RegExp(
          `${formName} wurde deaktiviert\\.|Das Formular wird in einem Kurs oder Hub verwendet\\.`,
        ),
      ),
    ).toBeVisible();

    const [state] = await client<
      Array<{ form_active: boolean; block_count: number }>
    >`
      select
        form.active as form_active,
        count(block.id)::int as block_count
      from data_forms form
      left join content_blocks block
        on block.page_id = ${pageId}
       and block.type = 'data_form'
       and block.data ->> 'formId' = form.id::text
      where form.id = ${formId}
      group by form.active
    `;
    if (createBlockResponse.status() === 201) {
      expect(state).toEqual({ form_active: true, block_count: 1 });
    } else {
      expect(state).toEqual({ form_active: false, block_count: 0 });
      await expect(createBlockResponse.json()).resolves.toMatchObject({
        code: "validation_error",
        detail: "Das Datenformular ist nicht aktiv oder nicht verfuegbar.",
      });
    }
  } finally {
    if (requestIds.filter(Boolean).length) {
      await client`
        delete from api_audit_logs
        where request_id = any(${requestIds.filter(Boolean)})
      `;
    }
    if (courseId) await client`delete from courses where id = ${courseId}`;
    if (moduleId) await client`delete from modules where id = ${moduleId}`;
    if (formId) await client`delete from data_forms where id = ${formId}`;
    if (fieldId) {
      await client`delete from custom_field_definitions where id = ${fieldId}`;
    }
    if (organizationId) {
      await client`
        delete from activity_events
        where organization_id = ${organizationId}
          and entity_id = any(${[formId, courseId, moduleId, lessonId].filter(Boolean)})
      `;
    }
    await client.end({ timeout: 5 });
  }
});
