import assert from "node:assert/strict";
import test from "node:test";

import { runAiProviderPreflight } from "../src/lib/ai/provider-preflight-core";

const productionEnvironment = {
  NODE_ENV: "production",
  AI_BASE_URL: "https://api.openai.com/v1",
  AI_MODEL: "gpt-5.6-terra",
} as const;

function completion(input?: { model?: string; canary?: string }) {
  return new Response(
    JSON.stringify({
      model: input?.model ?? "gpt-5.6-terra",
      choices: [
        {
          finish_reason: "stop",
          message: {
            content: JSON.stringify({
              canary: input?.canary ?? "q-academy-provider-ready",
            }),
          },
        },
      ],
      usage: { prompt_tokens: 20, completion_tokens: 10 },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

test("Terra provider preflight sends the bounded production chat contract", async () => {
  let endpoint = "";
  let request: RequestInit | undefined;
  const result = await runAiProviderPreflight({
    apiKey: "test-provider-key",
    environment: productionEnvironment,
    fetchImplementation: async (input, init) => {
      endpoint = input.toString();
      request = init;
      return completion();
    },
  });

  assert.equal(endpoint, "https://api.openai.com/v1/chat/completions");
  assert.equal(request?.method, "POST");
  assert.equal(request?.redirect, "error");
  assert.equal(request?.cache, "no-store");
  assert.deepEqual(request?.headers, {
    Authorization: "Bearer test-provider-key",
    "Content-Type": "application/json",
  });
  const body = JSON.parse(String(request?.body)) as Record<string, unknown> & {
    messages: Array<{ role: string }>;
    response_format: {
      type: string;
      json_schema: {
        strict: boolean;
        schema: { additionalProperties: boolean; required: string[] };
      };
    };
  };
  assert.equal(body.model, "gpt-5.6-terra");
  assert.equal(body.max_completion_tokens, 128);
  assert.equal(body.reasoning_effort, "none");
  assert.equal(body.store, false);
  assert.doesNotMatch(JSON.stringify(body), /"max_tokens"|"temperature"/);
  assert.equal(body.messages[0]?.role, "developer");
  assert.match(String(body.safety_identifier), /^[0-9a-f]{64}$/);
  assert.equal(body.response_format.type, "json_schema");
  assert.equal(body.response_format.json_schema.strict, true);
  assert.equal(
    body.response_format.json_schema.schema.additionalProperties,
    false,
  );
  assert.deepEqual(body.response_format.json_schema.schema.required, ["canary"]);
  assert.deepEqual(result, {
    ok: true,
    provider: "openai-compatible",
    model: "gpt-5.6-terra",
    schema: "q-academy-provider-preflight-v1",
  });
});

test("Terra provider preflight rejects a non-authoritative response model", async () => {
  await assert.rejects(
    runAiProviderPreflight({
      apiKey: "test-provider-key",
      environment: productionEnvironment,
      fetchImplementation: async () => completion({ model: "gpt-5.6-sol" }),
    }),
    /unexpected completion model/,
  );
});

test("Terra provider preflight rejects an invalid structured canary", async () => {
  await assert.rejects(
    runAiProviderPreflight({
      apiKey: "test-provider-key",
      environment: productionEnvironment,
      fetchImplementation: async () => completion({ canary: "not-ready" }),
    }),
    /provider response is invalid/i,
  );
});

test("Terra provider preflight requires the exact production model", async () => {
  await assert.rejects(
    runAiProviderPreflight({
      apiKey: "test-provider-key",
      environment: {
        ...productionEnvironment,
        AI_MODEL: "gpt-4.1-mini",
      },
      fetchImplementation: async () => completion(),
    }),
    /AI_MODEL must be exactly gpt-5\.6-terra/,
  );
});

test("Terra provider preflight requires HTTPS in production", async () => {
  await assert.rejects(
    runAiProviderPreflight({
      apiKey: "test-provider-key",
      environment: {
        ...productionEnvironment,
        AI_BASE_URL: "http://provider.internal/v1",
      },
      fetchImplementation: async () => completion(),
    }),
    /must use HTTPS in production/,
  );
});

test("Terra provider preflight reports only the bounded HTTP status", async () => {
  await assert.rejects(
    runAiProviderPreflight({
      apiKey: "test-provider-key",
      environment: productionEnvironment,
      fetchImplementation: async () =>
        new Response("provider-secret-detail", { status: 401 }),
    }),
    (error: unknown) => {
      assert.match(String(error), /HTTP 401/);
      assert.doesNotMatch(String(error), /provider-secret-detail/);
      return true;
    },
  );
});
