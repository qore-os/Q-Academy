import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { mediaAssetDerivatives, mediaProcessingJobs } from "@/db/schema";
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
  publishedSnapshotReferencesVideoComposition,
} from "@/lib/media/video-composition";
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
      const requestedJobId = new URL(request.url).searchParams.get("job");
      const jobId = requestedJobId
        ? z.string().uuid().safeParse(requestedJobId)
        : null;
      if (jobId && !jobId.success) {
        return Response.json(
          { error: "Medienvariante ist ungueltig." },
          { status: 422, headers: { "Cache-Control": "private, no-store" } },
        );
      }
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
              : parsed.kind === "transcode"
                ? [
                    sql`not (${mediaProcessingJobs.options} ? 'videoEdit') and not (${mediaProcessingJobs.options} ? 'videoComposition')`,
                  ]
                : []),
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
        const courseId = z.string().uuid().safeParse(
          derivative.processingOptions.videoCompositionCourseId,
        );
        const access = courseId.success && user.role === "member"
          ? await getCourseLearningAccess(db, {
              organizationId: user.organizationId,
              userId: user.id,
              courseId: courseId.data,
            })
          : null;
        const coursePermission = courseId.success && user.role === "trainer"
          ? await coursePermissionForUser(user, courseId.data)
          : null;
        const publishedReference = Boolean(
          access &&
          publishedSnapshotReferencesVideoComposition(
            access.published.snapshot,
            {
              renderJobId: derivative.processingJobId,
              primaryAssetId: parsed.id,
            },
          ),
        );
        if (
          !courseId.success ||
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
