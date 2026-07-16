import { writeFile } from "node:fs/promises";
import { request } from "node:http";

import {
  evaluateZapRouteContract,
  ZAP_ROUTE_CONTRACT_HOST,
  ZAP_ROUTE_CONTRACT_PATHS,
  ZAP_ROUTE_MAX_RESPONSE_BYTES,
  type ZapRouteObservation,
} from "../../src/lib/operations/zap-route-contract";

const REQUEST_TIMEOUT_MS = 5_000;

function emptyObservation(
  path: string,
  transportError: NonNullable<ZapRouteObservation["transportError"]>,
): ZapRouteObservation {
  return {
    path,
    status: null,
    headers: {},
    body: new Uint8Array(),
    transportError,
  };
}

function observeRoute(path: string): Promise<ZapRouteObservation> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (observation: ZapRouteObservation) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(observation);
    };

    const outgoing = request(
      {
        hostname: "127.0.0.1",
        port: 3000,
        path,
        method: "GET",
        agent: false,
        headers: {
          Accept:
            path === "/robots.txt"
              ? "text/plain"
              : path === "/sitemap.xml"
                ? "application/xml"
                : "text/html",
          Connection: "close",
          Host: ZAP_ROUTE_CONTRACT_HOST,
          "User-Agent": "Q-Academy-ZAP-Route-Contract/1",
        },
      },
      (incoming) => {
        const headers = Object.fromEntries(
          Object.entries(incoming.headersDistinct).map(([name, values]) => [
            name.toLowerCase(),
            [...(values ?? [])],
          ]),
        );
        const declaredLengths = headers["content-length"] ?? [];
        if (
          declaredLengths.length === 1 &&
          /^(?:0|[1-9]\d*)$/.test(declaredLengths[0]!) &&
          Number(declaredLengths[0]) > ZAP_ROUTE_MAX_RESPONSE_BYTES
        ) {
          settle({
            ...emptyObservation(path, "response_too_large"),
            status: incoming.statusCode ?? null,
            headers,
          });
          incoming.destroy();
          outgoing.destroy();
          return;
        }

        const chunks: Buffer[] = [];
        let receivedBytes = 0;
        incoming.on("data", (chunk: Buffer) => {
          if (settled) return;
          const buffer = Buffer.from(chunk);
          receivedBytes += buffer.byteLength;
          if (receivedBytes > ZAP_ROUTE_MAX_RESPONSE_BYTES) {
            settle({
              ...emptyObservation(path, "response_too_large"),
              status: incoming.statusCode ?? null,
              headers,
            });
            incoming.destroy();
            outgoing.destroy();
            return;
          }
          chunks.push(buffer);
        });
        incoming.on("end", () => {
          settle({
            path,
            status: incoming.statusCode ?? null,
            headers,
            body: Buffer.concat(chunks, receivedBytes),
          });
        });
        incoming.on("aborted", () =>
          settle(emptyObservation(path, "request_failed")),
        );
        incoming.on("error", () =>
          settle(emptyObservation(path, "request_failed")),
        );
      },
    );

    outgoing.on("error", () =>
      settle(emptyObservation(path, "request_failed")),
    );
    const timer = setTimeout(() => {
      settle(emptyObservation(path, "request_timeout"));
      outgoing.destroy();
    }, REQUEST_TIMEOUT_MS);
    outgoing.end();
  });
}

async function main() {
  const evidencePath = process.argv[2];
  if (!evidencePath || process.argv.length !== 3) {
    throw new Error(
      "Usage: validate-zap-route-contract.ts <route-contract.json>",
    );
  }

  const observations: ZapRouteObservation[] = [];
  for (const path of ZAP_ROUTE_CONTRACT_PATHS) {
    observations.push(await observeRoute(path));
  }
  const evidence = evaluateZapRouteContract(observations);
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });

  if (!evidence.passed) {
    const issues = [
      ...evidence.issueCodes,
      ...evidence.routes.flatMap((route) =>
        route.issueCodes.map((issue) => `${route.path}:${issue}`),
      ),
    ];
    throw new Error(`contract mismatch (${issues.join(", ")})`);
  }
  console.log(
    `ZAP route contract validation passed: ${evidence.routes.length} deterministic routes.`,
  );
}

main().catch((error: unknown) => {
  const detail =
    error instanceof Error && error.message.startsWith("contract mismatch")
      ? `: ${error.message}`
      : ".";
  console.error(`ZAP route contract validation failed${detail}`);
  process.exitCode = 1;
});
