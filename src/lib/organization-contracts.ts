import { and, count, eq, inArray, isNull, ne, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  courses,
  mediaAssetDerivatives,
  mediaAssets,
  organizationContracts,
  users,
} from "@/db/schema";
import { ApiError } from "@/lib/api/errors";

type ContractTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export const ORGANIZATION_CONTRACT_FEATURES = [
  "ai",
  "automations",
  "commerce",
  "custom_domains",
  "native_mobile",
  "oidc_sso",
] as const;

export type OrganizationContractFeature =
  (typeof ORGANIZATION_CONTRACT_FEATURES)[number];

type ContractReader = Pick<typeof db, "select">;

export type OrganizationContractOverview = Awaited<
  ReturnType<typeof getOrganizationContractOverview>
>;

export function organizationFeatureForApiAction(
  action: string,
): OrganizationContractFeature | null {
  if (action.startsWith("agent.") || action.startsWith("ai.")) return "ai";
  if (action.startsWith("commerce.")) return "commerce";
  if (action.startsWith("automation.")) return "automations";
  if (action.startsWith("organization.oidc.")) return "oidc_sso";
  return null;
}

export async function assertOrganizationFeatureAvailable(
  executor: ContractReader,
  organizationId: string,
  feature: OrganizationContractFeature,
) {
  const [contract] = await executor
    .select({
      status: organizationContracts.status,
      features: organizationContracts.featureEntitlements,
    })
    .from(organizationContracts)
    .where(eq(organizationContracts.organizationId, organizationId))
    .limit(1);
  if (!contract) return;
  if (
    !["trial", "active", "past_due"].includes(contract.status) ||
    !contract.features.includes(feature)
  ) {
    throw new ApiError(
      403,
      "forbidden",
      `Das Feature ${feature} ist fuer den aktuellen Academy-Vertrag nicht freigeschaltet.`,
      { feature },
    );
  }
}

function finiteUsage(value: number | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

export async function getOrganizationContractOverview(organizationId: string) {
  const [
    contractRows,
    seatRows,
    courseRows,
    storageAssetRows,
    storageDerivativeRows,
  ] = await Promise.all([
    db
      .select()
      .from(organizationContracts)
      .where(eq(organizationContracts.organizationId, organizationId))
      .limit(1),
    db
      .select({ value: count(users.id) })
      .from(users)
      .where(
        and(
          eq(users.organizationId, organizationId),
          inArray(users.status, ["active", "invited"]),
        ),
      ),
    db
      .select({ value: count(courses.id) })
      .from(courses)
      .where(
        and(
          eq(courses.organizationId, organizationId),
          ne(courses.status, "archived"),
        ),
      ),
    db
      .select({ value: sql<number>`coalesce(sum(${mediaAssets.quotaBytes}), 0)` })
      .from(mediaAssets)
      .where(
        and(
          eq(mediaAssets.organizationId, organizationId),
          isNull(mediaAssets.deletedAt),
        ),
      ),
    db
      .select({ value: sql<number>`coalesce(sum(${mediaAssetDerivatives.sizeBytes}), 0)` })
      .from(mediaAssetDerivatives)
      .where(eq(mediaAssetDerivatives.organizationId, organizationId)),
  ]);
  const contract = contractRows[0] ?? null;
  return {
    contract,
    usage: {
      seats: finiteUsage(seatRows[0]?.value),
      courses: finiteUsage(courseRows[0]?.value),
      storageBytes:
        finiteUsage(storageAssetRows[0]?.value) +
        finiteUsage(storageDerivativeRows[0]?.value),
    },
  };
}

export async function assertOrganizationSeatCapacity(
  tx: ContractTransaction,
  input: { organizationId: string; requestedSeats?: number },
) {
  const requestedSeats = input.requestedSeats ?? 1;
  if (!Number.isInteger(requestedSeats) || requestedSeats < 1) {
    throw new Error("requestedSeats must be a positive integer");
  }
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`organization-seat-limit:${input.organizationId}`}, 0))`,
  );
  const [contract] = await tx
    .select({ seatLimit: organizationContracts.seatLimit })
    .from(organizationContracts)
    .where(eq(organizationContracts.organizationId, input.organizationId))
    .limit(1)
    .for("update");
  if (contract?.seatLimit === null || contract?.seatLimit === undefined) return;

  const [usage] = await tx
    .select({ value: count(users.id) })
    .from(users)
    .where(
      and(
        eq(users.organizationId, input.organizationId),
        inArray(users.status, ["active", "invited"]),
      ),
    );
  if (finiteUsage(usage?.value) + requestedSeats > contract.seatLimit) {
    throw new ApiError(
      409,
      "conflict",
      `Das Seat-Limit von ${contract.seatLimit} Konten ist erreicht.`,
      { limit: contract.seatLimit },
    );
  }
}

export async function assertOrganizationCourseCapacity(
  tx: ContractTransaction,
  organizationId: string,
) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`organization-course-limit:${organizationId}`}, 0))`,
  );
  const [contract] = await tx
    .select({ courseLimit: organizationContracts.courseLimit })
    .from(organizationContracts)
    .where(eq(organizationContracts.organizationId, organizationId))
    .limit(1)
    .for("update");
  if (contract?.courseLimit === null || contract?.courseLimit === undefined) return;
  const [usage] = await tx
    .select({ value: count(courses.id) })
    .from(courses)
    .where(
      and(
        eq(courses.organizationId, organizationId),
        ne(courses.status, "archived"),
      ),
    );
  if (finiteUsage(usage?.value) + 1 > contract.courseLimit) {
    throw new ApiError(
      409,
      "conflict",
      `Das Kurslimit von ${contract.courseLimit} Kursen ist erreicht.`,
      { limit: contract.courseLimit },
    );
  }
}

export async function assertOrganizationStorageCapacity(
  tx: ContractTransaction,
  input: { organizationId: string; requestedBytes: number },
) {
  if (!Number.isSafeInteger(input.requestedBytes) || input.requestedBytes < 1) {
    throw new Error("requestedBytes must be a positive safe integer");
  }
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`organization-storage-limit:${input.organizationId}`}, 0))`,
  );
  const [contract] = await tx
    .select({ storageLimitBytes: organizationContracts.storageLimitBytes })
    .from(organizationContracts)
    .where(eq(organizationContracts.organizationId, input.organizationId))
    .limit(1)
    .for("update");
  if (
    contract?.storageLimitBytes === null ||
    contract?.storageLimitBytes === undefined
  ) {
    return;
  }
  const [usage] = await tx
    .select({
      value: sql<number>`(
        coalesce(sum(${mediaAssets.quotaBytes}), 0) +
        coalesce((
          select sum(${mediaAssetDerivatives.sizeBytes})
          from ${mediaAssetDerivatives}
          where ${mediaAssetDerivatives.organizationId} = ${input.organizationId}
        ), 0)
      )::bigint`,
    })
    .from(mediaAssets)
    .where(
      and(
        eq(mediaAssets.organizationId, input.organizationId),
        isNull(mediaAssets.deletedAt),
      ),
    );
  if (
    finiteUsage(usage?.value) + input.requestedBytes >
    contract.storageLimitBytes
  ) {
    throw new ApiError(
      409,
      "conflict",
      "Das vertragliche Media-Speicherlimit ist erreicht.",
      { limitBytes: contract.storageLimitBytes },
    );
  }
}
