#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { constants as fileSystemConstants } from "node:fs";
import { open, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const maximumAuthorizationBytes = 1024;
const maximumResponseBytes = 1024 * 1024;
// The media route has a 19,800-second execution envelope. Its caller gets a
// separate 100-second transport margin to receive and persist the response.
const maximumTimeoutSeconds = 19_900;
const productionTemporaryDirectory = "/tmp";

const allowedEndpoints = new Set([
  "http://q-academy-app:3000/api/internal/jobs/dispatch",
  "http://q-academy-app:3000/api/internal/jobs/dispatch?cleanup=run&cleanupLimit=1000",
  "http://media-runner:3000/api/internal/jobs/media/dispatch?limit=1",
  "http://media-runner:3000/api/internal/jobs/media/maintenance?limit=5",
]);

function configurationError() {
  return new Error("The dispatcher HTTP request configuration is invalid.");
}

/**
 * @param {string} value
 */
export function validateEndpoint(value) {
  if (value.length === 0 || value.length > 1024) {
    throw configurationError();
  }

  let endpoint;
  try {
    endpoint = new URL(value);
  } catch {
    throw configurationError();
  }

  if (endpoint.href !== value || !allowedEndpoints.has(endpoint.href)) {
    throw configurationError();
  }
  return endpoint;
}

/**
 * @param {string} value
 */
export function validateOutputPath(value) {
  const temporaryDirectory = resolve(
    process.platform === "linux" ? productionTemporaryDirectory : tmpdir(),
  );
  const outputPath = resolve(value);
  const outputName = basename(outputPath);

  if (
    !isAbsolute(value) ||
    outputPath !== value ||
    dirname(outputPath) !== temporaryDirectory ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}[.]json$/.test(outputName)
  ) {
    throw configurationError();
  }
  return outputPath;
}

/**
 * @param {string[]} argumentsList
 */
export function parseArguments(argumentsList) {
  /** @type {string | undefined} */
  let endpointValue;
  /** @type {string | undefined} */
  let timeoutValue;
  /** @type {string | undefined} */
  let outputValue;

  for (let index = 0; index < argumentsList.length; index += 2) {
    const name = argumentsList[index];
    const value = argumentsList[index + 1];
    if (value === undefined) {
      throw configurationError();
    }

    switch (name) {
      case "--url":
        if (endpointValue !== undefined) throw configurationError();
        endpointValue = value;
        break;
      case "--timeout-seconds":
        if (timeoutValue !== undefined) throw configurationError();
        timeoutValue = value;
        break;
      case "--output":
        if (outputValue !== undefined) throw configurationError();
        outputValue = value;
        break;
      default:
        throw configurationError();
    }
  }

  if (
    endpointValue === undefined ||
    timeoutValue === undefined ||
    !/^[1-9][0-9]{0,4}$/.test(timeoutValue)
  ) {
    throw configurationError();
  }

  const timeoutSeconds = Number(timeoutValue);
  if (
    !Number.isSafeInteger(timeoutSeconds) ||
    timeoutSeconds > maximumTimeoutSeconds
  ) {
    throw configurationError();
  }

  return {
    endpoint: validateEndpoint(endpointValue),
    timeoutMilliseconds: timeoutSeconds * 1000,
    outputPath:
      outputValue === undefined ? undefined : validateOutputPath(outputValue),
  };
}

/**
 * @param {NodeJS.ReadableStream} input
 */
export async function readAuthorizationHeader(input) {
  /** @type {Buffer[]} */
  const chunks = [];
  let totalBytes = 0;

  try {
    for await (const value of input) {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      totalBytes += chunk.length;
      if (totalBytes > maximumAuthorizationBytes) {
        throw configurationError();
      }
      chunks.push(Buffer.from(chunk));
    }

    const inputBuffer = Buffer.concat(chunks);
    try {
      const decoder = new TextDecoder("utf-8", { fatal: true });
      let header = decoder.decode(inputBuffer);
      if (header.endsWith("\n")) header = header.slice(0, -1);
      if (header.endsWith("\r")) header = header.slice(0, -1);

      const match = /^Authorization: Bearer ([a-fA-F0-9]{32,512})$/.exec(
        header,
      );
      if (!match) throw configurationError();
      return `Bearer ${match[1]}`;
    } finally {
      inputBuffer.fill(0);
    }
  } finally {
    for (const chunk of chunks) chunk.fill(0);
  }
}

/**
 * @param {Response} response
 */
async function readBoundedResponseBody(response) {
  const contentLength = response.headers.get("content-length");
  if (
    contentLength !== null &&
    (!/^(0|[1-9][0-9]*)$/.test(contentLength) ||
      Number(contentLength) > maximumResponseBytes)
  ) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error("The dispatcher response body is too large.");
  }

  if (response.body === null) return Buffer.alloc(0);

  /** @type {Buffer[]} */
  const chunks = [];
  let totalBytes = 0;
  for await (const value of response.body) {
    const chunk = Buffer.from(value);
    totalBytes += chunk.length;
    if (totalBytes > maximumResponseBytes) {
      await response.body.cancel().catch(() => undefined);
      throw new Error("The dispatcher response body is too large.");
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, totalBytes);
}

/**
 * @param {string} outputPath
 * @param {Buffer} body
 */
async function writeResponseAtomically(outputPath, body) {
  const temporaryPath = `${outputPath}.${process.pid}.${randomUUID()}.tmp`;
  const noFollowFlag =
    process.platform === "linux" ? fileSystemConstants.O_NOFOLLOW : 0;
  let temporaryFile;

  try {
    temporaryFile = await open(
      temporaryPath,
      fileSystemConstants.O_WRONLY |
        fileSystemConstants.O_CREAT |
        fileSystemConstants.O_EXCL |
        noFollowFlag,
      0o600,
    );
    await temporaryFile.writeFile(body);
    await temporaryFile.sync();
    await temporaryFile.close();
    temporaryFile = undefined;
    await rename(temporaryPath, outputPath);
  } finally {
    await temporaryFile?.close().catch(() => undefined);
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

/**
 * @param {{
 *   endpoint: URL;
 *   authorization: string;
 *   timeoutMilliseconds: number;
 *   outputPath?: string;
 *   fetchImplementation?: typeof fetch;
 * }} options
 */
export async function performPost(options) {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMilliseconds,
  );

  try {
    const response = await (options.fetchImplementation ?? fetch)(
      options.endpoint,
      {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: options.authorization,
        },
        redirect: "manual",
        signal: controller.signal,
      },
    );

    if (options.outputPath === undefined) {
      await response.body?.cancel().catch(() => undefined);
    } else {
      const responseBody = await readBoundedResponseBody(response);
      await writeResponseAtomically(options.outputPath, responseBody);
    }
    return response.status;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * @param {string[]} argumentsList
 * @param {NodeJS.ReadableStream} input
 */
export async function main(argumentsList, input) {
  const configuration = parseArguments(argumentsList);
  if (configuration.outputPath !== undefined) {
    await rm(configuration.outputPath, { force: true });
  }

  let authorization = await readAuthorizationHeader(input);
  try {
    const status = await performPost({
      ...configuration,
      authorization,
    });
    process.stdout.write(String(status));
  } finally {
    authorization = "";
  }
}

const invokedPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : undefined;
if (invokedPath === import.meta.url) {
  main(process.argv.slice(2), process.stdin).catch(() => {
    process.stderr.write("Dispatcher HTTP request failed.\n");
    process.exitCode = 1;
  });
}
