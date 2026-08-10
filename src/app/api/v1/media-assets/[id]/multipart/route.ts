import { apiOptions, handleApi } from "@/lib/api/handler";
import {
  abortApiMultipartUpload,
  getApiMultipartUploadStatus,
  recoverApiMultipartUploadStatus,
} from "@/lib/media/api-multipart-service";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context) {
  const { id } = await params;
  return handleApi(
    request,
    {
      scopes: [],
      action: "media_asset.multipart.status",
      resourceType: "media_asset",
    },
    async (context) => ({
      data: await getApiMultipartUploadStatus(context, id),
      resourceId: id,
    }),
  );
}

export async function POST(request: Request, { params }: Context) {
  const { id } = await params;
  return handleApi(
    request,
    {
      scopes: [],
      action: "media_asset.multipart.recover",
      resourceType: "media_asset",
      idempotent: true,
    },
    async (context) => ({
      data: await recoverApiMultipartUploadStatus(context, id),
      resourceId: id,
    }),
  );
}

export async function DELETE(request: Request, { params }: Context) {
  const { id } = await params;
  return handleApi(
    request,
    {
      scopes: [],
      action: "media_asset.multipart.abort",
      resourceType: "media_asset",
      idempotent: true,
    },
    async (context) => ({
      data: await abortApiMultipartUpload(context, id),
      resourceId: id,
    }),
  );
}
