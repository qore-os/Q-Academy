import assert from "node:assert/strict";
import test from "node:test";

import {
  communityProfileValueBatches,
  communityPublicAvatarSource,
  sanitizeCommunityPublicProfileValue,
} from "../src/lib/community-public-profile-policy";
import {
  communityCommentApiDto,
  communityPostApiDto,
} from "../src/lib/community-api-dto";

test("profile impact values are split at the fixed parameter boundary", () => {
  const values = Array.from({ length: 1_001 }, (_, index) => index);
  const batches = communityProfileValueBatches(values);
  assert.deepEqual(batches.map((batch) => batch.length), [500, 500, 1]);
  assert.deepEqual(batches.flat(), values);
  assert.throws(() => communityProfileValueBatches(values, 0), RangeError);
});

test("public custom profile values remove controls and stay within 1000 code points", () => {
  const value = `a\u0000\n${"😀".repeat(1_100)}\u007f`;
  const sanitized = sanitizeCommunityPublicProfileValue(value);
  assert.equal(Array.from(sanitized).length, 1_000);
  assert.doesNotMatch(sanitized, /[\u0000-\u001f\u007f-\u009f]/u);
  assert.equal(Array.from(sanitized).at(-1), "😀");
});

test("public avatar projection selects the matching authentication surface", () => {
  const id = "123e4567-e89b-42d3-a456-426614174000";
  const sessionPath = `/api/media-assets/${id}/download`;
  assert.equal(communityPublicAvatarSource(sessionPath), sessionPath);
  assert.equal(
    communityPublicAvatarSource(sessionPath, "api"),
    `/api/v1/media-assets/${id}/download`,
  );
  assert.equal(
    communityPublicAvatarSource("https://tracker.example/avatar.png", "api"),
    null,
  );
});

test("community content API mappers exclude tenant and moderation internals", () => {
  const now = new Date("2026-01-01T00:00:00.000Z");
  const post = communityPostApiDto({
    id: "post",
    spaceId: "space",
    authorId: "author",
    title: null,
    content: "content",
    contentFormat: "plain_text",
    richText: null,
    contentProjectionVersion: 1,
    imageUrl: null,
    pinned: false,
    locked: false,
    moderationState: "published",
    moderationVersion: 1,
    publishedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  const comment = communityCommentApiDto({
    id: "comment",
    postId: "post",
    authorId: "author",
    parentId: null,
    content: "content",
    contentFormat: "plain_text",
    richText: null,
    contentProjectionVersion: 1,
    moderationState: "published",
    moderationVersion: 1,
    publishedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  for (const dto of [post, comment]) {
    assert.equal("organizationId" in dto, false);
    assert.equal("moderationFingerprint" in dto, false);
    assert.equal("moderatedById" in dto, false);
  }
});
