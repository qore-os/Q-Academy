import "server-only";

import { createHash } from "node:crypto";
import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  or,
} from "drizzle-orm";

import { db } from "@/db";
import {
  activityEvents,
  assessmentAttempts,
  courses,
  mediaAssets,
  notifications,
  submissionAttachments,
  submissionReviewAnnotations,
  submissionReviews,
  submissions,
  users,
} from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import { enqueueWebhook } from "@/lib/api/webhooks";
import { requireCoursePermissionInTransaction } from "@/lib/course-permissions";
import {
  formatSubmissionReviewScore,
  getSubmissionReviewCopy,
} from "@/lib/i18n/submission-review";
import { resolveRecipientLocale } from "@/lib/i18n/server";
import { getCourseLearningAccess } from "@/lib/learning-access";
import {
  bindSubmissionAttachments,
  validateAttachmentIds,
} from "@/lib/media/submission-attachments";
import { lockMemberCourseProgress } from "@/lib/progress-lock";
import type { PublishedSnapshotLesson } from "@/lib/published-course";
import {
  MAX_SUBMISSION_PLAIN_TEXT_LENGTH,
  projectSubmissionRichTextPlainText,
  submissionRichTextDocumentSchema,
  SUBMISSION_TEXT_PROJECTION_VERSION,
} from "@/lib/submission-rich-text";
import {
  submissionReviewAnnotationIdentity,
  submissionReviewAnnotationView,
  submissionReviewAnnotationsInputSchema,
  type SubmissionReviewAnnotationInput,
} from "@/lib/submission-review-annotations";

type SubmissionDecision = "revision" | "approved";
type SubmissionType = "text" | "file" | "audio" | "video";
type SubmissionReader = Pick<typeof db, "select">;
type SubmissionTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0];

type CreateSubmissionAttemptInput = {
  organizationId: string;
  userId: string;
  courseId: string;
  lessonId: string;
  blockId: string;
  title: string;
  type?: SubmissionType;
  content?: string | null;
  richText?: unknown;
  fileName?: string | null;
  attachmentIds?: readonly string[];
};

type ReviewSubmissionAttemptInput = {
  organizationId: string;
  submissionId: string;
  reviewerId: string;
  decision: SubmissionDecision;
  feedback: string;
  score: number;
  annotations?: unknown;
};

function parseReviewAnnotations(input: unknown) {
  const parsed = submissionReviewAnnotationsInputSchema.safeParse(input ?? []);
  if (!parsed.success) {
    throw new ApiError(
      422,
      "validation_error",
      "Die Review-Annotationen sind ungueltig.",
      { issues: parsed.error.issues },
    );
  }
  return parsed.data;
}

function annotationFingerprint(annotation: SubmissionReviewAnnotationInput) {
  return createHash("sha256")
    .update("q-academy:submission-review-annotation:v1\0")
    .update(submissionReviewAnnotationIdentity(annotation))
    .digest("hex");
}

export function publishedSubmissionBlocks(lesson: PublishedSnapshotLesson) {
  return [
    ...lesson.blocks,
    ...lesson.pages
      .filter((page) => page.status === "published")
      .flatMap((page) => page.blocks),
  ].filter((block) => block.type === "submission");
}

export async function hasApprovedRequiredSubmissions(
  reader: SubmissionReader,
  input: {
    organizationId: string;
    userId: string;
    courseId: string;
    lessonId: string;
    lesson: PublishedSnapshotLesson;
  },
) {
  const requiredBlockIds = publishedSubmissionBlocks(input.lesson)
    .filter((block) => block.required)
    .map((block) => block.id);
  if (!requiredBlockIds.length) return true;

  const approved = await reader
    .select({ blockId: submissions.blockId })
    .from(submissionReviews)
    .innerJoin(
      submissions,
      and(
        eq(submissions.id, submissionReviews.submissionId),
        eq(submissions.organizationId, submissionReviews.organizationId),
      ),
    )
    .where(
      and(
        eq(submissionReviews.organizationId, input.organizationId),
        eq(submissionReviews.decision, "approved"),
        eq(submissions.organizationId, input.organizationId),
        eq(submissions.userId, input.userId),
        eq(submissions.courseId, input.courseId),
        eq(submissions.lessonId, input.lessonId),
        inArray(submissions.blockId, requiredBlockIds),
      ),
    );
  const approvedBlockIds = new Set(
    approved.flatMap((row) => row.blockId ?? []),
  );
  return requiredBlockIds.every((blockId) => approvedBlockIds.has(blockId));
}

export async function createSubmissionAttemptInTransaction(
  transaction: SubmissionTransaction,
  input: CreateSubmissionAttemptInput,
) {
  const legacyContent = input.content?.trim() || null;
  if (input.richText != null && legacyContent) {
    throw new ApiError(
      422,
      "validation_error",
      "Eine Abgabe darf nicht gleichzeitig Plaintext und Rich-Text enthalten.",
    );
  }

  const parsedRichText =
    input.richText == null
      ? null
      : submissionRichTextDocumentSchema.safeParse(input.richText);
  if (parsedRichText && !parsedRichText.success) {
    throw new ApiError(
      422,
      "validation_error",
      "Das Rich-Text-Dokument der Abgabe ist ungueltig.",
      { issues: parsedRichText.error.issues },
    );
  }
  const richText = parsedRichText?.success ? parsedRichText.data : null;
  const content = richText
    ? projectSubmissionRichTextPlainText(richText)
    : legacyContent;
  const contentFormat = richText ? "rich_text" : "plain_text";
  if (content && content.length > MAX_SUBMISSION_PLAIN_TEXT_LENGTH) {
    throw new ApiError(
      422,
      "validation_error",
      "Der Abgabetext ist zu gross.",
    );
  }
  const attachmentIds = validateAttachmentIds(input.attachmentIds ?? []);
  if (!attachmentIds.length && (!content || content.length < 20)) {
    throw new ApiError(
      422,
      "validation_error",
      "Die Abgabe benoetigt aussagekraeftigen Text oder mindestens einen Dateianhang.",
    );
  }

  await lockMemberCourseProgress(transaction, input);
  const learningAccess = await getCourseLearningAccess(transaction, input);
  const accessibleLesson = learningAccess?.lessons.get(input.lessonId);
  if (!learningAccess || !accessibleLesson?.access.canInteract) {
    throw new ApiError(
      404,
      "not_found",
      "Kurs oder Lektion ist nicht verfuegbar.",
    );
  }

  const block = publishedSubmissionBlocks(accessibleLesson.lesson).find(
    (candidate) => candidate.id === input.blockId,
  );
  if (!block) {
    throw new ApiError(
      422,
      "validation_error",
      "Der Abgabeblock gehoert nicht zur publizierten Lektion.",
    );
  }

  const [latest] = await transaction
    .select({
      id: submissions.id,
      attemptNumber: submissions.attemptNumber,
      status: submissions.status,
    })
    .from(submissions)
    .where(
      and(
        eq(submissions.organizationId, input.organizationId),
        eq(submissions.userId, input.userId),
        eq(submissions.courseId, input.courseId),
        eq(submissions.lessonId, input.lessonId),
        eq(submissions.blockId, input.blockId),
      ),
    )
    .orderBy(desc(submissions.attemptNumber), desc(submissions.submittedAt))
    .limit(1);

  if (latest && latest.status !== "revision") {
    throw new ApiError(
      409,
      "conflict",
      latest.status === "approved"
        ? "Diese Abgabe wurde bereits freigegeben."
        : "Eine Abgabe fuer diese Aufgabe wartet bereits auf Bewertung.",
    );
  }

  if (accessibleLesson.lesson.type === "exam" && latest?.status !== "revision") {
    const now = new Date();
    const [activeExamAttempt] = await transaction
      .select({ id: assessmentAttempts.id })
      .from(assessmentAttempts)
      .where(
        and(
          eq(assessmentAttempts.organizationId, input.organizationId),
          eq(assessmentAttempts.userId, input.userId),
          eq(assessmentAttempts.courseId, input.courseId),
          eq(assessmentAttempts.lessonId, input.lessonId),
          inArray(assessmentAttempts.status, ["in_progress", "submitted"]),
          isNotNull(assessmentAttempts.courseVersionId),
          isNotNull(assessmentAttempts.definitionHash),
          isNull(assessmentAttempts.finalizationReason),
          or(
            isNull(assessmentAttempts.deadlineAt),
            gt(assessmentAttempts.deadlineAt, now),
          ),
        ),
      )
      .orderBy(desc(assessmentAttempts.startedAt), desc(assessmentAttempts.id))
      .limit(1)
      .for("share", { of: assessmentAttempts });
    if (!activeExamAttempt) {
      throw new ApiError(
        409,
        "conflict",
        "Die Pruefung muss gestartet und noch aktiv sein, bevor diese Abgabe eingereicht wird.",
      );
    }
  }

  const [created] = await transaction
    .insert(submissions)
    .values({
      organizationId: input.organizationId,
      userId: input.userId,
      courseId: input.courseId,
      lessonId: input.lessonId,
      blockId: input.blockId,
      attemptNumber: (latest?.attemptNumber ?? 0) + 1,
      supersedesId: latest?.id ?? null,
      title: input.title,
      type: input.type ?? "text",
      content,
      contentFormat,
      richText,
      contentProjectionVersion: SUBMISSION_TEXT_PROJECTION_VERSION,
      fileName: input.fileName?.trim() || null,
      status: "in_review",
    })
    .returning();

  await bindSubmissionAttachments(transaction, {
    organizationId: input.organizationId,
    userId: input.userId,
    submissionId: created.id,
    attachmentIds,
  });

  return created;
}

export async function createSubmissionAttempt(
  input: CreateSubmissionAttemptInput,
) {
  return db.transaction(async (transaction) => {
    const created = await createSubmissionAttemptInTransaction(
      transaction,
      input,
    );
    await transaction.insert(activityEvents).values({
      organizationId: input.organizationId,
      userId: input.userId,
      type: "submission.created",
      entityType: "submission",
      entityId: created.id,
      metadata: {
        blockId: created.blockId,
        attemptNumber: created.attemptNumber,
        supersedesId: created.supersedesId,
      },
    });
    await enqueueWebhook(
      input.organizationId,
      "submission.created",
      created,
      transaction,
    );
    return created;
  });
}

export async function reviewSubmissionAttemptInTransaction(
  transaction: SubmissionTransaction,
  input: ReviewSubmissionAttemptInput,
) {
  const annotations = parseReviewAnnotations(input.annotations);
  const [reviewer] = await transaction
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(
      and(
        eq(users.id, input.reviewerId),
        eq(users.organizationId, input.organizationId),
        inArray(users.role, ["owner", "admin", "trainer"]),
        eq(users.status, "active"),
      ),
    )
    .limit(1);
  if (!reviewer) {
    throw new ApiError(
      422,
      "validation_error",
      "Reviewer muss ein aktiver Trainer oder Administrator dieser Organisation sein.",
    );
  }

  const [submissionTarget] = await transaction
    .select({ courseId: submissions.courseId })
    .from(submissions)
    .where(
      and(
        eq(submissions.id, input.submissionId),
        eq(submissions.organizationId, input.organizationId),
      ),
    )
    .limit(1);
  if (!submissionTarget) {
    throw new ApiError(404, "not_found", "Abgabe nicht gefunden.");
  }
  await requireCoursePermissionInTransaction(
    transaction,
    {
      id: reviewer.id,
      organizationId: input.organizationId,
    },
    submissionTarget.courseId,
    "edit",
  );

  const [record] = await transaction
    .select({
      submission: submissions,
      courseTitle: courses.title,
      courseSlug: courses.slug,
    })
    .from(submissions)
    .innerJoin(
      users,
      and(
        eq(users.id, submissions.userId),
        eq(users.organizationId, input.organizationId),
      ),
    )
    .innerJoin(
      courses,
      and(
        eq(courses.id, submissions.courseId),
        eq(courses.organizationId, input.organizationId),
      ),
    )
    .where(
      and(
        eq(submissions.id, input.submissionId),
        eq(submissions.organizationId, input.organizationId),
        eq(submissions.courseId, submissionTarget.courseId),
      ),
    )
    .limit(1)
    .for("update", { of: submissions });
  if (!record) {
    throw new ApiError(404, "not_found", "Abgabe nicht gefunden.");
  }
  if (
    !(<const>["open", "in_review"]).includes(
      record.submission.status as "open" | "in_review",
    )
  ) {
    throw new ApiError(
      409,
      "conflict",
      "Diese Abgabe wurde bereits abschliessend bewertet.",
    );
  }

  const contentLength = record.submission.content?.length ?? 0;
  if (
    annotations.some(
      (annotation) =>
        annotation.type === "text_range" &&
        annotation.endOffset > contentLength,
    )
  ) {
    throw new ApiError(
      422,
      "validation_error",
      "Textmarkierungen muessen innerhalb der eingereichten Antwort liegen.",
    );
  }

  const requestedMediaAssetIds = [
    ...new Set(
      annotations.flatMap((annotation) =>
        annotation.type === "media_timestamp"
          ? [annotation.mediaAssetId.toLowerCase()]
          : [],
      ),
    ),
  ].sort();
  const attachedMedia = requestedMediaAssetIds.length
    ? await transaction
        .select({
          id: submissionAttachments.mediaAssetId,
          kind: mediaAssets.kind,
          durationMilliseconds: mediaAssets.durationMilliseconds,
        })
        .from(submissionAttachments)
        .innerJoin(
          mediaAssets,
          and(
            eq(mediaAssets.id, submissionAttachments.mediaAssetId),
            eq(
              mediaAssets.organizationId,
              submissionAttachments.organizationId,
            ),
          ),
        )
        .where(
          and(
            eq(submissionAttachments.organizationId, input.organizationId),
            eq(submissionAttachments.submissionId, record.submission.id),
            inArray(
              submissionAttachments.mediaAssetId,
              requestedMediaAssetIds,
            ),
          ),
        )
        .orderBy(asc(submissionAttachments.mediaAssetId))
        .for("share", { of: [submissionAttachments, mediaAssets] })
    : [];
  const attachedMediaById = new Map(
    attachedMedia.map(
      (asset) => [asset.id.toLowerCase(), asset] as const,
    ),
  );
  if (
    requestedMediaAssetIds.some((id) => {
      const kind = attachedMediaById.get(id)?.kind;
      return kind !== "audio" && kind !== "video";
    })
  ) {
    throw new ApiError(
      422,
      "validation_error",
      "Zeitmarken benoetigen ein an diese Abgabe gebundenes Audio- oder Video-Asset.",
    );
  }

  if (
    annotations.some((annotation) => {
      if (annotation.type !== "media_timestamp") return false;
      const duration = attachedMediaById.get(
        annotation.mediaAssetId.toLowerCase(),
      )?.durationMilliseconds;
      return duration !== null && duration !== undefined &&
        annotation.timestampMilliseconds > duration;
    })
  ) {
    throw new ApiError(
      422,
      "validation_error",
      "Zeitmarken duerfen die bekannte Dauer des Abgabemediums nicht ueberschreiten.",
    );
  }

  const reviewedAt = new Date();
  const [review] = await transaction
    .insert(submissionReviews)
    .values({
      organizationId: input.organizationId,
      submissionId: record.submission.id,
      reviewerId: reviewer.id,
      decision: input.decision,
      feedback: input.feedback,
      score: input.score,
      reviewedAt,
    })
    .returning();
  const createdAnnotations = annotations.length
    ? await transaction
        .insert(submissionReviewAnnotations)
        .values(
          annotations.map((annotation, sortOrder) => ({
            organizationId: input.organizationId,
            reviewId: review.id,
            submissionId: record.submission.id,
            type: annotation.type,
            body: annotation.body,
            startOffset:
              annotation.type === "text_range" ? annotation.startOffset : null,
            endOffset:
              annotation.type === "text_range" ? annotation.endOffset : null,
            mediaAssetId:
              annotation.type === "media_timestamp"
                ? annotation.mediaAssetId
                : null,
            mediaAssetKind:
              annotation.type === "media_timestamp"
                ? attachedMediaById.get(annotation.mediaAssetId.toLowerCase())
                    ?.kind
                : null,
            timestampMilliseconds:
              annotation.type === "media_timestamp"
                ? annotation.timestampMilliseconds
                : null,
            sortOrder,
            fingerprint: annotationFingerprint(annotation),
          })),
        )
        .returning({
          id: submissionReviewAnnotations.id,
          type: submissionReviewAnnotations.type,
          body: submissionReviewAnnotations.body,
          startOffset: submissionReviewAnnotations.startOffset,
          endOffset: submissionReviewAnnotations.endOffset,
          mediaAssetId: submissionReviewAnnotations.mediaAssetId,
          timestampMilliseconds:
            submissionReviewAnnotations.timestampMilliseconds,
          sortOrder: submissionReviewAnnotations.sortOrder,
          createdAt: submissionReviewAnnotations.createdAt,
        })
    : [];
  const [submission] = await transaction
    .update(submissions)
    .set({
      status: input.decision,
      feedback: input.feedback,
      score: input.score,
      reviewerId: reviewer.id,
      reviewedAt,
    })
    .where(
      and(
        eq(submissions.id, record.submission.id),
        eq(submissions.organizationId, input.organizationId),
      ),
    )
    .returning();

  const href = record.submission.lessonId
    ? `/academy/courses/${record.courseSlug}/learn/${record.submission.lessonId}`
    : `/academy/courses/${record.courseSlug}`;
  const recipientLocale = await resolveRecipientLocale(transaction, {
    organizationId: input.organizationId,
    userId: record.submission.userId,
  });
  const notificationCopy = getSubmissionReviewCopy(recipientLocale).notification;
  const [notification] = await transaction
    .insert(notifications)
    .values({
      userId: record.submission.userId,
      title:
        input.decision === "approved"
          ? notificationCopy.approvedTitle
          : notificationCopy.revisionTitle,
      body:
        input.decision === "approved"
          ? notificationCopy.approvedBody(
              record.courseTitle,
              record.submission.attemptNumber,
              formatSubmissionReviewScore(recipientLocale, input.score),
            )
          : notificationCopy.revisionBody(
              record.courseTitle,
              record.submission.attemptNumber,
            ),
      type: "submission",
      category: "feedback",
      href,
    })
    .returning();

  return {
    submission,
    review: {
      ...review,
      annotations: createdAnnotations
        .sort((left, right) => left.sortOrder - right.sortOrder)
        .map(submissionReviewAnnotationView),
    },
    notification,
  };
}

export async function reviewSubmissionAttempt(
  input: ReviewSubmissionAttemptInput,
) {
  return db.transaction(async (transaction) => {
    const reviewed = await reviewSubmissionAttemptInTransaction(
      transaction,
      input,
    );
    await transaction.insert(activityEvents).values({
      organizationId: input.organizationId,
      userId: input.reviewerId,
      type: "submission.reviewed",
      entityType: "submission",
      entityId: reviewed.submission.id,
      metadata: {
        status: input.decision,
        score: input.score,
        attemptNumber: reviewed.submission.attemptNumber,
        reviewId: reviewed.review.id,
        annotationCount: reviewed.review.annotations.length,
      },
    });
    await enqueueWebhook(
      input.organizationId,
      "submission.reviewed",
      {
        ...reviewed.submission,
        review: reviewed.review,
      },
      transaction,
    );
    return reviewed;
  });
}

export async function deleteSubmissionAttemptInTransaction(
  transaction: SubmissionTransaction,
  input: { organizationId: string; submissionId: string },
) {
  const [submission] = await transaction
    .select()
    .from(submissions)
    .where(
      and(
        eq(submissions.id, input.submissionId),
        eq(submissions.organizationId, input.organizationId),
      ),
    )
    .limit(1)
    .for("update", { of: submissions });
  if (!submission) {
    throw new ApiError(404, "not_found", "Abgabe nicht gefunden.");
  }

  const [review] = await transaction
    .select({ id: submissionReviews.id })
    .from(submissionReviews)
    .where(
      and(
        eq(submissionReviews.organizationId, input.organizationId),
        eq(submissionReviews.submissionId, input.submissionId),
      ),
    )
    .limit(1);
  const [superseding] = await transaction
    .select({ id: submissions.id })
    .from(submissions)
    .where(
      and(
        eq(submissions.organizationId, input.organizationId),
        eq(submissions.supersedesId, input.submissionId),
      ),
    )
    .limit(1);

  if (
    review ||
    superseding ||
    !["open", "in_review"].includes(submission.status)
  ) {
    throw new ApiError(
      409,
      "conflict",
      "Bewertete oder bereits ersetzte Abgabeversuche koennen nicht geloescht werden.",
    );
  }

  const [deleted] = await transaction
    .delete(submissions)
    .where(
      and(
        eq(submissions.id, input.submissionId),
        eq(submissions.organizationId, input.organizationId),
      ),
    )
    .returning();
  if (!deleted) {
    throw new ApiError(409, "conflict", "Die Abgabe wurde bereits geloescht.");
  }
  return deleted;
}
