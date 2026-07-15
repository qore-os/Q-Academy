const BUILT_IN_EMBED_PATHS: Readonly<Record<string, RegExp>> = {
  "www.youtube-nocookie.com": /^\/embed\/[A-Za-z0-9_-]{6,64}\/?$/,
  "player.vimeo.com": /^\/video\/[0-9]{4,16}\/?$/,
  "www.loom.com": /^\/embed\/[A-Za-z0-9_-]{6,80}\/?$/,
  "forms.office.com": /^(?:\/Pages\/ResponsePage\.aspx|\/r\/[A-Za-z0-9_-]{4,80})$/i,
  "docs.google.com": /^\/forms\/d\/e\/[A-Za-z0-9_-]{10,200}\/viewform\/?$/,
};

function configuredHosts() {
  return new Set(
    (process.env.HUB_EMBED_HOST_ALLOWLIST ?? "")
      .split(",")
      .map((host) => host.trim().toLowerCase().replace(/\.$/, ""))
      .filter((host) =>
        /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?))+$/.test(
          host,
        ),
      ),
  );
}

function safeEmbedUrl(value: unknown, allowConfiguredHosts: boolean) {
  if (typeof value !== "string" || value.length > 2000) return null;
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      (url.port && url.port !== "443") ||
      url.hash
    ) {
      return null;
    }
    const builtInPath = BUILT_IN_EMBED_PATHS[hostname];
    if (
      !builtInPath?.test(url.pathname) &&
      !(allowConfiguredHosts && configuredHosts().has(hostname))
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

export function safeCourseEmbedUrl(value: unknown) {
  return safeEmbedUrl(value, false);
}

export function safeHubEmbedUrl(value: unknown) {
  return safeEmbedUrl(value, true);
}

export function hubEmbedAllowedHosts() {
  return [...new Set([...Object.keys(BUILT_IN_EMBED_PATHS), ...configuredHosts()])]
    .sort();
}
