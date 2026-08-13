export const DEFAULT_AI_TEXT_MODEL = "gpt-5.6-terra" as const;

export function configuredAiTextModel(
  environment: Readonly<Record<string, string | undefined>> = process.env,
) {
  return environment.AI_MODEL?.trim() || DEFAULT_AI_TEXT_MODEL;
}

export function isGpt56Model(model: string) {
  return /^gpt-5\.6(?:$|-)/.test(model.trim().toLowerCase());
}

export function aiInstructionRole(model: string): "developer" | "system" {
  return isGpt56Model(model) ? "developer" : "system";
}

export function aiChatCompletionSafetyFields(
  model: string,
  safetyIdentifier: string,
) {
  if (!isGpt56Model(model)) return {};
  if (!/^[0-9a-f]{64}$/.test(safetyIdentifier)) {
    throw new TypeError(
      "safetyIdentifier must be a privacy-safe SHA-256 reference.",
    );
  }
  return { safety_identifier: safetyIdentifier };
}

export function aiChatCompletionControls(
  model: string,
  maximumCompletionTokens: number,
) {
  if (
    !Number.isSafeInteger(maximumCompletionTokens) ||
    maximumCompletionTokens <= 0
  ) {
    throw new TypeError("maximumCompletionTokens must be a positive integer.");
  }

  if (isGpt56Model(model)) {
    return {
      max_completion_tokens: maximumCompletionTokens,
      // Preserve the former non-reasoning latency and token budget as the migration baseline.
      reasoning_effort: "none" as const,
      store: false,
    };
  }

  return {
    max_tokens: maximumCompletionTokens,
    temperature: 0.2,
  };
}
