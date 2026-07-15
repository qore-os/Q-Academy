import { db } from "@/db";
import {
  getOidcConfiguration,
  lockOidcConfiguration,
  previewOidcConfigurationUpdate,
  requireOidcApiKeyOwner,
  updateOidcConfiguration,
} from "@/lib/oidc-configuration";
import { oidcConfigurationApiUpdateSchema } from "@/lib/api/schemas";
import { ApiError } from "@/lib/api/errors";
import {
  apiOptions,
  handleApi,
  handleTransactionalApiCommand,
  parseJson,
} from "@/lib/api/handler";
import { verifyOidcProviderConfiguration } from "@/lib/oidc-provider";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

export async function GET(request: Request) {
  return handleApi(
    request,
    {
      scopes: ["authentication:read"],
      action: "organization.oidc.read",
      resourceType: "oidc_configuration",
    },
    async (context) => ({
      data: await getOidcConfiguration(context.organizationId),
      resourceId: context.organizationId,
    }),
  );
}

export async function PATCH(request: Request) {
  return handleTransactionalApiCommand(
    request,
    {
      scopes: ["authentication:write"],
      action: "organization.oidc.update",
      resourceType: "oidc_configuration",
      idempotent: true,
    },
    {
      prepare: async (context) => {
        const input = await parseJson(
          request,
          oidcConfigurationApiUpdateSchema,
        );
        await db.transaction((tx) =>
          requireOidcApiKeyOwner(tx, {
            organizationId: context.organizationId,
            apiKeyId: context.apiKeyId,
          }),
        );
        const preview = await previewOidcConfigurationUpdate(
          context.organizationId,
          input.configuration,
        );
        if (preview.expectedVersion !== input.expectedVersion) {
          throw new ApiError(
            409,
            "conflict",
            "Die OIDC-Konfiguration wurde zwischenzeitlich geaendert.",
          );
        }
        if (preview.runtime) {
          await verifyOidcProviderConfiguration(preview.runtime);
        }
        return input;
      },
      execute: async (tools, input) => {
        await lockOidcConfiguration(
          tools.tx,
          tools.context.organizationId,
        );
        const actorUserId = await requireOidcApiKeyOwner(tools.tx, {
          organizationId: tools.context.organizationId,
          apiKeyId: tools.context.apiKeyId,
        });
        const saved = await updateOidcConfiguration(tools.tx, {
          organizationId: tools.context.organizationId,
          actorUserId,
          source: "api",
          expectedVersion: input.expectedVersion,
          patch: input.configuration,
        });
        const configuration = {
          enabled: saved.enabled,
          displayName: saved.displayName,
          issuer: saved.issuer,
          clientId: saved.clientId,
          clientSecretConfigured: saved.clientSecretConfigured,
          autoProvisionMembers: saved.autoProvisionMembers,
          allowedEmailDomains: saved.allowedEmailDomains,
          passwordLoginEnabled: saved.passwordLoginEnabled,
          version: saved.version,
          updatedAt: saved.updatedAt,
        };
        return {
          data: configuration,
          resourceId: tools.context.organizationId,
        };
      },
    },
  );
}
