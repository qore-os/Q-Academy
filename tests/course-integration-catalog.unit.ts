import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { contentBlockCreateSchema } from "../src/lib/api/schemas";
import {
  COURSE_INTEGRATION_PROVIDERS,
  courseIntegrationFrameClass,
  courseIntegrationProviderForUrl,
  resolveCourseIntegration,
  resolveCourseIntegrationLayout,
} from "../src/lib/content-blocks/integration-catalog";
import { getCourseIntegrationCopy } from "../src/lib/i18n/course-integrations";
import { SUPPORTED_LOCALES } from "../src/lib/i18n/model";

test("course integration catalog binds every provider to its canonical host", () => {
  const fixtures = [
    ["youtube", "https://www.youtube-nocookie.com/embed/abcdefgh"],
    ["vimeo", "https://player.vimeo.com/video/12345678"],
    ["loom", "https://www.loom.com/embed/abcdefgh"],
    ["microsoft_forms", "https://forms.office.com/r/abcd1234"],
    [
      "google_forms",
      "https://docs.google.com/forms/d/e/abcdefghij123456/viewform",
    ],
  ] as const;

  assert.equal(fixtures.length, COURSE_INTEGRATION_PROVIDERS.length);
  for (const [providerId, url] of fixtures) {
    assert.equal(courseIntegrationProviderForUrl(url)?.id, providerId);
    assert.equal(
      resolveCourseIntegration(url, providerId)?.provider.id,
      providerId,
    );
  }
  assert.equal(resolveCourseIntegration(fixtures[0][1], "vimeo"), null);
  assert.equal(
    resolveCourseIntegration("https://example.com/embed/abcdefgh"),
    null,
  );
});

test("course integration API rejects provider spoofing and unrelated block fields", () => {
  const valid = contentBlockCreateSchema.safeParse({
    type: "embed",
    data: {
      embedUrl: "https://www.youtube-nocookie.com/embed/abcdefgh",
      embedProvider: "youtube",
      embedLayout: "video",
    },
  });
  assert.equal(valid.success, true);
  assert.equal(
    contentBlockCreateSchema.safeParse({
      type: "embed",
      data: {
        embedUrl: "https://www.youtube-nocookie.com/embed/abcdefgh",
        embedProvider: "vimeo",
        embedLayout: "video",
      },
    }).success,
    false,
  );
  assert.equal(
    contentBlockCreateSchema.safeParse({
      type: "text",
      data: { text: "Content", embedLayout: "form" },
    }).success,
    false,
  );
});

test("integration layouts use provider defaults and stable frame dimensions", () => {
  assert.equal(
    resolveCourseIntegrationLayout(undefined, "google_forms"),
    "form",
  );
  assert.equal(resolveCourseIntegrationLayout(undefined, "youtube"), "video");
  assert.equal(
    resolveCourseIntegrationLayout("standard", "youtube"),
    "standard",
  );
  assert.equal(courseIntegrationFrameClass("video"), "aspect-video");
  assert.equal(courseIntegrationFrameClass("standard"), "aspect-[4/3]");
  assert.match(courseIntegrationFrameClass("form"), /min-h-\[520px\]/);
  for (const locale of SUPPORTED_LOCALES) {
    const copy = getCourseIntegrationCopy(locale);
    assert.ok(copy.provider);
    assert.ok(copy.providerHint);
    assert.ok(copy.consentTitle("Provider"));
    assert.match(copy.consentDescription("Provider"), /Provider/);
    assert.ok(copy.loadContent);
    assert.deepEqual(Object.keys(copy.layouts), ["video", "standard", "form"]);
  }
});

test("learner integrations require an explicit click before creating the iframe", async () => {
  const [componentSource, lessonSource] = await Promise.all([
    readFile(
      new URL(
        "../src/components/academy/course-integration-embed.tsx",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(
      new URL("../src/components/academy/lesson-content.tsx", import.meta.url),
      "utf8",
    ),
  ]);

  assert.match(componentSource, /if \(loaded\)/);
  assert.match(componentSource, /setLoaded\(true\)/);
  assert.match(componentSource, /data-course-integration-consent/);
  assert.match(componentSource, /data-course-integration-frame/);
  assert.doesNotMatch(lessonSource, /<iframe\s+src=\{src\}/);
  assert.match(lessonSource, /<CourseIntegrationEmbed/);
});
