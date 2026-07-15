import { isIP } from "node:net";
import { domainToASCII } from "node:url";

export type CanonicalAppHostnameResolution =
  | { status: "resolved"; hostname: string }
  | { status: "unconfigured"; hostname: null }
  | { status: "invalid"; hostname: null };

export function normalizeConfiguredHostname(
  value: string | null | undefined,
) {
  const raw = value?.trim().toLowerCase().replace(/\.$/, "") ?? "";
  if (!raw || raw.length > 253 || raw.includes("/") || /[\r\n*]/.test(raw)) {
    return null;
  }
  if (raw.startsWith("[")) {
    const match = /^\[([^\]]+)]$/.exec(raw);
    return match?.[1] && isIP(match[1]) === 6 ? match[1] : null;
  }
  if (isIP(raw) > 0) return raw;
  if (raw.includes(":")) return null;

  const ascii = domainToASCII(raw).toLowerCase();
  if (!ascii || ascii.length > 253) return null;
  return ascii
    .split(".")
    .every(
      (label) =>
        label.length > 0 &&
        label.length <= 63 &&
        /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label),
    )
    ? ascii
    : null;
}

export function publicAppUrlHostname(
  value: string | null | undefined,
) {
  const raw = value?.trim() ?? "";
  if (!raw) return null;
  try {
    const url = new URL(raw);
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
    return normalizeConfiguredHostname(url.hostname);
  } catch {
    return null;
  }
}

export function resolveCanonicalAppHostname(input: {
  appDomain?: string | null;
  publicAppUrl?: string | null;
}): CanonicalAppHostnameResolution {
  const hasAppDomain = Boolean(input.appDomain?.trim());
  const hasPublicAppUrl = Boolean(input.publicAppUrl?.trim());
  if (!hasAppDomain && !hasPublicAppUrl) {
    return { status: "unconfigured", hostname: null };
  }

  const appDomain = hasAppDomain
    ? normalizeConfiguredHostname(input.appDomain)
    : null;
  const publicAppHostname = hasPublicAppUrl
    ? publicAppUrlHostname(input.publicAppUrl)
    : null;
  if (
    (hasAppDomain && !appDomain) ||
    (hasPublicAppUrl && !publicAppHostname) ||
    (appDomain && publicAppHostname && appDomain !== publicAppHostname)
  ) {
    return { status: "invalid", hostname: null };
  }

  return {
    status: "resolved",
    hostname: appDomain ?? publicAppHostname!,
  };
}
