import { apiOptions, handleApi, parseJson } from "@/lib/api/handler";
import { mediaMultipartPartAuthorizationSchema } from "@/lib/media/api-schemas";
import { authorizeApiMultipartUploadPart } from "@/lib/media/api-multipart-service";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Context) {
  const { id } = await params;
  return handleApi(
    request,
    {
      scopes: [],
      action: "media_asset.multipart.authorize_part",
      resourceType: "media_asset",
      idempotent: true,
    },
    async (context) => ({
      data: await authorizeApiMultipartUploadPart(
        context,
        id,
        await parseJson(request, mediaMultipartPartAuthorizationSchema),
      ),
      resourceId: id,
    }),
  );
}
