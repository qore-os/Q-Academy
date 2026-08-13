import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  aiChatCompletionControls,
  aiChatCompletionSafetyFields,
  aiInstructionRole,
  configuredAiTextModel,
  DEFAULT_AI_TEXT_MODEL,
  isGpt56Model,
} from "../src/lib/ai/chat-completion-config";
import {
  completedChatCompletionResponseSchema,
  confirmedChatCompletionModel,
} from "../src/lib/ai/chat-completion-response";

test("AI text generation defaults to the current balanced GPT-5.6 tier", () => {
  assert.equal(DEFAULT_AI_TEXT_MODEL, "gpt-5.6-terra");
  assert.equal(configuredAiTextModel({}), DEFAULT_AI_TEXT_MODEL);
  assert.equal(
    configuredAiTextModel({ AI_MODEL: "  gpt-5.6-sol  " }),
    "gpt-5.6-sol",
  );
  assert.equal(configuredAiTextModel({ AI_MODEL: "   " }), DEFAULT_AI_TEXT_MODEL);
});

test("GPT-5.6 chat requests use modern bounded non-stored controls", () => {
  assert.equal(isGpt56Model("gpt-5.6"), true);
  assert.equal(isGpt56Model("GPT-5.6-Terra"), true);
  assert.equal(aiInstructionRole(DEFAULT_AI_TEXT_MODEL), "developer");
  assert.deepEqual(aiChatCompletionControls(DEFAULT_AI_TEXT_MODEL, 1_200), {
    max_completion_tokens: 1_200,
    reasoning_effort: "none",
    store: false,
  });
});

test("explicit compatible-provider overrides retain their legacy request contract", () => {
  assert.equal(isGpt56Model("gpt-5.60-terra"), false);
  assert.equal(aiInstructionRole("compatible-local-model"), "system");
  assert.deepEqual(aiChatCompletionControls("compatible-local-model", 350), {
    max_tokens: 350,
    temperature: 0.2,
  });
  assert.deepEqual(
    aiChatCompletionSafetyFields(
      "compatible-local-model",
      "raw-compatible-provider-value",
    ),
    {},
  );
  assert.throws(
    () => aiChatCompletionControls(DEFAULT_AI_TEXT_MODEL, 0),
    /positive integer/,
  );
});

test("GPT-5.6 receives only a validated privacy-safe safety identifier", () => {
  const subjectReference = "a".repeat(64);
  assert.deepEqual(
    aiChatCompletionSafetyFields(DEFAULT_AI_TEXT_MODEL, subjectReference),
    { safety_identifier: subjectReference },
  );
  assert.throws(
    () => aiChatCompletionSafetyFields(DEFAULT_AI_TEXT_MODEL, "raw-user-id"),
    /privacy-safe SHA-256 reference/,
  );
});

test("chat completions fail closed unless the first choice finished normally", () => {
  const completed = {
    model: DEFAULT_AI_TEXT_MODEL,
    choices: [
      { finish_reason: "stop", message: { content: "Complete response" } },
    ],
  };
  assert.equal(
    completedChatCompletionResponseSchema.parse(completed).choices[0]
      ?.finish_reason,
    "stop",
  );
  for (const finishReason of ["length", "content_filter", null]) {
    assert.equal(
      completedChatCompletionResponseSchema.safeParse({
        model: DEFAULT_AI_TEXT_MODEL,
        choices: [
          {
            finish_reason: finishReason,
            message: { content: "Incomplete response" },
          },
        ],
      }).success,
      false,
    );
  }
});

test("GPT-5.6 completion provenance requires the exact confirmed model", () => {
  assert.equal(
    confirmedChatCompletionModel(DEFAULT_AI_TEXT_MODEL, DEFAULT_AI_TEXT_MODEL),
    DEFAULT_AI_TEXT_MODEL,
  );
  assert.throws(
    () => confirmedChatCompletionModel(DEFAULT_AI_TEXT_MODEL, "gpt-4.1-mini"),
    /unexpected completion model/,
  );
  assert.equal(
    confirmedChatCompletionModel("compatible-alias", "compatible-snapshot-v2"),
    "compatible-snapshot-v2",
  );
  assert.equal(
    completedChatCompletionResponseSchema.safeParse({
      choices: [
        { finish_reason: "stop", message: { content: "Missing model" } },
      ],
    }).success,
    false,
  );
});

test("every external AI text path uses the shared GPT-5.6 request contract", () => {
  for (const relativePath of [
    "../src/lib/ai/provider.ts",
    "../src/lib/ai/course-draft.ts",
    "../src/lib/ai/video-description-provider.ts",
  ]) {
    const source = readFileSync(new URL(relativePath, import.meta.url), "utf8");
    assert.match(source, /configuredAiTextModel\(/);
    assert.match(source, /aiChatCompletionControls\(/);
    assert.match(source, /aiInstructionRole\(/);
    assert.match(source, /aiChatCompletionSafetyFields\(/);
    assert.match(source, /completedChatCompletionResponseSchema/);
    assert.doesNotMatch(source, /gpt-4\.1-mini/);
  }
});

test("large text-provider responses use the shared streaming byte bound", () => {
  for (const relativePath of [
    "../src/lib/ai/provider.ts",
    "../src/lib/ai/course-draft.ts",
  ]) {
    const source = readFileSync(new URL(relativePath, import.meta.url), "utf8");
    assert.match(source, /readBoundedProviderJson\(/);
    assert.match(source, /MAX_PROVIDER_RESPONSE_BYTES/);
    assert.doesNotMatch(source, /response\.json\(\)/);
  }
});

test("development and production examples expose the same GPT-5.6 default", () => {
  const environmentExample = readFileSync(
    new URL("../.env.example", import.meta.url),
    "utf8",
  );
  const productionEnvironmentExample = readFileSync(
    new URL("../deploy/.env.production.example", import.meta.url),
    "utf8",
  );
  const productionCompose = readFileSync(
    new URL("../compose.production.yml", import.meta.url),
    "utf8",
  );
  assert.match(environmentExample, /^AI_MODEL=gpt-5\.6-terra$/m);
  assert.match(productionEnvironmentExample, /^AI_MODEL=gpt-5\.6-terra$/m);
  assert.match(
    productionCompose,
    /AI_MODEL: \$\{AI_MODEL:-gpt-5\.6-terra\}/,
  );
});
