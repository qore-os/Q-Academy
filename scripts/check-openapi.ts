import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { openApiDocument, type OpenApiHttpMethod } from "../src/lib/api/openapi";
import { hasValidOpenApiResponseContract } from "../src/lib/api/openapi-contract";

const routeRoot = path.resolve("src/app/api/v1");
const httpMethods = new Set(["GET", "POST", "PATCH", "PUT", "DELETE"]);

async function routeFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const target = path.join(directory, entry.name);
      return entry.isDirectory()
        ? routeFiles(target)
        : Promise.resolve(entry.name === "route.ts" ? [target] : []);
    }),
  );
  return nested.flat();
}

function openApiPath(file: string) {
  const relative = path.relative(routeRoot, path.dirname(file));
  if (!relative) return "/";
  return `/${relative
    .split(path.sep)
    .map((segment) =>
      segment.startsWith("[") && segment.endsWith("]")
        ? `{${segment.slice(1, -1)}}`
        : segment,
    )
    .join("/")}`;
}

const implemented = new Set<string>();
for (const file of await routeFiles(routeRoot)) {
  const source = await readFile(file, "utf8");
  for (const match of source.matchAll(
    /export\s+(?:(?:async\s+)?function|const)\s+(GET|POST|PATCH|PUT|DELETE)\b/g,
  )) {
    const method = match[1];
    if (httpMethods.has(method)) {
      implemented.add(`${method.toLowerCase()} ${openApiPath(file)}`);
    }
  }
}

const documented = new Set<string>();
for (const [apiPath, pathItem] of Object.entries(openApiDocument.paths)) {
  for (const method of ["get", "post", "patch", "put", "delete"] as const) {
    const operation = pathItem[method as OpenApiHttpMethod];
    if (!operation) continue;
    documented.add(`${method} ${apiPath}`);
    if (!hasValidOpenApiResponseContract(operation)) {
      throw new Error(
        `${method.toUpperCase()} ${apiPath} has no success or redirect response.`,
      );
    }
  }
}

const missing = [...implemented].filter((operation) => !documented.has(operation));
const extra = [...documented].filter((operation) => !implemented.has(operation));
if (missing.length || extra.length) {
  throw new Error(
    [
      missing.length ? `Missing in OpenAPI:\n${missing.join("\n")}` : "",
      extra.length ? `Not implemented:\n${extra.join("\n")}` : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
  );
}

console.log(
  `OpenAPI contract matches ${implemented.size} operations across ${Object.keys(openApiDocument.paths).length} paths.`,
);
