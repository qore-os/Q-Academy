import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  contentBlockStyleSchema,
  lessonPageCommandSchema,
  pageStyleSchema,
} from "@/lib/content-style-model";
import {
  collapseEditorPresences,
  editorPresenceHeartbeatSchema,
  presenceExpiry,
} from "@/lib/editor-presence-model";
import {
  safeStockImageResponseUrl,
  stockImageProviderConfiguration,
  validatedStockImageProviderItem,
  type StockImageProviderConfiguration,
} from "@/lib/stock-image-model";
import { openApiDocument } from "@/lib/api/openapi";

const configuration: StockImageProviderConfiguration = {
  enabled: true,
  provider: "Example Stock",
  baseUrl: new URL("https://api.stock.test/v1/"),
  apiKey: "server-secret",
  allowedHosts: new Set(["api.stock.test", "cdn.stock.test"]),
};

const image = {
  id: "photo-1",
  previewUrl: "https://cdn.stock.test/preview/photo-1.jpg",
  imageUrl: "https://cdn.stock.test/full/photo-1.jpg",
  width: 1600,
  height: 900,
  alt: "Team am Whiteboard",
  author: "Ada Example",
  authorUrl: "https://api.stock.test/authors/ada",
  sourceUrl: "https://api.stock.test/photos/photo-1",
  downloadTrackingUrl: "https://api.stock.test/track/photo-1",
  attribution: "Photo by Ada Example",
};

test("authoring styles and page commands accept only the explicit safe model", () => {
  assert.equal(
    pageStyleSchema.safeParse({
      layoutWidth: "wide",
      backgroundTone: "soft",
      contentSpacing: "spacious",
    }).success,
    true,
  );
  assert.equal(
    pageStyleSchema.safeParse({
      layoutWidth: "wide;position:fixed",
      backgroundTone: "soft",
      contentSpacing: "spacious",
    }).success,
    false,
  );
  assert.equal(
    contentBlockStyleSchema.safeParse({
      width: "content",
      alignment: "center",
      surface: "bordered",
      css: "position:fixed",
    }).success,
    false,
  );
  assert.equal(
    lessonPageCommandSchema.safeParse({ command: "duplicate", revision: 3 })
      .success,
    true,
  );
  assert.equal(
    lessonPageCommandSchema.safeParse({ command: "delete", revision: 3 })
      .success,
    false,
  );
});

test("editor presence is location-only, short lived, and collapsed by user", () => {
  const input = editorPresenceHeartbeatSchema.parse({
    clientId: "10000000-0000-4000-8000-000000000001",
    lessonId: null,
    pageId: null,
  });
  assert.deepEqual(Object.keys(input).sort(), [
    "clientId",
    "leave",
    "lessonId",
    "pageId",
  ]);
  assert.equal(
    editorPresenceHeartbeatSchema.safeParse({
      clientId: "10000000-0000-4000-8000-000000000001",
      lessonId: null,
      pageId: "20000000-0000-4000-8000-000000000002",
    }).success,
    false,
  );
  const now = new Date("2026-07-12T10:00:00.000Z");
  assert.equal(presenceExpiry(now).getTime() - now.getTime(), 75_000);
  assert.equal(
    collapseEditorPresences([
      {
        userId: "u1",
        displayName: "Ada",
        avatarUrl: null,
        lessonId: null,
        pageId: null,
        expiresAt: "2026-07-12T10:00:30.000Z",
      },
      {
        userId: "u1",
        displayName: "Ada",
        avatarUrl: null,
        lessonId: "lesson",
        pageId: null,
        expiresAt: "2026-07-12T10:01:00.000Z",
      },
    ]).length,
    1,
  );
});

test("stock configuration is disabled cleanly and response hosts are exact", () => {
  assert.deepEqual(stockImageProviderConfiguration({}), {
    enabled: false,
    reason: "not_configured",
  });
  assert.equal(
    stockImageProviderConfiguration({
      STOCK_IMAGE_PROVIDER_NAME: "Partial",
    }).enabled,
    false,
  );
  assert.equal(
    stockImageProviderConfiguration({
      STOCK_IMAGE_PROVIDER_NAME: "Example",
      STOCK_IMAGE_PROVIDER_BASE_URL: "http://api.stock.test/v1",
      STOCK_IMAGE_PROVIDER_API_KEY: "secret",
      STOCK_IMAGE_ALLOWED_HOSTS: "api.stock.test",
    }).enabled,
    false,
  );
  assert.equal(
    safeStockImageResponseUrl(
      "https://cdn.stock.test/image.jpg",
      configuration.allowedHosts,
    ),
    "https://cdn.stock.test/image.jpg",
  );
  assert.equal(
    safeStockImageResponseUrl(
      "https://cdn.stock.test.attacker.example/image.jpg",
      configuration.allowedHosts,
    ),
    null,
  );
});

test("stock provider items require a complete safe response-host contract", () => {
  assert.equal(
    validatedStockImageProviderItem(image, configuration.allowedHosts)?.id,
    "photo-1",
  );
  assert.equal(
    validatedStockImageProviderItem(
      { ...image, imageUrl: "https://localhost/internal" },
      configuration.allowedHosts,
    ),
    null,
  );
  assert.equal(
    validatedStockImageProviderItem(
      { ...image, downloadTrackingUrl: "https://attacker.example/track" },
      configuration.allowedHosts,
    ),
    null,
  );
});

test("authoring APIs, permission checks, CAS, cleanup, and privacy wiring are explicit", () => {
  assert.equal(
    openApiDocument.paths["/courses/{id}/editor-presence"]?.get?.operationId,
    "listCourseEditorPresence",
  );
  assert.equal(
    openApiDocument.paths["/media-assets/stock-images"]?.post?.operationId,
    "selectStockImage",
  );
  const pageDelete = openApiDocument.paths["/pages/{id}"]?.delete;
  assert.equal(
    pageDelete?.parameters?.some(
      (parameter) =>
        (parameter as { name?: string }).name === "If-Match",
    ),
    true,
  );
  const presence = readFileSync(
    new URL("../src/lib/editor-presence-service.ts", import.meta.url),
    "utf8",
  );
  assert.match(presence, /requireCoursePermissionInTransaction/);
  assert.match(presence, /editorPresences\.expiresAt/);
  const actions = readFileSync(
    new URL("../src/lib/course-builder-actions.ts", import.meta.url),
    "utf8",
  );
  assert.match(actions, /expectedRevision/);
  assert.match(actions, /consumeStockImageSelection/);
  const retention = readFileSync(
    new URL("../src/lib/authoring-retention.ts", import.meta.url),
    "utf8",
  );
  assert.match(retention, /stockImageSelections\.expiresAt/);
  const provider = readFileSync(
    new URL("../src/lib/stock-image-provider.ts", import.meta.url),
    "utf8",
  );
  assert.match(provider, /isPublicUnicastWebAddress/);
  assert.match(provider, /lookup:/);
  assert.match(provider, /downloadTrackingUrl/);
  const privacy = readFileSync(
    new URL("../src/lib/privacy/pending-schema-inventory.ts", import.meta.url),
    "utf8",
  );
  assert.match(privacy, /editor_presences/);
  assert.match(privacy, /stock_image_selections/);
  const dsar = readFileSync(
    new URL("../scripts/export-user-data.ts", import.meta.url),
    "utf8",
  );
  assert.match(dsar, /activeEditorPresence/);
  assert.match(dsar, /stockImageSelections/);
  const erasure = readFileSync(
    new URL("../src/lib/privacy/erasure-executor.ts", import.meta.url),
    "utf8",
  );
  assert.match(erasure, /delete from editor_presences/);
  assert.match(erasure, /delete from stock_image_selections/);
});
