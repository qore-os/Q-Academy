import { createHash, randomBytes } from "node:crypto";
import { lookup, resolve4, resolve6 } from "node:dns/promises";
import {
  chmod,
  lstat,
  link,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { request as httpsRequest } from "node:https";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  ACTIVE_DAST_IMAGE,
  buildActiveDastDockerArgs,
  DEFAULT_ACTIVE_DAST_BOUNDS,
  type ActiveDastBounds,
  validateActiveDastBounds,
  validateActiveDastConfirmation,
  validatePublicTargetAddresses,
} from "../../src/lib/operations/active-dast";

type Credentials = {
  email: string;
  password: string;
  organizationSlug: string;
};

type CliInput = {
  origin: string;
  confirmOrigin: string;
  project: string;
  confirmProject: string;
  ack: string;
  ownerCredentialsFile: string;
  memberCredentialsFile: string;
  output: string;
  bounds: ActiveDastBounds;
};

type HttpResult = {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
};

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const wrapperPath = join(repositoryRoot, "deploy/security/run-zap-active-container.py");
const maximumResponseBytes = 1_048_576;

function usage() {
  return [
    "Usage: tsx scripts/ops/run-zap-active-authenticated.ts \\",
    "  --origin https://dast-ephemeral-staging.example.com \\",
    "  --confirm-origin https://dast-ephemeral-staging.example.com \\",
    "  --project dast-ephemeral-staging \\",
    "  --confirm-project dast-ephemeral-staging \\",
    "  --ack ACTIVE_DAST_DESTROYS_DISPOSABLE_STAGE \\",
    "  --owner-credentials-file /run/secrets/dast-owner.json \\",
    "  --member-credentials-file /run/secrets/dast-member.json \\",
    "  --output /secure/evidence/zap-active.json",
  ].join("\n");
}

function parsePositiveInteger(name: string, value: string | undefined) {
  if (!value || !/^\d+$/.test(value)) throw new Error(`${name} requires an integer`);
  return Number(value);
}

export function parseActiveDastCli(argv: string[]): CliInput {
  const values = new Map<string, string>();
  const allowed = new Set([
    "origin",
    "confirm-origin",
    "project",
    "confirm-project",
    "ack",
    "owner-credentials-file",
    "member-credentials-file",
    "output",
    "max-runtime-minutes",
    "spider-minutes",
    "browser-spider-minutes",
    "active-scan-minutes",
    "max-requests",
  ]);
  for (let index = 0; index < argv.length; index += 2) {
    const option = argv[index];
    const value = argv[index + 1];
    if (!option?.startsWith("--") || value === undefined || value.startsWith("--")) {
      throw new Error("every option requires one explicit value");
    }
    const name = option.slice(2);
    if (!allowed.has(name) || values.has(name)) throw new Error(`unknown or duplicate option --${name}`);
    values.set(name, value);
  }
  const required = (name: string) => {
    const value = values.get(name);
    if (!value) throw new Error(`missing --${name}`);
    return value;
  };
  const bounds = validateActiveDastBounds({
    maxRuntimeMinutes: values.has("max-runtime-minutes")
      ? parsePositiveInteger("--max-runtime-minutes", values.get("max-runtime-minutes"))
      : DEFAULT_ACTIVE_DAST_BOUNDS.maxRuntimeMinutes,
    spiderMinutes: values.has("spider-minutes")
      ? parsePositiveInteger("--spider-minutes", values.get("spider-minutes"))
      : DEFAULT_ACTIVE_DAST_BOUNDS.spiderMinutes,
    browserSpiderMinutes: values.has("browser-spider-minutes")
      ? parsePositiveInteger("--browser-spider-minutes", values.get("browser-spider-minutes"))
      : DEFAULT_ACTIVE_DAST_BOUNDS.browserSpiderMinutes,
    activeScanMinutes: values.has("active-scan-minutes")
      ? parsePositiveInteger("--active-scan-minutes", values.get("active-scan-minutes"))
      : DEFAULT_ACTIVE_DAST_BOUNDS.activeScanMinutes,
    maxRequests: values.has("max-requests")
      ? parsePositiveInteger("--max-requests", values.get("max-requests"))
      : DEFAULT_ACTIVE_DAST_BOUNDS.maxRequests,
  });
  return {
    origin: required("origin"),
    confirmOrigin: required("confirm-origin"),
    project: required("project"),
    confirmProject: required("confirm-project"),
    ack: required("ack"),
    ownerCredentialsFile: required("owner-credentials-file"),
    memberCredentialsFile: required("member-credentials-file"),
    output: required("output"),
    bounds,
  };
}

async function withTimeout<T>(promise: Promise<T>, milliseconds: number, reason: string) {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(reason)), milliseconds);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function resolveTarget(hostname: string) {
  const results = await withTimeout(
    Promise.allSettled([resolve4(hostname), resolve6(hostname), lookup(hostname, { all: true, verbatim: true })]),
    10_000,
    "target DNS lookup timed out",
  );
  const addresses: string[] = [];
  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    for (const value of result.value) {
      addresses.push(typeof value === "string" ? value : value.address);
    }
  }
  return validatePublicTargetAddresses(addresses);
}

async function readCredentialFile(pathInput: string, project: string, currentUid: number) {
  const path = resolve(pathInput);
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1) {
    throw new Error("credential input must be a regular, non-linked file");
  }
  if (metadata.uid !== currentUid || (metadata.mode & 0o777) !== 0o400) {
    throw new Error("credential input must be owned by the invoking UID with mode 0400");
  }
  if (metadata.size < 1 || metadata.size > 4_096 || (await realpath(path)) !== path) {
    throw new Error("credential input path or size is invalid");
  }
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path, "utf8"));
  } catch {
    throw new Error("credential input is not valid JSON");
  }
  const record = value as Record<string, unknown>;
  if (
    !record ||
    typeof record !== "object" ||
    Array.isArray(record) ||
    Object.keys(record).sort().join(",") !== "email,organizationSlug,password" ||
    typeof record.email !== "string" ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(record.email) ||
    record.email.length > 254 ||
    typeof record.password !== "string" ||
    record.password.length < 16 ||
    record.password.length > 512 ||
    /[\u0000-\u001f]/.test(record.password) ||
    record.organizationSlug !== project
  ) {
    throw new Error("credential input does not satisfy the strict schema");
  }
  return { path, credentials: record as Credentials };
}

function collectCookies(headers: Record<string, string | string[] | undefined>) {
  const values = headers["set-cookie"];
  const cookies = (Array.isArray(values) ? values : values ? [values] : [])
    .map((value) => value.split(";", 1)[0]?.trim())
    .filter((value): value is string => Boolean(value && value.includes("=")));
  if (cookies.length === 0) throw new Error("login did not issue a session cookie");
  return cookies.join("; ");
}

async function targetRequest(input: {
  hostname: string;
  pinnedIpv4: string;
  method: "GET" | "POST" | "DELETE";
  path: string;
  origin: string;
  body?: unknown;
  cookie?: string;
}): Promise<HttpResult> {
  const body = input.body === undefined ? undefined : JSON.stringify(input.body);
  return await withTimeout(
    new Promise<HttpResult>((resolveRequest, rejectRequest) => {
      const request = httpsRequest(
        {
          protocol: "https:",
          hostname: input.hostname,
          servername: input.hostname,
          port: 443,
          path: input.path,
          method: input.method,
          rejectUnauthorized: true,
          lookup: (_hostname, _options, callback) => callback(null, input.pinnedIpv4, 4),
          headers: {
            Accept: "application/json",
            "User-Agent": "q-academy-active-dast-control/1",
            ...(body ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } : {}),
            ...(input.cookie ? { Cookie: input.cookie } : {}),
            ...(input.method === "POST" || input.method === "DELETE" ? { Origin: input.origin } : {}),
          },
        },
        (response) => {
          const chunks: Buffer[] = [];
          let length = 0;
          response.on("data", (chunk: Buffer) => {
            length += chunk.length;
            if (length > maximumResponseBytes) request.destroy(new Error("target response exceeded size bound"));
            else chunks.push(chunk);
          });
          response.on("end", () => {
            try {
              const raw = Buffer.concat(chunks).toString("utf8");
              resolveRequest({
                status: response.statusCode ?? 0,
                headers: response.headers,
                body: raw ? JSON.parse(raw) : null,
              });
            } catch {
              rejectRequest(new Error("target returned invalid JSON"));
            }
          });
        },
      );
      request.setTimeout(15_000, () => request.destroy(new Error("target request timed out")));
      request.on("error", rejectRequest);
      if (body) request.write(body);
      request.end();
    }),
    20_000,
    "target request timed out",
  );
}

function dataOf(value: unknown) {
  if (!value || typeof value !== "object" || !("data" in value)) throw new Error("target response envelope invalid");
  return (value as { data: unknown }).data;
}

async function cleanIdentity(input: {
  origin: string;
  hostname: string;
  pinnedIpv4: string;
  credentials: Credentials;
  expectedRole: "owner" | "member";
}) {
  const common = {
    hostname: input.hostname,
    pinnedIpv4: input.pinnedIpv4,
    origin: input.origin,
  };
  const login = await targetRequest({
    ...common,
    method: "POST",
    path: "/api/v1/auth/login",
    body: input.credentials,
  });
  if (login.status !== 200) throw new Error(`control login failed with status ${login.status}`);
  const loginData = dataOf(login.body) as { user?: { role?: unknown } };
  if (loginData.user?.role !== input.expectedRole) throw new Error("control login returned the wrong role");
  const cookie = collectCookies(login.headers);
  const me = await targetRequest({ ...common, method: "GET", path: "/api/v1/me", cookie });
  const meData = dataOf(me.body) as { role?: unknown; sessionId?: unknown };
  if (me.status !== 200 || meData.role !== input.expectedRole || typeof meData.sessionId !== "string") {
    throw new Error("authenticated role verification failed");
  }
  const sessionsResponse = await targetRequest({
    ...common,
    method: "GET",
    path: "/api/v1/me/sessions",
    cookie,
  });
  const sessions = dataOf(sessionsResponse.body);
  if (sessionsResponse.status !== 200 || !Array.isArray(sessions) || sessions.length > 250) {
    throw new Error("session cleanup inventory is invalid or exceeds its bound");
  }
  const typedSessions = sessions.filter(
    (session): session is { id: string; current: boolean } =>
      Boolean(
        session &&
          typeof session === "object" &&
          "id" in session &&
          typeof session.id === "string" &&
          /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(session.id) &&
          "current" in session &&
          typeof session.current === "boolean",
      ),
  );
  const currentSessions = typedSessions.filter((session) => session.current);
  if (typedSessions.length !== sessions.length || currentSessions.length !== 1 || currentSessions[0]?.id !== meData.sessionId) {
    throw new Error("session cleanup inventory violates the session contract");
  }
  const otherIds = typedSessions.filter((session) => !session.current).map((session) => session.id);
  for (const id of otherIds) {
    if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id)) throw new Error("session inventory contains an invalid ID");
    const revoked = await targetRequest({
      ...common,
      method: "DELETE",
      path: `/api/v1/me/sessions/${id}`,
      cookie,
    });
    if (revoked.status !== 200 || (dataOf(revoked.body) as { revoked?: unknown }).revoked !== true) {
      throw new Error("session revocation failed");
    }
  }
  const remainingResponse = await targetRequest({
    ...common,
    method: "GET",
    path: "/api/v1/me/sessions",
    cookie,
  });
  const remaining = dataOf(remainingResponse.body);
  if (
    remainingResponse.status !== 200 ||
    !Array.isArray(remaining) ||
    remaining.length !== 1 ||
    !(remaining[0] as { current?: unknown })?.current ||
    (remaining[0] as { id?: unknown }).id !== meData.sessionId
  ) {
    throw new Error("session cleanup could not prove a single current session");
  }
  const logout = await targetRequest({
    ...common,
    method: "POST",
    path: "/api/v1/auth/logout",
    body: {},
    cookie,
  });
  if (logout.status !== 200 || (dataOf(logout.body) as { loggedOut?: unknown }).loggedOut !== true) {
    throw new Error("control logout failed");
  }
  const anonymous = await targetRequest({ ...common, method: "GET", path: "/api/v1/me", cookie });
  const problem = anonymous.body as { code?: unknown };
  if (anonymous.status !== 401 || problem?.code !== "authentication_required") {
    throw new Error("logout verification did not return authentication_required");
  }
  return { role: input.expectedRole, revokedSessions: otherIds.length, loginVerified: true, logoutVerified: true };
}

async function cleanIdentityWithRetry(input: Parameters<typeof cleanIdentity>[0]) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await cleanIdentity(input);
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolveDelay) => setTimeout(resolveDelay, attempt * 1_000));
    }
  }
  throw lastError;
}

async function runDockerIgnored(args: string[]) {
  return await new Promise<number>((resolveProcess) => {
    const child = spawn("docker", args, { stdio: "ignore", shell: false });
    child.once("error", () => resolveProcess(127));
    child.once("close", (code) => resolveProcess(code ?? 1));
  });
}

async function runDockerScan(args: string[], containerName: string, runtimeMilliseconds: number) {
  let timedOut = false;
  let interrupted = false;
  let removing: Promise<number> | undefined;
  const removeContainer = () => {
    removing ??= runDockerIgnored(["rm", "--force", containerName]);
    return removing;
  };
  const child = spawn("docker", args, { stdio: "ignore", shell: false });
  const stop = () => {
    interrupted = true;
    void removeContainer();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  const timer = setTimeout(() => {
    timedOut = true;
    void removeContainer();
  }, runtimeMilliseconds);
  try {
    const code = await new Promise<number>((resolveProcess, rejectProcess) => {
      child.once("error", rejectProcess);
      child.once("close", (exitCode) => resolveProcess(exitCode ?? 1));
    });
    return { code, timedOut, interrupted };
  } finally {
    clearTimeout(timer);
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
    removing = undefined;
    await removeContainer();
  }
}

function validateScannerEvidence(value: unknown, secrets: readonly string[]) {
  const serialized = JSON.stringify(value);
  if (secrets.some((secret) => serialized.includes(secret))) {
    throw new Error("scanner evidence contained credential material");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("scanner evidence must be an object");
  }
  const record = value as Record<string, unknown>;
  const commonKeys = new Set(["schemaVersion", "contractValid", "reasonCode"]);
  if (
    record.schemaVersion !== 1 ||
    typeof record.contractValid !== "boolean" ||
    typeof record.reasonCode !== "string" ||
    !/^[a-z0-9_]{1,80}$/.test(record.reasonCode)
  ) {
    throw new Error("scanner evidence common contract is invalid");
  }
  if (!record.contractValid) {
    if (Object.keys(record).some((key) => !commonKeys.has(key))) {
      throw new Error("failed scanner evidence contains non-contract fields");
    }
    return record;
  }
  const successKeys = new Set([
    ...commonKeys,
    "zapExitCode",
    "requestsSucceeded",
    "requestsFailed",
    "requestsAttempted",
    "maxRequests",
    "openApiOperationCount",
    "riskCounts",
    "alerts",
  ]);
  if (
    Object.keys(record).some((key) => !successKeys.has(key)) ||
    !Number.isSafeInteger(record.zapExitCode) ||
    !Number.isSafeInteger(record.requestsSucceeded) ||
    !Number.isSafeInteger(record.requestsFailed) ||
    !Number.isSafeInteger(record.requestsAttempted) ||
    !Number.isSafeInteger(record.maxRequests) ||
    !Number.isSafeInteger(record.openApiOperationCount) ||
    !record.riskCounts ||
    typeof record.riskCounts !== "object" ||
    Array.isArray(record.riskCounts) ||
    !Array.isArray(record.alerts) ||
    record.alerts.length > 5_000
  ) {
    throw new Error("successful scanner evidence contract is invalid");
  }
  if (
    (record.requestsSucceeded as number) < 0 ||
    (record.requestsFailed as number) < 0 ||
    record.requestsAttempted !== (record.requestsSucceeded as number) + (record.requestsFailed as number)
  ) {
    throw new Error("scanner request counters violate the public contract");
  }
  if (record.reasonCode !== "completed") throw new Error("successful scanner evidence reason is invalid");
  const riskCounts = record.riskCounts as Record<string, unknown>;
  const riskNames = ["High", "Informational", "Low", "Medium", "Unknown"];
  if (
    Object.keys(riskCounts).sort().join(",") !== riskNames.join(",") ||
    riskNames.some((risk) => !Number.isSafeInteger(riskCounts[risk]) || (riskCounts[risk] as number) < 0)
  ) {
    throw new Error("scanner risk counts violate the public whitelist");
  }
  const alertKeys = ["alertRef", "confidence", "count", "cweId", "name", "pluginId", "risk", "wascId"];
  for (const alert of record.alerts) {
    if (!alert || typeof alert !== "object" || Array.isArray(alert)) throw new Error("scanner alert is invalid");
    const item = alert as Record<string, unknown>;
    if (
      Object.keys(item).sort().join(",") !== alertKeys.join(",") ||
      !Number.isSafeInteger(item.count) ||
      (item.count as number) < 1 ||
      ["alertRef", "confidence", "cweId", "name", "pluginId", "risk", "wascId"].some(
        (key) => typeof item[key] !== "string" || (item[key] as string).length > 200,
      )
    ) {
      throw new Error("scanner alert violates the public whitelist");
    }
  }
  return record;
}

async function writeEvidenceExclusive(output: string, payload: unknown) {
  const outputPath = resolve(output);
  if (!outputPath.endsWith(".json")) throw new Error("output must be a JSON file");
  await mkdir(dirname(outputPath), { recursive: true, mode: 0o700 });
  try {
    await lstat(outputPath);
    throw new Error("output already exists; evidence is immutable");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const temporary = join(dirname(outputPath), `.active-dast-${randomBytes(12).toString("hex")}.tmp`);
  await writeFile(temporary, `${JSON.stringify(payload, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  try {
    await link(temporary, outputPath);
    await chmod(outputPath, 0o600);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
  return outputPath;
}

async function main() {
  if (process.platform !== "linux" || !process.getuid || !process.getgid) {
    throw new Error("active authenticated DAST must run on Linux");
  }
  const cli = parseActiveDastCli(process.argv.slice(2));
  const target = validateActiveDastConfirmation(cli);
  const uid = process.getuid();
  const gid = process.getgid();
  const output = resolve(cli.output);
  try {
    await lstat(output);
    throw new Error("output already exists; evidence is immutable");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const [resolvedTarget, ownerInput, memberInput, wrapperMetadata] = await Promise.all([
    resolveTarget(target.hostname),
    readCredentialFile(cli.ownerCredentialsFile, target.project, uid),
    readCredentialFile(cli.memberCredentialsFile, target.project, uid),
    lstat(wrapperPath),
  ]);
  if (!wrapperMetadata.isFile()) throw new Error("scanner wrapper is missing");
  if (ownerInput.path === memberInput.path || ownerInput.credentials.email.toLowerCase() === memberInput.credentials.email.toLowerCase()) {
    throw new Error("owner and member credentials must be distinct");
  }
  if ((await runDockerIgnored(["version", "--format", "{{.Server.Version}}"])) !== 0) {
    throw new Error("Docker is unavailable");
  }

  const identityInput = (credentials: Credentials, expectedRole: "owner" | "member") => ({
    ...target,
    pinnedIpv4: resolvedTarget.pinnedIpv4,
    credentials,
    expectedRole,
  });
  const startedAt = new Date();
  const containerName = `q-academy-zap-active-${randomBytes(8).toString("hex")}`;
  const temporaryEvidenceDirectory = await mkdtemp(join(tmpdir(), "q-academy-active-dast-"));
  await chmod(temporaryEvidenceDirectory, 0o700);
  const safeTmpRoot = resolve(tmpdir()) + sep;
  if (!resolve(temporaryEvidenceDirectory).startsWith(safeTmpRoot)) throw new Error("unsafe temporary directory");

  let preflight: unknown = null;
  let scanner: unknown = null;
  let dockerResult: { code: number; timedOut: boolean; interrupted: boolean } | null = null;
  let scannerFailure = false;
  const postCleanup: Array<Record<string, unknown>> = [];
  try {
    preflight = {
      owner: await cleanIdentityWithRetry(identityInput(ownerInput.credentials, "owner")),
      member: await cleanIdentityWithRetry(identityInput(memberInput.credentials, "member")),
    };
    const dockerArgs = buildActiveDastDockerArgs({
      ...target,
      containerName,
      uid,
      gid,
      pinnedIpv4: resolvedTarget.pinnedIpv4,
      ownerCredentialsPath: ownerInput.path,
      memberCredentialsPath: memberInput.path,
      wrapperPath,
      evidenceDirectory: temporaryEvidenceDirectory,
      bounds: cli.bounds,
    });
    dockerResult = await runDockerScan(dockerArgs, containerName, cli.bounds.maxRuntimeMinutes * 60_000);
    try {
      const scannerRaw = await readFile(join(temporaryEvidenceDirectory, "scanner-result.json"), "utf8");
      if (scannerRaw.length > 1_048_576) throw new Error("scanner evidence exceeded its size bound");
      scanner = validateScannerEvidence(JSON.parse(scannerRaw), [
        ownerInput.credentials.email,
        ownerInput.credentials.password,
        memberInput.credentials.email,
        memberInput.credentials.password,
      ]);
    } catch {
      scanner = { schemaVersion: 1, contractValid: false, reasonCode: "scanner_evidence_missing_or_invalid" };
      scannerFailure = true;
    }
  } catch {
    scannerFailure = true;
    scanner = { schemaVersion: 1, contractValid: false, reasonCode: "preflight_or_scanner_failed" };
  } finally {
    await runDockerIgnored(["rm", "--force", containerName]);
    for (const [role, credentials] of [
      ["owner", ownerInput.credentials],
      ["member", memberInput.credentials],
    ] as const) {
      try {
        postCleanup.push(await cleanIdentityWithRetry(identityInput(credentials, role)));
      } catch {
        postCleanup.push({ role, loginVerified: false, logoutVerified: false, cleanupFailed: true });
      }
    }
  }

  const scannerRecord = scanner as {
    contractValid?: unknown;
    zapExitCode?: unknown;
    requestsAttempted?: unknown;
    maxRequests?: unknown;
    riskCounts?: Record<string, number>;
  };
  const cleanupPassed = postCleanup.every((entry) => entry.loginVerified === true && entry.logoutVerified === true);
  const passed =
    !scannerFailure &&
    dockerResult?.code === 0 &&
    !dockerResult.timedOut &&
    !dockerResult.interrupted &&
    scannerRecord.contractValid === true &&
    scannerRecord.zapExitCode === 0 &&
    scannerRecord.maxRequests === cli.bounds.maxRequests &&
    typeof scannerRecord.requestsAttempted === "number" &&
    scannerRecord.requestsAttempted <= cli.bounds.maxRequests &&
    scannerRecord.riskCounts?.High === 0 &&
    scannerRecord.riskCounts?.Medium === 0 &&
    scannerRecord.riskCounts?.Low === 0 &&
    scannerRecord.riskCounts?.Unknown === 0 &&
    cleanupPassed;
  await rm(temporaryEvidenceDirectory, { recursive: true, force: true });
  const evidence = {
    schemaVersion: 1,
    mode: "authenticated-active-dast",
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    origin: target.origin,
    project: target.project,
    image: ACTIVE_DAST_IMAGE,
    dnsBindingSha256: createHash("sha256").update(resolvedTarget.pinnedIpv4).digest("hex"),
    bounds: cli.bounds,
    confirmations: { origin: true, project: true, destructiveAcknowledgement: true },
    preflight,
    scanner,
    runtime: {
      containerExitCode: dockerResult?.code ?? null,
      timedOut: dockerResult?.timedOut ?? false,
      interrupted: dockerResult?.interrupted ?? false,
    },
    cleanup: postCleanup,
    evaluation: { passed },
  };
  const outputPath = await writeEvidenceExclusive(output, evidence);
  process.stdout.write(`${passed ? "PASS" : "FAIL"} ${outputPath}\n`);
  process.exitCode = passed ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "unknown failure";
    process.stderr.write(`Active DAST refused: ${message}\n${usage()}\n`);
    process.exitCode = 1;
  });
}
