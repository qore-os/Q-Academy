import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  courses,
  submissionReviewAnnotations,
  submissionReviews,
  submissions,
  users,
} from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import {
  apiOptions,
  handleApi,
  handleTransactionalApiCommand,
} from "@/lib/api/handler";
import { deleteSubmissionAttemptInTransaction } from "@/lib/submissions";
import { submissionReviewAnnotationView } from "@/lib/submission-review-annotations";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

async function submissionForOrganization(id: string, organizationId: string) {
  const [record] = await db
    .select({
      submission: submissions,
      member: { id: users.id, email: users.email, firstName: users.firstName, lastName: users.lastName },
      course: { id: courses.id, title: courses.title, slug: courses.slug },
    })
    .from(submissions)
    .innerJoin(users, and(eq(users.id, submissions.userId), eq(users.organizationId, organizationId)))
    .innerJoin(courses, and(eq(courses.id, submissions.courseId), eq(courses.organizationId, organizationId)))
    .where(and(eq(submissions.id, id), eq(submissions.organizationId, organizationId)))
    .limit(1);
  if (!record) throw new ApiError(404, "not_found", "Abgabe nicht gefunden.");
  const reviews = await db
    .select()
    .from(submissionReviews)
    .where(
      and(
        eq(submissionReviews.organizationId, organizationId),
        eq(submissionReviews.submissionId, id),
      ),
    )
    .orderBy(desc(submissionReviews.reviewedAt));
  const annotationRows = reviews.length
    ? await db
        .select({
          id: submissionReviewAnnotations.id,
          reviewId: submissionReviewAnnotations.reviewId,
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
        .from(submissionReviewAnnotations)
        .where(
          and(
            eq(
              submissionReviewAnnotations.organizationId,
              organizationId,
            ),
            eq(submissionReviewAnnotations.submissionId, id),
            inArray(
              submissionReviewAnnotations.reviewId,
              reviews.map((review) => review.id),
            ),
          ),
        )
        .orderBy(
          asc(submissionReviewAnnotations.sortOrder),
          asc(submissionReviewAnnotations.id),
        )
    : [];
  const annotationsByReview = new Map<
    string,
    ReturnType<typeof submissionReviewAnnotationView>[]
  >();
  for (const annotation of annotationRows) {
    const current = annotationsByReview.get(annotation.reviewId) ?? [];
    current.push(submissionReviewAnnotationView(annotation));
    annotationsByReview.set(annotation.reviewId, current);
  }
  return {
    ...record,
    reviews: reviews.map((review) => ({
      ...review,
      annotations: annotationsByReview.get(review.id) ?? [],
    })),
  };
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleApi(request, { scopes: ["submissions:read"], action: "submission.read", resourceType: "submission" }, async (context) => ({ data: await submissionForOrganization(id, context.organizationId), resourceId: id }));
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleTransactionalApiCommand(
    request,
    {
      scopes: ["submissions:write"],
      action: "submission.delete",
      resourceType: "submission",
      idempotent: true,
    },
    {
      prepare: async () => id,
      execute: async ({ context, tx, activity }, submissionId) => {
        const deleted = await deleteSubmissionAttemptInTransaction(tx, {
          organizationId: context.organizationId,
          submissionId,
        });
        await activity({
          userId: deleted.userId,
          type: "submission.deleted",
          entityType: "submission",
          entityId: deleted.id,
          metadata: {
            blockId: deleted.blockId,
            attemptNumber: deleted.attemptNumber,
          },
        });
        return {
          data: { id: deleted.id, deleted: true },
          resourceId: deleted.id,
        };
      },
    },
  );
}
