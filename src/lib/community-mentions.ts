import "server-only";

import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  comments,
  communityMentions,
  notifications,
  posts,
  users,
} from "@/db/schema";
import {
  extractMentionHandles,
  mentionHandleForEmail,
} from "@/lib/community-domain";
import { resolveCommunitySpacePermissions } from "@/lib/community-access";
import { resolveCommunityRecipientLocales } from "@/lib/community-notification-locales";
import { getCommunityNotificationCopy } from "@/lib/i18n/community-actions";

export type CommunityMentionTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0];

type MentionCandidate = {
  id: string;
  handle: string;
  firstName: string;
  lastName: string;
  role: "owner" | "admin" | "trainer" | "member";
};

function uniqueCandidates(
  rows: Array<{
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    role: "owner" | "admin" | "trainer" | "member";
  }>,
) {
  const byHandle = new Map<string, MentionCandidate[]>();
  for (const row of rows) {
    const handle = mentionHandleForEmail(row.email);
    if (!handle) continue;
    const current = byHandle.get(handle) ?? [];
    current.push({
      id: row.id,
      handle,
      firstName: row.firstName,
      lastName: row.lastName,
      role: row.role,
    });
    byHandle.set(handle, current);
  }
  return [...byHandle.values()].flatMap((candidates) =>
    candidates.length === 1 ? candidates : [],
  );
}

async function tenantCandidates(
  reader: Pick<typeof db, "select">,
  organizationId: string,
) {
  const rows = await reader
    .select({
      id: users.id,
      email: users.email,
      firstName: users.firstName,
      lastName: users.lastName,
      role: users.role,
    })
    .from(users)
    .where(
      and(
        eq(users.organizationId, organizationId),
        eq(users.status, "active"),
      ),
    );
  return uniqueCandidates(rows);
}

export async function getCommunityMentionCandidates(
  organizationId: string,
) {
  return (await tenantCandidates(db, organizationId)).map((candidate) => ({
    id: candidate.id,
    handle: candidate.handle,
    firstName: candidate.firstName,
    lastName: candidate.lastName,
  }));
}

export async function syncCommunityMentions(
  tx: CommunityMentionTransaction,
  input: {
    organizationId: string;
    postId: string;
    commentId?: string | null;
    mentionedById: string;
    mentionedByName: string;
    content: string;
  },
) {
  const sourceCondition = input.commentId
    ? eq(communityMentions.commentId, input.commentId)
    : and(
        eq(communityMentions.postId, input.postId),
        isNull(communityMentions.commentId),
      );
  const previous = await tx
    .select({ mentionedUserId: communityMentions.mentionedUserId })
    .from(communityMentions)
    .where(
      and(
        eq(communityMentions.organizationId, input.organizationId),
        sourceCondition,
      ),
    );
  const previousUserIds = new Set(previous.map((row) => row.mentionedUserId));
  await tx
    .delete(communityMentions)
    .where(
      and(
        eq(communityMentions.organizationId, input.organizationId),
        sourceCondition,
      ),
    );

  const handles = new Set(extractMentionHandles(input.content));
  if (!handles.size) return [];
  const [sourcePost] = input.commentId
    ? await tx
        .select({ spaceId: posts.spaceId })
        .from(comments)
        .innerJoin(
          posts,
          and(
            eq(posts.id, comments.postId),
            eq(posts.organizationId, comments.organizationId),
          ),
        )
        .where(
          and(
            eq(comments.id, input.commentId),
            eq(comments.postId, input.postId),
            eq(comments.organizationId, input.organizationId),
            eq(comments.moderationState, "published"),
            eq(posts.moderationState, "published"),
          ),
        )
        .limit(1)
    : await tx
        .select({ spaceId: posts.spaceId })
        .from(posts)
        .where(
          and(
            eq(posts.id, input.postId),
            eq(posts.organizationId, input.organizationId),
            eq(posts.moderationState, "published"),
          ),
        )
        .limit(1);
  if (!sourcePost) return [];
  const candidates = await tenantCandidates(tx, input.organizationId);
  const resolved = candidates.filter(
    (candidate) =>
      handles.has(candidate.handle) && candidate.id !== input.mentionedById,
  );
  if (!resolved.length) return [];
  const lockedRows = await tx
    .select({
      id: users.id,
      email: users.email,
      firstName: users.firstName,
      lastName: users.lastName,
      role: users.role,
    })
    .from(users)
    .where(
      and(
        eq(users.organizationId, input.organizationId),
        eq(users.status, "active"),
        inArray(
          users.id,
          resolved.map((candidate) => candidate.id),
        ),
      ),
    )
    .for("share", { of: users });
  const lockedCandidates = new Map(
    lockedRows.map((row) => [row.id, row] as const),
  );
  const mentioned: MentionCandidate[] = [];
  for (const candidate of resolved) {
    const current = lockedCandidates.get(candidate.id);
    if (!current || mentionHandleForEmail(current.email) !== candidate.handle) {
      continue;
    }
    const lockedCandidate: MentionCandidate = {
      id: current.id,
      handle: candidate.handle,
      firstName: current.firstName,
      lastName: current.lastName,
      role: current.role,
    };
    const access = await resolveCommunitySpacePermissions({
      executor: tx,
      actor: {
        id: lockedCandidate.id,
        organizationId: input.organizationId,
        role: lockedCandidate.role,
      },
      spaceId: sourcePost.spaceId,
    });
    if (access.permissions.canView) mentioned.push(lockedCandidate);
  }
  if (!mentioned.length) return [];

  await tx.insert(communityMentions).values(
    mentioned.map((candidate) => ({
      organizationId: input.organizationId,
      postId: input.postId,
      commentId: input.commentId ?? null,
      mentionedUserId: candidate.id,
      mentionedById: input.mentionedById,
      handle: candidate.handle,
    })),
  );

  const newlyMentioned = mentioned.filter(
    (candidate) => !previousUserIds.has(candidate.id),
  );
  if (newlyMentioned.length) {
    const recipientLocales = await resolveCommunityRecipientLocales(tx, {
      organizationId: input.organizationId,
      userIds: newlyMentioned.map((candidate) => candidate.id),
    });
    await tx.insert(notifications).values(
      newlyMentioned.map((candidate) => {
        const locale = recipientLocales.get(candidate.id);
        if (!locale) {
          throw new Error("Community mention recipient locale is unavailable.");
        }
        const copy = getCommunityNotificationCopy(locale);
        return {
          userId: candidate.id,
          title: copy.mentionTitle,
          body: copy.mentionBody(input.mentionedByName),
          type: "community" as const,
          category: "community" as const,
          href: `/academy/community?post=${input.postId}#post-${input.postId}`,
        };
      }),
    );
  }
  return mentioned;
}
