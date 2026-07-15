import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import postgres from "postgres";

import { completeMemberWelcomeIfVisible } from "./helpers/member-welcome";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";

async function cleanupAnnouncement(title: string) {
  const client = postgres(databaseUrl, { max: 1, prepare: false });
  try {
    const rows = await client<Array<{ id: string }>>`
      select id from announcements where title = ${title}
    `;
    for (const row of rows) {
      await client`
        delete from activity_events
        where entity_type = 'announcement' and entity_id = ${row.id}
      `;
      await client`delete from announcements where id = ${row.id}`;
    }
  } finally {
    await client.end();
  }
}

type EnrollmentProgressSnapshot = {
  id: string;
  progress: number;
};

async function pinTargetMemberProgress() {
  const client = postgres(databaseUrl, { max: 1, prepare: false });
  try {
    const [snapshot] = await client<Array<EnrollmentProgressSnapshot>>`
      select enrollment.id, enrollment.progress
      from enrollments enrollment
      join users member on member.id = enrollment.user_id
      join courses course on course.id = enrollment.course_id
      where member.email = 'lea@q-academy.de'
        and course.slug = 'ki-grundlagen'
      limit 1
    `;
    if (!snapshot) throw new Error("Announcement target enrollment is missing.");
    await client`
      update enrollments
      set progress = 68
      where id = ${snapshot.id}
    `;
    return snapshot;
  } finally {
    await client.end();
  }
}

async function restoreTargetMemberProgress(snapshot: EnrollmentProgressSnapshot) {
  const client = postgres(databaseUrl, { max: 1, prepare: false });
  try {
    await client`
      update enrollments
      set progress = ${snapshot.progress}
      where id = ${snapshot.id}
    `;
  } finally {
    await client.end();
  }
}

test.describe.configure({ mode: "serial" });

test("rule preview, targeted delivery and unique insights form one workflow", async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  const title = `Regel-Hinweis ${randomUUID()}`;
  await cleanupAnnouncement(title);
  const enrollmentSnapshot = await pinTargetMemberProgress();

  try {
    await page.goto("/login");
    await page
      .getByRole("button", { name: /Admin-Demo|Als Admin testen/ })
      .click();
    await page.waitForURL("**/admin");
    await page.goto("/admin/announcements");
    await page.getByRole("button", { name: "Neue Ankuendigung" }).click();
    const dialog = page.getByRole("dialog", { name: "Neue Ankuendigung" });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Titel").fill(title);
    await dialog
      .getByLabel("Rich-Text Block 1")
      .fill("Dieser Hinweis wird durch fuenf UND-Regeln zielgenau ausgespielt.");
    await dialog.getByRole("button", { name: "Button", exact: true }).click();
    await dialog.getByLabel("Beschriftung").fill("Kurse ansehen");
    await dialog.getByRole("textbox", { name: "Ziel", exact: true }).fill("/academy/courses");

    const addRule = dialog.getByRole("button", { name: "Regel", exact: true });
    await addRule.click();
    await dialog.getByLabel("Rolle 1").selectOption("member");

    await addRule.click();
    await dialog.getByLabel("Regeltyp 2").selectOption("group");
    await dialog.getByLabel("Gruppe 2").selectOption({
      label: "Cohorte Juli 2026",
    });

    await addRule.click();
    await dialog.getByLabel("Regeltyp 3").selectOption("bundle");
    await dialog.getByLabel("Bundle 3").selectOption({ label: "AI Starter" });

    await addRule.click();
    await dialog.getByLabel("Regeltyp 4").selectOption("course_access");
    await dialog.getByLabel("Kurs 4").selectOption({ label: "KI-Grundlagen" });

    await addRule.click();
    await dialog.getByLabel("Regeltyp 5").selectOption("course_progress");
    await dialog
      .getByLabel("Fortschrittskurs 5")
      .selectOption({ label: "KI-Grundlagen" });
    await dialog.getByLabel("Fortschrittsvergleich 5").selectOption("at_least");
    await dialog.getByLabel("Fortschrittswert 5").fill("60");

    await dialog.getByRole("button", { name: "Vorschau berechnen" }).click();
    await expect(dialog.getByText("1 passende Mitglieder")).toBeVisible();
    await expect(dialog.getByText("Lea Hartmann")).toBeVisible();
    expect(
      await dialog.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);

    await dialog
      .getByRole("button", { name: "Ankuendigung speichern" })
      .click();
    await expect(dialog.getByText("Ankuendigung erstellt.")).toBeVisible();
    await dialog.getByRole("button", { name: "Editor schliessen" }).click();
    const adminRow = page.locator("article").filter({ hasText: title });
    await expect(adminRow).toContainText("5 Regeln");

    const auditClient = postgres(databaseUrl, { max: 1, prepare: false });
    try {
      const [audit] = await auditClient<
        Array<{ version: number; condition_count: number }>
      >`
        select
          (event.metadata ->> 'targetRuleVersion')::integer as version,
          (event.metadata ->> 'targetRuleCount')::integer as condition_count
        from activity_events event
        join announcements announcement on announcement.id = event.entity_id
        where announcement.title = ${title}
          and event.type = 'announcement.created'
        order by event.created_at desc
        limit 1
      `;
      expect(audit).toEqual({ version: 1, condition_count: 5 });
    } finally {
      await auditClient.end();
    }

    await page.context().clearCookies();
    await page.goto("/login");
    await page
      .getByRole("button", { name: /Lernenden-Demo|Als Mitglied testen/ })
      .click();
    await page.waitForURL("**/academy");
    await completeMemberWelcomeIfVisible(page);
    const delivered = page
      .getByLabel("Ankuendigungen")
      .locator("section")
      .filter({ hasText: title });
    await expect(delivered).toBeVisible();
    await delivered.getByRole("link", { name: "Kurse ansehen" }).click();
    await page.waitForURL("**/academy/courses");
    const deliveredAfterClick = page
      .getByLabel("Ankuendigungen")
      .locator("section")
      .filter({ hasText: title });
    await deliveredAfterClick
      .getByRole("button", { name: "Ankuendigung schliessen" })
      .click();
    await expect(deliveredAfterClick).toBeHidden();

    const client = postgres(databaseUrl, { max: 1, prepare: false });
    try {
      await expect
        .poll(async () => {
          const [counts] = await client<
            Array<{ impressions: number; clicks: number; dismissals: number }>
          >`
            select
              count(*) filter (where ai.kind = 'impression')::integer as impressions,
              count(*) filter (where ai.kind = 'click')::integer as clicks,
              count(*) filter (where ai.kind = 'dismiss')::integer as dismissals
            from announcement_interactions ai
            join announcements a on a.id = ai.announcement_id
            where a.title = ${title}
          `;
          return counts;
        })
        .toEqual({ impressions: 1, clicks: 1, dismissals: 1 });
    } finally {
      await client.end();
    }

    await page.context().clearCookies();
    await page.goto("/login");
    await page
      .getByRole("button", { name: /Admin-Demo|Als Admin testen/ })
      .click();
    await page.waitForURL("**/admin");
    await page.goto("/admin/announcements");
    const insightRow = page.locator("article").filter({ hasText: title });
    await expect(insightRow.getByTitle("Einblendungen")).toHaveText("1");
    await expect(insightRow.getByTitle("Klicks")).toHaveText("1");
    await expect(insightRow.getByTitle("Geschlossen")).toHaveText("1");
    await expect(insightRow).toContainText(/100\s*%\s*Klickrate/);
    await page.screenshot({
      path: testInfo.outputPath("announcement-rule-insights.png"),
      fullPage: true,
    });
  } finally {
    try {
      await restoreTargetMemberProgress(enrollmentSnapshot);
    } finally {
      await cleanupAnnouncement(title);
    }
  }
});
