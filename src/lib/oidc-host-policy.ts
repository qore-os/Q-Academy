type CanonicalOidcOriginInput = {
  production: boolean;
  developmentOrigin?: string | null;
  loginHostname?: string | null;
  organizationSlug?: string | null;
  tenantBaseDomain?: string | null;
  publicAppUrl: string;
};

function httpOrigin(value: string | null | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.origin
      : null;
  } catch {
    return null;
  }
}

export function canonicalOidcOrigin(input: CanonicalOidcOriginInput) {
  const publicOrigin = httpOrigin(input.publicAppUrl);
  if (!publicOrigin) throw new Error("The public application URL is invalid.");
  if (!input.production) {
    return httpOrigin(input.developmentOrigin) ?? publicOrigin;
  }
  if (input.loginHostname) return `https://${input.loginHostname}`;
  if (input.tenantBaseDomain && input.organizationSlug) {
    return `https://${input.organizationSlug}.${input.tenantBaseDomain}`;
  }
  return publicOrigin;
}
