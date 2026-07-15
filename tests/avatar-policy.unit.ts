import assert from "node:assert/strict";
import test from "node:test";

import type { CourseVersionSnapshot } from "@/db/schema";
import {
  avatarMediaAssetId,
  safeAvatarSource,
  sanitizeCourseSnapshotAvatarSources,
} from "@/lib/avatar-policy";

const mediaAvatar =
  "/api/media-assets/10000000-0000-4000-8000-000000000001/download";

test("avatar sources only allow strict same-origin image paths", () => {
  assert.equal(safeAvatarSource(" /images/avatars/profile.webp "), "/images/avatars/profile.webp");
  assert.equal(safeAvatarSource(mediaAvatar), mediaAvatar);

  for (const source of [
    "https://tracker.example.test/profile.png",
    "http://127.0.0.1:3000/images/avatars/profile.png",
    "//tracker.example.test/profile.png",
    "data:image/png;base64,AAAA",
    "javascript:alert(1)",
    "/images/avatars/profile.svg",
    "/images/../private/profile.png",
    "/images/%2e%2e/private/profile.png",
    "/images/avatars/profile.png?tracking=1",
    `${mediaAvatar}?disposition=inline`,
    "/api/v1/media-assets/10000000-0000-4000-8000-000000000001/download",
    "/api/media-assets/not-a-uuid/download",
    "",
  ]) {
    assert.equal(safeAvatarSource(source), null, source);
  }
  assert.equal(safeAvatarSource(null), null);
  assert.equal(safeAvatarSource("/images/a".repeat(300) + ".png"), null);
});

test("avatar media ids are only extracted from canonical download paths", () => {
  const id = "123e4567-e89b-42d3-a456-426614174000";
  assert.equal(
    avatarMediaAssetId(`/api/media-assets/${id}/download`),
    id,
  );
  assert.equal(avatarMediaAssetId(`/api/media-assets/${id}/download?inline=1`), null);
  assert.equal(avatarMediaAssetId(`https://cdn.test/${id}.png`), null);
});

test("legacy course snapshots redact remote author avatars", () => {
  const snapshot = {
    authors: [
      {
        author: { avatarUrl: "https://tracker.example.test/author.png" },
      },
    ],
    widgets: [
      { author: { avatarUrl: mediaAvatar } },
      { author: null },
    ],
  } as unknown as CourseVersionSnapshot;

  const sanitized = sanitizeCourseSnapshotAvatarSources(snapshot);
  assert.equal(sanitized.authors?.[0]?.author.avatarUrl, null);
  assert.equal(sanitized.widgets?.[0]?.author?.avatarUrl, mediaAvatar);
  assert.equal(sanitized.widgets?.[1]?.author, null);
  assert.equal(snapshot.authors?.[0]?.author.avatarUrl, "https://tracker.example.test/author.png");
});
