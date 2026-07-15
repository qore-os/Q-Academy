import assert from "node:assert/strict";
import test from "node:test";

import {
  canCreateCommunityPost,
  canReplyToCommunityPost,
  communitySpaceRequiresTitle,
  extractMentionHandles,
  mentionHandleForEmail,
} from "../src/lib/community-domain";
import {
  commentCreateSchema,
  communitySpaceAccessPolicySchema,
  communitySpaceCreateSchema,
  postReactionSchema,
  postVoteSchema,
} from "../src/lib/api/schemas";

test("mention parsing normalizes, deduplicates and bounds safe handles", () => {
  assert.deepEqual(
    extractMentionHandles(
      "Hallo @Lea und (@jonas.s) sowie erneut @lea. Ignoriere test@invalid.",
    ),
    ["lea", "jonas.s"],
  );
  assert.deepEqual(extractMentionHandles("@a @b @c", 2), ["a", "b"]);
  assert.equal(mentionHandleForEmail("Lea@q-academy.de"), "lea");
  assert.equal(mentionHandleForEmail("invalid address@example.test"), null);
  assert.equal(mentionHandleForEmail("missing-at"), null);
});

test("community rich-media and access schemas enforce bounded attachments and useful rules", () => {
  const memberId = "10000000-0000-4000-8000-000000000001";
  assert.equal(
    commentCreateSchema.parse({
      authorId: memberId,
      content: "Mit Anhang",
      attachmentIds: ["20000000-0000-4000-8000-000000000002"],
    }).attachmentIds.length,
    1,
  );
  assert.equal(
    commentCreateSchema.safeParse({
      authorId: memberId,
      content: "Zu viele Anhaenge",
      attachmentIds: [
        "20000000-0000-4000-8000-000000000001",
        "20000000-0000-4000-8000-000000000002",
        "20000000-0000-4000-8000-000000000003",
        "20000000-0000-4000-8000-000000000004",
      ],
    }).success,
    false,
  );
  assert.equal(
    communitySpaceAccessPolicySchema.safeParse({
      accessMode: "restricted",
      rules: [
        {
          subjectType: "role",
          subjectRole: "member",
          canView: false,
          canPost: true,
          canComment: false,
        },
      ],
    }).success,
    false,
  );
  assert.equal(
    communitySpaceAccessPolicySchema.safeParse({
      accessMode: "restricted",
      rules: [
        {
          subjectType: "user",
          subjectUserId: memberId,
          canView: true,
          canPost: false,
          canComment: true,
        },
      ],
    }).success,
    true,
  );
});

test("forum policy restricts announcements and reply locks", () => {
  assert.equal(canCreateCommunityPost("member", "announcement"), false);
  assert.equal(canCreateCommunityPost("trainer", "announcement"), false);
  assert.equal(canCreateCommunityPost("admin", "announcement"), true);
  assert.equal(canCreateCommunityPost("owner", "announcement"), true);
  assert.equal(canCreateCommunityPost("member", "discussion"), true);
  assert.equal(communitySpaceRequiresTitle("feed"), false);
  assert.equal(communitySpaceRequiresTitle("discussion"), true);
  assert.equal(communitySpaceRequiresTitle("announcement"), true);
  assert.equal(
    canReplyToCommunityPost({ type: "discussion", locked: false }),
    true,
  );
  assert.equal(
    canReplyToCommunityPost({ type: "discussion", locked: true }),
    false,
  );
  assert.equal(
    canReplyToCommunityPost({ type: "announcement", locked: false }),
    false,
  );
});

test("community API schemas accept typed inputs and reject invalid votes", () => {
  assert.equal(
    communitySpaceCreateSchema.parse({
      title: "Fragen",
      type: "discussion",
    }).type,
    "discussion",
  );
  assert.equal(
    postReactionSchema.parse({
      userId: "10000000-0000-4000-8000-000000000001",
      reaction: "insightful",
    }).reaction,
    "insightful",
  );
  assert.equal(
    commentCreateSchema.parse({
      authorId: "10000000-0000-4000-8000-000000000001",
      parentId: "20000000-0000-4000-8000-000000000002",
      content: "Thread-Antwort",
    }).parentId,
    "20000000-0000-4000-8000-000000000002",
  );
  assert.equal(
    postVoteSchema.safeParse({
      userId: "10000000-0000-4000-8000-000000000001",
      value: 2,
    }).success,
    false,
  );
});
