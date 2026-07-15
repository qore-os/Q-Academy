import { getPublicBrandingMediaAsset } from "@/lib/branding-media";
import { isBrandingMediaSlot } from "@/lib/branding-media-policy";
import { mediaDownloadResponse } from "@/lib/media/download-response";
import { logServerError } from "@/lib/server-error-logging";

export const dynamic = "force-dynamic";
export const maxDuration = 720;

type Context = { params: Promise<{ slot: string }> };

function notFoundResponse() {
  return new Response(null, {
    status: 404,
    headers: {
      "Cache-Control": "public, max-age=60, must-revalidate",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function GET(request: Request, { params }: Context) {
  const { slot } = await params;
  if (!isBrandingMediaSlot(slot)) return notFoundResponse();
  try {
    const asset = await getPublicBrandingMediaAsset(request.headers, slot);
    if (!asset) return notFoundResponse();
    return mediaDownloadResponse({
      request,
      asset,
      disposition: "inline",
      cacheControl: "public, max-age=300, must-revalidate",
    });
  } catch (error) {
    logServerError(error, {
      action: "tenant_branding_asset.download",
    });
    return new Response(null, {
      status: 500,
      headers: {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }
}
