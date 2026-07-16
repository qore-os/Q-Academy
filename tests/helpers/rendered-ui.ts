import { expect, type Page } from "@playwright/test";

export async function waitForRenderedUi(page: Page, path: string) {
  const main = page.getByRole("main");
  await expect(main).toBeVisible();
  await expect(main.locator('[aria-busy="true"]')).toHaveCount(0);

  if (
    path === "/admin/api" ||
    /^\/admin\/courses\/[^/?#]+$/.test(path)
  ) {
    await expect(main.getByRole("tab", { selected: true })).toBeEnabled();
  }

  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
  });
}
