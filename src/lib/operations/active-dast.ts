import ipaddr from "ipaddr.js";

export const ACTIVE_DAST_IMAGE =
  "zaproxy/zap-stable:2.17.0@sha256:8d387b1a63e3425beef4846e39719f5af2a787753af2d8b6558c6257d7a577a2";
export const ACTIVE_DAST_ACK = "ACTIVE_DAST_DESTROYS_DISPOSABLE_STAGE";

const stagingMarkers = new Set(["staging", "stage", "qa", "test", "sandbox", "preprod"]);
const isolationMarkers = new Set(["disposable", "isolated", "ephemeral"]);
const productionMarkers = new Set(["prod", "production"]);

export type ActiveDastBounds = {
  maxRuntimeMinutes: number;
  spiderMinutes: number;
  browserSpiderMinutes: number;
  activeScanMinutes: number;
  maxRequests: number;
};

export const DEFAULT_ACTIVE_DAST_BOUNDS: ActiveDastBounds = {
  maxRuntimeMinutes: 90,
  spiderMinutes: 5,
  browserSpiderMinutes: 5,
  activeScanMinutes: 20,
  maxRequests: 5_000,
};

export type ActiveDastConfirmation = {
  origin: string;
  confirmOrigin: string;
  project: string;
  confirmProject: string;
  ack: string;
};

export type ActiveDastTarget = {
  origin: string;
  hostname: string;
  project: string;
};

export type ActiveDastDockerInput = ActiveDastTarget & {
  containerName: string;
  uid: number;
  gid: number;
  pinnedIpv4: string;
  ownerCredentialsPath: string;
  memberCredentialsPath: string;
  wrapperPath: string;
  evidenceDirectory: string;
  bounds: ActiveDastBounds;
};

function markerTokens(value: string) {
  return value.toLowerCase().split(/[.-]/).filter(Boolean);
}

function requireIsolationMarkers(value: string, label: string) {
  const tokens = markerTokens(value);
  if (tokens.some((token) => productionMarkers.has(token))) {
    throw new Error(`${label} contains a production marker`);
  }
  if (!tokens.includes("dast")) {
    throw new Error(`${label} must contain the exact marker 'dast'`);
  }
  if (!tokens.some((token) => stagingMarkers.has(token))) {
    throw new Error(`${label} must contain an explicit staging marker`);
  }
  if (!tokens.some((token) => isolationMarkers.has(token))) {
    throw new Error(`${label} must contain an explicit isolation marker`);
  }
}

export function validateActiveDastBounds(bounds: ActiveDastBounds) {
  const integerBounds: Array<[keyof ActiveDastBounds, number, number]> = [
    ["maxRuntimeMinutes", 10, 120],
    ["spiderMinutes", 1, 10],
    ["browserSpiderMinutes", 1, 10],
    ["activeScanMinutes", 1, 30],
    ["maxRequests", 250, 5_000],
  ];
  for (const [name, minimum, maximum] of integerBounds) {
    const value = bounds[name];
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
      throw new Error(`${name} must be an integer from ${minimum} through ${maximum}`);
    }
  }
  const plannedMinutes =
    2 * (bounds.spiderMinutes + bounds.browserSpiderMinutes + bounds.activeScanMinutes) + 5;
  if (plannedMinutes > bounds.maxRuntimeMinutes) {
    throw new Error("maxRuntimeMinutes is smaller than the bounded scan plan");
  }
  return bounds;
}

export function validateActiveDastConfirmation(
  confirmation: ActiveDastConfirmation,
): ActiveDastTarget {
  if (confirmation.origin !== confirmation.confirmOrigin) {
    throw new Error("origin confirmation does not match exactly");
  }
  if (confirmation.project !== confirmation.confirmProject) {
    throw new Error("project confirmation does not match exactly");
  }
  if (confirmation.ack !== ACTIVE_DAST_ACK) {
    throw new Error(`acknowledgement must equal ${ACTIVE_DAST_ACK}`);
  }
  if (!/^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/.test(confirmation.project)) {
    throw new Error("project must be a lowercase DNS-style slug");
  }
  requireIsolationMarkers(confirmation.project, "project");

  let target: URL;
  try {
    target = new URL(confirmation.origin);
  } catch {
    throw new Error("origin must be an absolute URL");
  }
  if (target.protocol !== "https:") throw new Error("origin must use HTTPS");
  if (target.username || target.password) throw new Error("origin must not contain credentials");
  if (target.port && target.port !== "443") throw new Error("origin must use port 443");
  if (target.pathname !== "/" || target.search || target.hash) {
    throw new Error("origin must not contain a path, query, or fragment");
  }
  if (confirmation.origin !== target.origin) {
    throw new Error("origin must be canonical and must not have a trailing slash");
  }
  if (target.hostname === "localhost" || target.hostname.endsWith(".localhost")) {
    throw new Error("localhost targets are forbidden");
  }
  if (ipaddr.isValid(target.hostname)) throw new Error("IP-literal targets are forbidden");
  if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(target.hostname)) {
    throw new Error("origin hostname must be a valid public DNS name");
  }
  requireIsolationMarkers(target.hostname, "origin hostname");
  return { origin: target.origin, hostname: target.hostname, project: confirmation.project };
}

export function validatePublicTargetAddresses(addresses: readonly string[]) {
  if (addresses.length === 0) throw new Error("target DNS lookup returned no addresses");
  const normalized = addresses.map((address) => {
    if (!ipaddr.isValid(address)) throw new Error("target DNS returned an invalid address");
    const parsed = ipaddr.process(address);
    if (parsed.range() !== "unicast") {
      throw new Error("target DNS returned a private, local, reserved, or non-unicast address");
    }
    return parsed.toString();
  });
  const ipv4 = normalized.find((address) => ipaddr.parse(address).kind() === "ipv4");
  if (!ipv4) throw new Error("target must resolve to at least one public IPv4 address");
  return { addresses: [...new Set(normalized)].sort(), pinnedIpv4: ipv4 };
}

export function buildActiveDastDockerArgs(input: ActiveDastDockerInput) {
  validateActiveDastBounds(input.bounds);
  const mount = (source: string, destination: string, readonly: boolean) =>
    `type=bind,src=${source},dst=${destination}${readonly ? ",readonly" : ""}`;
  return [
    "run",
    "--rm",
    "--name",
    input.containerName,
    "--read-only",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges",
    "--pids-limit=512",
    "--memory=3g",
    "--memory-swap=3g",
    "--cpus=2",
    "--shm-size=256m",
    "--ulimit",
    "nofile=4096:4096",
    "--user",
    `${input.uid}:${input.gid}`,
    "--network=bridge",
    "--dns=127.0.0.1",
    "--add-host",
    `${input.hostname}:${input.pinnedIpv4}`,
    "--tmpfs",
    "/tmp:rw,noexec,nosuid,nodev,size=1g,mode=0700",
    "--env",
    "HOME=/tmp",
    "--workdir",
    "/tmp",
    "--mount",
    mount(input.ownerCredentialsPath, "/run/secrets/owner.json", true),
    "--mount",
    mount(input.memberCredentialsPath, "/run/secrets/member.json", true),
    "--mount",
    mount(input.wrapperPath, "/zap/run-zap-active-container.py", true),
    "--mount",
    mount(input.evidenceDirectory, "/evidence", false),
    ACTIVE_DAST_IMAGE,
    "python3",
    "/zap/run-zap-active-container.py",
    "--origin",
    input.origin,
    "--project",
    input.project,
    "--max-requests",
    String(input.bounds.maxRequests),
    "--spider-minutes",
    String(input.bounds.spiderMinutes),
    "--browser-spider-minutes",
    String(input.bounds.browserSpiderMinutes),
    "--active-scan-minutes",
    String(input.bounds.activeScanMinutes),
  ];
}
