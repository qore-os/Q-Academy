import { apiOptions, handleApi } from "@/lib/api/handler";
import {
  AUTOMATION_CONNECTOR_REQUIRED_SCOPES,
  automationConnectorStatus,
} from "@/lib/automation-connector";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

export async function GET(request: Request) {
  return handleApi(
    request,
    {
      scopes: [...AUTOMATION_CONNECTOR_REQUIRED_SCOPES],
      action: "automation.connector.status.read",
      resourceType: "automation_connector",
    },
    async (context) => ({
      data: automationConnectorStatus({
        organizationId: context.organizationId,
        apiKeyName: context.apiKeyName,
      }),
    }),
  );
}
