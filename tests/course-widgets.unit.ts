import assert from "node:assert/strict";
import test from "node:test";

import {
  courseWidgetCreateSchema,
  courseWidgetOrderSchema,
  courseWidgetMediaUrl,
  courseWidgetValues,
} from "../src/lib/course-widgets";

const authorId = "11111111-1111-4111-8111-111111111111";
const mediaAssetId = "22222222-2222-4222-8222-222222222222";

test("course widget schemas normalize valid type-specific payloads", () => {
  const author = courseWidgetCreateSchema.parse({
    type: "author",
    authorUserId: authorId,
    roleLabel: "  Kursleitung  ",
    description: "  Praxisnah begleitet.  ",
  });
  assert.deepEqual(author, {
    type: "author",
    authorUserId: authorId,
    roleLabel: "Kursleitung",
    description: "Praxisnah begleitet.",
  });

  const info = courseWidgetCreateSchema.parse({
    type: "info",
    title: "  Sprechstunde ",
    text: " Jeden Freitag. ",
    linkUrl: "/academy/events",
  });
  assert.equal(info.type, "info");
  if (info.type === "info") {
    assert.equal(info.title, "Sprechstunde");
    assert.equal(info.linkUrl, "/academy/events");
  }

  const image = courseWidgetCreateSchema.parse({
    type: "image_link",
    imageUrl: "https://images.example.test/course.webp",
    altText: "Workshop am Whiteboard",
    linkUrl: "https://example.test/workshop",
  });
  assert.equal(image.type, "image_link");
  if (image.type === "image_link") {
    assert.equal(image.linkUrl, "https://example.test/workshop");
  }

  const privateImage = courseWidgetCreateSchema.parse({
    type: "image_link",
    mediaAssetId,
    altText: "Privates Workshop-Bild",
    linkUrl: "/academy/courses",
  });
  assert.equal(privateImage.type, "image_link");
  if (privateImage.type === "image_link") {
    assert.equal(privateImage.mediaAssetId, mediaAssetId);
    assert.equal(
      courseWidgetValues(privateImage).imageUrl,
      courseWidgetMediaUrl(mediaAssetId),
    );
  }
});

test("course widgets reject unsafe links, controls, and private image downloads", () => {
  const invalidLinks = [
    "javascript:alert(1)",
    "https://user:secret@example.test/path",
    "//example.test/path",
  ];
  for (const linkUrl of invalidLinks) {
    assert.equal(
      courseWidgetCreateSchema.safeParse({
        type: "info",
        title: "Hinweis",
        text: "Ein sicherer Hinweis.",
        linkUrl,
      }).success,
      false,
    );
  }
  assert.equal(
    courseWidgetCreateSchema.safeParse({
      type: "info",
      title: "Hin\u0000weis",
      text: "Ein sicherer Hinweis.",
    }).success,
    false,
  );

  const invalidImages = [
    "http://images.example.test/course.webp",
    "/api/media-assets/11111111-1111-4111-8111-111111111111/download",
    "/images/../secret.webp",
  ];
  for (const imageUrl of invalidImages) {
    assert.equal(
      courseWidgetCreateSchema.safeParse({
        type: "image_link",
        imageUrl,
        altText: "Kursbild",
        linkUrl: "/academy/courses",
      }).success,
      false,
    );
  }
  assert.equal(
    courseWidgetCreateSchema.safeParse({
      type: "image_link",
      mediaAssetId,
      imageUrl: "https://images.example.test/not-the-private-asset.webp",
      altText: "Abweichende Bildquelle",
      linkUrl: "/academy/courses",
    }).success,
    false,
  );
});

test("course widget values clear fields outside the selected type", () => {
  const values = courseWidgetValues(
    courseWidgetCreateSchema.parse({
      type: "info",
      title: "Hinweis",
      text: "Ein sicherer Hinweis.",
      linkUrl: "",
    }),
  );
  assert.deepEqual(values, {
    type: "info",
    sortOrder: undefined,
    authorUserId: null,
    authorRole: null,
    authorDescription: null,
    title: "Hinweis",
    text: "Ein sicherer Hinweis.",
    linkUrl: null,
    imageUrl: null,
    mediaAssetId: null,
    altText: null,
  });
  assert.equal(
    courseWidgetOrderSchema.safeParse({ orderedIds: [authorId, authorId] })
      .success,
    false,
  );
});
