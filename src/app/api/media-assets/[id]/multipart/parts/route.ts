import { z } from "zod";

import {
  handleSessionMediaRequest,
  parseSessionMediaJson,
  sessionMediaData,
} from "@/lib/media/session-api";
import { authorizeSessionMultipartUploadPart } from "@/lib/media/session-service";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

const requestSchema = z
  .object({
    partNumber: z.number().int().min(1).max(10_000),
    checksumSha256: z
      .string()
      .regex(/^[a-z0-9+/]{43}=$/i),
  })
  .strict();

export async function POST(request: Request, { params }: Context) {
  return handleSessionMediaRequest(
    request,
    { mutation: true, action: "session_media.multipart.authorize_part" },
    async (user) => {
      const id = z.string().uuid().parse((await params).id);
      const input = requestSchema.parse(await parseSessionMediaJson(request));
      return sessionMediaData(
        request,
        await authorizeSessionMultipartUploadPart(user, id, input),
      );
    },
  );
}
