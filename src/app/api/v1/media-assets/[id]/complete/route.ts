import { apiOptions, handleApi } from "@/lib/api/handler";
import { completeApiMediaAsset } from "@/lib/media/api-multipart-service";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Context) {
  const { id } = await params;
  return handleApi(
    request,
    {
      scopes: [],
      action: "media_asset.complete",
      resourceType: "media_asset",
      idempotent: true,
    },
    async (context) => ({
      data: await completeApiMediaAsset(context, id),
      resourceId: id,
    }),
  );
}
