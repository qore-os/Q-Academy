import assert from "node:assert/strict";
import {
  existsSync,
  readFileSync,
  readdirSync,
  type Dirent,
} from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

import { COURSE_INTEGRATION_PROVIDERS } from "../src/lib/content-blocks/integration-catalog";
import {
  oidcRateClientCookiePolicy,
  oidcTransactionCookiePolicy,
} from "../src/lib/oidc-cookie-policy";

type CookieWriteSite = {
  source: string;
  operation: string;
  nameExpression: string;
  occurrences: number;
};

type InventoryCookie = {
  id: string;
  name: { production: string; nonProduction: string };
  sources: string[];
  writeSites: CookieWriteSite[];
  purpose: string;
  lifetime: { cookie: string; serverEnforcement: string };
  sameSite: string;
  secure: string;
  httpOnly: boolean;
  path: string;
  domain: string | null;
  priority: string;
  necessary: boolean;
  necessity: string;
  category: string;
};

type ThirdPartyIntegration = {
  id: string;
  type: string;
  sources: string[];
  hosts: string[];
  loadMode: string;
  data: string[];
  cookieStorage: string;
  necessary: boolean;
  necessity: string;
  legalDecision: string;
};

type Inventory = {
  schemaVersion: number;
  reviewedAt: string;
  scope: string[];
  firstPartyCookies: InventoryCookie[];
  thirdPartyIntegrations: ThirdPartyIntegration[];
  configurableThirdPartySurfaces: Array<{
    id: string;
    sources: string[];
    hosts: string[];
    loadMode: string;
    isolation: string;
    necessary: boolean;
    necessity: string;
    legalDecision: string;
  }>;
  browserStorage: Array<{
    id: string;
    technology: string;
    key: string;
    sources: string[];
    purpose: string;
    lifetime: string;
    necessary: boolean;
    necessity: string;
    legalDecision: string;
  }>;
  browserSdkLoaders: Array<{
    id: string;
    source: string;
    occurrences: number;
    hosts: string[];
    loadMode: string;
  }>;
  knownTrackerSourceMarkers: Array<{
    marker: string;
    source: string;
    occurrences: number;
    kind: string;
  }>;
  knownTrackerDependencies: string[];
};

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const INVENTORY_PATH = path.join(
  ROOT,
  "docs",
  "cookie-tracking-inventory.json",
);
const inventory = JSON.parse(readFileSync(INVENTORY_PATH, "utf8")) as Inventory;
const SOURCE_EXTENSIONS = new Set([".js", ".jsx", ".mjs", ".ts", ".tsx"]);

function repositoryPath(value: string) {
  return path.join(ROOT, ...value.split("/"));
}

function normalizedRelativePath(value: string) {
  return path.relative(ROOT, value).replaceAll(path.sep, "/");
}

function collectFiles(directory: string): string[] {
  const entries = readdirSync(directory, { withFileTypes: true });
  return entries.flatMap((entry: Dirent) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectFiles(target);
    return SOURCE_EXTENSIONS.has(path.extname(entry.name)) ? [target] : [];
  });
}

function sourceFileFor(file: string) {
  const extension = path.extname(file);
  const scriptKind = extension === ".tsx"
    ? ts.ScriptKind.TSX
    : extension === ".jsx"
      ? ts.ScriptKind.JSX
      : extension === ".js" || extension === ".mjs"
        ? ts.ScriptKind.JS
        : ts.ScriptKind.TS;
  return ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    scriptKind,
  );
}

function normalizedExpression(node: ts.Node, sourceFile: ts.SourceFile) {
  return node.getText(sourceFile).replace(/\s+/g, " ").trim();
}

function containsCookiesCall(
  node: ts.Node,
  cookieFunctionIdentifiers: ReadonlySet<string>,
) {
  let found = false;
  function visit(candidate: ts.Node) {
    if (
      ts.isCallExpression(candidate) &&
      ts.isIdentifier(candidate.expression) &&
      cookieFunctionIdentifiers.has(candidate.expression.text)
    ) {
      found = true;
      return;
    }
    if (!found) ts.forEachChild(candidate, visit);
  }
  visit(node);
  return found;
}

function staticString(node: ts.Expression | undefined) {
  if (!node) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  return null;
}

function cookieWriteSites() {
  const discovered: CookieWriteSite[] = [];

  for (const file of collectFiles(path.join(ROOT, "src"))) {
    const source = normalizedRelativePath(file);
    const sourceFile = sourceFileFor(file);
    const cookieFunctionIdentifiers = new Set(["cookies"]);
    const cookieStoreIdentifiers = new Set<string>();

    function collectCookieImports(node: ts.Node) {
      if (
        ts.isImportDeclaration(node) &&
        ts.isStringLiteral(node.moduleSpecifier) &&
        node.moduleSpecifier.text === "next/headers" &&
        node.importClause?.namedBindings &&
        ts.isNamedImports(node.importClause.namedBindings)
      ) {
        for (const element of node.importClause.namedBindings.elements) {
          if ((element.propertyName?.text ?? element.name.text) === "cookies") {
            cookieFunctionIdentifiers.add(element.name.text);
          }
        }
      }
      ts.forEachChild(node, collectCookieImports);
    }
    collectCookieImports(sourceFile);

    function collectCookieStores(node: ts.Node) {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer &&
        (containsCookiesCall(node.initializer, cookieFunctionIdentifiers) ||
          (ts.isPropertyAccessExpression(node.initializer) &&
            node.initializer.name.text === "cookies"))
      ) {
        cookieStoreIdentifiers.add(node.name.text);
      }
      ts.forEachChild(node, collectCookieStores);
    }
    collectCookieStores(sourceFile);

    function isCookieReceiver(node: ts.Expression) {
      return (
        (ts.isIdentifier(node) && cookieStoreIdentifiers.has(node.text)) ||
        (ts.isPropertyAccessExpression(node) && node.name.text === "cookies") ||
        containsCookiesCall(node, cookieFunctionIdentifiers)
      );
    }

    function record(
      operation: string,
      nameExpression: string,
    ) {
      discovered.push({ source, operation, nameExpression, occurrences: 1 });
    }

    function visit(node: ts.Node) {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression)
      ) {
        const method = node.expression.name.text;
        const receiver = node.expression.expression;
        const firstArgument = node.arguments[0];
        if (
          (method === "set" || method === "delete") &&
          isCookieReceiver(receiver)
        ) {
          record(
            method,
            firstArgument
              ? normalizedExpression(firstArgument, sourceFile)
              : "<missing-name>",
          );
        }
        if (
          (method === "set" || method === "append") &&
          staticString(firstArgument)?.toLowerCase() === "set-cookie"
        ) {
          record("header-set", "Set-Cookie");
        }
      }

      if (
        ts.isBinaryExpression(node) &&
        ((ts.isPropertyAccessExpression(node.left) &&
          ts.isIdentifier(node.left.expression) &&
          node.left.expression.text === "document" &&
          node.left.name.text === "cookie") ||
          (ts.isElementAccessExpression(node.left) &&
            ts.isIdentifier(node.left.expression) &&
            node.left.expression.text === "document" &&
            staticString(node.left.argumentExpression) === "cookie"))
      ) {
        record("document-cookie", "document.cookie");
      }
      ts.forEachChild(node, visit);
    }
    visit(sourceFile);
  }

  const aggregated = new Map<string, CookieWriteSite>();
  for (const site of discovered) {
    const key = [site.source, site.operation, site.nameExpression].join("\u0000");
    const existing = aggregated.get(key);
    if (existing) existing.occurrences += 1;
    else aggregated.set(key, { ...site });
  }
  return [...aggregated.values()].sort(compareWriteSites);
}

function compareWriteSites(left: CookieWriteSite, right: CookieWriteSite) {
  return [left.source, left.operation, left.nameExpression]
    .join("\u0000")
    .localeCompare(
      [right.source, right.operation, right.nameExpression].join("\u0000"),
    );
}

function browserScriptLoaders() {
  const loaders: Array<{ source: string; occurrences: number }> = [];
  for (const file of collectFiles(path.join(ROOT, "src"))) {
    const sourceFile = sourceFileFor(file);
    let occurrences = 0;

    function visit(node: ts.Node) {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        ts.isIdentifier(node.expression.expression) &&
        node.expression.expression.text === "document" &&
        node.expression.name.text === "createElement" &&
        staticString(node.arguments[0])?.toLowerCase() === "script"
      ) {
        occurrences += 1;
      }

      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const tag = node.tagName.getText(sourceFile);
        const hasSource = node.attributes.properties.some(
          (attribute) =>
            ts.isJsxAttribute(attribute) &&
            ts.isIdentifier(attribute.name) &&
            attribute.name.text === "src",
        );
        if ((tag === "Script" || tag === "script") && hasSource) {
          occurrences += 1;
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(sourceFile);
    if (occurrences > 0) {
      loaders.push({ source: normalizedRelativePath(file), occurrences });
    }
  }
  return loaders.sort((left, right) => left.source.localeCompare(right.source));
}

const KNOWN_TRACKER_SOURCE_MARKERS = [
  "api-iam.intercom.io",
  "widget.intercom.io",
  "googletagmanager.com",
  "google-analytics.com",
  "gtag(",
  "connect.facebook.net",
  "fbq(",
  "bat.bing.com",
  "snap.licdn.com",
  "static.hotjar.com",
  "js.intercomcdn.com",
  "posthog",
  "mixpanel",
  "cdn.segment.com",
  "analytics.js",
  "hotjar",
  "clarity.ms",
  "fullstory",
  "amplitude",
  "matomo",
  "plausible.io",
  "browser.sentry",
  "sentry.io",
  "datadoghq",
  "newrelic",
  "heap.io",
] as const;

const KNOWN_TRACKER_DEPENDENCY_MARKERS = [
  "@amplitude/",
  "@datadog/",
  "@fullstory/",
  "@microsoft/clarity",
  "@microsoft/applicationinsights",
  "@newrelic/",
  "@opentelemetry/",
  "@segment/",
  "@sentry/",
  "@vercel/analytics",
  "amplitude",
  "clarity-js",
  "fullstory",
  "google-analytics",
  "gtag",
  "heap",
  "hotjar",
  "intercom",
  "matomo",
  "mixpanel",
  "plausible",
  "posthog",
  "react-facebook-pixel",
  "react-ga",
  "rudderstack",
  "snowplow",
] as const;

function trackerSourceMarkers() {
  const matches: Inventory["knownTrackerSourceMarkers"] = [];
  for (const file of collectFiles(path.join(ROOT, "src"))) {
    const source = normalizedRelativePath(file);
    const value = readFileSync(file, "utf8").toLowerCase();
    for (const marker of KNOWN_TRACKER_SOURCE_MARKERS) {
      let occurrences = 0;
      let offset = 0;
      while ((offset = value.indexOf(marker, offset)) >= 0) {
        occurrences += 1;
        offset += marker.length;
      }
      if (occurrences > 0) {
        const inventoried = inventory.knownTrackerSourceMarkers.find(
          (candidate) => candidate.marker === marker && candidate.source === source,
        );
        matches.push({
          marker,
          source,
          occurrences,
          kind: inventoried?.kind ?? "unreviewed",
        });
      }
    }
  }
  return matches.sort((left, right) =>
    [left.marker, left.source]
      .join("\u0000")
      .localeCompare([right.marker, right.source].join("\u0000")),
  );
}

test("cookie inventory is complete and encodes production cookie invariants", () => {
  assert.equal(inventory.schemaVersion, 1);
  assert.match(inventory.reviewedAt, /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(inventory.scope, ["src", "public/sw.js", "package.json"]);
  assert.equal(inventory.firstPartyCookies.length, 4);
  assert.deepEqual(
    inventory.firstPartyCookies.map((cookie) => cookie.id).sort(),
    [
      "mfa-login-challenge",
      "oidc-rate-client",
      "oidc-transaction",
      "session",
    ],
  );
  assert.equal(
    new Set(
      inventory.firstPartyCookies.map((cookie) => cookie.name.production),
    ).size,
    inventory.firstPartyCookies.length,
  );

  for (const cookie of inventory.firstPartyCookies) {
    assert.match(cookie.name.production, /^__Host-/);
    assert.doesNotMatch(cookie.name.nonProduction, /^__Host-/);
    assert.ok(cookie.purpose.length > 20);
    assert.ok(cookie.lifetime.cookie.length > 0);
    assert.ok(cookie.lifetime.serverEnforcement.length > 0);
    assert.equal(cookie.sameSite, "Lax");
    assert.equal(cookie.secure, "production-only");
    assert.equal(cookie.httpOnly, true);
    assert.equal(cookie.path, "/");
    assert.equal(cookie.domain, null);
    assert.equal(cookie.priority, "High");
    assert.equal(cookie.necessary, true);
    assert.match(cookie.necessity, /^strictly-necessary/);
    assert.ok(cookie.category);
    assert.ok(cookie.writeSites.length > 0);
    for (const source of cookie.sources) {
      assert.equal(existsSync(repositoryPath(source)), true, source);
    }
  }

  const transaction = inventory.firstPartyCookies.find(
    (cookie) => cookie.id === "oidc-transaction",
  );
  const rateClient = inventory.firstPartyCookies.find(
    (cookie) => cookie.id === "oidc-rate-client",
  );
  assert.equal(
    transaction?.name.production,
    oidcTransactionCookiePolicy(true).name,
  );
  assert.equal(
    transaction?.name.nonProduction,
    oidcTransactionCookiePolicy(false).name,
  );
  assert.match(
    transaction?.lifetime.cookie ?? "",
    new RegExp(String(oidcTransactionCookiePolicy(true).options.maxAge / 60)),
  );
  assert.equal(rateClient?.name.production, oidcRateClientCookiePolicy(true).name);
  assert.equal(
    rateClient?.name.nonProduction,
    oidcRateClientCookiePolicy(false).name,
  );
  assert.match(
    rateClient?.lifetime.cookie ?? "",
    new RegExp(String(oidcRateClientCookiePolicy(true).options.maxAge / 60)),
  );
  for (const policy of [
    oidcTransactionCookiePolicy(true),
    oidcRateClientCookiePolicy(true),
  ]) {
    assert.equal(policy.options.sameSite, "lax");
    assert.equal(policy.options.secure, true);
    assert.equal(policy.options.httpOnly, true);
    assert.equal(policy.options.path, "/");
    assert.equal(policy.options.priority, "high");
    assert.equal(Object.hasOwn(policy.options, "domain"), false);
  }

  const authSource = readFileSync(repositoryPath("src/lib/auth.ts"), "utf8");
  assert.match(
    authSource,
    /DEVELOPMENT_SESSION_COOKIE = "q_academy_session"/,
  );
  assert.match(
    authSource,
    /PRODUCTION_SESSION_COOKIE = "__Host-q_academy_session"/,
  );
  assert.match(
    authSource,
    /authentication\.method === "oidc"[\s\S]{0,100}\? 12 \* 60 \* 60 \* 1000[\s\S]{0,100}: 7 \* 24 \* 60 \* 60 \* 1000/,
  );
  assert.match(authSource, /Date\.now\(\) - 60 \* 60_000/);
  const sessionWriter = authSource.slice(
    authSource.indexOf("cookieStore.set(sessionCookieName()"),
    authSource.indexOf("cookieStore.set(sessionCookieName()") + 500,
  );
  assert.match(sessionWriter, /httpOnly: true/);
  assert.match(sessionWriter, /secure: process\.env\.NODE_ENV === "production"/);
  assert.match(sessionWriter, /sameSite: "lax"/);
  assert.match(sessionWriter, /path: "\/"/);
  assert.match(sessionWriter, /priority: "high"/);
  const mfaSource = readFileSync(
    repositoryPath("src/lib/mfa/login-challenge.ts"),
    "utf8",
  );
  assert.match(mfaSource, /DEVELOPMENT_COOKIE = "q_academy_mfa_challenge"/);
  assert.match(
    mfaSource,
    /PRODUCTION_COOKIE = "__Host-q_academy_mfa_challenge"/,
  );
  assert.match(mfaSource, /CHALLENGE_TTL_MS = 10 \* 60_000/);
  const mfaWriter = mfaSource.slice(
    mfaSource.indexOf("(await cookies()).set(cookieName()"),
    mfaSource.indexOf("(await cookies()).set(cookieName()") + 500,
  );
  assert.match(mfaWriter, /httpOnly: true/);
  assert.match(mfaWriter, /secure: process\.env\.NODE_ENV === "production"/);
  assert.match(mfaWriter, /sameSite: "lax"/);
  assert.match(mfaWriter, /path: "\/"/);
  assert.match(mfaWriter, /priority: "high"/);
});

test("all cookie writers are explicitly inventoried", () => {
  const expected = inventory.firstPartyCookies
    .flatMap((cookie) => cookie.writeSites)
    .map((site) => ({ ...site }))
    .sort(compareWriteSites);
  assert.deepEqual(cookieWriteSites(), expected);
});

test("known tracker SDKs, markers, and browser script loaders fail closed", () => {
  const packageJson = JSON.parse(
    readFileSync(repositoryPath("package.json"), "utf8"),
  ) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const directDependencies = Object.keys({
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
  });
  const trackerDependencies = directDependencies
    .filter((dependency) => {
      const value = dependency.toLowerCase();
      return KNOWN_TRACKER_DEPENDENCY_MARKERS.some((marker) =>
        value.includes(marker),
      );
    })
    .sort();
  assert.deepEqual(trackerDependencies, [...inventory.knownTrackerDependencies].sort());

  const expectedMarkers = inventory.knownTrackerSourceMarkers
    .map((entry) => ({ ...entry, marker: entry.marker.toLowerCase() }))
    .sort((left, right) =>
      [left.marker, left.source]
        .join("\u0000")
        .localeCompare([right.marker, right.source].join("\u0000")),
    );
  assert.deepEqual(trackerSourceMarkers(), expectedMarkers);

  assert.deepEqual(
    browserScriptLoaders(),
    inventory.browserSdkLoaders
      .map(({ source, occurrences }) => ({ source, occurrences }))
      .sort((left, right) => left.source.localeCompare(right.source)),
  );
  assert.deepEqual(
    inventory.browserSdkLoaders.map((loader) => loader.id),
    ["intercom"],
  );
});

test("course providers remain click-to-load and custom code remains isolated", () => {
  const courseIntegrations = inventory.thirdPartyIntegrations
    .filter((integration) => integration.type === "course-iframe")
    .map((integration) => ({
      id: integration.id,
      hosts: integration.hosts,
      loadMode: integration.loadMode,
      legalDecision: integration.legalDecision,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  const catalog = COURSE_INTEGRATION_PROVIDERS
    .map((provider) => ({
      id: provider.id,
      hosts: [...provider.hostnames],
      loadMode: "click-to-load",
      legalDecision: "open",
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  assert.deepEqual(courseIntegrations, catalog);

  const integrationSource = readFileSync(
    repositoryPath("src/components/academy/course-integration-embed.tsx"),
    "utf8",
  );
  assert.match(integrationSource, /const \[loaded, setLoaded\] = useState\(false\)/);
  assert.match(integrationSource, /if \(loaded\)[\s\S]*<iframe/);
  assert.match(integrationSource, /onClick=\{\(\) => setLoaded\(true\)\}/);
  assert.match(integrationSource, /data-course-integration-consent/);

  const intercom = inventory.thirdPartyIntegrations.find(
    (integration) => integration.id === "intercom",
  );
  assert.equal(intercom?.loadMode, "automatic-when-tenant-enabled");
  assert.equal(intercom?.necessary, false);
  assert.equal(intercom?.legalDecision, "open");
  assert.ok(
    intercom?.data.includes("verpflichtender nutzergebundener HMAC"),
  );

  assert.equal(inventory.configurableThirdPartySurfaces.length, 1);
  const customCode = inventory.configurableThirdPartySurfaces[0];
  assert.equal(customCode?.id, "platform-custom-code");
  assert.equal(customCode?.legalDecision, "open");
  const customCodePolicy = readFileSync(
    repositoryPath("src/lib/platform-custom-code.ts"),
    "utf8",
  );
  const customCodeSlot = readFileSync(
    repositoryPath("src/components/shared/platform-custom-code-slot.tsx"),
    "utf8",
  );
  assert.match(customCodePolicy, /PLATFORM_CUSTOM_CODE_MAX_ORIGINS = 8/);
  assert.match(customCodePolicy, /enabled: false/);
  assert.match(customCodeSlot, /sandbox="allow-scripts"/);
  assert.doesNotMatch(customCodeSlot, /allow-same-origin/);
});

test("browser storage and every external surface retain an open legal decision", () => {
  assert.deepEqual(
    inventory.browserStorage.map((entry) => entry.id).sort(),
    [
      "native-start-resolved",
      "pwa-public-cache",
      "remembered-accounts",
      "video-playback-rate",
      "video-volume",
    ],
  );
  for (const entry of inventory.browserStorage) {
    assert.ok(entry.purpose.length > 10);
    assert.ok(entry.lifetime.length > 10);
    assert.equal(entry.legalDecision, "open");
    for (const source of entry.sources) {
      assert.equal(existsSync(repositoryPath(source)), true, source);
    }
  }
  for (const integration of inventory.thirdPartyIntegrations) {
    assert.equal(integration.legalDecision, "open");
    assert.equal(integration.necessary, false);
    for (const source of integration.sources) {
      assert.equal(existsSync(repositoryPath(source)), true, source);
    }
  }
});
