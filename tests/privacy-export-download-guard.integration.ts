import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";
import { postgresClient } from "../src/db";
import { clearPersistentRateLimit } from "../src/lib/auth-rate-limit";
import {
  claimPrivacyExportDownload,
  PrivacyExportDownloadGuardError,
  releasePrivacyExportDownload,
} from "../src/lib/privacy/export-download-guard";

after(async () => {
  await postgresClient.end();
});

function guardCode(error: unknown) {
  return error instanceof PrivacyExportDownloadGuardError ? error.code : null;
}

async function clearDownloadBuckets(organizationId: string, userIds: string[]) {
  await Promise.all([
    ...userIds.map((userId) =>
      clearPersistentRateLimit({
        action: "privacy_export_download",
        identifier: `${organizationId}\0${userId}`,
      }),
    ),
    clearPersistentRateLimit({
      action: "privacy_export_download_tenant",
      identifier: organizationId,
    }),
    clearPersistentRateLimit({
      action: "privacy_export_download_concurrent",
      identifier: organizationId,
    }),
  ]);
}

test("privacy export download allows only one in-flight read per organization", async () => {
  const organizationId = randomUUID();
  const userIds = [randomUUID(), randomUUID()];
  let lease: Awaited<ReturnType<typeof claimPrivacyExportDownload>> | null = null;
  try {
    lease = await claimPrivacyExportDownload({
      organizationId,
      userId: userIds[0]!,
    });
    await assert.rejects(
      claimPrivacyExportDownload({ organizationId, userId: userIds[1]! }),
      (error) => guardCode(error) === "busy",
    );
  } finally {
    if (lease) await releasePrivacyExportDownload(lease);
    await clearDownloadBuckets(organizationId, userIds);
  }
});

test("privacy export download releases a rejected tenant claim when process capacity is full", async () => {
  const activeOrganizationId = randomUUID();
  const rejectedOrganizationId = randomUUID();
  const activeUserId = randomUUID();
  const rejectedUserId = randomUUID();
  let activeLease: Awaited<ReturnType<typeof claimPrivacyExportDownload>> | null = null;
  let replacementLease: Awaited<ReturnType<typeof claimPrivacyExportDownload>> | null = null;
  try {
    activeLease = await claimPrivacyExportDownload({
      organizationId: activeOrganizationId,
      userId: activeUserId,
    });
    await assert.rejects(
      claimPrivacyExportDownload({
        organizationId: rejectedOrganizationId,
        userId: rejectedUserId,
      }),
      (error) => guardCode(error) === "capacity",
    );
    await releasePrivacyExportDownload(activeLease);
    activeLease = null;
    replacementLease = await claimPrivacyExportDownload({
      organizationId: rejectedOrganizationId,
      userId: rejectedUserId,
    });
  } finally {
    if (activeLease) await releasePrivacyExportDownload(activeLease);
    if (replacementLease) await releasePrivacyExportDownload(replacementLease);
    await clearDownloadBuckets(activeOrganizationId, [activeUserId]);
    await clearDownloadBuckets(rejectedOrganizationId, [rejectedUserId]);
  }
});

test("privacy export download limits successful step-ups per user", async () => {
  const organizationId = randomUUID();
  const userId = randomUUID();
  try {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const lease = await claimPrivacyExportDownload({ organizationId, userId });
      await releasePrivacyExportDownload(lease);
    }
    await assert.rejects(
      claimPrivacyExportDownload({ organizationId, userId }),
      (error) => guardCode(error) === "rate_limited",
    );
  } finally {
    await clearDownloadBuckets(organizationId, [userId]);
  }
});

test("privacy export download applies the shared tenant quota", async () => {
  const organizationId = randomUUID();
  const userIds = Array.from({ length: 31 }, () => randomUUID());
  try {
    for (const userId of userIds.slice(0, 30)) {
      const lease = await claimPrivacyExportDownload({ organizationId, userId });
      await releasePrivacyExportDownload(lease);
    }
    await assert.rejects(
      claimPrivacyExportDownload({
        organizationId,
        userId: userIds[30]!,
      }),
      (error) => guardCode(error) === "rate_limited",
    );
  } finally {
    await clearDownloadBuckets(organizationId, userIds);
  }
});
