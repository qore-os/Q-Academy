import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import {
  consumeGuardedPersistentRateLimit,
  retryAfterSeconds,
} from "@/lib/auth-rate-limit";
import { getLessonReader } from "@/lib/data";
import { searchVideoTranscript } from "@/lib/content-blocks/video-transcript";
import { readLimitedRequestText } from "@/lib/limited-request-body";
import { logServerError } from "@/lib/server-error-logging";
import { getTranscriptSearchSettings } from "@/lib/transcript-search-settings";
import { isTranscriptSearchQueryExcluded } from "@/lib/transcript-search-settings-model";

export const dynamic = "force-dynamic";

const transcriptSearchRequestSchema = z
  .object({
    courseSlug: z
      .string()
      .trim()
      .min(1)
      .max(180)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    lessonId: z.string().uuid(),
    blockId: z.string().uuid(),
    query: z.string().max(500),
  })
  .strict();

function json(data: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(data, { ...init, headers });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return json({ error: "Bitte melde dich erneut an." }, { status: 401 });
  }

  const rawBody = await readLimitedRequestText(request, 4_096).catch(() => null);
  if (rawBody?.ok === false) {
    return json({ error: "Die Suchanfrage ist zu gross." }, { status: 413 });
  }
  if (!rawBody) {
    return json({ error: "Die Suchanfrage ist ungueltig." }, { status: 400 });
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody.text);
  } catch {
    return json({ error: "Die Suchanfrage ist ungueltig." }, { status: 400 });
  }
  const parsed = transcriptSearchRequestSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: "Die Suchanfrage ist ungueltig." }, { status: 400 });
  }

  try {
    const rateLimit = await consumeGuardedPersistentRateLimit({
      guards: [
        {
          action: "transcript_search_tenant",
          identifier: user.organizationId,
        },
      ],
      primary: {
        action: "transcript_search",
        identifier: `${user.organizationId}\0${user.id}`,
      },
    });
    if (rateLimit.limited) {
      return json(
        { error: "Zu viele Suchanfragen." },
        {
          status: 429,
          headers: {
            "Retry-After": String(retryAfterSeconds(rateLimit.resetAt)),
            "X-RateLimit-Limit": String(rateLimit.limit),
            "X-RateLimit-Remaining": String(rateLimit.remaining),
            "X-RateLimit-Reset": String(
              Math.ceil(rateLimit.resetAt.getTime() / 1_000),
            ),
          },
        },
      );
    }

    const lesson = await getLessonReader(
      parsed.data.courseSlug,
      parsed.data.lessonId,
      user.id,
      user.organizationId,
    );
    if (!lesson) {
      return json({ error: "Lektion nicht gefunden." }, { status: 404 });
    }
    const block = [
      ...lesson.blocks,
      ...lesson.pages.flatMap((page) => page.blocks),
    ].find(
      (candidate) =>
        candidate.id === parsed.data.blockId && candidate.type === "video",
    );
    if (!block) {
      return json({ error: "Video nicht gefunden." }, { status: 404 });
    }
    const settings = await getTranscriptSearchSettings(user.organizationId);
    const excluded = isTranscriptSearchQueryExcluded(
      parsed.data.query,
      settings.excludedSearchTerms,
    );
    const segments = excluded
      ? []
      : searchVideoTranscript(block.data.transcript, parsed.data.query).slice(
          0,
          100,
        );
    return json(
      { allowed: !excluded, segments },
      {
        headers: {
          "X-RateLimit-Limit": String(rateLimit.limit),
          "X-RateLimit-Remaining": String(rateLimit.remaining),
          "X-RateLimit-Reset": String(
            Math.ceil(rateLimit.resetAt.getTime() / 1_000),
          ),
        },
      },
    );
  } catch (error) {
    logServerError(error, { action: "transcript_search.check" });
    return json(
      { error: "Die Transkriptsuche ist momentan nicht verfuegbar." },
      { status: 500 },
    );
  }
}
