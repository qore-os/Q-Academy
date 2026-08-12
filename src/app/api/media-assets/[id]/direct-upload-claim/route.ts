import { z } from "zod";

import {
  handleSessionMediaRequest,
  parseSessionMediaJson,
  sessionMediaData,
} from "@/lib/media/session-api";
import { claimSessionDirectPostUpload } from "@/lib/media/session-service";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

const claimSchema = z
  .object({
    claimToken: z.string().uuid(),
  })
  .strict();

export async function POST(request: Request, { params }: Context) {
  return handleSessionMediaRequest(
    request,
    { mutation: true, action: "session_media.direct_post.claim" },
    async (user) => {
      const id = z.string().uuid().parse((await params).id);
      const input = claimSchema.parse(await parseSessionMediaJson(request));
      return sessionMediaData(
        request,
        await claimSessionDirectPostUpload(user, id, input.claimToken),
      );
    },
  );
}
