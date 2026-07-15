import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);

export async function cleanNextDevTypes(rootDirectory = projectRoot) {
  await rm(path.join(rootDirectory, ".next", "dev", "types"), {
    recursive: true,
    force: true,
  });
}

const entrypoint = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : undefined;

if (entrypoint === import.meta.url) {
  cleanNextDevTypes().catch((error: unknown) => {
    console.error(
      error instanceof Error
        ? error.message
        : "Could not clean Next.js development types.",
    );
    process.exitCode = 1;
  });
}
