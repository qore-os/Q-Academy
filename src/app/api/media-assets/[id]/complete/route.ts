import { after } from "next/server";
import { z } from "zod";

import { handleSessionMediaRequest, sessionMediaData } from "@/lib/media/session-api";
import { processMediaQueues } from "@/lib/media/scan-worker";
import { completeSessionMediaAsset } from "@/lib/media/session-service";
import { logServerError } from "@/lib/server-error-logging";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Context) {
  return handleSessionMediaRequest(
    request,
    { mutation: true, action: "session_media.complete" },
    async (user) => {
      const id = z.string().uuid().parse((await params).id);
      const asset = await completeSessionMediaAsset(user, id);
      if (process.env.NODE_ENV !== "production") {
        after(async () => {
          try {
            await processMediaQueues(1, 1);
          } catch (error) {
            logServerError(error, { action: "session_media.dev_scan" });
          }
        });
      }
      return sessionMediaData(request, asset);
    },
  );
}
