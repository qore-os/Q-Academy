import "server-only";

import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";

import { db } from "@/db";
import {
  badgeDefinitions,
  badgeGroups,
  userBadges,
} from "@/db/schema";
import { selectVisibleCommunityBadges } from "@/lib/community-badge-policy";

export type CommunityBadgeView = Readonly<{
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  groupId: string | null;
  groupName: string | null;
}>;

export async function visibleCommunityBadgesForUsers(input: {
  organizationId: string;
  userIds: readonly string[];
}) {
  const userIds = [...new Set(input.userIds)];
  if (!userIds.length) return new Map<string, CommunityBadgeView[]>();
  const rows = await db
    .select({
      userId: userBadges.userId,
      id: badgeDefinitions.id,
      name: badgeDefinitions.name,
      description: badgeDefinitions.description,
      icon: badgeDefinitions.icon,
      color: badgeDefinitions.color,
      groupId: badgeDefinitions.groupId,
      badgeSortOrder: badgeDefinitions.sortOrder,
      groupName: badgeGroups.name,
      groupDisplayMode: badgeGroups.displayMode,
      groupSortOrder: badgeGroups.sortOrder,
    })
    .from(userBadges)
    .innerJoin(
      badgeDefinitions,
      and(
        eq(badgeDefinitions.id, userBadges.badgeId),
        eq(badgeDefinitions.organizationId, userBadges.organizationId),
        eq(badgeDefinitions.active, true),
      ),
    )
    .leftJoin(
      badgeGroups,
      and(
        eq(badgeGroups.id, badgeDefinitions.groupId),
        eq(badgeGroups.organizationId, badgeDefinitions.organizationId),
      ),
    )
    .where(
      and(
        eq(userBadges.organizationId, input.organizationId),
        inArray(userBadges.userId, userIds),
        or(isNull(badgeGroups.id), eq(badgeGroups.active, true)),
      ),
    )
    .orderBy(
      asc(userBadges.userId),
      asc(badgeGroups.sortOrder),
      asc(badgeDefinitions.sortOrder),
      asc(badgeDefinitions.id),
    );
  return selectVisibleCommunityBadges(rows);
}
