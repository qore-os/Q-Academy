import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { courseVersions } from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import { apiOptions, handleApi } from "@/lib/api/handler";
import { redactAssessmentAnswerKeys } from "@/lib/assessment-engine";
import { safeCourseCoverSource } from "@/lib/course-cover";
import { sanitizeCourseSnapshotAvatarSources } from "@/lib/avatar-policy";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; versionId: string }> },
) {
  const { id, versionId } = await params;
  return handleApi(
    request,
    {
      scopes: ["courses:read"],
      action: "course.version.read",
      resourceType: "course_version",
    },
    async (context) => {
      const [version] = await db
        .select()
        .from(courseVersions)
        .where(
          and(
            eq(courseVersions.id, versionId),
            eq(courseVersions.courseId, id),
            eq(courseVersions.organizationId, context.organizationId),
          ),
        )
        .limit(1);
      if (!version) throw new ApiError(404, "not_found", "Kursversion nicht gefunden.");

      const snapshot = sanitizeCourseSnapshotAvatarSources(
        redactAssessmentAnswerKeys(version.snapshot),
      );

      return {
        data: {
          ...version,
          snapshot: {
            ...snapshot,
            course: {
              ...snapshot.course,
              coverImage: safeCourseCoverSource(
                snapshot.course.coverImage,
              ),
            },
          },
        },
        resourceId: version.id,
      };
    },
  );
}
