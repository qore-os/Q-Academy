import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

import { renderIosReleaseXcconfig } from "../src/lib/mobile/ios-build-settings";
import { loadProjectEnvironment } from "./load-environment";

loadProjectEnvironment();

const executable = resolve("node_modules", "@capacitor", "cli", "bin", "capacitor");
const result = spawnSync(process.execPath, [executable, "sync"], {
  cwd: process.cwd(),
  env: process.env,
  stdio: "inherit",
  shell: false,
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

// Capacitor can emit Windows separators into SwiftPM local package paths.
const swiftPackage = resolve("ios", "App", "CapApp-SPM", "Package.swift");
const source = readFileSync(swiftPackage, "utf8");
const normalized = source.replace(
  /(\.package\(name: "[^"]+", path: ")([^"]+)("\))/g,
  (_match, prefix: string, packagePath: string, suffix: string) =>
    `${prefix}${packagePath.replaceAll("\\", "/")}${suffix}`,
);
if (normalized !== source) writeFileSync(swiftPackage, normalized, "utf8");
writeFileSync(
  resolve("ios", "release.xcconfig"),
  renderIosReleaseXcconfig(process.env),
  "utf8",
);
