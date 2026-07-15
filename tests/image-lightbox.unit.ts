import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

import { GalleryContent } from "../src/components/content/interactive-block-content";
import { getImageLightboxCopy } from "../src/lib/i18n/image-lightbox";
import type { AppLocale } from "../src/lib/i18n/model";

const locales: AppLocale[] = ["de", "en", "it", "es", "fr"];
const sourceFiles = {
  lightbox: "src/components/content/image-lightbox.tsx",
  attachments: "src/components/academy/community-attachments.tsx",
  gallery: "src/components/content/interactive-block-content.tsx",
  lesson: "src/components/academy/lesson-content.tsx",
  builder: "src/components/admin/course-builder.tsx",
  preview: "src/app/(admin)/admin/courses/[id]/preview/page.tsx",
  communityPage: "src/app/(admin)/admin/community/page.tsx",
} as const;

function leafPaths(value: unknown, prefix = ""): string[] {
  if (typeof value === "string" || typeof value === "function") return [prefix];
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, child]) =>
    leafPaths(child, prefix ? `${prefix}.${key}` : key),
  );
}

function functionOutputs(copy: ReturnType<typeof getImageLightboxCopy>) {
  return {
    position: copy.position("__CURRENT__", "__TOTAL__"),
    openImage: copy.openImage("__NAME__"),
    selectImage: copy.selectImage("__POSITION__", "__NAME__"),
  };
}

function actionableJsxText(source: string, fileName: string) {
  const file = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const values: string[] = [];
  function visit(node: ts.Node) {
    if (ts.isJsxText(node)) {
      const normalized = node.text.replace(/\s+/g, " ").trim();
      if (/[A-Za-zÀ-ÿ]/.test(normalized)) values.push(normalized);
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return values;
}

test("image lightbox dictionaries keep complete DE/EN/IT/ES/FR parity", () => {
  const referencePaths = leafPaths(getImageLightboxCopy("de")).sort();
  assert.equal(referencePaths.length, 11);

  for (const locale of locales) {
    const copy = getImageLightboxCopy(locale);
    assert.deepEqual(leafPaths(copy).sort(), referencePaths, locale);
    const outputs = functionOutputs(copy);
    assert.match(outputs.position, /__CURRENT__/);
    assert.match(outputs.position, /__TOTAL__/);
    assert.match(outputs.openImage, /__NAME__/);
    assert.match(outputs.selectImage, /__POSITION__/);
    assert.match(outputs.selectImage, /__NAME__/);
  }

  for (const locale of locales.filter((value) => value !== "de")) {
    assert.notEqual(
      getImageLightboxCopy(locale).dialogTitle,
      getImageLightboxCopy("de").dialogTitle,
      locale,
    );
  }
});

test("lightbox is keyboard complete, focus-safe and free of hardcoded product copy", () => {
  const source = readFileSync(sourceFiles.lightbox, "utf8");
  assert.match(source, /role="dialog"/);
  assert.match(source, /aria-modal="true"/);
  assert.match(source, /event\.key === "Escape"/);
  assert.match(source, /event\.key === "ArrowLeft"/);
  assert.match(source, /event\.key === "ArrowRight"/);
  assert.match(source, /event\.key !== "Tab"/);
  assert.match(source, /visibleFocusableElements/);
  assert.match(source, /previouslyFocusedRef\.current\?\.focus\(\)/);
  assert.match(source, /document\.body\.style\.overflow = "hidden"/);
  assert.match(source, /data-lightbox-thumbnail/);
  assert.match(source, /current\.originalHref \?\? current\.src/);
  assert.deepEqual(actionableJsxText(source, sourceFiles.lightbox), []);
});

test("community attachments and GalleryContent share explicit localized lightbox wiring", () => {
  const attachments = readFileSync(sourceFiles.attachments, "utf8");
  const gallery = readFileSync(sourceFiles.gallery, "utf8");
  const lesson = readFileSync(sourceFiles.lesson, "utf8");
  const builder = readFileSync(sourceFiles.builder, "utf8");
  const preview = readFileSync(sourceFiles.preview, "utf8");
  const communityPage = readFileSync(sourceFiles.communityPage, "utf8");

  assert.match(attachments, /locale: AppLocale/);
  assert.doesNotMatch(
    attachments,
    /locale\?: AppLocale|locale\s*=\s*DEFAULT_LOCALE/,
  );
  assert.match(attachments, /<ImageLightbox/);
  assert.match(attachments, /href=\{attachment\.downloadHref\}/);
  assert.match(attachments, /alt: attachment\.name/);

  assert.match(gallery, /export function GalleryContent/);
  assert.match(gallery, /locale: AppLocale/);
  assert.match(gallery, /<ImageLightbox/);
  assert.match(gallery, /caption: item\.caption/);
  const galleryComponent = gallery.slice(
    gallery.indexOf("export function GalleryContent"),
    gallery.indexOf("export function StructuredBlockContent"),
  );
  assert.deepEqual(
    actionableJsxText(galleryComponent, sourceFiles.gallery),
    [],
  );

  for (const [name, source] of Object.entries({ lesson, builder, preview })) {
    const calls = source.match(/<GalleryContent[\s\S]{0,180}?>/g) ?? [];
    assert.ok(calls.length > 0, `${name} must render GalleryContent`);
    for (const call of calls) assert.match(call, /locale=\{locale\}/, name);
  }

  assert.match(communityPage, /export async function generateMetadata/);
  assert.match(communityPage, /resolveUserLocale\(user\)/);
  assert.match(
    communityPage,
    /getMainPageDictionary\(locale\)\.admin\.headers\.community\.title/,
  );
  assert.doesNotMatch(communityPage, /export const metadata/);

  const sentinelAlt = "AUTHOR_ALT_SENTINEL";
  const sentinelCaption = "AUTHOR_CAPTION_SENTINEL";
  const copy = getImageLightboxCopy("fr");
  const markup = renderToStaticMarkup(
    createElement(GalleryContent, {
      locale: "fr",
      document: {
        version: 1,
        layout: "grid",
        items: [
          {
            source: "/images/courses/foundations.webp",
            alt: sentinelAlt,
            caption: sentinelCaption,
          },
        ],
      },
    }),
  );
  const escapedGalleryLabel = copy.galleryLabel.replaceAll("'", "&#x27;");
  const escapedOpenLabel = copy
    .openImage(sentinelAlt)
    .replaceAll("'", "&#x27;");
  assert.ok(markup.includes(`aria-label="${escapedGalleryLabel}"`));
  assert.ok(markup.includes(`aria-label="${escapedOpenLabel}"`));
  assert.match(markup, new RegExp(sentinelCaption));
});
