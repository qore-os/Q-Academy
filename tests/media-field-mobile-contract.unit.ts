import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const profileField = readFileSync(
  "src/components/media/profile-media-asset-field.tsx",
  "utf8",
);
const courseMediaField = readFileSync(
  "src/components/admin/course-media-source-field.tsx",
  "utf8",
);

test("profile media resets its native file input after selecting and removing", () => {
  assert.match(
    profileField,
    /const inputRef = useRef<HTMLInputElement>\(null\);/,
  );
  assert.match(profileField, /ref=\{inputRef\}/);

  const select = profileField.slice(
    profileField.indexOf("  const select = async"),
    profileField.indexOf("  const retryUpload ="),
  );
  assert.match(select, /inputRef\.current\.value = ""/);

  const remove = profileField.slice(
    profileField.indexOf("  const remove = async"),
    profileField.indexOf("  const \{ isDraggingFiles"),
  );
  assert.match(remove, /inputRef\.current\.value = ""/);
});

test("stock attribution remains contained at mobile widths", () => {
  const stockStart = courseMediaField.indexOf(
    "      {stockAvailableForKind ? (",
  );
  const stockPanel = courseMediaField.slice(
    stockStart,
    courseMediaField.indexOf("    </div>\n  );", stockStart),
  );

  assert.match(stockPanel, /min-w-0 space-y-3/);
  assert.match(
    stockPanel,
    /min-w-0 break-words[^"\n]*\[overflow-wrap:anywhere\]/,
  );
  assert.match(stockPanel, /focus-ring min-w-0 overflow-hidden/);
});
