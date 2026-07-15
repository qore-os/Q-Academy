import { createHash, randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";

function hashSecret(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

async function login(
  page: Page,
  input: { organizationSlug: string; email: string },
) {
  await page.context().clearCookies();
  const response = await page.context().request.post("/api/v1/auth/login", {
    data: { ...input, password: "Demo123!" },
  });
  const responseBody = await response.text();
  expect(response.ok(), responseBody).toBe(true);
}

test("tenant welcome popup is versioned, acknowledged once and isolated", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const sql = postgres(databaseUrl, { prepare: false });
  const suffix = `${testInfo.project.name}-${randomUUID().slice(0, 8)}`;
  const organizationSlug = `welcome-${suffix}`.toLowerCase();
  const foreignOrganizationSlug = `welcome-foreign-${suffix}`.toLowerCase();
  const adminEmail = `welcome-admin-${suffix}@example.test`;
  const memberEmail = `welcome-member-${suffix}@example.test`;
  const trainerEmail = `welcome-trainer-${suffix}@example.test`;
  const foreignMemberEmail = `welcome-foreign-${suffix}@example.test`;
  const apiSecret = `qak_welcome_${randomUUID().replaceAll("-", "")}`;
  const title = `Dein Start ${suffix}`;
  const updatedTitle = `Neu fuer dich ${suffix}`;
  const foreignTitle = `Fremde Begruessung ${suffix}`;
  const videoUrl = `https://media.test/${suffix}/welcome.mp4`;
  let organizationId = "";
  let foreignOrganizationId = "";
  let memberId = "";
  let foreignMemberId = "";

  await page.route("https://media.test/**", (route) =>
    route.fulfill({ status: 200, contentType: "video/mp4", body: "" }),
  );

  try {
    const [passwordSource] = await sql<Array<{ passwordHash: string }>>`
      select password_hash as "passwordHash"
      from users
      where email = 'lea@q-academy.de'
      limit 1
    `;
    expect(passwordSource).toBeTruthy();
    const [organization] = await sql<Array<{ id: string }>>`
      insert into organizations (name, slug)
      values (${`Welcome E2E ${suffix}`}, ${organizationSlug})
      returning id
    `;
    const [foreignOrganization] = await sql<Array<{ id: string }>>`
      insert into organizations (name, slug)
      values (${`Welcome foreign E2E ${suffix}`}, ${foreignOrganizationSlug})
      returning id
    `;
    organizationId = organization.id;
    foreignOrganizationId = foreignOrganization.id;

    const people = await sql<
      Array<{ id: string; email: string; role: string }>
    >`
      insert into users (
        organization_id, email, password_hash, first_name, last_name, role,
        status
      ) values
        (${organizationId}, ${adminEmail}, ${passwordSource.passwordHash}, 'Willkommen', 'Admin', 'admin', 'active'),
        (${organizationId}, ${memberEmail}, ${passwordSource.passwordHash}, 'Willkommen', 'Mitglied', 'member', 'active'),
        (${organizationId}, ${trainerEmail}, ${passwordSource.passwordHash}, 'Willkommen', 'Trainer', 'trainer', 'active'),
        (${foreignOrganizationId}, ${foreignMemberEmail}, ${passwordSource.passwordHash}, 'Fremdes', 'Mitglied', 'member', 'active')
      returning id, email, role
    `;
    const admin = people.find((person) => person.email === adminEmail)!;
    memberId = people.find((person) => person.email === memberEmail)!.id;
    foreignMemberId = people.find(
      (person) => person.email === foreignMemberEmail,
    )!.id;
    await sql`
      insert into api_keys (
        organization_id, name, prefix, key_hash, scopes, created_by_id
      ) values (
        ${organizationId}, 'Welcome E2E API', ${apiSecret.slice(0, 20)},
        ${hashSecret(apiSecret)}, array['organization:read', 'organization:write'],
        ${admin.id}
      )
    `;
    await sql`
      insert into member_welcome_settings (
        organization_id, enabled, title, welcome_text, version
      ) values (
        ${foreignOrganizationId}, true, ${foreignTitle},
        'Dieser Text gehoert ausschliesslich zum fremden Tenant.', 4
      )
    `;

    await login(page, { organizationSlug, email: adminEmail });
    await page.goto("/admin/settings#willkommen");
    const form = page.locator("form#willkommen");
    await expect(form).toBeVisible();
    await form.getByLabel("Aktiv").check();
    await form.getByLabel("Titel").fill(title);
    await form
      .getByLabel("Begrüßungstext")
      .fill(
        "Orientiere dich kurz, ergaenze dein Profil und starte danach mit deinem Lernplan.",
      );
    await form.getByLabel("Profilbild anfragen").check();
    await form.getByLabel("Profilvervollständigung anfragen").check();
    await form
      .getByLabel("Video-URL (optional)")
      .fill("http://media.test/unsicher.mp4");
    await form.getByRole("button", { name: "Popup speichern" }).click();
    await expect(
      form.getByText(
        "Die Video-URL muss HTTPS verwenden und darf keine Zugangsdaten enthalten.",
      ),
    ).toBeVisible();

    await form.getByLabel("Video-URL (optional)").fill(videoUrl);
    await form.getByRole("button", { name: "Popup speichern" }).click();
    await expect(
      form.getByText("Willkommens-Popup als Version 1 gespeichert."),
    ).toBeVisible();
    await expect(form.getByLabel("Aktiv")).toBeChecked();
    await expect(form.getByLabel("Profilbild anfragen")).toBeChecked();
    await expect(
      form.getByLabel("Profilvervollständigung anfragen"),
    ).toBeChecked();
    await expect(
      form.getByRole("button", { name: "Popup speichern" }),
    ).toBeDisabled();

    const [stored] = await sql<
      Array<{
        title: string;
        version: number;
        videoUrl: string | null;
      }>
    >`
      select title, version, video_url as "videoUrl"
      from member_welcome_settings
      where organization_id = ${organizationId}
    `;
    expect(stored).toMatchObject({ title, version: 1, videoUrl });
    await page.screenshot({
      path: testInfo.outputPath("member-welcome-admin.png"),
      fullPage: true,
    });

    await login(page, { organizationSlug, email: memberEmail });
    await page.goto("/academy");
    let dialog = page.getByRole("dialog", { name: title });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(foreignTitle)).toHaveCount(0);
    await expect(dialog.locator("video")).toHaveAttribute("src", videoUrl);
    await expect(
      dialog.getByRole("link", { name: "Profilbild hinzufügen" }),
    ).toHaveAttribute("href", "/academy/profile");
    await expect(
      dialog.getByRole("link", { name: "Profil vervollständigen" }),
    ).toHaveAttribute("href", "/academy/profile");
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(1);
    await page.screenshot({
      path: testInfo.outputPath("member-welcome-member.png"),
      fullPage: true,
    });
    await dialog.getByRole("button", { name: "Loslegen" }).click();
    await expect(dialog).toBeHidden();

    const [firstAcknowledgement] = await sql<
      Array<{ version: number; eventCount: number }>
    >`
      select a.configuration_version as version,
             count(e.id)::int as "eventCount"
      from member_welcome_acknowledgements a
      left join activity_events e
        on e.organization_id = a.organization_id
       and e.user_id = a.user_id
       and e.type = 'platform.welcome.acknowledged'
      where a.organization_id = ${organizationId} and a.user_id = ${memberId}
      group by a.configuration_version
    `;
    expect(firstAcknowledgement).toEqual({ version: 1, eventCount: 1 });
    await page.reload();
    await expect(page.getByRole("dialog", { name: title })).toHaveCount(0);
    await login(page, { organizationSlug, email: memberEmail });
    await page.goto("/academy");
    await expect(page.getByRole("dialog", { name: title })).toHaveCount(0);

    const idempotencyKey = `welcome-update-${randomUUID()}`;
    const patch = () =>
      page.context().request.patch("/api/v1/organization/welcome-popup", {
        headers: {
          Authorization: `Bearer ${apiSecret}`,
          "Idempotency-Key": idempotencyKey,
        },
        data: { title: updatedTitle },
      });
    const updated = await patch();
    const updatedBody = await updated.json();
    expect(updated.ok(), JSON.stringify(updatedBody)).toBe(true);
    expect(updatedBody.data.version).toBe(2);
    const replayed = await patch();
    const replayedBody = await replayed.json();
    expect(replayed.ok(), JSON.stringify(replayedBody)).toBe(true);
    expect(replayed.headers()["idempotent-replayed"]).toBe("true");

    const [apiState] = await sql<
      Array<{ version: number; auditCount: number }>
    >`
      select s.version,
             count(l.id)::int as "auditCount"
      from member_welcome_settings s
      left join api_audit_logs l
        on l.organization_id = s.organization_id
       and l.action = 'organization.welcome.update'
       and l.response_status = 200
      where s.organization_id = ${organizationId}
      group by s.version
    `;
    expect(apiState.version).toBe(2);
    expect(apiState.auditCount).toBeGreaterThanOrEqual(1);

    await page.reload();
    dialog = page.getByRole("dialog", { name: updatedTitle });
    await expect(dialog).toBeVisible();
    await dialog
      .getByRole("button", { name: "Willkommens-Popup abschließen" })
      .click();
    await expect(dialog).toBeHidden();
    const [latestAcknowledgement] = await sql<Array<{ version: number }>>`
      select configuration_version as version
      from member_welcome_acknowledgements
      where organization_id = ${organizationId} and user_id = ${memberId}
    `;
    expect(latestAcknowledgement.version).toBe(2);

    await expect(
      sql`
        insert into member_welcome_acknowledgements (
          organization_id, user_id, configuration_version
        ) values (${organizationId}, ${foreignMemberId}, 2)
      `,
    ).rejects.toThrow();

    await login(page, { organizationSlug, email: trainerEmail });
    await page.goto("/academy");
    await expect(page.getByRole("dialog", { name: updatedTitle })).toHaveCount(
      0,
    );

    await login(page, {
      organizationSlug: foreignOrganizationSlug,
      email: foreignMemberEmail,
    });
    await page.goto("/academy");
    const foreignDialog = page.getByRole("dialog", { name: foreignTitle });
    await expect(foreignDialog).toBeVisible();
    await expect(foreignDialog.getByText(updatedTitle)).toHaveCount(0);
  } finally {
    if (organizationId) {
      await sql`delete from organizations where id = ${organizationId}`;
    }
    if (foreignOrganizationId) {
      await sql`delete from organizations where id = ${foreignOrganizationId}`;
    }
    await sql.end();
  }
});
