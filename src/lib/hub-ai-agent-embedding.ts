import "server-only";

import { assertPublishedAiAgentReferences } from "@/lib/api/content-block-ai-agent";
import type { ContentBlockAiAgentTransaction } from "@/lib/api/content-block-ai-agent";
import { hubLayoutAiAgentIds } from "@/lib/hub-layout";

export async function assertPublishedAiAgentHubLayout(input: {
  transaction: ContentBlockAiAgentTransaction;
  organizationId: string;
  layout: unknown;
}) {
  return assertPublishedAiAgentReferences({
    transaction: input.transaction,
    organizationId: input.organizationId,
    agentIds: hubLayoutAiAgentIds(input.layout),
  });
}
