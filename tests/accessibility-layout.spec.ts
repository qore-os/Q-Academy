import { expect, test, type Page } from "@playwright/test";

import { completeMemberWelcomeIfVisible } from "./helpers/member-welcome";
import { waitForRenderedUi } from "./helpers/rendered-ui";

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

async function assertKeyboardAndReflow(page: Page, path: string) {
  const response = await page.goto(path, { waitUntil: "domcontentloaded" });
  expect(response?.status(), `${path} did not render successfully`).toBeLessThan(400);
  await waitForRenderedUi(page, path);

  const layout = await page.evaluate(() => ({
    viewportOverflow:
      document.body.scrollWidth - document.documentElement.clientWidth,
    inaccessibleScrollRegions: [...document.querySelectorAll<HTMLElement>("*")]
      .filter((element) => {
        const overflow = getComputedStyle(element).overflowX;
        return (
          (overflow === "auto" || overflow === "scroll") &&
          element.scrollWidth > element.clientWidth + 1
        );
      })
      .filter((element) => {
        if (element.tabIndex >= 0) return false;
        return !element.querySelector(
          "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])",
        );
      })
      .map((element) => element.getAttribute("aria-label") ?? element.className),
    overflowingElements: [...document.querySelectorAll<HTMLElement>("body *")]
      .map((element) => ({ element, rect: element.getBoundingClientRect() }))
      .filter(
        ({ rect }) =>
          rect.width > 0 &&
          (rect.right > document.documentElement.clientWidth + 1 || rect.left < -1),
      )
      .slice(0, 10)
      .map(({ element, rect }) => ({
        tag: element.tagName,
        className: String(element.className).slice(0, 180),
        left: Math.round(rect.left),
        right: Math.round(rect.right),
        width: Math.round(rect.width),
      })),
    widestElementAncestors: (() => {
      const widest = [...document.querySelectorAll<HTMLElement>("body *")]
        .map((element) => ({ element, rect: element.getBoundingClientRect() }))
        .sort((left, right) => right.rect.right - left.rect.right)[0]?.element;
      const ancestors: Array<{
        tag: string;
        className: string;
        clientWidth: number;
        scrollWidth: number;
        overflowX: string;
      }> = [];
      for (
        let element: HTMLElement | null = widest ?? null;
        element;
        element = element.parentElement
      ) {
        ancestors.push({
          tag: element.tagName,
          className: String(element.className).slice(0, 160),
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth,
          overflowX: getComputedStyle(element).overflowX,
        });
      }
      return ancestors;
    })(),
  }));
  expect(
    layout.viewportOverflow,
    `${path} body overflows at 400% zoom: ${JSON.stringify({ elements: layout.overflowingElements, ancestors: layout.widestElementAncestors })}`,
  ).toBeLessThanOrEqual(1);
  expect(
    layout.inaccessibleScrollRegions,
    `${path} contains keyboard-inaccessible scroll regions`,
  ).toEqual([]);

  const focusTrail: string[] = [];
  for (let index = 0; index < 6; index += 1) {
    await page.keyboard.press("Tab");
    const focus = await page.evaluate(() => {
      const active = document.activeElement as HTMLElement | null;
      return {
        signature: [
          active?.tagName ?? "",
          active?.getAttribute("aria-label") ?? "",
          active?.textContent?.trim().slice(0, 40) ?? "",
        ].join(":"),
        tagName: active?.tagName ?? null,
        visible: Boolean(active && active.getClientRects().length),
      };
    });
    expect(focus.tagName, `${path} did not expose a keyboard focus target`).not.toBe(
      "BODY",
    );
    expect(focus.visible, `${path} focused an invisible target`).toBe(true);
    focusTrail.push(focus.signature);
  }
  expect(
    new Set(focusTrail).size,
    `${path} did not expose a meaningful keyboard focus sequence`,
  ).toBeGreaterThan(1);
}

test("admin workflows reflow and remain keyboard accessible at 400% zoom", async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  if (testInfo.project.name !== "mobile") {
    await page.setViewportSize({ width: 360, height: 900 });
  }
  await loginAsAdmin(page);
  for (const path of [
    "/admin",
    "/admin/modules",
    "/admin/members",
    "/admin/groups",
    "/admin/bundles",
    "/admin/announcements",
    "/admin/ai",
    "/admin/api",
    "/admin/settings",
    "/admin/courses/48daf731-79fa-4c76-85c2-b4e6324bfeb4",
  ]) {
    await assertKeyboardAndReflow(page, path);
  }
});

test("learner workflows reflow and remain keyboard accessible at 400% zoom", async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  if (testInfo.project.name !== "mobile") {
    await page.setViewportSize({ width: 360, height: 900 });
  }
  await loginAsMember(page);
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
    await assertKeyboardAndReflow(page, path);
  }
});
