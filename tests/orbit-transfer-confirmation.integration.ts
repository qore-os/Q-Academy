import assert from "node:assert/strict";
import test from "node:test";

import { orbitTransferExecutionSchema } from "../src/lib/orbit/schemas";
import { orbitTransferConfirmationMatches } from "../src/lib/orbit/transfer-contract";
import { createOrbitTransferPreflightToken } from "../src/lib/orbit/transfer-preflight";

const request = {
  sourceOrganizationId: "11111111-1111-4111-8111-111111111111",
  targetOrganizationId: "22222222-2222-4222-8222-222222222222",
  sourceCourseIds: ["33333333-3333-4333-8333-333333333333"],
};
const sourceAuthorId = "88888888-8888-4888-8888-888888888888";
const targetAuthorId = "99999999-9999-4999-8999-999999999999";
const authorMappings = [
  { sourceUserId: sourceAuthorId, targetUserId: targetAuthorId },
];

function state(warnings: string[] = ["tenant_dependency_removed"]) {
  return {
    canonicalRequest: JSON.stringify({
      workspaceId: "44444444-4444-4444-8444-444444444444",
      ...request,
    }),
    actorAccountId: "55555555-5555-4555-8555-555555555555",
    targetOwnerId: "66666666-6666-4666-8666-666666666666",
    preflight: {
      sourceCourseCount: 1,
      targetCourseCount: 0,
      targetCourseLimit: 10,
      mediaAssetCount: 0,
      mediaBytes: 0,
      warnings,
      authorMappings,
    },
    sourceVersions: [
      {
        courseId: request.sourceCourseIds[0]!,
        versionId: "77777777-7777-4777-8777-777777777777",
        snapshot: { schemaVersion: 6, tenantDependency: true },
      },
    ],
    mediaAssets: [],
    authorState: {
      sourceAuthors: [
        {
          sourceUserId: sourceAuthorId,
          email: "trainer@example.com",
          role: "trainer",
          status: "active",
          courseIds: request.sourceCourseIds,
          courseAuthorCourseIds: request.sourceCourseIds,
        },
      ],
      targetAuthors: [
        {
          targetUserId: targetAuthorId,
          email: "trainer@example.com",
          role: "trainer",
          status: "active",
        },
      ],
      authorMappings,
    },
  };
}

test("preflight confirmation authorizes only the same execution state and warnings", () => {
  const initialState = state();
  const confirmationToken = createOrbitTransferPreflightToken(initialState);
  const execution = orbitTransferExecutionSchema.parse({
    ...request,
    authorMappings,
    confirmationToken,
    acceptedWarnings: ["tenant_dependency_removed"],
  });
  assert.equal(
    orbitTransferConfirmationMatches({
      expectedToken: createOrbitTransferPreflightToken(initialState),
      confirmationToken: execution.confirmationToken,
      requiredWarnings: ["tenant_dependency_removed"],
      acceptedWarnings: execution.acceptedWarnings,
    }),
    true,
  );

  const changedState = state();
  changedState.authorState.targetAuthors[0]!.status = "disabled";
  assert.equal(
    orbitTransferConfirmationMatches({
      expectedToken: createOrbitTransferPreflightToken(changedState),
      confirmationToken: execution.confirmationToken,
      requiredWarnings: ["tenant_dependency_removed"],
      acceptedWarnings: execution.acceptedWarnings,
    }),
    false,
  );
});
