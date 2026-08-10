import { randomUUID } from "node:crypto";

import { authorizeInternalJobRequest } from "@/lib/internal-job-auth";
import {
  INTERNAL_MEDIA_MAINTENANCE_QUERY,
  internalJobProblem,
  parseInternalJobQuery,
} from "@/lib/internal-job-request";
import { processMediaMaintenanceQueues } from "@/lib/media/scan-worker";
import { recordOperationalWorkerSuccess } from "@/lib/operational-heartbeats";

export const dynamic = "force-dynamic";
export const maxDuration = 540;

export async function POST(request: Request) {
  const requestId = randomUUID();
  if (!authorizeInternalJobRequest(request)) {
    return internalJobProblem(requestId, 401, "Ungueltiges Worker-Geheimnis.");
  }
  const query = parseInternalJobQuery(
    request,
    INTERNAL_MEDIA_MAINTENANCE_QUERY,
  );
  if (!query.ok) {
    return internalJobProblem(requestId, 400, query.detail);
  }
  const { limit } = query.value;

  const result = await processMediaMaintenanceQueues(limit);
  await recordOperationalWorkerSuccess("media-maintenance");
  return Response.json(
    {
      data: {
        processed:
          result.cleanedMultipartSessions +
          result.cancelledProcessingJobs +
          result.releasedQuotaAssets +
          result.expired +
          result.expiredUnattachedSubmissionAssets +
          result.expiredUnattachedCourseAssets +
          result.expiredUnattachedCommunityAssets +
          result.expiredUnattachedProfileAssets +
          result.expiredUnattachedProfileFieldAssets +
          result.expiredUnattachedBrandingAssets +
          result.cleaned +
          result.purged +
          result.removedProcessingArtifacts,
        skipped: result.skipped,
        timedOut: result.timedOut,
        cleanedMultipartSessions: result.cleanedMultipartSessions,
        cancelledProcessingJobs: result.cancelledProcessingJobs,
        releasedQuotaAssets: result.releasedQuotaAssets,
        expiredUploads: result.expired,
        expiredUnattachedSubmissionAssets:
          result.expiredUnattachedSubmissionAssets,
        expiredUnattachedCourseAssets: result.expiredUnattachedCourseAssets,
        expiredUnattachedCommunityAssets:
          result.expiredUnattachedCommunityAssets,
        expiredUnattachedProfileAssets: result.expiredUnattachedProfileAssets,
        expiredUnattachedProfileFieldAssets:
          result.expiredUnattachedProfileFieldAssets,
        expiredUnattachedBrandingAssets: result.expiredUnattachedBrandingAssets,
        cleanedObjects: result.cleaned,
        purgedTombstones: result.purged,
        removedProcessingArtifacts: result.removedProcessingArtifacts,
      },
      meta: { requestId, timestamp: new Date().toISOString() },
    },
    {
      headers: {
        "Cache-Control": "no-store",
        "X-Request-Id": requestId,
      },
    },
  );
}
