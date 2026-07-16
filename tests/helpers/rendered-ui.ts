import { expect, type Page } from "@playwright/test";

export async function waitForRenderedUi(page: Page, path: string) {
  const main = page.getByRole("main");
  await expect(main).toBeVisible();
  await expect(main.locator('[aria-busy="true"]')).toHaveCount(0);

  if (/^\/admin\/courses\/[^/?#]+$/.test(path)) {
    await expect(page.getByLabel("Aktive Bearbeiter")).toHaveCount(1);
  }

  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
  });
}
