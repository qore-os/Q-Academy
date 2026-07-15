import "server-only";

import * as client from "openid-client";
import { resolveSafeWebhookTarget } from "@/lib/api/webhook-security";
import { ApiError } from "@/lib/api/errors";
import type { OidcRuntimeConfiguration } from "@/lib/oidc-configuration";
import { oidcCustomFetch } from "@/lib/oidc-http";
import { logServerError } from "@/lib/server-error-logging";

const CACHE_TTL_MS = 5 * 60_000;
const MAX_CACHE_ENTRIES = 100;
const ASYMMETRIC_ID_TOKEN_ALGORITHMS = new Set([
  "RS256",
  "RS384",
  "RS512",
  "PS256",
  "PS384",
  "PS512",
  "ES256",
  "ES384",
  "ES512",
  "EdDSA",
]);

type CachedConfiguration = {
  expiresAt: number;
  value: client.Configuration;
};

const providerConfigurationCache = new Map<string, CachedConfiguration>();

function cacheKey(configuration: OidcRuntimeConfiguration) {
  return `${configuration.organizationId}:${configuration.version}`;
}

async function assertProviderEndpoint(
  value: string | undefined,
  label: string,
) {
  if (!value) {
    throw new ApiError(
      422,
      "validation_error",
      `Der Identity Provider veroeffentlicht keinen ${label}.`,
    );
  }
  try {
    await resolveSafeWebhookTarget(value);
  } catch {
    throw new ApiError(
      422,
      "validation_error",
      `Der Identity Provider veroeffentlicht einen unsicheren ${label}.`,
    );
  }
}

async function discoverConfiguration(
  configuration: OidcRuntimeConfiguration,
) {
  const execute = [client.enableNonRepudiationChecks];
  if (
    process.env.NODE_ENV !== "production" &&
    new URL(configuration.issuer).protocol === "http:"
  ) {
    execute.unshift(client.allowInsecureRequests);
  }
  let resolved: client.Configuration;
  try {
    resolved = await client.discovery(
      new URL(configuration.issuer),
      configuration.clientId,
      {
        client_secret: configuration.clientSecret,
        response_types: ["code"],
        token_endpoint_auth_method: "client_secret_post",
      },
      client.ClientSecretPost(configuration.clientSecret),
      {
        timeout: 10,
        [client.customFetch]: oidcCustomFetch,
        execute,
      },
    );
  } catch {
    throw new ApiError(
      502,
      "internal_error",
      "Die OIDC-Metadaten konnten nicht sicher geladen werden.",
    );
  }
  const metadata = resolved.serverMetadata();
  await Promise.all([
    assertProviderEndpoint(metadata.authorization_endpoint, "Authorization-Endpunkt"),
    assertProviderEndpoint(metadata.token_endpoint, "Token-Endpunkt"),
    assertProviderEndpoint(metadata.jwks_uri, "Signaturschluessel-Endpunkt"),
  ]);
  if (
    metadata.response_types_supported &&
    !metadata.response_types_supported.includes("code")
  ) {
    throw new ApiError(
      422,
      "validation_error",
      "Der Identity Provider unterstuetzt keinen Authorization-Code-Flow.",
    );
  }
  if (
    metadata.grant_types_supported &&
    !metadata.grant_types_supported.includes("authorization_code")
  ) {
    throw new ApiError(
      422,
      "validation_error",
      "Der Identity Provider unterstuetzt keinen Authorization-Code-Grant.",
    );
  }
  if (
    metadata.code_challenge_methods_supported &&
    !metadata.code_challenge_methods_supported.includes("S256")
  ) {
    throw new ApiError(
      422,
      "validation_error",
      "Der Identity Provider unterstuetzt kein PKCE mit S256.",
    );
  }
  if (
    metadata.scopes_supported &&
    (!metadata.scopes_supported.includes("openid") ||
      !metadata.scopes_supported.includes("email"))
  ) {
    throw new ApiError(
      422,
      "validation_error",
      "Der Identity Provider stellt die benoetigten openid- und email-Scopes nicht bereit.",
    );
  }
  if (
    !metadata.token_endpoint_auth_methods_supported?.includes(
      "client_secret_post",
    )
  ) {
    throw new ApiError(
      422,
      "validation_error",
      "Der Identity Provider unterstuetzt keine kompatible Client-Secret-Authentifizierung.",
    );
  }
  const algorithms = metadata.id_token_signing_alg_values_supported;
  if (
    algorithms &&
    !algorithms.some((algorithm) =>
      ASYMMETRIC_ID_TOKEN_ALGORITHMS.has(algorithm),
    )
  ) {
    throw new ApiError(
      422,
      "validation_error",
      "Der Identity Provider bietet keine signierten ID-Tokens an.",
    );
  }
  return resolved;
}

export async function getOidcProviderConfiguration(
  configuration: OidcRuntimeConfiguration,
) {
  const cache = providerConfigurationCache;
  const key = cacheKey(configuration);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  cache.delete(key);
  const value = await discoverConfiguration(configuration);
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value as string | undefined;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

export async function verifyOidcProviderConfiguration(
  configuration: OidcRuntimeConfiguration,
) {
  await discoverConfiguration(configuration);
}

export async function createOidcAuthorizationRequest(input: {
  configuration: OidcRuntimeConfiguration;
  redirectUri: string;
  state: string;
  nonce: string;
  codeVerifier: string;
  requireFreshAuthentication?: boolean;
}) {
  const provider = await getOidcProviderConfiguration(input.configuration);
  const codeChallenge = await client.calculatePKCECodeChallenge(
    input.codeVerifier,
  );
  const supportedScopes = provider.serverMetadata().scopes_supported;
  const scope = supportedScopes?.includes("profile")
    ? "openid email profile"
    : "openid email";
  return client.buildAuthorizationUrl(provider, {
    redirect_uri: input.redirectUri,
    scope,
    response_type: "code",
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    state: input.state,
    nonce: input.nonce,
    ...(input.requireFreshAuthentication
      ? { prompt: "login", max_age: "0" }
      : {}),
  });
}

export async function exchangeOidcAuthorizationCode(input: {
  configuration: OidcRuntimeConfiguration;
  currentUrl: URL;
  state: string;
  nonce: string;
  codeVerifier: string;
  requireFreshAuthentication?: boolean;
}) {
  const provider = await getOidcProviderConfiguration(input.configuration);
  try {
    const response = await client.authorizationCodeGrant(
      provider,
      input.currentUrl,
      {
        expectedState: input.state,
        expectedNonce: input.nonce,
        pkceCodeVerifier: input.codeVerifier,
        idTokenExpected: true,
        ...(input.requireFreshAuthentication ? { maxAge: 0 } : {}),
      },
    );
    const claims = response.claims();
    if (!claims) {
      throw new Error("OIDC response did not contain validated ID Token claims.");
    }
    return claims;
  } catch (error) {
    logServerError(error, {
      action: "auth.oidc.authorization_code.exchange",
    });
    throw new ApiError(
      401,
      "authentication_required",
      "Der Unternehmens-Login konnte nicht sicher abgeschlossen werden.",
    );
  }
}

export const oidcProtocolRandom = {
  state: client.randomState,
  nonce: client.randomNonce,
  codeVerifier: client.randomPKCECodeVerifier,
};
