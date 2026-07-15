import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { renderIosReleaseXcconfig } from "../src/lib/mobile/ios-build-settings";
import { loadProjectEnvironment } from "./load-environment";

loadProjectEnvironment();
writeFileSync(
  resolve("ios", "release.xcconfig"),
  renderIosReleaseXcconfig(process.env),
  "utf8",
);
console.log("Native release build settings generated.");
