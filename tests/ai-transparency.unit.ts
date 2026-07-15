import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  AI_EXTERNAL_USE_NOTICE_VERSION,
  aiTransparencyNoticeDigest,
  buildAiTransparencyNotice,
} from "../src/lib/ai/transparency-model";
import { safeTenantLegalUrl } from "../src/lib/legal-links";

test("tenant legal links accept only normalized public HTTPS URLs", () => {
  assert.equal(
    safeTenantLegalUrl(" https://privacy.example/legal?tenant=one#details "),
    "https://privacy.example/legal?tenant=one",
  );
  assert.equal(safeTenantLegalUrl("http://privacy.example/legal"), null);
  assert.equal(
    safeTenantLegalUrl("https://user:secret@privacy.example/legal"),
    null,
  );
  assert.equal(safeTenantLegalUrl("https://localhost/legal"), null);
  assert.equal(safeTenantLegalUrl("javascript:alert(1)"), null);
});

test("AI transparency digest identifies the exact notice and tenant links", () => {
  assert.equal(AI_EXTERNAL_USE_NOTICE_VERSION, 2);
  const input = {
    privacyPolicyUrl: "https://privacy.example/legal",
    transparencyPolicyUrl: "https://privacy.example/ai",
  };
  const digest = aiTransparencyNoticeDigest(input);
  assert.match(digest, /^[0-9a-f]{64}$/);
  assert.equal(aiTransparencyNoticeDigest(input), digest);
  assert.notEqual(
    aiTransparencyNoticeDigest({
      ...input,
      transparencyPolicyUrl: "https://privacy.example/ai-v2",
    }),
    digest,
  );
  assert.deepEqual(buildAiTransparencyNotice(input), {
    version: AI_EXTERNAL_USE_NOTICE_VERSION,
    digest,
    title: "Hinweis zur externen KI-Verarbeitung",
    description:
      "Fuer KI-Antworten koennen deine Eingabe, der bisherige Chatverlauf, passende freigegebene Lerninhalte und vom Academy-Admin ausdruecklich ausgewaehlte, fuer dich sichtbare Profilfelder an einen extern betriebenen KI-Dienst uebermittelt werden.",
    warning:
      "Gib keine besonderen Kategorien personenbezogener Daten, Geheimnisse oder vertraulichen Kundendaten ein. KI-Antworten koennen fehlerhaft sein und muessen fachlich geprueft werden.",
    ...input,
  });
});

test("external AI calls are gated before credit reservation and provider egress", () => {
  const conversations = readFileSync(
    new URL("../src/lib/ai/conversations.ts", import.meta.url),
    "utf8",
  );
  const acknowledgement = conversations.indexOf(
    "await requireAiTransparencyAcknowledgement",
  );
  const credit = conversations.indexOf("await reserveAiAgentCredit", acknowledgement);
  const provider = conversations.indexOf("await completeAiMessage", acknowledgement);
  assert.ok(acknowledgement > -1);
  assert.ok(credit > acknowledgement);
  assert.ok(provider > credit);

  const route = readFileSync(
    new URL("../src/app/api/ai/transparency/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(route, /\.strict\(\)/);
  assert.match(route, /organizationId: user\.organizationId/);
  assert.match(route, /userId: user\.id/);
  assert.doesNotMatch(route, /organizationId: z\./);
  assert.doesNotMatch(route, /userId: z\./);
});

test("all member AI surfaces render the acknowledgement control", () => {
  for (const relativePath of [
    "../src/components/academy/ai-workspace.tsx",
    "../src/components/academy/ai-concierge.tsx",
    "../src/components/academy/embedded-ai-agent.tsx",
  ]) {
    const source = readFileSync(new URL(relativePath, import.meta.url), "utf8");
    assert.match(source, /<AiTransparencyNotice/);
    assert.match(source, /Boolean\(transparency\?\.required\)/);
  }
});
