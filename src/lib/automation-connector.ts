import type { ApiScope } from "@/lib/api/scopes";

export const AUTOMATION_CONNECTOR_CONTRACT_VERSION = "1.0.0" as const;

export const AUTOMATION_CONNECTOR_REQUIRED_SCOPES = [
  "automations:write",
  "bundles:read",
] as const satisfies readonly ApiScope[];

export function automationConnectorStatus(input: {
  organizationId: string;
  apiKeyName: string;
}) {
  return {
    connected: true as const,
    contractVersion: AUTOMATION_CONNECTOR_CONTRACT_VERSION,
    apiVersion: "v1" as const,
    organizationId: input.organizationId,
    apiKeyName: input.apiKeyName,
    requiredScopes: [...AUTOMATION_CONNECTOR_REQUIRED_SCOPES],
    capabilities: {
      memberUpsert: true as const,
      bundleSelection: true as const,
    },
  };
}
