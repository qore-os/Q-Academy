import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import {
  and,
  count,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  lt,
  or,
  type SQL,
} from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  comments,
  communityModerationAppeals,
  communityModerationCases,
  communityReports,
  communitySpaces,
  posts,
  users,
} from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import { getAuthRateLimitSecret } from "@/lib/server-environment";

export type CommunityModerationQueueItem = Readonly<{
  id: string;
  targetType: "post" | "comment";
  targetId: string;
  targetMissing: boolean;
  targetTitle: string | null;
  contentExcerpt: string;
  contentState: "pending" | "published" | "held" | "rejected" | null;
  contentVersion: number;
  decisionVersion: number;
  reason:
    | "approval_required"
    | "report_threshold"
    | "duplicate"
    | "link_limit"
    | "manual";
  priority: number;
  status: "open" | "reviewing" | "resolved" | "appealed";
  authorId: string | null;
  authorName: string;
  spaceTitle: string;
  reportCount: number;
  claimedById: string | null;
  claimedAt: string | null;
  createdAt: string;
  updatedAt: string;
  appeal: null | Readonly<{
    id: string;
    statement: string;
    createdAt: string;
  }>;
}>;

export type CommunityModerationQueuePage = Readonly<{
  items: readonly CommunityModerationQueueItem[];
  hasMore: boolean;
  nextCursor: string | null;
}>;

const moderationQueueCursorSchema = z
  .object({
    v: z.literal(1),
    organizationId: z.string().uuid(),
    status: z
      .enum(["open", "reviewing", "resolved", "appealed"])
      .nullable(),
    targetType: z.enum(["post", "comment"]).nullable(),
    priority: z.number().int(),
    createdAt: z.string().datetime({ offset: true }),
    id: z.string().uuid(),
  })
  .strict();

function moderationQueueCursorSignature(body: string) {
  return createHmac("sha256", getAuthRateLimitSecret())
    .update("q-academy:community-moderation-queue-cursor:v1\0")
    .update(body)
    .digest();
}

function encodeModerationQueueCursor(
  cursor: z.infer<typeof moderationQueueCursorSchema>,
) {
  const body = Buffer.from(JSON.stringify(cursor), "utf8").toString(
    "base64url",
  );
  return `${body}.${moderationQueueCursorSignature(body).toString("base64url")}`;
}

function decodeModerationQueueCursor(input: {
  value: string;
  organizationId: string;
  status?: "open" | "reviewing" | "resolved" | "appealed";
  targetType?: "post" | "comment";
}) {
  const [body, signature, extra] = input.value.split(".");
  if (!body || !signature || extra) {
    throw new ApiError(400, "bad_request", "Der Moderationscursor ist ungueltig.");
  }
  let supplied: Buffer;
  let payload: unknown;
  try {
    supplied = Buffer.from(signature, "base64url");
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    throw new ApiError(400, "bad_request", "Der Moderationscursor ist ungueltig.");
  }
  const expected = moderationQueueCursorSignature(body);
  if (
    supplied.length !== expected.length ||
    !timingSafeEqual(supplied, expected)
  ) {
    throw new ApiError(400, "bad_request", "Der Moderationscursor ist ungueltig.");
  }
  const parsed = moderationQueueCursorSchema.safeParse(payload);
  if (
    !parsed.success ||
    parsed.data.organizationId !== input.organizationId ||
    parsed.data.status !== (input.status ?? null) ||
    parsed.data.targetType !== (input.targetType ?? null)
  ) {
    throw new ApiError(
      400,
      "bad_request",
      "Der Moderationscursor passt nicht zu dieser Anfrage.",
    );
  }
  return {
    ...parsed.data,
    createdAtDate: new Date(parsed.data.createdAt),
  };
}

export async function getCommunityModerationQueuePage(input: {
  organizationId: string;
  status?: "open" | "reviewing" | "resolved" | "appealed";
  targetType?: "post" | "comment";
  limit?: number;
  cursor?: string;
}): Promise<CommunityModerationQueuePage> {
  const boundedLimit = Math.max(
    1,
    Math.min(100, Math.trunc(input.limit ?? 25)),
  );
  const cursor = input.cursor
    ? decodeModerationQueueCursor({
        value: input.cursor,
        organizationId: input.organizationId,
        status: input.status,
        targetType: input.targetType,
      })
    : null;
  const conditions: SQL[] = [
    eq(communityModerationCases.organizationId, input.organizationId),
    input.status
      ? eq(communityModerationCases.status, input.status)
      : inArray(communityModerationCases.status, [
          "open",
          "reviewing",
          "appealed",
        ]),
  ];
  if (input.targetType) {
    conditions.push(eq(communityModerationCases.targetType, input.targetType));
  }
  if (cursor) {
    const pageCondition = or(
      lt(communityModerationCases.priority, cursor.priority),
      and(
        eq(communityModerationCases.priority, cursor.priority),
        gt(communityModerationCases.createdAt, cursor.createdAtDate),
      ),
      and(
        eq(communityModerationCases.priority, cursor.priority),
        eq(communityModerationCases.createdAt, cursor.createdAtDate),
        gt(communityModerationCases.id, cursor.id),
      ),
    );
    if (pageCondition) conditions.push(pageCondition);
  }
  const caseRows = await db
    .select()
    .from(communityModerationCases)
    .where(and(...conditions))
    .orderBy(
      desc(communityModerationCases.priority),
      communityModerationCases.createdAt,
      communityModerationCases.id,
    )
    .limit(boundedLimit + 1);
  const hasMore = caseRows.length > boundedLimit;
  const cases = hasMore ? caseRows.slice(0, boundedLimit) : caseRows;
  const lastCase = cases.at(-1);
  const nextCursor =
    hasMore && lastCase
      ? encodeModerationQueueCursor({
          v: 1,
          organizationId: input.organizationId,
          status: input.status ?? null,
          targetType: input.targetType ?? null,
          priority: lastCase.priority,
          createdAt: lastCase.createdAt.toISOString(),
          id: lastCase.id,
        })
      : null;
  if (!cases.length) {
    return { items: [], hasMore: false, nextCursor: null };
  }

  const caseIds = cases.map((item) => item.id);
  const postIds = cases
    .filter((item) => item.targetType === "post")
    .map((item) => item.targetId);
  const commentIds = cases
    .filter((item) => item.targetType === "comment")
    .map((item) => item.targetId);
  const [postRows, commentRows, reportRows, appealRows] = await Promise.all([
    postIds.length
      ? db
          .select({
            id: posts.id,
            authorId: posts.authorId,
            title: posts.title,
            content: posts.content,
            state: posts.moderationState,
            version: posts.moderationVersion,
            spaceTitle: communitySpaces.title,
          })
          .from(posts)
          .innerJoin(
            communitySpaces,
            and(
              eq(communitySpaces.id, posts.spaceId),
              eq(communitySpaces.organizationId, posts.organizationId),
            ),
          )
          .where(
            and(
              eq(posts.organizationId, input.organizationId),
              inArray(posts.id, postIds),
            ),
          )
      : Promise.resolve([]),
    commentIds.length
      ? db
          .select({
            id: comments.id,
            authorId: comments.authorId,
            title: posts.title,
            content: comments.content,
            state: comments.moderationState,
            version: comments.moderationVersion,
            spaceTitle: communitySpaces.title,
          })
          .from(comments)
          .innerJoin(
            posts,
            and(
              eq(posts.id, comments.postId),
              eq(posts.organizationId, comments.organizationId),
            ),
          )
          .innerJoin(
            communitySpaces,
            and(
              eq(communitySpaces.id, posts.spaceId),
              eq(communitySpaces.organizationId, posts.organizationId),
            ),
          )
          .where(
            and(
              eq(comments.organizationId, input.organizationId),
              inArray(comments.id, commentIds),
            ),
          )
      : Promise.resolve([]),
    db
      .select({ caseId: communityReports.caseId, value: count() })
      .from(communityReports)
      .where(
        and(
          eq(communityReports.organizationId, input.organizationId),
          inArray(communityReports.caseId, caseIds),
        ),
      )
      .groupBy(communityReports.caseId),
    db
      .select({
        id: communityModerationAppeals.id,
        caseId: communityModerationAppeals.caseId,
        statement: communityModerationAppeals.statement,
        createdAt: communityModerationAppeals.createdAt,
      })
      .from(communityModerationAppeals)
      .where(
        and(
          eq(
            communityModerationAppeals.organizationId,
            input.organizationId,
          ),
          inArray(communityModerationAppeals.caseId, caseIds),
          isNull(communityModerationAppeals.resolutionAction),
        ),
      ),
  ]);
  const targetRows = [...postRows, ...commentRows];
  const targets = new Map(targetRows.map((row) => [row.id, row]));
  const authorIds = [
    ...new Set(
      cases
        .map((item) => item.targetAuthorId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const authors = authorIds.length
    ? await db
        .select({
          id: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
        })
        .from(users)
        .where(
          and(
            eq(users.organizationId, input.organizationId),
            inArray(users.id, authorIds),
          ),
        )
    : [];
  const authorsById = new Map(authors.map((author) => [author.id, author]));
  const reportsByCase = new Map(
    reportRows.flatMap((row) =>
      row.caseId ? [[row.caseId, Number(row.value)] as const] : [],
    ),
  );
  const appealsByCase = new Map(
    appealRows.map((appeal) => [appeal.caseId, appeal] as const),
  );

  const items = cases.map((moderationCase) => {
    const target = targets.get(moderationCase.targetId);
    const author = moderationCase.targetAuthorId
      ? authorsById.get(moderationCase.targetAuthorId)
      : null;
    const appeal = appealsByCase.get(moderationCase.id);
    return {
      id: moderationCase.id,
      targetType: moderationCase.targetType,
      targetId: moderationCase.targetId,
      targetMissing: !target,
      targetTitle: target?.title ?? null,
      contentExcerpt: target?.content.trim().slice(0, 500) ?? "",
      contentState: target?.state ?? null,
      contentVersion: target?.version ?? moderationCase.contentVersion,
      decisionVersion: moderationCase.decisionVersion,
      reason: moderationCase.reason,
      priority: moderationCase.priority,
      status: moderationCase.status,
      authorId: moderationCase.targetAuthorId,
      authorName: author
        ? `${author.firstName} ${author.lastName}`
        : "Geloeschtes Mitglied",
      spaceTitle: target?.spaceTitle ?? "Unbekannter Bereich",
      reportCount: reportsByCase.get(moderationCase.id) ?? 0,
      claimedById: moderationCase.claimedById,
      claimedAt: moderationCase.claimedAt?.toISOString() ?? null,
      createdAt: moderationCase.createdAt.toISOString(),
      updatedAt: moderationCase.updatedAt.toISOString(),
      appeal: appeal
        ? {
            id: appeal.id,
            statement: appeal.statement,
            createdAt: appeal.createdAt.toISOString(),
          }
        : null,
    };
  });
  return { items, hasMore, nextCursor };
}

export async function getCommunityModerationQueue(
  organizationId: string,
  limit = 100,
): Promise<CommunityModerationQueueItem[]> {
  const page = await getCommunityModerationQueuePage({
    organizationId,
    limit,
  });
  return [...page.items];
}
