"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, KeyRound, Orbit, Plus } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { getOrbitCopy } from "@/lib/i18n/orbit";
import type { AppLocale } from "@/lib/i18n/model";

async function mutate(path: string, body: unknown, fallback: string) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(fallback);
  return payload.data;
}

export function OrbitOnboarding({
  canBootstrap,
  tenantName,
  locale,
}: {
  canBootstrap: boolean;
  tenantName: string;
  locale: AppLocale;
}) {
  const copy = getOrbitCopy(locale);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"bootstrap" | "redeem">(
    canBootstrap ? "bootstrap" : "redeem",
  );

  async function submitBootstrap(formData: FormData) {
    setBusy(true);
    try {
      const workspaceName = String(formData.get("workspaceName") ?? "").trim();
      const workspaceSlug = String(formData.get("workspaceSlug") ?? "").trim();
      await mutate("/api/orbit/workspaces", {
        workspaceName,
        workspaceSlug,
        instanceSlotLimit: Number(formData.get("instanceSlotLimit")),
        billingInterval: String(formData.get("billingInterval")),
      }, copy.common.actionFailed);
      toast.success(copy.onboarding.organizationCreated);
      router.refresh();
    } catch {
      toast.error(copy.common.actionFailed);
    } finally {
      setBusy(false);
    }
  }

  async function submitClaim(formData: FormData) {
    setBusy(true);
    try {
      await mutate("/api/orbit/instance-claims/redeem", {
        token: String(formData.get("token") ?? "").trim(),
        customerReference: String(formData.get("customerReference") ?? "").trim() || null,
      }, copy.common.actionFailed);
      toast.success(copy.onboarding.tenantLinked);
      router.refresh();
    } catch {
      toast.error(copy.common.actionFailed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#f3f5f6] px-4 py-8 text-[#17212b] md:px-8 md:py-14">
      <div className="mx-auto max-w-3xl">
        <header className="mb-8 flex items-center justify-between border-b border-[#dfe4e8] pb-5">
          <div className="flex items-center gap-3">
            <span className="flex size-11 items-center justify-center rounded bg-[#17324d] text-white">
              <Orbit className="size-6" />
            </span>
            <div>
              <h1 className="text-xl font-bold">Orbit {copy.common.controlPlane}</h1>
              <p className="text-sm text-[#66727f]">{tenantName}</p>
            </div>
          </div>
          <a className="text-sm font-semibold text-[#52606d] hover:text-[#17324d]" href="/academy">
            {copy.onboarding.back}
          </a>
        </header>

        <div className="mb-5 inline-flex rounded border border-[#dfe4e8] bg-white p-1">
          {canBootstrap ? (
            <button
              type="button"
              onClick={() => setMode("bootstrap")}
              className={`rounded px-4 py-2 text-sm font-semibold ${mode === "bootstrap" ? "bg-[#17324d] text-white" : "text-[#52606d]"}`}
            >
              {copy.onboarding.newOrganization}
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setMode("redeem")}
            className={`rounded px-4 py-2 text-sm font-semibold ${mode === "redeem" ? "bg-[#17324d] text-white" : "text-[#52606d]"}`}
          >
            {copy.onboarding.instanceCode}
          </button>
        </div>

        {mode === "bootstrap" && canBootstrap ? (
          <form action={submitBootstrap} className="panel grid gap-5 p-6 md:grid-cols-2">
            <div className="md:col-span-2 flex items-center gap-2 border-b border-[#edf0f2] pb-4">
              <Building2 className="size-5 text-[#2b9188]" />
              <h2 className="font-bold">{copy.onboarding.organization}</h2>
            </div>
            <label className="grid gap-1.5 text-sm font-semibold">
              {copy.onboarding.name}
              <input name="workspaceName" required maxLength={160} className="h-10 rounded border px-3" />
            </label>
            <label className="grid gap-1.5 text-sm font-semibold">
              {copy.onboarding.slug}
              <input name="workspaceSlug" required pattern="[a-z0-9][a-z0-9-]*[a-z0-9]" maxLength={100} className="h-10 rounded border px-3" />
            </label>
            <label className="grid gap-1.5 text-sm font-semibold">
              {copy.onboarding.customerSlots}
              <input name="instanceSlotLimit" type="number" min={1} max={10000} defaultValue={5} required className="h-10 rounded border px-3" />
            </label>
            <label className="grid gap-1.5 text-sm font-semibold">
              {copy.billing.interval}
              <select name="billingInterval" defaultValue="monthly" className="h-10 rounded border px-3">
                <option value="monthly">{copy.billing.monthly}</option>
                <option value="annual">{copy.billing.annual}</option>
              </select>
            </label>
            <div className="flex items-end">
              <Button type="submit" disabled={busy} className="w-full md:w-auto">
                <Plus className="size-4" /> {copy.onboarding.createOrganization}
              </Button>
            </div>
          </form>
        ) : (
          <form action={submitClaim} className="panel grid gap-5 p-6 md:grid-cols-2">
            <div className="md:col-span-2 flex items-center gap-2 border-b border-[#edf0f2] pb-4">
              <KeyRound className="size-5 text-[#2b9188]" />
              <h2 className="font-bold">{copy.onboarding.linkInstance}</h2>
            </div>
            <label className="grid gap-1.5 text-sm font-semibold md:col-span-2">
              {copy.onboarding.instanceCode}
              <input name="token" required minLength={32} maxLength={256} autoComplete="off" className="h-10 rounded border px-3 font-mono text-xs" />
            </label>
            <label className="grid gap-1.5 text-sm font-semibold">
              {copy.onboarding.customerReference}
              <input name="customerReference" maxLength={120} className="h-10 rounded border px-3" />
            </label>
            <div className="flex items-end">
              <Button type="submit" disabled={busy} className="w-full md:w-auto">
                <KeyRound className="size-4" /> {copy.onboarding.redeemCode}
              </Button>
            </div>
          </form>
        )}
      </div>
    </main>
  );
}
