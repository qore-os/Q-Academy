import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { getLearningUiCopy } from "../src/lib/i18n/learning";
import { SUPPORTED_LOCALES } from "../src/lib/i18n/model";

const source = (path: string) => readFileSync(path, "utf8");

test("member preview opts into a poster-first video without changing learner playback", () => {
  const preview = source("src/app/(admin)/admin/courses/[id]/preview/page.tsx");
  const lesson = source("src/components/academy/lesson-content.tsx");
  const player = source("src/components/academy/video-transcript-player.tsx");

  assert.match(
    preview,
    /poster=\{data\.videoPoster\}[\s\S]*showPosterBeforePlayback/,
  );
  assert.doesNotMatch(lesson, /showPosterBeforePlayback/);
  assert.match(
    player,
    /resolvedPosterUrl = useMemo\([\s\S]*videoPosterUrl\(mediaAssetId, poster\)/,
  );
  assert.match(
    player,
    /preload=\{showsPosterBeforePlayback \? "none" : "metadata"\}/,
  );
  assert.match(player, /controls=\{!showsPosterBeforePlayback\}/);
  assert.match(
    player,
    /tabIndex=\{showsPosterBeforePlayback \? -1 : undefined\}/,
  );
  assert.match(
    player,
    /aria-hidden=\{showsPosterBeforePlayback \|\| undefined\}/,
  );
  assert.match(player, /data-video-poster-start/);
  assert.match(player, /videoRef\.current\?\.play\(\)/);
  assert.match(
    player,
    /onPlay=\{\(\) => \{[\s\S]*setStartedPlaybackSourceKey\(playbackSourceKey\)/,
  );
  assert.doesNotMatch(
    player,
    /on(?:Pause|Ended)=\{[\s\S]{0,300}setStartedPlaybackSourceKey/,
  );
});

test("poster play controls have localized accessible names", () => {
  for (const locale of SUPPORTED_LOCALES) {
    assert.match(
      getLearningUiCopy(locale)("video.play", { title: "Intro" }),
      /Intro/,
    );
  }
});
