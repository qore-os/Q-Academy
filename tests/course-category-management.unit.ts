import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  courseCategoryReorderSchema,
  isExactCourseCategoryOrder,
} from "@/lib/course-category-model";
import { canManageCourseCategories } from "@/lib/course-category-policy";
import { openApiDocument } from "@/lib/api/openapi";

const firstId = "00000000-0000-4000-8000-000000000001";
const secondId = "00000000-0000-4000-8000-000000000002";
const foreignId = "00000000-0000-4000-8000-000000000003";

test("course category reorder accepts only a unique exact tenant order", () => {
  assert.deepEqual(
    courseCategoryReorderSchema.parse({ categoryIds: [secondId, firstId] }),
    { categoryIds: [secondId, firstId] },
  );
  assert.equal(
    courseCategoryReorderSchema.safeParse({
      categoryIds: [firstId, firstId],
    }).success,
    false,
  );
  assert.equal(
    courseCategoryReorderSchema.safeParse({
      categoryIds: [firstId],
      ignored: true,
    }).success,
    false,
  );
  assert.equal(
    isExactCourseCategoryOrder([firstId, secondId], [secondId, firstId]),
    true,
  );
  assert.equal(
    isExactCourseCategoryOrder([firstId, secondId], [firstId]),
    false,
  );
  assert.equal(
    isExactCourseCategoryOrder(
      [firstId, secondId],
      [firstId, foreignId],
    ),
    false,
  );
});

test("course category manager policy fails closed for default trainers and inactive roles", () => {
  assert.equal(
    canManageCourseCategories({
      role: "owner",
      assignmentExists: false,
    }),
    true,
  );
  assert.equal(
    canManageCourseCategories({
      role: "admin",
      assignmentExists: false,
    }),
    true,
  );
  assert.equal(
    canManageCourseCategories({
      role: "trainer",
      assignmentExists: false,
    }),
    false,
  );
  assert.equal(
    canManageCourseCategories({
      role: "trainer",
      assignmentExists: true,
      customRoleActive: true,
      customPermissions: ["courses.view", "courses.manage"],
    }),
    true,
  );
  assert.equal(
    canManageCourseCategories({
      role: "admin",
      assignmentExists: true,
      customRoleActive: true,
      customPermissions: ["courses.view"],
    }),
    false,
  );
  assert.equal(
    canManageCourseCategories({
      role: "trainer",
      assignmentExists: true,
      customRoleActive: false,
      customPermissions: ["courses.manage"],
    }),
    false,
  );
  assert.equal(
    canManageCourseCategories({
      role: "member",
      assignmentExists: true,
      customRoleActive: true,
      customPermissions: ["courses.manage"],
    }),
    false,
  );
});

test("OpenAPI publishes the atomic full-order category contract", () => {
  const operation =
    openApiDocument.paths["/course-categories/reorder"]?.patch;
  assert.ok(operation);
  assert.equal(operation.operationId, "reorderCourseCategories");
  assert.deepEqual(operation["x-required-scopes"], ["courses:write"]);
  assert.match(JSON.stringify(operation.requestBody), /CourseCategoryReorder/);
  assert.match(JSON.stringify(operation.parameters), /IdempotencyKey/);
  const schema = JSON.stringify(
    openApiDocument.components.schemas.CourseCategoryReorder,
  );
  assert.match(schema, /categoryIds/);
  assert.match(schema, /maxItems[^0-9]*1000/);
});

test("API identifier validation recognizes reorder as a static command path", () => {
  const handler = readFileSync(
    path.resolve(process.cwd(), "src/lib/api/handler.ts"),
    "utf8",
  );
  const staticChildren = handler.match(
    /const staticCollectionChildren = new Set\(\[([\s\S]*?)\]\);/,
  )?.[1];
  assert.ok(staticChildren);
  assert.match(staticChildren, /"reorder"/);
});
