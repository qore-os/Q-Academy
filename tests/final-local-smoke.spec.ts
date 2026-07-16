import { expect, test, type Page, type TestInfo } from "@playwright/test";

import { completeMemberWelcomeIfVisible } from "./helpers/member-welcome";

type Diagnostics = {
  consoleErrors: string[];
  failedRequests: string[];
  pageErrors: string[];
};

function collectDiagnostics(page: Page): Diagnostics {
  const diagnostics: Diagnostics = {
    consoleErrors: [],
    failedRequests: [],
    pageErrors: [],
  };
  page.on("console", (message) => {
    if (message.type() === "error") diagnostics.consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => diagnostics.pageErrors.push(error.message));
  page.on("requestfailed", (request) => {
    diagnostics.failedRequests.push(
      `${request.method()} ${request.url()} ${request.failure()?.errorText ?? "failed"}`,
    );
  });
  return diagnostics;
}

async function loginAsAdmin(page: Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: "Als Admin testen" }).click();
  await page.waitForURL("**/admin");
}

async function loginAsMember(page: Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: "Als Mitglied testen" }).click();
  await page.waitForURL("**/academy");
  await completeMemberWelcomeIfVisible(page);
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
}

async function capture(page: Page, testInfo: TestInfo, name: string) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
  await expectNoHorizontalOverflow(page);
  await page.screenshot({
    path: testInfo.outputPath(`${name}.png`),
    fullPage: true,
    caret: "initial",
  });
}

async function visit(
  page: Page,
  path: string,
) {
  const response = await page.goto(path, { waitUntil: "domcontentloaded" });
  expect(response, `No navigation response for ${path}`).not.toBeNull();
  expect(response!.status(), `${path} returned HTTP ${response!.status()}`).toBeLessThan(400);
}

function expectDiagnosticsClean(diagnostics: Diagnostics) {
  expect(diagnostics.pageErrors, "uncaught page errors").toEqual([]);
  expect(diagnostics.failedRequests, "failed browser requests").toEqual([]);
  expect(diagnostics.consoleErrors, "browser console errors").toEqual([]);
}

test("admin roles and integrations render without runtime errors", async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  const diagnostics = collectDiagnostics(page);
  await loginAsAdmin(page);

  await visit(page, "/admin/settings/roles");
  await expect(page.getByRole("heading", { name: "Rollen & Rechte" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Neue Team-Rolle" })).toBeVisible();
  await capture(page, testInfo, "roles");

  await visit(page, "/admin/integrations");
  await expect(page.getByRole("heading", { name: "Integrationen" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Verkaufsprovider" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "n8n-Workflows" })).toBeVisible();
  await capture(page, testInfo, "integrations-commerce");

  expectDiagnosticsClean(diagnostics);
});

test("admin community badges and agent actions render without runtime errors", async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  const diagnostics = collectDiagnostics(page);
  await loginAsAdmin(page);

  await visit(page, "/admin/community");
  await expect(page.getByRole("heading", { name: "Community", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Badge-Gruppen & Auszeichnungen" })).toBeVisible();
  await capture(page, testInfo, "community-badges");

  await visit(page, "/admin/ai");
  await expect(page.getByRole("heading", { name: "Agent-Studio" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Aktionsfreigaben" })).toBeVisible();
  await capture(page, testInfo, "agent-studio-actions");

  expectDiagnosticsClean(diagnostics);
});

test("orbit control plane renders without runtime errors", async ({ page }, testInfo) => {
  test.setTimeout(45_000);
  const diagnostics = collectDiagnostics(page);
  await loginAsAdmin(page);

  await visit(page, "/orbit");
  await expect(page.getByRole("heading", { name: "Orbit Control Plane" })).toBeVisible();
  await capture(page, testInfo, "orbit");

  expectDiagnosticsClean(diagnostics);
});

test("course builder pages styles and presence render without runtime errors", async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  const diagnostics = collectDiagnostics(page);
  await loginAsAdmin(page);

  await visit(page, "/admin/courses");
  const courseEditorLink = page.getByRole("link", {
    name: "KI-Grundlagen Bearbeiten",
    exact: true,
  });
  await expect(courseEditorLink).toHaveAttribute(
    "href",
    /^\/admin\/courses\/[0-9a-f-]+$/,
  );
  const courseEditorPath = await courseEditorLink.getAttribute("href");
  if (!courseEditorPath) throw new Error("KI-Grundlagen editor link is missing.");
  await visit(page, courseEditorPath);
  await expect(page.getByRole("heading", { name: "KI-Grundlagen" })).toBeVisible();
  const tabLabelsAreContained = await page
    .locator(
      '[role="tablist"][aria-label="Kurseditor-Bereiche"] [role="tab"] > span[aria-hidden="true"]',
    )
    .evaluateAll((labels) =>
      labels.every((label) => {
        const labelRect = label.getBoundingClientRect();
        const tabRect = label.parentElement?.getBoundingClientRect();
        return Boolean(
          tabRect &&
            labelRect.left >= tabRect.left - 1 &&
            labelRect.right <= tabRect.right + 1,
        );
      }),
    );
  expect(tabLabelsAreContained).toBe(true);

  const pagedLesson = page.getByRole("button", {
    name: "Was ein Sprachmodell wirklich tut",
  });
  await expect(pagedLesson).toHaveCount(1);
  await pagedLesson.click();
  await expect(page.getByLabel("Schnellnavigation zu einer Lektionsseite")).toBeVisible();

  const firstPage = page.getByRole("button", { name: "1. Grundidee", exact: true });
  await expect(firstPage).toHaveCount(1);
  await firstPage.click();
  await expect(page.getByLabel("Seite duplizieren")).toBeVisible();
  await expect(page.getByLabel("Seite ausblenden")).toBeVisible();
  await expect(page.getByLabel("Seite nach unten verschieben")).toBeVisible();

  const editHeading = page.getByRole("button", {
    name: "heading: Bearbeiten",
    exact: true,
  });
  await expect(editHeading).toHaveCount(1);
  await editHeading.click();
  const editor = page.getByRole("dialog", { name: "Inhaltselement bearbeiten" });
  await expect(editor.getByLabel("Blockbreite")).toBeVisible();
  await expect(editor.getByLabel("Ausrichtung")).toBeVisible();
  await expect(editor.getByLabel("Flaeche")).toBeVisible();
  await capture(page, testInfo, "course-builder-styles");
  await editor.getByRole("button", { name: "Dialog schliessen" }).click();

  await expect.poll(async () => page.getByLabel("Aktive Bearbeiter").count()).toBe(1);
  await capture(page, testInfo, "course-builder-pages-presence");

  expectDiagnosticsClean(diagnostics);
});

test("academy remains usable and responsive for a learner", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  const diagnostics = collectDiagnostics(page);
  await loginAsMember(page);

  await expect(page.getByRole("heading", { name: /Willkommen/ })).toBeVisible();
  await capture(page, testInfo, "academy-home");

  await visit(page, "/academy/courses");
  await expect(page.getByRole("heading", { name: "Meine Kurse" })).toBeVisible();
  await capture(page, testInfo, "academy-courses");

  await visit(page, "/academy/community");
  await expect(page.getByRole("heading", { name: "Q-Community" })).toBeVisible();
  await capture(page, testInfo, "academy-community");

  await visit(page, "/academy/profile");
  await expect(page.getByRole("heading", { name: "Mein Profil" })).toBeVisible();
  await capture(page, testInfo, "academy-profile-badges");

  expectDiagnosticsClean(diagnostics);
});
