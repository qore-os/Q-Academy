import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { dedupeAiMessageCitations } from "../src/lib/ai/citations";

test("AI citations keep one entry per canonical learning target", () => {
  const courseId = randomUUID();
  const lessonId = randomUUID();
  const pageId = randomUUID();
  const lessonHref = `/academy/courses/sicher-arbeiten/learn/${lessonId}`;
  const pageHref = `${lessonHref}?page=${pageId}`;
  const agentSourceId = `agent-source:${randomUUID()}`;

  const citations = dedupeAiMessageCitations([
    {
      title: "Vertiefung",
      href: pageHref,
      courseId,
      lessonId,
      pageId,
    },
    { title: "Vertiefung, doppelt", href: pageHref },
    { title: "Lektion", href: lessonHref, courseId, lessonId },
    { title: "Lektion, doppelt", lessonId },
    {
      title: "Handbuch",
      courseId: agentSourceId,
      lessonId: agentSourceId,
    },
    {
      title: "Handbuch, doppelt",
      courseId: agentSourceId,
      lessonId: agentSourceId,
    },
  ]);

  assert.deepEqual(
    citations.map((citation) => citation.title),
    ["Vertiefung", "Lektion", "Handbuch"],
  );
});
