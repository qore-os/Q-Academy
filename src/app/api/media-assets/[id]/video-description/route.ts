import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import {
  activityEvents,
  mediaAssetTranscripts,
  mediaProcessingJobs,
} from "@/db/schema";
import { generateVideoDescription } from "@/lib/ai/video-description-provider";
import { ApiError } from "@/lib/api/errors";
import {
  clearPersistentRateLimit,
  consumeGuardedPersistentRateLimit,
  consumePersistentRateLimit,
  retryAfterSeconds,
} from "@/lib/auth-rate-limit";
import { sanitizeVideoTranscriptDocument } from "@/lib/content-blocks/video-transcript";
import { readLimitedRequestText } from "@/lib/limited-request-body";
import {
  assertManageableSharedCourseMedia,
  assertVideoBlockPrimaryAssetContext,
} from "@/lib/media/shared-course-media";
import {
  AUTOMATIC_TRANSCRIPTION_LANGUAGE_PATTERN,
  TRANSCRIPT_PROCESSING_PROVIDER,
  automaticTranscriptionDurationSupported,
} from "@/lib/media/transcription-contract";
import { logServerError } from "@/lib/server-error-logging";
import { privacySubjectReference } from "@/lib/privacy/subject-reference";
import {
  acquireProviderCircuitPermission,
  recordProviderCircuitFailure,
  recordProviderCircuitSuccess,
} from "@/lib/provider-circuit-breaker";
import { requireSharedModuleContentPermission } from "@/lib/shared-module-permissions";
import { handleSessionMediaRequest } from "@/lib/media/session-api";
import { getSessionMediaAsset } from "@/lib/media/session-service";

export const dynamic = "force-dynamic";
export const maxDuration = 45;

type Context = { params: Promise<{ id: string }> };

const requestSchema = z
  .object({
    courseId: z.string().uuid(),
    blockId: z.string().uuid(),
    locale: z.enum(["de", "en", "it", "es", "fr"]),
    transcriptLanguage: z
      .string()
      .regex(AUTOMATIC_TRANSCRIPTION_LANGUAGE_PATTERN),
  })
  .strict();

function response(data: unknown, status = 200, headers?: HeadersInit) {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "private, no-store", ...headers },
  });
}

export async function POST(request: Request, { params }: Context) {
  return handleSessionMediaRequest(
    request,
    { mutation: true, action: "session_media.video_description.create" },
    async (user) => {
      const id = z.string().uuid().parse((await params).id);
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
        return response({ error: "Anfrage ist ungueltig." }, 422);
      }
      const blockTitle = await db.transaction(async (transaction) => {
        const shared = await requireSharedModuleContentPermission(
          transaction,
          user,
          parsed.data.courseId,
          { type: "block", id: parsed.data.blockId },
        );
        const block = await assertVideoBlockPrimaryAssetContext(
          transaction,
          { blockId: parsed.data.blockId, primaryAssetId: id },
        );
        await assertManageableSharedCourseMedia(transaction, user, {
          referencedCourseIds: shared.referencedCourseIds,
          references: new Map([[id, "video"]]),
        });
        return block.title ?? "";
      });
      const asset = await getSessionMediaAsset(user, id);
      if (
        asset.purpose !== "course_content" ||
        asset.kind !== "video" ||
        asset.status !== "ready" ||
        !automaticTranscriptionDurationSupported(asset.durationMilliseconds)
      ) {
        throw new ApiError(
          422,
          "validation_error",
          "Das Video ist nicht fuer eine Beschreibung verfuegbar.",
        );
      }
      const [processedTranscript] = await db
        .select({
          document: mediaAssetTranscripts.document,
          sourceContentSha256: mediaAssetTranscripts.sourceContentSha256,
        })
        .from(mediaAssetTranscripts)
        .innerJoin(
          mediaProcessingJobs,
          and(
            eq(mediaProcessingJobs.id, mediaAssetTranscripts.processingJobId),
            eq(
              mediaProcessingJobs.organizationId,
              mediaAssetTranscripts.organizationId,
            ),
            eq(
              mediaProcessingJobs.sourceAssetId,
              mediaAssetTranscripts.sourceAssetId,
            ),
            eq(
              mediaProcessingJobs.sourceContentSha256,
              mediaAssetTranscripts.sourceContentSha256,
            ),
          ),
        )
        .where(
          and(
            eq(mediaAssetTranscripts.organizationId, user.organizationId),
            eq(mediaAssetTranscripts.sourceAssetId, id),
            eq(mediaAssetTranscripts.sourceContentSha256, asset.contentSha256!),
            eq(mediaAssetTranscripts.language, parsed.data.transcriptLanguage),
            eq(mediaProcessingJobs.type, "transcript"),
            eq(mediaProcessingJobs.status, "succeeded"),
            eq(mediaProcessingJobs.provider, TRANSCRIPT_PROCESSING_PROVIDER),
          ),
        )
        .orderBy(desc(mediaAssetTranscripts.createdAt))
        .limit(1);
      const transcript = sanitizeVideoTranscriptDocument(
        processedTranscript?.document,
      );
      if (
        !transcript ||
        !asset.contentSha256 ||
        processedTranscript?.sourceContentSha256 !== asset.contentSha256 ||
        transcript.segments.some(
          (segment) =>
            segment.endMs > asset.durationMilliseconds! + 2_000,
        )
      ) {
        throw new ApiError(
          422,
          "validation_error",
          "Das fertige Transkript ist ungueltig.",
        );
      }

      const rateIdentifier = `${user.organizationId}\0${user.id}`;
      const circuit = await acquireProviderCircuitPermission({
        providerKey: "ai-compatible",
      });
      if (!circuit.allowed) {
        return response(
          { error: "Der KI-Dienst ist voruebergehend nicht verfuegbar." },
          503,
          { "Retry-After": String(retryAfterSeconds(circuit.retryAt)) },
        );
      }
      const concurrent = await consumePersistentRateLimit({
        action: "ai_message_concurrent",
        identifier: rateIdentifier,
      });
      if (concurrent.limited) {
        return response(
          { error: "Eine andere KI-Antwort wird noch erstellt." },
          429,
          { "Retry-After": String(retryAfterSeconds(concurrent.resetAt)) },
        );
      }
      try {
        const quota = await consumeGuardedPersistentRateLimit({
          guards: [
            {
              action: "ai_message_tenant",
              identifier: user.organizationId,
            },
          ],
          primary: { action: "ai_message", identifier: rateIdentifier },
        });
        if (quota.limited) {
          return response(
            { error: "Das KI-Limit ist erreicht." },
            429,
            { "Retry-After": String(retryAfterSeconds(quota.resetAt)) },
          );
        }
        let description: string;
        try {
          description = await generateVideoDescription({
            locale: parsed.data.locale,
            transcript,
            title: blockTitle,
            originalFileName: asset.originalFileName,
            durationMilliseconds: asset.durationMilliseconds,
            safetyIdentifier: privacySubjectReference(
              user.organizationId,
              user.id,
            ),
            signal: request.signal,
          });
        } catch (error) {
          if (request.signal.aborted) {
            return response({ error: "Anfrage wurde abgebrochen." }, 499);
          }
          await recordProviderCircuitFailure({
            providerKey: "ai-compatible",
          }).catch((circuitError) =>
            logServerError(circuitError, {
              action: "session_media.video_description.circuit_failure",
            }),
          );
          logServerError(error, {
            action: "session_media.video_description.provider",
          });
          return response(
            { error: "Die Beschreibung konnte nicht erstellt werden." },
            503,
          );
        }
        await recordProviderCircuitSuccess("ai-compatible").catch((error) =>
          logServerError(error, {
            action: "session_media.video_description.circuit_success",
          }),
        );
        await db.insert(activityEvents).values({
          organizationId: user.organizationId,
          userId: user.id,
          type: "course.video_description.generated",
          entityType: "media_asset",
          entityId: id,
          metadata: {
            courseId: parsed.data.courseId,
            blockId: parsed.data.blockId,
            locale: parsed.data.locale,
            transcriptSegments: transcript.segments.length,
            outputLength: description.length,
          },
        });
        return response({ description });
      } finally {
        await clearPersistentRateLimit({
          action: "ai_message_concurrent",
          identifier: rateIdentifier,
          expectedResetAt: concurrent.resetAt,
        }).catch((error) =>
          logServerError(error, {
            action: "session_media.video_description.concurrency_release",
          }),
        );
      }
    },
  );
}
