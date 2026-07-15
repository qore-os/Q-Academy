import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";
import postgres from "postgres";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";
const apiKey =
  process.env.DEMO_API_KEY ?? "qak_demo_qacademy_2026_local_development";

test("course API rejects covers that cannot be rendered by the local image policy", async ({
  request,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "API security flow runs once.");
  const client = postgres(databaseUrl, { prepare: false });
  const suffix = randomUUID().slice(0, 8);
  const idempotencyPrefix = `course-cover-${suffix}`;
  const slug = `course-cover-${suffix}`;
  const requestIds: string[] = [];
  const invalidSources = [
    "https://example.test/cover.webp",
    "https://user:secret@example.test/cover.webp",
    "//example.test/cover.webp",
    "/images/../private.png",
    "/api/media-assets/10000000-0000-4000-8000-000000000001/download?inline=1",
  ];

  try {
    for (const [index, coverImage] of invalidSources.entries()) {
      const response = await request.post("/api/v1/courses", {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Idempotency-Key": `${idempotencyPrefix}-${index}`,
        },
        data: {
          title: `Cover Policy ${suffix} ${index}`,
          slug: `${slug}-${index}`,
          shortDescription: "Die Cover-Policy blockiert unsichere Bildquellen.",
          description:
            "Dieser API-Test stellt sicher, dass keine fremde Quelle gespeichert wird.",
          coverImage,
          status: "draft",
          difficulty: "Grundlagen",
          estimatedMinutes: 30,
          certificateEnabled: true,
          featured: false,
          visibleInCatalog: true,
          showProgressPercentage: true,
          learningGoals: [],
          authorIds: [],
        },
      });
      requestIds.push(response.headers()["x-request-id"]);
      expect(response.status(), coverImage).toBe(422);
      await expect(response.json()).resolves.toMatchObject({
        code: "validation_error",
        errors: [{ path: "coverImage" }],
      });
    }

    const [result] = await client<Array<{ count: number }>>`
      select count(*)::int as count
      from courses
      where slug like ${`${slug}%`}
    `;
    expect(result.count).toBe(0);
  } finally {
    if (requestIds.length) {
      await client`
        delete from api_audit_logs
        where request_id = any(${requestIds}::uuid[])
      `;
    }
    await client`
      delete from api_idempotency_keys
      where key like ${`${idempotencyPrefix}%`}
    `;
    await client.end();
  }
});
