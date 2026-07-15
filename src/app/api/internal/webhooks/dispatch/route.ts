import { randomUUID } from "node:crypto";
import { processWebhookQueue } from "@/lib/api/webhook-delivery";
import { authorizeInternalJobRequest } from "@/lib/internal-job-auth";
import {
  INTERNAL_WEBHOOK_DISPATCH_QUERY,
  internalJobProblem,
  parseInternalJobQuery,
} from "@/lib/internal-job-request";

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
  const query = parseInternalJobQuery(
    request,
    INTERNAL_WEBHOOK_DISPATCH_QUERY,
  );
  if (!query.ok) {
    return internalJobProblem(requestId, 400, query.detail);
  }
  const results = await processWebhookQueue(query.value.limit);
  return Response.json(
    { data: { processed: results.length, deliveries: results }, meta: { requestId, timestamp: new Date().toISOString() } },
    { headers: { "Cache-Control": "no-store", "X-Request-Id": requestId } },
  );
}
