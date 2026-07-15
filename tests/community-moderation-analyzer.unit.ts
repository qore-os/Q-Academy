import assert from "node:assert/strict";
import test from "node:test";

import {
  analyzeCommunityModerationContent,
  COMMUNITY_MODERATION_MAX_DETECTED_LINKS,
  COMMUNITY_MODERATION_MAX_INPUT_BYTES,
  isCommunityModerationFingerprint,
} from "../src/lib/community-moderation-analyzer";

const secret = "moderation-unit-secret-with-at-least-32-bytes";
const tenantId = "11111111-1111-4111-8111-111111111111";

function analyze(
  content: string,
  overrides: Partial<
    Parameters<typeof analyzeCommunityModerationContent>[0]
  > = {},
) {
  return analyzeCommunityModerationContent({
    content,
    tenantId,
    secret,
    policy: { maxLinks: 3 },
    ...overrides,
  });
}

test("normalization is NFKC, case-insensitive, whitespace-stable and zero-width resistant", () => {
  const disguised = analyze("  Ｑ－ＡＣＡＤＥＭＹ\u200b\t\nFoO\u2060  BAR  ");
  const canonical = analyze("q-academy foo bar");

  assert.equal(disguised.fingerprint, canonical.fingerprint);
  assert.equal(isCommunityModerationFingerprint(disguised.fingerprint), true);
  assert.deepEqual(Object.keys(disguised).sort(), [
    "domains",
    "fingerprint",
    "linkCount",
    "reasonCodes",
  ]);
  assert.equal(JSON.stringify(disguised).includes("q-academy foo bar"), false);
});

test("fingerprints are bound to both tenant and secret", () => {
  const baseline = analyze("Identischer Inhalt");
  const otherTenant = analyze("Identischer Inhalt", {
    tenantId: "22222222-2222-4222-8222-222222222222",
  });
  const otherSecret = analyze("Identischer Inhalt", {
    secret: "different-moderation-secret-with-32-plus-bytes",
  });

  assert.notEqual(baseline.fingerprint, otherTenant.fingerprint);
  assert.notEqual(baseline.fingerprint, otherSecret.fingerprint);
});

test("WHATWG parsing canonicalizes IDNA and common bounded obfuscations", () => {
  const result = analyze(
    "HTTPS://BÜCHER.de/Angebot hxxp[:]//example[.]com www.ＥＸＡＭＰＬＥ.org/path",
  );

  assert.equal(result.linkCount, 3);
  assert.deepEqual(result.domains, [
    "xn--bcher-kva.de",
    "example.com",
    "www.example.org",
  ]);
  assert.deepEqual(result.reasonCodes, []);
});

test("invalid and non-HTTP URL forms are ignored without throwing", () => {
  const result = analyze(
    [
      "https://[not-an-ip]",
      "https://-bad.example",
      "https://example..com",
      "https://exa_mple.com",
      "http://256.256.256.256",
      "mailto:test@example.com",
      "javascript:alert(1)",
    ].join(" "),
  );

  assert.equal(result.linkCount, 0);
  assert.deepEqual(result.domains, []);
});

test("duplicate and link-limit reasons depend only on passed comparison data and policy", () => {
  const first = analyze("Mehr dazu unter https://example.com und example.org");
  const unseen = analyze(
    "Mehr dazu unter https://example.com und example.org",
    {
      policy: { maxLinks: 1 },
      knownFingerprints: new Set(),
    },
  );
  const known = analyze("Mehr dazu unter https://example.com und example.org", {
    policy: { maxLinks: 1 },
    knownFingerprints: new Set([first.fingerprint]),
  });

  assert.deepEqual(first.reasonCodes, []);
  assert.deepEqual(unseen.reasonCodes, ["link_limit"]);
  assert.deepEqual(known.reasonCodes, ["duplicate", "link_limit"]);
});

test("link work and returned counts remain capped", () => {
  const content = Array.from(
    { length: 160 },
    (_, index) => `https://d${index}.example/path`,
  ).join(" ");
  const result = analyze(content, { policy: { maxLinks: 100 } });

  assert.equal(result.linkCount, COMMUNITY_MODERATION_MAX_DETECTED_LINKS);
  assert.equal(result.domains.length, 64);
  assert.deepEqual(result.reasonCodes, ["link_limit"]);
});

test("50 KiB input is accepted and a larger UTF-8 payload is rejected", () => {
  const suffix = " https://example.com";
  const atLimit = `${"a".repeat(COMMUNITY_MODERATION_MAX_INPUT_BYTES - suffix.length)}${suffix}`;
  const result = analyze(atLimit);

  assert.equal(
    Buffer.byteLength(atLimit, "utf8"),
    COMMUNITY_MODERATION_MAX_INPUT_BYTES,
  );
  assert.equal(result.linkCount, 1);
  assert.deepEqual(result.domains, ["example.com"]);
  assert.throws(
    () => analyze("ä".repeat(COMMUNITY_MODERATION_MAX_INPUT_BYTES / 2 + 1)),
    RangeError,
  );
});

test("deterministic fuzz-like Unicode inputs never escape result bounds", () => {
  const fragments = [
    "Text",
    "\u200b",
    "\ufeff",
    "\ud800",
    "\udfff",
    "例え.テスト",
    "hxxps://bücher[.]de",
    "https://[invalid]",
    "(.)",
    "\n\t",
    "ＡＢＣ",
    "https[:]//example.com/path?q=1",
  ];
  let state = 0x5eed1234;
  const next = () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state;
  };

  for (let sample = 0; sample < 300; sample += 1) {
    const parts: string[] = [];
    const count = 1 + (next() % 40);
    for (let index = 0; index < count; index += 1) {
      parts.push(fragments[next() % fragments.length]!);
    }
    const content = parts.join(next() % 2 ? " " : ",");
    const first = analyze(content);
    const second = analyze(content);
    assert.deepEqual(first, second);
    assert.equal(isCommunityModerationFingerprint(first.fingerprint), true);
    assert.ok(first.linkCount <= COMMUNITY_MODERATION_MAX_DETECTED_LINKS);
    assert.ok(first.domains.length <= 64);
    assert.ok(first.domains.every((domain) => /^[\x00-\x7f]+$/u.test(domain)));
  }
});

test("policy, secret and comparison-set bounds fail closed", () => {
  assert.throws(
    () => analyze("text", { policy: { maxLinks: 101 } }),
    RangeError,
  );
  assert.throws(() => analyze("text", { secret: "too-short" }), RangeError);
  assert.throws(
    () =>
      analyze("text", {
        knownFingerprints: new Set(
          Array.from({ length: 10_001 }, (_, index) => String(index)),
        ),
      }),
    RangeError,
  );
});
