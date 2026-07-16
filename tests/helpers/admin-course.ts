import { expect, type Page } from "@playwright/test";

export async function resolveEditableCoursePath(page: Page) {
  const response = await page.goto("/admin/courses", {
    waitUntil: "domcontentloaded",
  });
  expect(response?.status(), "the admin course list did not render successfully").toBeLessThan(
    400,
  );
  await expect(page.getByRole("main")).toBeVisible();

  const path = await page.locator('main a[href^="/admin/courses/"]').evaluateAll(
    (links) =>
      links
        .map((link) => new URL(link.getAttribute("href") ?? "", window.location.origin).pathname)
        .find((href) => /^\/admin\/courses\/[0-9a-f-]{36}$/i.test(href)) ?? null,
  );

  expect(path, "the seeded tenant exposes no editable course").not.toBeNull();
  return path!;
}
