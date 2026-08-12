import assert from "node:assert/strict";

const [operation, organizationId, userId, assetId] = process.argv.slice(2);
assert.ok(operation === "complete" || operation === "privacy");
assert.ok(organizationId && userId && assetId);

const { db, postgresClient } = await import("@/db");
const { and, eq } = await import("drizzle-orm");
const { mediaAssets, users } = await import("@/db/schema");

try {
  if (operation === "complete") {
    const { completeSessionMediaAsset } = await import(
      "@/lib/media/session-service"
    );
    const [user] = await db
      .select()
      .from(users)
      .where(
        and(
          eq(users.id, userId),
          eq(users.organizationId, organizationId),
        ),
      )
      .limit(1);
    assert.ok(user);
    const completed = await completeSessionMediaAsset(user, assetId);
    assert.equal(completed.id, assetId);
    assert.equal(completed.status, "uploaded");
  } else {
    const { applyMemberErasure } = await import(
      "@/lib/privacy/erasure-executor"
    );
    const [asset] = await db
      .select()
      .from(mediaAssets)
      .where(
        and(
          eq(mediaAssets.id, assetId),
          eq(mediaAssets.organizationId, organizationId),
        ),
      )
      .limit(1);
    assert.ok(asset);
    await db.transaction((tx) =>
      applyMemberErasure({
        tx,
        organizationId,
        subjectUserId: userId,
        subjectReference: "c".repeat(64),
        mediaPlan: {
          purge: [
            {
              id: asset.id,
              organizationId: asset.organizationId,
              purpose: asset.purpose,
              storageDriver: asset.storageDriver,
              storageKey: asset.storageKey,
              stagingStorageKey: asset.stagingStorageKey,
              subjectAttachment: false,
              boundToOtherSubject: false,
              courseBinding: false,
              derivativeStorageKeys: [],
            },
          ],
          retainShared: [],
        },
        now: new Date(),
      }),
    );
  }
} finally {
  await postgresClient.end();
}
