import {
  and,
  asc,
  desc,
  eq,
  ilike,
  inArray,
  or,
  type SQL,
} from "drizzle-orm";
import { db } from "@/db";
import { courseModules, courses, feedbackEntries, lessons, modules, users } from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import {
  apiOptions,
  handleApi,
  handleTransactionalApiCommand,
  parseJson,
} from "@/lib/api/handler";
import { paginationMeta, parsePagination } from "@/lib/api/pagination";
import { feedbackCreateSchema } from "@/lib/api/schemas";
import {
  createMemberCourseFeedbackInTransaction,
  createMemberLessonFeedbackInTransaction,
} from "@/lib/feedback-service";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

export async function GET(request: Request) {
  return handleApi(request, { scopes: ["feedback:read"], action: "feedback.list", resourceType: "feedback" }, async (context) => {
    const url = new URL(request.url);
    const pagination = parsePagination(url);
    const conditions: SQL[] = [eq(feedbackEntries.organizationId, context.organizationId)];
    const status = url.searchParams.get("status");
    const type = url.searchParams.get("type");
    const courseId = url.searchParams.get("courseId");
    const userId = url.searchParams.get("userId");
    const search = url.searchParams.get("search")?.trim();
    const sort = url.searchParams.get("sort") ?? "latest";
    if (status === "open") conditions.push(eq(feedbackEntries.status, "new"));
    else if (status === "completed") {
      conditions.push(inArray(feedbackEntries.status, ["reviewed", "archived"]));
    } else if (status && ["new", "reviewed", "archived"].includes(status)) conditions.push(eq(feedbackEntries.status, status as "new" | "reviewed" | "archived"));
    if (type) conditions.push(eq(feedbackEntries.type, type));
    if (courseId) conditions.push(eq(feedbackEntries.courseId, courseId));
    if (userId) conditions.push(eq(feedbackEntries.userId, userId));
    if (search) {
      const pattern = `%${search}%`;
      conditions.push(
        or(
          ilike(feedbackEntries.content, pattern),
          ilike(users.firstName, pattern),
          ilike(users.lastName, pattern),
          ilike(users.email, pattern),
        )!,
      );
    }
    const orderBy =
      sort === "name"
        ? [asc(users.lastName), asc(users.firstName), desc(feedbackEntries.createdAt)]
        : sort === "rating_asc"
          ? [asc(feedbackEntries.rating), desc(feedbackEntries.createdAt)]
          : sort === "rating_desc"
            ? [desc(feedbackEntries.rating), desc(feedbackEntries.createdAt)]
            : [desc(feedbackEntries.createdAt), desc(feedbackEntries.id)];
    const rows = await db
      .select({
        id: feedbackEntries.id,
        type: feedbackEntries.type,
        rating: feedbackEntries.rating,
        content: feedbackEntries.content,
        testimonialConsent: feedbackEntries.testimonialConsent,
        status: feedbackEntries.status,
        reviewedById: feedbackEntries.reviewedById,
        reviewedAt: feedbackEntries.reviewedAt,
        createdAt: feedbackEntries.createdAt,
        userId: users.id,
        userFirstName: users.firstName,
        userLastName: users.lastName,
        userEmail: users.email,
        courseId: courses.id,
        courseTitle: courses.title,
        lessonId: feedbackEntries.lessonId,
        lessonTitle: lessons.title,
      })
      .from(feedbackEntries)
      .innerJoin(users, and(eq(users.id, feedbackEntries.userId), eq(users.organizationId, context.organizationId)))
      .leftJoin(courses, and(eq(courses.id, feedbackEntries.courseId), eq(courses.organizationId, context.organizationId)))
      .leftJoin(lessons, and(eq(lessons.id, feedbackEntries.lessonId), eq(lessons.organizationId, context.organizationId)))
      .where(and(...conditions))
      .orderBy(...orderBy)
      .limit(pagination.limit + 1)
      .offset(pagination.offset);
    const hasMore = rows.length > pagination.limit;
    const data = hasMore ? rows.slice(0, pagination.limit) : rows;
    return { data, meta: { pagination: paginationMeta(pagination, data.length, hasMore) } };
  });
}

export async function POST(request: Request) {
  return handleTransactionalApiCommand(
    request,
    {
      scopes: ["feedback:write"],
      action: "feedback.create",
      resourceType: "feedback",
      idempotent: true,
    },
    {
      prepare: () => parseJson(request, feedbackCreateSchema),
      execute: async ({ context, tx, activity, webhook }, input) => {
        const [member] = await tx
          .select({ id: users.id })
          .from(users)
          .where(
            and(
              eq(users.id, input.userId),
              eq(users.organizationId, context.organizationId),
              eq(users.status, "active"),
              eq(users.role, "member"),
            ),
          )
          .limit(1);
        if (!member) {
          throw new ApiError(404, "not_found", "Mitglied nicht gefunden.");
        }
        if (input.courseId) {
          const [course] = await tx
            .select({ id: courses.id })
            .from(courses)
            .where(
              and(
                eq(courses.id, input.courseId),
                eq(courses.organizationId, context.organizationId),
              ),
            )
            .limit(1);
          if (!course) {
            throw new ApiError(404, "not_found", "Kurs nicht gefunden.");
          }
        }
        if (input.lessonId) {
          const [lesson] = await tx
            .select({ id: lessons.id })
            .from(lessons)
            .innerJoin(
              modules,
              and(
                eq(modules.id, lessons.moduleId),
                eq(modules.organizationId, context.organizationId),
              ),
            )
            .leftJoin(courseModules, eq(courseModules.moduleId, modules.id))
            .where(
              and(
                eq(lessons.id, input.lessonId),
                ...(input.courseId
                  ? [eq(courseModules.courseId, input.courseId)]
                  : []),
              ),
            )
            .limit(1);
          if (!lesson) {
            throw new ApiError(404, "not_found", "Lektion nicht gefunden.");
          }
        }
        let feedback;
        if (input.type === "lesson") {
          feedback = await createMemberLessonFeedbackInTransaction(tx, {
                organizationId: context.organizationId,
                userId: input.userId,
                courseId: input.courseId!,
                lessonId: input.lessonId!,
                rating: input.rating,
                content: input.content,
              });
        } else if (input.type === "course") {
          feedback = await createMemberCourseFeedbackInTransaction(tx, {
            organizationId: context.organizationId,
            userId: input.userId,
            courseId: input.courseId!,
            rating: input.rating,
            content: input.content,
            testimonialConsent: input.testimonialConsent,
          });
        } else {
          [feedback] = await tx
            .insert(feedbackEntries)
            .values({ ...input, organizationId: context.organizationId })
            .returning();
        }
        await activity({
          type: "feedback.created",
          entityType: "feedback",
          entityId: feedback.id,
          userId: input.userId,
          metadata: {
            rating: feedback.rating,
            feedbackType: feedback.type,
            courseId: feedback.courseId,
            lessonId: feedback.lessonId,
          },
        });
        await webhook("feedback.created", feedback);
        return { data: feedback, status: 201, resourceId: feedback.id };
      },
    },
  );
}
