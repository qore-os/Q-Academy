import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { resolveTxt as systemResolveTxt } from "node:dns/promises";
import { domainToASCII } from "node:url";

import { z } from "zod";

export const CUSTOM_DOMAIN_CHALLENGE_TTL_MS = 24 * 60 * 60 * 1_000;
export const CUSTOM_DOMAIN_DNS_TIMEOUT_MS = 3_000;
export const CUSTOM_DOMAIN_STATUSES = [
  "pending",
  "verified",
  "revoked",
] as const;
export const CUSTOM_DOMAIN_CHECK_CODES = [
  "verified",
  "no_match",
  "dns_error",
  "timeout",
  "expired",
] as const;

export type CustomDomainStatus = (typeof CUSTOM_DOMAIN_STATUSES)[number];
export type CustomDomainCheckCode =
  (typeof CUSTOM_DOMAIN_CHECK_CODES)[number];

const reservedSuffixes = [
  ".localhost",
  ".local",
  ".internal",
  ".invalid",
  ".test",
  ".example",
];

export function normalizeCustomDomainHostname(value: string) {
  const raw = value.trim().toLowerCase().replace(/\.$/, "");
  if (
    !raw ||
    raw.length > 253 ||
    raw.includes(":") ||
    raw.includes("/") ||
    raw.includes("*") ||
    /[\r\n]/.test(raw)
  ) {
    return null;
  }
  const ascii = domainToASCII(raw).toLowerCase();
  const labels = ascii.split(".");
  if (
    !ascii ||
    labels.length < 2 ||
    labels.some(
      (label) =>
        !label ||
        label.length > 63 ||
        !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label),
    ) ||
    reservedSuffixes.some(
      (suffix) => ascii === suffix.slice(1) || ascii.endsWith(suffix),
    )
  ) {
    return null;
  }
  return ascii;
}

export const customDomainHostnameSchema = z
  .string()
  .trim()
  .min(3)
  .max(253)
  .transform((value, context) => {
    const hostname = normalizeCustomDomainHostname(value);
    if (!hostname) {
      context.addIssue({
        code: "custom",
        message: "Bitte einen oeffentlich aufloesbaren Hostnamen eingeben.",
      });
      return z.NEVER;
    }
    return hostname;
  });

export const customDomainClaimCreateSchema = z
  .object({ hostname: customDomainHostnameSchema })
  .strict();

export const customDomainClaimMutationSchema = z
  .object({ expectedRevision: z.number().int().min(1) })
  .strict();

export function customDomainDnsRecordName(hostname: string) {
  return `_q-academy-verification.${hostname}`;
}

export function hashCustomDomainChallenge(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function issueCustomDomainChallenge(
  now = new Date(),
  entropy: () => Buffer = () => randomBytes(32),
) {
  const recordValue = `qacademy-domain-v1.${entropy().toString("base64url")}`;
  return {
    recordValue,
    challengeHash: hashCustomDomainChallenge(recordValue),
    expiresAt: new Date(now.getTime() + CUSTOM_DOMAIN_CHALLENGE_TTL_MS),
  };
}

function equalChallengeHash(left: string, right: string) {
  if (!/^[0-9a-f]{64}$/.test(left) || !/^[0-9a-f]{64}$/.test(right)) {
    return false;
  }
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

export type ResolveTxt = (hostname: string) => Promise<string[][]>;

export async function checkCustomDomainDns(input: {
  hostname: string;
  expectedChallengeHash: string;
  resolveTxt?: ResolveTxt;
  timeoutMs?: number;
}) {
  const resolveTxt = input.resolveTxt ?? systemResolveTxt;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const records = await Promise.race([
      resolveTxt(customDomainDnsRecordName(input.hostname)),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error("custom_domain_dns_timeout")),
          input.timeoutMs ?? CUSTOM_DOMAIN_DNS_TIMEOUT_MS,
        );
      }),
    ]);
    const matched = records.some((fragments) =>
      equalChallengeHash(
        hashCustomDomainChallenge(fragments.join("")),
        input.expectedChallengeHash,
      ),
    );
    return {
      code: matched ? "verified" : "no_match",
      recordCount: records.length,
    } as const;
  } catch (error) {
    return {
      code:
        error instanceof Error &&
        error.message === "custom_domain_dns_timeout"
          ? "timeout"
          : "dns_error",
      recordCount: 0,
    } as const;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function customDomainMutationGuard(
  claim: {
    organizationId: string;
    status: string;
    revision: number;
    challengeExpiresAt: Date;
  },
  input: {
    organizationId: string;
    expectedRevision: number;
    operation: "rotate" | "verify" | "revoke";
    now?: Date;
  },
) {
  if (claim.organizationId !== input.organizationId) return "tenant_mismatch";
  if (claim.revision !== input.expectedRevision) return "revision_mismatch";
  if (input.operation === "revoke") {
    return claim.status === "pending" || claim.status === "verified"
      ? "ok"
      : "invalid_status";
  }
  if (claim.status !== "pending") return "invalid_status";
  if (
    input.operation === "verify" &&
    claim.challengeExpiresAt.getTime() <= (input.now ?? new Date()).getTime()
  ) {
    return "expired";
  }
  return "ok";
}
