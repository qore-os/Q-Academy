import assert from "node:assert/strict";
import test from "node:test";

import type { CourseVersionSnapshot } from "../src/db/schema";
import {
  OrbitTransferSourceAuthorError,
  extractOrbitTransferSourceAttributions,
  resolveOrbitTransferAuthorMappings,
} from "../src/lib/orbit/transfer-authors";

const sourceOrganizationId = "11111111-1111-4111-8111-111111111111";
const sourceCourseId = "22222222-2222-4222-8222-222222222222";
const sourceUserId = "33333333-3333-4333-8333-333333333333";
const secondSourceUserId = "44444444-4444-4444-8444-444444444444";
const targetUserId = "55555555-5555-4555-8555-555555555555";
const secondTargetUserId = "66666666-6666-4666-8666-666666666666";

function profile(id: string, firstName = "Alex") {
  return {
    id,
    firstName,
    lastName: "Author",
    avatarUrl: null,
    jobTitle: null,
    bio: null,
  };
}

function user(input: {
  id: string;
  email: string;
  role?: "owner" | "admin" | "trainer" | "member";
  status?: "active" | "invited" | "disabled";
}) {
  return {
    id: input.id,
    email: input.email,
    firstName: "Target",
    lastName: "Author",
    avatarUrl: null,
    jobTitle: null,
    bio: null,
    role: input.role ?? ("trainer" as const),
    status: input.status ?? ("active" as const),
  };
}

function snapshot() {
  return {
    authors: [
      {
        id: "77777777-7777-4777-8777-777777777777",
        organizationId: sourceOrganizationId,
        courseId: sourceCourseId,
        userId: sourceUserId,
        author: profile(sourceUserId),
      },
    ],
    widgets: [
      {
        id: "88888888-8888-4888-8888-888888888888",
        organizationId: sourceOrganizationId,
        courseId: sourceCourseId,
        type: "author",
        authorUserId: secondSourceUserId,
        author: profile(secondSourceUserId, "Sam"),
      },
    ],
  } as unknown as CourseVersionSnapshot;
}

test("source attribution includes course authors and author widgets and rejects mismatches", () => {
  const authors = extractOrbitTransferSourceAttributions([
    {
      courseId: sourceCourseId,
      organizationId: sourceOrganizationId,
      snapshot: snapshot(),
    },
  ]);
  assert.deepEqual(
    authors.map((author) => author.sourceUserId),
    [sourceUserId, secondSourceUserId],
  );
  assert.deepEqual(authors[0]?.courseAuthorCourseIds, [sourceCourseId]);
  assert.deepEqual(authors[1]?.courseAuthorCourseIds, []);

  const invalid = snapshot();
  invalid.widgets![0]!.author!.id = targetUserId;
  assert.throws(
    () =>
      extractOrbitTransferSourceAttributions([
        {
          courseId: sourceCourseId,
          organizationId: sourceOrganizationId,
          snapshot: invalid,
        },
      ]),
    OrbitTransferSourceAuthorError,
  );
});

test("only a unique normalized email match is automatic", () => {
  const attributions = [
    {
      sourceUserId,
      courseIds: [sourceCourseId],
      courseAuthorCourseIds: [sourceCourseId],
      profile: profile(sourceUserId),
    },
  ];
  const unique = resolveOrbitTransferAuthorMappings({
    attributions,
    sourceUsers: [user({ id: sourceUserId, email: " Author@Example.com " })],
    targetUsers: [user({ id: targetUserId, email: "author@example.com" })],
  });
  assert.equal(unique.ok, true);
  if (!unique.ok) return;
  assert.equal(unique.complete, true);
  assert.deepEqual(unique.authorMappings, [{ sourceUserId, targetUserId }]);
  assert.equal(unique.sourceAuthors[0]?.automaticTargetUserId, targetUserId);

  const ambiguous = resolveOrbitTransferAuthorMappings({
    attributions,
    sourceUsers: [user({ id: sourceUserId, email: "author@example.com" })],
    targetUsers: [
      user({ id: targetUserId, email: "Author@example.com" }),
      user({ id: secondTargetUserId, email: "author@example.com" }),
    ],
  });
  assert.equal(ambiguous.ok, true);
  if (!ambiguous.ok) return;
  assert.equal(ambiguous.complete, false);
  assert.deepEqual(ambiguous.authorMappings, []);
});

test("mapping rejects ineligible targets and duplicate course-author targets", () => {
  const attribution = {
    sourceUserId,
    courseIds: [sourceCourseId],
    courseAuthorCourseIds: [sourceCourseId],
    profile: profile(sourceUserId),
  };
  assert.deepEqual(
    resolveOrbitTransferAuthorMappings({
      attributions: [attribution],
      sourceUsers: [],
      targetUsers: [
        user({
          id: targetUserId,
          email: "member@example.com",
          role: "member",
        }),
      ],
      requestedMappings: [{ sourceUserId, targetUserId }],
    }),
    { ok: false, reason: "ineligible_target" },
  );

  const collision = resolveOrbitTransferAuthorMappings({
    attributions: [
      attribution,
      {
        sourceUserId: secondSourceUserId,
        courseIds: [sourceCourseId],
        courseAuthorCourseIds: [sourceCourseId],
        profile: profile(secondSourceUserId),
      },
    ],
    sourceUsers: [],
    targetUsers: [user({ id: targetUserId, email: "target@example.com" })],
    requestedMappings: [
      { sourceUserId, targetUserId },
      { sourceUserId: secondSourceUserId, targetUserId },
    ],
  });
  assert.deepEqual(collision, { ok: false, reason: "course_author_collision" });

  const widgetOnly = resolveOrbitTransferAuthorMappings({
    attributions: [
      { ...attribution, courseAuthorCourseIds: [] },
      {
        sourceUserId: secondSourceUserId,
        courseIds: [sourceCourseId],
        courseAuthorCourseIds: [],
        profile: profile(secondSourceUserId),
      },
    ],
    sourceUsers: [],
    targetUsers: [user({ id: targetUserId, email: "target@example.com" })],
    requestedMappings: [
      { sourceUserId, targetUserId },
      { sourceUserId: secondSourceUserId, targetUserId },
    ],
  });
  assert.equal(widgetOnly.ok, true);
  if (widgetOnly.ok) assert.equal(widgetOnly.complete, true);
});
