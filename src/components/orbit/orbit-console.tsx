"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Activity,
  ArrowRightLeft,
  Building2,
  Check,
  Clipboard,
  ExternalLink,
  Gauge,
  KeyRound,
  Orbit,
  Plus,
  ReceiptText,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
  UsersRound,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { getOrbitCopy } from "@/lib/i18n/orbit";
import { intlLocale, type AppLocale } from "@/lib/i18n/model";
import { ORBIT_ENTITLEMENTS, ORBIT_PERMISSIONS } from "@/lib/orbit/policy";
import type { OrbitTransferWarningCode } from "@/lib/orbit/transfer-contract";
import { PLATFORM_TIME_ZONE } from "@/lib/utils";

type WorkspaceListItem = {
  id: string;
  name: string;
  slug: string;
  role: string;
  instanceCount: number;
  instanceSlotLimit: number;
};

type OrbitInstance = {
  id: string;
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  organizationStatus: string;
  customerReference: string | null;
  status: "active" | "suspended";
  seatLimit: number;
  courseLimit: number;
  entitlements: string[];
  userCount: number;
  courseCount: number;
  loginOrigin: string;
};

type OrbitOverview = {
  actor: { displayName: string; email: string; accountId: string };
  access: { role: string; permissions: string[]; organizationIds: string[] };
  workspace: {
    id: string;
    name: string;
    slug: string;
    instanceSlotLimit: number;
  };
  instances: OrbitInstance[];
  memberships: Array<{
    id: string;
    accountId: string;
    displayName: string;
    email: string;
    accountStatus: string;
    role: string;
    permissionSetId: string | null;
    permissionSetName: string | null;
  }>;
  permissionSets: Array<{
    id: string;
    name: string;
    description: string | null;
    permissions: string[];
  }>;
  delegations: Array<{
    id: string;
    partnerAccountId: string;
    partnerName: string;
    partnerEmail: string;
    organizationId: string;
    organizationName: string;
    permissions: string[];
    expiresAt: string | null;
    revokedAt: string | null;
  }>;
  transfers: Array<{
    id: string;
    sourceOrganizationId: string;
    targetOrganizationId: string;
    sourceCourseIds: string[];
    targetCourseIds: string[];
    status: string;
    failureCode: string | null;
    createdAt: string;
  }>;
  auditEvents: Array<{
    id: string;
    actorName: string | null;
    action: string;
    resourceType: string;
    outcome: string;
    createdAt: string;
  }>;
  publishedCourses: Array<{
    id: string;
    organizationId: string;
    title: string;
    slug: string;
  }>;
  billing: null | {
    account: {
      status: "active" | "past_due" | "suspended";
      currency: string;
      billingInterval: "monthly" | "annual";
      baseFeeCents: number;
      includedInstanceSlots: number;
      additionalInstanceFeeCents: number;
      settlementMode: "manual" | "external";
      externalCustomerReference: string | null;
      revision: number;
    };
    effectivePricing: {
      effectiveFrom: string;
      currency: string;
      baseFeeCents: number;
      includedInstanceSlots: number;
      additionalInstanceFeeCents: number;
      revision: number;
    };
    scheduledPricing: null | {
      effectiveFrom: string;
      currency: string;
      baseFeeCents: number;
      includedInstanceSlots: number;
      additionalInstanceFeeCents: number;
      revision: number;
    };
    projection: {
      period: { start: string; end: string };
      instanceCount: number;
      includedInstanceSlots: number;
      additionalInstanceCount: number;
      subtotalCents: number;
      currency: string;
      pricingRevision: number;
    };
    statements: Array<{
      id: string;
      periodStart: string;
      periodEnd: string;
      instanceCount: number;
      additionalInstanceCount: number;
      subtotalCents: number;
      currency: string;
      pricingRevision: number;
      finalizedAt: string;
    }>;
  };
};

type Tab = "instances" | "transfer" | "access" | "billing" | "audit";

type TransferAuthorMapping = {
  sourceUserId: string;
  targetUserId: string;
};

type TransferPreflight = {
  sourceCourseCount: number;
  targetCourseCount: number;
  targetCourseLimit: number;
  mediaAssetCount: number;
  mediaBytes: number;
  warnings: OrbitTransferWarningCode[];
  confirmationToken: string | null;
  authorMappingsComplete: boolean;
  authorMappings: TransferAuthorMapping[];
  sourceAuthors: Array<{
    sourceUserId: string;
    email: string | null;
    role: string | null;
    status: string | null;
    courseIds: string[];
    courseAuthorCourseIds: string[];
    automaticTargetUserId: string | null;
    firstName: string;
    lastName: string;
  }>;
  targetAuthors: Array<{
    targetUserId: string;
    email: string;
    firstName: string;
    lastName: string;
    role: string;
  }>;
};

async function apiMutation(
  path: string,
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  body: unknown | undefined,
  headers: Record<string, string> | undefined,
  fallback: string,
) {
  const response = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(fallback);
  return payload.data;
}

function capacity(current: number, limit: number) {
  return Math.min(100, Math.round((current / Math.max(1, limit)) * 100));
}

function statusStyle(status: string) {
  if (status === "active" || status === "completed" || status === "succeeded") {
    return "bg-[#e7f5f2] text-[#17675f]";
  }
  if (
    status === "failed" ||
    status === "past_due" ||
    status === "suspended" ||
    status === "denied"
  ) {
    return "bg-[#fcebea] text-[#a84136]";
  }
  return "bg-[#eef2f5] text-[#52606d]";
}

function money(locale: AppLocale, cents: number, currency: string) {
  return new Intl.NumberFormat(intlLocale(locale), {
    style: "currency",
    currency,
  }).format(cents / 100);
}

export function OrbitConsole({
  workspaces,
  overview,
  selectedOrganizationId,
  locale,
}: {
  workspaces: WorkspaceListItem[];
  overview: OrbitOverview;
  selectedOrganizationId: string | null;
  locale: AppLocale;
}) {
  const copy = getOrbitCopy(locale);
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("instances");
  const [busy, setBusy] = useState(false);
  const [claimToken, setClaimToken] = useState<string | null>(null);
  const [preflight, setPreflight] = useState<TransferPreflight | null>(null);
  const [transferAuthorMappings, setTransferAuthorMappings] = useState<
    Record<string, string>
  >({});
  const [transferWarningsAccepted, setTransferWarningsAccepted] = useState(false);
  const selectedInstance =
    overview.instances.find(
      (instance) => instance.organizationId === selectedOrganizationId,
    ) ?? overview.instances[0] ?? null;
  const permissions = new Set(overview.access.permissions);
  const partners = overview.memberships.filter((member) => member.role === "partner");
  const [transferSourceId, setTransferSourceId] = useState(
    overview.instances[0]?.organizationId ?? "",
  );
  const targetOptions = overview.instances.filter(
    (instance) => instance.organizationId !== transferSourceId,
  );
  const sourceCourses = useMemo(
    () => overview.publishedCourses.filter((course) => course.organizationId === transferSourceId),
    [overview.publishedCourses, transferSourceId],
  );

  function invalidateTransferPreflight() {
    setPreflight(null);
    setTransferAuthorMappings({});
    setTransferWarningsAccepted(false);
  }

  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    try {
      await action();
      toast.success(success);
      router.refresh();
    } catch {
      toast.error(copy.common.actionFailed);
    } finally {
      setBusy(false);
    }
  }

  async function updateInstance(formData: FormData) {
    if (!selectedInstance) return;
    await run(
      () =>
        apiMutation(
          `/api/orbit/workspaces/${overview.workspace.id}/instances/${selectedInstance.organizationId}`,
          "PATCH",
          {
            customerReference: String(formData.get("customerReference") ?? "").trim() || null,
            status: String(formData.get("status")),
            seatLimit: Number(formData.get("seatLimit")),
            courseLimit: Number(formData.get("courseLimit")),
            entitlements: formData.getAll("entitlements").map(String),
          },
          undefined,
          copy.common.actionFailed,
        ),
      copy.instances.updated,
    );
  }

  function selectedTransferAuthorMappings() {
    if (!preflight) return [];
    return preflight.sourceAuthors.flatMap((author) => {
      const targetUserId = transferAuthorMappings[author.sourceUserId];
      return targetUserId
        ? [{ sourceUserId: author.sourceUserId, targetUserId }]
        : [];
    });
  }

  function transferPayload(formData: FormData, includeAuthorMappings: boolean) {
    return {
      sourceOrganizationId: String(formData.get("sourceOrganizationId")),
      targetOrganizationId: String(formData.get("targetOrganizationId")),
      sourceCourseIds: formData.getAll("sourceCourseIds").map(String),
      authorMappings: includeAuthorMappings
        ? selectedTransferAuthorMappings()
        : [],
    };
  }

  async function preflightTransfer(formData: FormData) {
    setBusy(true);
    try {
      const result = await apiMutation(
        `/api/orbit/workspaces/${overview.workspace.id}/transfers/preflight`,
        "POST",
        transferPayload(formData, Boolean(preflight)),
        undefined,
        copy.common.actionFailed,
      );
      setPreflight(result as TransferPreflight);
      setTransferAuthorMappings(
        Object.fromEntries(
          (result.authorMappings as TransferAuthorMapping[]).map((mapping) => [
            mapping.sourceUserId,
            mapping.targetUserId,
          ]),
        ),
      );
      setTransferWarningsAccepted((current) =>
        preflight &&
        preflight.warnings.join("\n") ===
          (result.warnings as OrbitTransferWarningCode[]).join("\n")
          ? current
          : false,
      );
      toast.success(copy.transfer.preflightComplete);
    } catch {
      invalidateTransferPreflight();
      toast.error(copy.transfer.preflightFailed);
    } finally {
      setBusy(false);
    }
  }

  async function executeTransfer(formData: FormData) {
    if (!preflight) return;
    await run(
      () =>
        apiMutation(
          `/api/orbit/workspaces/${overview.workspace.id}/transfers`,
          "POST",
          {
            ...transferPayload(formData, true),
            confirmationToken: preflight.confirmationToken,
            acceptedWarnings: transferWarningsAccepted ? preflight.warnings : [],
          },
          { "Idempotency-Key": crypto.randomUUID() },
          copy.common.actionFailed,
        ),
      copy.transfer.copyComplete,
    );
    invalidateTransferPreflight();
  }

  async function createPermissionSet(formData: FormData) {
    await run(
      () =>
        apiMutation(
          `/api/orbit/workspaces/${overview.workspace.id}/permission-sets`,
          "POST",
          {
            name: String(formData.get("name")),
            description: String(formData.get("description") ?? "").trim() || null,
            permissions: formData.getAll("permissions").map(String),
          },
          undefined,
          copy.common.actionFailed,
        ),
      copy.access.permissionSetCreated,
    );
  }

  async function upsertMember(formData: FormData) {
    await run(
      () =>
        apiMutation(
          `/api/orbit/workspaces/${overview.workspace.id}/memberships`,
          "PUT",
          {
            accountId: String(formData.get("accountId")),
            role: String(formData.get("role")),
            permissionSetId: String(formData.get("permissionSetId") ?? "") || null,
          },
          undefined,
          copy.common.actionFailed,
        ),
      copy.access.roleSaved,
    );
  }

  async function upsertDelegation(formData: FormData) {
    await run(
      () =>
        apiMutation(
          `/api/orbit/workspaces/${overview.workspace.id}/delegations`,
          "POST",
          {
            partnerAccountId: String(formData.get("partnerAccountId")),
            organizationId: String(formData.get("organizationId")),
            permissions: formData.getAll("permissions").map(String),
            expiresAt: String(formData.get("expiresAt") ?? "")
              ? new Date(String(formData.get("expiresAt"))).toISOString()
              : null,
          },
          undefined,
          copy.common.actionFailed,
        ),
      copy.access.delegationSaved,
    );
  }

  async function createClaim() {
    setBusy(true);
    try {
      const result = await apiMutation(
        `/api/orbit/workspaces/${overview.workspace.id}/instance-claims`,
        "POST",
        {},
        undefined,
        copy.common.actionFailed,
      );
      setClaimToken(result.token);
      toast.success(copy.access.claimCreated);
    } catch {
      toast.error(copy.common.actionFailed);
    } finally {
      setBusy(false);
    }
  }

  async function updateBilling(formData: FormData) {
    const billing = overview.billing;
    if (!billing) return;
    const settlementMode = String(formData.get("settlementMode"));
    await run(
      () =>
        apiMutation(
          `/api/orbit/workspaces/${overview.workspace.id}/billing`,
          "PATCH",
          {
            status: String(formData.get("status")),
            currency: String(formData.get("currency")).trim().toUpperCase(),
            billingInterval: String(formData.get("billingInterval")),
            baseFeeCents: Math.round(Number(formData.get("baseFee")) * 100),
            includedInstanceSlots: Number(formData.get("includedInstanceSlots")),
            additionalInstanceFeeCents: Math.round(
              Number(formData.get("additionalInstanceFee")) * 100,
            ),
            settlementMode,
            externalCustomerReference:
              settlementMode === "external"
                ? String(formData.get("externalCustomerReference") ?? "").trim() || null
                : null,
            expectedRevision: billing.account.revision,
          },
          undefined,
          copy.common.actionFailed,
        ),
      copy.billing.updated,
    );
  }

  async function finalizeBilling() {
    await run(
      () =>
        apiMutation(
          `/api/orbit/workspaces/${overview.workspace.id}/billing/statements/finalize`,
          "POST",
          {},
          undefined,
          copy.common.actionFailed,
        ),
      copy.billing.finalized,
    );
  }

  const billingPricing = overview.billing
    ? overview.billing.scheduledPricing ?? overview.billing.effectivePricing
    : null;
  const transferAuthorMappingsSelected =
    preflight?.sourceAuthors.every(
      (author) => Boolean(transferAuthorMappings[author.sourceUserId]),
    ) ?? true;

  function updateTransferAuthorMapping(sourceUserId: string, targetUserId: string) {
    setTransferAuthorMappings((current) => ({
      ...current,
      [sourceUserId]: targetUserId,
    }));
    setPreflight((current) =>
      current
        ? {
            ...current,
            confirmationToken: null,
            authorMappingsComplete: false,
          }
        : current,
    );
  }

  function targetAuthorOptionDisabled(
    sourceUserId: string,
    targetUserId: string,
  ) {
    if (!preflight) return false;
    const source = preflight.sourceAuthors.find(
      (author) => author.sourceUserId === sourceUserId,
    );
    if (!source?.courseAuthorCourseIds.length) return false;
    return preflight.sourceAuthors.some(
      (other) =>
        other.sourceUserId !== sourceUserId &&
        transferAuthorMappings[other.sourceUserId] === targetUserId &&
        other.courseAuthorCourseIds.some((courseId) =>
          source.courseAuthorCourseIds.includes(courseId),
        ),
    );
  }

  return (
    <div className="min-h-screen bg-[#f3f5f6] text-[#17212b] lg:grid lg:grid-cols-[248px_minmax(0,1fr)]">
      <aside className="border-b border-[#dfe4e8] bg-[#132d45] text-white lg:min-h-screen lg:border-b-0 lg:border-r lg:border-[#294157]">
        <div className="flex h-16 items-center gap-3 border-b border-white/10 px-5">
          <Orbit className="size-6 text-[#62c6ba]" />
          <div>
            <p className="text-sm font-bold">Orbit</p>
            <p className="text-[11px] text-[#b8c7d3]">{copy.common.controlPlane}</p>
          </div>
        </div>
        <nav className="flex gap-2 overflow-x-auto p-3 lg:block lg:space-y-1 lg:p-4">
          {workspaces.map((workspace) => (
            <Link
              key={workspace.id}
              href={`/orbit?workspace=${workspace.id}`}
              className={`block min-w-44 rounded px-3 py-2.5 text-sm transition-colors ${workspace.id === overview.workspace.id ? "bg-white/12 text-white" : "text-[#c8d4de] hover:bg-white/7"}`}
            >
              <span className="block truncate font-semibold">{workspace.name}</span>
              <span className="mt-0.5 block text-[11px] text-[#9fb2c1]">
                {copy.common.instances(workspace.instanceCount)} / {workspace.instanceSlotLimit}
              </span>
            </Link>
          ))}
        </nav>
        <div className="hidden border-t border-white/10 p-4 text-xs text-[#b8c7d3] lg:block">
          <p className="truncate font-semibold text-white">{overview.actor.displayName}</p>
          <p className="mt-0.5 truncate">{overview.actor.email}</p>
          <Link href="/academy" className="mt-3 inline-flex items-center gap-1.5 font-semibold text-[#62c6ba] hover:text-white">
            {copy.common.academy} <ExternalLink className="size-3.5" />
          </Link>
        </div>
      </aside>

      <main className="min-w-0">
        <header className="border-b border-[#dfe4e8] bg-white px-4 py-4 md:px-7">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-xl font-bold">{overview.workspace.name}</h1>
              <p className="text-xs text-[#66727f]">{copy.common.role[overview.access.role] ?? overview.access.role} / {overview.workspace.slug}</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="rounded bg-[#eef2f5] px-2.5 py-1.5 text-xs font-semibold text-[#52606d]">
                {overview.instances.length}/{overview.workspace.instanceSlotLimit} {copy.common.slots}
              </span>
              <Button variant="secondary" size="icon" onClick={() => router.refresh()} title={copy.common.refresh}>
                <RefreshCw className="size-4" />
              </Button>
            </div>
          </div>
          <div className="mt-4 flex gap-1 overflow-x-auto border-b border-[#edf0f2]">
            {([
              ["instances", Building2],
              ["transfer", ArrowRightLeft],
              ["access", ShieldCheck],
              ["billing", ReceiptText],
              ["audit", Activity],
            ] as const)
              .filter(([value]) => value !== "billing" || overview.billing)
              .map(([value, Icon]) => (
              <button
                key={value}
                type="button"
                onClick={() => setTab(value)}
                className={`flex h-10 items-center gap-2 border-b-2 px-3 text-sm font-semibold ${tab === value ? "border-[#2b9188] text-[#17324d]" : "border-transparent text-[#66727f]"}`}
              >
                <Icon className="size-4" /> {copy.common.tabs[value]}
              </button>
            ))}
          </div>
        </header>

        <div className="p-4 md:p-7">
          {tab === "instances" ? (
            <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
              <section className="panel overflow-hidden">
                <div className="border-b border-[#e5e9ec] px-5 py-4">
                  <h2 className="font-bold">{copy.instances.title}</h2>
                </div>
                <div className="divide-y divide-[#edf0f2]">
                  {overview.instances.map((instance) => (
                    <Link
                      key={instance.id}
                      href={`/orbit?workspace=${overview.workspace.id}&instance=${instance.organizationId}`}
                      className={`block p-5 hover:bg-[#f8f9fa] ${selectedInstance?.id === instance.id ? "bg-[#f1f8f7]" : ""}`}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="font-bold">{instance.organizationName}</h3>
                            <span className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase ${statusStyle(instance.status)}`}>{copy.common.status[instance.status] ?? instance.status}</span>
                          </div>
                          <p className="mt-1 text-xs text-[#66727f]">{instance.customerReference || instance.organizationSlug}</p>
                        </div>
                        <span className="text-xs font-semibold text-[#52606d]">{copy.instances.entitlements(instance.entitlements.length)}</span>
                      </div>
                      <div className="mt-4 grid gap-4 sm:grid-cols-2">
                        <div>
                          <div className="mb-1.5 flex justify-between text-xs"><span>{copy.instances.seats}</span><span>{instance.userCount}/{instance.seatLimit}</span></div>
                          <div className="h-1.5 overflow-hidden rounded bg-[#e5e9ec]"><div className="h-full bg-[#4f7cac]" style={{ width: `${capacity(instance.userCount, instance.seatLimit)}%` }} /></div>
                        </div>
                        <div>
                          <div className="mb-1.5 flex justify-between text-xs"><span>{copy.instances.courses}</span><span>{instance.courseCount}/{instance.courseLimit}</span></div>
                          <div className="h-1.5 overflow-hidden rounded bg-[#e5e9ec]"><div className="h-full bg-[#2b9188]" style={{ width: `${capacity(instance.courseCount, instance.courseLimit)}%` }} /></div>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              </section>

              {selectedInstance ? (
                <section className="panel self-start p-5">
                  <div className="mb-5 flex items-center justify-between border-b border-[#edf0f2] pb-4">
                    <div>
                      <h2 className="font-bold">{selectedInstance.organizationName}</h2>
                      <p className="text-xs text-[#66727f]">{selectedInstance.organizationSlug}</p>
                    </div>
                    <a href={`${selectedInstance.loginOrigin}/login`} target="_blank" rel="noreferrer" className="flex size-9 items-center justify-center rounded border border-[#dfe4e8] text-[#52606d] hover:bg-[#f4f6f7]" title={copy.instances.open}>
                      <ExternalLink className="size-4" />
                    </a>
                  </div>
                  {permissions.has("instances:manage") || permissions.has("entitlements:manage") ? (
                    <form action={updateInstance} className="grid gap-4">
                      <label className="grid gap-1 text-xs font-semibold">{copy.instances.customerReference}<input name="customerReference" defaultValue={selectedInstance.customerReference ?? ""} maxLength={120} className="h-9 rounded border px-3 text-sm" /></label>
                      <div className="grid grid-cols-2 gap-3">
                        <label className="grid gap-1 text-xs font-semibold">{copy.instances.seatLimit}<input name="seatLimit" type="number" min={1} max={1000000} defaultValue={selectedInstance.seatLimit} className="h-9 rounded border px-3 text-sm" /></label>
                        <label className="grid gap-1 text-xs font-semibold">{copy.instances.courseLimit}<input name="courseLimit" type="number" min={1} max={1000000} defaultValue={selectedInstance.courseLimit} className="h-9 rounded border px-3 text-sm" /></label>
                      </div>
                      <label className="grid gap-1 text-xs font-semibold">{copy.instances.status}<select name="status" defaultValue={selectedInstance.status} className="h-9 rounded border px-3 text-sm"><option value="active">{copy.common.status.active}</option><option value="suspended">{copy.common.status.suspended}</option></select></label>
                      <fieldset className="grid grid-cols-2 gap-2">
                        <legend className="mb-2 text-xs font-semibold">{copy.instances.entitlementsLabel}</legend>
                        {ORBIT_ENTITLEMENTS.map((entitlement) => (
                          <label key={entitlement} className="flex items-center gap-2 text-xs"><input type="checkbox" name="entitlements" value={entitlement} defaultChecked={selectedInstance.entitlements.includes(entitlement)} />{entitlement.replaceAll("_", " ")}</label>
                        ))}
                      </fieldset>
                      <Button type="submit" disabled={busy}><Check className="size-4" /> {copy.instances.save}</Button>
                    </form>
                  ) : null}
                </section>
              ) : null}
            </div>
          ) : null}

          {tab === "transfer" ? (
            <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
              <section className="panel p-5">
                <div className="mb-5 flex items-center gap-2 border-b border-[#edf0f2] pb-4"><ArrowRightLeft className="size-5 text-[#2b9188]" /><h2 className="font-bold">{copy.transfer.title}</h2></div>
                <form className="grid gap-5" action={preflight?.confirmationToken ? executeTransfer : preflightTransfer}>
                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="grid gap-1.5 text-sm font-semibold">{copy.transfer.source}<select name="sourceOrganizationId" value={transferSourceId} onChange={(event) => { setTransferSourceId(event.target.value); invalidateTransferPreflight(); }} className="h-10 rounded border px-3">{overview.instances.map((instance) => <option key={instance.id} value={instance.organizationId}>{instance.organizationName}</option>)}</select></label>
                    <label className="grid gap-1.5 text-sm font-semibold">{copy.transfer.target}<select name="targetOrganizationId" required onChange={invalidateTransferPreflight} className="h-10 rounded border px-3">{targetOptions.map((instance) => <option key={instance.id} value={instance.organizationId}>{instance.organizationName}</option>)}</select></label>
                  </div>
                  <fieldset className="border-t border-[#edf0f2] pt-4">
                    <legend className="px-1 text-sm font-bold">{copy.transfer.publishedCourses}</legend>
                    <div className="mt-3 grid gap-2 md:grid-cols-2">
                      {sourceCourses.map((course) => <label key={course.id} className="flex items-center gap-3 rounded border border-[#e5e9ec] px-3 py-2.5 text-sm"><input type="checkbox" name="sourceCourseIds" value={course.id} onChange={invalidateTransferPreflight} /><span className="truncate">{course.title}</span></label>)}
                      {!sourceCourses.length ? <p className="text-sm text-[#66727f]">{copy.transfer.noPublishedCourses}</p> : null}
                    </div>
                  </fieldset>
                  {preflight?.sourceAuthors.length ? (
                    <fieldset className="border-t border-[#edf0f2] pt-4">
                      <legend className="px-1 text-sm font-bold">
                        {copy.transfer.authorMappingTitle}
                      </legend>
                      <p className="mt-2 text-xs text-[#66727f]">
                        {copy.transfer.authorMappingDescription}
                      </p>
                      <div className="mt-3 grid gap-3">
                        {preflight.sourceAuthors.map((author) => {
                          const selectedTargetId =
                            transferAuthorMappings[author.sourceUserId] ?? "";
                          return (
                            <label
                              key={author.sourceUserId}
                              className="grid min-w-0 gap-1.5 text-sm font-semibold md:grid-cols-[minmax(0,1fr)_minmax(220px,1fr)] md:items-center"
                            >
                              <span className="min-w-0">
                                <span className="block truncate">
                                  {author.firstName} {author.lastName}
                                </span>
                                <span className="block truncate text-xs font-normal text-[#66727f]">
                                  {author.email ?? copy.transfer.historicalAuthor}
                                </span>
                              </span>
                              <select
                                value={selectedTargetId}
                                required
                                onChange={(event) =>
                                  updateTransferAuthorMapping(
                                    author.sourceUserId,
                                    event.target.value,
                                  )
                                }
                                className="h-10 min-w-0 rounded border px-3 font-normal"
                              >
                                <option value="">{copy.transfer.selectTargetAuthor}</option>
                                {preflight.targetAuthors.map((candidate) => (
                                  <option
                                    key={candidate.targetUserId}
                                    value={candidate.targetUserId}
                                    disabled={targetAuthorOptionDisabled(
                                      author.sourceUserId,
                                      candidate.targetUserId,
                                    )}
                                  >
                                    {candidate.firstName} {candidate.lastName} ({candidate.email})
                                    {author.automaticTargetUserId === candidate.targetUserId
                                      ? ` - ${copy.transfer.automaticMatch}`
                                      : ""}
                                  </option>
                                ))}
                              </select>
                            </label>
                          );
                        })}
                        {!preflight.targetAuthors.length ? (
                          <p role="alert" className="text-sm font-semibold text-[#a84136]">
                            {copy.transfer.noTargetAuthors}
                          </p>
                        ) : null}
                      </div>
                    </fieldset>
                  ) : null}
                  {preflight?.warnings.length ? (
                    <label className="flex items-start gap-3 border-l-4 border-[#c97b19] bg-[#fff7e8] px-4 py-3 text-sm text-[#6f4310]">
                      <input type="checkbox" checked={transferWarningsAccepted} onChange={(event) => setTransferWarningsAccepted(event.target.checked)} className="mt-0.5 size-4 shrink-0" />
                      <span>{copy.transfer.confirmWarnings}</span>
                    </label>
                  ) : null}
                  <Button type="submit" disabled={busy || !targetOptions.length || !sourceCourses.length || !transferAuthorMappingsSelected || Boolean(preflight?.warnings.length && !transferWarningsAccepted)}>
                    {preflight ? <ArrowRightLeft className="size-4" /> : <Gauge className="size-4" />}
                    {preflight?.confirmationToken
                      ? copy.transfer.execute
                      : preflight
                        ? copy.transfer.confirmAuthorMapping
                        : copy.transfer.preflight}
                  </Button>
                </form>
              </section>
              <section className="panel self-start p-5">
                <h2 className="mb-4 font-bold">{copy.transfer.preflight}</h2>
                {preflight ? (
                  <div className="grid gap-4">
                    <dl className="grid grid-cols-2 gap-3 text-sm">
                      <div className="rounded bg-[#f4f7f8] p-3"><dt className="text-xs text-[#66727f]">{copy.transfer.courses}</dt><dd className="mt-1 text-lg font-bold">{preflight.sourceCourseCount}</dd></div>
                      <div className="rounded bg-[#f4f7f8] p-3"><dt className="text-xs text-[#66727f]">{copy.transfer.media}</dt><dd className="mt-1 text-lg font-bold">{preflight.mediaAssetCount}</dd></div>
                      <div className="col-span-2 rounded bg-[#f4f7f8] p-3"><dt className="text-xs text-[#66727f]">{copy.transfer.targetUtilization}</dt><dd className="mt-1 font-bold">{preflight.targetCourseCount + preflight.sourceCourseCount}/{preflight.targetCourseLimit} {copy.transfer.courses}</dd></div>
                      <div className="col-span-2 rounded bg-[#e7f5f2] p-3 text-[#17675f]"><dt className="text-xs">{copy.transfer.mediaVolume}</dt><dd className="mt-1 font-bold">{new Intl.NumberFormat(intlLocale(locale), { style: "unit", unit: "megabyte", maximumFractionDigits: 1 }).format(preflight.mediaBytes / 1_000_000)}</dd></div>
                    </dl>
                    {preflight.warnings.length ? (
                      <div role="alert" className="border-l-4 border-[#c97b19] bg-[#fff7e8] px-4 py-3 text-[#6f4310]">
                        <h3 className="flex items-center gap-2 text-sm font-bold"><TriangleAlert aria-hidden="true" className="size-4 shrink-0" />{copy.transfer.warningsTitle}</h3>
                        <ul className="mt-2 grid list-disc gap-1 pl-5 text-sm">
                          {preflight.warnings.map((warning) => <li key={warning}>{copy.transfer.warnings[warning]}</li>)}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                ) : <p className="text-sm text-[#66727f]">{copy.transfer.notRun}</p>}
              </section>
              <section className="panel overflow-hidden xl:col-span-2">
                <div className="border-b border-[#e5e9ec] px-5 py-4"><h2 className="font-bold">{copy.transfer.journal}</h2></div>
                <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-sm"><thead className="bg-[#f7f9fa] text-xs text-[#66727f]"><tr><th className="px-5 py-3">{copy.transfer.time}</th><th className="px-5 py-3">{copy.transfer.source}</th><th className="px-5 py-3">{copy.transfer.target}</th><th className="px-5 py-3">{copy.transfer.courses}</th><th className="px-5 py-3">{copy.transfer.status}</th></tr></thead><tbody className="divide-y divide-[#edf0f2]">{overview.transfers.map((transfer) => <tr key={transfer.id}><td className="px-5 py-3">{new Date(transfer.createdAt).toLocaleString(intlLocale(locale), { timeZone: PLATFORM_TIME_ZONE })}</td><td className="px-5 py-3 font-mono text-xs">{transfer.sourceOrganizationId.slice(0, 8)}</td><td className="px-5 py-3 font-mono text-xs">{transfer.targetOrganizationId.slice(0, 8)}</td><td className="px-5 py-3">{transfer.sourceCourseIds.length}</td><td className="px-5 py-3"><span className={`rounded px-2 py-1 text-[10px] font-bold uppercase ${statusStyle(transfer.status)}`}>{copy.common.status[transfer.status] ?? transfer.status}</span></td></tr>)}</tbody></table></div>
              </section>
            </div>
          ) : null}

          {tab === "access" ? (
            <div className="grid gap-5 xl:grid-cols-2">
              {permissions.has("instances:manage") ? (
                <section className="panel p-5">
                  <div className="mb-4 flex items-center justify-between border-b border-[#edf0f2] pb-4"><div className="flex items-center gap-2"><KeyRound className="size-5 text-[#2b9188]" /><h2 className="font-bold">{copy.access.customerSlot}</h2></div><Button size="sm" onClick={createClaim} disabled={busy || overview.instances.length >= overview.workspace.instanceSlotLimit}><Plus className="size-4" /> {copy.access.code}</Button></div>
                  {claimToken ? <div className="flex items-center gap-2 rounded border border-[#b8ddd8] bg-[#edf8f6] p-3"><code className="min-w-0 flex-1 break-all text-xs">{claimToken}</code><button type="button" onClick={() => navigator.clipboard.writeText(claimToken)} title={copy.access.copy} className="flex size-8 shrink-0 items-center justify-center rounded hover:bg-white"><Clipboard className="size-4" /></button></div> : <p className="text-sm text-[#66727f]">{copy.access.occupiedSlots(overview.instances.length, overview.workspace.instanceSlotLimit)}</p>}
                </section>
              ) : null}

              {permissions.has("memberships:manage") ? (
                <section className="panel p-5">
                  <div className="mb-4 flex items-center gap-2 border-b border-[#edf0f2] pb-4"><UsersRound className="size-5 text-[#4f7cac]" /><h2 className="font-bold">{copy.access.organizationRole}</h2></div>
                  <form action={upsertMember} className="grid gap-3 sm:grid-cols-2">
                    <label className="grid gap-1 text-xs font-semibold sm:col-span-2">{copy.access.accountId}<input name="accountId" required className="h-9 rounded border px-3 font-mono text-xs" /></label>
                    <label className="grid gap-1 text-xs font-semibold">{copy.access.role}<select name="role" className="h-9 rounded border px-3 text-sm"><option value="administrator">{copy.common.role.administrator}</option><option value="operator">{copy.common.role.operator}</option><option value="auditor">{copy.common.role.auditor}</option><option value="partner">{copy.common.role.partner}</option><option value="owner">{copy.common.role.owner}</option></select></label>
                    <label className="grid gap-1 text-xs font-semibold">{copy.access.permissionSet}<select name="permissionSetId" className="h-9 rounded border px-3 text-sm"><option value="">{copy.access.roleDefault}</option>{overview.permissionSets.map((set) => <option key={set.id} value={set.id}>{set.name}</option>)}</select></label>
                    <Button type="submit" disabled={busy} className="sm:col-span-2"><Check className="size-4" /> {copy.access.saveRole}</Button>
                  </form>
                  <div className="mt-5 divide-y divide-[#edf0f2] border-t border-[#edf0f2]">{overview.memberships.map((member) => <div key={member.id} className="flex items-center justify-between gap-3 py-3 text-sm"><div className="min-w-0"><p className="truncate font-semibold">{member.displayName}</p><p className="truncate text-xs text-[#66727f]">{member.email}</p></div><span className="rounded bg-[#eef2f5] px-2 py-1 text-[10px] font-bold uppercase">{copy.common.role[member.role] ?? member.role}</span></div>)}</div>
                </section>
              ) : null}

              {permissions.has("memberships:manage") ? (
                <section className="panel p-5">
                  <div className="mb-4 flex items-center gap-2 border-b border-[#edf0f2] pb-4"><ShieldCheck className="size-5 text-[#d6a536]" /><h2 className="font-bold">{copy.access.permissionSet}</h2></div>
                  <form action={createPermissionSet} className="grid gap-3">
                    <div className="grid gap-3 sm:grid-cols-2"><label className="grid gap-1 text-xs font-semibold">{copy.access.name}<input name="name" required maxLength={100} className="h-9 rounded border px-3 text-sm" /></label><label className="grid gap-1 text-xs font-semibold">{copy.access.description}<input name="description" maxLength={500} className="h-9 rounded border px-3 text-sm" /></label></div>
                    <fieldset className="grid gap-2 sm:grid-cols-2"><legend className="mb-2 text-xs font-semibold">{copy.access.permissions}</legend>{ORBIT_PERMISSIONS.map((permission) => <label key={permission} className="flex items-center gap-2 text-xs"><input name="permissions" type="checkbox" value={permission} />{permission}</label>)}</fieldset>
                    <Button type="submit" disabled={busy}><Plus className="size-4" /> {copy.access.createPermissionSet}</Button>
                  </form>
                </section>
              ) : null}

              {permissions.has("delegations:manage") ? (
                <section className="panel p-5">
                  <div className="mb-4 flex items-center gap-2 border-b border-[#edf0f2] pb-4"><ShieldCheck className="size-5 text-[#ee6c5d]" /><h2 className="font-bold">{copy.access.partnerDelegation}</h2></div>
                  <form action={upsertDelegation} className="grid gap-3 sm:grid-cols-2">
                    <label className="grid gap-1 text-xs font-semibold">{copy.access.partner}<select name="partnerAccountId" required className="h-9 rounded border px-3 text-sm"><option value="">{copy.access.select}</option>{partners.map((partner) => <option key={partner.id} value={partner.accountId}>{partner.displayName}</option>)}</select></label>
                    <label className="grid gap-1 text-xs font-semibold">{copy.access.instance}<select name="organizationId" required className="h-9 rounded border px-3 text-sm"><option value="">{copy.access.select}</option>{overview.instances.map((instance) => <option key={instance.id} value={instance.organizationId}>{instance.organizationName}</option>)}</select></label>
                    <label className="grid gap-1 text-xs font-semibold sm:col-span-2">{copy.access.expires}<input name="expiresAt" type="datetime-local" className="h-9 rounded border px-3 text-sm" /></label>
                    <fieldset className="grid gap-2 sm:col-span-2 sm:grid-cols-2"><legend className="mb-2 text-xs font-semibold">{copy.access.scope}</legend>{["instances:read", "transfers:read", "transfers:create", "audit:read"].map((permission) => <label key={permission} className="flex items-center gap-2 text-xs"><input name="permissions" type="checkbox" value={permission} />{permission}</label>)}</fieldset>
                    <Button type="submit" disabled={busy || !partners.length} className="sm:col-span-2"><Check className="size-4" /> {copy.access.saveDelegation}</Button>
                  </form>
                  <div className="mt-5 divide-y divide-[#edf0f2] border-t border-[#edf0f2]">{overview.delegations.map((delegation) => <div key={delegation.id} className="flex items-center justify-between gap-3 py-3 text-sm"><div className="min-w-0"><p className="truncate font-semibold">{delegation.partnerName} / {delegation.organizationName}</p><p className="truncate text-xs text-[#66727f]">{delegation.permissions.join(", ")}</p></div>{!delegation.revokedAt ? <Button variant="ghost" size="sm" disabled={busy} onClick={() => run(() => apiMutation(`/api/orbit/workspaces/${overview.workspace.id}/delegations/${delegation.id}`, "DELETE", undefined, undefined, copy.common.actionFailed), copy.access.delegationRevoked)}>{copy.access.revoke}</Button> : <span className="text-xs text-[#a84136]">{copy.access.revoked}</span>}</div>)}</div>
                </section>
              ) : null}
            </div>
          ) : null}

          {tab === "billing" && overview.billing && billingPricing ? (
            <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
              <section className="panel p-5">
                <div className="mb-5 flex items-center gap-2 border-b border-[#edf0f2] pb-4">
                  <ReceiptText className="size-5 text-[#2b9188]" />
                  <h2 className="font-bold">{copy.billing.configuration}</h2>
                </div>
                {permissions.has("billing:manage") ? (
                  <form action={updateBilling} className="grid gap-4 md:grid-cols-2">
                    <label className="grid gap-1 text-xs font-semibold">{copy.billing.status}<select name="status" defaultValue={overview.billing.account.status} className="h-9 rounded border px-3 text-sm"><option value="active">{copy.common.status.active}</option><option value="past_due">{copy.common.status.past_due}</option><option value="suspended">{copy.common.status.suspended}</option></select></label>
                    <label className="grid gap-1 text-xs font-semibold">{copy.billing.interval}<input type="hidden" name="billingInterval" value={overview.billing.account.billingInterval} /><input disabled value={overview.billing.account.billingInterval === "annual" ? copy.billing.annual : copy.billing.monthly} className="h-9 rounded border bg-[#f4f7f8] px-3 text-sm" /><span className="font-normal text-[#66727f]">{copy.billing.intervalLocked}</span></label>
                    <label className="grid gap-1 text-xs font-semibold">{copy.billing.currency}<input name="currency" required pattern="[A-Z]{3}" maxLength={3} defaultValue={billingPricing.currency} className="h-9 rounded border px-3 text-sm uppercase" /></label>
                    <label className="grid gap-1 text-xs font-semibold">{copy.billing.baseFee}<input name="baseFee" type="number" min={0} max={1_000_000_000} step="0.01" required defaultValue={billingPricing.baseFeeCents / 100} className="h-9 rounded border px-3 text-sm" /></label>
                    <label className="grid gap-1 text-xs font-semibold">{copy.billing.includedSlots}<input name="includedInstanceSlots" type="number" min={0} max={overview.workspace.instanceSlotLimit} required defaultValue={billingPricing.includedInstanceSlots} className="h-9 rounded border px-3 text-sm" /></label>
                    <label className="grid gap-1 text-xs font-semibold">{copy.billing.additionalFee}<input name="additionalInstanceFee" type="number" min={0} max={1_000_000_000} step="0.01" required defaultValue={billingPricing.additionalInstanceFeeCents / 100} className="h-9 rounded border px-3 text-sm" /></label>
                    <label className="grid gap-1 text-xs font-semibold">{copy.billing.settlement}<select name="settlementMode" defaultValue={overview.billing.account.settlementMode} className="h-9 rounded border px-3 text-sm"><option value="manual">{copy.billing.manual}</option><option value="external">{copy.billing.external}</option></select></label>
                    <label className="grid gap-1 text-xs font-semibold">{copy.billing.externalReference}<input name="externalCustomerReference" maxLength={180} defaultValue={overview.billing.account.externalCustomerReference ?? ""} className="h-9 rounded border px-3 text-sm" /></label>
                    <Button type="submit" disabled={busy} className="md:col-span-2"><Check className="size-4" /> {copy.billing.save}</Button>
                    <p className="text-xs text-[#66727f] md:col-span-2">{overview.billing.scheduledPricing ? copy.billing.scheduledPricing : copy.billing.effectivePricing}: {copy.billing.revision} {billingPricing.revision}, {copy.billing.effectiveFrom} {new Date(billingPricing.effectiveFrom).toLocaleDateString(intlLocale(locale), { timeZone: "UTC" })}</p>
                  </form>
                ) : (
                  <p className="text-sm text-[#66727f]">{copy.billing.readOnly}</p>
                )}
              </section>

              <section className="panel self-start p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold text-[#66727f]">{copy.billing.currentProjection}</p>
                    <p className="mt-1 text-2xl font-bold">{money(locale, overview.billing.projection.subtotalCents, overview.billing.projection.currency)}</p>
                  </div>
                  <span className={`rounded px-2 py-1 text-[10px] font-bold uppercase ${statusStyle(overview.billing.account.status)}`}>{copy.common.status[overview.billing.account.status] ?? overview.billing.account.status}</span>
                </div>
                <dl className="mt-5 grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded bg-[#f4f7f8] p-3"><dt className="text-xs text-[#66727f]">{copy.billing.instances}</dt><dd className="mt-1 font-bold">{overview.billing.projection.instanceCount}</dd></div>
                  <div className="rounded bg-[#f4f7f8] p-3"><dt className="text-xs text-[#66727f]">{copy.billing.additionalInstances}</dt><dd className="mt-1 font-bold">{overview.billing.projection.additionalInstanceCount}</dd></div>
                  <div className="col-span-2 rounded bg-[#f4f7f8] p-3"><dt className="text-xs text-[#66727f]">{copy.billing.effectivePricing}</dt><dd className="mt-1 font-semibold">{copy.billing.revision} {overview.billing.effectivePricing.revision}</dd></div>
                  <div className="col-span-2 rounded bg-[#f4f7f8] p-3"><dt className="text-xs text-[#66727f]">{copy.billing.period}</dt><dd className="mt-1 font-semibold">{new Date(overview.billing.projection.period.start).toLocaleDateString(intlLocale(locale), { timeZone: "UTC" })} - {new Date(overview.billing.projection.period.end).toLocaleDateString(intlLocale(locale), { timeZone: "UTC" })}</dd></div>
                </dl>
                {permissions.has("billing:manage") ? <Button type="button" variant="secondary" className="mt-4 w-full" disabled={busy} onClick={finalizeBilling}><ReceiptText className="size-4" /> {copy.billing.finalizePrevious}</Button> : null}
              </section>

              <section className="panel overflow-hidden xl:col-span-2">
                <div className="border-b border-[#e5e9ec] px-5 py-4"><h2 className="font-bold">{copy.billing.statements}</h2></div>
                <div className="overflow-x-auto"><table className="w-full min-w-[700px] text-left text-sm"><thead className="bg-[#f7f9fa] text-xs text-[#66727f]"><tr><th className="px-5 py-3">{copy.billing.period}</th><th className="px-5 py-3">{copy.billing.instances}</th><th className="px-5 py-3">{copy.billing.revision}</th><th className="px-5 py-3">{copy.billing.subtotal}</th><th className="px-5 py-3">{copy.billing.finalizedAt}</th></tr></thead><tbody className="divide-y divide-[#edf0f2]">{overview.billing.statements.map((statement) => <tr key={statement.id}><td className="px-5 py-3">{new Date(statement.periodStart).toLocaleDateString(intlLocale(locale), { timeZone: "UTC" })} - {new Date(statement.periodEnd).toLocaleDateString(intlLocale(locale), { timeZone: "UTC" })}</td><td className="px-5 py-3">{statement.instanceCount}</td><td className="px-5 py-3">{statement.pricingRevision}</td><td className="px-5 py-3 font-semibold">{money(locale, statement.subtotalCents, statement.currency)}</td><td className="px-5 py-3">{new Date(statement.finalizedAt).toLocaleString(intlLocale(locale), { timeZone: PLATFORM_TIME_ZONE })}</td></tr>)}</tbody></table></div>
                {!overview.billing.statements.length ? <p className="p-5 text-sm text-[#66727f]">{copy.billing.noStatements}</p> : null}
              </section>
            </div>
          ) : null}

          {tab === "audit" ? (
            <section className="panel overflow-hidden">
              <div className="flex items-center gap-2 border-b border-[#e5e9ec] px-5 py-4"><Activity className="size-5 text-[#4f7cac]" /><h2 className="font-bold">{copy.audit.title}</h2></div>
              <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="bg-[#f7f9fa] text-xs text-[#66727f]"><tr><th className="px-5 py-3">{copy.audit.time}</th><th className="px-5 py-3">{copy.audit.actor}</th><th className="px-5 py-3">{copy.audit.action}</th><th className="px-5 py-3">{copy.audit.resource}</th><th className="px-5 py-3">{copy.audit.outcome}</th></tr></thead><tbody className="divide-y divide-[#edf0f2]">{overview.auditEvents.map((event) => <tr key={event.id}><td className="px-5 py-3 text-xs">{new Date(event.createdAt).toLocaleString(intlLocale(locale), { timeZone: PLATFORM_TIME_ZONE })}</td><td className="px-5 py-3">{event.actorName ?? copy.audit.system}</td><td className="px-5 py-3 font-mono text-xs">{event.action}</td><td className="px-5 py-3">{event.resourceType}</td><td className="px-5 py-3"><span className={`rounded px-2 py-1 text-[10px] font-bold uppercase ${statusStyle(event.outcome)}`}>{copy.common.status[event.outcome] ?? event.outcome}</span></td></tr>)}</tbody></table></div>
            </section>
          ) : null}
        </div>
      </main>
    </div>
  );
}
