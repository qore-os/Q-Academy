import { apiOptions, handleApi } from "@/lib/api/handler";
import { getOrganizationContractOverview } from "@/lib/organization-contracts";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

export async function GET(request: Request) {
  return handleApi(
    request,
    {
      scopes: ["organization:read"],
      action: "organization.contract.read",
      resourceType: "organization_contract",
    },
    async (context) => ({
      data: await getOrganizationContractOverview(context.organizationId),
      resourceId: context.organizationId,
    }),
  );
}
