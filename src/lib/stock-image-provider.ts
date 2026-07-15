import "server-only";

import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpsRequest, type RequestOptions } from "node:https";
import { isIP } from "node:net";

import { ApiError } from "@/lib/api/errors";
import { isPublicUnicastWebAddress } from "@/lib/ai/web-knowledge-source";
import {
  STOCK_IMAGE_LIMITS,
  stockImageProviderConfiguration,
  stockImageProviderItemResponseSchema,
  stockImageProviderSearchResponseSchema,
  validatedStockImageProviderItem,
  type StockImageProviderConfiguration,
  type StockImageProviderItem,
  type StockImageProviderSearchResponse,
} from "@/lib/stock-image-model";

type ResolvedTarget = Readonly<{
  url: URL;
  address: string;
  family: 4 | 6;
}>;

type ProviderResponse = Readonly<{
  statusCode: number;
  headers: Readonly<Record<string, string | string[] | undefined>>;
  body: AsyncIterable<Uint8Array>;
  close: () => void;
}>;

export type StockImageProviderDependencies = Readonly<{
  configuration?: StockImageProviderConfiguration;
  lookup?: (hostname: string) => Promise<Array<{ address: string; family: number }>>;
  open?: (target: ResolvedTarget, apiKey: string) => Promise<ProviderResponse>;
}>;

function unavailable(message = "Die Stockbildsuche ist nicht konfiguriert.") {
  return new ApiError(503, "internal_error", message);
}

function providerFailure(message: string) {
  return new ApiError(502, "internal_error", message);
}

function configured(dependencies: StockImageProviderDependencies) {
  const configuration =
    dependencies.configuration ?? stockImageProviderConfiguration();
  if (!configuration.enabled) throw unavailable();
  return configuration;
}

function boundedLookup(hostname: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    dnsLookup(hostname, { all: true, verbatim: true }),
    new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(providerFailure("Der Stockbildanbieter antwortet nicht rechtzeitig.")),
        STOCK_IMAGE_LIMITS.dnsTimeoutMs,
      );
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

async function resolveTarget(
  url: URL,
  dependencies: StockImageProviderDependencies,
) {
  const hostname = url.hostname.startsWith("[")
    ? url.hostname.slice(1, -1)
    : url.hostname;
  const literalFamily = isIP(hostname);
  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = literalFamily
      ? [{ address: hostname, family: literalFamily }]
      : await (dependencies.lookup ?? boundedLookup)(hostname);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw providerFailure("Der Stockbildanbieter konnte nicht sicher aufgeloest werden.");
  }
  if (
    addresses.length === 0 ||
    addresses.some(({ address }) => !isPublicUnicastWebAddress(address))
  ) {
    throw providerFailure(
      "Der Stockbildanbieter verweist auf ein nicht oeffentliches Netzwerkziel.",
    );
  }
  return {
    url,
    address: addresses[0]!.address,
    family: addresses[0]!.family === 6 ? (6 as const) : (4 as const),
  };
}

function openPinnedResponse(
  target: ResolvedTarget,
  apiKey: string,
): Promise<ProviderResponse> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let closed = false;
    const hostname = target.url.hostname;
    const options: RequestOptions = {
      protocol: "https:",
      hostname,
      port: 443,
      family: target.family,
      method: "GET",
      path: `${target.url.pathname}${target.url.search}`,
      agent: false,
      servername: isIP(hostname) ? undefined : hostname,
      headers: {
        Accept: "application/json",
        "Accept-Encoding": "identity",
        Authorization: `Bearer ${apiKey}`,
        "User-Agent": "Q-Academy-Stock-Images/1.0",
      },
      lookup: (_hostname, _options, callback) => {
        callback(null, target.address, target.family);
      },
    };
    const request = httpsRequest(options, (response) => {
      settled = true;
      const close = () => {
        if (closed) return;
        closed = true;
        clearTimeout(deadline);
        response.destroy();
      };
      response.once("end", () => clearTimeout(deadline));
      response.once("close", () => clearTimeout(deadline));
      resolve({
        statusCode: response.statusCode ?? 0,
        headers: response.headers,
        body: response,
        close,
      });
    });
    const deadline = setTimeout(
      () => request.destroy(new Error("stock_provider_timeout")),
      STOCK_IMAGE_LIMITS.requestTimeoutMs,
    );
    request.once("error", () => {
      clearTimeout(deadline);
      if (!settled) reject(providerFailure("Der Stockbildanbieter ist nicht erreichbar."));
    });
    request.end();
  });
}

function singleHeader(
  headers: ProviderResponse["headers"],
  name: string,
) {
  const value = headers[name];
  return Array.isArray(value) ? null : value;
}

async function readBoundedJson(
  response: ProviderResponse,
  maxBytes: number,
) {
  if (response.statusCode !== 200) {
    throw providerFailure("Der Stockbildanbieter hat die Anfrage abgelehnt.");
  }
  const contentType = singleHeader(response.headers, "content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (contentType !== "application/json") {
    throw providerFailure("Der Stockbildanbieter lieferte kein JSON.");
  }
  const encoding = singleHeader(response.headers, "content-encoding");
  if (encoding && encoding.toLowerCase() !== "identity") {
    throw providerFailure("Komprimierte Anbieterantworten werden nicht verarbeitet.");
  }
  const declared = singleHeader(response.headers, "content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) {
    throw providerFailure("Die Anbieterantwort ist zu gross.");
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of response.body) {
    total += chunk.byteLength;
    if (total > maxBytes) throw providerFailure("Die Anbieterantwort ist zu gross.");
    chunks.push(chunk);
  }
  try {
    const body = new TextDecoder("utf-8", { fatal: true }).decode(
      Buffer.concat(chunks, total),
    );
    return JSON.parse(body) as unknown;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw providerFailure("Die Anbieterantwort enthaelt kein gueltiges JSON.");
  }
}

async function readBoundedImage(
  response: ProviderResponse,
  maxBytes: number,
) {
  if (response.statusCode !== 200) {
    throw providerFailure("Der Stockbildanbieter hat den Bildabruf abgelehnt.");
  }
  const contentType = singleHeader(response.headers, "content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (
    !contentType ||
    !["image/jpeg", "image/png", "image/webp", "image/avif", "image/gif"].includes(
      contentType,
    )
  ) {
    throw providerFailure("Der Stockbildanbieter lieferte kein unterstuetztes Bild.");
  }
  const encoding = singleHeader(response.headers, "content-encoding");
  if (encoding && encoding.toLowerCase() !== "identity") {
    throw providerFailure("Komprimierte Stockbilder werden nicht verarbeitet.");
  }
  const declared = singleHeader(response.headers, "content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) {
    throw providerFailure("Das Stockbild ist zu gross.");
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of response.body) {
    total += chunk.byteLength;
    if (total > maxBytes) throw providerFailure("Das Stockbild ist zu gross.");
    chunks.push(chunk);
  }
  if (!total) throw providerFailure("Das Stockbild ist leer.");
  return {
    contentType,
    bytes: Buffer.concat(chunks, total),
  };
}

function providerUrl(configuration: StockImageProviderConfiguration, path: string) {
  return new URL(path.replace(/^\/+/, ""), configuration.baseUrl);
}

async function providerJson(
  url: URL,
  configuration: StockImageProviderConfiguration,
  dependencies: StockImageProviderDependencies,
) {
  if (!configuration.allowedHosts.has(url.hostname.toLowerCase())) {
    throw providerFailure("Das Anbieterziel ist nicht freigegeben.");
  }
  const target = await resolveTarget(url, dependencies);
  const response = await (dependencies.open ?? openPinnedResponse)(
    target,
    configuration.apiKey,
  );
  try {
    return await readBoundedJson(response, STOCK_IMAGE_LIMITS.maxResponseBytes);
  } finally {
    response.close();
  }
}

function validateItem(
  input: unknown,
  configuration: StockImageProviderConfiguration,
) {
  const item = validatedStockImageProviderItem(
    input,
    configuration.allowedHosts,
  );
  if (!item) throw providerFailure("Der Anbieter lieferte ungueltige Bilddaten.");
  return item;
}

export function stockImageProviderStatus() {
  const configuration = stockImageProviderConfiguration();
  return {
    enabled: configuration.enabled,
    provider: configuration.enabled ? configuration.provider : null,
    reason: configuration.enabled ? null : configuration.reason,
  } as const;
}

export async function searchStockImages(
  input: { query: string; page: number; perPage: number },
  dependencies: StockImageProviderDependencies = {},
): Promise<StockImageProviderSearchResponse> {
  const configuration = configured(dependencies);
  const url = providerUrl(configuration, "search");
  url.searchParams.set("query", input.query);
  url.searchParams.set("page", String(input.page));
  url.searchParams.set("per_page", String(input.perPage));
  const parsed = stockImageProviderSearchResponseSchema.safeParse(
    await providerJson(url, configuration, dependencies),
  );
  if (!parsed.success) throw providerFailure("Die Anbieterantwort ist ungueltig.");
  return {
    ...parsed.data,
    results: parsed.data.results.map((item) => validateItem(item, configuration)),
  };
}

export async function getStockImageForSelection(
  externalId: string,
  dependencies: StockImageProviderDependencies = {},
): Promise<{ provider: string; image: StockImageProviderItem }> {
  const configuration = configured(dependencies);
  const response = await providerJson(
    providerUrl(configuration, `images/${encodeURIComponent(externalId)}`),
    configuration,
    dependencies,
  );
  const parsed = stockImageProviderItemResponseSchema.safeParse(response);
  if (!parsed.success || parsed.data.image.id !== externalId) {
    throw providerFailure("Das ausgewaehlte Anbieterbild ist nicht mehr verfuegbar.");
  }
  const image = validateItem(parsed.data.image, configuration);
  const trackingTarget = await resolveTarget(
    new URL(image.downloadTrackingUrl),
    dependencies,
  );
  const trackingResponse = await (dependencies.open ?? openPinnedResponse)(
    trackingTarget,
    configuration.apiKey,
  );
  try {
    await readBoundedJson(
      trackingResponse,
      STOCK_IMAGE_LIMITS.maxTrackingResponseBytes,
    );
  } finally {
    trackingResponse.close();
  }
  return { provider: configuration.provider, image };
}

export async function downloadStockImage(
  imageUrl: string,
  dependencies: StockImageProviderDependencies = {},
) {
  const configuration = configured(dependencies);
  let url: URL;
  try {
    url = new URL(imageUrl);
  } catch {
    throw providerFailure("Die Stockbildadresse ist ungueltig.");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443") ||
    !configuration.allowedHosts.has(url.hostname.toLowerCase())
  ) {
    throw providerFailure("Das Stockbildziel ist nicht freigegeben.");
  }
  const target = await resolveTarget(url, dependencies);
  const response = await (dependencies.open ?? openPinnedResponse)(
    target,
    configuration.apiKey,
  );
  try {
    return await readBoundedImage(response, STOCK_IMAGE_LIMITS.maxImageBytes);
  } finally {
    response.close();
  }
}
