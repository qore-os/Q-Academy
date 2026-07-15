import assert from "node:assert/strict";
import test from "node:test";

import { openApiDocument } from "../src/lib/api/openapi";

type Schema = {
  additionalProperties?: boolean;
  required?: readonly string[];
  properties?: Record<string, unknown>;
};

function operation(path: string, method: "get" | "put" | "delete") {
  const value = openApiDocument.paths[path]?.[method];
  assert.ok(value, `${method.toUpperCase()} ${path} is not documented.`);
  return value;
}

function schema(name: string) {
  const value = openApiDocument.components.schemas[name] as Schema | undefined;
  assert.ok(value, `${name} schema is not documented.`);
  return value;
}

test("personal-feed OpenAPI DTOs expose the exact bounded public shape", () => {
  const page = schema("CommunityFeedPage");
  assert.equal(page.additionalProperties, false);
  assert.deepEqual(page.required, [
    "mode",
    "asOf",
    "items",
    "nextCursor",
    "hasMore",
  ]);
  assert.deepEqual(
    (page.properties?.mode as { enum: readonly string[] }).enum,
    ["for_you", "following", "latest"],
  );
  assert.equal((page.properties?.items as { maxItems: number }).maxItems, 50);

  const post = schema("CommunityFeedPost");
  assert.equal(post.additionalProperties, false);
  assert.deepEqual(post.required, [
    "id",
    "title",
    "content",
    "contentFormat",
    "richText",
    "contentProjectionVersion",
    "imageUrl",
    "pinned",
    "locked",
    "courseLink",
    "createdAt",
    "updatedAt",
    "authorId",
    "firstName",
    "lastName",
    "authorAvatarUrl",
    "badges",
    "jobTitle",
    "points",
    "spaceId",
    "spaceTitle",
    "spaceColor",
    "spaceType",
    "likeCount",
    "likeReactionCount",
    "celebrateReactionCount",
    "insightfulReactionCount",
    "questionReactionCount",
    "commentCount",
    "myReaction",
    "voteScore",
    "myVote",
    "reported",
    "reasonCodes",
    "isFollowingAuthor",
    "isFollowingSpace",
    "attachments",
    "comments",
  ]);
  assert.deepEqual(
    (
      post.properties?.reasonCodes as {
        maxItems: number;
        uniqueItems: boolean;
        items: { enum: readonly string[] };
      }
    ).items.enum,
    [
      "pinned",
      "followed_author",
      "followed_space",
      "boosted",
      "trending",
      "recent",
    ],
  );
  assert.equal(
    (post.properties?.reasonCodes as { maxItems: number }).maxItems,
    3,
  );
  assert.equal((post.properties?.comments as { maxItems: number }).maxItems, 3);
  assert.equal(Object.hasOwn(post.properties ?? {}, "score"), false);
  assert.equal(Object.hasOwn(post.properties ?? {}, "rank"), false);
  assert.equal(Object.hasOwn(post.properties ?? {}, "boostStrength"), false);

  const comment = schema("CommunityFeedComment");
  assert.equal(comment.additionalProperties, false);
  assert.deepEqual(comment.required, [
    "id",
    "authorId",
    "parentId",
    "content",
    "contentFormat",
    "richText",
    "contentProjectionVersion",
    "createdAt",
    "updatedAt",
    "firstName",
    "lastName",
    "authorAvatarUrl",
    "badges",
    "reported",
    "replyCount",
    "reactionCount",
    "likeReactionCount",
    "celebrateReactionCount",
    "insightfulReactionCount",
    "questionReactionCount",
    "myReaction",
    "attachments",
    "replies",
  ]);
  assert.equal(
    (comment.properties?.replies as { maxItems: number }).maxItems,
    2,
  );
  assert.equal(
    (comment.properties?.attachments as { maxItems: number }).maxItems,
    3,
  );
});

test("follow and boost OpenAPI operations match pagination and replay contracts", () => {
  const follow = schema("CommunityFollow");
  assert.equal(follow.additionalProperties, false);
  assert.deepEqual(follow.required, [
    "id",
    "targetType",
    "targetId",
    "notify",
    "createdAt",
    "updatedAt",
    "targetLabel",
    "targetAvatarUrl",
  ]);
  const boost = schema("CommunityAuthorBoost");
  assert.equal(boost.additionalProperties, false);
  assert.deepEqual(boost.required, [
    "id",
    "authorId",
    "authorName",
    "strength",
    "startsAt",
    "endsAt",
    "reason",
    "createdAt",
    "updatedAt",
  ]);

  const feedList = operation("/community/feed", "get");
  assert.match(JSON.stringify(feedList.responses["200"]), /CommunityFeedPage/);

  for (const [path, responseSchema] of [
    ["/community/follows", "CommunityFollow"],
    ["/admin/community/boosts", "CommunityAuthorBoost"],
  ] as const) {
    const list = operation(path, "get");
    const response = JSON.stringify(list.responses["200"]);
    assert.match(response, new RegExp(responseSchema));
    assert.match(response, /PaginationMeta/);
  }

  for (const path of [
    "/community/follows/{targetType}/{targetId}",
    "/admin/community/boosts/{authorId}",
  ]) {
    for (const method of ["put", "delete"] as const) {
      const mutation = operation(path, method);
      assert.match(JSON.stringify(mutation.parameters), /IdempotencyKey/);
    }
  }
});
