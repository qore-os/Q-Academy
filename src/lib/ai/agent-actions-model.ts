import { z } from "zod";

export const aiAgentActionRequestCreateSchema = z
  .object({
    agentId: z.string().uuid(),
    actionConfigurationId: z.string().uuid(),
    memberId: z.string().uuid(),
    conversationId: z.string().uuid().nullable().optional(),
  })
  .strict();

export const aiAgentActionDecisionSchema = z
  .object({
    decision: z.enum(["approve", "reject"]),
    expectedRevision: z.number().int().positive(),
    note: z.string().trim().max(1_000).optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.decision === "reject" && !input.note) {
      context.addIssue({
        code: "custom",
        path: ["note"],
        message: "Eine Ablehnung benoetigt eine Begruendung.",
      });
    }
  });

export const aiAgentActionCancelSchema = z
  .object({ expectedRevision: z.number().int().positive() })
  .strict();
