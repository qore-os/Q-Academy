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

  const currentUrl = new URL(page.url());
  const [refreshRequest] = await Promise.all([
    page.waitForRequest((request) => {
      const url = new URL(request.url());
      return (
        request.method() === "GET" &&
        request.headers().rsc === "1" &&
        url.origin === currentUrl.origin &&
        url.pathname === currentUrl.pathname &&
        url.searchParams.has("_rsc")
      );
    }, { timeout: 20_000 }),
    finish.click(),
  ]);

  const refreshResponse = await refreshRequest.response();
  expect(refreshResponse, "welcome refresh did not receive a response").not.toBeNull();
  expect(refreshResponse!.ok(), "welcome refresh failed").toBe(true);
  expect(
    await refreshResponse!.finished(),
    "welcome refresh was interrupted",
  ).toBeNull();
  await expect(finish).toBeHidden();
}
