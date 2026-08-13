import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { rm, readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  parseArguments,
  performPost,
  readAuthorizationHeader,
  validateEndpoint,
  validateOutputPath,
} from "../scripts/ops/dispatcher-http-post.mjs";

const helperPath = fileURLToPath(
  new URL("../scripts/ops/dispatcher-http-post.mjs", import.meta.url),
);
const authorizationToken = "a".repeat(64);

async function listen(server: Server) {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return `http://127.0.0.1:${address.port}`;
}

async function close(server: Server) {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

test("dispatcher arguments only admit the fixed internal POST contracts", () => {
  for (const endpoint of [
    "http://q-academy-app:3000/api/internal/jobs/dispatch",
    "http://q-academy-app:3000/api/internal/jobs/dispatch?cleanup=run&cleanupLimit=1000",
    "http://media-runner:3000/api/internal/jobs/media/dispatch?limit=1",
    "http://media-runner:3000/api/internal/jobs/media/maintenance?limit=5",
  ]) {
    assert.equal(validateEndpoint(endpoint).href, endpoint);
  }

  for (const endpoint of [
    "https://app:3000/api/internal/jobs/dispatch",
    "http://app:3000/api/internal/jobs/dispatch",
    "http://app:3000/api/internal/jobs/dispatch?cleanup=run",
    "http://media-runner:3000/api/internal/jobs/media/dispatch?limit=2",
    "http://127.0.0.1:3000/api/internal/jobs/dispatch",
    "http://app:3000/api/internal/jobs/../jobs/dispatch",
  ]) {
    assert.throws(() => validateEndpoint(endpoint), /configuration is invalid/);
  }

  const outputPath = join(
    tmpdir(),
    `q-academy-dispatcher-${randomUUID()}.json`,
  );
  assert.equal(validateOutputPath(outputPath), outputPath);
  assert.throws(
    () => validateOutputPath(join(tmpdir(), "nested", "response.json")),
    /configuration is invalid/,
  );

  const parsed = parseArguments([
    "--url",
    "http://q-academy-app:3000/api/internal/jobs/dispatch",
    "--timeout-seconds",
    "45",
  ]);
  assert.equal(parsed.timeoutMilliseconds, 45_000);
  assert.equal(parsed.outputPath, undefined);
  assert.throws(
    () =>
      parseArguments([
        "--url",
        "http://q-academy-app:3000/api/internal/jobs/dispatch",
        "--timeout-seconds",
        "19901",
      ]),
    /configuration is invalid/,
  );
});

test("dispatcher authorization input is bounded, hexadecimal, and single-line", async () => {
  assert.equal(
    await readAuthorizationHeader(
      Readable.from([`Authorization: Bearer ${authorizationToken}\n`]),
    ),
    `Bearer ${authorizationToken}`,
  );
  await assert.rejects(
    readAuthorizationHeader(
      Readable.from([
        `Authorization: Bearer ${authorizationToken}\nInjected: value\n`,
      ]),
    ),
    /configuration is invalid/,
  );
  await assert.rejects(
    readAuthorizationHeader(Readable.from(["Authorization: Bearer not-hex\n"])),
    /configuration is invalid/,
  );
});

test("dispatcher POST preserves status and body without following redirects", async () => {
  let receivedAuthorization = "";
  let receivedMethod = "";
  let redirectedRequests = 0;
  const responseBody = JSON.stringify({ processed: 1 });
  const server = createServer((request, response) => {
    if (request.url === "/redirect") {
      response.writeHead(302, { location: "/redirected" });
      response.end();
      return;
    }
    if (request.url === "/redirected") {
      redirectedRequests += 1;
      response.writeHead(204);
      response.end();
      return;
    }
    receivedAuthorization = request.headers.authorization ?? "";
    receivedMethod = request.method ?? "";
    response.writeHead(202, {
      "content-length": Buffer.byteLength(responseBody),
      "content-type": "application/json",
    });
    response.end(responseBody);
  });
  const origin = await listen(server);
  const outputPath = join(
    tmpdir(),
    `q-academy-dispatcher-${randomUUID()}.json`,
  );

  try {
    const status = await performPost({
      endpoint: new URL(`${origin}/response`),
      authorization: `Bearer ${authorizationToken}`,
      timeoutMilliseconds: 1000,
      outputPath,
    });
    assert.equal(status, 202);
    assert.equal(await readFile(outputPath, "utf8"), responseBody);
    assert.equal(receivedMethod, "POST");
    assert.equal(receivedAuthorization, `Bearer ${authorizationToken}`);

    const redirectStatus = await performPost({
      endpoint: new URL(`${origin}/redirect`),
      authorization: `Bearer ${authorizationToken}`,
      timeoutMilliseconds: 1000,
    });
    assert.equal(redirectStatus, 302);
    assert.equal(redirectedRequests, 0);
  } finally {
    await rm(outputPath, { force: true });
    await close(server);
  }
});

test("dispatcher POST fails closed on timeout and oversized responses", async () => {
  const server = createServer((request, response) => {
    if (request.url === "/slow") {
      setTimeout(() => {
        response.writeHead(204);
        response.end();
      }, 200);
      return;
    }
    const body = Buffer.alloc(1024 * 1024 + 1, 0x61);
    response.writeHead(200, { "content-length": body.length });
    response.end(body);
  });
  const origin = await listen(server);
  const outputPath = join(
    tmpdir(),
    `q-academy-dispatcher-${randomUUID()}.json`,
  );

  try {
    await assert.rejects(
      performPost({
        endpoint: new URL(`${origin}/slow`),
        authorization: `Bearer ${authorizationToken}`,
        timeoutMilliseconds: 20,
      }),
    );
    await assert.rejects(
      performPost({
        endpoint: new URL(`${origin}/large`),
        authorization: `Bearer ${authorizationToken}`,
        timeoutMilliseconds: 1000,
        outputPath,
      }),
      /too large/,
    );
    await assert.rejects(readFile(outputPath), /ENOENT/);
  } finally {
    await rm(outputPath, { force: true });
    await close(server);
  }
});

test("dispatcher CLI never includes bearer material in failure output", () => {
  const result = spawnSync(
    process.execPath,
    [
      helperPath,
      "--url",
      "http://untrusted.invalid/internal",
      "--timeout-seconds",
      "1",
    ],
    {
      encoding: "utf8",
      input: `Authorization: Bearer ${authorizationToken}\n`,
    },
  );

  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "Dispatcher HTTP request failed.\n");
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, new RegExp(authorizationToken));
});
