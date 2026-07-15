import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const feedSource = readFileSync("src/lib/community-feed.ts", "utf8");
const uiSource = readFileSync(
  "src/components/academy/community-feed.tsx",
  "utf8",
);
const overviewSource = readFileSync(
  "src/app/(member)/academy/community/page.tsx",
  "utf8",
);

test("comment reaction summaries stay batched and are present on every shared DTO", () => {
  assert.match(
    feedSource,
    /async function commentReactionSummaries[\s\S]*inArray\(\s*commentReactions\.commentId,\s*input\.commentIds\s*\)/,
  );
  assert.equal(
    (feedSource.match(/commentReactionSummaries\(\{/g) ?? []).length,
    2,
  );
  for (const field of [
    "reactionCount",
    "likeReactionCount",
    "celebrateReactionCount",
    "insightfulReactionCount",
    "questionReactionCount",
    "myReaction",
  ]) {
    assert.match(feedSource, new RegExp(`${field}:`));
  }
});

test("member comments expose a compact four-option reaction control", () => {
  assert.match(uiSource, /function CommentReactionBar/);
  assert.match(
    uiSource,
    /setCommentReactionAction\(comment\.id, nextReaction\)/,
  );
  assert.match(uiSource, /aria-label=\{copy\.reactions\.commentGroupLabel\}/);
  assert.match(uiSource, /max-w-full flex-wrap/);
});

test("community overview uses the independent score and validated level domain", () => {
  assert.match(feedSource, /communityPoints: users\.communityPoints/);
  assert.match(feedSource, /desc\(users\.communityPoints\)/);
  assert.match(feedSource, /resolveCommunityLevelProgress\(\{/);
  assert.doesNotMatch(overviewSource, /nextBadge|currentUser\.points/);
  assert.match(overviewSource, /currentUser\.communityPoints/);
});
