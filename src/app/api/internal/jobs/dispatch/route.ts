import { randomUUID } from "node:crypto";
import { processEmailQueue } from "@/lib/email-delivery";
import { processWebhookQueue } from "@/lib/api/webhook-delivery";
import { cleanupOperationalData } from "@/lib/operational-cleanup";
import { authorizeInternalJobRequest } from "@/lib/internal-job-auth";
import { cleanupExpiredPrivacyExports } from "@/lib/privacy/retention";
import { privacyRetentionNeedsRetry } from "@/lib/privacy/retention-dispatch";
import { processExamLifecycleDeadlines } from "@/lib/exam-lifecycle";
import { readJobQueueMetrics } from "@/lib/job-queue-metrics";
import { recordOperationalWorkerSuccess } from "@/lib/operational-heartbeats";
import { expireDueAiAgentActionRequests } from "@/lib/ai/agent-actions";
import { processPushQueue } from "@/lib/push/delivery";
import { processNativePushQueue } from "@/lib/push/native-delivery";
import { reconcileAllExpiredCommerceEntitlements } from "@/lib/commerce/service";
import { cleanupExpiredAuthoringData } from "@/lib/authoring-retention";
import { cleanupRevokedCustomDomainClaims } from "@/lib/custom-domain-retention";
import {
  INTERNAL_JOB_DISPATCH_QUERY,
  internalJobProblem,
  parseInternalJobQuery,
} from "@/lib/internal-job-request";
import { logServerError } from "@/lib/server-error-logging";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const requestId = randomUUID();
  if (!authorizeInternalJobRequest(request)) {
    return internalJobProblem(
      requestId,
      401,
      "Ungueltiges Worker-Geheimnis.",
    );
  }

  const query = parseInternalJobQuery(request, INTERNAL_JOB_DISPATCH_QUERY);
  if (!query.ok) {
    return internalJobProblem(requestId, 400, query.detail);
  }
  const {
    limit,
    cleanup: cleanupMode,
    cleanupLimit,
  } = query.value;
  const dryRun = cleanupMode === "dry-run";
  const skipCleanup = cleanupMode === null;
  const [emails, webhooks, pushDeliveries, nativePushDeliveries, examAttempts, actionRequestsExpired, commerce, cleanup, privacyExports, authoringCleanup, customDomainCleanup] = await Promise.all([
    dryRun ? Promise.resolve([]) : processEmailQueue(limit),
    dryRun ? Promise.resolve([]) : processWebhookQueue(limit),
    dryRun ? Promise.resolve([]) : processPushQueue(limit),
    dryRun ? Promise.resolve([]) : processNativePushQueue(limit),
    dryRun ? Promise.resolve([]) : processExamLifecycleDeadlines(limit),
    dryRun ? Promise.resolve(0) : expireDueAiAgentActionRequests(limit),
    dryRun
      ? Promise.resolve({ reconciled: 0, tenantCount: 0 })
      : reconcileAllExpiredCommerceEntitlements(),
    skipCleanup
      ? Promise.resolve({ mode: "skipped" as const })
      : cleanupOperationalData({
          batchSize: cleanupLimit,
          dryRun,
        }),
    skipCleanup
      ? Promise.resolve({ mode: "skipped" as const })
      : cleanupExpiredPrivacyExports({
          batchSize: cleanupLimit,
          dryRun,
        }),
    skipCleanup
      ? Promise.resolve({ mode: "skipped" as const })
      : cleanupExpiredAuthoringData({
          batchSize: cleanupLimit,
          dryRun,
        }),
    skipCleanup
      ? Promise.resolve({ mode: "skipped" as const })
      : cleanupRevokedCustomDomainClaims({
          batchSize: cleanupLimit,
          dryRun,
        }),
  ]);
  const queues = await readJobQueueMetrics();
  const privacyCleanupNeedsRetry = privacyRetentionNeedsRetry(privacyExports);
  if (privacyCleanupNeedsRetry) {
    logServerError(new Error("Privacy retention cleanup requires a retry."), {
      action: "privacy.retention.dispatch",
      requestId,
    });
  } else {
    await recordOperationalWorkerSuccess("scheduler");
  }
  return Response.json(
    {
      data: {
        processed:
          emails.length +
          webhooks.length +
          pushDeliveries.length +
          nativePushDeliveries.length +
          examAttempts.length +
          actionRequestsExpired +
          commerce.reconciled,
          commerceEntitlementsReconciled: commerce.reconciled,
          commerceTenantsReconciled: commerce.tenantCount,
        emailDeliveries: emails.length,
        webhookDeliveries: webhooks.length,
        pushDeliveries: pushDeliveries.length,
        nativePushDeliveries: nativePushDeliveries.length,
        examAttempts: examAttempts.length,
        actionRequestsExpired,
        queues,
        cleanup,
        privacyExports,
        authoringCleanup,
        customDomainCleanup,
      },
      meta: { requestId, timestamp: new Date().toISOString() },
    },
    {
      status: privacyCleanupNeedsRetry ? 503 : 200,
      headers: {
        "Cache-Control": "no-store",
        "X-Request-Id": requestId,
        ...(privacyCleanupNeedsRetry ? { "Retry-After": "15" } : {}),
      },
    },
  );
}
