import { expect, test, type Page } from "@playwright/test";

import { getCommunityAdminCopy } from "../src/lib/i18n/community-admin";
import { completeMemberWelcomeIfVisible } from "./helpers/member-welcome";

const adminCopy = getCommunityAdminCopy("de");

async function loginAsAdmin(page: Page) {
  await page.goto("/login");
  await page
    .getByRole("button", { name: /Admin-Demo|Als Admin testen/ })
    .click();
  await page.waitForURL("**/admin");
}

async function loginAsMember(page: Page) {
  await page.goto("/login");
  await page
    .getByRole("button", { name: /Lernenden-Demo|Als Mitglied testen/ })
    .click();
  await page.waitForURL("**/academy");
  await completeMemberWelcomeIfVisible(page);
}

async function expectNoPageOverflow(page: Page) {
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
}

test("admin exposes community layout and public-profile governance", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await loginAsAdmin(page);
  await page.goto("/admin/community", { waitUntil: "domcontentloaded" });

  await expect(
    page.getByRole("heading", { name: adminCopy.layout.heading }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: adminCopy.profile.heading }),
  ).toBeVisible();
  await expect(
    page.getByText(new RegExp(adminCopy.profile.impact("\\d+", "\\d+"))),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: adminCopy.layout.newArea }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: adminCopy.layout.newSpace }).first(),
  ).toBeVisible();
  await expectNoPageOverflow(page);
});

test("member can use grouped areas, RichText and public-profile navigation", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await loginAsMember(page);
  await page.goto("/academy/community", { waitUntil: "domcontentloaded" });

  await expect(page.getByTestId("community-area-groups")).toBeVisible();
  await page.getByTestId("community-composer-trigger").click();
  const composer = page.getByRole("dialog", { name: /Neuer Beitrag/ });
  await expect(composer).toBeVisible();
  await composer.getByRole("button", { name: "Formatiert" }).click();
  await expect(composer.locator('input[name="richText"]')).toBeAttached();
  await expect(composer.locator('textarea[name="content"]')).toHaveCount(0);
  await composer.getByRole("button", { name: /Dialog schliessen/ }).click();

  const profileLink = page
    .locator('a[href^="/academy/community/members/"]')
    .first();
  await expect(profileLink).toBeVisible();
  const profileHref = await profileLink.getAttribute("href");
  expect(profileHref).toMatch(/^\/academy\/community\/members\/[^/]+$/);
  if (!profileHref) throw new Error("Community profile link has no href.");
  await Promise.all([
    page.waitForURL((url) => url.pathname === profileHref),
    profileLink.click(),
  ]);
  await expect(
    page.getByRole("heading", { name: "Profilinformationen" }),
  ).toBeVisible();

  await page.goto("/academy/profile?community=required", {
    waitUntil: "domcontentloaded",
  });
  await expect(
    page.getByTestId("community-profile-requirements"),
  ).toBeVisible();
  await expectNoPageOverflow(page);
});
