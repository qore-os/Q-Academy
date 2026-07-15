import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const hook = readFileSync("src/lib/use-modal-focus.ts", "utf8");
const manager = readFileSync(
  "src/components/admin/announcement-manager.tsx",
  "utf8",
);
const layer = readFileSync(
  "src/components/academy/announcement-layer.tsx",
  "utf8",
);

test("modal focus helper traps tab, closes on escape and restores focus", () => {
  assert.match(hook, /event\.key === "Escape"/);
  assert.match(hook, /event\.key !== "Tab"/);
  assert.match(hook, /last\.focus\(\)/);
  assert.match(hook, /first\.focus\(\)/);
  assert.match(hook, /previouslyFocused\?\.focus\(\)/);
});

test("announcement editor and member modal use the shared focus contract", () => {
  assert.match(manager, /useModalFocus<HTMLDivElement>/);
  assert.match(manager, /ref=\{dialogRef\}/);
  assert.match(layer, /useModalFocus<HTMLDivElement>/);
  assert.match(layer, /ref=\{modalDialogRef\}/);
});
