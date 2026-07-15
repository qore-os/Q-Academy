import assert from "node:assert/strict";
import test from "node:test";

import {
  isAutomaticPointBadgeSource,
  selectVisibleCommunityBadges,
} from "../src/lib/community-badge-policy";

const base = {
  userId: "member-a",
  description: "Auszeichnung",
  icon: "award",
  color: "#d6a536",
  groupName: "Umsatz",
  groupDisplayMode: "highest" as const,
  groupSortOrder: 0,
};

test("badge groups show either every award or only the configured highest award", () => {
  const visible = selectVisibleCommunityBadges([
    { ...base, id: "gold", name: "Gold", groupId: "revenue", badgeSortOrder: 1 },
    { ...base, id: "silver", name: "Silber", groupId: "revenue", badgeSortOrder: 2 },
    {
      ...base,
      id: "community",
      name: "Community",
      groupId: "engagement",
      groupName: "Engagement",
      groupDisplayMode: "all",
      groupSortOrder: 1,
      badgeSortOrder: 0,
    },
    {
      ...base,
      id: "standalone",
      name: "Sonderpreis",
      groupId: null,
      groupName: null,
      groupDisplayMode: null,
      groupSortOrder: null,
      badgeSortOrder: 0,
    },
  ]);
  assert.deepEqual(
    visible.get("member-a")?.map((badge) => badge.id),
    ["gold", "community", "standalone"],
  );
});

test("badge visibility is resolved independently for every member", () => {
  const visible = selectVisibleCommunityBadges([
    { ...base, userId: "a", id: "a-gold", name: "Gold", groupId: "revenue", badgeSortOrder: 0 },
    { ...base, userId: "b", id: "b-gold", name: "Gold", groupId: "revenue", badgeSortOrder: 0 },
  ]);
  assert.deepEqual(visible.get("a")?.map((badge) => badge.id), ["a-gold"]);
  assert.deepEqual(visible.get("b")?.map((badge) => badge.id), ["b-gold"]);
});

test("only numeric points sources are protected as automatic provenance", () => {
  assert.equal(isAutomaticPointBadgeSource("points:10"), true);
  assert.equal(isAutomaticPointBadgeSource("points:0"), true);
  assert.equal(isAutomaticPointBadgeSource("points:manual"), false);
  assert.equal(isAutomaticPointBadgeSource("manual:owner"), false);
  assert.equal(isAutomaticPointBadgeSource(null), false);
});
