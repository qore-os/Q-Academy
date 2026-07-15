import { expect, type Page } from "@playwright/test";
import { getSettingsAdminCopy } from "../../src/lib/i18n/settings-admin";

const welcomeCloseLabels = (["de", "en", "it", "es", "fr"] as const)
  .map((locale) => getSettingsAdminCopy(locale).welcome.modalClose)
  .map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
const welcomeClosePattern = new RegExp(`^(?:${welcomeCloseLabels.join("|")})$`);

export async function completeMemberWelcomeIfVisible(page: Page) {
  const finish = page.getByRole("button", {
    name: welcomeClosePattern,
  });
  if (!(await finish.isVisible())) {
    await finish
      .waitFor({ state: "visible", timeout: 3_000 })
      .catch(() => undefined);
    if (!(await finish.isVisible())) return;
  }

  await finish.click();
  await expect(finish).toBeHidden();
}
