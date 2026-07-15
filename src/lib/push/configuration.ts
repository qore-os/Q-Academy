import { createECDH, timingSafeEqual } from "node:crypto";

export type WebPushConfiguration = {
  publicKey: string;
  privateKey: string;
  subject: string;
};

export class WebPushConfigurationError extends Error {
  readonly issues: readonly string[];

  constructor(issues: string[]) {
    super(issues.join(" "));
    this.name = "WebPushConfigurationError";
    this.issues = issues;
  }
}

type EnvironmentSource = Record<string, string | undefined>;

function valueOf(environment: EnvironmentSource, name: string) {
  return environment[name]?.trim() ?? "";
}

function reservedHostname(hostname: string) {
  const value = hostname.toLowerCase().replace(/\.$/, "");
  return (
    value === "localhost" ||
    value.endsWith(".localhost") ||
    value === "127.0.0.1" ||
    value === "::1" ||
    value === "example.com" ||
    value.endsWith(".example.com") ||
    value === "example.net" ||
    value.endsWith(".example.net") ||
    value === "example.org" ||
    value.endsWith(".example.org") ||
    value.endsWith(".example") ||
    value.endsWith(".invalid") ||
    value.endsWith(".test")
  );
}

function decodeKey(value: string, name: string, length: number, issues: string[]) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    issues.push(`${name} must be unpadded URL-safe base64.`);
    return null;
  }
  const decoded = Buffer.from(value, "base64url");
  if (decoded.length !== length || decoded.toString("base64url") !== value) {
    issues.push(`${name} must encode exactly ${length} bytes.`);
    return null;
  }
  return decoded;
}

function validSubject(value: string, production: boolean, issues: string[]) {
  if (value.startsWith("mailto:")) {
    const address = value.slice(7).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      issues.push("WEB_PUSH_VAPID_SUBJECT must contain a valid mailto address.");
      return null;
    }
    const hostname = address.slice(address.lastIndexOf("@") + 1);
    if (production && reservedHostname(hostname)) {
      issues.push("WEB_PUSH_VAPID_SUBJECT must not use a local or reserved domain.");
      return null;
    }
    return `mailto:${address}`;
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) throw new Error();
    if (production && reservedHostname(url.hostname)) {
      issues.push("WEB_PUSH_VAPID_SUBJECT must not use a local or reserved domain.");
      return null;
    }
    return url.toString();
  } catch {
    issues.push("WEB_PUSH_VAPID_SUBJECT must be an HTTPS or mailto URI.");
    return null;
  }
}

export function resolveWebPushConfiguration(
  environment: EnvironmentSource,
  options: { required: boolean; production: boolean },
): WebPushConfiguration | null {
  const publicKeyValue = valueOf(environment, "WEB_PUSH_VAPID_PUBLIC_KEY");
  const privateKeyValue = valueOf(environment, "WEB_PUSH_VAPID_PRIVATE_KEY");
  const subjectValue = valueOf(environment, "WEB_PUSH_VAPID_SUBJECT");
  const configured = Boolean(publicKeyValue || privateKeyValue || subjectValue);
  if (!configured && !options.required) return null;

  const issues: string[] = [];
  if (!publicKeyValue) issues.push("WEB_PUSH_VAPID_PUBLIC_KEY is required.");
  if (!privateKeyValue) issues.push("WEB_PUSH_VAPID_PRIVATE_KEY is required.");
  if (!subjectValue) issues.push("WEB_PUSH_VAPID_SUBJECT is required.");
  const publicKey = publicKeyValue
    ? decodeKey(publicKeyValue, "WEB_PUSH_VAPID_PUBLIC_KEY", 65, issues)
    : null;
  const privateKey = privateKeyValue
    ? decodeKey(privateKeyValue, "WEB_PUSH_VAPID_PRIVATE_KEY", 32, issues)
    : null;
  const subject = subjectValue
    ? validSubject(subjectValue, options.production, issues)
    : null;

  if (publicKey?.[0] !== 4) {
    issues.push("WEB_PUSH_VAPID_PUBLIC_KEY must be an uncompressed P-256 key.");
  }
  if (publicKey && privateKey) {
    try {
      const ecdh = createECDH("prime256v1");
      ecdh.setPrivateKey(privateKey);
      const derivedPublicKey = ecdh.getPublicKey(undefined, "uncompressed");
      if (
        derivedPublicKey.length !== publicKey.length ||
        !timingSafeEqual(derivedPublicKey, publicKey)
      ) {
        issues.push("WEB_PUSH_VAPID_PUBLIC_KEY does not match the private key.");
      }
    } catch {
      issues.push("WEB_PUSH_VAPID_PRIVATE_KEY is not a valid P-256 private key.");
    }
  }
  if (issues.length > 0) throw new WebPushConfigurationError(issues);
  return {
    publicKey: publicKeyValue,
    privateKey: privateKeyValue,
    subject: subject!,
  };
}
