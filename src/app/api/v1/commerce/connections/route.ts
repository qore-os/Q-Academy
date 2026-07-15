import { randomBytes } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { commerceProviderConnections } from "@/db/schema";
import { encryptWebhookSecret } from "@/lib/api/crypto";
import { ApiError } from "@/lib/api/errors";
import { apiOptions, handleApi, parseJson } from "@/lib/api/handler";
import { commerceConnectionInputSchema } from "@/lib/commerce/model";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

function publicConnection(
  connection: typeof commerceProviderConnections.$inferSelect,
) {
  const { signingSecretEncrypted, ...safe } = connection;
  return {
    ...safe,
    secretConfigured: Boolean(signingSecretEncrypted),
    webhookPath: `/api/integrations/commerce/${connection.provider}/${connection.endpointKey}`,
  };
}

export async function GET(request: Request) {
  return handleApi(
    request,
    {
      scopes: ["commerce:read"],
      action: "commerce.connection.list",
      resourceType: "commerce_connection",
    },
    async (context) => ({
      data: (
        await db
          .select()
          .from(commerceProviderConnections)
          .where(
            eq(
              commerceProviderConnections.organizationId,
              context.organizationId,
            ),
          )
          .orderBy(desc(commerceProviderConnections.createdAt))
      ).map(publicConnection),
    }),
  );
}

export async function POST(request: Request) {
  return handleApi(
    request,
    {
      scopes: ["commerce:write"],
      action: "commerce.connection.create",
      resourceType: "commerce_connection",
      idempotent: true,
    },
    async (context) => {
      const input = await parseJson(request, commerceConnectionInputSchema);
      try {
        const [created] = await db
          .insert(commerceProviderConnections)
          .values({
            organizationId: context.organizationId,
            provider: input.provider,
            displayName: input.displayName,
            endpointKey: randomBytes(32).toString("base64url"),
            signatureMode: input.signatureMode,
            signingSecretEncrypted: encryptWebhookSecret(input.signingSecret),
            active: input.active,
            autoCreateMembers: input.autoCreateMembers,
            createdById: null,
          })
          .returning();
        return {
          data: publicConnection(created),
          status: 201,
          resourceId: created.id,
        };
      } catch (error) {
        if (
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          error.code === "23505"
        ) {
          throw new ApiError(
            409,
            "conflict",
            "Fuer diesen Provider existiert bereits eine Verbindung.",
          );
        }
        throw error;
      }
    },
  );
}
