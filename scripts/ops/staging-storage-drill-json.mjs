#!/usr/bin/env node

import { readFileSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute } from "node:path";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function reject() {
  throw new Error("invalid_storage_drill_evidence");
}

function object(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) reject();
  return value;
}

function jsonFile(path) {
  if (!isAbsolute(path)) reject();
  return object(JSON.parse(readFileSync(path, "utf8")));
}

function curlQuote(value) {
  if (/[^\u0020-\u007e]/.test(value)) reject();
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function validateStorageUrl(
  rawUrl,
  expectedEndpoint,
  expectedBucket,
  expectedObjectKey,
) {
  const endpoint = new URL(expectedEndpoint);
  const url = new URL(rawUrl);
  const canonicalEndpoint = `https://${endpoint.hostname}`;
  const virtualHosted =
    url.hostname === `${expectedBucket}.${endpoint.hostname}`;
  const pathStyle =
    url.hostname === endpoint.hostname &&
    url.pathname === `/${expectedBucket}/${expectedObjectKey}`;
  const virtualHostedPath =
    virtualHosted && url.pathname === `/${expectedObjectKey}`;
  if (
    expectedEndpoint !== canonicalEndpoint ||
    endpoint.protocol !== "https:" ||
    endpoint.username ||
    endpoint.password ||
    endpoint.port ||
    endpoint.pathname !== "/" ||
    endpoint.search ||
    endpoint.hash ||
    url.protocol !== "https:" ||
    (!virtualHostedPath && !pathStyle) ||
    url.port ||
    url.username ||
    url.password ||
    !url.search ||
    url.hash
  ) {
    reject();
  }
  return url;
}

function sessionIdentity(path) {
  const payload = jsonFile(path);
  const data = object(payload.data);
  if (
    !uuidPattern.test(String(data.id ?? "")) ||
    !uuidPattern.test(String(data.organizationId ?? "")) ||
    !uuidPattern.test(String(data.sessionId ?? "")) ||
    data.role !== "member" ||
    data.status !== "active"
  ) {
    reject();
  }
  return { organizationId: data.organizationId };
}

function validateSession(path) {
  sessionIdentity(path);
}

function writeUploadConfig(
  responsePath,
  sessionPath,
  expectedId,
  canaryPath,
  configPath,
  expectedEndpoint,
  expectedBucket,
) {
  if (
    !uuidPattern.test(expectedId) ||
    !isAbsolute(canaryPath) ||
    !isAbsolute(configPath) ||
    expectedBucket.length > 63 ||
    !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(expectedBucket) ||
    expectedBucket.includes("..") ||
    /^\d{1,3}(?:\.\d{1,3}){3}$/.test(expectedBucket)
  ) {
    reject();
  }
  const canary = statSync(canaryPath);
  if (!canary.isFile() || canary.size < 1 || canary.size > 1024) reject();

  const payload = jsonFile(responsePath);
  const session = sessionIdentity(sessionPath);
  const data = object(payload.data);
  const upload = object(data.upload);
  const headers = object(upload.headers);
  const uploadUrl = validateStorageUrl(
    String(upload.url ?? ""),
    expectedEndpoint,
    expectedBucket,
    `incoming/tenants/${session.organizationId}/assets/${expectedId}/incoming.txt`,
  );
  const metadataAssetIds = [...uploadUrl.searchParams.entries()]
    .filter(([name]) => name.toLowerCase() === "x-amz-meta-asset-id")
    .map(([, value]) => value);
  const metadataOrganizationIds = [...uploadUrl.searchParams.entries()]
    .filter(([name]) => name.toLowerCase() === "x-amz-meta-organization-id")
    .map(([, value]) => value);
  const headerNames = Object.keys(headers).sort();
  if (
    data.id !== expectedId ||
    data.purpose !== "community" ||
    data.status !== "pending" ||
    data.originalFileName !== "q-academy-storage-drill.txt" ||
    data.declaredMimeType !== "text/plain" ||
    data.declaredSizeBytes !== canary.size ||
    data.statusUrl !== `/api/media-assets/${expectedId}` ||
    data.completeUrl !== `/api/media-assets/${expectedId}/complete` ||
    upload.transport !== "s3" ||
    upload.method !== "PUT" ||
    !Number.isSafeInteger(upload.expiresInSeconds) ||
    upload.expiresInSeconds < 60 ||
    upload.expiresInSeconds > 3600 ||
    metadataAssetIds.length !== 1 ||
    metadataAssetIds[0] !== expectedId ||
    metadataOrganizationIds.length !== 1 ||
    metadataOrganizationIds[0] !== session.organizationId ||
    headerNames.join("|") !==
      "Content-Length|Content-Type|If-None-Match" ||
    headers["Content-Length"] !== String(canary.size) ||
    headers["Content-Type"] !== "text/plain" ||
    headers["If-None-Match"] !== "*"
  ) {
    reject();
  }

  const config = [
    "silent",
    "show-error",
    "request = \"PUT\"",
    `url = ${curlQuote(uploadUrl.href)}`,
    `upload-file = ${curlQuote(canaryPath)}`,
    `header = ${curlQuote(`Content-Length: ${canary.size}`)}`,
    'header = "Content-Type: text/plain"',
    'header = "If-None-Match: *"',
    'proto = "=https"',
    'noproxy = "*"',
    "tlsv1.2",
    "connect-timeout = 10",
    "max-time = 60",
    'output = "/dev/null"',
    'write-out = "%{http_code}"',
    "",
  ].join("\n");
  writeFileSync(configPath, config, { encoding: "utf8", flag: "wx", mode: 0o600 });
}

function writeDownloadConfig(
  headersPath,
  sessionPath,
  expectedId,
  configPath,
  outputPath,
  expectedEndpoint,
  expectedBucket,
) {
  if (
    !isAbsolute(headersPath) ||
    !uuidPattern.test(expectedId) ||
    !isAbsolute(configPath) ||
    !isAbsolute(outputPath) ||
    new Set([headersPath, configPath, outputPath]).size !== 3 ||
    expectedBucket.length > 63 ||
    !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(expectedBucket) ||
    expectedBucket.includes("..") ||
    /^\d{1,3}(?:\.\d{1,3}){3}$/.test(expectedBucket)
  ) {
    reject();
  }
  const headersStat = statSync(headersPath);
  const session = sessionIdentity(sessionPath);
  const outputStat = statSync(outputPath);
  if (
    !headersStat.isFile() ||
    headersStat.size < 1 ||
    headersStat.size > 65_536 ||
    !outputStat.isFile() ||
    outputStat.size !== 0
  ) {
    reject();
  }
  const rawHeaders = readFileSync(headersPath, "utf8");
  if (/[^\u0009\u000a\u000d\u0020-\u007e]/.test(rawHeaders)) reject();
  const lines = rawHeaders.split(/\r?\n/);
  const statuses = lines
    .map((line) => line.match(/^HTTP\/(?:1\.[01]|2|3)\s+([0-9]{3})(?:\s|$)/i))
    .filter(Boolean);
  const locations = lines
    .filter((line) => /^location\s*:/i.test(line))
    .map((line) => line.slice(line.indexOf(":") + 1).trim());
  if (
    statuses.length !== 1 ||
    statuses[0][1] !== "307" ||
    locations.length !== 1 ||
    !locations[0]
  ) {
    reject();
  }
  const downloadUrl = validateStorageUrl(
    locations[0],
    expectedEndpoint,
    expectedBucket,
    `tenants/${session.organizationId}/assets/${expectedId}/ready.txt`,
  );
  const config = [
    "silent",
    "show-error",
    'request = "GET"',
    `url = ${curlQuote(downloadUrl.href)}`,
    `output = ${curlQuote(outputPath)}`,
    'proto = "=https"',
    'noproxy = "*"',
    "tlsv1.2",
    "connect-timeout = 10",
    "max-time = 90",
    'write-out = "%{http_code}"',
    "",
  ].join("\n");
  writeFileSync(configPath, config, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
}

function validateAsset(path, expectedId, expectedStatus) {
  const allowedStatuses = new Set([
    "pending",
    "uploaded",
    "scanning",
    "ready",
    "quarantined",
    "failed",
    "deleted",
  ]);
  if (!uuidPattern.test(expectedId) || !allowedStatuses.has(expectedStatus)) {
    reject();
  }
  const payload = jsonFile(path);
  const data = object(payload.data);
  if (data.id !== expectedId || data.status !== expectedStatus) reject();
}

function readAssetStatus(path, expectedId) {
  if (!uuidPattern.test(expectedId)) reject();
  const payload = jsonFile(path);
  const data = object(payload.data);
  const allowedStatuses = new Set([
    "pending",
    "uploaded",
    "scanning",
    "ready",
    "quarantined",
    "failed",
    "deleted",
  ]);
  if (data.id !== expectedId || !allowedStatuses.has(data.status)) reject();
  process.stdout.write(data.status);
}

function validateRetryAsset(path, expectedId) {
  if (!uuidPattern.test(expectedId)) reject();
  const payload = jsonFile(path);
  const data = object(payload.data);
  if (
    data.id !== expectedId ||
    data.status !== "uploaded" ||
    data.scanAttempt !== 1 ||
    data.scanFailureCode !== "storage_unavailable"
  ) {
    reject();
  }
}

function validateDispatch(path, expectedResult) {
  if (!new Set(["retrying", "ready"]).has(expectedResult)) reject();
  const payload = jsonFile(path);
  const data = object(payload.data);
  const backlog = object(data.backlog);
  const processingBacklog = object(data.processingBacklog);
  const expectedBacklogDepth = expectedResult === "retrying" ? 1 : 0;
  if (
    !Array.isArray(data.scans) ||
    data.scans.length !== 1 ||
    data.scans[0] !== expectedResult ||
    !Array.isArray(data.processing) ||
    data.processing.length !== 0 ||
    data.processed !== 1 ||
    backlog.depth !== expectedBacklogDepth ||
    backlog.failed !== 0 ||
    processingBacklog.depth !== 0 ||
    processingBacklog.failed !== 0
  ) {
    reject();
  }
}

function validatePreflight(path) {
  if (!isAbsolute(path)) reject();
  const records = readFileSync(path, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.startsWith("{") && line.endsWith("}"))
    .map((line) => {
      try {
        return object(JSON.parse(line));
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  const result = records.at(-1);
  const clamAv = result ? object(result.clamAv) : null;
  if (
    !result ||
    result.ok !== true ||
    result.cleanup !== "verified" ||
    result.ffmpeg !== true ||
    result.ffprobe !== true ||
    clamAv.cleanCanaryVerified !== true ||
    clamAv.malwareCanaryBlocked !== true
  ) {
    reject();
  }
}

try {
  const [mode, ...arguments_] = process.argv.slice(2);
  if (mode === "validate-session" && arguments_.length === 1) {
    validateSession(arguments_[0]);
  } else if (mode === "write-upload-config" && arguments_.length === 7) {
    writeUploadConfig(...arguments_);
  } else if (mode === "write-download-config" && arguments_.length === 7) {
    writeDownloadConfig(...arguments_);
  } else if (mode === "validate-asset" && arguments_.length === 3) {
    validateAsset(...arguments_);
  } else if (mode === "read-asset-status" && arguments_.length === 2) {
    readAssetStatus(...arguments_);
  } else if (mode === "validate-retry-asset" && arguments_.length === 2) {
    validateRetryAsset(...arguments_);
  } else if (mode === "validate-dispatch" && arguments_.length === 2) {
    validateDispatch(...arguments_);
  } else if (mode === "validate-preflight" && arguments_.length === 1) {
    validatePreflight(arguments_[0]);
  } else {
    reject();
  }
} catch {
  process.stderr.write("Storage drill evidence validation failed.\n");
  process.exitCode = 1;
}
