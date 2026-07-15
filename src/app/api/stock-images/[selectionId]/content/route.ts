import { z } from "zod";

import { ApiError } from "@/lib/api/errors";
import { handleSessionMediaRequest } from "@/lib/media/session-api";
import { downloadStockImageSelectionForSession } from "@/lib/stock-image-service";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ selectionId: string }> };

export async function GET(request: Request, { params }: Context) {
  return handleSessionMediaRequest(
    request,
    { action: "stock_images.materialize" },
    async (user) => {
      const selectionId = z.string().uuid().parse((await params).selectionId);
      const courseId = new URL(request.url).searchParams.get("courseId") ?? "";
      if (!z.string().uuid().safeParse(courseId).success) {
        throw new ApiError(404, "not_found", "Stockbildauswahl nicht gefunden.");
      }
      const image = await downloadStockImageSelectionForSession(user, {
        courseId,
        selectionId,
      });
      return new Response(image.bytes, {
        status: 200,
        headers: {
          "Cache-Control": "private, no-store",
          "Content-Length": String(image.bytes.byteLength),
          "Content-Type": image.contentType,
          "X-Content-Type-Options": "nosniff",
        },
      });
    },
  );
}
