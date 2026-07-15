import type { Metadata } from "next";

import { AiAgentManager } from "@/components/admin/ai-agent-manager";
import { AiAgentActionReview } from "@/components/admin/ai-agent-action-review";
import { AiAgentPolicyPanel } from "@/components/admin/ai-agent-policy-panel";
import { AdminCreateButton } from "@/components/admin/admin-create-dialog";
import { PageHeader } from "@/components/ui/page-header";
import {
  aiAgentInsightsPeriodSchema,
  getAiAgentPolicyAdminView,
  getAiAgentUsageInsights,
  getCurrentAiAgentCreditUsage,
} from "@/lib/ai/agent-policy";
import { getAiAgentStudioAdminData } from "@/lib/ai/agent-studio";
import { listAiAgentActionRequests } from "@/lib/ai/agent-actions";
import { requireOrganizationAdmin } from "@/lib/auth";
import { getOrganizationExperienceData } from "@/lib/data";
import { getAiAdminCopy } from "@/lib/i18n/ai-admin";
import { resolveUserLocale } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const user = await requireOrganizationAdmin();
  const locale = await resolveUserLocale(user);
  return { title: getAiAdminCopy(locale).page.metadataTitle };
}

export default async function AiAgentsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string | string[] }>;
}) {
  const user = await requireOrganizationAdmin();
  const [query, locale] = await Promise.all([
    searchParams,
    resolveUserLocale(user),
  ]);
  const copy = getAiAdminCopy(locale);
  const parsedPeriod = aiAgentInsightsPeriodSchema.safeParse(
    typeof query.period === "string" ? query.period : "current_month",
  );
  const period = parsedPeriod.success ? parsedPeriod.data : "current_month";
  const actor = {
    id: user.id,
    organizationId: user.organizationId,
    role: user.role,
  } as const;
  const [studio, experience, policy, insights, actionRequests] = await Promise.all([
    getAiAgentStudioAdminData(actor),
    getOrganizationExperienceData(user.organizationId),
    getAiAgentPolicyAdminView(user.organizationId),
    getAiAgentUsageInsights({
      organizationId: user.organizationId,
      period,
    }),
    listAiAgentActionRequests({
      organizationId: user.organizationId,
      limit: 100,
    }),
  ]);
  const creditUsage = await getCurrentAiAgentCreditUsage(
    user.organizationId,
    policy,
  );
  const statisticsByAgent = new Map(
    experience.agents.map((agent) => [agent.id, agent]),
  );
  const agents = studio.agents.map((agent) => {
    const statistics = statisticsByAgent.get(agent.id);
    return {
      ...agent,
      conversationCount: statistics?.conversationCount ?? 0,
      messageCount: statistics?.messageCount ?? 0,
      memberCount: statistics?.memberCount ?? 0,
      lastMessageAt: statistics?.lastMessageAt ?? null,
    };
  });
  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <PageHeader
        eyebrow={copy.page.eyebrow}
        title={copy.page.title}
        description={copy.page.description}
        actions={<AdminCreateButton resource="agent" locale={locale} />}
      />
      <AiAgentPolicyPanel
        locale={locale}
        policy={policy}
        creditUsage={creditUsage}
        insights={insights}
      />
      <AiAgentActionReview locale={locale} rows={actionRequests} />
      <AiAgentManager
        locale={locale}
        agents={agents}
        options={studio.options}
        canManage
      />
    </div>
  );
}
