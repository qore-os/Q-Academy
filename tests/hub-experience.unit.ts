import assert from "node:assert/strict";
import test from "node:test";

import {
  safeCourseEmbedUrl,
  safeHubEmbedUrl,
} from "../src/lib/hub-embed-policy";
import { publicHubLayout } from "../src/lib/hub-layout";

test("hub embeds accept only pinned HTTPS providers and provider paths", () => {
  assert.equal(
    safeHubEmbedUrl("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"),
    "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
  );
  assert.equal(safeHubEmbedUrl("https://www.youtube.com/embed/dQw4w9WgXcQ"), null);
  assert.equal(
    safeHubEmbedUrl("https://www.youtube-nocookie.com/watch?v=dQw4w9WgXcQ"),
    null,
  );
  assert.equal(
    safeHubEmbedUrl("https://user:secret@player.vimeo.com/video/123456"),
    null,
  );
  assert.equal(
    safeHubEmbedUrl("https://player.vimeo.com/video/123456#token"),
    null,
  );
  assert.equal(safeHubEmbedUrl("http://player.vimeo.com/video/123456"), null);
});

test("course embeds use the same pinned provider contract", () => {
  assert.equal(
    safeCourseEmbedUrl("https://player.vimeo.com/video/123456"),
    "https://player.vimeo.com/video/123456",
  );
  assert.equal(
    safeCourseEmbedUrl("https://example.test/training/player"),
    null,
  );
  assert.equal(
    safeCourseEmbedUrl("https://docs.google.com/forms/d/e/form-1234567890/viewform"),
    "https://docs.google.com/forms/d/e/form-1234567890/viewform",
  );
});

test("public hub projection keeps categories and harmless code but drops raw configuration", () => {
  assert.deepEqual(
    publicHubLayout([
      {
        id: "resources",
        category: "  Praxis  ",
        internal: "secret",
        columns: [
          {
            type: "code",
            title: "Beispiel",
            description: "<script>alert(1)</script>",
            href: "https://example.test/legacy-code-link",
            executable: true,
          },
          {
            type: "code",
            title: "Leerer Altbestand",
            description: " \n ",
          },
          {
            type: "embed",
            title: "Video",
            href: "https://www.youtube.com/embed/dQw4w9WgXcQ",
          },
        ],
      },
    ]),
    [
      {
        id: "resources",
        category: "Praxis",
        columns: [
          {
            type: "code",
            title: "Beispiel",
            description: "<script>alert(1)</script>",
          },
        ],
      },
    ],
  );
});
