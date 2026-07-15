import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { blocksAllowedForAiGrounding } from "../src/lib/ai/grounding";

const blocks = [
  {
    id: "10000000-0000-4000-8000-000000000001",
    type: "info",
    title: "Hinweis",
    sortOrder: 0,
    data: { text: "Sicherer Pruefungshinweis" },
  },
  {
    id: "10000000-0000-4000-8000-000000000002",
    type: "multiple_choice",
    title: "Verdeckte Frage",
    sortOrder: 1,
    data: {
      prompt: "Welche Antwort ist richtig?",
      options: ["A", "B"],
      correctOption: 1,
    },
  },
  {
    id: "10000000-0000-4000-8000-000000000003",
    type: "submission",
    title: "Verdeckte Transferaufgabe",
    sortOrder: 2,
    data: { prompt: "Beschreibe die geheime Fallstudie." },
  },
];

test("exam questions and submissions never enter AI grounding", () => {
  assert.deepEqual(
    blocksAllowedForAiGrounding("exam", blocks).map((block) => block.type),
    ["info"],
  );
  assert.equal(blocksAllowedForAiGrounding("lesson", blocks).length, 3);
});

test("AI messages recheck active strict exam locks before and after generation", () => {
  const source = readFileSync(
    path.resolve(process.cwd(), "src/lib/ai/conversations.ts"),
    "utf8",
  );
  assert.ok(
    source.split("assertAiAvailableDuringExam(").length - 1 >= 3,
    "The guard must be defined and called before generation and in the commit transaction.",
  );
  assert.match(source, /getActiveExamContentLock\(reader, input\)/);
  assert.match(source, /grounding\.schemaVersion !== 2/);
  assert.match(
    readFileSync(
      path.resolve(process.cwd(), "src/lib/ai/provider.ts"),
      "utf8",
    ),
    /schemaVersion: 2/,
  );
});
