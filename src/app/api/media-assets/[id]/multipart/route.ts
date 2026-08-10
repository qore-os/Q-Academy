import { z } from "zod";

import {
  handleSessionMediaRequest,
  sessionMediaData,
} from "@/lib/media/session-api";
import {
  getSessionMultipartUploadStatus,
  recoverSessionMultipartUploadStatus,
} from "@/lib/media/session-service";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context) {
  return handleSessionMediaRequest(
    request,
    { action: "session_media.multipart.read" },
    async (user) => {
      const id = z.string().uuid().parse((await params).id);
      return sessionMediaData(
        request,
        await getSessionMultipartUploadStatus(user, id),
      );
    },
  );
}

export async function POST(request: Request, { params }: Context) {
  return handleSessionMediaRequest(
    request,
    { mutation: true, action: "session_media.multipart.recover" },
    async (user) => {
      const id = z.string().uuid().parse((await params).id);
      return sessionMediaData(
        request,
        await recoverSessionMultipartUploadStatus(user, id),
      );
    },
  );
}
