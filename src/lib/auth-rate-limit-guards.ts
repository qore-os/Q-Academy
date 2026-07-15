export const UNRESOLVED_AUTH_RATE_LIMIT_SCOPE = "unresolved";

export type AuthRateLimitGuardIdentifier = {
  kind: "ip" | "global" | "scope";
  identifier: string;
};

export function authRateLimitScopeForOrganization(
  organizationId: string | null | undefined,
) {
  return (
    organizationId?.normalize("NFKC").trim() ||
    UNRESOLVED_AUTH_RATE_LIMIT_SCOPE
  );
}

export function authRateLimitGuardIdentifiers(
  scopeIdentifier: string,
  ip: string | null,
): AuthRateLimitGuardIdentifier[] {
  const guards: AuthRateLimitGuardIdentifier[] = [];
  const normalizedIp = ip?.trim().toLowerCase();
  if (normalizedIp) guards.push({ kind: "ip", identifier: normalizedIp });
  guards.push(
    {
      kind: "scope",
      identifier: authRateLimitScopeForOrganization(scopeIdentifier),
    },
    { kind: "global", identifier: "global" },
  );
  return guards;
}

export async function claimGuardFirstBuckets<
  Bucket,
  Result extends { limited: boolean },
>(
  guardBuckets: readonly Bucket[],
  primaryBucket: Bucket,
  claim: (bucket: Bucket) => Promise<Result>,
): Promise<Result> {
  for (const guard of guardBuckets) {
    const result = await claim(guard);
    if (result.limited) return result;
  }
  return claim(primaryBucket);
}

export type PrimaryFirstClaimOutcome<Result> = {
  result: Result;
  rollbackRequired: boolean;
};

export async function claimPrimaryFirstBuckets<
  Bucket,
  Result extends { limited: boolean },
>(
  primaryBucket: Bucket,
  guardBuckets: readonly Bucket[],
  claim: (bucket: Bucket) => Promise<Result>,
): Promise<PrimaryFirstClaimOutcome<Result>> {
  const primaryResult = await claim(primaryBucket);
  if (primaryResult.limited) {
    return { result: primaryResult, rollbackRequired: false };
  }

  for (const guard of guardBuckets) {
    const result = await claim(guard);
    if (result.limited) {
      return { result, rollbackRequired: true };
    }
  }
  return { result: primaryResult, rollbackRequired: false };
}
