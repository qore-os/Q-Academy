import { expect, test } from "@playwright/test";

import { testEnvironmentValue } from "./helpers/test-environment";

function workerAuthorization() {
  const secret = testEnvironmentValue("CRON_SECRET");
  if (!secret) throw new Error("CRON_SECRET is required by this test.");
  return { Authorization: `Bearer ${secret}` };
}

test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Job metrics run once.");
});

test("job dispatch exposes only aggregate queue health metrics", async ({
  request,
}) => {
  const response = await request.post(
    "/api/internal/jobs/dispatch?cleanup=dry-run&cleanupLimit=1",
    { headers: workerAuthorization() },
  );
  expect(response.status()).toBe(200);

  const body = (await response.json()) as {
    data: {
      queues: Record<
        string,
        { depth: number; failed: number; oldestAgeSeconds: number }
      >;
    };
  };
  expect(Object.keys(body.data.queues).sort()).toEqual([
    "email",
    "examDeadlines",
    "nativePush",
    "push",
    "webhooks",
  ]);
  for (const queue of Object.values(body.data.queues)) {
    expect(Object.keys(queue).sort()).toEqual([
      "depth",
      "failed",
      "oldestAgeSeconds",
    ]);
    expect(Number.isInteger(queue.depth)).toBe(true);
    expect(Number.isInteger(queue.failed)).toBe(true);
    expect(Number.isInteger(queue.oldestAgeSeconds)).toBe(true);
    expect(queue.depth).toBeGreaterThanOrEqual(0);
    expect(queue.failed).toBeGreaterThanOrEqual(0);
    expect(queue.oldestAgeSeconds).toBeGreaterThanOrEqual(0);
  }
});
