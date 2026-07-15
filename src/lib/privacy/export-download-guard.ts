import "server-only";

import {
  clearPersistentRateLimit,
  consumeGuardedPersistentRateLimit,
  consumePersistentRateLimit,
  retryAfterSeconds,
} from "@/lib/auth-rate-limit";
import {
  claimPrivacyRuntimeCapacity,
  type PrivacyRuntimeCapacityLease,
  releasePrivacyRuntimeCapacity,
} from "@/lib/privacy/runtime-capacity";

export class PrivacyExportDownloadGuardError extends Error {
  constructor(
    public readonly code:
      | "busy"
      | "capacity"
      | "rate_limited"
      | "unavailable",
    public readonly retryAfter?: number,
    options?: ErrorOptions,
  ) {
    super(
      code === "busy"
        ? "Ein anderer Exportdownload dieser Organisation wird bereits verarbeitet."
        : code === "capacity"
          ? "Der Server verarbeitet bereits die maximal erlaubte Anzahl an Exportdownloads."
        : code === "rate_limited"
          ? "Zu viele Exportdownloads. Bitte spaeter erneut versuchen."
          : "Der Exportdownload kann derzeit nicht sicher gestartet werden.",
      options,
    );
    this.name = "PrivacyExportDownloadGuardError";
  }
}

export type PrivacyExportDownloadLease = Readonly<{
  organizationId: string;
  runtimeLease: PrivacyRuntimeCapacityLease;
  resetAt: Date;
}>;

export async function claimPrivacyExportDownload(input: {
  organizationId: string;
  userId: string;
}): Promise<PrivacyExportDownloadLease> {
  let rateLimit;
  try {
    rateLimit = await consumeGuardedPersistentRateLimit({
      primary: {
        action: "privacy_export_download",
        identifier: `${input.organizationId}\0${input.userId}`,
      },
      guards: [
        {
          action: "privacy_export_download_tenant",
          identifier: input.organizationId,
        },
      ],
    });
  } catch (error) {
    throw new PrivacyExportDownloadGuardError(
      "unavailable",
      undefined,
      error instanceof Error ? { cause: error } : undefined,
    );
  }
  if (rateLimit.limited) {
    throw new PrivacyExportDownloadGuardError(
      "rate_limited",
      retryAfterSeconds(rateLimit.resetAt),
    );
  }

  let concurrency;
  try {
    concurrency = await consumePersistentRateLimit({
      action: "privacy_export_download_concurrent",
      identifier: input.organizationId,
    });
  } catch (error) {
    throw new PrivacyExportDownloadGuardError(
      "unavailable",
      undefined,
      error instanceof Error ? { cause: error } : undefined,
    );
  }
  if (concurrency.limited) {
    throw new PrivacyExportDownloadGuardError(
      "busy",
      retryAfterSeconds(concurrency.resetAt),
    );
  }
  const runtimeLease = claimPrivacyRuntimeCapacity();
  if (!runtimeLease) {
    try {
      await clearPersistentRateLimit({
        action: "privacy_export_download_concurrent",
        identifier: input.organizationId,
        expectedResetAt: concurrency.resetAt,
      });
    } catch (error) {
      throw new PrivacyExportDownloadGuardError(
        "unavailable",
        undefined,
        error instanceof Error ? { cause: error } : undefined,
      );
    }
    throw new PrivacyExportDownloadGuardError("capacity", 1);
  }
  return {
    organizationId: input.organizationId,
    runtimeLease,
    resetAt: concurrency.resetAt,
  };
}

export async function releasePrivacyExportDownload(
  lease: PrivacyExportDownloadLease,
) {
  try {
    await clearPersistentRateLimit({
      action: "privacy_export_download_concurrent",
      identifier: lease.organizationId,
      expectedResetAt: lease.resetAt,
    });
  } finally {
    releasePrivacyRuntimeCapacity(lease.runtimeLease);
  }
}
