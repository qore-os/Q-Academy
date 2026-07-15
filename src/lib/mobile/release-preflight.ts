import { mobileAssociationConfiguration } from "@/lib/mobile/association";
import {
  IOS_RELEASE_BUILD_SETTING_KEYS,
  iosReleaseBuildSettings,
  parseIosReleaseXcconfig,
} from "@/lib/mobile/ios-build-settings";

export type MobileReleasePlatform = "android" | "ios" | "all";

type Environment = Readonly<Record<string, string | undefined>>;
type ReleaseFiles = Readonly<Record<string, string | undefined>>;

const BUNDLE_ID_PATTERN =
  /^[A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*)+$/;
const PEM_PRIVATE_KEY_BEGIN = ["-----BEGIN", "PRIVATE KEY-----"].join(" ");
const PEM_PRIVATE_KEY_END = ["-----END", "PRIVATE KEY-----"].join(" ");
const PEM_PRIVATE_KEY_PATTERN = new RegExp(
  `^${PEM_PRIVATE_KEY_BEGIN}\\n[\\s\\S]+\\n${PEM_PRIVATE_KEY_END}$`,
);

function value(environment: Environment, key: string) {
  return environment[key]?.trim() ?? "";
}

function normalizedPrivateKey(input: string) {
  return input.replaceAll("\\n", "\n").trim();
}

function required(
  errors: string[],
  environment: Environment,
  keys: readonly string[],
) {
  for (const key of keys) {
    if (!value(environment, key)) errors.push(`${key} is required.`);
  }
}

function checkPrivateKey(
  errors: string[],
  environment: Environment,
  key: string,
) {
  const configured = value(environment, key);
  if (
    configured &&
    !PEM_PRIVATE_KEY_PATTERN.test(normalizedPrivateKey(configured))
  ) {
    errors.push(`${key} must contain a PKCS#8 PEM private key.`);
  }
}

function parseGoogleServices(
  errors: string[],
  source: string | undefined,
  projectId: string,
  bundleId: string,
) {
  if (!source) {
    errors.push("android/app/google-services.json is required for Android push.");
    return;
  }
  try {
    const parsed = JSON.parse(source) as {
      project_info?: { project_id?: unknown };
      client?: Array<{
        client_info?: { android_client_info?: { package_name?: unknown } };
      }>;
    };
    if (parsed.project_info?.project_id !== projectId) {
      errors.push("google-services.json project_id must match FCM_PROJECT_ID.");
    }
    const packages = (parsed.client ?? []).map(
      (client) => client.client_info?.android_client_info?.package_name,
    );
    if (!packages.includes(bundleId)) {
      errors.push(
        "google-services.json must contain a client for MOBILE_APP_BUNDLE_ID.",
      );
    }
  } catch {
    errors.push("android/app/google-services.json is not valid JSON.");
  }
}

function requireFileContains(
  errors: string[],
  files: ReleaseFiles,
  path: string,
  patterns: readonly RegExp[],
) {
  const source = files[path];
  if (source === undefined) {
    errors.push(`Missing native project file: ${path}`);
    return;
  }
  for (const pattern of patterns) {
    if (!pattern.test(source)) {
      errors.push(`${path} is missing release contract ${pattern.source}.`);
    }
  }
}

export function collectMobileReleasePreflightErrors(
  environment: Environment,
  files: ReleaseFiles,
  platform: MobileReleasePlatform = "all",
) {
  const errors: string[] = [];
  const android = platform === "android" || platform === "all";
  const ios = platform === "ios" || platform === "all";
  const appName = value(environment, "MOBILE_APP_NAME");
  const bundleId = value(environment, "MOBILE_APP_BUNDLE_ID");
  const serverUrlValue = value(environment, "CAPACITOR_SERVER_URL");
  let serverUrl: URL | null = null;
  try {
    serverUrl = new URL(serverUrlValue);
    if (
      serverUrl.protocol !== "https:" ||
      serverUrl.username ||
      serverUrl.password ||
      serverUrl.search ||
      serverUrl.hash ||
      (serverUrl.pathname !== "/" && serverUrl.pathname !== "")
    ) {
      throw new Error("invalid");
    }
  } catch {
    errors.push(
      "CAPACITOR_SERVER_URL must be a credential-free HTTPS origin without path, query or fragment.",
    );
  }
  if (
    !/^[\p{L}\p{N}][\p{L}\p{N} .&'()_+-]{0,29}$/u.test(appName)
  ) {
    errors.push(
      "MOBILE_APP_NAME must contain 1-30 display-safe letters, numbers or separators.",
    );
  }
  if (!BUNDLE_ID_PATTERN.test(bundleId)) {
    errors.push("MOBILE_APP_BUNDLE_ID must be a reverse-DNS application id.");
  }
  const associationDomain = value(environment, "MOBILE_ASSOCIATED_DOMAIN");
  if (
    !associationDomain ||
    associationDomain.includes(":") ||
    associationDomain.includes("/") ||
    associationDomain !== serverUrl?.hostname
  ) {
    errors.push(
      "MOBILE_ASSOCIATED_DOMAIN must exactly match the CAPACITOR_SERVER_URL hostname.",
    );
  }
  const association = mobileAssociationConfiguration(environment);
  if (!value(environment, "MOBILE_APP_URL_SCHEME") || !association.urlScheme) {
    errors.push("MOBILE_APP_URL_SCHEME is missing or invalid.");
  }
  if (!/^\d+$/.test(value(environment, "MOBILE_BUILD_NUMBER"))) {
    errors.push("MOBILE_BUILD_NUMBER must be a positive integer.");
  } else if (
    Number(value(environment, "MOBILE_BUILD_NUMBER")) < 1 ||
    Number(value(environment, "MOBILE_BUILD_NUMBER")) > 2_100_000_000
  ) {
    errors.push("MOBILE_BUILD_NUMBER must be a positive integer.");
  }
  if (!/^\d+\.\d+\.\d+$/.test(value(environment, "MOBILE_VERSION"))) {
    errors.push("MOBILE_VERSION must use semantic x.y.z notation.");
  }

  requireFileContains(errors, files, "capacitor.config.ts", [
    /allowMixedContent:\s*false/,
    /limitsNavigationsToAppBoundDomains:\s*true/,
    /loggingBehavior:\s*"none"/,
  ]);

  if (android) {
    if (!association.androidCertificateFingerprints.length) {
      errors.push(
        "ANDROID_APP_SHA256_CERT_FINGERPRINTS is missing or invalid.",
      );
    }
    const rawFingerprints = value(
      environment,
      "ANDROID_APP_SHA256_CERT_FINGERPRINTS",
    )
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
    if (
      rawFingerprints.length !==
      association.androidCertificateFingerprints.length
    ) {
      errors.push(
        "ANDROID_APP_SHA256_CERT_FINGERPRINTS contains an invalid fingerprint.",
      );
    }
    if (new Set(rawFingerprints.map((entry) => entry.toUpperCase())).size !== rawFingerprints.length) {
      errors.push("ANDROID_APP_SHA256_CERT_FINGERPRINTS contains duplicates.");
    }
    required(errors, environment, [
      "FCM_PROJECT_ID",
      "FCM_SERVICE_ACCOUNT_CLIENT_EMAIL",
      "FCM_SERVICE_ACCOUNT_PRIVATE_KEY",
      "ANDROID_KEYSTORE_PATH",
      "ANDROID_KEY_ALIAS",
      "ANDROID_KEYSTORE_PASSWORD",
      "ANDROID_KEY_PASSWORD",
    ]);
    if (
      value(environment, "FCM_SERVICE_ACCOUNT_CLIENT_EMAIL") &&
      !/^[^\s@]+@[^\s@]+\.iam\.gserviceaccount\.com$/.test(
        value(environment, "FCM_SERVICE_ACCOUNT_CLIENT_EMAIL"),
      )
    ) {
      errors.push("FCM_SERVICE_ACCOUNT_CLIENT_EMAIL is invalid.");
    }
    if (
      value(environment, "FCM_PROJECT_ID") &&
      value(environment, "FCM_SERVICE_ACCOUNT_CLIENT_EMAIL") &&
      !value(environment, "FCM_SERVICE_ACCOUNT_CLIENT_EMAIL").endsWith(
        `@${value(environment, "FCM_PROJECT_ID")}.iam.gserviceaccount.com`,
      )
    ) {
      errors.push(
        "FCM_SERVICE_ACCOUNT_CLIENT_EMAIL must belong to FCM_PROJECT_ID.",
      );
    }
    if (
      value(environment, "FCM_PROJECT_ID") &&
      !/^[a-z][a-z0-9-]{4,62}$/.test(value(environment, "FCM_PROJECT_ID"))
    ) {
      errors.push("FCM_PROJECT_ID is invalid.");
    }
    checkPrivateKey(errors, environment, "FCM_SERVICE_ACCOUNT_PRIVATE_KEY");
    parseGoogleServices(
      errors,
      files["android/app/google-services.json"],
      value(environment, "FCM_PROJECT_ID"),
      bundleId,
    );
    requireFileContains(
      errors,
      files,
      "android/app/src/main/AndroidManifest.xml",
      [
        /android:usesCleartextTraffic="false"/,
        /android:autoVerify="true"/,
        /android:label="\$\{academyAppName\}"/,
        /android:path="\/academy"/,
        /android:pathPrefix="\/academy\/"/,
        /android:path="\/login"/,
        /android:pathPrefix="\/login\/"/,
        /android:scheme="\$\{academyScheme\}"/,
        /android:allowBackup="false"/,
      ],
    );
    requireFileContains(errors, files, "android/app/build.gradle", [
      /signingConfigs\s*\{/,
      /minifyEnabled true/,
      /shrinkResources true/,
      /mobileVersionCode/,
      /mobileVersionName/,
      /System\.getenv\("MOBILE_APP_NAME"\)/,
      /System\.getenv\("MOBILE_APP_BUNDLE_ID"\)/,
      /System\.getenv\("MOBILE_ASSOCIATED_DOMAIN"\)/,
      /System\.getenv\("MOBILE_APP_URL_SCHEME"\)/,
    ]);
  }

  if (ios) {
    if (!association.appleAppId) {
      errors.push("APPLE_TEAM_ID is missing or invalid.");
    }
    if (
      value(environment, "APPLE_TEAM_ID").toUpperCase() !==
      value(environment, "APNS_TEAM_ID").toUpperCase()
    ) {
      errors.push("APPLE_TEAM_ID must match APNS_TEAM_ID.");
    }
    if (
      value(environment, "APNS_KEY_ID") &&
      !/^[A-Z0-9]{10}$/.test(value(environment, "APNS_KEY_ID"))
    ) {
      errors.push("APNS_KEY_ID is invalid.");
    }
    required(errors, environment, [
      "APNS_TEAM_ID",
      "APNS_KEY_ID",
      "APNS_PRIVATE_KEY",
      "APNS_BUNDLE_ID",
    ]);
    if (value(environment, "APNS_BUNDLE_ID") !== bundleId) {
      errors.push("APNS_BUNDLE_ID must match MOBILE_APP_BUNDLE_ID.");
    }
    if (value(environment, "APNS_PRODUCTION") !== "true") {
      errors.push("APNS_PRODUCTION must be true for a release preflight.");
    }
    checkPrivateKey(errors, environment, "APNS_PRIVATE_KEY");
    const releaseSettingsSource = files["ios/release.xcconfig"];
    if (releaseSettingsSource === undefined) {
      errors.push("Missing native project file: ios/release.xcconfig");
    } else {
      const actualSettings = parseIosReleaseXcconfig(releaseSettingsSource);
      const expectedSettings = iosReleaseBuildSettings(environment);
      for (const key of IOS_RELEASE_BUILD_SETTING_KEYS) {
        if (actualSettings[key] !== expectedSettings[key]) {
          errors.push(
            `ios/release.xcconfig ${key} must match the release environment.`,
          );
        }
      }
    }
    requireFileContains(errors, files, "ios/App/App/App.entitlements", [
      /aps-environment/,
      /applinks:\$\(ACADEMY_ASSOCIATED_DOMAIN\)/,
    ]);
    requireFileContains(errors, files, "ios/App/App/Info.plist", [
      /\$\(MOBILE_APP_NAME\)/,
      /\$\(MOBILE_APP_BUNDLE_ID\)/,
      /\$\(MOBILE_APP_URL_SCHEME\)/,
      /UISupportedInterfaceOrientations~ipad/,
    ]);
    requireFileContains(errors, files, "ios/App/App/PrivacyInfo.xcprivacy", [
      /NSPrivacyTracking/,
      /NSPrivacyCollectedDataTypes/,
      /NSPrivacyAccessedAPITypes/,
    ]);
    requireFileContains(
      errors,
      files,
      "ios/App/App.xcodeproj/project.pbxproj",
      [
        /PrivacyInfo\.xcprivacy in Resources/,
        /baseConfigurationReference = .*release\.xcconfig/,
        /ACADEMY_ASSOCIATED_DOMAIN/,
        /MOBILE_APP_NAME/,
        /MOBILE_APP_BUNDLE_ID/,
        /MOBILE_APP_URL_SCHEME/,
      ],
    );
  }
  return errors;
}
