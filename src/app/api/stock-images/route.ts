import { z } from "zod";

import { ApiError } from "@/lib/api/errors";
import {
  handleSessionMediaRequest,
  parseSessionMediaJson,
  sessionMediaData,
} from "@/lib/media/session-api";
import {
  stockImageSearchInputSchema,
  stockImageSelectionInputSchema,
} from "@/lib/stock-image-model";
import { stockImageProviderStatus } from "@/lib/stock-image-provider";
import {
  searchStockImagesForSession,
  selectStockImageForSession,
} from "@/lib/stock-image-service";

export const dynamic = "force-dynamic";
const idSchema = z.string().uuid();

export async function GET(request: Request) {
  return handleSessionMediaRequest(
    request,
    { action: "stock_images.search" },
    async (user) => {
      const url = new URL(request.url);
      const courseId = url.searchParams.get("courseId") ?? "";
      if (!idSchema.safeParse(courseId).success) {
        throw new ApiError(404, "not_found", "Kurs nicht gefunden.");
      }
      const status = stockImageProviderStatus();
      if (!status.enabled) return sessionMediaData(request, status);
      const input = stockImageSearchInputSchema.parse({
        query: url.searchParams.get("query") ?? "",
        page: url.searchParams.get("page") ?? undefined,
        perPage: url.searchParams.get("perPage") ?? undefined,
      });
      return sessionMediaData(request, {
        ...status,
        ...(await searchStockImagesForSession(user, courseId, input)),
      });
    },
  );
}

export async function POST(request: Request) {
  return handleSessionMediaRequest(
    request,
    { mutation: true, action: "stock_images.select" },
    async (user) => {
      const input = stockImageSelectionInputSchema.parse(
        await parseSessionMediaJson(request),
      );
      const selection = await selectStockImageForSession(user, input);
      return sessionMediaData(request, selection, 201);
    },
  );
}
