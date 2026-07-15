import "server-only";

import { randomUUID } from "node:crypto";
import {
  and,
  asc,
  count,
  eq,
  isNotNull,
  isNull,
  lte,
  or,
  sql,
} from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { db } from "@/db";
import * as databaseSchema from "@/db/schema";
import {
  activityEvents,
  privacyExportArtifacts,
  privacyRequestEvents,
  privacyRequests,
} from "@/db/schema";
import { deletePrivacyExport } from "@/lib/privacy/export-storage";
import { privacyActorReference } from "@/lib/privacy/subject-reference";
import { boundedPrivacyRetentionBatchSize } from "@/lib/privacy/retention-policy";
import { logServerError } from "@/lib/server-error-logging";
import {
  getDatabaseUrl,
  getMediaStorageConfiguration,
} from "@/lib/server-environment";

export const PRIVACY_FAILED_EXPORT_CLEANUP_GRACE_MS = 5 * 60_000;
export const PRIVACY_RETENTION_ADVISORY_LOCK_KEY =
  "q-academy:privacy-export-retention:v1";
export const PRIVACY_RETENTION_WORK_BUDGET_MS = 32_000;
export const PRIVACY_RETENTION_DELETE_TIMEOUT_MS = 5_000;
export const PRIVACY_RETENTION_DELETE_BATCH_SIZE = 10;
const PRIVACY_RETENTION_DB_STATEMENT_TIMEOUT_MS = 1_000;
const PRIVACY_RETENTION_DB_LOCK_TIMEOUT_MS = 500;
const PRIVACY_RETENTION_RECOVERY_MIN_START_MS = 6_000;
const PRIVACY_RETENTION_DELETE_MIN_START_MS = 12_000;
const PRIVACY_RETENTION_POST_DELETE_RESERVE_MS = 4_000;
const PRIVACY_RETENTION_FAILURE_AUDIT_MIN_MS = 3_000;
const PRIVACY_RETENTION_CONNECTION_WAIT_MS = 3_000;
const PRIVACY_RETENTION_WAIT_TIMEOUT = Symbol("privacy-retention-timeout");

const privacyRetentionStateKey = Symbol.for(
  "q-academy.privacy-retention.local-state",
);
const privacyRetentionGlobal = globalThis as unknown as {
  [key: symbol]: { active: boolean } | undefined;
};
const privacyRetentionLocalState =
  privacyRetentionGlobal[privacyRetentionStateKey] ?? { active: false };
privacyRetentionGlobal[privacyRetentionStateKey] = privacyRetentionLocalState;

class PrivacyRetentionDeadlineError extends Error {
  constructor() {
    super("The privacy retention work budget was exhausted.");
    this.name = "PrivacyRetentionDeadlineError";
  }
}

class PrivacyRetentionLockLostError extends Error {
  constructor() {
    super("The privacy retention database session lost its advisory lock.");
    this.name = "PrivacyRetentionLockLostError";
  }
}

type PrivacyRetentionSession = {
  token: string;
  backendPid: number;
};

async function assertPrivacyRetentionSession(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  session: PrivacyRetentionSession | undefined,
) {
  if (!session) return;
  const [current] = await tx.execute(sql<{
    active: boolean;
    backendPid: number;
  }>`
    select
      current_setting('q_academy.privacy_retention_session', true) = ${session.token}
        as active,
      pg_backend_pid()::integer as "backendPid"
  `);
  if (
    current?.active !== true ||
    Number(current.backendPid) !== session.backendPid
  ) {
    throw new PrivacyRetentionLockLostError();
  }
}

function busyPrivacyRetentionResult(limit: number) {
  return {
    mode: "busy" as const,
    batchSize: limit,
    candidates: 0,
    deleted: 0,
    cleanupFailures: 0,
    budgetExhausted: false,
    mayHaveMore: true,
    staleProcessing: null,
  };
}

async function settleBeforeDeadline<T>(
  operation: PromiseLike<T>,
  deadlineAt: number,
  maximumWaitMs: number,
) {
  const waitMs = Math.min(maximumWaitMs, deadlineAt - performance.now());
  if (waitMs <= 0) return PRIVACY_RETENTION_WAIT_TIMEOUT;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve(operation),
      new Promise<typeof PRIVACY_RETENTION_WAIT_TIMEOUT>((resolve) => {
        timeout = setTimeout(
          () => resolve(PRIVACY_RETENTION_WAIT_TIMEOUT),
          waitMs,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

type PrivacyRecoveryOptions = {
  now?: Date;
  batchSize?: number;
  dryRun?: boolean;
  deadlineAt?: number;
  statementTimeoutMs?: number;
  session?: PrivacyRetentionSession;
};

async function recoverExpiredPrivacyProcessingWithDatabase(
  database: Pick<typeof db, "transaction">,
  options: PrivacyRecoveryOptions = {},
) {
  const limit = boundedPrivacyRetentionBatchSize(options.batchSize);
  const statementTimeoutMs = options.statementTimeoutMs;
  if (
    statementTimeoutMs !== undefined &&
    (!Number.isSafeInteger(statementTimeoutMs) || statementTimeoutMs < 1)
  ) {
    throw new TypeError("Privacy recovery statement timeout must be positive.");
  }
  return database.transaction(async (tx) => {
    await assertPrivacyRetentionSession(tx, options.session);
    if (statementTimeoutMs !== undefined) {
      await tx.execute(
        sql`select set_config('statement_timeout', ${String(statementTimeoutMs)}, true)`,
      );
      await tx.execute(
        sql`select set_config('lock_timeout', ${String(Math.min(statementTimeoutMs, PRIVACY_RETENTION_DB_LOCK_TIMEOUT_MS))}, true)`,
      );
    }
    const candidates = await tx
      .select({
        id: privacyRequests.id,
        organizationId: privacyRequests.organizationId,
        processingAttempt: privacyRequests.processingAttempt,
        processingClaimToken: privacyRequests.processingClaimToken,
        processingLeaseExpiresAt: privacyRequests.processingLeaseExpiresAt,
      })
      .from(privacyRequests)
      .where(
        and(
          eq(privacyRequests.status, "processing"),
          options.now
            ? lte(privacyRequests.processingLeaseExpiresAt, options.now)
            : sql`${privacyRequests.processingLeaseExpiresAt} <= clock_timestamp()`,
        ),
      )
      .orderBy(
        asc(privacyRequests.processingLeaseExpiresAt),
        asc(privacyRequests.id),
      )
      .limit(limit)
      .for("update", { skipLocked: true });
    if (options.dryRun) {
      return {
        mode: "dry-run" as const,
        batchSize: limit,
        candidates: candidates.length,
        recovered: 0,
        artifactsFailed: 0,
        budgetExhausted: false,
        mayHaveMore: candidates.length === limit,
      };
    }

    let recovered = 0;
    let artifactsFailed = 0;
    let budgetExhausted = false;
    for (const candidate of candidates) {
      if (
        options.deadlineAt !== undefined &&
        performance.now() + PRIVACY_RETENTION_RECOVERY_MIN_START_MS >
          options.deadlineAt
      ) {
        budgetExhausted = true;
        break;
      }
      if (
        !candidate.processingClaimToken ||
        !candidate.processingLeaseExpiresAt
      ) {
        continue;
      }
      const [failed] = await tx
        .update(privacyRequests)
        .set({
          status: "failed",
          statusReason: "processing_lease_expired",
          processingClaimToken: null,
          processingClaimedAt: null,
          processingLeaseExpiresAt: null,
          updatedAt: sql`clock_timestamp()`,
        })
        .where(
          and(
            eq(privacyRequests.id, candidate.id),
            eq(privacyRequests.organizationId, candidate.organizationId),
            eq(privacyRequests.status, "processing"),
            eq(
              privacyRequests.processingClaimToken,
              candidate.processingClaimToken,
            ),
            options.now
              ? lte(privacyRequests.processingLeaseExpiresAt, options.now)
              : sql`${privacyRequests.processingLeaseExpiresAt} <= clock_timestamp()`,
          ),
        )
        .returning({ id: privacyRequests.id });
      if (!failed) continue;
      const failedArtifacts = await tx
        .update(privacyExportArtifacts)
        .set({
          status: "failed",
          failureCode: "processing_lease_expired",
          failureDetail: null,
          updatedAt: sql`clock_timestamp()`,
        })
        .where(
          and(
            eq(privacyExportArtifacts.organizationId, candidate.organizationId),
            eq(privacyExportArtifacts.requestId, candidate.id),
            eq(privacyExportArtifacts.status, "building"),
          ),
        )
        .returning({ id: privacyExportArtifacts.id });
      const actorReference = privacyActorReference(
        candidate.organizationId,
        "system",
        "privacy-retention",
      );
      await tx.insert(privacyRequestEvents).values({
        organizationId: candidate.organizationId,
        requestId: candidate.id,
        actorReference,
        event: "request.processing_lease_expired",
        fromStatus: "processing",
        toStatus: "failed",
        metadata: {
          reasonCode: "processing_lease_expired",
          processingAttempt: candidate.processingAttempt,
          artifactCount: failedArtifacts.length,
        },
      });
      await tx.insert(activityEvents).values({
        organizationId: candidate.organizationId,
        userId: null,
        type: "privacy_request.processing_lease_expired",
        entityType: "privacy_request",
        entityId: candidate.id,
        metadata: {
          reasonCode: "processing_lease_expired",
          artifactCount: failedArtifacts.length,
        },
      });
      recovered += 1;
      artifactsFailed += failedArtifacts.length;
    }
    return {
      mode: "recover" as const,
      batchSize: limit,
      candidates: candidates.length,
      recovered,
      artifactsFailed,
      budgetExhausted,
      mayHaveMore: budgetExhausted || candidates.length === limit,
    };
  });
}

export async function recoverExpiredPrivacyProcessing(
  options: PrivacyRecoveryOptions = {},
) {
  return recoverExpiredPrivacyProcessingWithDatabase(db, options);
}

function deletableArtifactCondition(
  now: Date,
  allowIncompleteStratoIdentity: boolean,
) {
  const failedBefore = new Date(
    now.getTime() - PRIVACY_FAILED_EXPORT_CLEANUP_GRACE_MS,
  );
  const completeS3Identity = and(
    isNotNull(privacyExportArtifacts.storageVersionId),
    isNotNull(privacyExportArtifacts.storageEtag),
  );
  const deletableS3Identity = allowIncompleteStratoIdentity
    ? or(
        completeS3Identity,
        and(
          isNull(privacyExportArtifacts.storageVersionId),
          isNull(privacyExportArtifacts.storageEtag),
        ),
      )
    : completeS3Identity;
  return and(
    isNull(privacyExportArtifacts.deletedAt),
    or(
      and(
        eq(privacyExportArtifacts.status, "ready"),
        lte(privacyExportArtifacts.expiresAt, now),
        lte(privacyExportArtifacts.updatedAt, failedBefore),
      ),
      and(
        eq(privacyExportArtifacts.status, "failed"),
        lte(privacyExportArtifacts.updatedAt, failedBefore),
        or(
          and(
            eq(privacyExportArtifacts.storageDriver, "filesystem"),
            isNull(privacyExportArtifacts.storageVersionId),
            isNull(privacyExportArtifacts.storageEtag),
          ),
          and(
            eq(privacyExportArtifacts.storageDriver, "s3"),
            deletableS3Identity,
          ),
        ),
      ),
    ),
  );
}

function isDeletableArtifact(
  artifact: typeof privacyExportArtifacts.$inferSelect,
  now: Date,
  allowIncompleteStratoIdentity: boolean,
) {
  if (artifact.deletedAt) return false;
  if (artifact.status === "ready") {
    return (
      artifact.expiresAt.getTime() <= now.getTime() &&
      artifact.updatedAt.getTime() <=
        now.getTime() - PRIVACY_FAILED_EXPORT_CLEANUP_GRACE_MS
    );
  }
  if (artifact.status !== "failed") return false;
  if (
    artifact.updatedAt.getTime() >
    now.getTime() - PRIVACY_FAILED_EXPORT_CLEANUP_GRACE_MS
  ) {
    return false;
  }
  const identityIsEmpty =
    artifact.storageVersionId === null && artifact.storageEtag === null;
  if (artifact.storageDriver === "filesystem") return identityIsEmpty;
  const identityIsComplete = Boolean(
    artifact.storageVersionId && artifact.storageEtag,
  );
  return identityIsComplete ||
    (allowIncompleteStratoIdentity && identityIsEmpty);
}

export async function cleanupExpiredPrivacyExports(options: {
  now?: Date;
  batchSize?: number;
  dryRun?: boolean;
  timeBudgetMs?: number;
  deleteTimeoutMs?: number;
} = {}) {
  const limit = boundedPrivacyRetentionBatchSize(options.batchSize);
  const deleteLimit = Math.min(limit, PRIVACY_RETENTION_DELETE_BATCH_SIZE);
  const timeBudgetMs =
    options.timeBudgetMs ?? PRIVACY_RETENTION_WORK_BUDGET_MS;
  const deleteTimeoutMs =
    options.deleteTimeoutMs ?? PRIVACY_RETENTION_DELETE_TIMEOUT_MS;
  if (
    !Number.isSafeInteger(timeBudgetMs) ||
    timeBudgetMs < 1 ||
    timeBudgetMs > PRIVACY_RETENTION_WORK_BUDGET_MS
  ) {
    throw new TypeError(
      `Privacy retention work budget must be between 1 and ${PRIVACY_RETENTION_WORK_BUDGET_MS} milliseconds.`,
    );
  }
  if (
    !Number.isSafeInteger(deleteTimeoutMs) ||
    deleteTimeoutMs < 1 ||
    deleteTimeoutMs > timeBudgetMs
  ) {
    throw new TypeError(
      "Privacy retention delete timeout must fit inside the work budget.",
    );
  }
  const storageConfiguration = getMediaStorageConfiguration();
  const allowIncompleteStratoIdentity =
    storageConfiguration.driver === "s3" &&
    storageConfiguration.compatibilityMode === "strato-hidrive";

  const deadlineAt = performance.now() + timeBudgetMs;
  if (privacyRetentionLocalState.active) {
    return busyPrivacyRetentionResult(limit);
  }
  privacyRetentionLocalState.active = true;
  const cleanupClient = postgres(getDatabaseUrl(), {
    max: 1,
    prepare: false,
    connect_timeout: 2,
    connection: {
      application_name: "q-academy-privacy-retention",
      statement_timeout: PRIVACY_RETENTION_DB_STATEMENT_TIMEOUT_MS,
      lock_timeout: PRIVACY_RETENTION_DB_LOCK_TIMEOUT_MS,
    },
  });
  const cleanupDb = drizzle(cleanupClient, { schema: databaseSchema });
  const hardDeadline = setTimeout(() => {
    void cleanupClient.end({ timeout: 0 }).catch((error: unknown) => {
      logServerError(error, { action: "privacy.retention.deadline" });
    });
  }, Math.max(1, Math.ceil(deadlineAt - performance.now())));
  hardDeadline.unref();
  const sessionToken = randomUUID();
  let session: PrivacyRetentionSession | undefined;
  try {
    const lockQuery = cleanupClient<
      Array<{
        acquired: boolean;
        sessionToken: string | null;
        backendPid: number;
      }>
    >`
      with lock_attempt as (
        select pg_try_advisory_lock(
          hashtextextended(${PRIVACY_RETENTION_ADVISORY_LOCK_KEY}, 0)
        ) as acquired
      )
      select
        acquired,
        case when acquired then
          set_config('q_academy.privacy_retention_session', ${sessionToken}, false)
        end as "sessionToken",
        pg_backend_pid()::integer as "backendPid"
      from lock_attempt
    `;
    const lockResult = await settleBeforeDeadline(
      lockQuery,
      deadlineAt,
      PRIVACY_RETENTION_CONNECTION_WAIT_MS,
    );
    if (lockResult === PRIVACY_RETENTION_WAIT_TIMEOUT) {
      lockQuery.cancel();
      return busyPrivacyRetentionResult(limit);
    }
    const [lock] = lockResult;
    if (!lock?.acquired) {
      return busyPrivacyRetentionResult(limit);
    }
    session = {
      token: sessionToken,
      backendPid: Number(lock.backendPid),
    };
    if (
      lock.sessionToken !== sessionToken ||
      !Number.isSafeInteger(session.backendPid)
    ) {
      throw new PrivacyRetentionLockLostError();
    }
    const [databaseClock] = await cleanupClient<
      Array<{ now: string; active: boolean; backendPid: number }>
    >`
      select
        clock_timestamp()::text as now,
        current_setting('q_academy.privacy_retention_session', true) = ${sessionToken}
          as active,
        pg_backend_pid()::integer as "backendPid"
    `;
    if (
      databaseClock?.active !== true ||
      Number(databaseClock.backendPid) !== session.backendPid
    ) {
      throw new PrivacyRetentionLockLostError();
    }
    const now = options.now ?? new Date(databaseClock?.now ?? "");
    if (!Number.isFinite(now.getTime())) {
      throw new Error("The privacy retention database clock is unavailable.");
    }

    const recovery = await recoverExpiredPrivacyProcessingWithDatabase(
      cleanupDb,
      {
      now,
      batchSize: deleteLimit,
      dryRun: options.dryRun,
      deadlineAt,
      statementTimeoutMs: PRIVACY_RETENTION_DB_STATEMENT_TIMEOUT_MS,
      session,
      },
    );
    const deletable = deletableArtifactCondition(
      now,
      allowIncompleteStratoIdentity,
    );
    if (options.dryRun) {
      if (recovery.budgetExhausted || performance.now() >= deadlineAt) {
        return {
          mode: "dry-run" as const,
          batchSize: limit,
          candidates: 0,
          deleted: 0,
          cleanupFailures: 0,
          budgetExhausted: true,
          mayHaveMore: true,
          staleProcessing: recovery,
        };
      }
      const [result] = await cleanupDb.transaction(async (tx) => {
        await assertPrivacyRetentionSession(tx, session);
        await tx.execute(
          sql`select set_config('statement_timeout', ${String(PRIVACY_RETENTION_DB_STATEMENT_TIMEOUT_MS)}, true)`,
        );
        return tx
          .select({ value: count() })
          .from(privacyExportArtifacts)
          .where(deletable);
      });
      const candidates = Number(result?.value ?? 0);
      return {
        mode: "dry-run" as const,
        batchSize: limit,
        candidates,
        deleted: 0,
        cleanupFailures: 0,
        budgetExhausted: performance.now() >= deadlineAt,
        mayHaveMore: candidates > deleteLimit || recovery.mayHaveMore,
        staleProcessing: recovery,
      };
    }

    if (recovery.budgetExhausted || performance.now() >= deadlineAt) {
      return {
        mode: "delete" as const,
        batchSize: limit,
        candidates: 0,
        deleted: 0,
        cleanupFailures: 0,
        budgetExhausted: true,
        mayHaveMore: true,
        staleProcessing: recovery,
      };
    }
    const candidates = await cleanupDb.transaction(async (tx) => {
      await assertPrivacyRetentionSession(tx, session);
      await tx.execute(
        sql`select set_config('statement_timeout', ${String(PRIVACY_RETENTION_DB_STATEMENT_TIMEOUT_MS)}, true)`,
      );
      return tx
        .select()
        .from(privacyExportArtifacts)
        .where(deletable)
        .orderBy(
          asc(privacyExportArtifacts.expiresAt),
          asc(privacyExportArtifacts.id),
        )
        .limit(deleteLimit);
    });
    let deleted = 0;
    let cleanupFailures = 0;
    let budgetExhausted = false;
    for (const artifact of candidates) {
      const remainingMs = deadlineAt - performance.now();
      if (remainingMs < PRIVACY_RETENTION_DELETE_MIN_START_MS) {
        budgetExhausted = true;
        break;
      }
      try {
        const changed = await cleanupDb.transaction(async (tx) => {
          await assertPrivacyRetentionSession(tx, session);
          await tx.execute(
            sql`select set_config('statement_timeout', ${String(PRIVACY_RETENTION_DB_STATEMENT_TIMEOUT_MS)}, true)`,
          );
          await tx.execute(
            sql`select set_config('lock_timeout', ${String(PRIVACY_RETENTION_DB_LOCK_TIMEOUT_MS)}, true)`,
          );
          const [request] = await tx
            .select({ id: privacyRequests.id })
            .from(privacyRequests)
            .where(
              and(
                eq(privacyRequests.id, artifact.requestId),
                eq(privacyRequests.organizationId, artifact.organizationId),
              ),
            )
            .limit(1)
            .for("share");
          if (!request) return false;
          const [current] = await tx
            .select()
            .from(privacyExportArtifacts)
            .where(
              and(
                eq(privacyExportArtifacts.id, artifact.id),
                eq(
                  privacyExportArtifacts.organizationId,
                  artifact.organizationId,
                ),
                eq(privacyExportArtifacts.requestId, artifact.requestId),
              ),
            )
            .limit(1)
            .for("update");
          if (
            !current ||
            !isDeletableArtifact(
              current,
              now,
              allowIncompleteStratoIdentity,
            )
          ) {
            return false;
          }
          const deleteBudgetMs =
            deadlineAt -
            performance.now() -
            PRIVACY_RETENTION_POST_DELETE_RESERVE_MS;
          if (deleteBudgetMs < 1) {
            throw new PrivacyRetentionDeadlineError();
          }
          await deletePrivacyExport({
            organizationId: current.organizationId,
            requestId: current.requestId,
            artifactId: current.id,
            storageKey: current.storageKey,
            storageDriver: current.storageDriver,
            storageVersionId: current.storageVersionId,
            storageEtag: current.storageEtag,
            timeoutMs: Math.max(
              1,
              Math.floor(Math.min(deleteTimeoutMs, deleteBudgetMs)),
            ),
          });
          const [updated] = await tx
            .update(privacyExportArtifacts)
            .set({ status: "deleted", deletedAt: now, updatedAt: now })
            .where(
              and(
                eq(privacyExportArtifacts.id, current.id),
                eq(
                  privacyExportArtifacts.organizationId,
                  current.organizationId,
                ),
                eq(privacyExportArtifacts.requestId, current.requestId),
                eq(privacyExportArtifacts.status, current.status),
                isNull(privacyExportArtifacts.deletedAt),
              ),
            )
            .returning({ id: privacyExportArtifacts.id });
          if (!updated) return false;
          const reasonCode =
            current.status === "ready"
              ? "retention_expired"
              : "failed_artifact_cleanup";
          const actorReference = privacyActorReference(
            current.organizationId,
            "system",
            "privacy-retention",
          );
          await tx.insert(privacyRequestEvents).values({
            organizationId: current.organizationId,
            requestId: current.requestId,
            actorReference,
            event: "export.deleted",
            metadata: { artifactId: current.id, reasonCode },
          });
          await tx.insert(activityEvents).values({
            organizationId: current.organizationId,
            userId: null,
            type: "privacy_request.export_deleted",
            entityType: "privacy_request",
            entityId: current.requestId,
            metadata: { artifactId: current.id, reasonCode },
          });
          return true;
        });
        if (changed) deleted += 1;
      } catch (error) {
        if (error instanceof PrivacyRetentionLockLostError) throw error;
        if (error instanceof PrivacyRetentionDeadlineError) {
          budgetExhausted = true;
          break;
        }
        cleanupFailures += 1;
        if (
          deadlineAt - performance.now() <
          PRIVACY_RETENTION_FAILURE_AUDIT_MIN_MS
        ) {
          budgetExhausted = true;
          break;
        }
        try {
          await cleanupDb.transaction(async (tx) => {
            await assertPrivacyRetentionSession(tx, session);
            await tx.execute(
              sql`select set_config('statement_timeout', '500', true)`,
            );
            await tx.execute(
              sql`select set_config('lock_timeout', '250', true)`,
            );
            const [current] = await tx
              .select()
              .from(privacyExportArtifacts)
              .where(
                and(
                  eq(privacyExportArtifacts.id, artifact.id),
                  eq(
                    privacyExportArtifacts.organizationId,
                    artifact.organizationId,
                  ),
                  eq(privacyExportArtifacts.requestId, artifact.requestId),
                ),
              )
              .limit(1)
              .for("update");
            if (
              !current ||
              !isDeletableArtifact(
                current,
                now,
                allowIncompleteStratoIdentity,
              ) ||
              current.status !== artifact.status ||
              current.storageDriver !== artifact.storageDriver ||
              current.storageKey !== artifact.storageKey ||
              current.storageVersionId !== artifact.storageVersionId ||
              current.storageEtag !== artifact.storageEtag
            ) {
              return;
            }
            const [rotated] = await tx
              .update(privacyExportArtifacts)
              .set({ updatedAt: sql`clock_timestamp()` })
              .where(
                and(
                  eq(privacyExportArtifacts.id, artifact.id),
                  eq(
                    privacyExportArtifacts.organizationId,
                    artifact.organizationId,
                  ),
                  eq(privacyExportArtifacts.requestId, artifact.requestId),
                  eq(privacyExportArtifacts.status, current.status),
                  isNull(privacyExportArtifacts.deletedAt),
                ),
              )
              .returning({ id: privacyExportArtifacts.id });
            if (!rotated) return;
            const actorReference = privacyActorReference(
              artifact.organizationId,
              "system",
              "privacy-retention",
            );
            const metadata = {
              artifactId: artifact.id,
              reasonCode: "retention_delete_failed",
            };
            await tx.insert(privacyRequestEvents).values({
              organizationId: artifact.organizationId,
              requestId: artifact.requestId,
              actorReference,
              event: "export.cleanup_failed",
              metadata,
            });
            await tx.insert(activityEvents).values({
              organizationId: artifact.organizationId,
              userId: null,
              type: "privacy_request.export_cleanup_failed",
              entityType: "privacy_request",
              entityId: artifact.requestId,
              metadata,
            });
          });
        } catch (error) {
          if (error instanceof PrivacyRetentionLockLostError) throw error;
          logServerError(error, { action: "privacy.retention.failure_audit" });
          budgetExhausted = true;
          break;
        }
      }
    }
    const mayHaveMore =
      budgetExhausted ||
      candidates.length === deleteLimit ||
      recovery.mayHaveMore;
    return {
      mode: "delete" as const,
      batchSize: limit,
      candidates: candidates.length,
      deleted,
      cleanupFailures,
      budgetExhausted,
      mayHaveMore,
      staleProcessing: recovery,
    };
  } finally {
    try {
      await cleanupClient`select pg_advisory_unlock_all()`;
    } catch (error) {
      // Closing this dedicated session releases any remaining advisory lock.
      logServerError(error, { action: "privacy.retention.unlock" });
    } finally {
      try {
        await cleanupClient.end({ timeout: 1 });
      } catch (error) {
        logServerError(error, { action: "privacy.retention.disconnect" });
      }
      clearTimeout(hardDeadline);
      privacyRetentionLocalState.active = false;
    }
  }
}
