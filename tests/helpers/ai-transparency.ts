import type { Page } from "@playwright/test";

export async function acknowledgeAiTransparency(page: Page) {
  const result = await page.evaluate(async () => {
    const current = await fetch("/api/ai/transparency", {
      cache: "no-store",
    });
    const currentBody: unknown = await current.json().catch(() => null);
    const state =
      currentBody && typeof currentBody === "object" && "data" in currentBody
        ? (currentBody.data as Record<string, unknown>)
        : null;
    if (!current.ok || !state) {
      return { status: current.status, acknowledged: false };
    }
    if (state.required === false) {
      return { status: current.status, acknowledged: true };
    }
    const notice =
      state.notice && typeof state.notice === "object"
        ? (state.notice as Record<string, unknown>)
        : null;
    if (!notice || typeof notice.digest !== "string") {
      return { status: 500, acknowledged: false };
    }
    const response = await fetch("/api/ai/transparency", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ noticeDigest: notice.digest }),
    });
    return { status: response.status, acknowledged: response.ok };
  });
  if (!result.acknowledged) {
    throw new Error(
      `AI transparency acknowledgement failed with HTTP ${result.status}.`,
    );
  }
}
