import assert from "node:assert/strict";
import { test } from "node:test";

import {
  deleteS3ObjectVersionsPagewise,
  S3VersionCleanupError,
  type S3VersionCleanupCursor,
  type S3VersionCleanupPage,
} from "../src/lib/media/s3-version-cleanup";

const KEY = "tenants/acme/assets/asset-id/ready.pdf";

function page(
  input: Partial<S3VersionCleanupPage> = {},
): S3VersionCleanupPage {
  return {
    isTruncated: false,
    versions: [],
    deleteMarkers: [],
    ...input,
  };
}

test("harddelete processes multiple pages immediately and filters the exact key", async () => {
  const events: string[] = [];
  const cursors: S3VersionCleanupCursor[] = [];
  const pages = [
    page({
      isTruncated: true,
      nextKeyMarker: KEY,
      nextVersionIdMarker: "v3",
      versions: [
        { Key: KEY, VersionId: "v3" },
        { Key: `${KEY}.neighbor`, VersionId: "foreign-v1" },
      ],
    }),
    page({
      isTruncated: true,
      nextKeyMarker: KEY,
      nextVersionIdMarker: "v2",
      deleteMarkers: [{ Key: KEY, VersionId: "marker-v2" }],
    }),
    page({ versions: [{ Key: KEY, VersionId: "v1" }] }),
    page(),
  ];
  const deleted: Array<Array<{ Key: string; VersionId: string }>> = [];
  const result = await deleteS3ObjectVersionsPagewise({
    key: KEY,
    async listPage(cursor) {
      cursors.push(cursor);
      events.push(`list-${cursors.length}`);
      const next = pages.shift();
      assert.ok(next);
      return next;
    },
    async deletePage(targets) {
      deleted.push([...targets]);
      events.push(`delete-${deleted.length}`);
    },
  });

  assert.deepEqual(events, [
    "list-1",
    "delete-1",
    "list-2",
    "delete-2",
    "list-3",
    "delete-3",
    "list-4",
  ]);
  assert.deepEqual(cursors, [
    {},
    { keyMarker: KEY, versionIdMarker: "v3" },
    { keyMarker: KEY, versionIdMarker: "v2" },
    {},
  ]);
  assert.deepEqual(deleted.flat(), [
    { Key: KEY, VersionId: "v3" },
    { Key: KEY, VersionId: "marker-v2" },
    { Key: KEY, VersionId: "v1" },
  ]);
  assert.deepEqual(result, {
    listedPages: 4,
    deletedTargets: 3,
    verificationPasses: 2,
  });
});

test("harddelete rejects a cyclic cursor before deleting the cyclic page", async () => {
  let listed = 0;
  let deleted = 0;
  await assert.rejects(
    deleteS3ObjectVersionsPagewise({
      key: KEY,
      async listPage() {
        listed += 1;
        return page({
          isTruncated: true,
          nextKeyMarker: KEY,
          nextVersionIdMarker: "same-version",
          versions: [{ Key: KEY, VersionId: `v${listed}` }],
        });
      },
      async deletePage() {
        deleted += 1;
      },
    }),
    (error: unknown) => {
      assert.ok(error instanceof S3VersionCleanupError);
      assert.equal(error.code, "cursor_cycle");
      return true;
    },
  );
  assert.equal(listed, 2);
  assert.equal(deleted, 1);
});

test("harddelete enforces the history target limit across pages", async () => {
  let listed = 0;
  const deleted: string[] = [];
  await assert.rejects(
    deleteS3ObjectVersionsPagewise({
      key: KEY,
      maxTargets: 2,
      async listPage() {
        listed += 1;
        return listed === 1
          ? page({
              isTruncated: true,
              nextKeyMarker: KEY,
              nextVersionIdMarker: "v2",
              versions: [
                { Key: KEY, VersionId: "v3" },
                { Key: KEY, VersionId: "v2" },
              ],
            })
          : page({ versions: [{ Key: KEY, VersionId: "v1" }] });
      },
      async deletePage(targets) {
        deleted.push(...targets.map((target) => target.VersionId));
      },
    }),
    (error: unknown) => {
      assert.ok(error instanceof S3VersionCleanupError);
      assert.equal(error.code, "history_limit");
      return true;
    },
  );
  assert.equal(listed, 2);
  assert.deepEqual(deleted, ["v3", "v2"]);
});

test("harddelete enforces its page budget before another provider request", async () => {
  let listed = 0;
  await assert.rejects(
    deleteS3ObjectVersionsPagewise({
      key: KEY,
      maxPages: 1,
      async listPage() {
        listed += 1;
        return page({
          isTruncated: true,
          nextKeyMarker: KEY,
          nextVersionIdMarker: "next",
        });
      },
      async deletePage() {
        throw new Error("no targets should be deleted");
      },
    }),
    (error: unknown) => {
      assert.ok(error instanceof S3VersionCleanupError);
      assert.equal(error.code, "history_limit");
      return true;
    },
  );
  assert.equal(listed, 1);
});
