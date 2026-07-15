import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { orbitOpenApiDocument } from "../src/lib/orbit/openapi";
import { orbitTransferExecutionSchema } from "../src/lib/orbit/schemas";
import {
  ORBIT_TRANSFER_WARNING_CODES,
  orbitTransferConfirmationMatches,
  orbitTransferWarningsAccepted,
} from "../src/lib/orbit/transfer-contract";
import { createOrbitTransferPreflightToken } from "../src/lib/orbit/transfer-preflight";

const sourceOrganizationId = "11111111-1111-4111-8111-111111111111";
const targetOrganizationId = "22222222-2222-4222-8222-222222222222";
const sourceCourseId = "33333333-3333-4333-8333-333333333333";
const sourceVersionId = "44444444-4444-4444-8444-444444444444";
const sourceAuthorId = "99999999-9999-4999-8999-999999999999";
const targetAuthorId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const authorMappings = [
  { sourceUserId: sourceAuthorId, targetUserId: targetAuthorId },
];

function tokenInput() {
  return {
    canonicalRequest: JSON.stringify({
      workspaceId: "55555555-5555-4555-8555-555555555555",
      sourceOrganizationId,
      targetOrganizationId,
      sourceCourseIds: [sourceCourseId],
    }),
    actorAccountId: "66666666-6666-4666-8666-666666666666",
    targetOwnerId: "77777777-7777-4777-8777-777777777777",
    preflight: {
      sourceCourseCount: 1,
      targetCourseCount: 2,
      targetCourseLimit: 10,
      mediaAssetCount: 1,
      mediaBytes: 1024,
      warnings: ["tenant_dependency_removed"],
      authorMappings,
    },
    sourceVersions: [
      {
        courseId: sourceCourseId,
        versionId: sourceVersionId,
        snapshot: { schemaVersion: 5, course: { title: "Source" } },
      },
    ],
    mediaAssets: [
      {
        id: "88888888-8888-4888-8888-888888888888",
        kind: "video",
        status: "ready",
        storageDriver: "filesystem",
        storageKey: "tenants/source/assets/video.mp4",
        stagingStorageKey: "incoming/tenants/source/assets/video.mp4",
        actualSizeBytes: 1024,
        contentSha256: "a".repeat(64),
        etag: null,
        stagingStorageVersionId: null,
        storageVersionId: null,
      },
    ],
    authorState: {
      sourceAuthors: [
        {
          sourceUserId: sourceAuthorId,
          email: "author@example.com",
          role: "trainer",
          status: "active",
          courseIds: [sourceCourseId],
          courseAuthorCourseIds: [sourceCourseId],
        },
      ],
      targetAuthors: [
        {
          targetUserId: targetAuthorId,
          email: "author@example.com",
          role: "trainer",
          status: "active",
        },
      ],
      authorMappings,
    },
  };
}

test("Orbit transfer warning codes and acknowledgements are stable and exact", () => {
  assert.deepEqual([...ORBIT_TRANSFER_WARNING_CODES], [
    "target_seat_limit_exceeded",
    "external_course_link_neutralized",
    "tenant_dependency_removed",
  ]);
  assert.equal(
    orbitTransferWarningsAccepted(
      ["tenant_dependency_removed", "target_seat_limit_exceeded"],
      ["target_seat_limit_exceeded", "tenant_dependency_removed"],
    ),
    true,
  );
  assert.equal(
    orbitTransferWarningsAccepted(
      ["tenant_dependency_removed", "target_seat_limit_exceeded"],
      ["tenant_dependency_removed"],
    ),
    false,
  );
  assert.equal(
    orbitTransferWarningsAccepted(
      ["tenant_dependency_removed"],
      ["tenant_dependency_removed", "tenant_dependency_removed"],
    ),
    false,
  );
  assert.equal(
    orbitTransferConfirmationMatches({
      expectedToken: "a".repeat(64),
      confirmationToken: "b".repeat(64),
      requiredWarnings: [],
      acceptedWarnings: [],
    }),
    false,
  );
});

test("Orbit preflight tokens bind request, actor, source state and warnings", () => {
  const input = tokenInput();
  const token = createOrbitTransferPreflightToken(input);
  assert.match(token, /^[0-9a-f]{64}$/);
  assert.equal(createOrbitTransferPreflightToken(tokenInput()), token);

  const reorderedSnapshot = tokenInput();
  reorderedSnapshot.sourceVersions[0]!.snapshot = {
    course: { title: "Source" },
    schemaVersion: 5,
  };
  assert.equal(createOrbitTransferPreflightToken(reorderedSnapshot), token);

  const changedSnapshot = tokenInput();
  changedSnapshot.sourceVersions[0]!.snapshot = {
    schemaVersion: 5,
    course: { title: "Changed" },
  };
  assert.notEqual(createOrbitTransferPreflightToken(changedSnapshot), token);

  const changedWarnings = tokenInput();
  changedWarnings.preflight.warnings = ["target_seat_limit_exceeded"];
  assert.notEqual(createOrbitTransferPreflightToken(changedWarnings), token);

  const changedRequest = tokenInput();
  changedRequest.canonicalRequest += " ";
  assert.notEqual(createOrbitTransferPreflightToken(changedRequest), token);

  const changedMapping = tokenInput();
  changedMapping.authorState.authorMappings = [
    {
      sourceUserId: sourceAuthorId,
      targetUserId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    },
  ];
  assert.notEqual(createOrbitTransferPreflightToken(changedMapping), token);

  const changedTargetRole = tokenInput();
  changedTargetRole.authorState.targetAuthors[0]!.role = "member";
  assert.notEqual(createOrbitTransferPreflightToken(changedTargetRole), token);
});

test("Orbit execution schema and OpenAPI require a preflight confirmation", () => {
  const parsed = orbitTransferExecutionSchema.parse({
    sourceOrganizationId,
    targetOrganizationId,
    sourceCourseIds: [sourceCourseId, sourceCourseId],
    authorMappings,
    confirmationToken: "a".repeat(64),
    acceptedWarnings: ["tenant_dependency_removed"],
  });
  assert.deepEqual(parsed.sourceCourseIds, [sourceCourseId]);
  assert.equal(
    orbitTransferExecutionSchema.safeParse({
      sourceOrganizationId,
      targetOrganizationId,
      sourceCourseIds: [sourceCourseId],
      authorMappings,
      acceptedWarnings: [],
    }).success,
    false,
  );
  assert.equal(
    orbitTransferExecutionSchema.safeParse({
      sourceOrganizationId,
      targetOrganizationId,
      sourceCourseIds: [sourceCourseId],
      authorMappings,
      confirmationToken: "a".repeat(64),
      acceptedWarnings: [
        "tenant_dependency_removed",
        "tenant_dependency_removed",
      ],
    }).success,
    false,
  );

  const preflightOperation = orbitOpenApiDocument.paths[
    "/api/orbit/workspaces/{workspaceId}/transfers/preflight"
  ];
  const executeOperation = orbitOpenApiDocument.paths[
    "/api/orbit/workspaces/{workspaceId}/transfers"
  ];
  assert.match(JSON.stringify(preflightOperation), /OrbitTransfer"/);
  assert.doesNotMatch(
    JSON.stringify(preflightOperation),
    /OrbitTransferExecution/,
  );
  assert.match(JSON.stringify(executeOperation), /OrbitTransferExecution/);
  const executionSchema = JSON.stringify(
    orbitOpenApiDocument.components.schemas.OrbitTransferExecution,
  );
  assert.match(executionSchema, /confirmationToken/);
  assert.match(executionSchema, /acceptedWarnings/);
  assert.match(executionSchema, /authorMappings/);
  assert.equal(
    orbitTransferExecutionSchema.safeParse({
      sourceOrganizationId,
      targetOrganizationId,
      sourceCourseIds: [sourceCourseId],
      authorMappings: [authorMappings[0], authorMappings[0]],
      confirmationToken: "a".repeat(64),
      acceptedWarnings: [],
    }).success,
    false,
  );
});

test("Orbit execution validates the current preflight before transfer side effects", () => {
  const transfer = readFileSync("src/lib/orbit/transfer.ts", "utf8");
  const loaded = transfer.indexOf(
    "const preflight = await loadPreflight",
    transfer.indexOf("export async function createOrbitTransfer"),
  );
  const confirmed = transfer.indexOf(
    "orbitTransferConfirmationMatches({",
    loaded,
  );
  const prepared = transfer.indexOf("const courseIdMap", loaded);
  assert.ok(loaded > 0 && confirmed > loaded && prepared > confirmed);
  assert.doesNotMatch(transfer, /author_attribution_removed/);
  assert.match(transfer, /tx\.insert\(courseAuthors\)/);
  assert.match(transfer, /ORBIT_TRANSFER_AUTHOR_ROLES/);
  assert.match(transfer, /authorMappingCount/);

  const executeRoute = readFileSync(
    "src/app/api/orbit/workspaces/[workspaceId]/transfers/route.ts",
    "utf8",
  );
  const preflightRoute = readFileSync(
    "src/app/api/orbit/workspaces/[workspaceId]/transfers/preflight/route.ts",
    "utf8",
  );
  assert.match(executeRoute, /orbitTransferExecutionSchema\.parse/);
  assert.match(preflightRoute, /orbitTransferSchema\.parse/);
  assert.match(executeRoute, /MAX_ORBIT_TRANSFER_REQUEST_BYTES/);
  assert.match(preflightRoute, /MAX_ORBIT_TRANSFER_REQUEST_BYTES/);
});
