export const S3_PRIVACY_EXPORT_LIFECYCLE_PREFIX = "tenants/";
export const S3_PRIVACY_EXPORT_LIFECYCLE_TAG_KEY =
  "q-academy-lifecycle";
export const S3_PRIVACY_EXPORT_LIFECYCLE_TAG_VALUE =
  "privacy-export-v1";
export const S3_PRIVACY_EXPORT_LIFECYCLE_DAYS = 8 as const;
export const S3_PRIVACY_EXPORT_LIFECYCLE_TAGGING =
  `${encodeURIComponent(S3_PRIVACY_EXPORT_LIFECYCLE_TAG_KEY)}=` +
  encodeURIComponent(S3_PRIVACY_EXPORT_LIFECYCLE_TAG_VALUE);

type LifecycleTag = Readonly<{ key?: string; value?: string }>;

type LifecycleFilter = Readonly<{
  prefix?: string;
  tag?: LifecycleTag;
  objectSizeGreaterThan?: number;
  objectSizeLessThan?: number;
  and?: Readonly<{
    prefix?: string;
    tags?: readonly LifecycleTag[];
    objectSizeGreaterThan?: number;
    objectSizeLessThan?: number;
  }>;
}>;

export type S3LifecycleRuleContract = Readonly<{
  status?: string;
  legacyPrefix?: string;
  filter?: LifecycleFilter;
  expiration?: Readonly<{
    days?: number;
    dateConfigured?: boolean;
    expiredObjectDeleteMarker?: boolean;
  }>;
  noncurrentVersionExpiration?: Readonly<{
    noncurrentDays?: number;
    newerNoncurrentVersions?: number;
  }>;
}>;

export type S3LifecycleConfigurationContract = Readonly<{
  Rules?: readonly Readonly<{
    Status?: string;
    Prefix?: string;
    Filter?: Readonly<{
      Prefix?: string;
      Tag?: Readonly<{ Key?: string; Value?: string }>;
      ObjectSizeGreaterThan?: number;
      ObjectSizeLessThan?: number;
      And?: Readonly<{
        Prefix?: string;
        Tags?: readonly Readonly<{ Key?: string; Value?: string }>[];
        ObjectSizeGreaterThan?: number;
        ObjectSizeLessThan?: number;
      }>;
    }>;
    Expiration?: Readonly<{
      Days?: number;
      Date?: unknown;
      ExpiredObjectDeleteMarker?: boolean;
    }>;
    NoncurrentVersionExpiration?: Readonly<{
      NoncurrentDays?: number;
      NewerNoncurrentVersions?: number;
    }>;
  }>[];
}>;

export function normalizeS3LifecycleConfiguration(
  result: S3LifecycleConfigurationContract,
): S3LifecycleRuleContract[] {
  return (result.Rules ?? []).map((rule) => ({
    status: rule.Status,
    legacyPrefix: rule.Prefix,
    filter: rule.Filter
      ? {
          prefix: rule.Filter.Prefix,
          tag: rule.Filter.Tag
            ? {
                key: rule.Filter.Tag.Key,
                value: rule.Filter.Tag.Value,
              }
            : undefined,
          objectSizeGreaterThan: rule.Filter.ObjectSizeGreaterThan,
          objectSizeLessThan: rule.Filter.ObjectSizeLessThan,
          and: rule.Filter.And
            ? {
                prefix: rule.Filter.And.Prefix,
                tags: rule.Filter.And.Tags?.map((tag) => ({
                  key: tag.Key,
                  value: tag.Value,
                })),
                objectSizeGreaterThan:
                  rule.Filter.And.ObjectSizeGreaterThan,
                objectSizeLessThan:
                  rule.Filter.And.ObjectSizeLessThan,
              }
            : undefined,
        }
      : undefined,
    expiration: rule.Expiration
      ? {
          days: rule.Expiration.Days,
          dateConfigured: rule.Expiration.Date !== undefined,
          expiredObjectDeleteMarker:
            rule.Expiration.ExpiredObjectDeleteMarker,
        }
      : undefined,
    noncurrentVersionExpiration: rule.NoncurrentVersionExpiration
      ? {
          noncurrentDays: rule.NoncurrentVersionExpiration.NoncurrentDays,
          newerNoncurrentVersions:
            rule.NoncurrentVersionExpiration.NewerNoncurrentVersions,
        }
      : undefined,
  }));
}

function isPrivacyExportTag(tag: LifecycleTag | undefined) {
  return (
    tag?.key === S3_PRIVACY_EXPORT_LIFECYCLE_TAG_KEY &&
    tag.value === S3_PRIVACY_EXPORT_LIFECYCLE_TAG_VALUE
  );
}

function hasExactPrivacyExportFilter(rule: S3LifecycleRuleContract) {
  const filter = rule.filter;
  const and = filter?.and;
  return (
    rule.legacyPrefix === undefined &&
    filter?.prefix === undefined &&
    filter?.tag === undefined &&
    filter?.objectSizeGreaterThan === undefined &&
    filter?.objectSizeLessThan === undefined &&
    and?.prefix === S3_PRIVACY_EXPORT_LIFECYCLE_PREFIX &&
    and.objectSizeGreaterThan === undefined &&
    and.objectSizeLessThan === undefined &&
    and.tags?.length === 1 &&
    isPrivacyExportTag(and.tags[0])
  );
}

function isPrivacyExportExpirationRule(rule: S3LifecycleRuleContract) {
  return (
    rule.status === "Enabled" &&
    hasExactPrivacyExportFilter(rule) &&
    rule.expiration?.days === S3_PRIVACY_EXPORT_LIFECYCLE_DAYS &&
    rule.expiration.dateConfigured !== true &&
    rule.expiration.expiredObjectDeleteMarker !== true &&
    rule.noncurrentVersionExpiration?.noncurrentDays ===
      S3_PRIVACY_EXPORT_LIFECYCLE_DAYS &&
    rule.noncurrentVersionExpiration.newerNoncurrentVersions === undefined
  );
}

function isExpiredDeleteMarkerRule(rule: S3LifecycleRuleContract) {
  const filter = rule.filter;
  return (
    rule.status === "Enabled" &&
    rule.legacyPrefix === undefined &&
    filter?.prefix === S3_PRIVACY_EXPORT_LIFECYCLE_PREFIX &&
    filter.tag === undefined &&
    filter.and === undefined &&
    filter.objectSizeGreaterThan === undefined &&
    filter.objectSizeLessThan === undefined &&
    rule.expiration?.expiredObjectDeleteMarker === true &&
    rule.expiration.days === undefined &&
    rule.expiration.dateConfigured !== true
  );
}

export function hasRequiredS3PrivacyExportLifecycle(
  rules: readonly S3LifecycleRuleContract[],
) {
  return (
    rules.some(isPrivacyExportExpirationRule) &&
    rules.some(isExpiredDeleteMarkerRule)
  );
}
