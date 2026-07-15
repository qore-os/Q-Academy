import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";

import { getCommunityAdminCopy } from "../src/lib/i18n/community-admin";
import { ensureCommunityAreaFixture } from "./helpers/community-area";

const adminCopy = getCommunityAdminCopy("de");

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";

async function loginAsOwner(page: Page) {
  await page.goto("/login");
  await page
    .getByRole("button", { name: /Admin-Demo|Als Admin testen/ })
    .click();
  await page.waitForURL("**/admin");
}

test("admin persists versioned moderation policy controls", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium",
    "governance mutation runs once on desktop",
  );

  const client = postgres(databaseUrl, { prepare: false });
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  let spaceId = "";
  try {
    const [owner] = await client<{ organization_id: string }[]>`
      select organization_id
      from users
      where email = 'admin@q-academy.de'
      limit 1
    `;
    const area = await ensureCommunityAreaFixture(
      client,
      owner.organization_id,
    );
    const [space] = await client<{ id: string }[]>`
      insert into community_spaces (
        organization_id, area_id, title, slug, description, color, type,
        sort_order
      ) values (
        ${owner.organization_id}, ${area.id}, ${`Governance ${suffix}`},
        ${`governance-${suffix}`}, 'Isolierter Governance-Test', '#2b9188',
        'feed', ${area.nextSpaceSortOrder}
      )
      returning id
    `;
    spaceId = space.id;

    await loginAsOwner(page);
    await page.goto("/admin/community");
    await expect(
      page.getByRole("heading", {
        name: adminCopy.governance.moderationHeading,
      }),
    ).toBeVisible();

    const spaceSelector = page.getByLabel(adminCopy.governance.spaceAria, {
      exact: true,
    });
    await spaceSelector.selectOption(spaceId);
    const governance = page.getByRole("region", {
      name: adminCopy.governance.moderationHeading,
    });
    await governance
      .locator('select[name="postApproval"]')
      .selectOption("members");
    await governance
      .locator('select[name="commentApproval"]')
      .selectOption("non_admins");
    await governance
      .locator('select[name="automationMode"]')
      .selectOption("enforce");
    await governance.locator('input[name="reportThreshold"]').fill("3");
    await governance.locator('input[name="duplicateWindowMinutes"]').fill("60");
    await governance.locator('input[name="linkLimit"]').fill("2");
    await governance
      .getByRole("button", { name: adminCopy.governance.saveRules })
      .click();
    await expect(
      governance
        .getByRole("status")
        .filter({ hasText: adminCopy.actions.moderationPolicySaved }),
    ).toBeVisible();

    const [stored] = await client<
      {
        post_approval: string;
        comment_approval: string;
        automation_mode: string;
        report_threshold: number;
        duplicate_window_minutes: number;
        link_limit: number;
        version: number;
      }[]
    >`
      select post_approval, comment_approval, automation_mode,
             report_threshold, duplicate_window_minutes, link_limit, version
      from community_space_moderation_policies
      where organization_id = ${owner.organization_id}
        and space_id = ${spaceId}
    `;
    expect(stored).toMatchObject({
      post_approval: "members",
      comment_approval: "non_admins",
      automation_mode: "enforce",
      report_threshold: 3,
      duplicate_window_minutes: 60,
      link_limit: 2,
      version: 2,
    });
  } finally {
    if (spaceId) {
      await client`delete from community_spaces where id = ${spaceId}`;
    }
    await client.end();
  }
});

test("community governance controls stay within the mobile viewport", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "mobile",
    "mobile governance layout audit",
  );

  await loginAsOwner(page);
  await page.goto("/admin/community");
  await expect(
    page.getByRole("heading", {
      name: adminCopy.governance.moderationHeading,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: adminCopy.governance.levelHeading }),
  ).toBeVisible();
  const layout = await page.evaluate(() => {
    const viewportWidth = document.documentElement.clientWidth;
    return {
      overflow: document.documentElement.scrollWidth - viewportWidth,
      offenders: [...document.querySelectorAll<HTMLElement>("body *")]
        .map((element) => ({
          tag: element.tagName,
          className: element.className,
          right: Math.round(element.getBoundingClientRect().right),
          width: Math.round(element.getBoundingClientRect().width),
        }))
        .filter((element) => element.right > viewportWidth + 1)
        .slice(0, 8),
    };
  });
  expect(layout.overflow, JSON.stringify(layout.offenders)).toBeLessThanOrEqual(
    1,
  );
});
