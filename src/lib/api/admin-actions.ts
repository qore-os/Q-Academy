"use server";

import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import { activityEvents, apiKeys, webhooks } from "@/db/schema";
import { requireTeamPermission } from "@/lib/auth";
import { generateApiKey } from "@/lib/api/api-keys";
import { hashApiSecret } from "@/lib/api/auth";
import { encryptWebhookSecret } from "@/lib/api/crypto";
import { ApiError } from "@/lib/api/errors";
import {
  API_SCOPES,
  isOwnerBoundApiScope,
  WEBHOOK_EVENTS,
} from "@/lib/api/scopes";
import { assertSafeWebhookUrl } from "@/lib/api/webhook-security";
import {
  PrivacyOwnerStepUpError,
  verifyPrivacyOwnerStepUp,
} from "@/lib/privacy/owner-step-up";
import { logServerError } from "@/lib/server-error-logging";
import {
  getWebhookDelivery,
  listWebhookDeliveries,
  replayFailedWebhookDelivery,
} from "@/lib/api/webhook-delivery-operations";
import type {
  WebhookDeliveryDetail,
  WebhookDeliverySummary,
} from "@/lib/api/webhook-delivery-model";

export type ApiAdminActionMessageKey =
  | "validation.invalidInput"
  | "validation.nameTooShort"
  | "validation.nameTooLong"
  | "validation.apiScopesRequired"
  | "validation.apiScopesTooMany"
  | "validation.apiScopesDuplicate"
  | "validation.expirationDateInvalid"
  | "validation.currentPasswordTooLong"
  | "validation.webhookUrlInvalid"
  | "validation.webhookHttpsRequired"
  | "validation.webhookEventsRequired"
  | "validation.webhookEventsTooMany"
  | "validation.webhookEventsDuplicate"
  | "apiKey.ownerScopeRequiresOwner"
  | "apiKey.expirationDateMustBeFuture"
  | "apiKey.ownerVerificationInvalidPassword"
  | "apiKey.ownerVerificationRateLimited"
  | "apiKey.ownerVerificationOwnerRequired"
  | "apiKey.ownerVerificationReauthenticationRequired"
  | "apiKey.created"
  | "apiKey.createFailed"
  | "apiKey.invalid"
  | "apiKey.notFoundOrRevoked"
  | "apiKey.revoked"
  | "apiKey.revokeFailed"
  | "webhook.created"
  | "webhook.createFailed"
  | "webhook.invalid"
  | "webhook.notFound"
  | "webhook.activated"
  | "webhook.deactivated"
  | "webhook.statusChangeFailed"
  | "webhook.secretRotated"
  | "webhook.secretRotationFailed"
  | "webhook.deleted"
  | "webhook.deleteFailed"
  | "webhookDelivery.failedListLoaded"
  | "webhookDelivery.failedListLoadFailed"
  | "webhookDelivery.invalid"
  | "webhookDelivery.notFound"
  | "webhookDelivery.loaded"
  | "webhookDelivery.loadFailed"
  | "webhookDelivery.notReplayable"
  | "webhookDelivery.requeued"
  | "webhookDelivery.replayFailed";

export type ApiAdminActionMessage = {
  key: ApiAdminActionMessageKey;
  values?: Readonly<Record<string, string | number | boolean>>;
};

export type ApiAdminActionState = {
  ok: boolean | null;
  message: ApiAdminActionMessage | null;
  secret?: string;
  resourceId?: string;
};

export type WebhookDeliveryAdminActionResult<T> =
  | { ok: true; message: ApiAdminActionMessage; data: T }
  | { ok: false; message: ApiAdminActionMessage };

const validationMessageKeys = {
  invalidInput: "validation.invalidInput",
  nameTooShort: "validation.nameTooShort",
  nameTooLong: "validation.nameTooLong",
  apiScopesRequired: "validation.apiScopesRequired",
  apiScopesTooMany: "validation.apiScopesTooMany",
  apiScopesDuplicate: "validation.apiScopesDuplicate",
  expirationDateInvalid: "validation.expirationDateInvalid",
  currentPasswordTooLong: "validation.currentPasswordTooLong",
  webhookUrlInvalid: "validation.webhookUrlInvalid",
  webhookHttpsRequired: "validation.webhookHttpsRequired",
  webhookEventsRequired: "validation.webhookEventsRequired",
  webhookEventsTooMany: "validation.webhookEventsTooMany",
  webhookEventsDuplicate: "validation.webhookEventsDuplicate",
} as const satisfies Record<string, ApiAdminActionMessageKey>;

const knownValidationMessageKeys = new Set<string>(
  Object.values(validationMessageKeys),
);

const identifierSchema = z.string().uuid();
const apiKeyFormSchema = z.object({
  name: z
    .string(validationMessageKeys.invalidInput)
    .trim()
    .min(2, validationMessageKeys.nameTooShort)
    .max(160, validationMessageKeys.nameTooLong),
  scopes: z
    .array(z.enum(API_SCOPES, validationMessageKeys.invalidInput))
    .min(1, validationMessageKeys.apiScopesRequired)
    .max(API_SCOPES.length, validationMessageKeys.apiScopesTooMany)
    .refine(
      (values) => new Set(values).size === values.length,
      validationMessageKeys.apiScopesDuplicate,
    ),
  expiresAt: z.union([
    z.literal(""),
    z
      .string(validationMessageKeys.expirationDateInvalid)
      .regex(/^\d{4}-\d{2}-\d{2}$/, validationMessageKeys.expirationDateInvalid),
  ]),
  currentPassword: z
    .string(validationMessageKeys.invalidInput)
    .max(200, validationMessageKeys.currentPasswordTooLong)
    .default(""),
});
const webhookFormSchema = z.object({
  name: z
    .string(validationMessageKeys.invalidInput)
    .trim()
    .min(2, validationMessageKeys.nameTooShort)
    .max(160, validationMessageKeys.nameTooLong),
  url: z
    .string(validationMessageKeys.webhookUrlInvalid)
    .trim()
    .url(validationMessageKeys.webhookUrlInvalid)
    .max(2000, validationMessageKeys.webhookUrlInvalid)
    .refine(
      (value) => value.startsWith("https://"),
      validationMessageKeys.webhookHttpsRequired,
    ),
  events: z
    .array(z.enum(WEBHOOK_EVENTS, validationMessageKeys.invalidInput))
    .min(1, validationMessageKeys.webhookEventsRequired)
    .max(WEBHOOK_EVENTS.length, validationMessageKeys.webhookEventsTooMany)
    .refine(
      (values) => new Set(values).size === values.length,
      validationMessageKeys.webhookEventsDuplicate,
    ),
});

function actionMessage(
  key: ApiAdminActionMessageKey,
  values?: ApiAdminActionMessage["values"],
): ApiAdminActionMessage {
  return values ? { key, values } : { key };
}

function errorState(
  key: ApiAdminActionMessageKey,
  values?: ApiAdminActionMessage["values"],
): ApiAdminActionState {
  return { ok: false, message: actionMessage(key, values) };
}

function issueMessage(error: z.ZodError): ApiAdminActionMessageKey {
  const issueKey = error.issues[0]?.message;
  return issueKey && knownValidationMessageKeys.has(issueKey)
    ? (issueKey as ApiAdminActionMessageKey)
    : validationMessageKeys.invalidInput;
}

function mutationError(
  error: unknown,
  fallback: ApiAdminActionMessageKey,
): ApiAdminActionState {
  if (error instanceof ApiError) return errorState(fallback);
  logServerError(error, { action: "admin.api.mutation" });
  return errorState(fallback);
}

function deliveryActionError<T>(
  error: unknown,
  fallback: ApiAdminActionMessageKey,
): WebhookDeliveryAdminActionResult<T> {
  if (error instanceof ApiError) {
    return { ok: false, message: actionMessage(fallback) };
  }
  logServerError(error, { action: "admin.api.webhook_delivery" });
  return { ok: false, message: actionMessage(fallback) };
}

function ownerVerificationError(
  error: PrivacyOwnerStepUpError,
): ApiAdminActionState {
  switch (error.code) {
    case "invalid_password":
      return errorState("apiKey.ownerVerificationInvalidPassword");
    case "rate_limited":
      return errorState("apiKey.ownerVerificationRateLimited");
    case "owner_required":
      return errorState("apiKey.ownerVerificationOwnerRequired");
    case "reauth_required":
      return errorState("apiKey.ownerVerificationReauthenticationRequired");
  }
}

export async function listFailedWebhookDeliveriesAdminAction(): Promise<
  WebhookDeliveryAdminActionResult<WebhookDeliverySummary[]>
> {
  const user = await requireTeamPermission("api.view");
  try {
    const deliveries = await listWebhookDeliveries({
      organizationId: user.organizationId,
      status: "failed",
      limit: 50,
    });
    return {
      ok: true,
      message: actionMessage("webhookDelivery.failedListLoaded"),
      data: deliveries,
    };
  } catch (error) {
    return deliveryActionError(
      error,
      "webhookDelivery.failedListLoadFailed",
    );
  }
}

export async function getWebhookDeliveryAdminAction(
  webhookId: string,
  deliveryId: string,
): Promise<WebhookDeliveryAdminActionResult<WebhookDeliveryDetail>> {
  const user = await requireTeamPermission("api.view");
  const parsedWebhookId = identifierSchema.safeParse(webhookId);
  const parsedDeliveryId = identifierSchema.safeParse(deliveryId);
  if (!parsedWebhookId.success || !parsedDeliveryId.success) {
    return {
      ok: false,
      message: actionMessage("webhookDelivery.invalid"),
    };
  }
  try {
    const delivery = await getWebhookDelivery({
      organizationId: user.organizationId,
      webhookId: parsedWebhookId.data,
      deliveryId: parsedDeliveryId.data,
    });
    if (!delivery) {
      return {
        ok: false,
        message: actionMessage("webhookDelivery.notFound"),
      };
    }
    return {
      ok: true,
      message: actionMessage("webhookDelivery.loaded"),
      data: delivery,
    };
  } catch (error) {
    return deliveryActionError(error, "webhookDelivery.loadFailed");
  }
}

export async function replayWebhookDeliveryAdminAction(
  deliveryId: string,
): Promise<WebhookDeliveryAdminActionResult<WebhookDeliveryDetail>> {
  const user = await requireTeamPermission("api.manage");
  const parsedDeliveryId = identifierSchema.safeParse(deliveryId);
  if (!parsedDeliveryId.success) {
    return {
      ok: false,
      message: actionMessage("webhookDelivery.invalid"),
    };
  }
  try {
    const result = await db.transaction(async (tx) => {
      const replay = await replayFailedWebhookDelivery({
        organizationId: user.organizationId,
        deliveryId: parsedDeliveryId.data,
        executor: tx,
      });
      if (replay.kind !== "requeued") return replay;
      await tx.insert(activityEvents).values({
        organizationId: user.organizationId,
        userId: user.id,
        type: "webhook.delivery_replayed",
        entityType: "webhook_delivery",
        entityId: replay.delivery.id,
        metadata: {
          webhookId: replay.delivery.webhookId,
          event: replay.delivery.event,
          source: "admin",
        },
      });
      return replay;
    });
    if (result.kind === "not_found") {
      return {
        ok: false,
        message: actionMessage("webhookDelivery.notFound"),
      };
    }
    if (result.kind === "not_replayable") {
      return {
        ok: false,
        message: actionMessage("webhookDelivery.notReplayable"),
      };
    }
    revalidatePath("/admin/api");
    return {
      ok: true,
      message: actionMessage("webhookDelivery.requeued", {
        name: result.delivery.webhookName,
      }),
      data: result.delivery,
    };
  } catch (error) {
    return deliveryActionError(error, "webhookDelivery.replayFailed");
  }
}

export async function createApiKeyAdminAction(
  _state: ApiAdminActionState,
  formData: FormData,
): Promise<ApiAdminActionState> {
  const user = await requireTeamPermission("api.manage");
  const parsed = apiKeyFormSchema.safeParse({
    name: formData.get("name"),
    scopes: formData.getAll("scopes"),
    expiresAt: formData.get("expiresAt") ?? "",
    currentPassword: formData.get("currentPassword") ?? "",
  });
  if (!parsed.success) return errorState(issueMessage(parsed.error));

  const ownerBoundScopes = parsed.data.scopes.filter(isOwnerBoundApiScope);
  if (ownerBoundScopes.length > 0 && user.role !== "owner") {
    return errorState("apiKey.ownerScopeRequiresOwner");
  }

  const expiresAt = parsed.data.expiresAt ? new Date(`${parsed.data.expiresAt}T23:59:59.999Z`) : null;
  if (
    expiresAt &&
    (Number.isNaN(expiresAt.getTime()) || expiresAt.toISOString().slice(0, 10) !== parsed.data.expiresAt)
  ) {
    return errorState("validation.expirationDateInvalid");
  }
  if (expiresAt && expiresAt.getTime() <= Date.now()) {
    return errorState("apiKey.expirationDateMustBeFuture");
  }

  try {
    if (ownerBoundScopes.length > 0) {
      await verifyPrivacyOwnerStepUp(user, parsed.data.currentPassword);
    }
    const secret = generateApiKey();
    const resourceId = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(apiKeys)
        .values({
          organizationId: user.organizationId,
          name: parsed.data.name,
          prefix: secret.slice(0, 17),
          keyHash: hashApiSecret(secret),
          scopes: parsed.data.scopes,
          expiresAt,
          createdById: user.id,
        })
        .returning({ id: apiKeys.id });
      await tx.insert(activityEvents).values({
        organizationId: user.organizationId,
        userId: user.id,
        type: "api_key.created",
        entityType: "api_key",
        entityId: created.id,
        metadata: { name: parsed.data.name, scopes: parsed.data.scopes },
      });
      return created.id;
    });

    revalidatePath("/admin/api");
    return {
      ok: true,
      message: actionMessage("apiKey.created"),
      secret,
      resourceId,
    };
  } catch (error) {
    if (error instanceof PrivacyOwnerStepUpError) {
      return ownerVerificationError(error);
    }
    return mutationError(error, "apiKey.createFailed");
  }
}

export async function revokeApiKeyAdminAction(apiKeyId: string): Promise<ApiAdminActionState> {
  const user = await requireTeamPermission("api.manage");
  const parsedId = identifierSchema.safeParse(apiKeyId);
  if (!parsedId.success) return errorState("apiKey.invalid");

  try {
    const revoked = await db.transaction(async (tx) => {
      const [current] = await tx
        .select({
          id: apiKeys.id,
          name: apiKeys.name,
          scopes: apiKeys.scopes,
        })
        .from(apiKeys)
        .where(
          and(
            eq(apiKeys.id, parsedId.data),
            eq(apiKeys.organizationId, user.organizationId),
            eq(apiKeys.status, "active"),
          ),
        )
        .limit(1)
        .for("update");
      if (
        !current ||
        (user.role !== "owner" && current.scopes.some(isOwnerBoundApiScope))
      ) {
        return null;
      }
      const [record] = await tx
        .update(apiKeys)
        .set({ status: "revoked", revokedAt: new Date() })
        .where(
          and(
            eq(apiKeys.id, current.id),
            eq(apiKeys.organizationId, user.organizationId),
            eq(apiKeys.status, "active"),
          ),
        )
        .returning({ id: apiKeys.id, name: apiKeys.name });
      if (!record) return null;
      await tx.insert(activityEvents).values({
        organizationId: user.organizationId,
        userId: user.id,
        type: "api_key.revoked",
        entityType: "api_key",
        entityId: record.id,
        metadata: { name: record.name },
      });
      return record;
    });
    if (!revoked) return errorState("apiKey.notFoundOrRevoked");
    revalidatePath("/admin/api");
    return {
      ok: true,
      message: actionMessage("apiKey.revoked", { name: revoked.name }),
      resourceId: revoked.id,
    };
  } catch (error) {
    return mutationError(error, "apiKey.revokeFailed");
  }
}

export async function createWebhookAdminAction(
  _state: ApiAdminActionState,
  formData: FormData,
): Promise<ApiAdminActionState> {
  const user = await requireTeamPermission("api.manage");
  const parsed = webhookFormSchema.safeParse({
    name: formData.get("name"),
    url: formData.get("url"),
    events: formData.getAll("events"),
  });
  if (!parsed.success) return errorState(issueMessage(parsed.error));

  try {
    await assertSafeWebhookUrl(parsed.data.url);
    const secret = `whsec_${randomBytes(32).toString("base64url")}`;
    const resourceId = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(webhooks)
        .values({
          organizationId: user.organizationId,
          name: parsed.data.name,
          url: parsed.data.url,
          events: parsed.data.events,
          active: true,
          signingSecretEncrypted: encryptWebhookSecret(secret),
          createdById: user.id,
        })
        .returning({ id: webhooks.id });
      await tx.insert(activityEvents).values({
        organizationId: user.organizationId,
        userId: user.id,
        type: "webhook.created",
        entityType: "webhook",
        entityId: created.id,
        metadata: { name: parsed.data.name, events: parsed.data.events },
      });
      return created.id;
    });

    revalidatePath("/admin/api");
    return {
      ok: true,
      message: actionMessage("webhook.created"),
      secret,
      resourceId,
    };
  } catch (error) {
    return mutationError(error, "webhook.createFailed");
  }
}

export async function toggleWebhookAdminAction(webhookId: string): Promise<ApiAdminActionState> {
  const user = await requireTeamPermission("api.manage");
  const parsedId = identifierSchema.safeParse(webhookId);
  if (!parsedId.success) return errorState("webhook.invalid");

  try {
    const changed = await db.transaction(async (tx) => {
      const [current] = await tx
        .select({ id: webhooks.id, name: webhooks.name, active: webhooks.active })
        .from(webhooks)
        .where(and(eq(webhooks.id, parsedId.data), eq(webhooks.organizationId, user.organizationId)))
        .limit(1);
      if (!current) return null;
      const active = !current.active;
      await tx
        .update(webhooks)
        .set({ active, updatedAt: new Date() })
        .where(and(eq(webhooks.id, current.id), eq(webhooks.organizationId, user.organizationId)));
      await tx.insert(activityEvents).values({
        organizationId: user.organizationId,
        userId: user.id,
        type: active ? "webhook.activated" : "webhook.deactivated",
        entityType: "webhook",
        entityId: current.id,
        metadata: { name: current.name },
      });
      return { ...current, active };
    });
    if (!changed) return errorState("webhook.notFound");
    revalidatePath("/admin/api");
    return {
      ok: true,
      message: actionMessage(
        changed.active ? "webhook.activated" : "webhook.deactivated",
        { name: changed.name },
      ),
      resourceId: changed.id,
    };
  } catch (error) {
    return mutationError(error, "webhook.statusChangeFailed");
  }
}

export async function rotateWebhookSecretAdminAction(webhookId: string): Promise<ApiAdminActionState> {
  const user = await requireTeamPermission("api.manage");
  const parsedId = identifierSchema.safeParse(webhookId);
  if (!parsedId.success) return errorState("webhook.invalid");

  try {
    const secret = `whsec_${randomBytes(32).toString("base64url")}`;
    const rotated = await db.transaction(async (tx) => {
      const [record] = await tx
        .update(webhooks)
        .set({ signingSecretEncrypted: encryptWebhookSecret(secret), updatedAt: new Date() })
        .where(and(eq(webhooks.id, parsedId.data), eq(webhooks.organizationId, user.organizationId)))
        .returning({ id: webhooks.id, name: webhooks.name });
      if (!record) return null;
      await tx.insert(activityEvents).values({
        organizationId: user.organizationId,
        userId: user.id,
        type: "webhook.secret_rotated",
        entityType: "webhook",
        entityId: record.id,
        metadata: { name: record.name },
      });
      return record;
    });
    if (!rotated) return errorState("webhook.notFound");
    revalidatePath("/admin/api");
    return {
      ok: true,
      message: actionMessage("webhook.secretRotated", {
        name: rotated.name,
      }),
      secret,
      resourceId: rotated.id,
    };
  } catch (error) {
    return mutationError(error, "webhook.secretRotationFailed");
  }
}

export async function deleteWebhookAdminAction(webhookId: string): Promise<ApiAdminActionState> {
  const user = await requireTeamPermission("api.manage");
  const parsedId = identifierSchema.safeParse(webhookId);
  if (!parsedId.success) return errorState("webhook.invalid");

  try {
    const deleted = await db.transaction(async (tx) => {
      const [record] = await tx
        .delete(webhooks)
        .where(and(eq(webhooks.id, parsedId.data), eq(webhooks.organizationId, user.organizationId)))
        .returning({ id: webhooks.id, name: webhooks.name });
      if (!record) return null;
      await tx.insert(activityEvents).values({
        organizationId: user.organizationId,
        userId: user.id,
        type: "webhook.deleted",
        entityType: "webhook",
        entityId: record.id,
        metadata: { name: record.name },
      });
      return record;
    });
    if (!deleted) return errorState("webhook.notFound");
    revalidatePath("/admin/api");
    return {
      ok: true,
      message: actionMessage("webhook.deleted", { name: deleted.name }),
      resourceId: deleted.id,
    };
  } catch (error) {
    return mutationError(error, "webhook.deleteFailed");
  }
}
