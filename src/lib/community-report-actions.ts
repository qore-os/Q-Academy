"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import {
  activityEvents,
  comments,
  communityModerationCases,
  communityReports,
  notifications,
  posts,
  users,
} from "@/db/schema";
import { requireTeamPermission, requireUser } from "@/lib/auth";
import { consumeGuardedPersistentRateLimit } from "@/lib/auth-rate-limit";
import { ApiError } from "@/lib/api/errors";
import {
  assertCommunityPermission,
  resolveCommunitySpacePermissions,
} from "@/lib/community-access";
import {
  claimCommunityModerationCaseAdminAction,
  decideCommunityModerationCaseAdminAction,
} from "@/lib/community-moderation-case-actions";
import type { CommunityAdminActionCode } from "@/lib/i18n/community-admin";
import {
  getCommunityNotificationCopy,
  type CommunityActionCode,
  type CommunityActionParams,
} from "@/lib/i18n/community-actions";
import { resolveRecipientLocale } from "@/lib/i18n/server";
import { attachCommunityReportToModerationCase } from "@/lib/community-moderation-lifecycle";
import {
  removeCommunityScoreContributionsForComment,
  removeCommunityScoreContributionsForPost,
} from "@/lib/community-score";
import { logServerError } from "@/lib/server-error-logging";

export type CommunityReportActionState = {
  ok: boolean | null;
  message: string;
  messageCode?: CommunityAdminActionCode;
  code?: CommunityActionCode;
  params?: CommunityActionParams;
};

type ReportMutationResult =
  | "missing"
  | "own"
  | "duplicate"
  | { status: "created"; held: boolean };

const reportTargetSchema = z.object({
  targetType: z.enum(["post", "comment"]),
  targetId: z.string().uuid(),
});

const reportFormSchema = z.object({
  reason: z.enum([
    "spam",
    "harassment",
    "hate_speech",
    "misinformation",
    "privacy",
    "other",
  ]),
  details: z.string().trim().max(1000).nullable(),
});

const moderationSchema = z.object({
  reportId: z.string().uuid(),
  operation: z.enum(["review", "dismiss", "remove"]),
  note: z.string().trim().max(1000),
});

function refreshCommunity() {
  revalidatePath("/admin/community");
  revalidatePath("/academy/community");
  revalidatePath("/academy");
}

function formValue(formData: FormData, key: string) {
  const entry = formData.get(key);
  return typeof entry === "string" ? entry.trim() : "";
}

export async function createCommunityReportAction(
  targetType: "post" | "comment",
  targetId: string,
  _state: CommunityReportActionState,
  formData: FormData,
): Promise<CommunityReportActionState> {
  const actor = await requireUser();
  const target = reportTargetSchema.safeParse({ targetType, targetId });
  const report = reportFormSchema.safeParse({
    reason: formValue(formData, "reason"),
    details: formValue(formData, "details") || null,
  });
  if (!target.success || !report.success) {
    return {
      ok: false,
      message: "Bitte pruefe Grund und Beschreibung der Meldung.",
      code: "reportInvalid",
    };
  }

  const rateLimit = await consumeGuardedPersistentRateLimit({
    guards: [
      {
        action: "community_report_tenant",
        identifier: actor.organizationId,
      },
    ],
    primary: {
      action: "community_report",
      identifier: `${actor.organizationId}\0${actor.id}`,
    },
  });
  if (rateLimit.limited) {
    return {
      ok: false,
      message: "Zu viele Meldungen. Bitte versuche es spaeter erneut.",
      code: "reportRateLimited",
    };
  }

  let result: ReportMutationResult;
  try {
    result = await db.transaction(async (tx) => {
    const targetContent = target.data.targetType === "post"
      ? await tx
          .select({
            id: posts.id,
            spaceId: posts.spaceId,
            authorId: posts.authorId,
            content: posts.content,
          })
          .from(posts)
          .innerJoin(
            users,
            and(
              eq(users.id, posts.authorId),
              eq(users.organizationId, actor.organizationId),
            ),
          )
          .where(
            and(
              eq(posts.id, target.data.targetId),
              eq(posts.organizationId, actor.organizationId),
              eq(posts.moderationState, "published"),
            ),
          )
          .limit(1)
      : await tx
          .select({
            id: comments.id,
            spaceId: posts.spaceId,
            authorId: comments.authorId,
            content: comments.content,
          })
          .from(comments)
          .innerJoin(posts, eq(posts.id, comments.postId))
          .innerJoin(
            users,
            and(
              eq(users.id, comments.authorId),
              eq(users.organizationId, actor.organizationId),
            ),
          )
          .where(
            and(
              eq(comments.id, target.data.targetId),
              eq(comments.organizationId, actor.organizationId),
              eq(posts.organizationId, actor.organizationId),
              eq(comments.moderationState, "published"),
              eq(posts.moderationState, "published"),
            ),
          )
          .limit(1);

    const content = targetContent[0];
    if (!content) return "missing" as const;
    const access = await resolveCommunitySpacePermissions({
      executor: tx,
      actor,
      spaceId: content.spaceId,
      lock: true,
    });
    assertCommunityPermission(access.permissions, "canView");
    if (content.authorId === actor.id) return "own" as const;

    const [created] = await tx
      .insert(communityReports)
      .values({
        organizationId: actor.organizationId,
        reporterId: actor.id,
        targetType: target.data.targetType,
        targetId: content.id,
        targetAuthorId: content.authorId,
        contentExcerpt: content.content.trim().slice(0, 500),
        reason: report.data.reason,
        details: report.data.details,
      })
      .onConflictDoNothing()
      .returning({ id: communityReports.id });

    if (!created) return "duplicate" as const;
    let moderation;
    try {
      moderation = await attachCommunityReportToModerationCase(tx, {
        organizationId: actor.organizationId,
        reportId: created.id,
      });
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.code === "conflict" &&
        typeof error.details === "object" &&
        error.details !== null &&
        "reason" in error.details &&
        error.details.reason === "duplicate_reporter"
      ) {
        await tx
          .delete(communityReports)
          .where(eq(communityReports.id, created.id));
        return "duplicate" as const;
      }
      throw error;
    }
    if (moderation.state === "held") {
      if (target.data.targetType === "post") {
        await removeCommunityScoreContributionsForPost(tx, {
          organizationId: actor.organizationId,
          postId: content.id,
        });
      } else {
        await removeCommunityScoreContributionsForComment(tx, {
          organizationId: actor.organizationId,
          commentId: content.id,
        });
      }
      const recipientLocale = await resolveRecipientLocale(tx, {
        organizationId: actor.organizationId,
        userId: content.authorId,
      });
      const notificationCopy = getCommunityNotificationCopy(recipientLocale);
      await tx.insert(notifications).values({
        userId: content.authorId,
        title: notificationCopy.reportHeldTitle,
        body: notificationCopy.reportHeldBody,
        type: "community",
        category: "community",
        href: "/academy/community",
      });
    }
    await tx.insert(activityEvents).values({
      organizationId: actor.organizationId,
      userId: actor.id,
      type: "community_report.created",
      entityType: "community_report",
      entityId: created.id,
      metadata: {
        targetType: target.data.targetType,
        targetId: content.id,
        reason: report.data.reason,
        caseId: moderation.caseId,
        distinctReporterCount: moderation.distinctReporterCount,
        thresholdReached: moderation.thresholdReached,
        moderationState: moderation.state,
      },
    });
    return {
      status: "created" as const,
      held: moderation.state === "held",
    };
    });
  } catch (error) {
    if (!(error instanceof ApiError)) {
      logServerError(error, { action: "community.report.create" });
    }
    return {
      ok: false,
      message: "Die Meldung konnte nicht gesendet werden.",
      code: "reportFailed",
    };
  }

  if (result === "missing") {
    return {
      ok: false,
      message: "Der gemeldete Inhalt ist nicht mehr vorhanden.",
      code: "reportContentMissing",
    };
  }
  if (result === "own") {
    return {
      ok: false,
      message: "Eigene Inhalte kannst du bearbeiten oder loeschen.",
      code: "reportOwnContent",
    };
  }
  if (result === "duplicate") {
    return {
      ok: true,
      message: "Dieser Inhalt wurde bereits von dir gemeldet.",
      code: "reportDuplicate",
    };
  }

  refreshCommunity();
  return {
    ok: true,
    message: result.held
      ? "Meldung wurde gesendet. Der Inhalt wird bis zur Pruefung zurueckgehalten."
      : "Meldung wurde vertraulich an das Academy-Team gesendet.",
    code: "reportSubmitted",
    params: { held: result.held },
  };
}

export async function moderateCommunityReportAdminAction(
  reportId: string,
  operation: "review" | "dismiss" | "remove",
  note: string,
): Promise<CommunityReportActionState> {
  const actor = await requireTeamPermission("community.manage");
  const parsed = moderationSchema.safeParse({ reportId, operation, note });
  if (!parsed.success) {
    return { ok: false, message: "Die Moderationsentscheidung ist ungueltig.", messageCode: "reportDecisionFailed" };
  }
  if (parsed.data.operation !== "review" && parsed.data.note.length < 3) {
    return { ok: false, message: "Dokumentiere die Entscheidung mit mindestens drei Zeichen.", messageCode: "reportDecisionFailed" };
  }

  const [current] = await db
    .select({
      status: communityReports.status,
      caseId: communityReports.caseId,
    })
    .from(communityReports)
    .where(
      and(
        eq(communityReports.id, parsed.data.reportId),
        eq(communityReports.organizationId, actor.organizationId),
      ),
    )
    .limit(1);
  if (!current) {
    return { ok: false, message: "Die Meldung wurde nicht gefunden.", messageCode: "reportDecisionFailed" };
  }
  if (current.status === "resolved" || current.status === "dismissed") {
    return { ok: false, message: "Die Meldung wurde bereits abgeschlossen.", messageCode: "reportDecisionFailed" };
  }
  if (!current.caseId) {
    return {
      ok: false,
      message: "Die Meldung ist keinem Moderationsfall zugeordnet.",
      messageCode: "reportDecisionFailed",
    };
  }

  const [moderationCase] = await db
    .select({
      status: communityModerationCases.status,
      decisionVersion: communityModerationCases.decisionVersion,
      contentVersion: communityModerationCases.contentVersion,
    })
    .from(communityModerationCases)
    .where(
      and(
        eq(communityModerationCases.id, current.caseId),
        eq(
          communityModerationCases.organizationId,
          actor.organizationId,
        ),
      ),
    )
    .limit(1);
  if (!moderationCase || moderationCase.status === "resolved") {
    return { ok: false, message: "Der Moderationsfall ist bereits abgeschlossen.", messageCode: "reportDecisionFailed" };
  }

  if (parsed.data.operation === "review") {
    return claimCommunityModerationCaseAdminAction(
      current.caseId,
      moderationCase.decisionVersion,
      moderationCase.contentVersion,
    );
  }

  return decideCommunityModerationCaseAdminAction({
    caseId: current.caseId,
    action: parsed.data.operation === "remove" ? "reject" : "approve",
    expectedDecisionVersion: moderationCase.decisionVersion,
    expectedContentVersion: moderationCase.contentVersion,
    note: parsed.data.note,
  });
}
