type TrustedMutationOriginInput = {
  request: Request;
  trustProxyHeaders: boolean;
};

function firstHeaderValue(value: string | null) {
  return value?.split(",", 1)[0]?.trim().toLowerCase() || null;
}

function normalizedOrigin(value: string) {
  try {
    const url = new URL(value);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

function externalRequestOrigin(input: TrustedMutationOriginInput) {
  const requestUrl = new URL(input.request.url);
  const host = firstHeaderValue(
    input.trustProxyHeaders
      ? input.request.headers.get("x-forwarded-host")
      : input.request.headers.get("host"),
  );
  const protocol = input.trustProxyHeaders
    ? firstHeaderValue(input.request.headers.get("x-forwarded-proto"))
    : requestUrl.protocol.slice(0, -1).toLowerCase();
  if (!host || !protocol || !["http", "https"].includes(protocol)) return null;
  return normalizedOrigin(`${protocol}://${host}`);
}

export function isTrustedMutationOrigin(input: TrustedMutationOriginInput) {
  const origin = input.request.headers.get("origin");
  if (!origin) {
    return input.request.headers.get("sec-fetch-site")?.toLowerCase() !== "cross-site";
  }
  const suppliedOrigin = normalizedOrigin(origin);
  const expectedOrigin = externalRequestOrigin(input);
  return suppliedOrigin !== null && expectedOrigin !== null && suppliedOrigin === expectedOrigin;
}
