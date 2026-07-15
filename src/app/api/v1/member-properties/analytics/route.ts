import { apiOptions, handleApi } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/errors";
import { getMemberPropertyAnalytics } from "@/lib/member-properties";
import { memberPropertyAnalyticsQuerySchema } from "@/lib/member-property-model";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

export async function GET(request: Request) {
  return handleApi(
    request,
    {
      scopes: ["analytics:read", "custom_fields:read", "members:read"],
      action: "member_property.analytics",
      resourceType: "member_property",
    },
    async (context) => {
      const url = new URL(request.url);
      const parsed = memberPropertyAnalyticsQuerySchema.safeParse({
        fieldId: url.searchParams.get("fieldId") || undefined,
        profileDefinitionId:
          url.searchParams.get("profileDefinitionId") || undefined,
        operator: url.searchParams.get("operator") || "is_set",
        value: url.searchParams.get("value") || undefined,
      });
      if (!parsed.success) {
        throw new ApiError(
          422,
          "validation_error",
          parsed.error.issues[0]?.message ?? "Filter ungueltig.",
        );
      }
      const data = await getMemberPropertyAnalytics({
        organizationId: context.organizationId,
        viewer: { id: context.apiKeyId, role: "owner" },
        query: parsed.data,
        revealMatchedMembers: false,
      });
      return {
        data: {
          fields: data.fields,
          query: data.query,
          selectedField: data.selectedField,
          totals: data.totals,
          distribution: data.distribution,
          suppressed: data.suppressed,
        },
      };
    },
  );
}
