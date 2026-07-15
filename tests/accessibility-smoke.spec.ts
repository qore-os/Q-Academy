import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";

import { completeMemberWelcomeIfVisible } from "./helpers/member-welcome";
import { getAnnouncementCopy } from "../src/lib/i18n/announcements";

type ImportantViolation = {
  id: string;
  impact: string | null;
  help: string;
  nodes: Array<{ target: string; html: string; failure: string | undefined }>;
};

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";

async function importantViolations(page: Page): Promise<ImportantViolation[]> {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  return result.violations
    .filter((violation) =>
      violation.impact === "critical" || violation.impact === "serious",
    )
    .map((violation) => ({
      id: violation.id,
      impact: violation.impact ?? null,
      help: violation.help,
      nodes: violation.nodes.slice(0, 10).map((node) => ({
        target: node.target.join(" "),
        html: node.html.slice(0, 500),
        failure: node.failureSummary,
      })),
    }));
}

async function assertAccessible(page: Page, path: string) {
  const response = await page.goto(path, { waitUntil: "networkidle" });
  expect(response?.status(), `${path} did not render successfully`).toBeLessThan(400);
  expect(await importantViolations(page), `${path} has serious WCAG violations`).toEqual([]);
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

test("public login has no serious WCAG A/AA violations", async ({ page }) => {
  await assertAccessible(page, "/login");
});

test("critical admin workflows have no serious WCAG A/AA violations", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await login(page, "admin");
  for (const path of [
    "/admin",
    "/admin/modules",
    "/admin/members",
    "/admin/groups",
    "/admin/bundles",
    "/admin/community",
    "/admin/events",
    "/admin/ai",
    "/admin/announcements",
    "/admin/api",
    "/admin/privacy",
    "/admin/settings",
    "/admin/courses/48daf731-79fa-4c76-85c2-b4e6324bfeb4",
  ]) {
    await assertAccessible(page, path);
  }
});

test("critical learner workflows have no serious WCAG A/AA violations", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const client = postgres(databaseUrl, { prepare: false });
  let notificationId: string | undefined;

  try {
    const [member] = await client<Array<{ id: string }>>`
      select id from users
      where email = 'lea@q-academy.de'
      limit 1
    `;
    expect(member).toBeTruthy();
    const [notification] = await client<Array<{ id: string }>>`
      insert into notifications (user_id, title, body, type, href, read)
      values (
        ${member.id},
        'Accessibility contrast fixture',
        'Keeps the unread notification badge covered by the learner audit.',
        'info',
        null,
        false
      )
      returning id
    `;
    notificationId = notification.id;

    await login(page, "member");
    for (const path of [
      "/academy",
      "/academy/courses",
      "/academy/certificates",
      "/academy/community",
      "/academy/events",
      "/academy/hub",
      "/academy/ai",
      "/academy/profile",
    ]) {
      await assertAccessible(page, path);
    }
  } finally {
    if (notificationId) {
      await client`delete from notifications where id = ${notificationId}`;
    }
    await client.end();
  }
});

test("announcement editor has an accessible modal focus lifecycle", async ({
  page,
}) => {
  const copy = getAnnouncementCopy("de");
  await login(page, "admin");
  await page.goto("/admin/announcements", { waitUntil: "networkidle" });
  const trigger = page.getByRole("button", { name: copy.manager.create });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: copy.editor.createTitle });
  await expect(dialog).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.closest('[role="dialog"]') !== null))
    .toBe(true);
  expect(await importantViolations(page)).toEqual([]);

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});
