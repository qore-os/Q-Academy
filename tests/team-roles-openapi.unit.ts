import assert from "node:assert/strict";
import test from "node:test";
import { openApiDocument } from "@/lib/api/openapi";
import {
  apiScopeIsGranted,
  DELEGABLE_API_SCOPES,
  isOwnerBoundApiScope,
} from "@/lib/api/scopes";

test("OpenAPI publishes owner-bound team-role CRUD and assignment operations", () => {
  const collection = openApiDocument.paths["/team-roles"];
  const item = openApiDocument.paths["/team-roles/{id}"];
  const assignments = openApiDocument.paths["/team-roles/{id}/assignments"];
  const assignment =
    openApiDocument.paths["/team-roles/{id}/assignments/{userId}"];

  assert.equal(collection?.get?.operationId, "listTeamRoles");
  assert.deepEqual(collection?.post?.["x-required-scopes"], ["team_roles:write"]);
  assert.equal(item?.patch?.operationId, "updateTeamRole");
  assert.equal(assignments?.post?.operationId, "assignTeamRole");
  assert.equal(assignment?.delete?.operationId, "unassignTeamRole");
  assert.ok(openApiDocument.components.schemas.TeamRoleCreate);
  assert.ok(openApiDocument.components.schemas.TeamRoleUpdate);
  assert.ok(openApiDocument.components.schemas.TeamRoleAssignment);
});

test("wildcard and delegated keys never receive team-role scopes", () => {
  const delegableScopes: readonly string[] = DELEGABLE_API_SCOPES;
  for (const scope of ["team_roles:read", "team_roles:write"] as const) {
    assert.equal(isOwnerBoundApiScope(scope), true);
    assert.equal(delegableScopes.includes(scope), false);
    assert.equal(apiScopeIsGranted(["*"], scope), false);
    assert.equal(apiScopeIsGranted([scope], scope), true);
  }
});
