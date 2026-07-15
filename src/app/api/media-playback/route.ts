import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { mediaAssets, mediaPlaybackProgress } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import {
  consumeGuardedPersistentRateLimit,
  retryAfterSeconds,
} from "@/lib/auth-rate-limit";
import { getCourseLearningAccess } from "@/lib/learning-access";
import { readLimitedRequestText } from "@/lib/limited-request-body";
import {
  playbackWindowMilliseconds,
  playbackPositionAfterRemovedSegment,
  sanitizeVideoPlaybackPolicy,
  sourcePositionToPlaybackOffset,
} from "@/lib/media/video-playback-policy";

export const dynamic = "force-dynamic";

const identitySchema = z.object({
  courseId: z.string().uuid(),
  lessonId: z.string().uuid(),
  blockId: z.string().uuid(),
});
const heartbeatSchema = identitySchema
  .extend({
    positionMs: z.number().int().nonnegative(),
    watchedDeltaMs: z.number().int().min(0).max(10_000),
  })
  .strict();

function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

async function playbackContext(
  user: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>,
  identity: z.infer<typeof identitySchema>,
) {
  const access = await getCourseLearningAccess(db, {
    organizationId: user.organizationId,
    userId: user.id,
    courseId: identity.courseId,
  });
  const lesson = access?.lessons.get(identity.lessonId);
  if (!lesson?.access.canInteract) return null;
  const block = [
    ...lesson.lesson.blocks,
    ...lesson.lesson.pages.flatMap((page) => page.blocks),
  ].find(
    (candidate) =>
      candidate.id === identity.blockId && candidate.type === "video",
  );
  const assetId =
    block && typeof block.data.mediaAssetId === "string"
      ? block.data.mediaAssetId
      : null;
  if (!block || !assetId) return null;
  const policy = sanitizeVideoPlaybackPolicy(block.data.videoPlayback);
  if (policy.completionMode !== "required") return null;
  const [asset] = await db
    .select({ durationMilliseconds: mediaAssets.durationMilliseconds })
    .from(mediaAssets)
    .where(
      and(
        eq(mediaAssets.id, assetId),
        eq(mediaAssets.organizationId, user.organizationId),
        eq(mediaAssets.purpose, "course_content"),
        eq(mediaAssets.status, "ready"),
      ),
    )
    .limit(1);
  const window = playbackWindowMilliseconds(
    policy,
    asset?.durationMilliseconds ?? null,
  );
  return window && asset?.durationMilliseconds
    ? {
        assetId,
        policy,
        window,
        durationMilliseconds: asset.durationMilliseconds,
      }
    : null;
}

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return json({ error: "Bitte melde dich erneut an." }, 401);
  const url = new URL(request.url);
  const identity = identitySchema.safeParse({
    courseId: url.searchParams.get("courseId"),
    lessonId: url.searchParams.get("lessonId"),
    blockId: url.searchParams.get("blockId"),
  });
  if (!identity.success) return json({ error: "Ungueltige Wiedergabe." }, 400);
  const context = await playbackContext(user, identity.data);
  if (!context) return json({ error: "Pflichtvideo nicht gefunden." }, 404);
  const [progress] = await db
    .select()
    .from(mediaPlaybackProgress)
    .where(
      and(
        eq(mediaPlaybackProgress.organizationId, user.organizationId),
        eq(mediaPlaybackProgress.userId, user.id),
        eq(mediaPlaybackProgress.courseId, identity.data.courseId),
        eq(mediaPlaybackProgress.lessonId, identity.data.lessonId),
        eq(mediaPlaybackProgress.blockId, identity.data.blockId),
        eq(mediaPlaybackProgress.mediaAssetId, context.assetId),
      ),
    )
    .limit(1);
  return json({
    watchedMilliseconds: progress?.watchedMilliseconds ?? 0,
    furthestMilliseconds: progress?.furthestMilliseconds ?? 0,
    requiredMilliseconds: context.window.requiredMs,
    completed: Boolean(progress?.completedAt),
  });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return json({ error: "Bitte melde dich erneut an." }, 401);
  const raw = await readLimitedRequestText(request, 2_048);
  if (!raw.ok) return json({ error: "Anfrage ist zu gross." }, 413);
  let body: unknown;
  try {
    body = JSON.parse(raw.text);
  } catch {
    return json({ error: "Ungueltige Wiedergabe." }, 400);
  }
  const input = heartbeatSchema.safeParse(body);
  if (!input.success) return json({ error: "Ungueltige Wiedergabe." }, 422);
  const rateLimit = await consumeGuardedPersistentRateLimit({
    guards: [
      {
        action: "media_playback_heartbeat_tenant",
        identifier: user.organizationId,
      },
    ],
    primary: {
      action: "media_playback_heartbeat",
      identifier: `${user.organizationId}\0${user.id}`,
    },
  });
  if (rateLimit.limited) {
    return Response.json(
      { error: "Zu viele Wiedergabeaktualisierungen." },
      {
        status: 429,
        headers: {
          "Cache-Control": "no-store",
          "Retry-After": String(retryAfterSeconds(rateLimit.resetAt)),
        },
      },
    );
  }
  const context = await playbackContext(user, input.data);
  if (!context) return json({ error: "Pflichtvideo nicht gefunden." }, 404);
  if (
    input.data.positionMs < context.window.startMs - 1_000 ||
    input.data.positionMs > context.window.endMs + 1_000
  ) {
    return json({ error: "Wiedergabeposition liegt ausserhalb des Videos." }, 422);
  }
  if (
    playbackPositionAfterRemovedSegment(
      context.policy,
      input.data.positionMs,
    ) !== null
  ) {
    return json({ error: "Wiedergabeposition liegt in einem Schnittbereich." }, 422);
  }

  const result = await db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(mediaPlaybackProgress)
      .where(
        and(
          eq(mediaPlaybackProgress.userId, user.id),
          eq(mediaPlaybackProgress.courseId, input.data.courseId),
          eq(mediaPlaybackProgress.lessonId, input.data.lessonId),
          eq(mediaPlaybackProgress.blockId, input.data.blockId),
        ),
      )
      .limit(1)
      .for("update");
    const now = new Date();
    const matchingCurrent =
      current?.mediaAssetId === context.assetId &&
      current.requiredMilliseconds === context.window.requiredMs
        ? current
        : null;
    const elapsed = matchingCurrent
      ? Math.max(0, now.getTime() - matchingCurrent.updatedAt.getTime())
      : 0;
    const acceptedDelta = matchingCurrent
      ? Math.min(input.data.watchedDeltaMs, elapsed, 10_000)
      : 0;
    const watchedMilliseconds = Math.min(
      context.window.requiredMs,
      (matchingCurrent?.watchedMilliseconds ?? 0) + acceptedDelta,
    );
    const relativePosition = Math.max(
      0,
      Math.min(
        context.window.durationMs,
        sourcePositionToPlaybackOffset(
          context.policy,
          context.durationMilliseconds,
          input.data.positionMs,
        ) ?? 0,
      ),
    );
    const furthestMilliseconds = Math.max(
      matchingCurrent?.furthestMilliseconds ?? 0,
      relativePosition,
    );
    const completedAt =
      matchingCurrent?.completedAt ??
      (watchedMilliseconds >= context.window.requiredMs ? now : null);
    await tx
      .insert(mediaPlaybackProgress)
      .values({
        organizationId: user.organizationId,
        userId: user.id,
        courseId: input.data.courseId,
        lessonId: input.data.lessonId,
        blockId: input.data.blockId,
        mediaAssetId: context.assetId,
        watchedMilliseconds,
        furthestMilliseconds,
        requiredMilliseconds: context.window.requiredMs,
        completedAt,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          mediaPlaybackProgress.userId,
          mediaPlaybackProgress.courseId,
          mediaPlaybackProgress.lessonId,
          mediaPlaybackProgress.blockId,
        ],
        set: {
          organizationId: user.organizationId,
          mediaAssetId: context.assetId,
          watchedMilliseconds,
          furthestMilliseconds,
          requiredMilliseconds: context.window.requiredMs,
          completedAt,
          updatedAt: now,
        },
      });
    return {
      watchedMilliseconds,
      furthestMilliseconds,
      requiredMilliseconds: context.window.requiredMs,
      completed: Boolean(completedAt),
    };
  });
  return json(result);
}
