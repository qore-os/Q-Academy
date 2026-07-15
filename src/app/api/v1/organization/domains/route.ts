import { db } from "@/db";
import {
  apiOptions,
  handleApi,
  parseJson,
} from "@/lib/api/handler";
import { customDomainClaimCreateSchema } from "@/lib/custom-domain-model";
import {
  createCustomDomainClaim,
  listCustomDomainClaims,
  requireCustomDomainApiKeyOwner,
} from "@/lib/custom-domains";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

export async function GET(request: Request) {
  return handleApi(
    request,
    {
      scopes: ["authentication:read"],
      action: "custom_domain.list",
      resourceType: "custom_domain_claim",
    },
    async (context) => ({
      data: await listCustomDomainClaims(context.organizationId),
    }),
  );
}

export async function POST(request: Request) {
  return handleApi(
    request,
    {
      scopes: ["authentication:write"],
      action: "custom_domain.create",
      resourceType: "custom_domain_claim",
    },
    async (context) => {
      const input = await parseJson(request, customDomainClaimCreateSchema);
      const actorUserId = await db.transaction((tx) =>
        requireCustomDomainApiKeyOwner(tx, {
          organizationId: context.organizationId,
          apiKeyId: context.apiKeyId,
        }),
      );
      const created = await createCustomDomainClaim({
        organizationId: context.organizationId,
        actorUserId,
        hostname: input.hostname,
      });
      return {
        data: created,
        status: 201,
        resourceId: created.claim.id,
      };
    },
  );
}
