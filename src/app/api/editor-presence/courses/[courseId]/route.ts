import { z } from "zod";

import { ApiError } from "@/lib/api/errors";
import {
  heartbeatEditorPresence,
  listEditorPresencesForSession,
} from "@/lib/editor-presence-service";
import { editorPresenceHeartbeatSchema } from "@/lib/editor-presence-model";
import {
  handleSessionMediaRequest,
  parseSessionMediaJson,
  sessionMediaData,
} from "@/lib/media/session-api";

export const dynamic = "force-dynamic";
const idSchema = z.string().uuid();

export async function GET(
  request: Request,
  { params }: { params: Promise<{ courseId: string }> },
) {
  const { courseId } = await params;
  return handleSessionMediaRequest(
    request,
    { action: "editor_presence.list" },
    async (user) => {
      if (!idSchema.safeParse(courseId).success) {
        throw new ApiError(404, "not_found", "Kurs nicht gefunden.");
      }
      const presence = await listEditorPresencesForSession(user, courseId);
      return sessionMediaData(request, { presence });
    },
  );
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ courseId: string }> },
) {
  const { courseId } = await params;
  return handleSessionMediaRequest(
    request,
    { mutation: true, action: "editor_presence.heartbeat" },
    async (user) => {
      if (!idSchema.safeParse(courseId).success) {
        throw new ApiError(404, "not_found", "Kurs nicht gefunden.");
      }
      const heartbeat = editorPresenceHeartbeatSchema.parse(
        await parseSessionMediaJson(request),
      );
      const presence = await heartbeatEditorPresence(user, courseId, heartbeat);
      return sessionMediaData(request, { presence });
    },
  );
}
