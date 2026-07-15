import {
  handleSessionMediaRequest,
  parseSessionMediaJson,
  sessionMediaData,
} from "@/lib/media/session-api";
import {
  createSessionMediaAsset,
  listSessionCourseMediaAssets,
  sessionCourseMediaListSchema,
  sessionMediaCreateSchema,
} from "@/lib/media/session-service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handleSessionMediaRequest(
    request,
    { action: "session_media.list" },
    async (user) => {
      const url = new URL(request.url);
      const query = sessionCourseMediaListSchema.parse({
        kind: url.searchParams.get("kind"),
        search: url.searchParams.get("search") ?? "",
        limit: url.searchParams.get("limit") ?? undefined,
      });
      return sessionMediaData(
        request,
        await listSessionCourseMediaAssets(user, query),
      );
    },
  );
}

export async function POST(request: Request) {
  return handleSessionMediaRequest(
    request,
    { mutation: true, action: "session_media.create" },
    async (user) => {
      const body = sessionMediaCreateSchema.parse(
        await parseSessionMediaJson(request),
      );
      const asset = await createSessionMediaAsset(user, body);
      return sessionMediaData(request, asset, 201);
    },
  );
}
