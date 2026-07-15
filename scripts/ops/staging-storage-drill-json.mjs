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

function validateStorageBucketUrl(rawUrl, expectedEndpoint, expectedBucket) {
  const endpoint = new URL(expectedEndpoint);
  const url = new URL(rawUrl);
  const canonicalEndpoint = `https://${endpoint.hostname}`;
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
    url.hostname !== endpoint.hostname ||
    url.pathname !== `/${expectedBucket}` ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    reject();
  }
  return url;
}

function storageCompatibilityMode(value) {
  if (value !== "versioned" && value !== "strato-hidrive") reject();
  return value;
}

function exactStringFields(value, expectedNames) {
  const fields = object(value);
  const names = Object.keys(fields).sort();
  if (names.join("|") !== [...expectedNames].sort().join("|")) reject();
  for (const name of names) {
    if (
      typeof fields[name] !== "string" ||
      /[^\u0020-\u007e]/.test(fields[name])
    ) {
      reject();
    }
  }
  return fields;
}

function validateStratoPolicy(fields, input) {
  const credential = fields["x-amz-credential"].match(
    /^([A-Za-z0-9][A-Za-z0-9_-]{1,127})\/([0-9]{8})\/([a-z0-9][a-z0-9-]{0,62})\/s3\/aws4_request$/,
  );
  if (
    !credential ||
    fields["x-amz-algorithm"] !== "AWS4-HMAC-SHA256" ||
    !/^\d{8}T\d{6}Z$/.test(fields["x-amz-date"]) ||
    fields["x-amz-date"].slice(0, 8) !== credential[2] ||
    !/^[a-f0-9]{64}$/.test(fields["x-amz-signature"]) ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(fields.policy)
  ) {
    reject();
  }
  const policyBytes = Buffer.from(fields.policy, "base64");
  if (policyBytes.toString("base64") !== fields.policy) reject();
  const policy = object(JSON.parse(policyBytes.toString("utf8")));
  if (Object.keys(policy).sort().join("|") !== "conditions|expiration") {
    reject();
  }
  if (!Array.isArray(policy.conditions) || typeof policy.expiration !== "string") {
    reject();
  }
  const timestamp = fields["x-amz-date"];
  const issuedAt = Date.UTC(
    Number(timestamp.slice(0, 4)),
    Number(timestamp.slice(4, 6)) - 1,
    Number(timestamp.slice(6, 8)),
    Number(timestamp.slice(9, 11)),
    Number(timestamp.slice(11, 13)),
    Number(timestamp.slice(13, 15)),
  );
  const expiresAt = Date.parse(policy.expiration);
  const lifetimeSeconds = Math.floor((expiresAt - issuedAt) / 1_000);
  if (
    !Number.isFinite(issuedAt) ||
    !Number.isFinite(expiresAt) ||
    new Date(issuedAt).toISOString().replace(/[:-]|\.000/g, "") !== timestamp ||
    new Date(expiresAt).toISOString() !== policy.expiration ||
    lifetimeSeconds !== input.expiresInSeconds
  ) {
    reject();
  }
  const expectedConditions = [
    { bucket: input.bucket },
    ["eq", "$key", input.key],
    ["content-length-range", input.sizeBytes, input.sizeBytes],
    ["eq", "$Content-Type", "text/plain"],
    ["eq", "$x-amz-meta-asset-id", input.assetId],
    ["eq", "$x-amz-meta-organization-id", input.organizationId],
    { "x-amz-algorithm": "AWS4-HMAC-SHA256" },
    { "x-amz-credential": fields["x-amz-credential"] },
    { "x-amz-date": fields["x-amz-date"] },
    { success_action_status: "201" },
  ];
  if (JSON.stringify(policy.conditions) !== JSON.stringify(expectedConditions)) {
    reject();
  }
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
  rawCompatibilityMode,
) {
  const compatibilityMode = storageCompatibilityMode(rawCompatibilityMode);
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
  const expectedKey =
    `incoming/tenants/${session.organizationId}/assets/${expectedId}/incoming.txt`;
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
    !Number.isSafeInteger(upload.expiresInSeconds) ||
    upload.expiresInSeconds < 60 ||
    upload.expiresInSeconds > 3600
  ) {
    reject();
  }

  let configLines;
  if (compatibilityMode === "versioned") {
    const headers = exactStringFields(upload.headers, [
      "Content-Length",
      "Content-Type",
      "If-None-Match",
    ]);
    if (upload.fields !== undefined || upload.method !== "PUT") reject();
    const uploadUrl = validateStorageUrl(
      String(upload.url ?? ""),
      expectedEndpoint,
      expectedBucket,
      expectedKey,
    );
    const metadataAssetIds = [...uploadUrl.searchParams.entries()]
      .filter(([name]) => name.toLowerCase() === "x-amz-meta-asset-id")
      .map(([, value]) => value);
    const metadataOrganizationIds = [...uploadUrl.searchParams.entries()]
      .filter(([name]) => name.toLowerCase() === "x-amz-meta-organization-id")
      .map(([, value]) => value);
    if (
      metadataAssetIds.length !== 1 ||
      metadataAssetIds[0] !== expectedId ||
      metadataOrganizationIds.length !== 1 ||
      metadataOrganizationIds[0] !== session.organizationId ||
      headers["Content-Length"] !== String(canary.size) ||
      headers["Content-Type"] !== "text/plain" ||
      headers["If-None-Match"] !== "*"
    ) {
      reject();
    }
    configLines = [
      "silent",
      "show-error",
      'request = "PUT"',
      `url = ${curlQuote(uploadUrl.href)}`,
      `upload-file = ${curlQuote(canaryPath)}`,
      `header = ${curlQuote(`Content-Length: ${canary.size}`)}`,
      'header = "Content-Type: text/plain"',
      'header = "If-None-Match: *"',
    ];
  } else {
    if (
      upload.headers !== undefined ||
      upload.method !== "POST" ||
      /;/.test(canaryPath)
    ) {
      reject();
    }
    const uploadUrl = validateStorageBucketUrl(
      String(upload.url ?? ""),
      expectedEndpoint,
      expectedBucket,
    );
    const fieldNames = [
      "Content-Type",
      "key",
      "policy",
      "success_action_status",
      "x-amz-algorithm",
      "x-amz-credential",
      "x-amz-date",
      "x-amz-meta-asset-id",
      "x-amz-meta-organization-id",
      "x-amz-signature",
    ];
    const fields = exactStringFields(upload.fields, fieldNames);
    if (
      fields.key !== expectedKey ||
      fields["Content-Type"] !== "text/plain" ||
      fields.success_action_status !== "201" ||
      fields["x-amz-meta-asset-id"] !== expectedId ||
      fields["x-amz-meta-organization-id"] !== session.organizationId
    ) {
      reject();
    }
    validateStratoPolicy(fields, {
      assetId: expectedId,
      organizationId: session.organizationId,
      bucket: expectedBucket,
      key: expectedKey,
      sizeBytes: canary.size,
      expiresInSeconds: upload.expiresInSeconds,
    });
    configLines = [
      "silent",
      "show-error",
      'request = "POST"',
      `url = ${curlQuote(uploadUrl.href)}`,
      ...fieldNames
        .sort()
        .map((name) => `form-string = ${curlQuote(`${name}=${fields[name]}`)}`),
      `form = ${curlQuote(`file=@${canaryPath};type=text/plain`)}`,
    ];
  }
  const config = [
    ...configLines,
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
  rawCompatibilityMode,
) {
  if (storageCompatibilityMode(rawCompatibilityMode) !== "versioned") reject();
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

function responseHeaders(path) {
  if (!isAbsolute(path)) reject();
  const headersStat = statSync(path);
  if (!headersStat.isFile() || headersStat.size < 1 || headersStat.size > 65_536) {
    reject();
  }
  const rawHeaders = readFileSync(path, "utf8");
  if (/[^\u0009\u000a\u000d\u0020-\u007e]/.test(rawHeaders)) reject();
  const lines = rawHeaders.split(/\r?\n/);
  const statuses = lines
    .map((line) => line.match(/^HTTP\/(?:1\.[01]|2|3)\s+([0-9]{3})(?:\s|$)/i))
    .filter(Boolean);
  if (statuses.length !== 1) reject();
  const headers = new Map();
  for (const line of lines) {
    if (!line || /^HTTP\//i.test(line)) continue;
    const separator = line.indexOf(":");
    if (separator <= 0 || /^[ \t]/.test(line)) reject();
    const name = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (!/^[a-z0-9-]+$/.test(name) || !value) reject();
    const values = headers.get(name) ?? [];
    values.push(value);
    headers.set(name, values);
  }
  return { status: statuses[0][1], headers };
}

function exactHeader(headers, name, expectedValue) {
  const values = headers.get(name);
  if (!values || values.length !== 1 || values[0] !== expectedValue) reject();
}

function validateProxyDownload(
  headersPath,
  outputPath,
  canaryPath,
  responseKind,
  rawCompatibilityMode,
) {
  if (
    storageCompatibilityMode(rawCompatibilityMode) !== "strato-hidrive" ||
    !new Set(["full", "range"]).has(responseKind) ||
    !isAbsolute(outputPath) ||
    !isAbsolute(canaryPath) ||
    new Set([headersPath, outputPath, canaryPath]).size !== 3
  ) {
    reject();
  }
  const output = statSync(outputPath);
  const canary = statSync(canaryPath);
  if (
    !output.isFile() ||
    !canary.isFile() ||
    canary.size < 1 ||
    canary.size > 1024
  ) {
    reject();
  }
  const response = responseHeaders(headersPath);
  const isRange = responseKind === "range";
  if (
    response.status !== (isRange ? "206" : "200") ||
    response.headers.has("location")
  ) {
    reject();
  }
  exactHeader(response.headers, "accept-ranges", "bytes");
  exactHeader(response.headers, "cache-control", "private, no-store");
  exactHeader(
    response.headers,
    "content-disposition",
    'attachment; filename="q-academy-storage-drill.txt"',
  );
  exactHeader(response.headers, "content-length", String(isRange ? 1 : canary.size));
  exactHeader(response.headers, "content-type", "text/plain");
  exactHeader(response.headers, "x-content-type-options", "nosniff");
  if (isRange) {
    exactHeader(response.headers, "content-range", `bytes 0-0/${canary.size}`);
  } else if (response.headers.has("content-range")) {
    reject();
  }
  const actual = readFileSync(outputPath);
  const expected = readFileSync(canaryPath);
  if (!(isRange ? actual.equals(expected.subarray(0, 1)) : actual.equals(expected))) {
    reject();
  }
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
  } else if (mode === "write-upload-config" && arguments_.length === 8) {
    writeUploadConfig(...arguments_);
  } else if (mode === "write-download-config" && arguments_.length === 8) {
    writeDownloadConfig(...arguments_);
  } else if (mode === "validate-proxy-download" && arguments_.length === 5) {
    validateProxyDownload(...arguments_);
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
