"use server";

import { randomBytes, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import {
  activityEvents,
  automationWorkflowConnections,
  bundles,
  commerceProductMappings,
  commerceProducts,
  commerceProviderConnections,
  organizationSupportSettings,
  webhookDeliveries,
  webhooks,
} from "@/db/schema";
import {
  decryptWebhookSecret,
  encryptWebhookSecret,
} from "@/lib/api/crypto";
import { requireTeamPermission } from "@/lib/auth";
import {
  COMMERCE_PROVIDERS,
  COMMERCE_SIGNATURE_MODES,
  commerceSignatureModeIsSupported,
  commerceMappingInputSchema,
  commerceProductInputSchema,
  n8nWorkflowInputSchema,
  supportSettingsInputSchema,
} from "@/lib/commerce/model";
import {
  CommerceProviderPreflightError,
  runCommerceProviderAdapterPreflight,
} from "@/lib/commerce/provider-preflight";
import { logServerError } from "@/lib/server-error-logging";
import { assertSafeWebhookUrl } from "@/lib/api/webhook-security";
import { ApiError } from "@/lib/api/errors";
import { assertOrganizationFeatureAvailable } from "@/lib/organization-contracts";
import { getSupportLauncherConfiguration } from "@/lib/support";

export type CommerceAdminActionState = {
  ok: boolean | null;
  message: string;
  code?: CommerceAdminActionCode;
};

export type CommerceAdminActionCode =
  | "invalid"
  | "connectionSecretShort"
  | "connectionCreated"
  | "connectionUpdated"
  | "connectionSignatureUnsupported"
  | "connectionPreflightPassed"
  | "connectionPreflightFailed"
  | "connectionEndpointRotated"
  | "connectionFailed"
  | "bundleMissing"
  | "productCreated"
  | "productFailed"
  | "mappingTargetMissing"
  | "mappingCreated"
  | "mappingFailed"
  | "supportSecretMissing"
  | "supportSaved"
  | "supportPreflightPassed"
  | "supportPreflightFailed"
  | "workflowCreated"
  | "workflowTestQueued"
  | "workflowFailed";

const initialError = (
  message: string,
  code: CommerceAdminActionCode = "invalid",
): CommerceAdminActionState => ({
  ok: false,
  message,
  code,
});

const connectionFormSchema = z
  .object({
    provider: z.enum(COMMERCE_PROVIDERS),
    displayName: z.string().trim().min(2).max(120),
    signatureMode: z.enum(COMMERCE_SIGNATURE_MODES),
    signingSecret: z.string().max(4096),
    active: z.boolean(),
    autoCreateMembers: z.boolean(),
  })
  .superRefine((value, context) => {
    if (!commerceSignatureModeIsSupported(value.provider, value.signatureMode)) {
      context.addIssue({
        code: "custom",
        path: ["signatureMode"],
        message:
          "Die Digistore-SHA-512-Feldsignatur ist nur fuer Digistore24 zulaessig.",
      });
    }
  });

const savedConnectionIntentSchema = z.object({
  connectionId: z.string().uuid(),
  intent: z.enum(["preflight", "rotate_endpoint"]),
});

const savedWorkflowIntentSchema = z
  .string()
  .regex(
    /^test:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  )
  .transform((value) => value.slice("test:".length));

function checkbox(formData: FormData, key: string) {
  return formData.get(key) === "on";
}

function optionalText(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function issue(error: z.ZodError) {
  return error.issues[0]?.message ?? "Bitte pruefe die Eingaben.";
}

async function runSavedCommerceConnectionIntent(
  actor: { id: string; organizationId: string },
  input: z.infer<typeof savedConnectionIntentSchema>,
): Promise<CommerceAdminActionState> {
  try {
    await assertOrganizationFeatureAvailable(
      db,
      actor.organizationId,
      "commerce",
    );
    if (input.intent === "rotate_endpoint") {
      await db.transaction(async (tx) => {
        const [connection] = await tx
          .update(commerceProviderConnections)
          .set({
            endpointKey: randomBytes(32).toString("base64url"),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(commerceProviderConnections.id, input.connectionId),
              eq(
                commerceProviderConnections.organizationId,
                actor.organizationId,
              ),
            ),
          )
          .returning({
            id: commerceProviderConnections.id,
            provider: commerceProviderConnections.provider,
          });
        if (!connection) {
          throw new ApiError(
            404,
            "not_found",
            "Die Providerverbindung wurde nicht gefunden.",
          );
        }
        await tx.insert(activityEvents).values({
          organizationId: actor.organizationId,
          userId: actor.id,
          type: "commerce.connection.endpoint_rotated",
          entityType: "commerce_connection",
          entityId: connection.id,
          metadata: { provider: connection.provider },
        });
      });
      revalidatePath("/admin/integrations");
      return {
        ok: true,
        message: "Der geheime Provider-Endpunkt wurde rotiert.",
        code: "connectionEndpointRotated",
      };
    }

    const [connection] = await db
      .select({
        id: commerceProviderConnections.id,
        provider: commerceProviderConnections.provider,
        signatureMode: commerceProviderConnections.signatureMode,
        signingSecretEncrypted:
          commerceProviderConnections.signingSecretEncrypted,
        active: commerceProviderConnections.active,
      })
      .from(commerceProviderConnections)
      .where(
        and(
          eq(commerceProviderConnections.id, input.connectionId),
          eq(
            commerceProviderConnections.organizationId,
            actor.organizationId,
          ),
        ),
      )
      .limit(1);
    if (!connection?.active) {
      return initialError(
        "Nur eine aktive Providerverbindung kann geprueft werden.",
        "connectionPreflightFailed",
      );
    }
    const provider = z.enum(COMMERCE_PROVIDERS).safeParse(connection.provider);
    const signatureMode = z
      .enum(COMMERCE_SIGNATURE_MODES)
      .safeParse(connection.signatureMode);
    if (!provider.success || !signatureMode.success) {
      return initialError(
        "Provider oder Signaturmodus ist ungueltig.",
        "connectionPreflightFailed",
      );
    }
    const [mapping] = await db
      .select({
        providerProductId: commerceProductMappings.providerProductId,
      })
      .from(commerceProductMappings)
      .innerJoin(
        commerceProducts,
        and(
          eq(commerceProducts.id, commerceProductMappings.productId),
          eq(commerceProducts.organizationId, actor.organizationId),
          eq(commerceProducts.active, true),
        ),
      )
      .innerJoin(
        bundles,
        and(
          eq(bundles.id, commerceProducts.bundleId),
          eq(bundles.organizationId, actor.organizationId),
          eq(bundles.active, true),
        ),
      )
      .where(
        and(
          eq(commerceProductMappings.connectionId, connection.id),
          eq(commerceProductMappings.organizationId, actor.organizationId),
          eq(commerceProductMappings.active, true),
        ),
      )
      .limit(1);
    if (!mapping) {
      return initialError(
        "Es fehlt eine aktive Zuordnung zu einem aktiven Produkt und Bundle.",
        "connectionPreflightFailed",
      );
    }
    const result = runCommerceProviderAdapterPreflight({
      provider: provider.data,
      signatureMode: signatureMode.data,
      signingSecret: decryptWebhookSecret(
        connection.signingSecretEncrypted,
      ),
      providerProductId: mapping.providerProductId,
    });
    await db.insert(activityEvents).values({
      organizationId: actor.organizationId,
      userId: actor.id,
      type: "commerce.connection.preflight_passed",
      entityType: "commerce_connection",
      entityId: connection.id,
      metadata: {
        provider: result.provider,
        signatureMode: result.signatureMode,
        providerProductId: result.providerProductId,
        payloadSha256: result.payloadSha256,
      },
    });
    return {
      ok: true,
      message: "Signaturadapter und aktive Produktzuordnung sind gueltig.",
      code: "connectionPreflightPassed",
    };
  } catch (error) {
    if (
      error instanceof ApiError ||
      error instanceof CommerceProviderPreflightError
    ) {
      return initialError(error.message, "connectionPreflightFailed");
    }
    logServerError(error, { action: "commerce.connection.admin_preflight" });
    return initialError(
      "Die Providerverbindung konnte nicht geprueft werden.",
      "connectionPreflightFailed",
    );
  }
}

export async function saveCommerceConnectionAction(
  _state: CommerceAdminActionState,
  formData: FormData,
): Promise<CommerceAdminActionState> {
  const actor = await requireTeamPermission("integrations.manage");
  if (
    formData.get("intent") === "preflight" ||
    formData.get("intent") === "rotate_endpoint"
  ) {
    const savedIntent = savedConnectionIntentSchema.safeParse({
      connectionId: formData.get("connectionId"),
      intent: formData.get("intent"),
    });
    if (!savedIntent.success) return initialError(issue(savedIntent.error));
    return runSavedCommerceConnectionIntent(actor, savedIntent.data);
  }
  const parsed = connectionFormSchema.safeParse({
    provider: formData.get("provider"),
    displayName: formData.get("displayName"),
    signatureMode: formData.get("signatureMode"),
    signingSecret: formData.get("signingSecret") ?? "",
    active: checkbox(formData, "active"),
    autoCreateMembers: checkbox(formData, "autoCreateMembers"),
  });
  if (!parsed.success) {
    const unsupported = parsed.error.issues.some(
      (entry) => entry.path[0] === "signatureMode" && entry.code === "custom",
    );
    return initialError(
      issue(parsed.error),
      unsupported ? "connectionSignatureUnsupported" : "invalid",
    );
  }
  try {
    await assertOrganizationFeatureAvailable(
      db,
      actor.organizationId,
      "commerce",
    );
    const [existing] = await db
      .select()
      .from(commerceProviderConnections)
      .where(
        and(
          eq(commerceProviderConnections.organizationId, actor.organizationId),
          eq(commerceProviderConnections.provider, parsed.data.provider),
        ),
      )
      .limit(1);
    if (!existing && parsed.data.signingSecret.length < 16) {
      return initialError("Das Signaturgeheimnis muss mindestens 16 Zeichen enthalten.", "connectionSecretShort");
    }
    if (parsed.data.signingSecret && parsed.data.signingSecret.length < 16) {
      return initialError("Das Signaturgeheimnis muss mindestens 16 Zeichen enthalten.", "connectionSecretShort");
    }
    const [saved] = existing
      ? await db
          .update(commerceProviderConnections)
          .set({
            displayName: parsed.data.displayName,
            signatureMode: parsed.data.signatureMode,
            ...(parsed.data.signingSecret
              ? {
                  signingSecretEncrypted: encryptWebhookSecret(
                    parsed.data.signingSecret,
                  ),
                }
              : {}),
            active: parsed.data.active,
            autoCreateMembers: parsed.data.autoCreateMembers,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(commerceProviderConnections.id, existing.id),
              eq(
                commerceProviderConnections.organizationId,
                actor.organizationId,
              ),
            ),
          )
          .returning()
      : await db
          .insert(commerceProviderConnections)
          .values({
            organizationId: actor.organizationId,
            provider: parsed.data.provider,
            displayName: parsed.data.displayName,
            endpointKey: randomBytes(32).toString("base64url"),
            signatureMode: parsed.data.signatureMode,
            signingSecretEncrypted: encryptWebhookSecret(
              parsed.data.signingSecret,
            ),
            active: parsed.data.active,
            autoCreateMembers: parsed.data.autoCreateMembers,
            createdById: actor.id,
          })
          .returning();
    await db.insert(activityEvents).values({
      organizationId: actor.organizationId,
      userId: actor.id,
      type: existing ? "commerce.connection.updated" : "commerce.connection.created",
      entityType: "commerce_connection",
      entityId: saved.id,
      metadata: {
        provider: saved.provider,
        signatureMode: saved.signatureMode,
        secretRotated: Boolean(existing && parsed.data.signingSecret),
      },
    });
    revalidatePath("/admin/integrations");
    return { ok: true, message: existing ? "Verbindung aktualisiert." : "Verbindung angelegt.", code: existing ? "connectionUpdated" : "connectionCreated" };
  } catch (error) {
    if (error instanceof ApiError) return initialError(error.message, "connectionFailed");
    logServerError(error, { action: "commerce.connection.admin_save" });
    return initialError("Die Providerverbindung konnte nicht gespeichert werden.", "connectionFailed");
  }
}

export async function createCommerceProductAction(
  _state: CommerceAdminActionState,
  formData: FormData,
): Promise<CommerceAdminActionState> {
  const actor = await requireTeamPermission("integrations.manage");
  const parsed = commerceProductInputSchema.safeParse({
    name: formData.get("name"),
    sku: formData.get("sku"),
    bundleId: formData.get("bundleId"),
    active: true,
    metadata: {},
  });
  if (!parsed.success) return initialError(issue(parsed.error));
  const [bundle] = await db.select({ id: bundles.id }).from(bundles).where(and(
    eq(bundles.id, parsed.data.bundleId),
    eq(bundles.organizationId, actor.organizationId),
    eq(bundles.active, true),
  )).limit(1);
  if (!bundle) return initialError("Bundle wurde nicht gefunden oder ist inaktiv.", "bundleMissing");
  try {
    await assertOrganizationFeatureAvailable(
      db,
      actor.organizationId,
      "commerce",
    );
    const [product] = await db.insert(commerceProducts).values({
      ...parsed.data,
      organizationId: actor.organizationId,
    }).returning();
    await db.insert(activityEvents).values({
      organizationId: actor.organizationId,
      userId: actor.id,
      type: "commerce.product.created",
      entityType: "commerce_product",
      entityId: product.id,
      metadata: { sku: product.sku, bundleId: product.bundleId },
    });
    revalidatePath("/admin/integrations");
    return { ok: true, message: "Verkaufsprodukt angelegt.", code: "productCreated" };
  } catch (error) {
    if (error instanceof ApiError) return initialError(error.message, "productFailed");
    logServerError(error, { action: "commerce.product.admin_create" });
    return initialError("Produkt oder SKU existiert bereits.", "productFailed");
  }
}

export async function createCommerceMappingAction(
  _state: CommerceAdminActionState,
  formData: FormData,
): Promise<CommerceAdminActionState> {
  const actor = await requireTeamPermission("integrations.manage");
  const parsed = commerceMappingInputSchema.safeParse({
    connectionId: formData.get("connectionId"),
    productId: formData.get("productId"),
    providerProductId: formData.get("providerProductId"),
    providerVariantId: optionalText(formData, "providerVariantId"),
    active: true,
  });
  if (!parsed.success) return initialError(issue(parsed.error));
  const [target] = await db
    .select({ connectionId: commerceProviderConnections.id })
    .from(commerceProviderConnections)
    .innerJoin(
      commerceProducts,
      eq(commerceProducts.organizationId, commerceProviderConnections.organizationId),
    )
    .where(and(
      eq(commerceProviderConnections.id, parsed.data.connectionId),
      eq(commerceProducts.id, parsed.data.productId),
      eq(commerceProviderConnections.organizationId, actor.organizationId),
    )).limit(1);
  if (!target) return initialError("Verbindung oder Produkt wurde nicht gefunden.", "mappingTargetMissing");
  try {
    await assertOrganizationFeatureAvailable(
      db,
      actor.organizationId,
      "commerce",
    );
    const [mapping] = await db.insert(commerceProductMappings).values({
      ...parsed.data,
      providerVariantId: parsed.data.providerVariantId ?? "",
      organizationId: actor.organizationId,
    }).returning();
    await db.insert(activityEvents).values({
      organizationId: actor.organizationId,
      userId: actor.id,
      type: "commerce.mapping.created",
      entityType: "commerce_product_mapping",
      entityId: mapping.id,
      metadata: {
        connectionId: mapping.connectionId,
        productId: mapping.productId,
        providerProductId: mapping.providerProductId,
      },
    });
    revalidatePath("/admin/integrations");
    return { ok: true, message: "Produktzuordnung angelegt.", code: "mappingCreated" };
  } catch (error) {
    if (error instanceof ApiError) return initialError(error.message, "mappingFailed");
    logServerError(error, { action: "commerce.mapping.admin_create" });
    return initialError("Diese Providerzuordnung existiert bereits.", "mappingFailed");
  }
}

export async function saveSupportSettingsAction(
  _state: CommerceAdminActionState,
  formData: FormData,
): Promise<CommerceAdminActionState> {
  const actor = await requireTeamPermission("integrations.manage");
  if (formData.get("intent") === "preflight") {
    try {
      const launcher = await getSupportLauncherConfiguration(actor);
      if (!launcher) {
        return initialError(
          "Der Supportkanal ist deaktiviert oder unvollstaendig.",
          "supportPreflightFailed",
        );
      }
      if (
        (launcher.provider === "link" &&
          new URL(launcher.url).protocol !== "https:") ||
        (launcher.provider === "email" && !launcher.email.includes("@")) ||
        (launcher.provider === "intercom" &&
          (!launcher.userHash || !/^[a-f0-9]{64}$/.test(launcher.userHash)))
      ) {
        return initialError(
          "Die effektive Support-Launcher-Konfiguration ist ungueltig.",
          "supportPreflightFailed",
        );
      }
      await db.insert(activityEvents).values({
        organizationId: actor.organizationId,
        userId: actor.id,
        type: "support.settings.preflight_passed",
        entityType: "organization",
        entityId: actor.organizationId,
        metadata: {
          provider: launcher.provider,
          identityVerification:
            launcher.provider === "intercom" && Boolean(launcher.userHash),
        },
      });
      return {
        ok: true,
        message: "Der effektive Support-Launcher ist gueltig konfiguriert.",
        code: "supportPreflightPassed",
      };
    } catch (error) {
      logServerError(error, { action: "support.settings.admin_preflight" });
      return initialError(
        "Der Support-Launcher konnte nicht geprueft werden.",
        "supportPreflightFailed",
      );
    }
  }
  const parsed = supportSettingsInputSchema.safeParse({
    enabled: checkbox(formData, "enabled"),
    provider: formData.get("supportProvider"),
    launcherLabel: formData.get("launcherLabel"),
    supportUrl: optionalText(formData, "supportUrl"),
    supportEmail: optionalText(formData, "supportEmail"),
    intercomAppId: optionalText(formData, "intercomAppId"),
    identitySecret: optionalText(formData, "identitySecret"),
    clearIdentitySecret: checkbox(formData, "clearIdentitySecret"),
  });
  if (!parsed.success) return initialError(issue(parsed.error));
  const [current] = await db.select().from(organizationSupportSettings)
    .where(eq(organizationSupportSettings.organizationId, actor.organizationId))
    .limit(1);
  const encryptedSecret = parsed.data.clearIdentitySecret
    ? null
    : parsed.data.identitySecret
      ? encryptWebhookSecret(parsed.data.identitySecret)
      : current?.identitySecretEncrypted ?? null;
  if (
    parsed.data.enabled &&
    parsed.data.provider === "intercom" &&
    !encryptedSecret
  ) {
    return initialError("Fuer verifizierte Intercom-Identitaeten fehlt das Identity-Secret.", "supportSecretMissing");
  }
  await db.insert(organizationSupportSettings).values({
    organizationId: actor.organizationId,
    enabled: parsed.data.enabled,
    provider: parsed.data.provider,
    launcherLabel: parsed.data.launcherLabel,
    supportUrl: parsed.data.supportUrl,
    supportEmail: parsed.data.supportEmail,
    intercomAppId: parsed.data.intercomAppId,
    identitySecretEncrypted: encryptedSecret,
  }).onConflictDoUpdate({
    target: organizationSupportSettings.organizationId,
    set: {
      enabled: parsed.data.enabled,
      provider: parsed.data.provider,
      launcherLabel: parsed.data.launcherLabel,
      supportUrl: parsed.data.supportUrl,
      supportEmail: parsed.data.supportEmail,
      intercomAppId: parsed.data.intercomAppId,
      identitySecretEncrypted: encryptedSecret,
      updatedAt: new Date(),
    },
  });
  await db.insert(activityEvents).values({
    organizationId: actor.organizationId,
    userId: actor.id,
    type: "support.settings.updated",
    entityType: "organization",
    entityId: actor.organizationId,
    metadata: {
      enabled: parsed.data.enabled,
      provider: parsed.data.provider,
      identityVerification: Boolean(encryptedSecret),
    },
  });
  revalidatePath("/admin/integrations");
  revalidatePath("/academy", "layout");
  return { ok: true, message: "Supportkanal gespeichert.", code: "supportSaved" };
}

async function queueN8nWorkflowTest(
  actor: { id: string; organizationId: string },
  workflowId: string,
): Promise<CommerceAdminActionState> {
  try {
    await assertOrganizationFeatureAvailable(
      db,
      actor.organizationId,
      "automations",
    );
    const [candidate] = await db
      .select({
        workflowId: automationWorkflowConnections.id,
        webhookId: webhooks.id,
        name: automationWorkflowConnections.name,
        url: webhooks.url,
        active: webhooks.active,
        signingSecretEncrypted: webhooks.signingSecretEncrypted,
        updatedAt: webhooks.updatedAt,
      })
      .from(automationWorkflowConnections)
      .innerJoin(
        webhooks,
        and(
          eq(webhooks.id, automationWorkflowConnections.webhookId),
          eq(webhooks.organizationId, actor.organizationId),
        ),
      )
      .where(
        and(
          eq(automationWorkflowConnections.id, workflowId),
          eq(
            automationWorkflowConnections.organizationId,
            actor.organizationId,
          ),
        ),
      )
      .limit(1);
    if (!candidate?.active) {
      return initialError(
        "Nur ein aktiver n8n-Workflow kann getestet werden.",
        "workflowFailed",
      );
    }
    await assertSafeWebhookUrl(candidate.url);
    const secret = decryptWebhookSecret(candidate.signingSecretEncrypted);
    if (secret.length < 16 || secret.length > 4_096) {
      return initialError(
        "Das gespeicherte Workflow-Signaturgeheimnis ist ungueltig.",
        "workflowFailed",
      );
    }
    const now = new Date();
    await db.transaction(async (tx) => {
      const [current] = await tx
        .select({
          webhookId: webhooks.id,
          url: webhooks.url,
          active: webhooks.active,
          signingSecretEncrypted: webhooks.signingSecretEncrypted,
          updatedAt: webhooks.updatedAt,
        })
        .from(automationWorkflowConnections)
        .innerJoin(
          webhooks,
          and(
            eq(webhooks.id, automationWorkflowConnections.webhookId),
            eq(webhooks.organizationId, actor.organizationId),
          ),
        )
        .where(
          and(
            eq(automationWorkflowConnections.id, workflowId),
            eq(
              automationWorkflowConnections.organizationId,
              actor.organizationId,
            ),
          ),
        )
        .limit(1)
        .for("update", { of: webhooks });
      if (
        !current?.active ||
        current.webhookId !== candidate.webhookId ||
        current.url !== candidate.url ||
        current.signingSecretEncrypted !== candidate.signingSecretEncrypted ||
        current.updatedAt.getTime() !== candidate.updatedAt.getTime()
      ) {
        throw new ApiError(
          409,
          "conflict",
          "Der Workflow wurde waehrend des Preflights geaendert.",
        );
      }
      const testId = randomUUID();
      const [delivery] = await tx
        .insert(webhookDeliveries)
        .values({
          organizationId: actor.organizationId,
          webhookId: current.webhookId,
          event: "webhook.test",
          payload: {
            id: testId,
            type: "webhook.test",
            createdAt: now.toISOString(),
            organizationId: actor.organizationId,
            data: {
              message: "Q-Academy n8n connection preflight",
              workflowId,
            },
          },
        })
        .returning({ id: webhookDeliveries.id });
      await tx.insert(activityEvents).values({
        organizationId: actor.organizationId,
        userId: actor.id,
        type: "automation.n8n.workflow.test_queued",
        entityType: "automation_workflow",
        entityId: workflowId,
        metadata: {
          webhookId: current.webhookId,
          deliveryId: delivery.id,
          targetHost: new URL(candidate.url).hostname,
        },
      });
    });
    return {
      ok: true,
      message: "Eine signierte n8n-Testzustellung wurde durable eingereiht.",
      code: "workflowTestQueued",
    };
  } catch (error) {
    if (error instanceof ApiError) {
      return initialError(error.message, "workflowFailed");
    }
    logServerError(error, { action: "automation.n8n.admin_test" });
    return initialError(
      "Die n8n-Testzustellung konnte nicht eingereiht werden.",
      "workflowFailed",
    );
  }
}

export async function createN8nWorkflowAction(
  _state: CommerceAdminActionState,
  formData: FormData,
): Promise<CommerceAdminActionState> {
  const actor = await requireTeamPermission("integrations.manage");
  if (formData.get("workflowIntent")) {
    const savedIntent = savedWorkflowIntentSchema.safeParse(
      formData.get("workflowIntent"),
    );
    if (!savedIntent.success) return initialError(issue(savedIntent.error));
    return queueN8nWorkflowTest(actor, savedIntent.data);
  }
  const parsed = n8nWorkflowInputSchema.safeParse({
    name: formData.get("name"),
    url: formData.get("url"),
    signingSecret: formData.get("signingSecret"),
    events: formData.getAll("events"),
    active: checkbox(formData, "active"),
  });
  if (!parsed.success) return initialError(issue(parsed.error));
  try {
    await assertOrganizationFeatureAvailable(
      db,
      actor.organizationId,
      "automations",
    );
    await assertSafeWebhookUrl(parsed.data.url);
    await db.transaction(async (tx) => {
      const [webhook] = await tx.insert(webhooks).values({
        organizationId: actor.organizationId,
        name: `n8n: ${parsed.data.name}`,
        url: parsed.data.url,
        signingSecretEncrypted: encryptWebhookSecret(parsed.data.signingSecret),
        events: parsed.data.events,
        active: parsed.data.active,
        createdById: actor.id,
      }).returning();
      const [workflow] = await tx.insert(automationWorkflowConnections).values({
        organizationId: actor.organizationId,
        provider: "n8n",
        name: parsed.data.name,
        webhookId: webhook.id,
        createdById: actor.id,
      }).returning();
      await tx.insert(activityEvents).values({
        organizationId: actor.organizationId,
        userId: actor.id,
        type: "automation.n8n.workflow.created",
        entityType: "automation_workflow",
        entityId: workflow.id,
        metadata: { webhookId: webhook.id, events: parsed.data.events },
      });
    });
    revalidatePath("/admin/integrations");
    return { ok: true, message: "n8n-Workflow verbunden.", code: "workflowCreated" };
  } catch (error) {
    if (error instanceof ApiError) return initialError(error.message, "workflowFailed");
    logServerError(error, { action: "automation.n8n.admin_create" });
    return initialError("Der n8n-Workflow konnte nicht verbunden werden.", "workflowFailed");
  }
}

const toggleResourceSchema = z.object({
  kind: z.enum(["product", "mapping", "workflow"]),
  id: z.string().uuid(),
  active: z.enum(["true", "false"]).transform((value) => value === "true"),
});

export async function toggleCommerceResourceAction(formData: FormData) {
  const actor = await requireTeamPermission("integrations.manage");
  const input = toggleResourceSchema.parse({
    kind: formData.get("kind"),
    id: formData.get("id"),
    active: formData.get("active"),
  });
  await db.transaction(async (tx) => {
    await assertOrganizationFeatureAvailable(
      tx,
      actor.organizationId,
      input.kind === "workflow" ? "automations" : "commerce",
    );
    let entityId = input.id;
    if (input.kind === "product") {
      const [updated] = await tx.update(commerceProducts).set({
        active: input.active,
        updatedAt: new Date(),
      }).where(and(
        eq(commerceProducts.id, input.id),
        eq(commerceProducts.organizationId, actor.organizationId),
      )).returning({ id: commerceProducts.id });
      if (!updated) throw new Error("Commerce product not found.");
    } else if (input.kind === "mapping") {
      const [updated] = await tx.update(commerceProductMappings).set({
        active: input.active,
        updatedAt: new Date(),
      }).where(and(
        eq(commerceProductMappings.id, input.id),
        eq(commerceProductMappings.organizationId, actor.organizationId),
      )).returning({ id: commerceProductMappings.id });
      if (!updated) throw new Error("Commerce mapping not found.");
    } else {
      const [workflow] = await tx.select({ webhookId: automationWorkflowConnections.webhookId })
        .from(automationWorkflowConnections)
        .where(and(
          eq(automationWorkflowConnections.id, input.id),
          eq(automationWorkflowConnections.organizationId, actor.organizationId),
        )).limit(1).for("update");
      if (!workflow) throw new Error("Automation workflow not found.");
      const [updated] = await tx.update(webhooks).set({
        active: input.active,
        updatedAt: new Date(),
      }).where(and(
        eq(webhooks.id, workflow.webhookId),
        eq(webhooks.organizationId, actor.organizationId),
      )).returning({ id: webhooks.id });
      if (!updated) throw new Error("Automation webhook not found.");
      entityId = input.id;
    }
    await tx.insert(activityEvents).values({
      organizationId: actor.organizationId,
      userId: actor.id,
      type: `${input.kind}.${input.active ? "enabled" : "disabled"}`,
      entityType: input.kind,
      entityId,
      metadata: { active: input.active },
    });
  });
  revalidatePath("/admin/integrations");
}
