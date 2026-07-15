import { randomUUID } from "node:crypto";
import { assertRuntimeServerEnvironment } from "@/lib/server-environment";
import { ProductionEnvironmentError } from "@/lib/server-environment-validation";
import { assertCurrentDatabaseSchema } from "@/lib/schema-readiness";
import { configuredAppVersion } from "@/lib/server-error-logging";

export const dynamic = "force-dynamic";

export async function GET() {
  const requestId = randomUUID();
  const started = performance.now();
  try {
    assertRuntimeServerEnvironment();
    const schema = await assertCurrentDatabaseSchema();
    return Response.json(
      {
        data: {
          status: "ready",
          version: configuredAppVersion(),
          database: "connected",
          databaseEncoding: schema.encoding,
          schema: "current",
          migrations: schema.migrations,
          latencyMs: Math.round(performance.now() - started),
          timestamp: new Date().toISOString(),
        },
        meta: { requestId },
      },
      {
        headers: {
          "Cache-Control": "no-store",
          "Access-Control-Allow-Origin": "*",
          "X-Request-Id": requestId,
        },
      },
    );
  } catch (error) {
    const configurationError = error instanceof ProductionEnvironmentError;
    return Response.json(
      { type: "about:blank", title: "Service Unavailable", status: 503, detail: configurationError ? "Die Produktionskonfiguration ist ungueltig." : "Datenbank oder Schema sind nicht betriebsbereit.", requestId },
      { status: 503, headers: { "Cache-Control": "no-store", "Content-Type": "application/problem+json", "X-Request-Id": requestId } },
    );
  }
}
