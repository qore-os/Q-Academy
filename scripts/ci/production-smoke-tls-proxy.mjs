import { readFileSync } from "node:fs";
import { request as createUpstreamRequest } from "node:http";
import { createServer } from "node:https";

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

const publicOrigin = new URL(requiredEnvironment("PRODUCTION_SMOKE_PUBLIC_ORIGIN"));
const upstreamOrigin = new URL(requiredEnvironment("PRODUCTION_SMOKE_UPSTREAM_ORIGIN"));
const listenHost = process.env.PRODUCTION_SMOKE_LISTEN_HOST?.trim() || "127.0.0.1";
const listenPort = Number.parseInt(
  process.env.PRODUCTION_SMOKE_LISTEN_PORT?.trim() || "3443",
  10,
);

if (publicOrigin.protocol !== "https:" || upstreamOrigin.protocol !== "http:") {
  throw new Error("The smoke proxy requires an HTTPS public origin and HTTP upstream.");
}
if (!Number.isSafeInteger(listenPort) || listenPort < 1 || listenPort > 65_535) {
  throw new Error("PRODUCTION_SMOKE_LISTEN_PORT must be a valid TCP port.");
}

const server = createServer(
  {
    cert: readFileSync(requiredEnvironment("PRODUCTION_SMOKE_CERT_FILE")),
    key: readFileSync(requiredEnvironment("PRODUCTION_SMOKE_KEY_FILE")),
  },
  (request, response) => {
    const forwardedFor = request.socket.remoteAddress || "127.0.0.1";
    const upstreamRequest = createUpstreamRequest(
      {
        protocol: upstreamOrigin.protocol,
        hostname: upstreamOrigin.hostname,
        port: upstreamOrigin.port,
        method: request.method,
        path: request.url,
        headers: {
          ...request.headers,
          host: publicOrigin.host,
          "x-forwarded-for": forwardedFor,
          "x-forwarded-host": publicOrigin.host,
          "x-forwarded-proto": "https",
        },
      },
      (upstreamResponse) => {
        response.writeHead(
          upstreamResponse.statusCode ?? 502,
          upstreamResponse.headers,
        );
        upstreamResponse.pipe(response);
      },
    );

    upstreamRequest.on("error", (error) => {
      if (response.headersSent) {
        response.destroy(error);
        return;
      }
      response.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
      response.end("Production smoke upstream is unavailable.");
    });
    request.pipe(upstreamRequest);
  },
);

server.on("clientError", (_error, socket) => {
  socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
});

function shutdown() {
  server.close((error) => {
    process.exitCode = error ? 1 : 0;
  });
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

server.listen(listenPort, listenHost, () => {
  process.stdout.write(
    `production-smoke-tls-proxy ready at ${publicOrigin.origin}\n`,
  );
});
