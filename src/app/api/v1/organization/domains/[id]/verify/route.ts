import { db } from "@/db";
import { apiOptions, handleApi, parseJson } from "@/lib/api/handler";
import { customDomainClaimMutationSchema } from "@/lib/custom-domain-model";
import {
  requireCustomDomainApiKeyOwner,
  verifyCustomDomainClaim,
} from "@/lib/custom-domains";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return handleApi(
    request,
    {
      scopes: ["authentication:write"],
      action: "custom_domain.verify",
      resourceType: "custom_domain_claim",
      idempotent: true,
    },
    async (context) => {
      const input = await parseJson(request, customDomainClaimMutationSchema);
      const actorUserId = await db.transaction((tx) =>
        requireCustomDomainApiKeyOwner(tx, {
          organizationId: context.organizationId,
          apiKeyId: context.apiKeyId,
        }),
      );
      const result = await verifyCustomDomainClaim({
        organizationId: context.organizationId,
        actorUserId,
        claimId: id,
        expectedRevision: input.expectedRevision,
      });
      return { data: result, resourceId: id };
    },
  );
}
