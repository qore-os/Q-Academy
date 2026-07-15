import { ApiError } from "@/lib/api/errors";
import { apiOptions, handleApi } from "@/lib/api/handler";
import { privacyRequestDetailData } from "@/lib/api/privacy-responses";
import { getPrivacyRequestDetail } from "@/lib/privacy/request-service";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return handleApi(
    request,
    {
      scopes: ["privacy:read"],
      action: "privacy_request.read",
      resourceType: "privacy_request",
    },
    async (context) => {
      const detail = await getPrivacyRequestDetail(context.organizationId, id);
      if (!detail) {
        throw new ApiError(
          404,
          "not_found",
          "Der Datenschutzfall wurde nicht gefunden.",
        );
      }
      return { data: privacyRequestDetailData(detail), resourceId: id };
    },
  );
}
