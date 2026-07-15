import { z } from "zod";

export const STOCK_IMAGE_LIMITS = Object.freeze({
  maxResponseBytes: 1024 * 1024,
  maxTrackingResponseBytes: 64 * 1024,
  maxImageBytes: 20 * 1024 * 1024,
  dnsTimeoutMs: 2_000,
  requestTimeoutMs: 7_000,
  selectionRetentionMs: 30 * 24 * 60 * 60 * 1_000,
});

export const stockImageSearchInputSchema = z
  .object({
    query: z.string().trim().min(2).max(100),
    page: z.coerce.number().int().min(1).max(50).default(1),
    perPage: z.coerce.number().int().min(1).max(30).default(12),
  })
  .strict();

export const stockImageSelectionInputSchema = z
  .object({
    courseId: z.string().uuid(),
    externalId: z.string().trim().min(1).max(200),
  })
  .strict();

export const stockImageProviderItemSchema = z
  .object({
    id: z.string().trim().min(1).max(200),
    previewUrl: z.string().url().max(2_048),
    imageUrl: z.string().url().max(2_048),
    width: z.number().int().positive().max(50_000),
    height: z.number().int().positive().max(50_000),
    alt: z.string().trim().max(500).nullable().default(null),
    author: z.string().trim().min(1).max(200),
    authorUrl: z.string().url().max(2_048).nullable().default(null),
    sourceUrl: z.string().url().max(2_048),
    downloadTrackingUrl: z.string().url().max(2_048),
    attribution: z.string().trim().min(1).max(500),
  })
  .strict();

export const stockImageProviderSearchResponseSchema = z
  .object({
    page: z.number().int().min(1),
    perPage: z.number().int().min(1).max(30),
    total: z.number().int().min(0),
    results: z.array(stockImageProviderItemSchema).max(30),
  })
  .strict();

export const stockImageProviderItemResponseSchema = z
  .object({ image: stockImageProviderItemSchema })
  .strict();

export type StockImageProviderItem = z.infer<
  typeof stockImageProviderItemSchema
>;
export type StockImageProviderSearchResponse = z.infer<
  typeof stockImageProviderSearchResponseSchema
>;

export type StockImageProviderConfiguration = Readonly<{
  enabled: true;
  provider: string;
  baseUrl: URL;
  apiKey: string;
  allowedHosts: ReadonlySet<string>;
}>;

export type DisabledStockImageProviderConfiguration = Readonly<{
  enabled: false;
  reason: "not_configured" | "invalid_configuration";
}>;

function normalizedHttpsUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443") ||
    !url.hostname
  ) {
    return null;
  }
  url.hash = "";
  if (url.port === "443") url.port = "";
  return url;
}

export function stockImageProviderConfiguration(
  environment: Readonly<Record<string, string | undefined>> = process.env,
):
  | StockImageProviderConfiguration
  | DisabledStockImageProviderConfiguration {
  const provider = environment.STOCK_IMAGE_PROVIDER_NAME?.trim() ?? "";
  const baseUrlValue = environment.STOCK_IMAGE_PROVIDER_BASE_URL?.trim() ?? "";
  const apiKey = environment.STOCK_IMAGE_PROVIDER_API_KEY?.trim() ?? "";
  const allowedHostsValue = environment.STOCK_IMAGE_ALLOWED_HOSTS?.trim() ?? "";
  const supplied = [provider, baseUrlValue, apiKey, allowedHostsValue].filter(
    Boolean,
  ).length;
  if (supplied === 0) return { enabled: false, reason: "not_configured" };
  if (supplied !== 4 || !/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,79}$/.test(provider)) {
    return { enabled: false, reason: "invalid_configuration" };
  }
  const baseUrl = normalizedHttpsUrl(baseUrlValue);
  const hosts = allowedHostsValue
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
  if (
    !baseUrl ||
    hosts.length === 0 ||
    new Set(hosts).size !== hosts.length ||
    hosts.some(
      (host) =>
        host.includes("*") ||
        host.includes(":") ||
        !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/.test(
          host,
        ),
    ) ||
    !hosts.includes(baseUrl.hostname.toLowerCase())
  ) {
    return { enabled: false, reason: "invalid_configuration" };
  }
  baseUrl.pathname = `${baseUrl.pathname.replace(/\/+$/, "")}/`;
  baseUrl.search = "";
  return {
    enabled: true,
    provider,
    baseUrl,
    apiKey,
    allowedHosts: new Set(hosts),
  };
}

export function safeStockImageResponseUrl(
  value: string,
  allowedHosts: ReadonlySet<string>,
) {
  const url = normalizedHttpsUrl(value);
  if (!url || !allowedHosts.has(url.hostname.toLowerCase())) return null;
  return url.toString();
}

export function validatedStockImageProviderItem(
  input: unknown,
  allowedHosts: ReadonlySet<string>,
) {
  const parsed = stockImageProviderItemSchema.safeParse(input);
  if (!parsed.success) return null;
  const previewUrl = safeStockImageResponseUrl(
    parsed.data.previewUrl,
    allowedHosts,
  );
  const imageUrl = safeStockImageResponseUrl(parsed.data.imageUrl, allowedHosts);
  const authorUrl = parsed.data.authorUrl
    ? safeStockImageResponseUrl(parsed.data.authorUrl, allowedHosts)
    : null;
  const sourceUrl = safeStockImageResponseUrl(
    parsed.data.sourceUrl,
    allowedHosts,
  );
  const downloadTrackingUrl = safeStockImageResponseUrl(
    parsed.data.downloadTrackingUrl,
    allowedHosts,
  );
  if (
    !previewUrl ||
    !imageUrl ||
    (parsed.data.authorUrl && !authorUrl) ||
    !sourceUrl ||
    !downloadTrackingUrl
  ) {
    return null;
  }
  return {
    ...parsed.data,
    previewUrl,
    imageUrl,
    authorUrl,
    sourceUrl,
    downloadTrackingUrl,
  };
}
