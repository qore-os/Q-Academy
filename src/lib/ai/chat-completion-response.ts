import { z } from "zod";

import { isGpt56Model } from "@/lib/ai/chat-completion-config";

export const completedChatCompletionResponseSchema = z
  .object({
    model: z.string().trim().min(1).max(200),
    choices: z
      .array(
        z
          .object({
            finish_reason: z.literal("stop"),
            message: z
              .object({
                content: z.union([
                  z.string(),
                  z.array(z.object({ text: z.string() }).passthrough()),
                ]),
              })
              .passthrough(),
          })
          .passthrough(),
      )
      .min(1),
    usage: z
      .object({
        prompt_tokens: z.number().int().nonnegative().optional(),
        completion_tokens: z.number().int().nonnegative().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export function confirmedChatCompletionModel(
  requestedModel: string,
  responseModel: string,
) {
  const confirmedModel = responseModel.trim();
  if (isGpt56Model(requestedModel) && confirmedModel !== requestedModel) {
    throw new Error("AI provider returned an unexpected completion model.");
  }
  return confirmedModel;
}
