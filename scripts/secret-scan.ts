import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { extname, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_HISTORY_OBJECT_BYTES = 64 * 1024 * 1024;
const MAX_HISTORY_BATCH_BYTES = 32 * 1024 * 1024;
const MAX_GIT_METADATA_BYTES = 128 * 1024 * 1024;
const GIT_OBJECT_ID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const INCLUDED_EXTENSIONS = new Set([
  "",
  ".env",
  ".example",
  ".gradle",
  ".js",
  ".json",
  ".jsx",
  ".kt",
  ".md",
  ".mjs",
  ".plist",
  ".properties",
  ".sh",
  ".sql",
  ".swift",
  ".ts",
  ".tsx",
  ".xml",
  ".yaml",
  ".yml",
]);
const EXCLUDED_DIRECTORIES = new Set([
  ".data",
  ".git",
  ".next",
  "artifacts",
  "node_modules",
  "playwright-report",
  "test-results",
]);

export const SECRET_PATTERNS = [
  {
    id: "private_key",
    pattern: /-----BEGIN (?:DSA |EC |OPENSSH |PGP |RSA )?PRIVATE KEY-----/g,
  },
  { id: "aws_access_key", pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { id: "github_legacy_token", pattern: /\bgh[pousr]_[A-Za-z0-9]{36,255}\b/g },
  {
    id: "github_fine_grained_token",
    pattern: /\bgithub_pat_[A-Za-z0-9_]{50,255}\b/g,
  },
  { id: "google_api_key", pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { id: "stripe_live_key", pattern: /\b(?:sk|rk)_live_[0-9A-Za-z]{16,255}\b/g },
  {
    id: "slack_token",
    pattern: /\bxox[baprs]-[0-9A-Za-z-]{20,255}\b/g,
  },
] as const;

export type SecretFinding = Readonly<{
  file: string;
  line: number;
  column: number;
  rule: (typeof SECRET_PATTERNS)[number]["id"];
}>;

type GitHistoryObject = Readonly<{
  oid: string;
  size: number;
  type: "blob" | "commit" | "tag";
}>;

type GitHistoryScanOptions = Readonly<{
  maxObjectBytes?: number;
}>;

export function scanSecretText(file: string, text: string): SecretFinding[] {
  const findings: SecretFinding[] = [];
  for (const rule of SECRET_PATTERNS) {
    rule.pattern.lastIndex = 0;
    for (const match of text.matchAll(rule.pattern)) {
      const index = match.index ?? 0;
      const prefix = text.slice(0, index);
      const line = prefix.split("\n").length;
      const lastNewline = prefix.lastIndexOf("\n");
      findings.push({
        file,
        line,
        column: index - lastNewline,
        rule: rule.id,
      });
    }
  }
  return findings;
}

function normalizedPath(value: string) {
  return value.split(sep).join("/");
}

function gitEnvironment() {
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_NO_REPLACE_OBJECTS: "1",
    GIT_OPTIONAL_LOCKS: "0",
    GIT_TERMINAL_PROMPT: "0",
    LANG: "C",
    LC_ALL: "C",
  };
  for (const variable of [
    "GIT_ALTERNATE_OBJECT_DIRECTORIES",
    "GIT_COMMON_DIR",
    "GIT_DIR",
    "GIT_INDEX_FILE",
    "GIT_NAMESPACE",
    "GIT_OBJECT_DIRECTORY",
    "GIT_WORK_TREE",
  ]) {
    delete environment[variable];
  }
  return environment;
}

function gitText(
  root: string,
  args: readonly string[],
  options: Readonly<{ input?: string; maxBuffer?: number }> = {},
) {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    env: gitEnvironment(),
    input: options.input,
    maxBuffer: options.maxBuffer ?? 8 * 1024 * 1024,
    windowsHide: true,
  });
  if (result.error || result.status !== 0 || typeof result.stdout !== "string") {
    throw new Error(`Git command failed closed: git ${args[0] ?? "<missing>"}.`);
  }
  return result.stdout;
}

function gitBytes(
  root: string,
  args: readonly string[],
  input: string,
  maxBuffer: number,
) {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: null,
    env: gitEnvironment(),
    input,
    maxBuffer,
    windowsHide: true,
  });
  if (result.error || result.status !== 0 || !Buffer.isBuffer(result.stdout)) {
    throw new Error(`Git object read failed closed: git ${args[0] ?? "<missing>"}.`);
  }
  return result.stdout;
}

function assertCompleteGitHistory(root: string) {
  const repositoryRoot = gitText(root, ["rev-parse", "--show-toplevel"]).trim();
  if (realpathSync(repositoryRoot) !== realpathSync(root)) {
    throw new Error("Git history scan must run from the repository root.");
  }
  if (gitText(root, ["rev-parse", "--is-inside-work-tree"]).trim() !== "true") {
    throw new Error("Git history scan requires a working tree.");
  }
  const shallow = gitText(root, ["rev-parse", "--is-shallow-repository"]).trim();
  if (shallow !== "false") {
    throw new Error("Git history scan refuses a shallow or unverifiable repository.");
  }
  gitText(root, ["fsck", "--connectivity-only", "--no-dangling"]);
}

function historyObjectIds(root: string) {
  const output = gitText(
    root,
    ["rev-list", "--objects", "--all", "--no-object-names"],
    { maxBuffer: MAX_GIT_METADATA_BYTES },
  );
  const objectIds = [...new Set(output.split(/\r?\n/u).filter(Boolean))];
  if (objectIds.length === 0 || objectIds.some((oid) => !GIT_OBJECT_ID.test(oid))) {
    throw new Error("Git history did not produce a complete, valid object inventory.");
  }
  return objectIds;
}

function historyObjects(
  root: string,
  objectIds: readonly string[],
  maxObjectBytes: number,
) {
  const output = gitText(
    root,
    ["cat-file", "--batch-check=%(objectname) %(objecttype) %(objectsize)"],
    {
      input: `${objectIds.join("\n")}\n`,
      maxBuffer: MAX_GIT_METADATA_BYTES,
    },
  );
  const lines = output.split(/\r?\n/u).filter(Boolean);
  if (lines.length !== objectIds.length) {
    throw new Error("Git object metadata inventory is incomplete.");
  }

  const objects: GitHistoryObject[] = [];
  for (const [index, line] of lines.entries()) {
    const match = line.match(/^([a-f0-9]+) ([a-z]+) ([0-9]+)$/u);
    if (!match || match[1] !== objectIds[index] || !GIT_OBJECT_ID.test(match[1])) {
      throw new Error("Git object metadata is malformed or out of order.");
    }
    const [, oid, type, rawSize] = match;
    if (type !== "blob" && type !== "commit" && type !== "tag") continue;
    const size = Number(rawSize);
    if (!Number.isSafeInteger(size) || size < 0) {
      throw new Error("Git object size is invalid.");
    }
    if (size > maxObjectBytes) {
      throw new Error(
        `Git history object ${oid} exceeds the bounded secret-scan size and was not skipped.`,
      );
    }
    objects.push({ oid, size, type });
  }
  return objects;
}

function scanHistoryObjectBatch(
  root: string,
  objects: readonly GitHistoryObject[],
) {
  const expectedBytes = objects.reduce((total, object) => total + object.size, 0);
  const output = gitBytes(
    root,
    ["cat-file", "--batch"],
    `${objects.map(({ oid }) => oid).join("\n")}\n`,
    expectedBytes + objects.length * 192 + 1024,
  );
  const findings: SecretFinding[] = [];
  let offset = 0;

  for (const object of objects) {
    const headerEnd = output.indexOf(0x0a, offset);
    if (headerEnd < 0) throw new Error("Git object stream ended before its header.");
    const header = output.subarray(offset, headerEnd).toString("ascii");
    const match = header.match(/^([a-f0-9]+) ([a-z]+) ([0-9]+)$/u);
    if (
      !match ||
      match[1] !== object.oid ||
      match[2] !== object.type ||
      Number(match[3]) !== object.size
    ) {
      throw new Error("Git object stream does not match the verified inventory.");
    }

    const contentStart = headerEnd + 1;
    const contentEnd = contentStart + object.size;
    if (contentEnd >= output.length || output[contentEnd] !== 0x0a) {
      throw new Error("Git object stream ended before the verified object boundary.");
    }
    const source = `git-object:${object.oid}:${object.type}`;
    const content = output.subarray(contentStart, contentEnd).toString("latin1");
    findings.push(...scanSecretText(source, content));
    offset = contentEnd + 1;
  }
  if (offset !== output.length) {
    throw new Error("Git object stream contains unexpected trailing data.");
  }
  return findings;
}

export function scanGitHistoryForSecrets(
  root = process.cwd(),
  options: GitHistoryScanOptions = {},
) {
  const maxObjectBytes = options.maxObjectBytes ?? MAX_HISTORY_OBJECT_BYTES;
  if (!Number.isSafeInteger(maxObjectBytes) || maxObjectBytes < 1) {
    throw new Error("Git history secret-scan size limit is invalid.");
  }
  assertCompleteGitHistory(root);
  const objects = historyObjects(root, historyObjectIds(root), maxObjectBytes);
  const findings: SecretFinding[] = [];
  let batch: GitHistoryObject[] = [];
  let batchBytes = 0;

  const flush = () => {
    if (batch.length === 0) return;
    findings.push(...scanHistoryObjectBatch(root, batch));
    batch = [];
    batchBytes = 0;
  };

  for (const object of objects) {
    if (batch.length > 0 && batchBytes + object.size > MAX_HISTORY_BATCH_BYTES) flush();
    batch.push(object);
    batchBytes += object.size;
    if (batchBytes >= MAX_HISTORY_BATCH_BYTES) flush();
  }
  flush();
  return findings.sort(
    (left, right) =>
      left.file.localeCompare(right.file) ||
      left.line - right.line ||
      left.column - right.column ||
      left.rule.localeCompare(right.rule),
  );
}

function shouldScan(relativePath: string) {
  const normalized = normalizedPath(relativePath);
  const segments = normalized.split("/");
  const basename = segments.at(-1) ?? normalized;
  if (segments.some((segment) => EXCLUDED_DIRECTORIES.has(segment))) return false;
  if (
    basename === ".env" ||
    (basename.startsWith(".env.") &&
      !basename.endsWith(".example") &&
      !basename.endsWith(".sample"))
  ) {
    return false;
  }
  return INCLUDED_EXTENSIONS.has(extname(normalized).toLowerCase());
}

async function fallbackFiles(root: string, directory = root): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory() && EXCLUDED_DIRECTORIES.has(entry.name)) continue;
    const absolute = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await fallbackFiles(root, absolute)));
    else if (entry.isFile()) files.push(relative(root, absolute));
  }
  return files;
}

async function candidateFiles(root: string) {
  const tracked = spawnSync("git", ["ls-files", "-z"], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  });
  const files =
    tracked.status === 0 && tracked.stdout
      ? tracked.stdout.split("\0").filter(Boolean)
      : await fallbackFiles(root);
  return files.filter(shouldScan).sort();
}

export async function scanRepositoryForSecrets(root = process.cwd()) {
  const findings: SecretFinding[] = [];
  for (const file of await candidateFiles(root)) {
    const absolute = resolve(root, file);
    const metadata = await stat(absolute).catch(() => null);
    if (!metadata?.isFile() || metadata.size > MAX_FILE_BYTES) continue;
    const bytes = await readFile(absolute);
    if (bytes.includes(0)) continue;
    findings.push(...scanSecretText(normalizedPath(file), bytes.toString("utf8")));
  }
  return findings;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some((argument) => argument !== "--history") || args.length > 1) {
    throw new Error("Usage: secret-scan.ts [--history]");
  }
  const includeHistory = args[0] === "--history";
  const findings = await scanRepositoryForSecrets();
  if (includeHistory) findings.push(...scanGitHistoryForSecrets());
  if (findings.length) {
    for (const finding of findings) {
      console.error(
        `${finding.file}:${finding.line}:${finding.column} potential secret (${finding.rule})`,
      );
    }
    process.exitCode = 1;
    return;
  }
  console.log(
    includeHistory
      ? "Secret scan passed: no known credential patterns in tracked files or complete Git history."
      : "Secret scan passed: no known credential patterns in tracked files.",
  );
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await main().catch((error: unknown) => {
    console.error(
      `Secret scan failed closed: ${error instanceof Error ? error.message : "unknown error"}`,
    );
    process.exitCode = 2;
  });
}
