import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";
const demoPassword = "Demo123!";

async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("E-Mail-Adresse").fill(email);
  await page.getByLabel("Passwort", { exact: true }).fill(demoPassword);
  await page.getByRole("button", { name: /anmelden$/ }).click();
  await page.waitForURL("**/admin");
}

function privacyStepUpKeyHash(organizationId: string, userId: string) {
  const secret =
    process.env.AUTH_RATE_LIMIT_SECRET?.trim() ||
    process.env.SESSION_SECRET?.trim() ||
    "q-academy-local-development-secret-change-me";
  const action = "privacy_step_up";
  const identifier = `${organizationId}\0${userId}`;
  const material = ["v1", action, identifier, ""].join("\0");
  return createHmac("sha256", secret).update(material).digest("hex");
}

test("privacy scopes stay hidden from admins and require owner password step-up", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "targeted privacy security flow");
  test.setTimeout(90_000);

  const client = postgres(databaseUrl, { max: 1, prepare: false });
  const suffix = randomUUID();
  const hiddenKeyName = `E2E Privacy hidden ${suffix}`;
  const forgedKeyName = `E2E Privacy forged ${suffix}`;
  const regularKeyName = `E2E API regular ${suffix}`;
  const ownerKeyName = `E2E Privacy owner ${suffix}`;
  let organizationId = "";
  let ownerId = "";

  try {
    const [fixture] = await client<
      Array<{
        organization_id: string;
        owner_id: string;
        owner_email: string;
        admin_email: string;
      }>
    >`
      select
        owner.organization_id,
        owner.id as owner_id,
        owner.email as owner_email,
        admin.email as admin_email
      from users owner
      join users admin
        on admin.organization_id = owner.organization_id
       and admin.role = 'admin'
       and admin.status = 'active'
      where owner.email = 'admin@q-academy.de'
        and owner.role = 'owner'
        and owner.status = 'active'
      order by admin.created_at asc
      limit 1
    `;
    expect(fixture).toBeTruthy();
    organizationId = fixture.organization_id;
    ownerId = fixture.owner_id;

    const hiddenSecret = `qak_test_${randomBytes(28).toString("base64url")}`;
    await client`
      insert into api_keys (
        organization_id,
        name,
        prefix,
        key_hash,
        scopes,
        created_by_id
      ) values (
        ${organizationId},
        ${hiddenKeyName},
        ${hiddenSecret.slice(0, 17)},
        ${createHash("sha256").update(hiddenSecret).digest("hex")},
        array['privacy:read'],
        ${ownerId}
      )
    `;

    await login(page, fixture.admin_email);
    await page.goto("/admin/api");
    await expect(page.getByRole("heading", { name: "API-Konsole" })).toBeVisible();
    await expect(page.getByText(hiddenKeyName, { exact: true })).toHaveCount(0);
    await expect(page.getByText("privacy:read", { exact: true })).toHaveCount(0);
    await expect(page.getByText("privacy:write", { exact: true })).toHaveCount(0);
    await expect(page.getByText("authentication:read", { exact: true })).toHaveCount(0);
    await expect(page.getByText("authentication:write", { exact: true })).toHaveCount(0);

    await page.getByRole("button", { name: "API-Schluessel", exact: true }).click();
    let dialog = page.getByRole("dialog", { name: "API-Schluessel erstellen" });
    await expect(dialog.locator('input[name="scopes"][value="privacy:read"]')).toHaveCount(0);
    await dialog.getByLabel("Name").fill(forgedKeyName);
    await dialog.locator("form").evaluate((form) => {
      const forgedScope = document.createElement("input");
      forgedScope.type = "hidden";
      forgedScope.name = "scopes";
      forgedScope.value = "privacy:read";
      form.append(forgedScope);
    });
    await dialog.getByRole("button", { name: "Schluessel erstellen" }).click();
    await expect(dialog.getByRole("alert")).toContainText(
      "Owner-gebundene Scopes koennen nur von einem Owner erstellt werden.",
    );
    const [forgedCount] = await client<Array<{ count: number }>>`
      select count(*)::int as count
      from api_keys
      where organization_id = ${organizationId}
        and name = ${forgedKeyName}
    `;
    expect(forgedCount.count).toBe(0);

    await dialog.getByRole("button", { name: "Dialog schliessen" }).click();
    await page.getByRole("button", { name: "API-Schluessel", exact: true }).click();
    dialog = page.getByRole("dialog", { name: "API-Schluessel erstellen" });
    await dialog.getByLabel("Name").fill(regularKeyName);
    await dialog.locator('input[name="scopes"][value="courses:read"]').check();
    await expect(dialog.getByLabel("Aktuelles Passwort")).toHaveCount(0);
    await dialog.getByRole("button", { name: "Schluessel erstellen" }).click();
    await expect(dialog.getByText("Nur einmal sichtbar", { exact: true })).toBeVisible();
    const [regularKey] = await client<Array<{ scopes: string[]; created_by_id: string }>>`
      select scopes, created_by_id
      from api_keys
      where organization_id = ${organizationId}
        and name = ${regularKeyName}
      limit 1
    `;
    expect(regularKey.scopes).toEqual(["courses:read"]);
    expect(regularKey.created_by_id).toBeTruthy();

    await page.context().clearCookies();
    await login(page, fixture.owner_email);
    await page.goto("/admin/api");
    await expect(page.getByText(hiddenKeyName, { exact: true })).toBeVisible();
    await expect(page.getByText("privacy:read", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("privacy:write", { exact: true }).first()).toBeVisible();

    await page.getByRole("button", { name: "API-Schluessel", exact: true }).click();
    dialog = page.getByRole("dialog", { name: "API-Schluessel erstellen" });
    await dialog.getByLabel("Name").fill(ownerKeyName);
    await dialog.locator('input[name="scopes"][value="privacy:read"]').check();
    const currentPassword = dialog.getByLabel("Aktuelles Passwort");
    await expect(currentPassword).toBeVisible();
    await currentPassword.fill("Wrong123!");
    await dialog.getByRole("button", { name: "Schluessel erstellen" }).click();
    await expect(dialog.getByRole("alert")).toContainText(
      "Das aktuelle Passwort ist nicht korrekt.",
    );
    const [wrongPasswordCount] = await client<Array<{ count: number }>>`
      select count(*)::int as count
      from api_keys
      where organization_id = ${organizationId}
        and name = ${ownerKeyName}
    `;
    expect(wrongPasswordCount.count).toBe(0);

    await dialog.getByLabel("Name").fill(ownerKeyName);
    await dialog.locator('input[name="scopes"][value="privacy:read"]').check();
    await currentPassword.fill(demoPassword);
    await dialog.getByRole("button", { name: "Schluessel erstellen" }).click();
    await expect(dialog.getByText("Nur einmal sichtbar", { exact: true })).toBeVisible();
    const [privacyKey] = await client<
      Array<{ scopes: string[]; created_by_id: string }>
    >`
      select scopes, created_by_id
      from api_keys
      where organization_id = ${organizationId}
        and name = ${ownerKeyName}
      limit 1
    `;
    expect(privacyKey.scopes).toEqual(["privacy:read"]);
    expect(privacyKey.created_by_id).toBe(ownerId);
  } finally {
    if (organizationId) {
      await client`
        delete from api_keys
        where organization_id = ${organizationId}
          and name in (
            ${hiddenKeyName},
            ${forgedKeyName},
            ${regularKeyName},
            ${ownerKeyName}
          )
      `;
    }
    if (organizationId && ownerId) {
      await client`
        delete from auth_rate_limits
        where action = 'privacy_step_up'
          and key_hash = ${privacyStepUpKeyHash(organizationId, ownerId)}
      `;
    }
    await client.end({ timeout: 5 });
  }
});
