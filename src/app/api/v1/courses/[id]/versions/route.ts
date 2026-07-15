import { and, asc, desc, eq, isNotNull, isNull } from "drizzle-orm";

import { db } from "@/db";
import { courses, courseVersions } from "@/db/schema";
import {
  insertCourseVersion,
  lockCourseForVersion,
} from "@/lib/api/course-versioning";
import { ApiError } from "@/lib/api/errors";
import { apiOptions, handleApi, parseJson } from "@/lib/api/handler";
import { paginationMeta, parsePagination } from "@/lib/api/pagination";
import { courseVersionCreateSchema } from "@/lib/api/schemas";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

async function assertCourse(id: string, organizationId: string) {
  const [course] = await db
    .select({ id: courses.id })
    .from(courses)
    .where(and(eq(courses.id, id), eq(courses.organizationId, organizationId)))
    .limit(1);
  if (!course) throw new ApiError(404, "not_found", "Kurs nicht gefunden.");
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleApi(
    request,
    {
      scopes: ["courses:read"],
      action: "course.version.list",
      resourceType: "course_version",
    },
    async (context) => {
      await assertCourse(id, context.organizationId);
      const url = new URL(request.url);
      const pagination = parsePagination(url);
      const published = url.searchParams.get("published");
      const conditions = [
        eq(courseVersions.organizationId, context.organizationId),
        eq(courseVersions.courseId, id),
      ];
      if (published === "true") conditions.push(isNotNull(courseVersions.publishedAt));
      if (published === "false") conditions.push(isNull(courseVersions.publishedAt));

      const rows = await db
        .select({
          id: courseVersions.id,
          courseId: courseVersions.courseId,
          version: courseVersions.version,
          changelog: courseVersions.changelog,
          publishedAt: courseVersions.publishedAt,
          createdById: courseVersions.createdById,
          createdAt: courseVersions.createdAt,
        })
        .from(courseVersions)
        .where(and(...conditions))
        .orderBy(desc(courseVersions.version), asc(courseVersions.id))
        .limit(pagination.limit + 1)
        .offset(pagination.offset);
      const hasMore = rows.length > pagination.limit;
      const data = hasMore ? rows.slice(0, pagination.limit) : rows;

      return {
        data,
        meta: { pagination: paginationMeta(pagination, data.length, hasMore) },
        resourceId: id,
      };
    },
  );
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleApi(
    request,
    {
      scopes: ["courses:write"],
      action: "course.version.create",
      resourceType: "course_version",
      idempotent: true,
    },
    async (context) => {
      const input = await parseJson(request, courseVersionCreateSchema);
      const version = await db.transaction(async (transaction) => {
        const course = await lockCourseForVersion(
          transaction,
          id,
          context.organizationId,
        );
        const capturedAt = new Date();
        return insertCourseVersion(transaction, {
          organizationId: context.organizationId,
          course,
          changelog: input.changelog,
          capturedAt,
          publishedAt: null,
        });
      });

      return { data: version, status: 201, resourceId: version.id };
    },
  );
}
