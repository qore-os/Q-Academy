export type OrbitBillingInterval = "monthly" | "annual";
export const MAX_ORBIT_BILLING_COMPONENT_CENTS = 100_000_000_000;
export const MAX_ORBIT_BILLING_INSTANCE_COUNT = 10_000;

export type OrbitBillingPricing = {
  currency: string;
  billingInterval: OrbitBillingInterval;
  baseFeeCents: number;
  includedInstanceSlots: number;
  additionalInstanceFeeCents: number;
  revision: number;
};

export type OrbitBillingPeriod = {
  start: Date;
  end: Date;
};

function assertSafeNonNegativeInteger(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative safe integer.`);
  }
}

function utcPeriodStart(now: Date, interval: OrbitBillingInterval) {
  if (interval === "annual") {
    return new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  }
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function nextPeriodStart(start: Date, interval: OrbitBillingInterval) {
  if (interval === "annual") {
    return new Date(Date.UTC(start.getUTCFullYear() + 1, 0, 1));
  }
  return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
}

export function currentOrbitBillingPeriod(
  interval: OrbitBillingInterval,
  now = new Date(),
): OrbitBillingPeriod {
  const start = utcPeriodStart(now, interval);
  return { start, end: nextPeriodStart(start, interval) };
}

export function previousOrbitBillingPeriod(
  interval: OrbitBillingInterval,
  now = new Date(),
): OrbitBillingPeriod {
  const current = utcPeriodStart(now, interval);
  const start =
    interval === "annual"
      ? new Date(Date.UTC(current.getUTCFullYear() - 1, 0, 1))
      : new Date(
          Date.UTC(current.getUTCFullYear(), current.getUTCMonth() - 1, 1),
        );
  return { start, end: current };
}

export function dueOrbitBillingPeriods(
  interval: OrbitBillingInterval,
  activatedAt: Date,
  finalizedPeriodStarts: readonly Date[],
  now = new Date(),
) {
  const finalized = new Set(finalizedPeriodStarts.map((value) => value.getTime()));
  const currentStart = utcPeriodStart(now, interval);
  const periods: OrbitBillingPeriod[] = [];
  let start = utcPeriodStart(activatedAt, interval);

  while (start < currentStart) {
    const end = nextPeriodStart(start, interval);
    if (!finalized.has(start.getTime())) periods.push({ start, end });
    start = end;
  }

  return periods;
}

export function calculateOrbitBillingProjection(input: {
  pricing: OrbitBillingPricing;
  instanceCount: number;
  period?: OrbitBillingPeriod;
}) {
  assertSafeNonNegativeInteger(input.instanceCount, "instanceCount");
  assertSafeNonNegativeInteger(
    input.pricing.includedInstanceSlots,
    "includedInstanceSlots",
  );
  assertSafeNonNegativeInteger(input.pricing.baseFeeCents, "baseFeeCents");
  assertSafeNonNegativeInteger(
    input.pricing.additionalInstanceFeeCents,
    "additionalInstanceFeeCents",
  );
  if (
    input.instanceCount > MAX_ORBIT_BILLING_INSTANCE_COUNT ||
    input.pricing.includedInstanceSlots > MAX_ORBIT_BILLING_INSTANCE_COUNT ||
    input.pricing.baseFeeCents > MAX_ORBIT_BILLING_COMPONENT_CENTS ||
    input.pricing.additionalInstanceFeeCents >
      MAX_ORBIT_BILLING_COMPONENT_CENTS
  ) {
    throw new RangeError("Orbit billing input exceeds the supported ceiling.");
  }
  const additionalInstanceCount = Math.max(
    0,
    input.instanceCount - input.pricing.includedInstanceSlots,
  );
  const subtotalCents =
    input.pricing.baseFeeCents +
    additionalInstanceCount * input.pricing.additionalInstanceFeeCents;
  assertSafeNonNegativeInteger(subtotalCents, "subtotalCents");

  return {
    period: input.period ?? currentOrbitBillingPeriod(input.pricing.billingInterval),
    instanceCount: input.instanceCount,
    includedInstanceSlots: input.pricing.includedInstanceSlots,
    additionalInstanceCount,
    baseFeeCents: input.pricing.baseFeeCents,
    additionalInstanceFeeCents: input.pricing.additionalInstanceFeeCents,
    subtotalCents,
    currency: input.pricing.currency,
    pricingRevision: input.pricing.revision,
  };
}
