const DAY_MS = 24 * 60 * 60 * 1_000;
const DEFAULT_DELIVERY_RETENTION_DAYS = 90;
const MAX_DELIVERY_RETENTION_DAYS = 3_650;

export type CleanupEnvironment = Readonly<
  Record<string, string | undefined>
>;

export type OperationalCleanupPolicy = {
  emailDeliveryRetentionDays: number;
  webhookDeliveryRetentionDays: number;
  pushDeliveryRetentionDays: number;
  communityAuthorBoostRetentionDays: number;
  emailDeliveryCutoff: Date;
  webhookDeliveryCutoff: Date;
  pushDeliveryCutoff: Date;
  communityAuthorBoostCutoff: Date;
};

export class OperationalCleanupConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OperationalCleanupConfigurationError";
  }
}

function retentionDays(
  environment: CleanupEnvironment,
  name: string,
): number {
  const raw = environment[name]?.trim();
  if (!raw) return DEFAULT_DELIVERY_RETENTION_DAYS;
  if (!/^\d+$/.test(raw)) {
    throw new OperationalCleanupConfigurationError(
      `${name} must be a whole number between 1 and ${MAX_DELIVERY_RETENTION_DAYS}.`,
    );
  }
  const value = Number(raw);
  if (value < 1 || value > MAX_DELIVERY_RETENTION_DAYS) {
    throw new OperationalCleanupConfigurationError(
      `${name} must be between 1 and ${MAX_DELIVERY_RETENTION_DAYS}.`,
    );
  }
  return value;
}

export function resolveOperationalCleanupPolicy(
  environment: CleanupEnvironment,
  now = new Date(),
): OperationalCleanupPolicy {
  if (Number.isNaN(now.getTime())) {
    throw new OperationalCleanupConfigurationError(
      "The cleanup reference time must be a valid date.",
    );
  }

  const emailDeliveryRetentionDays = retentionDays(
    environment,
    "EMAIL_DELIVERY_RETENTION_DAYS",
  );
  const webhookDeliveryRetentionDays = retentionDays(
    environment,
    "WEBHOOK_DELIVERY_RETENTION_DAYS",
  );
  const pushDeliveryRetentionDays = retentionDays(
    environment,
    "PUSH_DELIVERY_RETENTION_DAYS",
  );
  const communityAuthorBoostRetentionDays = retentionDays(
    environment,
    "COMMUNITY_AUTHOR_BOOST_RETENTION_DAYS",
  );
  return {
    emailDeliveryRetentionDays,
    webhookDeliveryRetentionDays,
    pushDeliveryRetentionDays,
    communityAuthorBoostRetentionDays,
    emailDeliveryCutoff: new Date(
      now.getTime() - emailDeliveryRetentionDays * DAY_MS,
    ),
    webhookDeliveryCutoff: new Date(
      now.getTime() - webhookDeliveryRetentionDays * DAY_MS,
    ),
    pushDeliveryCutoff: new Date(
      now.getTime() - pushDeliveryRetentionDays * DAY_MS,
    ),
    communityAuthorBoostCutoff: new Date(
      now.getTime() - communityAuthorBoostRetentionDays * DAY_MS,
    ),
  };
}
