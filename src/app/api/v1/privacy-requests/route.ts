import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { privacyRequests, users } from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import { apiOptions, handleApi, parseJson } from "@/lib/api/handler";
import { paginationMeta, parsePagination } from "@/lib/api/pagination";
import {
  privacyRequestData,
  privacySubjectData,
} from "@/lib/api/privacy-responses";
import { privacyRequestCreateSchema } from "@/lib/api/schemas";
import {
  createPrivacyRequest,
  PrivacyRequestServiceError,
} from "@/lib/privacy/request-service";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

function rethrowPrivacyServiceError(error: unknown): never {
  if (!(error instanceof PrivacyRequestServiceError)) throw error;
  if (error.code === "not_found") {
    throw new ApiError(404, "not_found", error.message);
  }
  if (error.code === "idempotency_conflict") {
    throw new ApiError(409, "idempotency_conflict", error.message);
  }
  if (error.status === 400) {
    throw new ApiError(400, "bad_request", error.message);
  }
  if (error.status === 409) {
    throw new ApiError(409, "conflict", error.message);
  }
  throw new ApiError(500, "internal_error", error.message);
}

export async function GET(request: Request) {
  return handleApi(
    request,
    {
      scopes: ["privacy:read"],
      action: "privacy_request.list",
      resourceType: "privacy_request",
    },
    async (context) => {
      const pagination = parsePagination(new URL(request.url));
      const records = await db
        .select({
          request: privacyRequests,
          subject: {
            id: users.id,
            email: users.email,
            firstName: users.firstName,
            lastName: users.lastName,
          },
        })
        .from(privacyRequests)
        .leftJoin(
          users,
          and(
            eq(users.id, privacyRequests.subjectUserId),
            eq(users.organizationId, privacyRequests.organizationId),
          ),
        )
        .where(eq(privacyRequests.organizationId, context.organizationId))
        .orderBy(desc(privacyRequests.createdAt))
        .limit(pagination.limit + 1)
        .offset(pagination.offset);
      const hasMore = records.length > pagination.limit;
      const visible = hasMore
        ? records.slice(0, pagination.limit)
        : records;

      return {
        data: visible.map((record) => ({
          ...privacyRequestData(record.request),
          subject: privacySubjectData(record.subject),
        })),
        meta: {
          pagination: paginationMeta(pagination, visible.length, hasMore),
        },
      };
    },
  );
}

export async function POST(request: Request) {
  return handleApi(
    request,
    {
      scopes: ["privacy:write"],
      action: "privacy_request.create",
      resourceType: "privacy_request",
      idempotent: true,
    },
    async (context) => {
      const input = await parseJson(request, privacyRequestCreateSchema);
      const result = await createPrivacyRequest(
        context.organizationId,
        input,
        { kind: "api_key", id: context.apiKeyId },
      ).catch(rethrowPrivacyServiceError);

      return {
        data: privacyRequestData(result.request),
        status: result.created ? 201 : 200,
        resourceId: result.request.id,
        meta: { created: result.created },
      };
    },
  );
}
