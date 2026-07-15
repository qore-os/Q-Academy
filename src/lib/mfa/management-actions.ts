"use server";

import { and, eq, gt, isNull, ne, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db";
import {
  activityEvents,
  organizationMfaPolicies,
  organizations,
  oidcConfigurations,
  userMfaConfigurations,
  userSessions,
  users,
  type User,
} from "@/db/schema";
import { getSession, requireOwner, requireUser } from "@/lib/auth";
import {
  clearPersistentRateLimit,
  consumePersistentRateLimit,
  retryAfterSeconds,
} from "@/lib/auth-rate-limit";
import { verifyActiveUserPassword } from "@/lib/auth-credentials";
import {
  decryptMfaSecret,
  encryptMfaSecret,
  hashRecoveryCode,
} from "@/lib/mfa/secrets";
import {
  buildOtpAuthUri,
  generateRecoveryCodes,
  generateTotpSecret,
  verifyTotpCode,
} from "@/lib/mfa/totp";
import {
  lockAndRevalidateMfaActor,
  MfaActorRevalidationError,
  type MfaPrimaryFactorProof,
} from "@/lib/mfa/management-security";
import { isMfaProtectedRole } from "@/lib/mfa/roles";
import { verifyMfaSecondFactor } from "@/lib/mfa/second-factor";

export type MfaManagementActionState = {
  ok: boolean | null;
  message: string;
  secret?: string;
  otpAuthUri?: string;
  recoveryCodes?: string[];
};

export type MfaPolicyActionState = {
  ok: boolean | null;
  message: string;
  revision?: number;
};

class MfaManagementError extends Error {}

const passwordSchema = z.string().max(200);
const codeSchema = z.string().trim().min(6).max(32);
const policySchema = z.object({
  required: z.enum(["true", "false"]).transform((value) => value === "true"),
  expectedRevision: z.coerce.number().int().min(0),
  password: passwordSchema,
  code: codeSchema,
});

function text(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function checkboxValue(formData: FormData, name: string) {
  const values = formData
    .getAll(name)
    .filter((value): value is string => typeof value === "string");
  if (
    values.length === 0 ||
    values.length > 2 ||
    values.some((value) => value !== "true" && value !== "false") ||
    (values.length === 2 &&
      (!values.includes("true") || !values.includes("false")))
  ) return "";
  return values.includes("true") ? "true" : "false";
}

function managementIdentifier(user: Pick<User, "id" | "organizationId">) {
  return `${user.organizationId}:${user.id}`;
}

async function consumeManagementLimit(user: Pick<User, "id" | "organizationId">) {
  const result = await consumePersistentRateLimit({
    action: "mfa_management",
    identifier: managementIdentifier(user),
  });
  if (result.limited) {
    throw new MfaManagementError(
      `Zu viele Sicherheitsversuche. Bitte versuche es in ${retryAfterSeconds(result.resetAt)} Sekunden erneut.`,
    );
  }
}

async function verifyPrimaryFactor(
  user: User,
  password: string,
): Promise<MfaPrimaryFactorProof> {
  const [configuration] = await db
    .select({
      enabled: oidcConfigurations.enabled,
      passwordLoginEnabled: oidcConfigurations.passwordLoginEnabled,
    })
    .from(oidcConfigurations)
    .where(eq(oidcConfigurations.organizationId, user.organizationId))
    .limit(1);
  if (configuration?.passwordLoginEnabled !== false) {
    if (password.length < 8 || !(await verifyActiveUserPassword(user, password))) {
      throw new MfaManagementError("Das aktuelle Passwort ist nicht korrekt.");
    }
    return { method: "password", passwordHash: user.passwordHash };
  }
  const session = await getSession();
  const recentCutoff = new Date(Date.now() - 5 * 60_000);
  const [recentOidcProof] =
    configuration.enabled && session
      ? await db
          .select({ id: userSessions.id })
          .from(userSessions)
          .where(
            and(
              eq(userSessions.id, session.sessionId),
              eq(userSessions.organizationId, user.organizationId),
              eq(userSessions.userId, user.id),
              eq(userSessions.authMethod, "oidc"),
              isNull(userSessions.revokedAt),
              gt(userSessions.expiresAt, new Date()),
              gt(userSessions.authenticatedAt, recentCutoff),
              gt(userSessions.oidcAuthTime, recentCutoff),
            ),
          )
          .limit(1)
      : [];
  if (!recentOidcProof) {
    throw new MfaManagementError(
      "Bitte bestaetige diese Sicherheitsaktion erneut beim Identity Provider.",
    );
  }
  return { method: "oidc", sessionId: recentOidcProof.id };
}

function refreshSecurity() {
  revalidatePath("/academy/profile");
  revalidatePath("/admin/settings");
}

function isManagementError(error: unknown): error is Error {
  return (
    error instanceof MfaManagementError ||
    error instanceof MfaActorRevalidationError
  );
}

export async function beginOwnMfaEnrollmentAction(
  _state: MfaManagementActionState,
  formData: FormData,
): Promise<MfaManagementActionState> {
  const actor = await requireUser();
  if (!isMfaProtectedRole(actor.role)) return { ok: false, message: "MFA wird fuer Owner und Administratoren verwaltet." };
  const password = passwordSchema.safeParse(text(formData, "password"));
  if (!password.success) return { ok: false, message: "Bitte gib dein aktuelles Passwort ein." };
  try {
    await consumeManagementLimit(actor);
    const primaryProof = await verifyPrimaryFactor(actor, password.data);
    const [organization] = await db
      .select({ name: organizations.name })
      .from(organizations)
      .where(eq(organizations.id, actor.organizationId))
      .limit(1);
    if (!organization) throw new MfaManagementError("Die Organisation ist nicht verfuegbar.");
    const secret = generateTotpSecret();
    const now = new Date();
    const accountEmail = await db.transaction(async (tx) => {
      const lockedActor = await lockAndRevalidateMfaActor(tx, {
        actor,
        proof: primaryProof,
        requiredRole: "privileged",
        now,
      });
      const [existing] = await tx
        .select({ status: userMfaConfigurations.status })
        .from(userMfaConfigurations)
        .where(
          and(
            eq(userMfaConfigurations.userId, actor.id),
            eq(userMfaConfigurations.organizationId, actor.organizationId),
          ),
        )
        .limit(1)
        .for("update");
      if (existing?.status === "enabled") {
        throw new MfaManagementError("MFA ist bereits aktiv.");
      }
      await tx
        .insert(userMfaConfigurations)
        .values({
          userId: actor.id,
          organizationId: actor.organizationId,
          secretEncrypted: encryptMfaSecret(secret, actor.organizationId, actor.id),
          status: "pending",
          recoveryCodeHashes: [],
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: userMfaConfigurations.userId,
          set: {
            secretEncrypted: encryptMfaSecret(secret, actor.organizationId, actor.id),
            status: "pending",
            recoveryCodeHashes: [],
            lastTotpCounter: null,
            enabledAt: null,
            updatedAt: now,
          },
        });
      await tx.insert(activityEvents).values({
        organizationId: lockedActor.organizationId,
        userId: lockedActor.id,
        type: "security.mfa.enrollment_started",
        entityType: "user",
        entityId: lockedActor.id,
        metadata: {},
      });
      return lockedActor.email;
    });
    await clearPersistentRateLimit({ action: "mfa_management", identifier: managementIdentifier(actor) });
    refreshSecurity();
    return {
      ok: true,
      message: "Scanne den QR-Code und bestaetige die Einrichtung.",
      secret,
      otpAuthUri: buildOtpAuthUri({
        secret,
        issuer: organization.name,
        accountName: accountEmail,
      }),
    };
  } catch (error) {
    if (isManagementError(error)) return { ok: false, message: error.message };
    throw error;
  }
}

export async function confirmOwnMfaEnrollmentAction(
  _state: MfaManagementActionState,
  formData: FormData,
): Promise<MfaManagementActionState> {
  const actor = await requireUser();
  if (!isMfaProtectedRole(actor.role)) return { ok: false, message: "Diese Aktion ist nicht verfuegbar." };
  const parsed = z.object({ password: passwordSchema, code: z.string().regex(/^\d{6}$/) }).safeParse({
    password: text(formData, "password"),
    code: text(formData, "code").replace(/[\s-]/g, ""),
  });
  if (!parsed.success) return { ok: false, message: "Bitte pruefe Passwort und sechsstelligen Code." };
  try {
    await consumeManagementLimit(actor);
    const primaryProof = await verifyPrimaryFactor(actor, parsed.data.password);
    const session = await getSession();
    if (!session) throw new MfaManagementError("Die Sitzung ist nicht mehr aktiv.");
    const recoveryCodes = generateRecoveryCodes();
    const now = new Date();
    await db.transaction(async (tx) => {
      const lockedActor = await lockAndRevalidateMfaActor(tx, {
        actor,
        proof: primaryProof,
        requiredRole: "privileged",
        now,
      });
      const [configuration] = await tx
        .select()
        .from(userMfaConfigurations)
        .where(
          and(
            eq(userMfaConfigurations.userId, actor.id),
            eq(userMfaConfigurations.organizationId, actor.organizationId),
          ),
        )
        .limit(1)
        .for("update");
      if (!configuration || configuration.status !== "pending") {
        throw new MfaManagementError("Starte die MFA-Einrichtung erneut.");
      }
      const secret = decryptMfaSecret(
        configuration.secretEncrypted,
        lockedActor.organizationId,
        lockedActor.id,
      );
      const counter = verifyTotpCode({ secret, code: parsed.data.code });
      if (counter === null) throw new MfaManagementError("Der Bestaetigungscode ist nicht korrekt.");
      await tx
        .update(userMfaConfigurations)
        .set({
          status: "enabled",
          recoveryCodeHashes: recoveryCodes.map((code) =>
            hashRecoveryCode(code, lockedActor.organizationId, lockedActor.id),
          ),
          lastTotpCounter: counter,
          enabledAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(userMfaConfigurations.userId, lockedActor.id),
            eq(
              userMfaConfigurations.organizationId,
              lockedActor.organizationId,
            ),
          ),
        );
      await tx
        .update(userSessions)
        .set({ revokedAt: now })
        .where(
          and(
            eq(userSessions.userId, lockedActor.id),
            eq(userSessions.organizationId, lockedActor.organizationId),
            ne(userSessions.id, session.sessionId),
            isNull(userSessions.revokedAt),
          ),
        );
      await tx
        .update(userSessions)
        .set({ mfaVerifiedAt: now, mfaMethod: "totp" })
        .where(
          and(
            eq(userSessions.id, session.sessionId),
            eq(userSessions.userId, lockedActor.id),
            eq(userSessions.organizationId, lockedActor.organizationId),
          ),
        );
      await tx.insert(activityEvents).values({
        organizationId: lockedActor.organizationId,
        userId: lockedActor.id,
        type: "security.mfa.enabled",
        entityType: "user",
        entityId: lockedActor.id,
        metadata: { otherSessionsRevoked: true },
      });
    });
    await clearPersistentRateLimit({ action: "mfa_management", identifier: managementIdentifier(actor) });
    refreshSecurity();
    return { ok: true, message: "MFA ist aktiv. Speichere die Recovery-Codes jetzt.", recoveryCodes };
  } catch (error) {
    if (isManagementError(error)) return { ok: false, message: error.message };
    throw error;
  }
}

export async function regenerateOwnMfaRecoveryCodesAction(
  _state: MfaManagementActionState,
  formData: FormData,
): Promise<MfaManagementActionState> {
  const actor = await requireUser();
  if (!isMfaProtectedRole(actor.role)) return { ok: false, message: "Diese Aktion ist nicht verfuegbar." };
  const parsed = z.object({ password: passwordSchema, code: codeSchema }).safeParse({
    password: text(formData, "password"), code: text(formData, "code"),
  });
  if (!parsed.success) return { ok: false, message: "Bitte pruefe Passwort und MFA-Code." };
  try {
    await consumeManagementLimit(actor);
    const primaryProof = await verifyPrimaryFactor(actor, parsed.data.password);
    const recoveryCodes = generateRecoveryCodes();
    const now = new Date();
    await db.transaction(async (tx) => {
      const lockedActor = await lockAndRevalidateMfaActor(tx, {
        actor,
        proof: primaryProof,
        requiredRole: "privileged",
        now,
      });
      const [configuration] = await tx
        .select()
        .from(userMfaConfigurations)
        .where(and(eq(userMfaConfigurations.userId, actor.id), eq(userMfaConfigurations.organizationId, actor.organizationId)))
        .limit(1)
        .for("update");
      if (!configuration) throw new MfaManagementError("MFA ist nicht aktiv.");
      const secondFactorProof = verifyMfaSecondFactor(
        configuration,
        parsed.data.code,
      );
      if (!secondFactorProof) {
        throw new MfaManagementError("Der MFA- oder Recovery-Code ist nicht korrekt.");
      }
      await tx
        .update(userMfaConfigurations)
        .set({
          recoveryCodeHashes: recoveryCodes.map((code) =>
            hashRecoveryCode(code, lockedActor.organizationId, lockedActor.id),
          ),
          lastTotpCounter: secondFactorProof.counter,
          updatedAt: now,
        })
        .where(
          and(
            eq(userMfaConfigurations.userId, lockedActor.id),
            eq(
              userMfaConfigurations.organizationId,
              lockedActor.organizationId,
            ),
          ),
        );
      await tx.insert(activityEvents).values({
        organizationId: lockedActor.organizationId,
        userId: lockedActor.id,
        type: "security.mfa.recovery_regenerated",
        entityType: "user",
        entityId: lockedActor.id,
        metadata: { verificationMethod: secondFactorProof.method },
      });
    });
    await clearPersistentRateLimit({ action: "mfa_management", identifier: managementIdentifier(actor) });
    refreshSecurity();
    return { ok: true, message: "Neue Recovery-Codes wurden erstellt. Alte Codes sind ungueltig.", recoveryCodes };
  } catch (error) {
    if (isManagementError(error)) return { ok: false, message: error.message };
    throw error;
  }
}

export async function disableOwnMfaAction(
  _state: MfaManagementActionState,
  formData: FormData,
): Promise<MfaManagementActionState> {
  const actor = await requireUser();
  if (!isMfaProtectedRole(actor.role)) return { ok: false, message: "Diese Aktion ist nicht verfuegbar." };
  const parsed = z.object({ password: passwordSchema, code: codeSchema }).safeParse({
    password: text(formData, "password"), code: text(formData, "code"),
  });
  if (!parsed.success) return { ok: false, message: "Bitte pruefe Passwort und MFA-Code." };
  try {
    await consumeManagementLimit(actor);
    const primaryProof = await verifyPrimaryFactor(actor, parsed.data.password);
    const session = await getSession();
    if (!session) throw new MfaManagementError("Die Sitzung ist nicht mehr aktiv.");
    const now = new Date();
    await db.transaction(async (tx) => {
      const lockedActor = await lockAndRevalidateMfaActor(tx, {
        actor,
        proof: primaryProof,
        requiredRole: "privileged",
        now,
      });
      const [configuration] = await tx
        .select()
        .from(userMfaConfigurations)
        .where(and(eq(userMfaConfigurations.userId, actor.id), eq(userMfaConfigurations.organizationId, actor.organizationId)))
        .limit(1)
        .for("update");
      if (!configuration) throw new MfaManagementError("MFA ist nicht aktiv.");
      const [policy] = await tx
        .select({ required: organizationMfaPolicies.requireForPrivileged })
        .from(organizationMfaPolicies)
        .where(eq(organizationMfaPolicies.organizationId, actor.organizationId))
        .limit(1)
        .for("share");
      if (policy?.required) {
        throw new MfaManagementError("Die Owner-Policy erzwingt MFA. Deaktiviere zuerst die Policy.");
      }
      const secondFactorProof = verifyMfaSecondFactor(
        configuration,
        parsed.data.code,
      );
      if (!secondFactorProof) {
        throw new MfaManagementError("Der MFA- oder Recovery-Code ist nicht korrekt.");
      }
      await tx
        .delete(userMfaConfigurations)
        .where(
          and(
            eq(userMfaConfigurations.userId, lockedActor.id),
            eq(
              userMfaConfigurations.organizationId,
              lockedActor.organizationId,
            ),
          ),
        );
      await tx
        .update(userSessions)
        .set({ revokedAt: now })
        .where(and(eq(userSessions.userId, lockedActor.id), eq(userSessions.organizationId, lockedActor.organizationId), ne(userSessions.id, session.sessionId), isNull(userSessions.revokedAt)));
      await tx
        .update(userSessions)
        .set({ mfaVerifiedAt: null, mfaMethod: null })
        .where(and(eq(userSessions.id, session.sessionId), eq(userSessions.userId, lockedActor.id), eq(userSessions.organizationId, lockedActor.organizationId)));
      await tx.insert(activityEvents).values({
        organizationId: lockedActor.organizationId,
        userId: lockedActor.id,
        type: "security.mfa.disabled",
        entityType: "user",
        entityId: lockedActor.id,
        metadata: {
          verificationMethod: secondFactorProof.method,
          otherSessionsRevoked: true,
        },
      });
    });
    await clearPersistentRateLimit({ action: "mfa_management", identifier: managementIdentifier(actor) });
    refreshSecurity();
    return { ok: true, message: "MFA wurde deaktiviert. Andere Sitzungen wurden beendet." };
  } catch (error) {
    if (isManagementError(error)) return { ok: false, message: error.message };
    throw error;
  }
}

export async function updateOrganizationMfaPolicyAction(
  _state: MfaPolicyActionState,
  formData: FormData,
): Promise<MfaPolicyActionState> {
  const owner = await requireOwner();
  const parsed = policySchema.safeParse({
    required: checkboxValue(formData, "required"),
    expectedRevision: text(formData, "expectedRevision"),
    password: text(formData, "password"),
    code: text(formData, "code"),
  });
  if (!parsed.success) return { ok: false, message: "Bitte pruefe Policy, Passwort und MFA-Code." };
  try {
    await consumeManagementLimit(owner);
    const primaryProof = await verifyPrimaryFactor(owner, parsed.data.password);
    const now = new Date();
    const revision = await db.transaction(async (tx) => {
      const lockedOwner = await lockAndRevalidateMfaActor(tx, {
        actor: owner,
        proof: primaryProof,
        requiredRole: "owner",
        now,
      });
      const [configuration] = await tx
        .select()
        .from(userMfaConfigurations)
        .where(and(eq(userMfaConfigurations.userId, owner.id), eq(userMfaConfigurations.organizationId, owner.organizationId)))
        .limit(1)
        .for("update");
      if (!configuration) throw new MfaManagementError("Richte zuerst MFA fuer dein Owner-Konto ein.");
      const secondFactorProof = verifyMfaSecondFactor(
        configuration,
        parsed.data.code,
      );
      if (!secondFactorProof) {
        throw new MfaManagementError("Der MFA- oder Recovery-Code ist nicht korrekt.");
      }
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`mfa-policy:${lockedOwner.organizationId}`}, 0))`,
      );
      const [current] = await tx
        .select({ revision: organizationMfaPolicies.revision, required: organizationMfaPolicies.requireForPrivileged })
        .from(organizationMfaPolicies)
        .where(eq(organizationMfaPolicies.organizationId, owner.organizationId))
        .limit(1)
        .for("update");
      const currentRevision = current?.revision ?? 0;
      if (currentRevision !== parsed.data.expectedRevision) {
        throw new MfaManagementError("Die MFA-Policy wurde zwischenzeitlich geaendert. Lade die Seite neu.");
      }
      const nextRevision = currentRevision + 1;
      await tx
        .insert(organizationMfaPolicies)
        .values({
          organizationId: owner.organizationId,
          requireForPrivileged: parsed.data.required,
          revision: nextRevision,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: organizationMfaPolicies.organizationId,
          set: { requireForPrivileged: parsed.data.required, revision: nextRevision, updatedAt: now },
        });
      await tx
        .update(userMfaConfigurations)
        .set({
          recoveryCodeHashes: secondFactorProof.recoveryCodeHashes,
          lastTotpCounter: secondFactorProof.counter,
          updatedAt: now,
        })
        .where(eq(userMfaConfigurations.userId, owner.id));
      if (parsed.data.required) {
        await tx.execute(sql`
          update ${userSessions} session
          set revoked_at = ${now.toISOString()}
          from ${users} account
          where account.id = session.user_id
            and account.organization_id = session.organization_id
            and account.organization_id = ${owner.organizationId}
            and account.role in ('owner', 'admin', 'trainer')
            and session.mfa_verified_at is null
            and session.revoked_at is null
        `);
      }
      await tx.insert(activityEvents).values({
        organizationId: owner.organizationId,
        userId: owner.id,
        type: "security.mfa.policy_updated",
        entityType: "organization",
        entityId: owner.organizationId,
        metadata: {
          requiredForPrivileged: parsed.data.required,
          revision: nextRevision,
          verificationMethod: secondFactorProof.method,
        },
      });
      return nextRevision;
    });
    await clearPersistentRateLimit({ action: "mfa_management", identifier: managementIdentifier(owner) });
    refreshSecurity();
    return { ok: true, message: parsed.data.required ? "MFA ist jetzt fuer Owner und Administratoren verpflichtend." : "Die verpflichtende MFA-Policy wurde deaktiviert.", revision };
  } catch (error) {
    if (isManagementError(error)) return { ok: false, message: error.message };
    throw error;
  }
}
