import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { getPlatformCustomCodeCopy } from "../src/lib/i18n/platform-custom-code";
import { SUPPORTED_LOCALES } from "../src/lib/i18n/model";
import {
  DEFAULT_PLATFORM_CUSTOM_CODE,
  normalizePlatformCustomCodeValue,
  platformCustomCodeDocument,
  platformCustomCodeInputSchema,
  PLATFORM_CUSTOM_CODE_MAX_LENGTH,
  storedPlatformCustomCodeSchema,
} from "../src/lib/platform-custom-code";

function input(overrides: Record<string, unknown> = {}) {
  return {
    revision: 1,
    enabled: true,
    headerCode: "<strong>Header</strong>",
    headerHeight: 80,
    footerCode: "<span>Footer</span>",
    footerHeight: 60,
    allowedNetworkOrigins: ["https://cdn.example.com"],
    ...overrides,
  };
}

test("platform custom code validates bounded code, heights and HTTPS origins", () => {
  assert.equal(normalizePlatformCustomCodeValue("a\r\nb\rc"), "a\nb\nc");
  const parsed = platformCustomCodeInputSchema.parse(
    input({
      allowedNetworkOrigins: [
        "https://cdn.example.com",
        "https://cdn.example.com/",
      ],
    }),
  );
  assert.deepEqual(parsed.allowedNetworkOrigins, ["https://cdn.example.com"]);
  assert.equal(
    platformCustomCodeInputSchema.safeParse(
      input({ allowedNetworkOrigins: ["http://cdn.example.com"] }),
    ).success,
    false,
  );
  assert.equal(
    platformCustomCodeInputSchema.safeParse(
      input({ allowedNetworkOrigins: ["https://cdn.example.com/path"] }),
    ).success,
    false,
  );
  assert.equal(
    platformCustomCodeInputSchema.safeParse(
      input({ headerCode: "x".repeat(PLATFORM_CUSTOM_CODE_MAX_LENGTH + 1) }),
    ).success,
    false,
  );
  assert.equal(
    platformCustomCodeInputSchema.safeParse(input({ footerHeight: 601 })).success,
    false,
  );
  assert.deepEqual(
    storedPlatformCustomCodeSchema.parse(DEFAULT_PLATFORM_CUSTOM_CODE),
    DEFAULT_PLATFORM_CUSTOM_CODE,
  );
});

test("platform code documents enforce nonce binding and restrictive sandbox CSP", () => {
  const nonce = "a".repeat(32);
  const document = platformCustomCodeDocument({
    code: "<script nonce=\"attacker\">document.body.dataset.ready='yes'</script>",
    locale: "en",
    allowedNetworkOrigins: ["https://cdn.example.com"],
    nonce,
  });
  assert.ok(document);
  assert.match(document, /default-src 'none'/);
  assert.match(document, /connect-src https:\/\/cdn\.example\.com/);
  assert.match(document, /form-action 'none'/);
  assert.match(document, /navigate-to 'none'/);
  assert.match(document, /referrer" content="no-referrer/);
  assert.match(document, /document\.body\.dataset\.ready/);
  assert.match(document, new RegExp(`nonce="${nonce}"`));
  assert.doesNotMatch(document, /nonce="attacker"/);

  const noNetworkDocument = platformCustomCodeDocument({
    code: "<p>Offline</p>",
    locale: "de",
    allowedNetworkOrigins: [],
    nonce,
  });
  assert.ok(noNetworkDocument);
  assert.match(noNetworkDocument, /connect-src 'none'/);
  assert.equal(
    platformCustomCodeDocument({
      code: "<script>1</script>",
      locale: "de",
      allowedNetworkOrigins: [],
      nonce: "invalid",
    }),
    null,
  );
  assert.equal(
    platformCustomCodeDocument({
      code: "<script>1</script>",
      locale: "de",
      allowedNetworkOrigins: ["https://safe.example; connect-src *"],
      nonce,
    }),
    null,
  );
});

test("platform code is owner-bound, revisioned, audited and rendered in both slots", () => {
  const action = readFileSync(
    "src/lib/platform-custom-code-actions.ts",
    "utf8",
  );
  const frame = readFileSync(
    "src/components/shared/platform-custom-code-slot.tsx",
    "utf8",
  );
  const layout = readFileSync("src/app/layout.tsx", "utf8");
  const csp = readFileSync("src/lib/content-security-policy.ts", "utf8");

  assert.match(action, /requireOwner\(\)/);
  assert.match(action, /pg_advisory_xact_lock/);
  assert.match(action, /parsed\.data\.revision !== current\.revision/);
  assert.match(action, /platform\.custom_code\.updated/);
  assert.match(action, /contentSha256/);
  assert.doesNotMatch(action, /metadata:\s*\{[\s\S]*?\bheaderCode\s*:/);
  assert.match(frame, /sandbox="allow-scripts"/);
  assert.doesNotMatch(frame, /allow-same-origin|allow-popups|allow-forms/);
  assert.match(frame, /platformCustomCodeDocument/);
  assert.match(frame, /srcDoc=/);
  assert.doesNotMatch(csp, /frame-src [^;]*data:/);
  assert.match(layout, /slot="header"/);
  assert.match(layout, /slot="footer"/);
});

test("platform custom code copy has all five locales", () => {
  const shape = Object.keys(getPlatformCustomCodeCopy("de")).sort();
  for (const locale of SUPPORTED_LOCALES) {
    const copy = getPlatformCustomCodeCopy(locale);
    assert.deepEqual(Object.keys(copy).sort(), shape);
    assert.ok(copy.title.trim());
    assert.ok(copy.messages.invalid.trim());
    assert.ok(copy.messages.changed.trim());
    assert.ok(copy.messages.saved.trim());
    assert.ok(copy.messages.failed.trim());
  }
});
