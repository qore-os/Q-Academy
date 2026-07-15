import { createHash } from "node:crypto";

import {
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  S3Client,
  type ListObjectsV2CommandOutput,
} from "@aws-sdk/client-s3";

import { S3_PRIVACY_EXPORT_LIFECYCLE_DAYS } from "../media/s3-privacy-export-lifecycle";
import { createS3NodeHttpHandler } from "../media/s3-operation-timeout";
import type { S3MediaStorageConfiguration } from "../media/storage-configuration";

const TENANTS_ROOT = "tenants/";
const TENANT_PREFIX_PATTERN =
  /^tenants\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/$/i;
const PRIVACY_EXPORT_KEY_PATTERN =
  /^tenants\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/privacy-exports\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.]enc$/i;
const COMMAND_TIMEOUT_MS = 30_000;
const MAX_TENANT_PAGES = 128;
const MAX_EXPORT_PAGES_PER_TENANT = 128;
const MAX_S3_KEY_BYTES = 1_024;
export const STRATO_RETENTION_SAFETY_MARGIN_MS = 60 * 60_000;
export const STRATO_RETENTION_SLA_RESERVE_MS = 5 * 60_000;

export function stratoRetentionMaxTraversalAge(intervalMs: number) {
  if (
    !Number.isSafeInteger(intervalMs) ||
    intervalMs < 0 ||
    intervalMs >=
      STRATO_RETENTION_SAFETY_MARGIN_MS - STRATO_RETENTION_SLA_RESERVE_MS
  ) {
    throw new TypeError("The STRATO retention interval is outside its SLA.");
  }
  // A key may be visited at the start of one traversal and at the end of the
  // next. Bound both traversals plus the sleep interval inside the one-hour
  // safety margin, retaining an independent reserve for scheduling jitter.
  return Math.floor(
    (STRATO_RETENTION_SAFETY_MARGIN_MS -
      STRATO_RETENTION_SLA_RESERVE_MS -
      intervalMs) /
      2,
  );
}

export type StratoPrivacySweepScope = {
  endpoint: string;
  region: string;
  bucket: string;
  compatibilityMode: string;
};

export type StratoPrivacySweepCursor = {
  version: 2;
  scopeFingerprint: string;
  cycleStartedAt: string;
  tenantStartAfter?: string;
  activeTenantPrefix?: string;
  exportStartAfter?: string;
};

export function stratoPrivacySweepScopeFingerprint(
  scope: StratoPrivacySweepScope,
) {
  for (const [name, value] of Object.entries(scope)) {
    if (
      typeof value !== "string" ||
      value.length === 0 ||
      value.length > 1_024 ||
      /[\u0000-\u001f\u007f]/.test(value)
    ) {
      throw new Error(`The STRATO retention ${name} scope is invalid.`);
    }
  }
  if (scope.compatibilityMode !== "strato-hidrive") {
    throw new Error("The STRATO retention compatibility scope is invalid.");
  }
  return createHash("sha256")
    .update(
      JSON.stringify([
        "q-academy-strato-retention-scope-v1",
        scope.endpoint,
        scope.region,
        scope.bucket,
        scope.compatibilityMode,
      ]),
      "utf8",
    )
    .digest("hex");
}

type RetentionCommand =
  | DeleteObjectCommand
  | HeadObjectCommand
  | ListObjectsV2Command;

export type StratoPrivacySweepAdapter = {
  send: (
    command: RetentionCommand,
    options: { abortSignal: AbortSignal },
  ) => Promise<unknown>;
};

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
) {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function isSafeS3Key(value: string) {
  return (
    Buffer.byteLength(value, "utf8") <= MAX_S3_KEY_BYTES &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

export function parseStratoPrivacySweepCursor(
  value: unknown,
  expectedScope: StratoPrivacySweepScope,
): StratoPrivacySweepCursor | undefined {
  if (value === undefined || value === null) return undefined;
  if (
    typeof value !== "object" ||
    Array.isArray(value) ||
    !hasOnlyKeys(value as Record<string, unknown>, [
      "version",
      "scopeFingerprint",
      "cycleStartedAt",
      "tenantStartAfter",
      "activeTenantPrefix",
      "exportStartAfter",
    ])
  ) {
    throw new Error("The STRATO retention cursor has an invalid shape.");
  }
  const cursor = value as Record<string, unknown>;
  const expectedScopeFingerprint =
    stratoPrivacySweepScopeFingerprint(expectedScope);
  if (
    cursor.version !== 2 ||
    typeof cursor.scopeFingerprint !== "string" ||
    !/^[a-f0-9]{64}$/.test(cursor.scopeFingerprint)
  ) {
    throw new Error("The STRATO retention cursor version or scope is invalid.");
  }
  if (cursor.scopeFingerprint !== expectedScopeFingerprint) {
    throw new Error(
      "The STRATO retention cursor does not match the configured storage scope.",
    );
  }
  const startedAt = new Date(
    typeof cursor.cycleStartedAt === "string" ? cursor.cycleStartedAt : "",
  );
  if (!Number.isFinite(startedAt.getTime())) {
    throw new Error("The STRATO retention cursor clock is invalid.");
  }
  const tenantStartAfter = cursor.tenantStartAfter;
  const activeTenantPrefix = cursor.activeTenantPrefix;
  const exportStartAfter = cursor.exportStartAfter;
  if (
    tenantStartAfter !== undefined &&
    (typeof tenantStartAfter !== "string" ||
      !TENANT_PREFIX_PATTERN.test(tenantStartAfter))
  ) {
    throw new Error("The STRATO retention tenant cursor is invalid.");
  }
  if (
    activeTenantPrefix !== undefined &&
    (typeof activeTenantPrefix !== "string" ||
      !TENANT_PREFIX_PATTERN.test(activeTenantPrefix))
  ) {
    throw new Error("The STRATO retention active-tenant cursor is invalid.");
  }
  if (
    tenantStartAfter !== undefined &&
    activeTenantPrefix !== undefined &&
    activeTenantPrefix <= tenantStartAfter
  ) {
    throw new Error("The STRATO retention cursor does not move forward.");
  }
  if (
    exportStartAfter !== undefined &&
    (typeof exportStartAfter !== "string" ||
      activeTenantPrefix === undefined ||
      !exportStartAfter.startsWith(`${activeTenantPrefix}privacy-exports/`) ||
      !isSafeS3Key(exportStartAfter))
  ) {
    throw new Error("The STRATO retention export cursor is invalid.");
  }
  return {
    version: 2,
    scopeFingerprint: expectedScopeFingerprint,
    cycleStartedAt: startedAt.toISOString(),
    ...(tenantStartAfter === undefined ? {} : { tenantStartAfter }),
    ...(activeTenantPrefix === undefined ? {} : { activeTenantPrefix }),
    ...(exportStartAfter === undefined ? {} : { exportStartAfter }),
  };
}

export function isStratoPrivacyExportKey(key: string) {
  return PRIVACY_EXPORT_KEY_PATTERN.test(key);
}

export function stratoPrivacyRetentionCutoff(now: Date) {
  if (!Number.isFinite(now.getTime())) {
    throw new TypeError("The STRATO retention clock is invalid.");
  }
  return new Date(
    now.getTime() -
      (S3_PRIVACY_EXPORT_LIFECYCLE_DAYS * 24 * 60 * 60_000 -
        STRATO_RETENTION_SAFETY_MARGIN_MS),
  );
}

function statusOf(error: unknown) {
  return error && typeof error === "object" && "$metadata" in error
    ? (error.$metadata as { httpStatusCode?: number }).httpStatusCode
    : undefined;
}

function validateOptions(input: {
  maxDeletes: number;
  timeBudgetMs: number;
  maxCycleAgeMs: number;
}) {
  if (
    !Number.isSafeInteger(input.maxDeletes) ||
    input.maxDeletes < 1 ||
    input.maxDeletes > 10_000
  ) {
    throw new TypeError("STRATO retention maxDeletes must be between 1 and 10000.");
  }
  if (
    !Number.isSafeInteger(input.timeBudgetMs) ||
    input.timeBudgetMs < 1_000 ||
    input.timeBudgetMs > 10 * 60_000
  ) {
    throw new TypeError(
      "STRATO retention timeBudgetMs must be between 1000 and 600000.",
    );
  }
  if (
    !Number.isSafeInteger(input.maxCycleAgeMs) ||
    input.maxCycleAgeMs < 1_000 ||
    input.maxCycleAgeMs >
      STRATO_RETENTION_SAFETY_MARGIN_MS - STRATO_RETENTION_SLA_RESERVE_MS
  ) {
    throw new TypeError(
      "STRATO retention maxCycleAgeMs exceeds the retention SLA envelope.",
    );
  }
}

function assertOrderedAfter(
  value: string,
  previous: string | undefined,
  description: string,
) {
  if (previous !== undefined && value <= previous) {
    throw new Error(`STRATO returned a non-advancing ${description} listing.`);
  }
}

export async function runStratoPrivacyExportSweep(input: {
  adapter: StratoPrivacySweepAdapter;
  bucket: string;
  scope: StratoPrivacySweepScope;
  now: Date;
  cursor?: unknown;
  maxDeletes: number;
  timeBudgetMs: number;
  maxCycleAgeMs: number;
  dryRun: boolean;
  monotonicNow?: () => number;
}) {
  validateOptions(input);
  if (input.scope.bucket !== input.bucket) {
    throw new Error("The STRATO retention run scope does not match its bucket.");
  }
  const cutoff = stratoPrivacyRetentionCutoff(input.now);
  const scopeFingerprint = stratoPrivacySweepScopeFingerprint(input.scope);
  const persistedCursor = parseStratoPrivacySweepCursor(
    input.cursor,
    input.scope,
  );
  const cycleStartedAt = persistedCursor
    ? new Date(persistedCursor.cycleStartedAt)
    : input.now;
  const cycleAgeMs = input.now.getTime() - cycleStartedAt.getTime();
  if (cycleAgeMs < 0) {
    throw new Error("The STRATO retention cycle clock moved backwards.");
  }
  const cycleRemainingMs = input.maxCycleAgeMs - cycleAgeMs;
  if (cycleRemainingMs <= 0) {
    throw new Error(
      "The STRATO retention traversal exceeded its fail-closed SLA deadline.",
    );
  }
  const monotonicNow = input.monotonicNow ?? (() => performance.now());
  const startedAt = monotonicNow();
  if (!Number.isFinite(startedAt)) {
    throw new Error("The STRATO retention monotonic clock is invalid.");
  }
  const deadline = startedAt + Math.min(input.timeBudgetMs, cycleRemainingMs);
  const budgetRemaining = () => {
    const current = monotonicNow();
    if (!Number.isFinite(current) || current < startedAt) {
      throw new Error("The STRATO retention monotonic clock is invalid.");
    }
    return deadline - current;
  };
  const hasBudget = () => budgetRemaining() > 0;
  const commandSignal = () => {
    const remaining = Math.floor(budgetRemaining());
    if (remaining <= 0) {
      throw new Error("The STRATO retention command exceeded its time budget.");
    }
    return AbortSignal.timeout(Math.max(1, Math.min(COMMAND_TIMEOUT_MS, remaining)));
  };
  let scannedTenants = 0;
  let scannedObjects = 0;
  let eligible = 0;
  let deleted = 0;
  let tenantStartAfter = persistedCursor?.tenantStartAfter;
  let activeTenantPrefix = persistedCursor?.activeTenantPrefix;
  let exportStartAfter = persistedCursor?.exportStartAfter;

  const currentCursor = (): StratoPrivacySweepCursor => ({
    version: 2,
    scopeFingerprint,
    cycleStartedAt: cycleStartedAt.toISOString(),
    ...(tenantStartAfter === undefined ? {} : { tenantStartAfter }),
    ...(activeTenantPrefix === undefined ? {} : { activeTenantPrefix }),
    ...(exportStartAfter === undefined ? {} : { exportStartAfter }),
  });
  const partialResult = (
    reason: "budget" | "delete-limit" | "page-limit",
  ) => ({
    mode: input.dryRun ? ("dry-run" as const) : ("delete" as const),
    bucket: input.bucket,
    retentionDays: S3_PRIVACY_EXPORT_LIFECYCLE_DAYS,
    safetyMarginMinutes: STRATO_RETENTION_SAFETY_MARGIN_MS / 60_000,
    cutoff: cutoff.toISOString(),
    scannedTenants,
    scannedObjects,
    eligible,
    deleted,
    budgetExhausted: reason === "budget",
    deleteLimitReached: reason === "delete-limit",
    pageLimitReached: reason === "page-limit",
    cycleCompleted: false,
    mayHaveMore: true,
    cursor: currentCursor(),
  });

  const processTenant = async (
    tenantPrefix: string,
  ): Promise<ReturnType<typeof partialResult> | undefined> => {
    scannedTenants += 1;
    activeTenantPrefix = tenantPrefix;
    const initialExportStartAfter = exportStartAfter;
    let exportContinuationToken: string | undefined;
    let previousKey = exportStartAfter;
    for (
      let exportPage = 0;
      exportPage < MAX_EXPORT_PAGES_PER_TENANT;
      exportPage += 1
    ) {
      if (!hasBudget()) return partialResult("budget");
      const objects = (await input.adapter.send(
        new ListObjectsV2Command({
          Bucket: input.bucket,
          Prefix: `${tenantPrefix}privacy-exports/`,
          ...(exportContinuationToken
            ? { ContinuationToken: exportContinuationToken }
            : exportStartAfter
              ? { StartAfter: exportStartAfter }
              : {}),
          MaxKeys: 1_000,
        }),
        { abortSignal: commandSignal() },
      )) as ListObjectsV2CommandOutput;
      for (const object of objects.Contents ?? []) {
        if (!hasBudget()) return partialResult("budget");
        const key = object.Key;
        if (!key || !isSafeS3Key(key)) {
          throw new Error("STRATO returned an invalid privacy-export object key.");
        }
        assertOrderedAfter(key, previousKey, "privacy-export");
        previousKey = key;
        scannedObjects += 1;
        if (!isStratoPrivacyExportKey(key)) {
          exportStartAfter = key;
          continue;
        }
        if (
          !(object.LastModified instanceof Date) ||
          !Number.isFinite(object.LastModified.getTime())
        ) {
          throw new Error(
            "STRATO omitted a valid LastModified value for a privacy export.",
          );
        }
        if (object.LastModified.getTime() > cutoff.getTime()) {
          exportStartAfter = key;
          continue;
        }
        eligible += 1;
        if (input.dryRun) {
          exportStartAfter = key;
          continue;
        }
        if (deleted >= input.maxDeletes) {
          return partialResult("delete-limit");
        }
        if (!hasBudget()) return partialResult("budget");
        await input.adapter.send(
          new DeleteObjectCommand({
            Bucket: input.bucket,
            Key: key,
          }),
          { abortSignal: commandSignal() },
        );
        if (!hasBudget()) {
          throw new Error(
            "The STRATO retention deadline expired before deletion verification.",
          );
        }
        try {
          await input.adapter.send(
            new HeadObjectCommand({
              Bucket: input.bucket,
              Key: key,
            }),
            { abortSignal: commandSignal() },
          );
          throw new Error("The expired STRATO privacy export remained.");
        } catch (error) {
          if (statusOf(error) !== 404) throw error;
        }
        deleted += 1;
        exportStartAfter = key;
      }
      if (!objects.IsTruncated) {
        exportStartAfter = undefined;
        activeTenantPrefix = undefined;
        tenantStartAfter = tenantPrefix;
        return undefined;
      }
      if (!objects.NextContinuationToken) {
        throw new Error("STRATO omitted an export listing cursor.");
      }
      exportContinuationToken = objects.NextContinuationToken;
      if (exportPage === MAX_EXPORT_PAGES_PER_TENANT - 1) {
        if (exportStartAfter === initialExportStartAfter) {
          throw new Error(
            "A tenant privacy-export listing reached its page limit without persistable progress.",
          );
        }
        return partialResult("page-limit");
      }
    }
    throw new Error("A tenant privacy-export listing ended unexpectedly.");
  };

  if (activeTenantPrefix) {
    const partial = await processTenant(activeTenantPrefix);
    if (partial) return partial;
  }

  let tenantContinuationToken: string | undefined;
  let previousTenant = tenantStartAfter;
  const initialTenantStartAfter = tenantStartAfter;
  for (
    let tenantPage = 0;
    tenantPage < MAX_TENANT_PAGES;
    tenantPage += 1
  ) {
    if (!hasBudget()) return partialResult("budget");
    const tenants = (await input.adapter.send(
      new ListObjectsV2Command({
        Bucket: input.bucket,
        Prefix: TENANTS_ROOT,
        Delimiter: "/",
        ...(tenantContinuationToken
          ? { ContinuationToken: tenantContinuationToken }
          : tenantStartAfter
            ? { StartAfter: tenantStartAfter }
            : {}),
        MaxKeys: 1_000,
      }),
      { abortSignal: commandSignal() },
    )) as ListObjectsV2CommandOutput;
    for (const commonPrefix of tenants.CommonPrefixes ?? []) {
      if (!hasBudget()) return partialResult("budget");
      const tenantPrefix = commonPrefix.Prefix ?? "";
      if (!TENANT_PREFIX_PATTERN.test(tenantPrefix)) continue;
      assertOrderedAfter(tenantPrefix, previousTenant, "tenant");
      previousTenant = tenantPrefix;
      exportStartAfter = undefined;
      const partial = await processTenant(tenantPrefix);
      if (partial) return partial;
    }
    if (!tenants.IsTruncated) {
      return {
        mode: input.dryRun ? ("dry-run" as const) : ("delete" as const),
        bucket: input.bucket,
        retentionDays: S3_PRIVACY_EXPORT_LIFECYCLE_DAYS,
        safetyMarginMinutes: STRATO_RETENTION_SAFETY_MARGIN_MS / 60_000,
        cutoff: cutoff.toISOString(),
        scannedTenants,
        scannedObjects,
        eligible,
        deleted,
        budgetExhausted: false,
        deleteLimitReached: false,
        pageLimitReached: false,
        cycleCompleted: true,
        mayHaveMore: false,
        cursor: undefined,
      };
    }
    if (!tenants.NextContinuationToken) {
      throw new Error("STRATO omitted a tenant listing cursor.");
    }
    tenantContinuationToken = tenants.NextContinuationToken;
    if (tenantPage === MAX_TENANT_PAGES - 1) {
      if (tenantStartAfter === initialTenantStartAfter) {
        throw new Error(
          "The STRATO tenant listing reached its page limit without persistable progress.",
        );
      }
      return partialResult("page-limit");
    }
  }
  throw new Error("The STRATO tenant listing ended unexpectedly.");
}

export async function sweepStratoPrivacyExports(input: {
  configuration: S3MediaStorageConfiguration;
  confirmBucket: string;
  now?: Date;
  cursor?: unknown;
  maxDeletes?: number;
  timeBudgetMs?: number;
  maxCycleAgeMs?: number;
  dryRun?: boolean;
}) {
  const maxDeletes = input.maxDeletes ?? 500;
  const timeBudgetMs = input.timeBudgetMs ?? 5 * 60_000;
  const maxCycleAgeMs =
    input.maxCycleAgeMs ??
    STRATO_RETENTION_SAFETY_MARGIN_MS - STRATO_RETENTION_SLA_RESERVE_MS;
  validateOptions({ maxDeletes, timeBudgetMs, maxCycleAgeMs });
  if (
    input.configuration.compatibilityMode !== "strato-hidrive" ||
    input.configuration.endpoint !== "https://s3.hidrive.strato.com" ||
    input.configuration.region !== "eu-central-1" ||
    input.configuration.forcePathStyle !== true
  ) {
    throw new Error("The STRATO retention sweeper requires explicit HiDrive mode.");
  }
  if (!input.confirmBucket || input.confirmBucket !== input.configuration.bucket) {
    throw new Error("The STRATO retention bucket confirmation does not match.");
  }
  const client = new S3Client({
    endpoint: input.configuration.endpoint,
    region: input.configuration.region,
    forcePathStyle: true,
    credentials: {
      accessKeyId: input.configuration.accessKeyId,
      secretAccessKey: input.configuration.secretAccessKey,
    },
    maxAttempts: 3,
    requestChecksumCalculation: "WHEN_REQUIRED",
    requestHandler: createS3NodeHttpHandler(),
  });
  try {
    const scope: StratoPrivacySweepScope = {
      endpoint: input.configuration.endpoint,
      region: input.configuration.region,
      bucket: input.configuration.bucket,
      compatibilityMode: input.configuration.compatibilityMode,
    };
    return await runStratoPrivacyExportSweep({
      adapter: {
        send: (command, options) => {
          if (command instanceof ListObjectsV2Command) {
            return client.send(command, options);
          }
          if (command instanceof DeleteObjectCommand) {
            return client.send(command, options);
          }
          return client.send(command, options);
        },
      },
      bucket: input.configuration.bucket,
      scope,
      now: input.now ?? new Date(),
      cursor: input.cursor,
      maxDeletes,
      timeBudgetMs,
      maxCycleAgeMs,
      dryRun: input.dryRun ?? false,
    });
  } finally {
    client.destroy();
  }
}
