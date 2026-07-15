import { z } from "zod";

import { handleSessionMediaRequest, sessionMediaData } from "@/lib/media/session-api";
import {
  deleteSessionMediaAsset,
  getSessionMediaAsset,
} from "@/lib/media/session-service";
import { publicMediaAsset } from "@/lib/media/asset-service";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context) {
  return handleSessionMediaRequest(
    request,
    { action: "session_media.read" },
    async (user) => {
      const id = z.string().uuid().parse((await params).id);
      const asset = await getSessionMediaAsset(user, id);
      return sessionMediaData(request, publicMediaAsset(asset));
    },
  );
}

export async function DELETE(request: Request, { params }: Context) {
  return handleSessionMediaRequest(
    request,
    { mutation: true, action: "session_media.delete" },
    async (user) => {
      const id = z.string().uuid().parse((await params).id);
      const asset = await deleteSessionMediaAsset(user, id);
      return sessionMediaData(request, asset);
    },
  );
}
