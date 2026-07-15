import { expect, test } from "@playwright/test";
import { getAiMemberCopy } from "../src/lib/i18n/ai-member";
import { completeMemberWelcomeIfVisible } from "./helpers/member-welcome";
import { acknowledgeAiTransparency } from "./helpers/ai-transparency";

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

test.describe("Q-Academy", () => {
  test("public login is branded without an unsupported compliance claim", async ({
    page,
  }, testInfo) => {
    await page.goto("/login");

    await expect(
      page.getByRole("heading", { name: "Lernen, anwenden, besser werden." }),
    ).toBeVisible();
    await expect(page.getByText("Q-Academy | Lernumgebung")).toBeVisible();
    await expect(page.getByText("DSGVO-orientiert")).toHaveCount(0);

    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
    await page.screenshot({
      path: testInfo.outputPath("login.png"),
      fullPage: true,
    });
  });

  test("member learning flow is available", async ({ page }, testInfo) => {
    await loginAsMember(page);
    await acknowledgeAiTransparency(page);
    await expect(
      page.getByRole("heading", { name: /Willkommen zurueck/ }),
    ).toBeVisible();
    await page.waitForLoadState("networkidle");
    await page.screenshot({
      path: testInfo.outputPath("member-dashboard.png"),
      fullPage: true,
    });

    await page.getByRole("button", { name: memberCopy.concierge.open }).click();
    await expect(
      page.getByRole("dialog", { name: "Q-Academy Lernbegleiter" }),
    ).toBeVisible();
    await expect(
      page.getByRole("log", { name: "Kompakter Konversationsverlauf" }),
    ).toHaveAttribute("aria-busy", "false");
    const privacyAnswers = page.getByText(
      /keine personenbezogenen, vertraulichen/,
    );
    const previousPrivacyAnswerCount = await privacyAnswers.count();
    await page
      .getByRole("button", { name: "Was gilt bei DSGVO und KI?" })
      .click();
    await expect(privacyAnswers).toHaveCount(previousPrivacyAnswerCount + 1);
    const closeButtons = page.getByRole("button", {
      name: memberCopy.concierge.close,
    });
    await expect(closeButtons).toHaveCount(2);
    await closeButtons.nth(0).click();

    await page.goto("/academy/courses");
    await expect(
      page.getByRole("heading", { name: "Meine Kurse" }),
    ).toBeVisible();
    const foundation = page.getByRole("link", { name: /KI-Grundlagen/ });
    await expect(foundation).toBeVisible();
    await foundation.click();
    await expect(
      page.getByRole("heading", { name: "KI-Grundlagen" }),
    ).toBeVisible();
    const lessonLink = page.getByRole("link", {
      name: /Dein Start in die Q-Academy/,
    });
    await expect(lessonLink).toBeVisible();
    await lessonLink.click();
    await expect(
      page.getByRole("heading", { name: "Dein Start in die Q-Academy" }),
    ).toBeVisible();
    if (testInfo.project.name === "chromium") {
      await page.screenshot({
        path: testInfo.outputPath("lesson-reader.png"),
        fullPage: true,
      });
    }

    await page.goto("/academy/community");
    await expect(
      page.getByRole("heading", { name: "Q-Community" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Teile eine Frage/ }),
    ).toBeVisible();
  });

  test("admin management flow is available", async ({ page }, testInfo) => {
    await loginAsAdmin(page);
    await expect(
      page.getByRole("heading", { name: /Guten Morgen/ }),
    ).toBeVisible();
    await expect(page.locator(".recharts-surface")).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("admin-dashboard.png"),
      fullPage: true,
    });

    await page.goto("/admin/courses");
    await expect(page.getByRole("heading", { name: "Kurse" })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "KI-Grundlagen" }),
    ).toBeVisible();
    await page.getByRole("link", { name: "KI-Grundlagen bearbeiten" }).click();
    await expect(page.getByText("Kursstruktur")).toBeVisible();
    if (testInfo.project.name === "chromium") {
      await page.screenshot({
        path: testInfo.outputPath("course-builder.png"),
        fullPage: true,
      });
    }

    await page.goto("/admin/tasks");
    await expect(
      page.getByRole("heading", { name: "Aufgaben-Center" }),
    ).toBeVisible();
    await expect(page.getByText("Trainer-Bewertung")).toBeVisible();
  });

  test("mobile dashboard has no horizontal overflow", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "mobile-only assertion");
    await loginAsMember(page);
    await page.waitForLoadState("networkidle");
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
    await page.screenshot({
      path: testInfo.outputPath("member-mobile.png"),
      fullPage: true,
    });
  });

  test("all primary authenticated routes render", async ({ page }) => {
    test.setTimeout(120_000);
    const hydrationWarnings: string[] = [];
    page.on("console", (message) => {
      if (
        /hydrated but some attributes|hydration failed/i.test(message.text())
      ) {
        hydrationWarnings.push(`${page.url()}: ${message.text()}`);
      }
    });
    await loginAsAdmin(page);
    const adminRoutes = [
      "/admin/modules",
      "/admin/members",
      "/admin/groups",
      "/admin/bundles",
      "/admin/certificates",
      "/admin/community",
      "/admin/hubs",
      "/admin/events",
      "/admin/ai",
      "/admin/analytics",
      "/admin/announcements",
      "/admin/api",
      "/admin/email",
      "/admin/email/templates",
      "/admin/email/suppressions",
      "/admin/integrations",
      "/admin/privacy",
      "/admin/settings",
      "/admin/tasks",
    ];
    for (const route of adminRoutes) {
      const response = await page.goto(route);
      expect(response?.status(), route).toBeLessThan(400);
    }

    await page.goto("/academy");
    const memberRoutes = [
      "/academy/courses",
      "/academy/certificates",
      "/academy/community",
      "/academy/events",
      "/academy/hub",
      "/academy/ai",
      "/academy/profile",
    ];
    for (const route of memberRoutes) {
      const response = await page.goto(route);
      expect(response?.status(), route).toBeLessThan(400);
    }
    expect(hydrationWarnings, hydrationWarnings.join("\n\n")).toEqual([]);
  });
});
