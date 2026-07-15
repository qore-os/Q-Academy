import { expect, test } from "@playwright/test";
import { getAiMemberCopy } from "../src/lib/i18n/ai-member";
import { completeMemberWelcomeIfVisible } from "./helpers/member-welcome";

const memberCopy = getAiMemberCopy("de");

async function loginAsMember(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page
    .getByRole("button", { name: /Lernenden-Demo|Als Mitglied testen/ })
    .click();
  await page.waitForURL("**/academy");
  await completeMemberWelcomeIfVisible(page);
}

async function loginAsAdmin(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page
    .getByRole("button", { name: /Admin-Demo|Als Admin testen/ })
    .click();
  await page.waitForURL("**/admin");
}

test("member course and event filters change the visible results", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium",
    "targeted desktop filter flow",
  );
  await loginAsMember(page);

  await page.goto("/academy/courses");
  const search = page.getByRole("textbox", { name: "Kurse durchsuchen" });
  await search.fill("Responsible AI");
  await expect(
    page.getByRole("link", { name: /Responsible AI/ }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: /KI-Grundlagen/ })).toHaveCount(
    0,
  );

  await search.fill("");
  await page.getByRole("button", { name: "Abgeschlossen" }).click();
  await expect(
    page.getByRole("link", { name: /Responsible AI/ }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: /KI-Grundlagen/ })).toHaveCount(
    0,
  );

  await page.getByRole("button", { name: "Aktiv", exact: true }).click();
  await expect(page.getByRole("link", { name: /KI-Grundlagen/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Responsible AI/ })).toHaveCount(
    0,
  );

  await page.goto("/academy/events");
  const eventCards = page.locator('main article[id^="event-"]');
  await expect(eventCards.first()).toBeVisible();
  const upcomingIds = await eventCards.evaluateAll((cards) =>
    cards.map((card) => card.id),
  );

  const mineFilter = page.getByRole("button", { name: "Meine Termine" });
  await mineFilter.click();
  await expect(mineFilter).toHaveAttribute("aria-pressed", "true");
  const mineIds = await eventCards.evaluateAll((cards) =>
    cards.map((card) => card.id),
  );
  expect(mineIds.length).toBeGreaterThan(0);
  expect(mineIds.length).toBeLessThan(upcomingIds.length);
  expect(mineIds.every((id) => upcomingIds.includes(id))).toBe(true);

  const pastFilter = page.getByRole("button", { name: "Vergangen" });
  await pastFilter.click();
  await expect(pastFilter).toHaveAttribute("aria-pressed", "true");
  const pastIds = await eventCards.evaluateAll((cards) =>
    cards.map((card) => card.id),
  );
  expect(pastIds.every((id) => !upcomingIds.includes(id))).toBe(true);
});

test("admin surfaces expose real controls without demo placeholders", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium",
    "targeted desktop admin audit",
  );
  await loginAsAdmin(page);

  await page.goto("/admin/analytics");
  const exportLink = page.getByRole("link", { name: "Bericht exportieren" });
  await expect(exportLink).toHaveAttribute(
    "download",
    "q-academy-kursbericht.csv",
  );
  await expect(exportLink).toHaveAttribute("href", "/admin/analytics/export");

  await page.goto("/admin/events");
  await expect(page.getByText(/KW \+/)).toHaveCount(0);

  await page.goto("/admin/settings");
  const logoUpload = page.getByRole("button", {
    name: "Standardlogo hochladen",
    exact: true,
  });
  await expect(logoUpload).toBeVisible();
  await expect(logoUpload).toHaveAttribute("accept", /image\/png/);
  await page.getByLabel("Plattformname").fill("Audit Academy");
  await expect(page.getByText("Audit Academy", { exact: true })).toBeVisible();
  const settingsNavigation = page.getByRole("navigation", {
    name: "Einstellungsbereiche",
  });
  const ssoLink = settingsNavigation.getByRole("link", { name: "SSO" });
  await ssoLink.click();
  await expect(page).toHaveURL(/#sso$/);
  await expect(ssoLink).toHaveAttribute("aria-current", "location");
});

test("mobile member invitation stays inside a short viewport", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "mobile-only dialog audit");
  await page.setViewportSize({ width: 390, height: 440 });
  await loginAsAdmin(page);
  await page.goto("/admin/members");
  await page.getByRole("button", { name: "Mitglied einladen" }).click();

  const panel = page.getByTestId("invite-member-panel");
  await expect(panel).toBeVisible();
  const panelBox = await panel.boundingBox();
  expect(panelBox).not.toBeNull();
  expect(panelBox!.y).toBeGreaterThanOrEqual(0);
  expect(panelBox!.y + panelBox!.height).toBeLessThanOrEqual(440);

  const form = panel.locator("form");
  const dimensions = await form.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }));
  expect(dimensions.scrollHeight).toBeGreaterThan(dimensions.clientHeight);
  await panel
    .getByRole("button", { name: "Einladung anlegen" })
    .scrollIntoViewIfNeeded();
  await expect(
    panel.getByRole("button", { name: "Einladung anlegen" }),
  ).toBeVisible();
});

test("mobile lesson reader opens the course navigation", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "mobile-only navigation flow");
  await loginAsMember(page);
  await page.goto("/academy/courses/ki-grundlagen");
  await page.getByRole("link", { name: /Dein Start in die Q-Academy/ }).click();
  await page.getByLabel("Kursnavigation").click();
  await expect(
    page.getByRole("navigation").getByRole("link", {
      name: /Wissenscheck: Modelle/,
    }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(1);
});

test("mobile Q-Coach uses its reserved navigation slot", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "mobile-only Q-Coach layout");
  await loginAsMember(page);

  const mobileNavigation = page.getByRole("navigation", {
    name: "Mobile Hauptnavigation",
  });
  const coachButton = page.getByRole("button", {
    name: memberCopy.concierge.open,
  });
  await expect(mobileNavigation).toBeVisible();
  await expect(coachButton).toBeVisible();

  const navigationBox = await mobileNavigation.boundingBox();
  const coachBox = await coachButton.boundingBox();
  expect(navigationBox).not.toBeNull();
  expect(coachBox).not.toBeNull();
  expect(coachBox!.y).toBeGreaterThanOrEqual(navigationBox!.y);
  expect(coachBox!.y + coachBox!.height).toBeLessThanOrEqual(
    navigationBox!.y + navigationBox!.height,
  );

  const linkBoxes = await mobileNavigation
    .getByRole("link")
    .evaluateAll((links) =>
      links.map((link) => {
        const box = link.getBoundingClientRect();
        return { x: box.x, y: box.y, width: box.width, height: box.height };
      }),
    );
  for (const linkBox of linkBoxes) {
    const overlaps =
      coachBox!.x < linkBox.x + linkBox.width &&
      coachBox!.x + coachBox!.width > linkBox.x &&
      coachBox!.y < linkBox.y + linkBox.height &&
      coachBox!.y + coachBox!.height > linkBox.y;
    expect(overlaps).toBe(false);
  }

  await coachButton.click();
  const panel = page.getByRole("dialog", {
    name: "Q-Academy Lernbegleiter",
  });
  await expect(panel).toBeVisible();
  const panelBox = await panel.boundingBox();
  expect(panelBox).not.toBeNull();
  expect(panelBox!.y + panelBox!.height).toBeLessThanOrEqual(navigationBox!.y);
});
