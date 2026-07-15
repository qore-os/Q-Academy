import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import {
  activityEvents,
  nativePushDevices,
  userSessions,
} from "@/db/schema";
import { decryptPayload, encryptPayload } from "@/lib/api/crypto";
import { ApiError } from "@/lib/api/errors";
import { resolveNativePushProviderConfiguration } from "@/lib/push/native-provider-config";

const MAX_DEVICES_PER_USER = 5;
const APP_ID_PATTERN = /^[A-Za-z0-9.-]{3,180}$/;
const ANDROID_TOKEN_PATTERN = /^[A-Za-z0-9_:.-]{20,4096}$/;
const IOS_TOKEN_PATTERN = /^[0-9a-f]{64,200}$/i;

export const nativePushDeviceInputSchema = z
  .object({
    platform: z.enum(["ios", "android"]),
    appId: z.string().trim().regex(APP_ID_PATTERN),
    token: z.string().trim().min(20).max(4_096),
  })
  .strict()
  .superRefine((input, context) => {
    const pattern =
      input.platform === "ios" ? IOS_TOKEN_PATTERN : ANDROID_TOKEN_PATTERN;
    if (!pattern.test(input.token)) {
      context.addIssue({
        code: "custom",
        path: ["token"],
        message: "Das native Push-Token ist ungueltig.",
      });
    }
  });

export type NativePushDeviceInput = z.infer<typeof nativePushDeviceInputSchema>;

function associatedData(input: {
  id: string;
  organizationId: string;
  userId: string;
  sessionId: string;
}) {
  return `native-push-device:${input.organizationId}:${input.userId}:${input.sessionId}:${input.id}`;
}

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function requireConfiguredPlatform(platform: NativePushDeviceInput["platform"]) {
  const configuration = resolveNativePushProviderConfiguration();
  if (configuration[platform]) return;
  throw new ApiError(
    409,
    "conflict",
    "Native Push-Benachrichtigungen sind fuer diese Plattform nicht konfiguriert.",
  );
}

export async function upsertNativePushDevice(input: {
  organizationId: string;
  userId: string;
  sessionId: string;
  device: NativePushDeviceInput;
}) {
  requireConfiguredPlatform(input.device.platform);
  const expectedAppId =
    process.env.MOBILE_APP_BUNDLE_ID?.trim() || "com.qacademy.mobile";
  if (input.device.appId !== expectedAppId) {
    throw new ApiError(422, "validation_error", "Die native App-ID ist ungueltig.");
  }
  const hash = tokenHash(input.device.token);
  return db.transaction(async (tx) => {
    const [session] = await tx
      .select({ id: userSessions.id })
      .from(userSessions)
      .where(
        and(
          eq(userSessions.id, input.sessionId),
          eq(userSessions.organizationId, input.organizationId),
          eq(userSessions.userId, input.userId),
          isNull(userSessions.revokedAt),
          gt(userSessions.expiresAt, new Date()),
        ),
      )
      .limit(1)
      .for("share", { of: userSessions });
    if (!session) {
      throw new ApiError(401, "authentication_required", "Die Sitzung ist nicht mehr aktiv.");
    }
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`native-push:${hash}`}, 0))`,
    );
    const [existingRow] = await tx
      .select({
        id: nativePushDevices.id,
        organizationId: nativePushDevices.organizationId,
        userId: nativePushDevices.userId,
        sessionId: nativePushDevices.sessionId,
        sessionRevokedAt: userSessions.revokedAt,
        sessionExpiresAt: userSessions.expiresAt,
      })
      .from(nativePushDevices)
      .leftJoin(
        userSessions,
        and(
          eq(userSessions.id, nativePushDevices.sessionId),
          eq(userSessions.userId, nativePushDevices.userId),
          eq(userSessions.organizationId, nativePushDevices.organizationId),
        ),
      )
      .where(eq(nativePushDevices.tokenHash, hash))
      .limit(1)
      .for("update", { of: nativePushDevices });
    let existing: typeof existingRow | undefined = existingRow;
    const sameSession =
      existing?.organizationId === input.organizationId &&
      existing.userId === input.userId &&
      existing.sessionId === input.sessionId;
    if (existing && !sameSession) {
      const existingSessionActive =
        existing.sessionRevokedAt === null &&
        existing.sessionExpiresAt !== null &&
        existing.sessionExpiresAt > new Date();
      if (existingSessionActive) {
        throw new ApiError(
          409,
          "conflict",
          "Dieses native Geraet ist noch an eine andere aktive Sitzung gebunden.",
        );
      }
      await tx
        .delete(nativePushDevices)
        .where(eq(nativePushDevices.id, existing.id));
      existing = undefined;
    }
    const id = existing?.id ?? randomUUID();
    const tokenEncrypted = encryptPayload(
      input.device.token,
      associatedData({ ...input, id }),
    );
    if (existing) {
      await tx
        .update(nativePushDevices)
        .set({
          platform: input.device.platform,
          appId: input.device.appId,
          tokenEncrypted,
          updatedAt: new Date(),
        })
        .where(eq(nativePushDevices.id, id));
    } else {
      await tx.insert(nativePushDevices).values({
        id,
        organizationId: input.organizationId,
        userId: input.userId,
        sessionId: input.sessionId,
        platform: input.device.platform,
        appId: input.device.appId,
        tokenHash: hash,
        tokenEncrypted,
      });
    }
    const devices = await tx
      .select({ id: nativePushDevices.id })
      .from(nativePushDevices)
      .where(
        and(
          eq(nativePushDevices.organizationId, input.organizationId),
          eq(nativePushDevices.userId, input.userId),
        ),
      )
      .orderBy(desc(nativePushDevices.updatedAt), desc(nativePushDevices.id));
    const pruned = devices.slice(MAX_DEVICES_PER_USER).map((entry) => entry.id);
    if (pruned.length) {
      await tx.delete(nativePushDevices).where(inArray(nativePushDevices.id, pruned));
    }
    await tx.insert(activityEvents).values({
      organizationId: input.organizationId,
      userId: input.userId,
      type: "push.native.enabled",
      entityType: "native_push_device",
      entityId: id,
      metadata: { platform: input.device.platform, refreshed: Boolean(existing) },
    });
    return { id, enabled: true as const };
  });
}

export async function deleteNativePushDevices(input: {
  organizationId: string;
  userId: string;
  sessionId: string;
  platform?: NativePushDeviceInput["platform"];
}) {
  const removed = await db.transaction(async (tx) => {
    const rows = await tx
      .delete(nativePushDevices)
      .where(
        and(
          eq(nativePushDevices.organizationId, input.organizationId),
          eq(nativePushDevices.userId, input.userId),
          eq(nativePushDevices.sessionId, input.sessionId),
          input.platform
            ? eq(nativePushDevices.platform, input.platform)
            : undefined,
        ),
      )
      .returning({ id: nativePushDevices.id });
    if (rows.length) {
      await tx.insert(activityEvents).values({
        organizationId: input.organizationId,
        userId: input.userId,
        type: "push.native.disabled",
        entityType: "native_push_device",
        metadata: { platform: input.platform ?? "all", count: rows.length },
      });
    }
    return rows.length;
  });
  return { enabled: false as const, removed };
}

export async function hasNativePushDevice(input: {
  organizationId: string;
  userId: string;
  sessionId: string;
  platform: NativePushDeviceInput["platform"];
}) {
  const [device] = await db
    .select({ id: nativePushDevices.id })
    .from(nativePushDevices)
    .where(
      and(
        eq(nativePushDevices.organizationId, input.organizationId),
        eq(nativePushDevices.userId, input.userId),
        eq(nativePushDevices.sessionId, input.sessionId),
        eq(nativePushDevices.platform, input.platform),
      ),
    )
    .limit(1);
  return Boolean(device);
}

export function decryptNativePushToken(input: {
  id: string;
  organizationId: string;
  userId: string;
  sessionId: string;
  tokenEncrypted: unknown;
}) {
  const token = decryptPayload(
    input.tokenEncrypted,
    associatedData(input),
  );
  if (!ANDROID_TOKEN_PATTERN.test(token) && !IOS_TOKEN_PATTERN.test(token)) {
    throw new Error("Stored native push token is invalid.");
  }
  return token;
}
