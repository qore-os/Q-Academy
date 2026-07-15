import { getEmailDeliveryDetail } from "@/lib/email-center";
import { apiOptions, handleApi } from "@/lib/api/handler";

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
      scopes: ["email:read"],
      action: "email.delivery.read",
      resourceType: "email_delivery",
    },
    async (context) => ({
      data: await getEmailDeliveryDetail(context.organizationId, id),
      resourceId: id,
    }),
  );
}
