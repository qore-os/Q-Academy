import { db } from "@/db";
import { requireActiveApiKeyCreator } from "@/lib/api/api-key-actor";
import {
  lockCourseForVersion,
  publishCourseVersion,
} from "@/lib/api/course-versioning";
import { apiOptions, handleApi, parseJson } from "@/lib/api/handler";
import { coursePublishSchema } from "@/lib/api/schemas";
import { enqueueWebhook } from "@/lib/api/webhooks";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleApi(
    request,
    {
      scopes: ["courses:write"],
      action: "course.publish",
      resourceType: "course",
      idempotent: true,
    },
    async (context) => {
      const input = await parseJson(request, coursePublishSchema);
      const published = await db.transaction(async (transaction) => {
        const actor = await requireActiveApiKeyCreator(transaction, {
          organizationId: context.organizationId,
          apiKeyId: context.apiKeyId,
        });
        const current = await lockCourseForVersion(
          transaction,
          id,
          context.organizationId,
        );
        const publishedAt = new Date();
        const publication = await publishCourseVersion(transaction, {
          organizationId: context.organizationId,
          course: current,
          createdById: actor.id,
          changelog: input.changelog,
          publishedAt,
        });
        await enqueueWebhook(
          context.organizationId,
          "course.published",
          {
            ...publication.course,
            versionId: publication.version.id,
            version: publication.version.version,
            changelog: publication.version.changelog,
            publishedAt,
          },
          transaction,
        );

        return publication;
      });

      return { data: published, status: 201, resourceId: id };
    },
  );
}
