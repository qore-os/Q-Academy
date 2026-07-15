const NONCE_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

export const resourceContentSecurityPolicy = [
  "default-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
].join("; ");

export const browserPermissionsPolicy = [
  "accelerometer=()",
  "autoplay=(self)",
  "browsing-topics=()",
  "camera=(self)",
  "display-capture=(self)",
  "fullscreen=*",
  "geolocation=()",
  "gyroscope=()",
  "hid=()",
  "magnetometer=()",
  "microphone=(self)",
  "payment=()",
  "picture-in-picture=*",
  "publickey-credentials-get=(self)",
  "serial=()",
  "usb=()",
].join(", ");

export function createContentSecurityPolicyNonce() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export function buildDocumentContentSecurityPolicy(input: {
  nonce: string;
  development: boolean;
  upgradeInsecureRequests: boolean;
}) {
  if (!NONCE_PATTERN.test(input.nonce)) {
    throw new Error("CSP nonce must be an unpadded URL-safe random value.");
  }

  const remoteSources = input.development ? "https: http:" : "https:";
  const connectSources = input.development
    ? "connect-src 'self' https: http: wss: ws:"
    : "connect-src 'self' https: wss:";
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${input.nonce}' 'strict-dynamic'${input.development ? " 'unsafe-eval'" : ""}`,
    "script-src-attr 'none'",
    // Sonner injects its packaged stylesheet at runtime and the UI uses safe React style props.
    "style-src 'self' 'unsafe-inline'",
    "style-src-attr 'unsafe-inline'",
    `img-src 'self' blob: data: ${remoteSources}`,
    `media-src 'self' blob: ${remoteSources}`,
    "font-src 'self' data:",
    connectSources,
    // Custom-code slots use sandboxed srcdoc frames that inherit this policy.
    `frame-src 'self' ${remoteSources}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
    ...(input.upgradeInsecureRequests ? ["upgrade-insecure-requests"] : []),
  ];

  return directives.join("; ");
}
