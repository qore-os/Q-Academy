import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import {
  contentBlocks,
  courseMediaAssets,
  courseModules,
  lessons,
  mediaAssetDerivatives,
  mediaProcessingJobs,
} from "@/db/schema";
import { InvalidHttpByteRangeError, parseHttpByteRange } from "@/lib/media/http-byte-range";
import { handleSessionMediaRequest } from "@/lib/media/session-api";
import { getSessionMediaDownload } from "@/lib/media/session-service";
import {
  createMediaDownloadAuthorization,
  getFilesystemMediaObjectForDownload,
  getS3MediaObjectForDownload,
  mediaS3DownloadsRequireProxy,
} from "@/lib/media/storage";
import { getCourseLearningAccess } from "@/lib/learning-access";
import {
  canDownloadVideoCompositionDerivative,
} from "@/lib/media/video-composition";
import { accessibleLessonsReferenceVideoComposition } from "@/lib/media/course-media-access-policy";
import { videoThumbnailLookup } from "@/lib/media/video-poster";
import { coursePermissionForUser } from "@/lib/course-permissions";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string; kind: string }> };

function streamBody(body: AsyncIterable<Uint8Array>) {
  const iterator = body[Symbol.asyncIterator]();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const result = await iterator.next();
        if (result.done) controller.close();
        else controller.enqueue(result.value);
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel() {
      await iterator.return?.();
    },
  });
}

export async function GET(request: Request, { params }: Context) {
  return handleSessionMediaRequest(
    request,
    { action: "session_media.derivative.download" },
    async (user) => {
      const parsed = z
        .object({
          id: z.string().uuid(),
          kind: z.enum(["thumbnail", "transcode"]),
        })
        .parse(await params);
      const searchParams = new URL(request.url).searchParams;
      const requestedJobId = searchParams.get("job");
      const jobId = requestedJobId
        ? z.string().uuid().safeParse(requestedJobId)
        : null;
      if (jobId && !jobId.success) {
        return Response.json(
          { error: "Medienvariante ist ungueltig." },
          { status: 422, headers: { "Cache-Control": "private, no-store" } },
        );
      }
      const requestedAtMilliseconds = searchParams.get("atMilliseconds");
      const atMilliseconds = requestedAtMilliseconds === null
        ? null
        : z.coerce
            .number()
            .int()
            .min(0)
            .max(604_800_000)
            .safeParse(requestedAtMilliseconds);
      if (
        (atMilliseconds && !atMilliseconds.success) ||
        (requestedAtMilliseconds !== null && parsed.kind !== "thumbnail") ||
        (requestedJobId !== null && requestedAtMilliseconds !== null)
      ) {
        return Response.json(
          { error: "Medienvariante ist ungueltig." },
          { status: 422, headers: { "Cache-Control": "private, no-store" } },
        );
      }
      const thumbnailLookup = videoThumbnailLookup(
        atMilliseconds?.success ? atMilliseconds.data : null,
      );
      await getSessionMediaDownload(user, parsed.id, { audit: false });
      const [derivative] = await db
        .select({
          derivative: mediaAssetDerivatives,
          processingJobId: mediaProcessingJobs.id,
          processingOptions: mediaProcessingJobs.options,
        })
        .from(mediaAssetDerivatives)
        .innerJoin(
          mediaProcessingJobs,
          and(
            eq(mediaProcessingJobs.id, mediaAssetDerivatives.processingJobId),
            eq(
              mediaProcessingJobs.organizationId,
              mediaAssetDerivatives.organizationId,
            ),
          ),
        )
        .where(
          and(
            eq(mediaAssetDerivatives.organizationId, user.organizationId),
            eq(mediaAssetDerivatives.sourceAssetId, parsed.id),
            eq(mediaAssetDerivatives.kind, parsed.kind),
            ...(jobId?.success
              ? [eq(mediaProcessingJobs.id, jobId.data)]
              : thumbnailLookup.kind === "exact"
                ? [
                    sql`${mediaProcessingJobs.options} ->> 'atMilliseconds' = ${String(thumbnailLookup.atMilliseconds)}`,
                  ]
              : parsed.kind === "transcode"
                ? [
                    sql`not (${mediaProcessingJobs.options} ? 'videoEdit') and not (${mediaProcessingJobs.options} ? 'videoComposition')`,
                  ]
                : [
                    sql`(not (${mediaProcessingJobs.options} ? 'atMilliseconds') or ${mediaProcessingJobs.options} -> 'atMilliseconds' = '0'::jsonb)`,
                  ]),
          ),
        )
        .orderBy(desc(mediaAssetDerivatives.createdAt))
        .limit(1);
      if (!derivative) {
        return Response.json(
          { error: "Medienvariante nicht verfuegbar." },
          { status: 404, headers: { "Cache-Control": "private, no-store" } },
        );
      }
      if (jobId?.success && derivative.processingOptions.videoComposition) {
        const legacyCourseId = z.string().uuid().safeParse(
          derivative.processingOptions.videoCompositionCourseId,
        );
        const blockId = z.string().uuid().safeParse(
          derivative.processingOptions.videoCompositionBlockId,
        );
        let coursePermission: "view" | "edit" | "manage" | null = null;
        let publishedReference = false;
        if (user.role === "trainer") {
          const liveCourseIds = blockId.success
            ? await db
                .select({ courseId: courseModules.courseId })
                .from(contentBlocks)
                .innerJoin(lessons, eq(lessons.id, contentBlocks.lessonId))
                .innerJoin(
                  courseModules,
                  and(
                    eq(courseModules.moduleId, lessons.moduleId),
                    eq(courseModules.organizationId, user.organizationId),
                  ),
                )
                .where(
                  and(
                    eq(contentBlocks.id, blockId.data),
                    eq(lessons.organizationId, user.organizationId),
                  ),
                )
            : legacyCourseId.success
              ? [{ courseId: legacyCourseId.data }]
              : [];
          const permissions = await Promise.all(
            [...new Set(liveCourseIds.map((row) => row.courseId))].map(
              (courseId) => coursePermissionForUser(user, courseId),
            ),
          );
          coursePermission =
            permissions.find(
              (permission) =>
                permission === "edit" || permission === "manage",
            ) ?? null;
        } else if (user.role === "member") {
          const courseBindings = await db
            .select({ courseId: courseMediaAssets.courseId })
            .from(courseMediaAssets)
            .where(
              and(
                eq(courseMediaAssets.organizationId, user.organizationId),
                eq(courseMediaAssets.mediaAssetId, parsed.id),
              ),
            )
            .limit(100);
          for (const courseId of new Set(
            courseBindings.map((binding) => binding.courseId),
          )) {
            const access = await getCourseLearningAccess(db, {
              organizationId: user.organizationId,
              userId: user.id,
              courseId,
            });
            if (
              access &&
              accessibleLessonsReferenceVideoComposition(
                access.lessons.values(),
                {
                  renderJobId: derivative.processingJobId,
                  primaryAssetId: parsed.id,
                  ...(blockId.success ? { blockId: blockId.data } : {}),
                },
              )
            ) {
              publishedReference = true;
              break;
            }
          }
        }
        if (
          (!blockId.success && !legacyCourseId.success) ||
          !canDownloadVideoCompositionDerivative({
            role: user.role,
            coursePermission,
            publishedReference,
          })
        ) {
          return Response.json(
            { error: "Medienvariante nicht verfuegbar." },
            {
              status: 404,
              headers: { "Cache-Control": "private, no-store" },
            },
          );
        }
      }
      const record = derivative.derivative;
      let range;
      try {
        range = parseHttpByteRange(
          request.headers.get("range"),
          record.sizeBytes,
        );
      } catch (error) {
        if (!(error instanceof InvalidHttpByteRangeError)) throw error;
        return new Response(null, {
          status: 416,
          headers: {
            "Accept-Ranges": "bytes",
            "Cache-Control": "private, no-store",
            "Content-Range": `bytes */${record.sizeBytes}`,
            "X-Content-Type-Options": "nosniff",
          },
        });
      }
      const identity = {
        organizationId: record.organizationId,
        assetId: record.sourceAssetId,
        key: record.storageKey,
      };
      if (record.storageDriver === "s3" && !mediaS3DownloadsRequireProxy()) {
        const authorization = await createMediaDownloadAuthorization({
          identity,
          safeFileName:
            record.kind === "thumbnail" ? "thumbnail.jpg" : "video.mp4",
          disposition: "inline",
          storageVersionId: record.storageVersionId,
          expectedEtag: record.storageEtag,
          expectedSha256: record.contentSha256,
          expectedSizeBytes: record.sizeBytes,
          expectedMimeType: record.mimeType,
        });
        return Response.redirect(authorization.url, 307);
      }
      let stored;
      if (record.storageDriver === "s3") {
        if (!record.storageVersionId || !record.storageEtag) {
          throw new Error(
            "Stored STRATO derivative has no immutable object identity.",
          );
        }
        stored = await getS3MediaObjectForDownload({
            identity,
            versionId: record.storageVersionId,
            expectedEtag: record.storageEtag,
            expectedSha256: record.contentSha256,
            expectedSizeBytes: record.sizeBytes,
            expectedMimeType: record.mimeType,
            range: range ?? undefined,
          });
      } else {
        stored = await getFilesystemMediaObjectForDownload(
          identity,
          range ?? undefined,
        );
      }
      if (stored.sizeBytes !== record.sizeBytes) {
        throw new Error("Stored derivative does not match its immutable record.");
      }
      const responseSize = "responseSize" in stored
        ? stored.responseSize
        : range
          ? range.end - range.start + 1
          : record.sizeBytes;
      return new Response(streamBody(stored.body), {
        status: range ? 206 : 200,
        headers: {
          "Accept-Ranges": "bytes",
          "Cache-Control": "private, no-store",
          "Content-Length": String(responseSize),
          "Content-Type": record.mimeType,
          "Content-Disposition": "inline",
          ...(range
            ? {
                "Content-Range": `bytes ${range.start}-${range.end}/${record.sizeBytes}`,
              }
            : {}),
          "X-Content-Type-Options": "nosniff",
          "X-Media-Processing-Job": record.processingJobId,
        },
      });
    },
  );
}
