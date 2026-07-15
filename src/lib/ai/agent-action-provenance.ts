export type AiMembershipProvenanceSnapshot = Readonly<{
  organizationId: string;
  agentId: string;
  memberId: string;
  targetType: "group" | "bundle";
  targetGroupId: string | null;
  targetBundleId: string | null;
  revokedAt: Date | null;
}>;

export function canRemoveAiMembership(input: {
  organizationId: string;
  agentId: string;
  memberId: string;
  target: Readonly<{ type: "group" | "bundle"; id: string }>;
  assignmentExists: boolean;
  provenance: AiMembershipProvenanceSnapshot | null;
}) {
  const provenance = input.provenance;
  if (!input.assignmentExists || !provenance || provenance.revokedAt) {
    return false;
  }
  if (
    provenance.organizationId !== input.organizationId ||
    provenance.agentId !== input.agentId ||
    provenance.memberId !== input.memberId ||
    provenance.targetType !== input.target.type
  ) {
    return false;
  }
  return input.target.type === "group"
    ? provenance.targetGroupId === input.target.id &&
        provenance.targetBundleId === null
    : provenance.targetBundleId === input.target.id &&
        provenance.targetGroupId === null;
}
