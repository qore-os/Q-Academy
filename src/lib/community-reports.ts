import "server-only";

import { asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { communityReports, users } from "@/db/schema";
import {
  communityAttachmentsForComments,
  communityAttachmentsForPosts,
} from "@/lib/community-attachments";

export async function getCommunityReports(organizationId: string) {
  const reports = await db
    .select()
    .from(communityReports)
    .where(eq(communityReports.organizationId, organizationId))
    .orderBy(
      asc(sql`case ${communityReports.status} when 'open' then 0 when 'reviewing' then 1 else 2 end`),
      desc(communityReports.createdAt),
    )
    .limit(100);

  const userIds = [
    ...new Set(
      reports.flatMap((report) => [
        report.reporterId,
        report.targetAuthorId,
        report.handledById,
      ]).filter((id): id is string => Boolean(id)),
    ),
  ];
  const people = userIds.length
    ? await db
        .select({
          id: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
        })
        .from(users)
        .where(inArray(users.id, userIds))
    : [];
  const [postAttachments, commentAttachments] = await Promise.all([
    communityAttachmentsForPosts({
      organizationId,
      postIds: reports
        .filter((report) => report.targetType === "post")
        .map((report) => report.targetId),
    }),
    communityAttachmentsForComments({
      organizationId,
      commentIds: reports
        .filter((report) => report.targetType === "comment")
        .map((report) => report.targetId),
    }),
  ]);
  const peopleById = new Map(people.map((person) => [person.id, person]));
  const personName = (id: string | null) => {
    if (!id) return "Geloeschtes Mitglied";
    const person = peopleById.get(id);
    return person ? `${person.firstName} ${person.lastName}` : "Geloeschtes Mitglied";
  };

  return reports.map((report) => ({
    ...report,
    attachments:
      report.targetType === "post"
        ? postAttachments.get(report.targetId) ?? []
        : commentAttachments.get(report.targetId) ?? [],
    reporterName: personName(report.reporterId),
    targetAuthorName: personName(report.targetAuthorId),
    handlerName: report.handledById ? personName(report.handledById) : null,
  }));
}
