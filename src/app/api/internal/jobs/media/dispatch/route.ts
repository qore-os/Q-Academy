import { randomUUID } from "node:crypto";

import { authorizeInternalJobRequest } from "@/lib/internal-job-auth";
import {
  INTERNAL_MEDIA_DISPATCH_QUERY,
  internalJobProblem,
  parseInternalJobQuery,
} from "@/lib/internal-job-request";
import { processMediaScanQueue } from "@/lib/media/scan-worker";
import {
  processMediaProcessingQueue,
  readMediaProcessingBacklogMetrics,
} from "@/lib/media/processing-worker";
import { recordOperationalWorkerSuccess } from "@/lib/operational-heartbeats";

export const dynamic = "force-dynamic";
// One request can run one 10-minute malware scan and one 10-minute processor.
export const maxDuration = 1_260;

export async function POST(request: Request) {
  const requestId = randomUUID();
  if (!authorizeInternalJobRequest(request)) {
    return internalJobProblem(
      requestId,
      401,
      "Ungueltiges Worker-Geheimnis.",
    );
  }
  const query = parseInternalJobQuery(request, INTERNAL_MEDIA_DISPATCH_QUERY);
  if (!query.ok) {
    return internalJobProblem(requestId, 400, query.detail);
  }

  const result = await processMediaScanQueue(query.value.limit);
  const processing = await processMediaProcessingQueue(query.value.limit);
  const processingBacklog = await readMediaProcessingBacklogMetrics();
  await recordOperationalWorkerSuccess("media-scan");
  return Response.json(
    {
      data: {
        processed: result.scans.length + processing.length,
        scans: result.scans,
        processing,
        processingBacklog,
        backlog: result.backlog,
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
