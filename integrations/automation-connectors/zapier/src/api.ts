import type { Bundle, ZObject } from "zapier-platform-core";

export const API_PREFIX = "/api/v1";
export const CONNECTOR_CONTRACT_VERSION = "1.0.0";
export const CONNECTOR_REQUIRED_SCOPES = [
  "automations:write",
  "bundles:read",
] as const;

export interface ApiEnvelope<T> {
  data: T;
  meta?: {
    pagination?: {
      nextCursor?: string | null;
    };
  };
}

export interface BundleOption {
  id: string;
  name: string;
}

export interface ConnectorStatus {
  connected: true;
  contractVersion: typeof CONNECTOR_CONTRACT_VERSION;
  apiVersion: "v1";
  organizationId: string;
  apiKeyName: string;
  requiredScopes: string[];
  capabilities: {
    memberUpsert: boolean;
    bundleSelection: boolean;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, expected: readonly string[]) {
  const keys = Object.keys(value);
  return keys.length === expected.length && keys.every((key) => expected.includes(key));
}

function hasExactRequiredScopes(value: unknown) {
  if (!Array.isArray(value) || value.length !== CONNECTOR_REQUIRED_SCOPES.length) {
    return false;
  }
  const scopes = new Set(value);
  return (
    scopes.size === CONNECTOR_REQUIRED_SCOPES.length &&
    CONNECTOR_REQUIRED_SCOPES.every((scope) => scopes.has(scope))
  );
}

export function connectorStatus(value: unknown): ConnectorStatus {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      "connected",
      "contractVersion",
      "apiVersion",
      "organizationId",
      "apiKeyName",
      "requiredScopes",
      "capabilities",
    ]) ||
    value.connected !== true ||
    value.contractVersion !== CONNECTOR_CONTRACT_VERSION ||
    value.apiVersion !== "v1" ||
    typeof value.organizationId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value.organizationId,
    ) ||
    typeof value.apiKeyName !== "string" ||
    !value.apiKeyName.trim() ||
    !hasExactRequiredScopes(value.requiredScopes) ||
    !isRecord(value.capabilities) ||
    !hasOnlyKeys(value.capabilities, ["memberUpsert", "bundleSelection"]) ||
    value.capabilities.memberUpsert !== true ||
    value.capabilities.bundleSelection !== true
  ) {
    throw new Error(
      `Academy connector status does not match the required ${CONNECTOR_CONTRACT_VERSION} contract.`,
    );
  }
  return {
    connected: true,
    contractVersion: CONNECTOR_CONTRACT_VERSION,
    apiVersion: "v1",
    organizationId: value.organizationId,
    apiKeyName: value.apiKeyName,
    requiredScopes: [...CONNECTOR_REQUIRED_SCOPES],
    capabilities: { memberUpsert: true, bundleSelection: true },
  };
}

export interface MemberResult {
  id: string;
  email: string;
  status: string;
  created: boolean;
  bundleId: string | null;
  bundleAction: "grant" | "revoke";
  bundleAccessChanged: boolean;
}

export interface MemberMutationInput {
  email: string;
  firstName?: string;
  lastName?: string;
  bundleId?: string | null;
  bundleAction: "grant" | "revoke";
  sendInvitation: boolean;
}

export function normalizeBaseUrl(value: unknown) {
  const parsed = new URL(String(value ?? "").trim());
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    (parsed.pathname !== "/" && parsed.pathname !== "")
  ) {
    throw new Error(
      "Academy URL must be a credential-free HTTPS origin without a path, query or fragment.",
    );
  }
  return parsed.origin;
}

export function apiUrl(bundle: Bundle, path: string) {
  return `${normalizeBaseUrl(bundle.authData.baseUrl)}${API_PREFIX}${path}`;
}

export function idempotencyKey(value: unknown) {
  const supplied = String(value ?? "").trim();
  if (supplied.length < 8 || supplied.length > 180) {
    throw new Error("A stable idempotency key with 8-180 characters is required.");
  }
  return supplied;
}

export async function mutateMember(
  z: ZObject,
  bundle: Bundle,
  input: MemberMutationInput,
  suppliedIdempotencyKey: unknown,
) {
  const response = await z.request<ApiEnvelope<MemberResult>>({
    method: "POST",
    url: apiUrl(bundle, "/automation/members/upsert"),
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey(suppliedIdempotencyKey),
    },
    body: input,
  });
  return response.data.data;
}
