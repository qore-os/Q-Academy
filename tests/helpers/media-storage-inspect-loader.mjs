import { fileURLToPath, pathToFileURL } from "node:url";

const mockUrl = new URL("./media-storage-inspect-mock.mjs", import.meta.url).href;
const actualStorageUrl = new URL(
  "../../src/lib/media/storage.ts",
  import.meta.url,
).href;
const actualStoragePath = fileURLToPath(actualStorageUrl);

export async function resolve(specifier, context, nextResolve) {
  if (
    specifier === "@/lib/media/storage" ||
    specifier === actualStorageUrl ||
    specifier === actualStoragePath
  ) {
    return { url: mockUrl, shortCircuit: true };
  }
  if (/^[a-zA-Z]:[\\/]/.test(specifier)) {
    return nextResolve(pathToFileURL(specifier).href, context);
  }
  return nextResolve(specifier, context);
}
