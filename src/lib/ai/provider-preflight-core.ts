import { createHash } from "node:crypto";

import { z } from "zod";

import { readBoundedProviderJson } from "./bounded-provider-response";
import {
  aiChatCompletionControls,
  aiChatCompletionSafetyFields,
  aiInstructionRole,
  configuredAiTextModel,
  DEFAULT_AI_TEXT_MODEL,
} from "./chat-completion-config";
import {
  completedChatCompletionResponseSchema,
  confirmedChatCompletionModel,
} from "./chat-completion-response";

const DEFAULT_AI_BASE_URL = "https://api.openai.com/v1";
const MAXIMUM_PREFLIGHT_RESPONSE_BYTES = 64 * 1024;
const MAXIMUM_PREFLIGHT_TIMEOUT_MS = 60_000;
const DEFAULT_PREFLIGHT_TIMEOUT_MS = 30_000;
const PREFLIGHT_CANARY = "q-academy-provider-ready";

const providerPreflightPayloadSchema = z
  .object({ canary: z.literal(PREFLIGHT_CANARY) })
  .strict();

const providerPreflightJsonSchema = {
  type: "object",
  properties: {
    canary: { type: "string", enum: [PREFLIGHT_CANARY] },
  },
  required: ["canary"],
  additionalProperties: false,
} as const;

type FetchImplementation = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export class AiProviderPreflightError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiProviderPreflightError";
  }
}

export function aiProviderPreflightEndpoint(
  environment: Readonly<Record<string, string | undefined>> = process.env,
) {
  const base = (
    environment.AI_BASE_URL?.trim() || DEFAULT_AI_BASE_URL
  ).replace(/\/+$/, "");
  let url: URL;
  try {
    url = new URL(
      base.endsWith("/chat/completions")
        ? base
        : `${base}/chat/completions`,
    );
  } catch {
    throw new AiProviderPreflightError("AI_BASE_URL is invalid.");
  }
  if (
    url.protocol !== "https:" &&
    !(environment.NODE_ENV !== "production" && url.protocol === "http:")
  ) {
    throw new AiProviderPreflightError(
      "AI_BASE_URL must use HTTPS in production.",
    );
  }
  return url.toString();
}

function preflightSafetyIdentifier() {
  return createHash("sha256")
    .update("q-academy-ai-provider-preflight-v1")
    .digest("hex");
}

export async function runAiProviderPreflight(input: {
  apiKey: string;
  environment?: Readonly<Record<string, string | undefined>>;
  fetchImplementation?: FetchImplementation;
  timeoutMs?: number;
}) {
  const environment = input.environment ?? process.env;
  const model = configuredAiTextModel(environment);
  if (model !== DEFAULT_AI_TEXT_MODEL) {
    throw new AiProviderPreflightError(
      `AI_MODEL must be exactly ${DEFAULT_AI_TEXT_MODEL}.`,
    );
  }
  const apiKey = input.apiKey.trim();
  if (!apiKey || apiKey.length > 16 * 1024) {
    throw new AiProviderPreflightError(
      "An AI provider credential is required for the preflight.",
    );
  }
  const timeoutMs = input.timeoutMs ?? DEFAULT_PREFLIGHT_TIMEOUT_MS;
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1_000 ||
    timeoutMs > MAXIMUM_PREFLIGHT_TIMEOUT_MS
  ) {
    throw new AiProviderPreflightError(
      "The AI provider preflight timeout is invalid.",
    );
  }

  const fetchImplementation = input.fetchImplementation ?? fetch;
  let response: Response;
  try {
    response = await fetchImplementation(aiProviderPreflightEndpoint(environment), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        ...aiChatCompletionControls(model, 128),
        ...aiChatCompletionSafetyFields(model, preflightSafetyIdentifier()),
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "q_academy_provider_preflight",
            strict: true,
            schema: providerPreflightJsonSchema,
          },
        },
        messages: [
          {
            role: aiInstructionRole(model),
            content:
              "Return only the JSON object required by the supplied schema.",
          },
          {
            role: "user",
            content: `Return the exact canary value ${PREFLIGHT_CANARY}.`,
          },
        ],
      }),
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
  } catch (error) {
    throw new AiProviderPreflightError(
      error instanceof Error
        ? `AI provider request failed: ${error.message}`
        : "AI provider request failed.",
    );
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new AiProviderPreflightError(
      `AI provider returned HTTP ${response.status}.`,
    );
  }

  try {
    const parsedResponse = completedChatCompletionResponseSchema.parse(
      await readBoundedProviderJson(
        response,
        MAXIMUM_PREFLIGHT_RESPONSE_BYTES,
      ),
    );
    const confirmedModel = confirmedChatCompletionModel(
      model,
      parsedResponse.model,
    );
    const rawContent = parsedResponse.choices[0]?.message.content;
    const content = Array.isArray(rawContent)
      ? rawContent.map((part) => part.text).join("").trim()
      : rawContent?.trim();
    if (!content) {
      throw new Error("AI provider returned an empty completion.");
    }
    providerPreflightPayloadSchema.parse(JSON.parse(content));
    return {
      ok: true,
      provider: "openai-compatible",
      model: confirmedModel,
      schema: "q-academy-provider-preflight-v1",
    } as const;
  } catch (error) {
    throw new AiProviderPreflightError(
      error instanceof Error
        ? `AI provider response is invalid: ${error.message}`
        : "AI provider response is invalid.",
    );
  }
}
