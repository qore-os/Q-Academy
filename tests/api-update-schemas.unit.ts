import assert from "node:assert/strict";
import test from "node:test";
import {
  agentUpdateSchema,
  announcementUpdateSchema,
  badgeUpdateSchema,
  bundleUpdateSchema,
  communitySpaceUpdateSchema,
  commentUpdateSchema,
  contentBlockUpdateSchema,
  courseCategoryUpdateSchema,
  courseModuleUpdateSchema,
  courseUpdateSchema,
  customFieldUpdateSchema,
  groupUpdateSchema,
  hubUpdateSchema,
  lessonPageUpdateSchema,
  lessonUpdateSchema,
  moduleUpdateSchema,
  postUpdateSchema,
  webhookUpdateSchema,
} from "@/lib/api/schemas";

const partialUpdateSchemas = [
  agentUpdateSchema,
  announcementUpdateSchema,
  badgeUpdateSchema,
  bundleUpdateSchema,
  communitySpaceUpdateSchema,
  courseCategoryUpdateSchema,
  courseModuleUpdateSchema,
  courseUpdateSchema,
  customFieldUpdateSchema,
  groupUpdateSchema,
  hubUpdateSchema,
  lessonUpdateSchema,
  moduleUpdateSchema,
  webhookUpdateSchema,
] as const;

test("partial update schemas never inject create defaults", () => {
  for (const schema of partialUpdateSchemas) {
    assert.deepEqual(schema.parse({}), {});
  }
});

test("partial update schemas preserve only explicitly supplied fields", () => {
  assert.deepEqual(moduleUpdateSchema.parse({ title: "Neuer Modultitel" }), {
    title: "Neuer Modultitel",
  });
  assert.deepEqual(
    contentBlockUpdateSchema.parse({ revision: 3, required: true }),
    { revision: 3, required: true },
  );
  assert.deepEqual(hubUpdateSchema.parse({ title: "Neuer Hubtitel" }), {
    title: "Neuer Hubtitel",
  });
  assert.deepEqual(
    lessonPageUpdateSchema.parse({ revision: 2, titleSyncedWithLesson: true }),
    { revision: 2, titleSyncedWithLesson: true },
  );
});

test("lesson page updates require a current revision and a real change", () => {
  assert.equal(
    lessonPageUpdateSchema.safeParse({ title: "Neu" }).success,
    false,
  );
  assert.equal(
    lessonPageUpdateSchema.safeParse({ revision: 1 }).success,
    false,
  );
  assert.equal(
    lessonPageUpdateSchema.safeParse({ revision: 1, title: "Neu" }).success,
    true,
  );
});

test("content block updates require a current revision and a real change", () => {
  assert.equal(
    contentBlockUpdateSchema.safeParse({ required: true }).success,
    false,
  );
  assert.equal(
    contentBlockUpdateSchema.safeParse({ revision: 1 }).success,
    false,
  );
  assert.equal(
    contentBlockUpdateSchema.safeParse({ revision: 1, title: "Neu" }).success,
    true,
  );
});

test("community post updates require the current moderation revision", () => {
  assert.equal(postUpdateSchema.safeParse({ content: "Neu" }).success, false);
  assert.deepEqual(
    postUpdateSchema.parse({ expectedContentVersion: 3, content: "Neu" }),
    { expectedContentVersion: 3, content: "Neu" },
  );
  assert.equal(
    commentUpdateSchema.safeParse({ content: "Neue Antwort" }).success,
    false,
  );
  assert.deepEqual(
    commentUpdateSchema.parse({
      expectedContentVersion: 2,
      content: "Neue Antwort",
    }),
    { expectedContentVersion: 2, content: "Neue Antwort" },
  );
});
