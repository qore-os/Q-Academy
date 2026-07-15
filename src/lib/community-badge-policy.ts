export type CommunityBadgePolicyRow = Readonly<{
  userId: string;
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  groupId: string | null;
  groupName: string | null;
  groupDisplayMode: "all" | "highest" | null;
  groupSortOrder: number | null;
  badgeSortOrder: number;
}>;

export function isAutomaticPointBadgeSource(value: string | null) {
  return typeof value === "string" && /^points:[0-9]+$/.test(value);
}

export function selectVisibleCommunityBadges(
  rows: readonly CommunityBadgePolicyRow[],
) {
  const result = new Map<
    string,
    Array<
      Omit<
        CommunityBadgePolicyRow,
        | "userId"
        | "groupDisplayMode"
        | "groupSortOrder"
        | "badgeSortOrder"
      >
    >
  >();
  const highestGroups = new Set<string>();
  const ordered = [...rows].sort(
    (left, right) =>
      left.userId.localeCompare(right.userId) ||
      (left.groupSortOrder ?? 1_000_000) -
        (right.groupSortOrder ?? 1_000_000) ||
      left.badgeSortOrder - right.badgeSortOrder ||
      left.id.localeCompare(right.id),
  );
  for (const row of ordered) {
    const groupKey = row.groupId ? `${row.userId}:${row.groupId}` : null;
    if (
      groupKey &&
      row.groupDisplayMode === "highest" &&
      highestGroups.has(groupKey)
    ) {
      continue;
    }
    if (groupKey && row.groupDisplayMode === "highest") highestGroups.add(groupKey);
    const badges = result.get(row.userId) ?? [];
    badges.push({
      id: row.id,
      name: row.name,
      description: row.description,
      icon: row.icon,
      color: row.color,
      groupId: row.groupId,
      groupName: row.groupName,
    });
    result.set(row.userId, badges);
  }
  return result;
}
