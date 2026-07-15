import assert from "node:assert/strict";
import test from "node:test";

import { openApiDocument } from "../src/lib/api/openapi";
import {
  commentReactionActorQuerySchema,
  commentReactionUpdateSchema,
} from "../src/lib/api/schemas";

const memberId = "10000000-0000-4000-8000-000000000001";

type Schema = {
  additionalProperties?: boolean;
  required?: readonly string[];
  properties?: Record<string, unknown>;
};

function operation(method: "get" | "put" | "delete") {
  const path = "/community/comments/{id}/reactions";
  const value = openApiDocument.paths[path]?.[method];
  assert.ok(value, `${method.toUpperCase()} ${path} is not documented.`);
  return value;
}

function schema(name: string) {
  const value = openApiDocument.components.schemas[name] as Schema | undefined;
  assert.ok(value, `${name} schema is not documented.`);
  return value;
}

test("comment reaction inputs allow only the four reaction types and optional act-as member", () => {
  for (const reaction of [
    "like",
    "celebrate",
    "insightful",
    "question",
  ] as const) {
    assert.deepEqual(commentReactionUpdateSchema.parse({ reaction }), {
      reaction,
    });
    assert.deepEqual(
      commentReactionUpdateSchema.parse({ reaction, userId: memberId }),
      { reaction, userId: memberId },
    );
  }

  assert.equal(
    commentReactionUpdateSchema.safeParse({ reaction: "dislike" }).success,
    false,
  );
  assert.equal(
    commentReactionUpdateSchema.safeParse({
      reaction: "like",
      actorId: memberId,
    }).success,
    false,
  );
  assert.deepEqual(commentReactionActorQuerySchema.parse({}), {});
  assert.deepEqual(
    commentReactionActorQuerySchema.parse({ userId: memberId }),
    { userId: memberId },
  );
  assert.equal(
    commentReactionActorQuerySchema.safeParse({ userId: "not-a-uuid" })
      .success,
    false,
  );
});

test("comment reaction OpenAPI operations publish scopes, replay policy and act-as input", () => {
  assert.deepEqual(operation("get")["x-required-scopes"], [
    "community:read",
  ]);
  assert.deepEqual(operation("put")["x-required-scopes"], [
    "community:write",
  ]);
  assert.deepEqual(operation("delete")["x-required-scopes"], [
    "community:write",
  ]);

  assert.match(
    JSON.stringify(operation("get").responses["200"]),
    /CommunityCommentReactionSummary/,
  );
  assert.match(
    JSON.stringify(operation("put").requestBody),
    /CommentReactionUpdate/,
  );
  for (const method of ["put", "delete"] as const) {
    assert.match(
      JSON.stringify(operation(method).parameters),
      /IdempotencyKey/,
    );
    assert.match(
      JSON.stringify(operation(method).responses["200"]),
      /CommunityCommentReactionMutation/,
    );
  }

  for (const method of ["get", "delete"] as const) {
    assert.match(JSON.stringify(operation(method).parameters), /userId/);
  }
});

test("comment reaction OpenAPI response DTOs are closed and count every type", () => {
  const summary = schema("CommunityCommentReactionSummary");
  assert.equal(summary.additionalProperties, false);
  assert.deepEqual(summary.required, [
    "commentId",
    "userId",
    "myReaction",
    "counts",
  ]);
  const counts = summary.properties?.counts as Schema;
  assert.equal(counts.additionalProperties, false);
  assert.deepEqual(counts.required, [
    "like",
    "celebrate",
    "insightful",
    "question",
    "total",
  ]);

  const mutation = schema("CommunityCommentReactionMutation");
  assert.equal(mutation.additionalProperties, false);
  assert.deepEqual(mutation.required, ["commentId", "userId", "reaction"]);
});
