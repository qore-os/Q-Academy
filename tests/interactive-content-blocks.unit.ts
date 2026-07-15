import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  GalleryContent,
  LinkButtonContent,
} from "../src/components/content/interactive-block-content";
import { contentBlockCreateSchema } from "../src/lib/api/schemas";
import {
  sanitizeGalleryDocument,
  sanitizeLinkButtonDocument,
  safeCourseImageSource,
} from "../src/lib/content-blocks/interactive-documents";

const mediaSource =
  "/api/media-assets/00000000-0000-4000-8000-000000000001/download";

test("button documents allow only safe targets and fixed variants", () => {
  assert.equal(
    sanitizeLinkButtonDocument({
      version: 1,
      label: "Unsicher",
      href: "javascript:alert(1)",
      variant: "primary",
    }),
    null,
  );
  assert.deepEqual(
    sanitizeLinkButtonDocument({
      version: 1,
      label: "  Intern oeffnen  ",
      href: "/academy/courses",
      variant: "background:url(javascript:alert(1))",
    }),
    {
      version: 1,
      label: "Intern oeffnen",
      href: "/academy/courses",
      variant: "primary",
    },
  );

  const markup = renderToStaticMarkup(
    createElement(LinkButtonContent, {
      document: {
        version: 1,
        label: "Extern oeffnen",
        href: "https://example.com/guide",
        variant: "secondary",
      },
    }),
  );
  assert.match(markup, /href="https:\/\/example\.com\/guide"/);
  assert.match(markup, /target="_blank"/);
  assert.match(markup, /rel="noopener noreferrer nofollow"/);
  assert.doesNotMatch(markup, /javascript:/i);
});

test("gallery documents retain only hardened image sources and accessible items", () => {
  const document = sanitizeGalleryDocument({
    version: 1,
    layout: "featured",
    items: [
      {
        source: "https://example.com/academy.jpg",
        alt: "Lernende im Workshop",
        caption: "Gemeinsam <script>lernen</script>",
      },
      {
        source: mediaSource,
        alt: "Geprueftes Kursbild",
        mediaAssetId: "00000000-0000-4000-8000-000000000001",
      },
      {
        source: "/images/courses/foundations.webp",
        alt: "Lokales Kursbild",
      },
      { source: "javascript:alert(1)", alt: "Unsicher" },
      { source: "/academy/private", alt: "Kein Bild-Endpunkt" },
      { source: "https://example.com/no-alt.jpg", alt: "" },
    ],
  });

  assert.equal(document.items.length, 3);
  assert.equal(document.layout, "featured");
  assert.equal(safeCourseImageSource(mediaSource), mediaSource);
  assert.equal(
    safeCourseImageSource("/images/courses/foundations.webp"),
    "/images/courses/foundations.webp",
  );
  assert.equal(safeCourseImageSource("/images/../secrets.png"), null);
  assert.equal(safeCourseImageSource("/academy/private"), null);
  assert.equal(safeCourseImageSource("data:image/svg+xml,test"), null);
  assert.deepEqual(
    sanitizeGalleryDocument({
      version: 1,
      layout: "grid",
      items: [
        {
          source: "https://example.com/public.jpg",
          alt: "Externes Bild",
          mediaAssetId: "00000000-0000-4000-8000-000000000001",
          mediaAssetName: "private.png",
        },
      ],
    }).items,
    [{ source: "https://example.com/public.jpg", alt: "Externes Bild" }],
  );

  const markup = renderToStaticMarkup(
    createElement(GalleryContent, { document, locale: "de" }),
  );
  assert.match(markup, /aria-label="Bildergalerie"/);
  assert.match(markup, /loading="lazy"/);
  assert.match(markup, /alt="Lernende im Workshop"/);
  assert.match(markup, /Gemeinsam &lt;script&gt;lernen&lt;\/script&gt;/);
  assert.doesNotMatch(markup, /javascript:/i);
});

test("REST content block schemas normalize safe button and gallery JSON", () => {
  const button = contentBlockCreateSchema.safeParse({
    type: "button",
    data: {
      button: {
        version: 1,
        label: "Kurs oeffnen",
        href: "/academy/courses",
        variant: "link",
      },
    },
  });
  assert.equal(button.success, true);

  const gallery = contentBlockCreateSchema.safeParse({
    type: "gallery",
    data: {
      gallery: {
        version: 1,
        layout: "grid",
        items: [
          {
            source: "https://example.com/one.jpg",
            alt: "Erstes Bild",
          },
          { source: "javascript:alert(1)", alt: "Unsicher" },
        ],
      },
    },
  });
  assert.equal(gallery.success, true);
  if (gallery.success) {
    assert.equal(gallery.data.data.gallery?.items.length, 1);
  }

  assert.equal(
    contentBlockCreateSchema.safeParse({
      type: "gallery",
      data: {
        gallery: {
          version: 1,
          layout: "grid",
          items: [{ source: "javascript:alert(1)", alt: "Unsicher" }],
        },
      },
    }).success,
    false,
  );
});
