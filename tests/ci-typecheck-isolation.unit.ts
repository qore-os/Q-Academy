import assert from "node:assert/strict";
import {
  access,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { cleanNextDevTypes } from "../scripts/ci/clean-next-dev-types";

const rootDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

test("CI typecheck removes stale development types without touching production types", async () => {
  const temporaryRoot = await mkdtemp(
    path.join(tmpdir(), "q-academy-typecheck-"),
  );
  const developmentTypes = path.join(temporaryRoot, ".next", "dev", "types");
  const productionTypes = path.join(temporaryRoot, ".next", "types");
  const productionSentinel = path.join(productionTypes, "routes.d.ts");

  try {
    await mkdir(developmentTypes, { recursive: true });
    await mkdir(productionTypes, { recursive: true });
    await writeFile(
      path.join(developmentTypes, "validator.ts"),
      "export type Interrupted = @\n",
      "utf8",
    );
    await writeFile(productionSentinel, "export type Stable = true;\n", "utf8");

    await cleanNextDevTypes(temporaryRoot);
    await cleanNextDevTypes(temporaryRoot);

    await assert.rejects(access(developmentTypes), { code: "ENOENT" });
    assert.equal(
      await readFile(productionSentinel, "utf8"),
      "export type Stable = true;\n",
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("CI cleans development output immediately before the documented Next.js flow", async () => {
  const packageJson = JSON.parse(
    await readFile(path.join(rootDirectory, "package.json"), "utf8"),
  ) as { scripts?: Record<string, string> };
  const continuousIntegration = await readFile(
    path.join(rootDirectory, ".github", "workflows", "ci.yml"),
    "utf8",
  );

  assert.equal(
    packageJson.scripts?.typecheck,
    "next typegen && tsc --noEmit",
  );
  assert.match(
    continuousIntegration,
    /- name: Typecheck\s+env:\s+NODE_OPTIONS: --max-old-space-size=4096\s+run: \|\s+\.\/node_modules\/\.bin\/tsx scripts\/ci\/clean-next-dev-types\.ts\s+npm run typecheck/,
  );
});
