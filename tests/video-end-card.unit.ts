import assert from "node:assert/strict";
import test from "node:test";

import {
  sanitizeVideoEndCard,
  videoEndCardFromForm,
} from "../src/lib/media/video-end-card";

test("video end cards retain only bounded text and safe links", () => {
  assert.deepEqual(
    sanitizeVideoEndCard({
      version: 1,
      heading: "  Continue learning  ",
      text: "Next module\r\nis ready.",
      cta: { label: "Open module", href: "/academy/course/module" },
    }),
    {
      version: 1,
      heading: "Continue learning",
      text: "Next module\nis ready.",
      cta: { label: "Open module", href: "/academy/course/module" },
    },
  );
});

test("video end cards reject unsafe or incomplete CTAs", () => {
  assert.equal(
    sanitizeVideoEndCard({
      version: 1,
      heading: "Done",
      cta: { label: "Continue", href: "javascript:alert(1)" },
    }),
    null,
  );
  assert.deepEqual(
    videoEndCardFromForm({
      enabled: true,
      heading: "Done",
      text: "",
      ctaLabel: "Continue",
      ctaHref: "",
    }),
    { success: false, reason: "invalid_content" },
  );
});

test("a disabled end card is removed cleanly", () => {
  assert.deepEqual(
    videoEndCardFromForm({
      enabled: false,
      heading: "Ignored",
      text: "Ignored",
      ctaLabel: "Ignored",
      ctaHref: "https://example.com",
    }),
    { success: true, value: null },
  );
});
