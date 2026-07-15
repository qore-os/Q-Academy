import { desc, eq, and, inArray } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import {
  mediaAssetTranscripts,
  courseMediaAssets,
  mediaAssets,
  mediaProcessingJobs,
} from "@/db/schema";
import { serializeWebVttTranscript } from "@/lib/content-blocks/video-transcript";
import { ApiError } from "@/lib/api/errors";
import { readLimitedRequestText } from "@/lib/limited-request-body";
import { handleSessionMediaRequest } from "@/lib/media/session-api";
import { getSessionMediaAsset } from "@/lib/media/session-service";
import {
  enqueueMediaProcessingJob,
  processMediaProcessingQueue,
} from "@/lib/media/processing-worker";
import { sanitizeVideoEditPlan } from "@/lib/media/video-edit-plan";
import {
  canUseVideoCompositionSource,
  sanitizeVideoComposition,
  videoProcessingOptionsConflict,
} from "@/lib/media/video-composition";
import {
  coursePermissionAllows,
  coursePermissionForUser,
} from "@/lib/course-permissions";

export const dynamic = "force-dynamic";
export const maxDuration = 660;

type Context = { params: Promise<{ id: string }> };

const videoEditSchema = z.unknown().transform((input, context) => {
  const plan = sanitizeVideoEditPlan(input);
  if (!plan) {
    context.addIssue({
      code: "custom",
      message: "Videoschnitt ist ungueltig.",
    });
    return z.NEVER;
  }
  return plan;
});

const videoCompositionSchema = z.unknown().transform((input, context) => {
  const composition = sanitizeVideoComposition(input);
  if (!composition) {
    context.addIssue({
      code: "custom",
      message: "Mehrspur-Komposition ist ungueltig.",
    });
    return z.NEVER;
  }
  return composition;
});

const requestSchema = z
  .object({
    type: z.enum(["thumbnail", "transcode", "transcript"]),
    language: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/)
      .max(35)
      .optional(),
    atMilliseconds: z.number().int().min(0).max(604_800_000).optional(),
    courseId: z.string().uuid().optional(),
    videoEdit: videoEditSchema.optional(),
    videoComposition: videoCompositionSchema.optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.videoEdit && input.type !== "transcode") {
      context.addIssue({
        code: "custom",
        path: ["videoEdit"],
        message: "Videoschnitte sind nur fuer Transcodes erlaubt.",
      });
    }
    if (input.videoComposition && input.type !== "transcode") {
      context.addIssue({
        code: "custom",
        path: ["videoComposition"],
        message: "Mehrspur-Kompositionen sind nur fuer Transcodes erlaubt.",
      });
    }
    if (input.videoComposition && !input.courseId) {
      context.addIssue({
        code: "custom",
        path: ["courseId"],
        message: "Mehrspur-Kompositionen benoetigen einen Kurskontext.",
      });
    }
    if (videoProcessingOptionsConflict(input)) {
      context.addIssue({
        code: "custom",
        path: ["videoComposition"],
        message:
          "Mehrspur-Kompositionen und physische Videoschnitte duerfen nicht kombiniert werden.",
      });
    }
  });

async function assertCompositionCourseSources(input: {
  user: Parameters<typeof getSessionMediaAsset>[0];
  courseId: string;
  primaryAssetId: string;
  composition: NonNullable<ReturnType<typeof sanitizeVideoComposition>>;
}) {
  const permission = await coursePermissionForUser(input.user, input.courseId);
  if (!coursePermissionAllows(permission, "edit")) {
    throw new ApiError(
      403,
      "forbidden",
      "Keine Bearbeitungsrechte fuer diesen Kurs.",
    );
  }
  const assetIds = [
    ...new Set([
      input.primaryAssetId,
      ...input.composition.audioTracks.map((track) => track.mediaAssetId),
    ]),
  ];
  const rows = await db
    .select({
      id: mediaAssets.id,
      uploadedById: mediaAssets.uploadedById,
      courseId: courseMediaAssets.courseId,
    })
    .from(mediaAssets)
    .leftJoin(
      courseMediaAssets,
      and(
        eq(courseMediaAssets.organizationId, mediaAssets.organizationId),
        eq(courseMediaAssets.mediaAssetId, mediaAssets.id),
        eq(courseMediaAssets.courseId, input.courseId),
      ),
    )
    .where(
      and(
        eq(mediaAssets.organizationId, input.user.organizationId),
        eq(mediaAssets.purpose, "course_content"),
        eq(mediaAssets.status, "ready"),
        inArray(mediaAssets.id, assetIds),
      ),
    );
  const allBindings = await db
    .select({ mediaAssetId: courseMediaAssets.mediaAssetId })
    .from(courseMediaAssets)
    .where(
      and(
        eq(courseMediaAssets.organizationId, input.user.organizationId),
        inArray(courseMediaAssets.mediaAssetId, assetIds),
      ),
    );
  const boundAnywhere = new Set(
    allBindings.map((binding) => binding.mediaAssetId),
  );
  const allowed = new Set(
    rows
      .filter((row) =>
        canUseVideoCompositionSource({
          role: input.user.role,
          uploadedByActor: row.uploadedById === input.user.id,
          boundToCurrentCourse: row.courseId === input.courseId,
          boundAnywhere: boundAnywhere.has(row.id),
        }),
      )
      .map((row) => row.id),
  );
  if (allowed.size !== assetIds.length) {
    throw new ApiError(
      422,
      "validation_error",
      "Die Mehrspurquellen gehoeren nicht zum Kurs oder sind nicht verfuegbar.",
    );
  }
}

function response(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

async function assertProcessableAsset(
  user: Parameters<typeof getSessionMediaAsset>[0],
  id: string,
) {
  if (!["owner", "admin", "trainer"].includes(user.role)) {
    throw new ApiError(
      403,
      "forbidden",
      "Keine Berechtigung fuer Medienverarbeitung.",
    );
  }
  const asset = await getSessionMediaAsset(user, id);
  if (asset.purpose !== "course_content" || asset.status !== "ready") {
    throw new ApiError(
      422,
      "validation_error",
      "Medium kann nicht verarbeitet werden.",
    );
  }
  return asset;
}

export async function GET(request: Request, { params }: Context) {
  return handleSessionMediaRequest(
    request,
    { action: "session_media.processing.read" },
    async (user) => {
      const id = z
        .string()
        .uuid()
        .parse((await params).id);
      await assertProcessableAsset(user, id);
      const requestedLanguage = new URL(request.url).searchParams.get(
        "language",
      );
      if (
        requestedLanguage !== null &&
        !/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/.test(requestedLanguage)
      ) {
        throw new ApiError(
          422,
          "validation_error",
          "Transkriptsprache ist ungueltig.",
        );
      }
      const jobs = await db
        .select()
        .from(mediaProcessingJobs)
        .where(
          and(
            eq(mediaProcessingJobs.organizationId, user.organizationId),
            eq(mediaProcessingJobs.sourceAssetId, id),
          ),
        )
        .orderBy(desc(mediaProcessingJobs.createdAt))
        .limit(20);
      const [transcript] = await db
        .select({
          language: mediaAssetTranscripts.language,
          document: mediaAssetTranscripts.document,
        })
        .from(mediaAssetTranscripts)
        .where(
          and(
            eq(mediaAssetTranscripts.organizationId, user.organizationId),
            eq(mediaAssetTranscripts.sourceAssetId, id),
            ...(requestedLanguage
              ? [eq(mediaAssetTranscripts.language, requestedLanguage)]
              : []),
          ),
        )
        .orderBy(desc(mediaAssetTranscripts.createdAt))
        .limit(1);
      return response({
        jobs: jobs.map((job) => ({
          id: job.id,
          type: job.type,
          status: job.status,
          failureCode: job.failureCode,
          language:
            job.type === "transcript" &&
            typeof job.options.language === "string"
              ? job.options.language
              : null,
          createdAt: job.createdAt,
          completedAt: job.completedAt,
        })),
        transcript: transcript
          ? {
              language: transcript.language,
              webVtt: serializeWebVttTranscript(transcript.document),
            }
          : null,
      });
    },
  );
}

export async function POST(request: Request, { params }: Context) {
  return handleSessionMediaRequest(
    request,
    { mutation: true, action: "session_media.processing.create" },
    async (user) => {
      const id = z
        .string()
        .uuid()
        .parse((await params).id);
      const asset = await assertProcessableAsset(user, id);
      const raw = await readLimitedRequestText(request, 12_000);
      if (!raw.ok) return response({ error: "Anfrage ist zu gross." }, 413);
      let body: unknown;
      try {
        body = JSON.parse(raw.text);
      } catch {
        return response({ error: "Anfrage ist ungueltig." }, 400);
      }
      const parsed = requestSchema.safeParse(body);
      if (!parsed.success) {
        return response({ error: "Verarbeitungsauftrag ist ungueltig." }, 422);
      }
      const videoEdit = parsed.data.videoEdit
        ? sanitizeVideoEditPlan(
            parsed.data.videoEdit,
            asset.durationMilliseconds ?? null,
          )
        : null;
      if (parsed.data.videoEdit && !videoEdit) {
        return response(
          { error: "Videoschnitt liegt ausserhalb des Mediums." },
          422,
        );
      }
      if (parsed.data.videoComposition && parsed.data.courseId) {
        await assertCompositionCourseSources({
          user,
          courseId: parsed.data.courseId,
          primaryAssetId: id,
          composition: parsed.data.videoComposition,
        });
      }
      const job = await enqueueMediaProcessingJob({
        organizationId: user.organizationId,
        sourceAssetId: id,
        requestedById: user.id,
        type: parsed.data.type,
        compositionCourseId: parsed.data.videoComposition
          ? parsed.data.courseId
          : undefined,
        options:
          parsed.data.type === "transcript"
            ? { language: parsed.data.language ?? "de" }
            : parsed.data.type === "thumbnail"
              ? {
                  width: 1_280,
                  height: 720,
                  atMilliseconds: parsed.data.atMilliseconds ?? 0,
                }
              : {
                  videoCodec: "h264",
                  audioCodec: "aac",
                  ...(videoEdit ? { videoEdit } : {}),
                  ...(parsed.data.videoComposition
                    ? { videoComposition: parsed.data.videoComposition }
                    : {}),
                },
      });
      if (process.env.NODE_ENV !== "production" && job.status === "queued") {
        await processMediaProcessingQueue(5);
      }
      return response(
        {
          id: job.id,
          type: job.type,
          status: job.status,
        },
        job.status === "succeeded" ? 200 : 202,
      );
    },
  );
}
