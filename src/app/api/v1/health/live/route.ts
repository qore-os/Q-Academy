import { randomUUID } from "node:crypto";
import { configuredAppVersion } from "@/lib/server-error-logging";

export const dynamic = "force-dynamic";

export async function GET() {
  const requestId = randomUUID();
  return Response.json(
    { data: { status: "ok", service: "q-academy-api", version: configuredAppVersion(), timestamp: new Date().toISOString() }, meta: { requestId } },
    { headers: { "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*", "X-Request-Id": requestId } },
  );
}
