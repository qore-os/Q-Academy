import assert from "node:assert/strict";
import test from "node:test";

import { and, asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "../src/db/schema";
import {
  commentReactions,
  comments,
  communityAreas,
  communityScoreContributions,
  communitySpaces,
  organizations,
  postLikes,
  posts,
  users,
} from "../src/db/schema";
import {
  removeCommunityScoreContributionsForComment,
  removeCommunityScoreContributionsForPost,
  restoreCommunityScoreContributionsForComment,
  restoreCommunityScoreContributionsForPost,
} from "../src/lib/community-score-core";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";
const client = postgres(databaseUrl, { max: 6, prepare: false });
const database = drizzle(client, { schema });

async function scoreState(organizationId: string) {
  const [scores, contributions] = await Promise.all([
    database
      .select({
        id: users.id,
        communityPoints: users.communityPoints,
      })
      .from(users)
      .where(eq(users.organizationId, organizationId))
      .orderBy(asc(users.id)),
    database
      .select({
        kind: communityScoreContributions.kind,
        recipientId: communityScoreContributions.recipientId,
        actorId: communityScoreContributions.actorId,
      })
      .from(communityScoreContributions)
      .where(eq(communityScoreContributions.organizationId, organizationId))
      .orderBy(
        asc(communityScoreContributions.kind),
        asc(communityScoreContributions.recipientId),
        asc(communityScoreContributions.actorId),
      ),
  ]);
  return { scores, contributions };
}

test("community score remove and restore stays symmetric, idempotent and visibility-safe", async () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  let organizationId = "";
  try {
    const [organization] = await database
      .insert(organizations)
      .values({
        name: `Score restore ${suffix}`,
        slug: `score-restore-${suffix}`,
      })
      .returning({ id: organizations.id });
    organizationId = organization.id;
    const createdUsers = await database
      .insert(users)
      .values([
        {
          organizationId,
          email: `author-${suffix}@example.test`,
          passwordHash: "not-a-login-hash",
          firstName: "Post",
          lastName: "Author",
        },
        {
          organizationId,
          email: `commenter-${suffix}@example.test`,
          passwordHash: "not-a-login-hash",
          firstName: "Top",
          lastName: "Commenter",
        },
        {
          organizationId,
          email: `replier-${suffix}@example.test`,
          passwordHash: "not-a-login-hash",
          firstName: "Thread",
          lastName: "Replier",
        },
      ])
      .returning({ id: users.id, email: users.email });
    const author = createdUsers.find((user) =>
      user.email.startsWith("author-"),
    )!;
    const commenter = createdUsers.find((user) =>
      user.email.startsWith("commenter-"),
    )!;
    const replier = createdUsers.find((user) =>
      user.email.startsWith("replier-"),
    )!;
    const [area] = await database
      .insert(communityAreas)
      .values({
        organizationId,
        title: "Allgemein",
        slug: "allgemein",
        sortOrder: 0,
      })
      .returning({ id: communityAreas.id });
    const [space] = await database
      .insert(communitySpaces)
      .values({
        organizationId,
        areaId: area.id,
        title: "Score restore",
        slug: `score-restore-${suffix}`,
        sortOrder: 0,
      })
      .returning({ id: communitySpaces.id });
    const createdPosts = await database
      .insert(posts)
      .values([
        {
          organizationId,
          spaceId: space.id,
          authorId: author.id,
          content: "Published score source",
        },
        {
          organizationId,
          spaceId: space.id,
          authorId: author.id,
          content: "Held score source",
          moderationState: "held",
          publishedAt: null,
        },
      ])
      .returning({ id: posts.id, moderationState: posts.moderationState });
    const publishedPost = createdPosts.find(
      (post) => post.moderationState === "published",
    )!;
    const heldPost = createdPosts.find(
      (post) => post.moderationState === "held",
    )!;
    const [topComment] = await database
      .insert(comments)
      .values({
        organizationId,
        postId: publishedPost.id,
        authorId: commenter.id,
        content: "Published top-level comment",
      })
      .returning({ id: comments.id });
    const [reply] = await database
      .insert(comments)
      .values({
        organizationId,
        postId: publishedPost.id,
        authorId: replier.id,
        parentId: topComment.id,
        content: "Published reply",
      })
      .returning({ id: comments.id });
    const [selfComment] = await database
      .insert(comments)
      .values({
        organizationId,
        postId: publishedPost.id,
        authorId: author.id,
        content: "Self comment",
      })
      .returning({ id: comments.id });
    const [heldComment] = await database
      .insert(comments)
      .values({
        organizationId,
        postId: publishedPost.id,
        authorId: replier.id,
        content: "Held comment",
        moderationState: "held",
        publishedAt: null,
      })
      .returning({ id: comments.id });
    const [publishedChildOfHeldComment] = await database
      .insert(comments)
      .values({
        organizationId,
        postId: publishedPost.id,
        authorId: commenter.id,
        parentId: heldComment.id,
        content: "Published child of held parent",
      })
      .returning({ id: comments.id });
    const [commentOnHeldPost] = await database
      .insert(comments)
      .values({
        organizationId,
        postId: heldPost.id,
        authorId: commenter.id,
        content: "Published comment on held post",
      })
      .returning({ id: comments.id });

    await database.insert(postLikes).values([
      {
        organizationId,
        postId: publishedPost.id,
        userId: commenter.id,
        reaction: "like",
      },
      {
        organizationId,
        postId: publishedPost.id,
        userId: author.id,
        reaction: "celebrate",
      },
      {
        organizationId,
        postId: heldPost.id,
        userId: commenter.id,
        reaction: "insightful",
      },
    ]);
    await database.insert(commentReactions).values([
      {
        organizationId,
        commentId: topComment.id,
        postId: publishedPost.id,
        userId: replier.id,
        reaction: "like",
      },
      {
        organizationId,
        commentId: topComment.id,
        postId: publishedPost.id,
        userId: commenter.id,
        reaction: "celebrate",
      },
      {
        organizationId,
        commentId: reply.id,
        postId: publishedPost.id,
        userId: author.id,
        reaction: "insightful",
      },
      {
        organizationId,
        commentId: selfComment.id,
        postId: publishedPost.id,
        userId: author.id,
        reaction: "like",
      },
      {
        organizationId,
        commentId: heldComment.id,
        postId: publishedPost.id,
        userId: commenter.id,
        reaction: "question",
      },
      {
        organizationId,
        commentId: publishedChildOfHeldComment.id,
        postId: publishedPost.id,
        userId: author.id,
        reaction: "question",
      },
      {
        organizationId,
        commentId: commentOnHeldPost.id,
        postId: heldPost.id,
        userId: replier.id,
        reaction: "question",
      },
    ]);

    const initialRestore = await database.transaction((tx) =>
      restoreCommunityScoreContributionsForPost(tx, {
        organizationId,
        postId: publishedPost.id,
      }),
    );
    assert.deepEqual(initialRestore, {
      created: 5,
      postReactions: 1,
      comments: 2,
      commentReactions: 2,
    });
    const expectedScores = [
      { id: author.id, communityPoints: 3 },
      { id: commenter.id, communityPoints: 2 },
      { id: replier.id, communityPoints: 1 },
    ].sort((left, right) => left.id.localeCompare(right.id));
    assert.deepEqual((await scoreState(organizationId)).scores, expectedScores);

    const idempotentRestore = await database.transaction((tx) =>
      restoreCommunityScoreContributionsForPost(tx, {
        organizationId,
        postId: publishedPost.id,
      }),
    );
    assert.equal(idempotentRestore.created, 0);
    assert.deepEqual((await scoreState(organizationId)).scores, expectedScores);

    await database.transaction((tx) =>
      removeCommunityScoreContributionsForPost(tx, {
        organizationId,
        postId: publishedPost.id,
      }),
    );
    assert.equal((await scoreState(organizationId)).contributions.length, 0);
    const restoredOnce = await database.transaction((tx) =>
      restoreCommunityScoreContributionsForPost(tx, {
        organizationId,
        postId: publishedPost.id,
      }),
    );
    assert.equal(restoredOnce.created, 5);
    await database.transaction((tx) =>
      removeCommunityScoreContributionsForPost(tx, {
        organizationId,
        postId: publishedPost.id,
      }),
    );
    const parallelRestores = await Promise.all([
      database.transaction((tx) =>
        restoreCommunityScoreContributionsForPost(tx, {
          organizationId,
          postId: publishedPost.id,
        }),
      ),
      database.transaction((tx) =>
        restoreCommunityScoreContributionsForPost(tx, {
          organizationId,
          postId: publishedPost.id,
        }),
      ),
    ]);
    assert.equal(
      parallelRestores.reduce((sum, result) => sum + result.created, 0),
      5,
    );
    assert.deepEqual((await scoreState(organizationId)).scores, expectedScores);

    await database.transaction((tx) =>
      removeCommunityScoreContributionsForPost(tx, {
        organizationId,
        postId: publishedPost.id,
      }),
    );
    await database
      .update(posts)
      .set({ moderationState: "held" })
      .where(
        and(
          eq(posts.id, publishedPost.id),
          eq(posts.organizationId, organizationId),
        ),
      );
    const hiddenPostRestore = await database.transaction((tx) =>
      restoreCommunityScoreContributionsForPost(tx, {
        organizationId,
        postId: publishedPost.id,
      }),
    );
    assert.equal(hiddenPostRestore.created, 0);
    await database
      .update(posts)
      .set({ moderationState: "published" })
      .where(
        and(
          eq(posts.id, publishedPost.id),
          eq(posts.organizationId, organizationId),
        ),
      );

    const commentRestore = await database.transaction((tx) =>
      restoreCommunityScoreContributionsForComment(tx, {
        organizationId,
        commentId: topComment.id,
      }),
    );
    assert.deepEqual(commentRestore, {
      created: 4,
      postReactions: 0,
      comments: 2,
      commentReactions: 2,
    });
    assert.deepEqual(
      (await scoreState(organizationId)).scores,
      [...expectedScores.map((score) => ({ ...score }))].map((score) =>
        score.id === author.id ? { ...score, communityPoints: 2 } : score,
      ),
    );
    await database.transaction((tx) =>
      removeCommunityScoreContributionsForComment(tx, {
        organizationId,
        commentId: topComment.id,
      }),
    );
    const restoredCommentAgain = await database.transaction((tx) =>
      restoreCommunityScoreContributionsForComment(tx, {
        organizationId,
        commentId: topComment.id,
      }),
    );
    assert.equal(restoredCommentAgain.created, 4);
    assert.equal(
      (
        await database.transaction((tx) =>
          restoreCommunityScoreContributionsForComment(tx, {
            organizationId,
            commentId: topComment.id,
          }),
        )
      ).created,
      0,
    );

    await database.transaction((tx) =>
      removeCommunityScoreContributionsForComment(tx, {
        organizationId,
        commentId: topComment.id,
      }),
    );
    await database
      .update(comments)
      .set({ moderationState: "held" })
      .where(eq(comments.id, topComment.id));
    assert.equal(
      (
        await database.transaction((tx) =>
          restoreCommunityScoreContributionsForComment(tx, {
            organizationId,
            commentId: topComment.id,
          }),
        )
      ).created,
      0,
    );
    await database
      .update(comments)
      .set({ moderationState: "published" })
      .where(eq(comments.id, topComment.id));
    await database
      .update(comments)
      .set({ moderationState: "held" })
      .where(eq(comments.id, reply.id));
    const partiallyHiddenRestore = await database.transaction((tx) =>
      restoreCommunityScoreContributionsForComment(tx, {
        organizationId,
        commentId: topComment.id,
      }),
    );
    assert.deepEqual(partiallyHiddenRestore, {
      created: 2,
      postReactions: 0,
      comments: 1,
      commentReactions: 1,
    });
    await database.transaction((tx) =>
      removeCommunityScoreContributionsForComment(tx, {
        organizationId,
        commentId: topComment.id,
      }),
    );
    assert.equal(
      (
        await database.transaction((tx) =>
          restoreCommunityScoreContributionsForComment(tx, {
            organizationId,
            commentId: heldComment.id,
          }),
        )
      ).created,
      0,
    );
    assert.equal(
      (
        await database.transaction((tx) =>
          restoreCommunityScoreContributionsForComment(tx, {
            organizationId,
            commentId: publishedChildOfHeldComment.id,
          }),
        )
      ).created,
      0,
    );
    assert.equal(
      (
        await database.transaction((tx) =>
          restoreCommunityScoreContributionsForComment(tx, {
            organizationId,
            commentId: commentOnHeldPost.id,
          }),
        )
      ).created,
      0,
    );
    assert.equal((await scoreState(organizationId)).contributions.length, 0);
  } finally {
    if (organizationId) {
      await client`delete from organizations where id = ${organizationId}`;
    }
    await client.end();
  }
});
