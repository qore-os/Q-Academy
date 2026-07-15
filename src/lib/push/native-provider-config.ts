import "server-only";

type Environment = Readonly<Record<string, string | undefined>>;

function value(environment: Environment, key: string) {
  return environment[key]?.trim() || null;
}

function normalizedPrivateKey(input: string) {
  return input.includes("\\n") ? input.replaceAll("\\n", "\n") : input;
}

export function resolveNativePushProviderConfiguration(
  environment: Environment = process.env,
) {
  const fcmValues = {
    projectId: value(environment, "FCM_PROJECT_ID"),
    clientEmail: value(environment, "FCM_SERVICE_ACCOUNT_CLIENT_EMAIL"),
    privateKey: value(environment, "FCM_SERVICE_ACCOUNT_PRIVATE_KEY"),
  };
  const apnsValues = {
    teamId: value(environment, "APNS_TEAM_ID"),
    keyId: value(environment, "APNS_KEY_ID"),
    privateKey: value(environment, "APNS_PRIVATE_KEY"),
    bundleId:
      value(environment, "APNS_BUNDLE_ID") ??
      value(environment, "MOBILE_APP_BUNDLE_ID") ??
      "com.qacademy.mobile",
    production: value(environment, "APNS_PRODUCTION") === "true",
  };
  const fcmConfigured = Object.values(fcmValues).some(Boolean);
  const apnsConfigured = [
    apnsValues.teamId,
    apnsValues.keyId,
    apnsValues.privateKey,
  ].some(Boolean);
  if (fcmConfigured && Object.values(fcmValues).some((entry) => !entry)) {
    throw new Error("FCM native push configuration is incomplete.");
  }
  if (
    apnsConfigured &&
    [apnsValues.teamId, apnsValues.keyId, apnsValues.privateKey].some(
      (entry) => !entry,
    )
  ) {
    throw new Error("APNs native push configuration is incomplete.");
  }
  if (fcmValues.clientEmail && !/^[^\s@]+@[^\s@]+$/.test(fcmValues.clientEmail)) {
    throw new Error("FCM client email is invalid.");
  }
  if (fcmValues.projectId && !/^[a-z][a-z0-9-]{4,62}$/.test(fcmValues.projectId)) {
    throw new Error("FCM project id is invalid.");
  }
  if (apnsValues.teamId && !/^[A-Z0-9]{10}$/.test(apnsValues.teamId)) {
    throw new Error("APNs team id is invalid.");
  }
  if (apnsValues.keyId && !/^[A-Z0-9]{10}$/.test(apnsValues.keyId)) {
    throw new Error("APNs key id is invalid.");
  }
  return {
    android:
      fcmValues.projectId && fcmValues.clientEmail && fcmValues.privateKey
        ? {
            projectId: fcmValues.projectId,
            clientEmail: fcmValues.clientEmail,
            privateKey: normalizedPrivateKey(fcmValues.privateKey),
          }
        : null,
    ios:
      apnsValues.teamId && apnsValues.keyId && apnsValues.privateKey
        ? {
            teamId: apnsValues.teamId,
            keyId: apnsValues.keyId,
            privateKey: normalizedPrivateKey(apnsValues.privateKey),
            bundleId: apnsValues.bundleId,
            production: apnsValues.production,
          }
        : null,
  };
}
