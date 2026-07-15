import { existsSync, readFileSync } from "node:fs";

import {
  collectMobileReleasePreflightErrors,
  type MobileReleasePlatform,
} from "../src/lib/mobile/release-preflight";
import { loadProjectEnvironment } from "./load-environment";

loadProjectEnvironment();

const requestedPlatform = process.argv
  .find((argument) => argument.startsWith("--platform="))
  ?.slice("--platform=".length);
if (
  requestedPlatform &&
  !["android", "ios", "all"].includes(requestedPlatform)
) {
  console.error("Native release preflight failed:\n- --platform must be android, ios or all.");
  process.exit(1);
}
const platform = (requestedPlatform ?? "all") as MobileReleasePlatform;
const paths = [
  "capacitor.config.ts",
  "android/app/src/main/AndroidManifest.xml",
  "android/app/build.gradle",
  "android/app/google-services.json",
  "ios/App/App/App.entitlements",
  "ios/App/App/Info.plist",
  "ios/App/App/PrivacyInfo.xcprivacy",
  "ios/App/App.xcodeproj/project.pbxproj",
  "ios/release.xcconfig",
] as const;
const files = Object.fromEntries(
  paths.map((path) => [
    path,
    existsSync(path) ? readFileSync(path, "utf8") : undefined,
  ]),
);
const errors = collectMobileReleasePreflightErrors(
  process.env,
  files,
  platform,
);
if (
  (platform === "android" || platform === "all") &&
  process.env.ANDROID_KEYSTORE_PATH?.trim() &&
  !existsSync(process.env.ANDROID_KEYSTORE_PATH.trim())
) {
  errors.push("ANDROID_KEYSTORE_PATH does not exist.");
}
if (errors.length) {
  console.error(`Native release preflight failed:\n- ${errors.join("\n- ")}`);
  process.exit(1);
}
console.log(`Native ${platform} release preflight passed.`);
