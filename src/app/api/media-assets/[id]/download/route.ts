import { z } from "zod";

import { handleSessionMediaRequest } from "@/lib/media/session-api";
import { getSessionMediaDownload } from "@/lib/media/session-service";
import { mediaDownloadResponse } from "@/lib/media/download-response";

export const dynamic = "force-dynamic";
export const maxDuration = 720;

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context) {
  return handleSessionMediaRequest(
    request,
    { action: "session_media.download" },
    async (user) => {
      const id = z.string().uuid().parse((await params).id);
      const rangeHeader = request.headers.get("range");
      const asset = await getSessionMediaDownload(user, id, {
        audit:
          rangeHeader === null || /^bytes=0-(?:\d*)$/i.test(rangeHeader.trim()),
      });
      const requestUrl = new URL(request.url);
      const disposition =
        asset.kind !== "document" &&
        (asset.purpose === "course_content" ||
          requestUrl.searchParams.get("disposition") === "inline")
          ? "inline"
          : "attachment";
      return mediaDownloadResponse({
        request,
        asset,
        disposition,
        cacheControl: "private, no-store",
      });
    },
  );
}
