import assert from "node:assert/strict";
import test from "node:test";
import {
  canEditCustomField,
  canViewCustomField,
} from "../src/lib/data-profile-policy";
import { dataProfileMutationLockKey } from "../src/lib/data-profile-lock";

const subjectUserId = "00000000-0000-4000-8000-000000000001";
const otherUserId = "00000000-0000-4000-8000-000000000002";

test("member sees and edits only own member-visible fields", () => {
  assert.equal(
    canViewCustomField({
      viewerRole: "member",
      viewerId: subjectUserId,
      subjectUserId,
      visibility: "member",
    }),
    true,
  );
  assert.equal(
    canEditCustomField({
      viewerRole: "member",
      viewerId: subjectUserId,
      subjectUserId,
      visibility: "trainer",
    }),
    false,
  );
  assert.equal(
    canViewCustomField({
      viewerRole: "member",
      viewerId: otherUserId,
      subjectUserId,
      visibility: "member",
    }),
    false,
  );
});

test("trainer and admin visibility levels are monotonic", () => {
  for (const visibility of ["member", "trainer"] as const) {
    assert.equal(
      canViewCustomField({
        viewerRole: "trainer",
        viewerId: otherUserId,
        subjectUserId,
        visibility,
      }),
      true,
    );
  }
  assert.equal(
    canViewCustomField({
      viewerRole: "trainer",
      viewerId: otherUserId,
      subjectUserId,
      visibility: "admin",
    }),
    false,
  );
  for (const role of ["admin", "owner"] as const) {
    assert.equal(
      canEditCustomField({
        viewerRole: role,
        viewerId: otherUserId,
        subjectUserId,
        visibility: "admin",
      }),
      true,
    );
  }
});

test("mutation lock keys isolate both tenant and member", () => {
  const tenantA = "00000000-0000-4000-8000-000000000010";
  const tenantB = "00000000-0000-4000-8000-000000000011";
  assert.equal(
    dataProfileMutationLockKey(tenantA, subjectUserId),
    dataProfileMutationLockKey(tenantA, subjectUserId),
  );
  assert.notEqual(
    dataProfileMutationLockKey(tenantA, subjectUserId),
    dataProfileMutationLockKey(tenantA, otherUserId),
  );
  assert.notEqual(
    dataProfileMutationLockKey(tenantA, subjectUserId),
    dataProfileMutationLockKey(tenantB, subjectUserId),
  );
});
