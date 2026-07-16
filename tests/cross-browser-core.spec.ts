import { expect, test, type Page } from "@playwright/test";

import { completeMemberWelcomeIfVisible } from "./helpers/member-welcome";
import { getCoreDictionary } from "../src/lib/i18n/dictionaries";

const authCopy = getCoreDictionary("de").auth;

async function assertRendered(page: Page, path: string) {
  const response = await page.goto(path, { waitUntil: "domcontentloaded" });
  expect(response?.status(), `${path} did not render successfully`).toBeLessThan(400);
  await expect(page.getByRole("main")).toHaveCount(1);
  await expect(page.getByRole("main")).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, `${path} has viewport overflow`).toBeLessThanOrEqual(1);
}

async function login(page: Page, role: "admin" | "member") {
  await page.goto("/login");
  await page
    .getByRole("button", {
      name: role === "admin" ? "Als Admin testen" : "Als Mitglied testen",
    })
    .click();
  await page.waitForURL(role === "admin" ? "**/admin" : "**/academy");
  if (role === "member") await completeMemberWelcomeIfVisible(page);
}

test("public login renders and accepts keyboard input", async ({ page }) => {
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  const email = page.getByLabel("E-Mail-Adresse");
  await expect(email).toBeEnabled();
  await email.focus();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type("browser-smoke@example.com");
  await expect(email).toHaveValue("browser-smoke@example.com");
  await expect(
    page.getByRole("button", { name: authCopy.signInAt("Q-Academy") }),
  ).toBeEnabled();
});

test("admin core routes render without browser-specific failures", async ({ page }) => {
  await login(page, "admin");
  for (const path of ["/admin", "/admin/courses", "/admin/settings"]) {
    await assertRendered(page, path);
  }
});

test("learner core routes render without browser-specific failures", async ({ page }) => {
  await login(page, "member");
  for (const path of [
    "/academy",
    "/academy/courses",
    "/academy/community",
    "/academy/profile",
  ]) {
    await assertRendered(page, path);
  }
});
