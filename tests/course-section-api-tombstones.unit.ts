import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { API_TOMBSTONE_OPERATIONS } from "../src/lib/api/openapi-tombstones";

const routeContracts = [
  {
    file: "src/app/api/v1/modules/[id]/sections/route.ts",
    methods: ["GET", "POST"],
    scopes: ["modules:read", "modules:write"],
    goneCalls: 2,
  },
  {
    file: "src/app/api/v1/sections/[id]/route.ts",
    methods: ["GET", "PATCH", "DELETE"],
    scopes: ["modules:read", "modules:write"],
    goneCalls: 3,
  },
  {
    file: "src/app/api/v1/sections/[id]/lessons/route.ts",
    methods: ["GET", "POST"],
    scopes: ["modules:read", "modules:write"],
    goneCalls: 2,
  },
  {
    file: "src/app/api/v1/sections/[id]/lesson-visibility/route.ts",
    methods: ["PATCH", "PUT"],
    scopes: ["modules:write"],
    goneCalls: 1,
  },
] as const;

test("removed course-section routes are authenticated database-free tombstones", async () => {
  for (const contract of routeContracts) {
    const source = await readFile(contract.file, "utf8");
    assert.match(source, /handleApi/);
    assert.match(source, /courseSectionGone/);
    assert.match(source, /export const OPTIONS = apiOptions/);
    assert.doesNotMatch(
      source,
      /@\/db|db\/schema|parseJson|handleTransactionalApiCommand|idempotent|section-lesson-visibility/,
    );
    assert.equal(
      source.match(/throw courseSectionGone\(\)/g)?.length,
      contract.goneCalls,
    );
    for (const method of contract.methods) {
      assert.match(
        source,
        new RegExp(`export (?:async function|const) ${method}\\b`),
      );
    }
    for (const scope of contract.scopes) {
      assert.match(source, new RegExp(`scopes: \\["${scope}"\\]`));
    }
  }
});

test("course-section tombstones expose a stable RFC 9457 migration problem", async () => {
  const [helper, errors, handler] = await Promise.all([
    readFile("src/lib/api/deprecated-course-sections.ts", "utf8"),
    readFile("src/lib/api/errors.ts", "utf8"),
    readFile("src/lib/api/handler.ts", "utf8"),
  ]);
  assert.match(helper, /new ApiError\(\s*410,\s*"gone"/);
  assert.match(helper, /\/api\/v1\/modules\/\{moduleId\}\/lessons/);
  assert.match(helper, /\{ replacement: COURSE_SECTION_REPLACEMENT_PATH \}/);
  assert.match(errors, /\| "gone"/);
  assert.match(handler, /410: "Gone"/);
  assert.match(handler, /"sections"/);
  assert.match(
    handler,
    /"Content-Type", "application\/problem\+json; charset=utf-8"/,
  );
});

test("course-section tombstones stay implemented but undiscoverable in OpenAPI", async () => {
  assert.deepEqual(API_TOMBSTONE_OPERATIONS, [
    "get /modules/{id}/sections",
    "post /modules/{id}/sections",
    "get /sections/{id}",
    "patch /sections/{id}",
    "delete /sections/{id}",
    "get /sections/{id}/lessons",
    "post /sections/{id}/lessons",
    "put /sections/{id}/lesson-visibility",
    "patch /sections/{id}/lesson-visibility",
  ]);

  const [openApi, checker] = await Promise.all([
    readFile("src/lib/api/openapi.ts", "utf8"),
    readFile("scripts/check-openapi.ts", "utf8"),
  ]);
  assert.doesNotMatch(openApi, /paths\["\/modules\/\{id\}\/sections"\]/);
  assert.doesNotMatch(openApi, /paths\["\/sections\/\{id\}/);
  assert.match(checker, /API_TOMBSTONE_OPERATIONS/);
  assert.match(checker, /Missing API tombstones/);
  assert.match(checker, /API tombstones must not be published in OpenAPI/);
});
