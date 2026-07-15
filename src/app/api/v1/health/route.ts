import { sql } from "drizzle-orm";
import { db } from "@/db";
import { configuredAppVersion } from "@/lib/server-error-logging";

export const dynamic = "force-dynamic";

export async function GET() {
  const started = performance.now();
  try {
    await db.execute(sql`select 1`);
    return Response.json(
      {
        data: {
          status: "ok",
          service: "q-academy-api",
          version: configuredAppVersion(),
          database: "connected",
          timestamp: new Date().toISOString(),
          latencyMs: Math.round(performance.now() - started),
        },
      },
      { headers: { "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" } },
    );
  } catch {
    return Response.json(
      { data: { status: "degraded", service: "q-academy-api", database: "unavailable", timestamp: new Date().toISOString() } },
      { status: 503, headers: { "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" } },
    );
  }
}
