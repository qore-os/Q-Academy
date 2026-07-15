import type { CapacitorConfig } from "@capacitor/cli";

const serverUrl = process.env.CAPACITOR_SERVER_URL?.trim();
if (serverUrl && !/^https:\/\/[^\s/]+(?:\/.*)?$/i.test(serverUrl)) {
  throw new Error("CAPACITOR_SERVER_URL must be an absolute HTTPS URL.");
}
const appName = process.env.MOBILE_APP_NAME?.trim() || "Q-Academy";
if (!/^[\p{L}\p{N}][\p{L}\p{N} .&'()_+-]{0,29}$/u.test(appName)) {
  throw new Error(
    "MOBILE_APP_NAME must contain 1-30 display-safe letters, numbers or separators.",
  );
}
const appId = process.env.MOBILE_APP_BUNDLE_ID?.trim() || "com.qacademy.mobile";
if (!/^[A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*)+$/.test(appId)) {
  throw new Error("MOBILE_APP_BUNDLE_ID must be a reverse-DNS application id.");
}
const urlScheme = process.env.MOBILE_APP_URL_SCHEME?.trim() || "qacademy";
if (
  !/^[a-z][a-z0-9+.-]{2,63}$/.test(urlScheme) ||
  ["data", "file", "http", "https", "javascript"].includes(urlScheme)
) {
  throw new Error("MOBILE_APP_URL_SCHEME must be a valid lowercase URL scheme.");
}

const config: CapacitorConfig = {
  appId,
  appName,
  webDir: "mobile-shell",
  backgroundColor: "#f6f8fb",
  loggingBehavior: "none",
  server: serverUrl
    ? {
        url: serverUrl,
        cleartext: false,
      }
    : {
        hostname: "app.q-academy.local",
        androidScheme: "https",
        iosScheme: "https",
      },
  android: {
    allowMixedContent: false,
    captureInput: true,
  },
  ios: {
    contentInset: "automatic",
    limitsNavigationsToAppBoundDomains: true,
    preferredContentMode: "mobile",
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: true,
      launchShowDuration: 800,
      backgroundColor: "#f6f8fb",
      showSpinner: false,
    },
  },
};

export default config;
