import assert from "node:assert/strict";
import test from "node:test";

import { filterReusableModules } from "../src/lib/reusable-module-picker";

const modules = [
  { id: "one", title: "Secure foundations", kind: "learning" as const, folder: "Security", estimatedMinutes: 20, lessonCount: 2, usageCount: 1 },
  { id: "two", title: "Final assessment", kind: "exam" as const, folder: "Checks", estimatedMinutes: 30, lessonCount: 1, usageCount: 3 },
  { id: "three", title: "Operations handbook", kind: "link" as const, folder: "Security", estimatedMinutes: 5, lessonCount: 0, usageCount: 2 },
];

test("reusable module picker combines title search, folder and kind filters", () => {
  assert.deepEqual(
    filterReusableModules(modules, {
      query: "secure",
      folder: "Security",
      kind: "learning",
      locale: "en",
    }).map((module) => module.id),
    ["one"],
  );
  assert.deepEqual(
    filterReusableModules(modules, {
      query: "security",
      folder: "all",
      kind: "link",
      locale: "en",
    }).map((module) => module.id),
    ["three"],
  );
  assert.equal(
    filterReusableModules(modules, {
      query: "missing",
      folder: "all",
      kind: "all",
      locale: "de",
    }).length,
    0,
  );
});
