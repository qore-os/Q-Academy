import { apiOptions, handleApi } from "@/lib/api/handler";
import { listMemberPropertyVariableCatalog } from "@/lib/member-properties";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

export async function GET(request: Request) {
  return handleApi(
    request,
    {
      scopes: ["custom_fields:read"],
      action: "member_property.variables",
      resourceType: "member_property",
    },
    async (context) => {
      const variables = await listMemberPropertyVariableCatalog(
        context.organizationId,
      );
      return {
        data: variables.map((variable) => ({
          token: variable.token,
          emailToken: variable.emailToken,
          label: variable.label,
          fieldId: variable.fieldId,
          fieldKey: variable.fieldKey,
          fieldType: variable.fieldType,
          profileDefinitionId: variable.profileDefinitionId,
          profileDefinitionKey: variable.profileDefinitionKey,
          profileDefinitionName: variable.profileDefinitionName,
        })),
      };
    },
  );
}
