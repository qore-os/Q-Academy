import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

type LockPackage = Readonly<{
  version?: string;
  license?: string;
  dev?: boolean;
}>;

type PackageLock = Readonly<{
  lockfileVersion?: number;
  packages?: Readonly<Record<string, LockPackage>>;
}>;

const lockfilePath = "package-lock.json";
const noticesPath = "THIRD_PARTY_NOTICES.md";

function packageName(packagePath: string) {
  const marker = "node_modules/";
  const offset = packagePath.lastIndexOf(marker);
  if (offset < 0) throw new Error(`Unsupported package-lock path: ${packagePath}`);
  const remainder = packagePath.slice(offset + marker.length);
  const parts = remainder.split("/");
  const name = parts[0]?.startsWith("@")
    ? `${parts[0]}/${parts[1] ?? ""}`
    : parts[0];
  if (!name || name.endsWith("/")) {
    throw new Error(`Could not derive a package name from: ${packagePath}`);
  }
  return name;
}

function markdownCell(value: string) {
  return value.replaceAll("\\", "\\\\").replaceAll("|", "\\|");
}

function lexical(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

async function renderNotices() {
  const lockfileSource = await readFile(lockfilePath, "utf8");
  const lockfile = JSON.parse(lockfileSource) as PackageLock;
  if (lockfile.lockfileVersion !== 3 || !lockfile.packages) {
    throw new Error("package-lock.json must use lockfileVersion 3 with package metadata.");
  }

  const packages = new Map<
    string,
    Readonly<{ name: string; version: string; license: string }>
  >();
  for (const [packagePath, metadata] of Object.entries(lockfile.packages)) {
    if (!packagePath || metadata.dev === true) continue;
    const name = packageName(packagePath);
    const version = metadata.version?.trim() ?? "";
    const license = metadata.license?.trim() ?? "";
    if (!version || !license) {
      throw new Error(`Production package metadata is incomplete: ${packagePath}`);
    }
    packages.set(`${name}\0${version}\0${license}`, { name, version, license });
  }

  const rows = [...packages.values()].sort(
    (left, right) =>
      lexical(left.name, right.name) || lexical(left.version, right.version),
  );
  const lockfileDigest = createHash("sha256")
    .update(lockfileSource)
    .digest("hex");
  return [
    "# Third-Party Notices",
    "",
    "This checked inventory lists production npm packages resolved by `package-lock.json`.",
    "The exact container contents are additionally recorded in the release CycloneDX SBOMs.",
    "Package distributions in the release image contain their authoritative license texts.",
    "",
    `Lockfile SHA-256: \`${lockfileDigest}\``,
    "",
    "| Package | Version | Declared license |",
    "| --- | --- | --- |",
    ...rows.map(
      ({ name, version, license }) =>
        `| [${markdownCell(name)}](https://www.npmjs.com/package/${encodeURIComponent(name)}) | ${markdownCell(version)} | ${markdownCell(license)} |`,
    ),
    "",
  ].join("\n");
}

const rendered = await renderNotices();
if (process.argv.includes("--check")) {
  const committed = await readFile(noticesPath, "utf8").catch(() => "");
  if (committed !== rendered) {
    throw new Error(
      `${noticesPath} is stale. Run \`npm run notices:generate\` and commit the result.`,
    );
  }
} else {
  await writeFile(noticesPath, rendered, "utf8");
}
