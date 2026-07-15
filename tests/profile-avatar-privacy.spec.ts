import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";
import postgres from "postgres";

import { completeMemberWelcomeIfVisible } from "./helpers/member-welcome";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";
const apiKey =
  process.env.DEMO_API_KEY ?? "qak_demo_qacademy_2026_local_development";

test("legacy remote avatars are redacted and new remote sources are rejected", async ({
  page,
  request,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Focused privacy lifecycle runs once");
  const client = postgres(databaseUrl, { prepare: false });
  const suffix = randomUUID().slice(0, 8);
  const email = `avatar-privacy-${suffix}@example.com`;
  const remoteAvatar = `https://tracker.example.test/${suffix}.png`;
  const localAvatar = "/images/courses/foundations.webp";
  const remoteRequests: string[] = [];
  let memberId = "";

  await page.route("https://tracker.example.test/**", async (route) => {
    remoteRequests.push(route.request().url());
    await route.fulfill({ status: 204 });
  });

  try {
    const [fixture] = await client<
      Array<{ organization_id: string; password_hash: string }>
    >`
      select organization_id, password_hash
      from users
      where email = 'lea@q-academy.de'
      limit 1
    `;
    const [member] = await client<Array<{ id: string }>>`
      insert into users (
        organization_id, email, password_hash, first_name, last_name,
        role, status, avatar_url
      ) values (
        ${fixture.organization_id}, ${email}, ${fixture.password_hash},
        'Avatar', ${`Privacy ${suffix}`}, 'member', 'active', ${remoteAvatar}
      )
      returning id
    `;
    memberId = member.id;

    await page.goto("/login");
    await page.getByLabel("E-Mail-Adresse").fill(email);
    await page.getByLabel("Passwort", { exact: true }).fill("Demo123!");
    await page.getByRole("button", { name: "Bei Q-Academy anmelden" }).click();
    await page.waitForURL("**/academy");
    await completeMemberWelcomeIfVisible(page);
    const profileResponse = await page.goto("/academy/profile");
    await expect(page.getByRole("heading", { name: "Mein Profil" })).toBeVisible();
    await expect(page.getByText("Kein Bild", { exact: true })).toBeVisible();
    await expect(page.getByAltText("Profilbild Vorschau")).toHaveCount(0);
    const profilePayload = (await profileResponse?.text()) ?? "";
    expect(profilePayload).not.toContain(fixture.password_hash);
    expect(profilePayload).not.toContain("passwordHash");

    const meResponse = await page.request.get("/api/v1/me");
    expect(meResponse.ok()).toBe(true);
    expect((await meResponse.json()).data.avatarUrl).toBeNull();

    const memberResponse = await request.get(
      `/api/v1/members?search=${encodeURIComponent(email)}`,
      { headers: { Authorization: `Bearer ${apiKey}` } },
    );
    expect(memberResponse.ok()).toBe(true);
    const memberPayload = await memberResponse.json();
    expect(memberPayload.data).toHaveLength(1);
    expect(memberPayload.data[0].avatarUrl).toBeNull();
    expect(remoteRequests).toEqual([]);

    await client`
      update users set avatar_url = ${localAvatar} where id = ${memberId}
    `;
    await page.reload();
    await expect(page.getByAltText("Profilbild Vorschau")).toHaveAttribute(
      "src",
      localAvatar,
    );

    await page
      .getByRole("button", { name: "Profil speichern" })
      .locator("xpath=ancestor::form")
      .evaluate((form, value) => {
        form.addEventListener(
          "formdata",
          (event) => {
            (event as FormDataEvent).formData.set("avatarAssetId", value);
          },
          { once: true },
        );
      }, remoteAvatar);
    await page.getByRole("button", { name: "Profil speichern" }).click();
    await expect(
      page.getByText("Das Profilbild ist ungueltig."),
    ).toBeVisible();
    const [stored] = await client<Array<{ avatar_url: string | null }>>`
      select avatar_url from users where id = ${memberId}
    `;
    expect(stored.avatar_url).toBe(localAvatar);
    expect(remoteRequests).toEqual([]);
  } finally {
    if (memberId) {
      await client`delete from activity_events where entity_id = ${memberId}`;
      await client`delete from users where id = ${memberId}`;
    }
    await client.end();
  }
});
