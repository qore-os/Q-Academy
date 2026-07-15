import { ApiError } from "@/lib/api/errors";
import {
  apiOptions,
  handleApi,
  handleTransactionalApiCommand,
  parseJson,
} from "@/lib/api/handler";
import { paginationMeta, parsePagination } from "@/lib/api/pagination";
import {
  lessonAvailabilitySubscriptionListQuerySchema,
  lessonAvailabilitySubscriptionMutationSchema,
} from "@/lib/api/schemas";
import {
  lessonAvailabilitySubscriptionDto,
  listLessonAvailabilitySubscriptions,
  subscribeToLessonAvailability,
  unsubscribeFromLessonAvailability,
} from "@/lib/lesson-availability-service";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

export async function GET(request: Request) {
  return handleApi(
    request,
    {
      scopes: ["notifications:read"],
      action: "lesson_availability_subscription.list",
      resourceType: "lesson_availability_subscription",
    },
    async (context) => {
      const url = new URL(request.url);
      const input = lessonAvailabilitySubscriptionListQuerySchema.parse({
        userId: url.searchParams.get("userId") ?? undefined,
        courseId: url.searchParams.get("courseId") ?? undefined,
        lessonId: url.searchParams.get("lessonId") ?? undefined,
        status: url.searchParams.get("status") ?? undefined,
      });
      const pagination = parsePagination(url);
      const rows = await listLessonAvailabilitySubscriptions({
        organizationId: context.organizationId,
        ...input,
        limit: pagination.limit + 1,
        offset: pagination.offset,
      });
      const hasMore = rows.length > pagination.limit;
      const page = hasMore ? rows.slice(0, pagination.limit) : rows;
      return {
        data: page.map(lessonAvailabilitySubscriptionDto),
        meta: {
          pagination: paginationMeta(pagination, page.length, hasMore),
        },
      };
    },
  );
}

export async function POST(request: Request) {
  return handleTransactionalApiCommand(
    request,
    {
      scopes: ["notifications:write"],
      action: "lesson_availability_subscription.create",
      resourceType: "lesson_availability_subscription",
      idempotent: true,
    },
    {
      prepare: () =>
        parseJson(request, lessonAvailabilitySubscriptionMutationSchema),
      execute: async ({ context, tx, activity, webhook }, input) => {
        const result = await subscribeToLessonAvailability(tx, {
          organizationId: context.organizationId,
          ...input,
        });
        if (result.created) {
          await activity({
            type: "lesson.availability.subscribed",
            entityType: "lesson_availability_subscription",
            entityId: result.subscription.id,
            userId: input.userId,
            metadata: {
              courseId: input.courseId,
              lessonId: input.lessonId,
              versionId: result.subscription.subscribedVersionId,
            },
          });
          await webhook("lesson.availability.subscribed", {
            subscriptionId: result.subscription.id,
            userId: input.userId,
            courseId: input.courseId,
            lessonId: input.lessonId,
          });
        }
        return {
          data: lessonAvailabilitySubscriptionDto(result.subscription),
          status: result.created ? 201 : 200,
          resourceId: result.subscription.id,
        };
      },
    },
  );
}

export async function DELETE(request: Request) {
  return handleTransactionalApiCommand(
    request,
    {
      scopes: ["notifications:write"],
      action: "lesson_availability_subscription.delete",
      resourceType: "lesson_availability_subscription",
      idempotent: true,
    },
    {
      prepare: () =>
        parseJson(request, lessonAvailabilitySubscriptionMutationSchema),
      execute: async ({ context, tx, activity, webhook }, input) => {
        const result = await unsubscribeFromLessonAvailability(tx, {
          organizationId: context.organizationId,
          ...input,
        });
        if (result.subscription) {
          await activity({
            type: "lesson.availability.unsubscribed",
            entityType: "lesson_availability_subscription",
            entityId: result.subscription.id,
            userId: input.userId,
            metadata: {
              courseId: input.courseId,
              lessonId: input.lessonId,
            },
          });
          await webhook("lesson.availability.unsubscribed", {
            subscriptionId: result.subscription.id,
            userId: input.userId,
            courseId: input.courseId,
            lessonId: input.lessonId,
          });
        }
        if (!result.subscription) {
          throw new ApiError(
            404,
            "not_found",
            "Aktives Abonnement nicht gefunden.",
          );
        }
        return {
          data: lessonAvailabilitySubscriptionDto(result.subscription),
          resourceId: result.subscription.id,
        };
      },
    },
  );
}
