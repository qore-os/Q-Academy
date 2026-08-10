import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dockerfile = readFileSync("Dockerfile", "utf8");

function stageSource(name: string, nextStage: string) {
  const start = dockerfile.indexOf(`FROM base AS ${name}`);
  const end = dockerfile.indexOf(`FROM ${nextStage}`, start + 1);
  assert.ok(start >= 0 && end > start);
  return dockerfile.slice(start, end);
}

test("npm dependency stages retain a verified cache across interrupted downloads", () => {
  const stages = [
    stageSource("dependencies", "dependencies AS release-verifier"),
    stageSource("production-dependencies", "runtime-base AS migrator"),
  ];

  for (const stage of stages) {
    assert.match(
      stage,
      /RUN --mount=type=cache,id=q-academy-npm-cache,target=\/root\/\.npm,sharing=locked/,
    );
    assert.match(stage, /npm ci/);
    assert.match(stage, /--no-audit/);
    assert.match(stage, /--no-fund/);
    assert.match(stage, /--prefer-offline/);
    assert.match(stage, /--fetch-retries=5/);
    assert.match(stage, /--fetch-retry-factor=2/);
    assert.match(stage, /--fetch-retry-mintimeout=10000/);
    assert.match(stage, /--fetch-retry-maxtimeout=60000/);
    assert.match(stage, /--maxsockets=5/);
    assert.doesNotMatch(stage, /npm cache clean/);
  }
});
