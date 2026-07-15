import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";
import postgres from "postgres";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";
const apiKey =
  process.env.DEMO_API_KEY ?? "qak_demo_qacademy_2026_local_development";

test("content block revisions reject stale updates and deletes", async ({
  request,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium",
    "one serial API concurrency proof is sufficient",
  );
  const client = postgres(databaseUrl, { prepare: false });
  const suffix = randomUUID().slice(0, 8);
  const prefix = `block-revision-${suffix}`;
  const requestIds: string[] = [];
  let blockId = "";

  const headers = (key: string, revision?: number) => ({
    Authorization: `Bearer ${apiKey}`,
    "Idempotency-Key": `${prefix}-${key}`,
    ...(revision ? { "If-Match": `"${revision}"` } : {}),
  });

  try {
    const [fixture] = await client<
      Array<{ organization_id: string; lesson_id: string }>
    >`
      select c.organization_id, l.id as lesson_id
      from courses c
      join course_modules cm on cm.course_id = c.id
      join modules m on m.id = cm.module_id and m.kind = 'learning'
      join lessons l on l.module_id = m.id
      where c.slug = 'ki-grundlagen'
      order by cm.sort_order, l.sort_order
      limit 1
    `;
    expect(fixture).toBeTruthy();
    const [created] = await client<Array<{ id: string }>>`
      insert into content_blocks (
        lesson_id, type, title, sort_order, required, data
      ) values (
        ${fixture.lesson_id}, 'text', ${`Revisionstest ${suffix}`}, 90000,
        false, ${client.json({ text: "Ausgangsversion" })}
      )
      returning id
    `;
    blockId = created.id;

    const initial = await request.get(`/api/v1/blocks/${blockId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    requestIds.push(initial.headers()["x-request-id"]);
    expect(initial.status()).toBe(200);
    expect(await initial.json()).toMatchObject({
      data: { id: blockId, revision: 1, title: `Revisionstest ${suffix}` },
    });

    const firstUpdate = await request.patch(`/api/v1/blocks/${blockId}`, {
      headers: headers("first-update"),
      data: {
        revision: 1,
        title: `Erste Aenderung ${suffix}`,
        data: { text: "Diese Fassung muss erhalten bleiben." },
      },
    });
    requestIds.push(firstUpdate.headers()["x-request-id"]);
    expect(firstUpdate.status()).toBe(200);
    expect(await firstUpdate.json()).toMatchObject({
      data: { revision: 2, title: `Erste Aenderung ${suffix}` },
    });

    const staleUpdate = await request.patch(`/api/v1/blocks/${blockId}`, {
      headers: headers("stale-update"),
      data: {
        revision: 1,
        title: `Veraltete Aenderung ${suffix}`,
      },
    });
    requestIds.push(staleUpdate.headers()["x-request-id"]);
    expect(staleUpdate.status()).toBe(409);
    expect(await staleUpdate.json()).toMatchObject({ code: "conflict" });

    const afterConflict = await request.get(`/api/v1/blocks/${blockId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    requestIds.push(afterConflict.headers()["x-request-id"]);
    expect(await afterConflict.json()).toMatchObject({
      data: {
        revision: 2,
        title: `Erste Aenderung ${suffix}`,
        data: { text: "Diese Fassung muss erhalten bleiben." },
      },
    });

    const missingPrecondition = await request.delete(
      `/api/v1/blocks/${blockId}`,
      { headers: headers("missing-precondition") },
    );
    requestIds.push(missingPrecondition.headers()["x-request-id"]);
    expect(missingPrecondition.status()).toBe(400);

    const staleDelete = await request.delete(`/api/v1/blocks/${blockId}`, {
      headers: headers("stale-delete", 1),
    });
    requestIds.push(staleDelete.headers()["x-request-id"]);
    expect(staleDelete.status()).toBe(409);

    const currentDelete = await request.delete(`/api/v1/blocks/${blockId}`, {
      headers: headers("current-delete", 2),
    });
    requestIds.push(currentDelete.headers()["x-request-id"]);
    expect(currentDelete.status()).toBe(200);
    blockId = "";
  } finally {
    if (blockId) {
      await client`delete from content_blocks where id = ${blockId}`.catch(
        () => undefined,
      );
    }
    await client`
      delete from api_idempotency_keys
      where key like ${`${prefix}%`}
    `.catch(() => undefined);
    const ids = requestIds.filter(Boolean);
    if (ids.length) {
      await client`
        delete from api_audit_logs where request_id = any(${ids}::uuid[])
      `.catch(() => undefined);
    }
    await client.end({ timeout: 5 }).catch(() => undefined);
  }
});
