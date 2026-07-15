import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  announcementContentDocumentSchema,
  announcementContentFromLegacy,
  announcementContentToLegacyProjection,
  normalizeAnnouncementContent,
  personalizeAnnouncementContent,
  safeAnnouncementHref,
} from "../src/lib/announcement-content";
import { announcementCreateSchema } from "../src/lib/api/schemas";

const firstId = "00000000-0000-4000-8000-000000000011";
const secondId = "00000000-0000-4000-8000-000000000012";

function document() {
  return {
    version: 1 as const,
    blocks: [
      {
        id: firstId,
        type: "rich_text" as const,
        document: {
          version: 1 as const,
          blocks: [
            {
              type: "paragraph" as const,
              children: [
                { type: "text" as const, text: "Hallo {{member.firstName}}" },
                {
                  type: "link" as const,
                  href: "javascript:alert(1)",
                  children: [{ type: "text" as const, text: " unsicher" }],
                },
              ],
            },
          ],
        },
      },
      {
        id: secondId,
        type: "cta" as const,
        label: "Kurs fuer {{member.firstName}}",
        href: "/academy/courses",
        style: "primary" as const,
      },
    ],
  };
}

test("announcement content parses ordered typed blocks and sanitizes rich links", () => {
  const parsed = announcementContentDocumentSchema.safeParse(document());
  assert.equal(parsed.success, true);
  if (!parsed.success) return;
  assert.deepEqual(parsed.data.blocks.map((block) => block.id), [firstId, secondId]);
  const rich = parsed.data.blocks[0];
  assert.equal(rich?.type, "rich_text");
  if (rich?.type !== "rich_text") return;
  assert.equal(JSON.stringify(rich.document).includes("javascript:"), false);
  assert.equal(announcementContentToLegacyProjection(parsed.data).body, "Hallo {{member.firstName}} unsicher");
});

test("announcement content rejects duplicate IDs, unsafe CTA targets and oversize JSON", () => {
  const duplicate = document();
  duplicate.blocks[1]!.id = firstId;
  assert.equal(announcementContentDocumentSchema.safeParse(duplicate).success, false);

  const unsafe = document();
  unsafe.blocks[1]!.href = "https://user:password@example.test/private";
  assert.equal(announcementContentDocumentSchema.safeParse(unsafe).success, false);
  assert.equal(safeAnnouncementHref("javascript:alert(1)"), null);
  assert.equal(safeAnnouncementHref("//example.test/path"), null);

  const oversized = {
    version: 1,
    blocks: [
      {
        id: firstId,
        type: "rich_text",
        document: {
          version: 1,
          blocks: [
            {
              type: "paragraph",
              children: [{ type: "text", text: "x".repeat(31_000) }],
            },
          ],
        },
      },
    ],
  };
  assert.equal(announcementContentDocumentSchema.safeParse(oversized).success, false);
});

test("legacy fields normalize into blocks and retain their API projection", () => {
  const legacy = announcementContentFromLegacy({
    body: "Bestehende Nachricht",
    href: "https://example.test/guide",
    actionLabel: "Guide oeffnen",
  });
  assert.deepEqual(announcementContentToLegacyProjection(legacy), {
    body: "Bestehende Nachricht",
    href: "https://example.test/guide",
    actionLabel: "Guide oeffnen",
  });
  assert.deepEqual(
    normalizeAnnouncementContent({
      contentDocument: { version: 1, blocks: [] },
      body: "Bestehende Nachricht",
      href: null,
      actionLabel: null,
    }).blocks.map((block) => block.type),
    ["rich_text"],
  );
});

test("REST creation accepts either the block document or legacy body", () => {
  assert.equal(
    announcementCreateSchema.safeParse({
      title: "Block API",
      contentDocument: document(),
    }).success,
    true,
  );
  assert.equal(
    announcementCreateSchema.safeParse({
      title: "Legacy API",
      body: "Legacy Nachricht",
    }).success,
    true,
  );
  assert.equal(
    announcementCreateSchema.safeParse({ title: "Ohne Inhalt" }).success,
    false,
  );
});

test("personalization resolves text but never interpolates link destinations", () => {
  const parsed = announcementContentDocumentSchema.parse(document());
  const personalized = personalizeAnnouncementContent(parsed, {
    "member.firstName": "Ada",
  });
  assert.deepEqual(announcementContentToLegacyProjection(personalized), {
    body: "Hallo Ada unsicher",
    href: "/academy/courses",
    actionLabel: "Kurs fuer Ada",
  });
});

test("announcement block persistence, API and privacy contracts stay wired", () => {
  const schema = readFileSync("src/db/schema.ts", "utf8");
  const actions = readFileSync("src/lib/announcement-actions.ts", "utf8");
  const createRoute = readFileSync("src/app/api/v1/announcements/route.ts", "utf8");
  const updateRoute = readFileSync("src/app/api/v1/announcements/[id]/route.ts", "utf8");
  const openapi = readFileSync("src/lib/api/openapi.ts", "utf8");
  const privacy = readFileSync("src/lib/privacy/data-inventory.ts", "utf8");
  const manager = readFileSync("src/components/admin/announcement-manager.tsx", "utf8");
  const learner = readFileSync("src/components/academy/announcement-layer.tsx", "utf8");

  assert.match(schema, /contentDocument: jsonb\("content_document"\)/);
  assert.match(schema, /announcements_content_document_check/);
  assert.match(schema, /octet_length\(\$\{table\.contentDocument\}::text\) <= 30000/);
  assert.match(actions, /announcementContentToLegacyProjection/);
  assert.match(
    createRoute,
    /input\.contentDocument \?\?[\s\S]*announcementContentFromLegacy/,
  );
  assert.match(updateRoute, /legacyContentChanged/);
  assert.match(openapi, /AnnouncementContentDocument/);
  assert.match(privacy, /"content_document"/);
  assert.match(manager, /AnnouncementBlockEditor/);
  assert.match(learner, /AnnouncementContentView/);
});
