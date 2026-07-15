import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  communityLevels,
  communityLevelSettings,
  users,
} from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import { apiOptions, handleApi } from "@/lib/api/handler";
import { getCommunityPublicProfiles } from "@/lib/community-public-profile";
import { resolveCommunityLevelProgress } from "@/lib/community-level-domain";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

export async function GET(request: Request) {
  return handleApi(request, { scopes: ["community:read"], action: "leaderboard.read", resourceType: "leaderboard" }, async (context) => {
    const limit = Number(new URL(request.url).searchParams.get("limit") ?? 25);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new ApiError(400, "bad_request", "limit muss zwischen 1 und 100 liegen.");
    const [members, settingRows, levelRows] = await Promise.all([
      db
        .select({
          id: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
          communityPoints: users.communityPoints,
        })
        .from(users)
        .where(
          and(
            eq(users.organizationId, context.organizationId),
            eq(users.status, "active"),
          ),
        )
        .orderBy(
          desc(users.communityPoints),
          asc(users.lastName),
          asc(users.firstName),
          asc(users.id),
        )
        .limit(limit),
      db
        .select({ enabled: communityLevelSettings.enabled })
        .from(communityLevelSettings)
        .where(eq(communityLevelSettings.organizationId, context.organizationId))
        .limit(1),
      db
        .select({
          id: communityLevels.id,
          position: communityLevels.position,
          name: communityLevels.name,
          description: communityLevels.description,
          minPoints: communityLevels.minPoints,
          icon: communityLevels.icon,
          color: communityLevels.color,
          active: communityLevels.active,
        })
        .from(communityLevels)
        .where(eq(communityLevels.organizationId, context.organizationId))
        .orderBy(asc(communityLevels.position), asc(communityLevels.id)),
    ]);
    const profiles = await getCommunityPublicProfiles({
      organizationId: context.organizationId,
      memberIds: members.map((member) => member.id),
      downloadContext: "api",
    });
    const levelConfiguration = {
      enabled: settingRows[0]?.enabled ?? false,
      levels: levelRows,
    };
    return {
      data: members.flatMap((member) => {
        const profile = profiles.get(member.id);
        if (!profile || profile.communityPoints === null) return [];
        return [{
          id: member.id,
          firstName: member.firstName,
          lastName: member.lastName,
          avatarUrl: profile.avatarUrl,
          department: profile.department,
          communityPoints: profile.communityPoints,
          badges: profile.badges,
          badgeCount: profile.badges.length,
          rank: 0,
          level: resolveCommunityLevelProgress({
            configuration: levelConfiguration,
            communityPoints: profile.communityPoints,
          }).current,
        }];
      }).map((member, index) => ({ ...member, rank: index + 1 })),
    };
  });
}
