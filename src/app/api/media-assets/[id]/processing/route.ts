import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import {
  mediaAssetTranscripts,
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
  sanitizeVideoComposition,
  videoProcessingOptionsConflict,
} from "@/lib/media/video-composition";
import {
  assertManageableSharedCourseMedia,
  assertVideoBlockPrimaryAssetContext,
} from "@/lib/media/shared-course-media";
import { requireSharedModuleContentPermission } from "@/lib/shared-module-permissions";

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
    courseId: z.string().uuid(),
    blockId: z.string().uuid(),
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
    if (input.atMilliseconds !== undefined && input.type !== "thumbnail") {
      context.addIssue({
        code: "custom",
        path: ["atMilliseconds"],
        message: "Ein Frame-Zeitpunkt ist nur fuer Vorschaubilder erlaubt.",
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

async function assertSharedVideoProcessingSources(input: {
  user: Parameters<typeof getSessionMediaAsset>[0];
  courseId: string;
  blockId: string;
  primaryAssetId: string;
  composition?: NonNullable<ReturnType<typeof sanitizeVideoComposition>>;
}) {
  await db.transaction(async (transaction) => {
    const shared = await requireSharedModuleContentPermission(
      transaction,
      input.user,
      input.courseId,
      { type: "block", id: input.blockId },
    );
    await assertVideoBlockPrimaryAssetContext(transaction, {
      blockId: input.blockId,
      primaryAssetId: input.primaryAssetId,
    });
    await assertManageableSharedCourseMedia(transaction, input.user, {
      referencedCourseIds: shared.referencedCourseIds,
      references: new Map<string, "video" | "audio">([
        [input.primaryAssetId, "video"],
        ...(input.composition?.audioTracks.map(
          (track) => [track.mediaAssetId, "audio"] as const,
        ) ?? []),
      ]),
    });
  });
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
          atMilliseconds:
            job.type === "thumbnail" &&
            Number.isSafeInteger(job.options.atMilliseconds)
              ? Number(job.options.atMilliseconds)
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
      if (
        parsed.data.atMilliseconds !== undefined &&
        (!asset.durationMilliseconds ||
          parsed.data.atMilliseconds >= asset.durationMilliseconds)
      ) {
        return response(
          { error: "Der Frame-Zeitpunkt liegt ausserhalb des Videos." },
          422,
        );
      }
      await assertSharedVideoProcessingSources({
        user,
        courseId: parsed.data.courseId,
        blockId: parsed.data.blockId,
        primaryAssetId: id,
        ...(parsed.data.videoComposition
          ? { composition: parsed.data.videoComposition }
          : {}),
      });
      if (parsed.data.type === "thumbnail") {
        if (asset.kind !== "video") {
          return response({ error: "Vorschaubilder benoetigen ein Video." }, 422);
        }
      }
      const job = await enqueueMediaProcessingJob({
        organizationId: user.organizationId,
        sourceAssetId: id,
        requestedById: user.id,
        type: parsed.data.type,
        compositionCourseId: parsed.data.videoComposition
          ? parsed.data.courseId
          : undefined,
        compositionBlockId: parsed.data.videoComposition
          ? parsed.data.blockId
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
          atMilliseconds:
            job.type === "thumbnail" &&
            Number.isSafeInteger(job.options.atMilliseconds)
              ? Number(job.options.atMilliseconds)
              : null,
        },
        job.status === "succeeded" ? 200 : 202,
      );
    },
  );
}
