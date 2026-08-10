export type S3BrowserUploadCorsRuleContract = Readonly<{
  allowedOrigins: readonly string[];
  allowedMethods: readonly string[];
  allowedHeaders: readonly string[];
  exposeHeaders: readonly string[];
}>;

export type S3BrowserUploadCorsConfigurationContract = Readonly<{
  CORSRules?: readonly Readonly<{
    AllowedOrigins?: readonly string[];
    AllowedMethods?: readonly string[];
    AllowedHeaders?: readonly string[];
    ExposeHeaders?: readonly string[];
  }>[];
}>;

export function normalizeS3BrowserUploadCorsConfiguration(
  result: S3BrowserUploadCorsConfigurationContract,
): S3BrowserUploadCorsRuleContract[] {
  return (result.CORSRules ?? []).map((rule) => ({
    allowedOrigins: [...(rule.AllowedOrigins ?? [])],
    allowedMethods: [...(rule.AllowedMethods ?? [])],
    allowedHeaders: [...(rule.AllowedHeaders ?? [])],
    exposeHeaders: [...(rule.ExposeHeaders ?? [])],
  }));
}

function normalizedHeaders(values: readonly string[]) {
  return new Set(values.map((value) => value.trim().toLowerCase()));
}

export function hasRequiredS3BrowserUploadCors(
  rules: readonly S3BrowserUploadCorsRuleContract[],
  expectedOrigin: string,
) {
  let origin: string;
  try {
    const parsed = new URL(expectedOrigin);
    if (
      parsed.protocol !== "https:" ||
      parsed.origin !== expectedOrigin ||
      parsed.username ||
      parsed.password
    ) {
      return false;
    }
    origin = parsed.origin;
  } catch {
    return false;
  }

  return rules.some((rule) => {
    const methods = new Set(
      rule.allowedMethods.map((method) => method.trim().toUpperCase()),
    );
    const allowedHeaders = normalizedHeaders(rule.allowedHeaders);
    const exposedHeaders = normalizedHeaders(rule.exposeHeaders);
    return (
      !rule.allowedOrigins.some((value) => value.includes("*")) &&
      !rule.allowedHeaders.some((value) => value.includes("*")) &&
      rule.allowedOrigins.includes(origin) &&
      methods.has("PUT") &&
      allowedHeaders.has("content-type") &&
      allowedHeaders.has("if-none-match") &&
      allowedHeaders.has("x-amz-checksum-sha256") &&
      exposedHeaders.has("etag")
    );
  });
}

export function hasRequiredS3BrowserUploadCorsInventory(
  rules: readonly S3BrowserUploadCorsRuleContract[],
  expectedOrigins: readonly string[],
) {
  return (
    expectedOrigins.length >= 1 &&
    !rules.some(
      (rule) =>
        rule.allowedOrigins.some((value) => value.includes("*")) ||
        rule.allowedHeaders.some((value) => value.includes("*")),
    ) &&
    expectedOrigins.every((origin) =>
      hasRequiredS3BrowserUploadCors(rules, origin),
    )
  );
}
