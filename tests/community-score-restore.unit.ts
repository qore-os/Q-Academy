import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("src/lib/community-score-core.ts", "utf8");

function functionSource(name: string, nextName: string) {
  const start = source.indexOf(`export async function ${name}`);
  const end = source.indexOf(`export async function ${nextName}`, start + 1);
  assert.notEqual(start, -1, `${name} is missing.`);
  assert.notEqual(end, -1, `${nextName} boundary is missing.`);
  return source.slice(start, end);
}

test("post restore is a constant-size set operation with exact visibility gates", () => {
  const body = functionSource(
    "restoreCommunityScoreContributionsForPost",
    "restoreCommunityScoreContributionsForComment",
  );
  assert.equal((body.match(/tx\.execute/g) ?? []).length, 3);
  assert.equal((body.match(/on conflict do nothing/g) ?? []).length, 3);
  assert.doesNotMatch(body, /for\s*\(|\.map\s*\(/);
  assert.match(body, /post\.moderation_state = 'published'/);
  assert.match(body, /comment\.moderation_state = 'published'/);
  assert.match(body, /parent\.moderation_state = 'published'/);
  assert.match(body, /post\.author_id <> reaction\.user_id/);
  assert.match(body, /comment\.author_id <> reaction\.user_id/);
});

test("comment restore stays bounded to the target and its direct replies", () => {
  const body = functionSource(
    "restoreCommunityScoreContributionsForComment",
    "removePostReactionCommunityScore",
  );
  assert.equal((body.match(/tx\.execute/g) ?? []).length, 2);
  assert.equal((body.match(/on conflict do nothing/g) ?? []).length, 2);
  assert.doesNotMatch(body, /for\s*\(|\.map\s*\(/);
  assert.match(
    body,
    /comment\.id = target\.id or comment\.parent_id = target\.id/,
  );
  assert.match(body, /target\.moderation_state = 'published'/);
  assert.match(body, /post\.moderation_state = 'published'/);
  assert.match(body, /target_parent\.moderation_state = 'published'/);
});
