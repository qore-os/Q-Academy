import "server-only";

import { ApiError } from "@/lib/api/errors";
import {
  DELEGABLE_API_SCOPES,
  isOwnerBoundApiScope,
  missingApiScopes,
} from "@/lib/api/scopes";

/** Prevent API keys from minting or taking control of stronger credentials. */
export function assertScopesDelegable(
  callerScopes: readonly string[],
  requestedScopes: readonly string[],
) {
  const callerScopeSet = new Set(callerScopes);
  const hasWildcard = callerScopeSet.has("*");
  const hasEveryScope = DELEGABLE_API_SCOPES.every((scope) =>
    callerScopeSet.has(scope),
  );
  const forbidden = requestedScopes.filter((scope) => {
    if (isOwnerBoundApiScope(scope)) return true;
    if (scope === "*") return !hasWildcard && !hasEveryScope;
    return !hasWildcard && !callerScopeSet.has(scope);
  });

  if (forbidden.length > 0) {
    throw new ApiError(
      403,
      "insufficient_scope",
      "Ein API-Schluessel darf nur Scopes delegieren, die er selbst besitzt.",
      { forbidden },
    );
  }
}

export function forbidPrivilegeRelevantSelfPatch(
  apiKeyId: string,
  targetApiKeyId: string,
  input: { scopes?: readonly string[]; expiresAt?: Date | null },
) {
  if (
    apiKeyId === targetApiKeyId &&
    (input.scopes !== undefined || input.expiresAt !== undefined)
  ) {
    throw new ApiError(
      403,
      "forbidden",
      "Der aktuell verwendete API-Schluessel darf seine eigenen Berechtigungen oder seine Laufzeit nicht aendern.",
    );
  }
}

export function assertOwnerBoundApiKeyControl(input: {
  callerScopes: readonly string[];
  ownerBoundEligible: boolean;
  targetScopes: readonly string[];
}) {
  const ownerBoundScopes = input.targetScopes.filter(isOwnerBoundApiScope);
  if (ownerBoundScopes.length === 0) return;
  const missing = missingApiScopes(input.callerScopes, ownerBoundScopes);
  if (!input.ownerBoundEligible || missing.length > 0) {
    throw new ApiError(
      403,
      "insufficient_scope",
      "Owner-gebundene API-Schluessel duerfen nur mit denselben expliziten Sicherheits-Scopes verwaltet werden.",
      { missing: missing.length > 0 ? missing : ownerBoundScopes },
    );
  }
}
