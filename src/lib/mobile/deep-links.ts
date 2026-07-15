const CUSTOM_SCHEMES = new Set(["qacademy:", "com.qacademy.mobile:"]);

function safeAppPath(pathname: string) {
  return (
    pathname === "/academy" ||
    pathname.startsWith("/academy/") ||
    pathname === "/login" ||
    pathname.startsWith("/login/")
  );
}

export function safeNativeDeepLinkPath(
  rawUrl: string,
  currentOrigin: string,
  customSchemes: readonly string[] = [],
) {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.origin === currentOrigin) {
      if (parsed.username || parsed.password || !safeAppPath(parsed.pathname)) {
        return null;
      }
      return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    }
    const allowedSchemes = new Set([
      ...CUSTOM_SCHEMES,
      ...customSchemes.map((scheme) =>
        `${scheme.trim().toLowerCase().replace(/:$/, "")}:`,
      ),
    ]);
    if (!allowedSchemes.has(parsed.protocol.toLowerCase())) return null;
    const customPath = `/${[
      parsed.hostname,
      parsed.pathname.replace(/^\/+/, ""),
    ]
      .filter(Boolean)
      .join("/")}`;
    if (!safeAppPath(customPath)) return null;
    return `${customPath}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}
