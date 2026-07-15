const APP_ID_PATTERN = /^[A-Z0-9]{10}\.[A-Za-z0-9.-]+$/;
const CERTIFICATE_FINGERPRINT_PATTERN = /^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/;
const URL_SCHEME_PATTERN = /^[a-z][a-z0-9+.-]{2,63}$/;
const RESERVED_URL_SCHEMES = new Set([
  "data",
  "file",
  "http",
  "https",
  "javascript",
]);

export function mobileAssociationConfiguration(
  environment: Readonly<Record<string, string | undefined>>,
) {
  const bundleId = environment.MOBILE_APP_BUNDLE_ID?.trim() || "com.qacademy.mobile";
  const teamId = environment.APPLE_TEAM_ID?.trim().toUpperCase() || "";
  const appleAppId = teamId ? `${teamId}.${bundleId}` : "";
  const fingerprints = (environment.ANDROID_APP_SHA256_CERT_FINGERPRINTS ?? "")
    .split(",")
    .map((entry) => entry.trim().toUpperCase())
    .filter(Boolean);
  const requestedUrlScheme =
    environment.MOBILE_APP_URL_SCHEME?.trim().toLowerCase() || "qacademy";

  return {
    appleAppId: APP_ID_PATTERN.test(appleAppId) ? appleAppId : null,
    androidPackageName: bundleId,
    androidCertificateFingerprints: fingerprints.filter((entry) =>
      CERTIFICATE_FINGERPRINT_PATTERN.test(entry),
    ),
    urlScheme:
      URL_SCHEME_PATTERN.test(requestedUrlScheme) &&
      !RESERVED_URL_SCHEMES.has(requestedUrlScheme)
      ? requestedUrlScheme
      : null,
  };
}

export function appleAppSiteAssociation(appId: string) {
  return {
    applinks: {
      apps: [],
      details: [
        {
          appID: appId,
          components: [
            { "/": "/academy", comment: "Authenticated member start route" },
            { "/": "/academy/*", comment: "Authenticated member routes" },
            { "/": "/login", comment: "Tenant login route" },
            { "/": "/login/*", comment: "Tenant login and account switching" },
          ],
        },
      ],
    },
  };
}

export function androidAssetLinks(
  packageName: string,
  fingerprints: readonly string[],
) {
  return [
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: packageName,
        sha256_cert_fingerprints: [...fingerprints],
      },
    },
  ];
}
