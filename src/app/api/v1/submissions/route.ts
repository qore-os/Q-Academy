import {
  and,
  asc,
  desc,
  eq,
  ilike,
  inArray,
  isNull,
  type SQL,
} from "drizzle-orm";
import { db } from "@/db";
import {
  courses,
  mediaAssets,
  submissionAttachments,
  submissions,
  users,
} from "@/db/schema";
import {
  apiOptions,
  handleApi,
  handleTransactionalApiCommand,
  parseJson,
} from "@/lib/api/handler";
import { paginationMeta, parsePagination } from "@/lib/api/pagination";
import { submissionCreateSchema } from "@/lib/api/schemas";
import { createSubmissionAttemptInTransaction } from "@/lib/submissions";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

export async function GET(request: Request) {
  return handleApi(request, { scopes: ["submissions:read"], action: "submission.list", resourceType: "submission" }, async (context) => {
    const url = new URL(request.url);
    const pagination = parsePagination(url);
    const conditions: SQL[] = [eq(submissions.organizationId, context.organizationId)];
    const status = url.searchParams.get("status");
    const userId = url.searchParams.get("userId");
    const courseId = url.searchParams.get("courseId");
    const lessonId = url.searchParams.get("lessonId");
    const blockId = url.searchParams.get("blockId");
    const search = url.searchParams.get("search")?.trim();
    if (status && ["open", "in_review", "revision", "approved"].includes(status)) conditions.push(eq(submissions.status, status as "open" | "in_review" | "revision" | "approved"));
    if (userId) conditions.push(eq(submissions.userId, userId));
    if (courseId) conditions.push(eq(submissions.courseId, courseId));
    if (lessonId) conditions.push(eq(submissions.lessonId, lessonId));
    if (blockId) conditions.push(eq(submissions.blockId, blockId));
    if (search) conditions.push(ilike(submissions.title, `%${search}%`));
    const rows = await db
      .select({
        id: submissions.id,
        blockId: submissions.blockId,
        attemptNumber: submissions.attemptNumber,
        supersedesId: submissions.supersedesId,
        title: submissions.title,
        type: submissions.type,
        content: submissions.content,
        contentFormat: submissions.contentFormat,
        richText: submissions.richText,
        contentProjectionVersion: submissions.contentProjectionVersion,
        fileName: submissions.fileName,
        status: submissions.status,
        score: submissions.score,
        feedback: submissions.feedback,
        submittedAt: submissions.submittedAt,
        reviewedAt: submissions.reviewedAt,
        userId: users.id,
        userFirstName: users.firstName,
        userLastName: users.lastName,
        userEmail: users.email,
        courseId: courses.id,
        courseTitle: courses.title,
        lessonId: submissions.lessonId,
      })
      .from(submissions)
      .innerJoin(users, and(eq(users.id, submissions.userId), eq(users.organizationId, context.organizationId)))
      .innerJoin(courses, and(eq(courses.id, submissions.courseId), eq(courses.organizationId, context.organizationId)))
      .where(and(...conditions))
      .orderBy(desc(submissions.submittedAt))
      .limit(pagination.limit + 1)
      .offset(pagination.offset);
    const hasMore = rows.length > pagination.limit;
    const data = hasMore ? rows.slice(0, pagination.limit) : rows;
    const attachmentRows = data.length
      ? await db
          .select({
            submissionId: submissionAttachments.submissionId,
            id: mediaAssets.id,
            originalFileName: mediaAssets.originalFileName,
            kind: mediaAssets.kind,
            declaredMimeType: mediaAssets.declaredMimeType,
            detectedMimeType: mediaAssets.detectedMimeType,
            declaredSizeBytes: mediaAssets.declaredSizeBytes,
            actualSizeBytes: mediaAssets.actualSizeBytes,
            sortOrder: submissionAttachments.sortOrder,
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
              eq(submissionAttachments.organizationId, context.organizationId),
              inArray(
                submissionAttachments.submissionId,
                data.map((submission) => submission.id),
              ),
              eq(mediaAssets.status, "ready"),
              isNull(mediaAssets.deletedAt),
            ),
          )
          .orderBy(
            asc(submissionAttachments.submissionId),
            asc(submissionAttachments.sortOrder),
          )
      : [];
    const attachmentsBySubmission = new Map<string, typeof attachmentRows>();
    for (const attachment of attachmentRows) {
      const current =
        attachmentsBySubmission.get(attachment.submissionId) ?? [];
      current.push(attachment);
      attachmentsBySubmission.set(attachment.submissionId, current);
    }
    return {
      data: data.map((submission) => ({
        ...submission,
        attachments: (attachmentsBySubmission.get(submission.id) ?? []).map(
          (attachment) => ({
            id: attachment.id,
            originalFileName: attachment.originalFileName,
            kind: attachment.kind,
            mimeType:
              attachment.detectedMimeType ?? attachment.declaredMimeType,
            sizeBytes:
              attachment.actualSizeBytes ?? attachment.declaredSizeBytes,
            downloadHref: `/api/v1/media-assets/${attachment.id}/download`,
          }),
        ),
      })),
      meta: { pagination: paginationMeta(pagination, data.length, hasMore) },
    };
  });
}

export async function POST(request: Request) {
  return handleTransactionalApiCommand(
    request,
    {
      scopes: ["submissions:write"],
      action: "submission.create",
      resourceType: "submission",
      idempotent: true,
    },
    {
      prepare: () => parseJson(request, submissionCreateSchema),
      execute: async ({ context, tx, activity, webhook }, input) => {
        const submission = await createSubmissionAttemptInTransaction(tx, {
          organizationId: context.organizationId,
          ...input,
        });
        const attachments = input.attachmentIds.length
          ? await tx
              .select({
                id: mediaAssets.id,
                originalFileName: mediaAssets.originalFileName,
                kind: mediaAssets.kind,
                declaredMimeType: mediaAssets.declaredMimeType,
                detectedMimeType: mediaAssets.detectedMimeType,
                declaredSizeBytes: mediaAssets.declaredSizeBytes,
                actualSizeBytes: mediaAssets.actualSizeBytes,
                sortOrder: submissionAttachments.sortOrder,
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
                  eq(submissionAttachments.organizationId, context.organizationId),
                  eq(submissionAttachments.submissionId, submission.id),
                ),
              )
              .orderBy(asc(submissionAttachments.sortOrder))
          : [];
        await activity({
          userId: submission.userId,
          type: "submission.created",
          entityType: "submission",
          entityId: submission.id,
          metadata: {
            blockId: submission.blockId,
            attemptNumber: submission.attemptNumber,
            supersedesId: submission.supersedesId,
          },
        });
        await webhook("submission.created", submission);
        return {
          data: {
            ...submission,
            attachments: attachments.map((attachment) => ({
              id: attachment.id,
              originalFileName: attachment.originalFileName,
              kind: attachment.kind,
              mimeType:
                attachment.detectedMimeType ?? attachment.declaredMimeType,
              sizeBytes:
                attachment.actualSizeBytes ?? attachment.declaredSizeBytes,
              downloadHref: `/api/v1/media-assets/${attachment.id}/download`,
            })),
          },
          status: 201,
          resourceId: submission.id,
        };
      },
    },
  );
}
