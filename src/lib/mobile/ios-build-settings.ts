type Environment = Readonly<Record<string, string | undefined>>;

export const IOS_RELEASE_BUILD_SETTING_KEYS = [
  "MOBILE_APP_NAME",
  "MOBILE_APP_BUNDLE_ID",
  "MOBILE_APP_URL_SCHEME",
  "ACADEMY_ASSOCIATED_DOMAIN",
  "CURRENT_PROJECT_VERSION",
  "MARKETING_VERSION",
  "DEVELOPMENT_TEAM",
  "APS_ENVIRONMENT",
] as const;

export type IosReleaseBuildSettings = Record<
  (typeof IOS_RELEASE_BUILD_SETTING_KEYS)[number],
  string
>;

function value(
  environment: Environment,
  key: string,
  fallback = "",
) {
  return environment[key]?.trim() || fallback;
}

export function iosReleaseBuildSettings(
  environment: Environment,
): IosReleaseBuildSettings {
  return {
    MOBILE_APP_NAME: value(environment, "MOBILE_APP_NAME", "Q-Academy"),
    MOBILE_APP_BUNDLE_ID: value(
      environment,
      "MOBILE_APP_BUNDLE_ID",
      "com.qacademy.mobile",
    ),
    MOBILE_APP_URL_SCHEME: value(
      environment,
      "MOBILE_APP_URL_SCHEME",
      "qacademy",
    ),
    ACADEMY_ASSOCIATED_DOMAIN: value(
      environment,
      "MOBILE_ASSOCIATED_DOMAIN",
      "academy.example.invalid",
    ),
    CURRENT_PROJECT_VERSION: value(
      environment,
      "MOBILE_BUILD_NUMBER",
      "1",
    ),
    MARKETING_VERSION: value(environment, "MOBILE_VERSION", "1.0.0"),
    DEVELOPMENT_TEAM: value(environment, "APPLE_TEAM_ID").toUpperCase(),
    APS_ENVIRONMENT: "production",
  };
}

export function renderIosReleaseXcconfig(environment: Environment) {
  const settings = iosReleaseBuildSettings(environment);
  return `${IOS_RELEASE_BUILD_SETTING_KEYS.map(
    (key) => `${key} = ${settings[key]}`,
  ).join("\n")}\n`;
}

export function parseIosReleaseXcconfig(source: string) {
  const parsed: Partial<IosReleaseBuildSettings> = {};
  for (const line of source.split(/\r?\n/)) {
    const match = /^([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match) continue;
    const key = match[1] as keyof IosReleaseBuildSettings;
    if (IOS_RELEASE_BUILD_SETTING_KEYS.includes(key)) {
      parsed[key] = match[2] ?? "";
    }
  }
  return parsed;
}
