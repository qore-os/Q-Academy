"use client";

import { useActionState, useState } from "react";
import { KeyRound, LoaderCircle, ShieldCheck } from "lucide-react";
import { OidcStepUpButton } from "@/components/auth/oidc-step-up-button";
import { Button } from "@/components/ui/button";
import {
  updateOrganizationMfaPolicyAction,
  type MfaPolicyActionState,
} from "@/lib/mfa/management-actions";
import { getMfaCopy, localizeMfaMessage } from "@/lib/i18n/mfa";
import type { AppLocale } from "@/lib/i18n/model";

const initialState: MfaPolicyActionState = { ok: null, message: "" };
const inputClass = "focus-ring h-10 w-full rounded-md border border-[#dce1e5] bg-white px-3 text-sm text-[#243444]";

export function MfaPolicyPanel({
  policy,
  canManage,
  passwordRequired,
  locale,
}: {
  policy: {
    required: boolean;
    revision: number;
    privilegedAccounts: number;
    protectedAccounts: number;
  };
  canManage: boolean;
  passwordRequired: boolean;
  locale: AppLocale;
}) {
  const copy = getMfaCopy(locale).policy;
  const [state, action, pending] = useActionState(updateOrganizationMfaPolicyAction, initialState);
  const [required, setRequired] = useState(policy.required);
  const revision = state.revision ?? policy.revision;
  return (
    <section id="sicherheit" className="panel scroll-mt-24 overflow-hidden">
      <header className="flex items-center gap-3 border-b border-[#e8ebee] px-5 py-4">
        <span className="grid size-9 place-items-center rounded-md bg-[#e9f8f6] text-[#167e74]"><ShieldCheck className="size-4" /></span>
        <div>
          <h2 className="text-base font-bold text-[#243444]">{copy.title}</h2>
          <p className="mt-0.5 text-xs text-[#71808b]">{copy.description}</p>
        </div>
      </header>
      <div className="space-y-5 p-5">
        <dl className="grid grid-cols-2 gap-6 border-b border-[#e8ebee] pb-5">
          <div>
            <dt className="text-[10px] font-bold uppercase text-[#71808b]">{copy.privilegedAccounts}</dt>
            <dd className="mt-1 text-lg font-bold text-[#243444]">{policy.privilegedAccounts}</dd>
          </div>
          <div>
            <dt className="text-[10px] font-bold uppercase text-[#52716c]">{copy.protectedAccounts}</dt>
            <dd className="mt-1 text-lg font-bold text-[#167e74]">{policy.protectedAccounts}</dd>
          </div>
        </dl>
        {canManage ? (
          <div className="space-y-4">
            {!passwordRequired ? (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-[#eef3f9] p-3">
                <p className="text-xs text-[#365f8d]">{copy.recentSsoRequired}</p>
                <OidcStepUpButton returnTo="/admin/settings#sicherheit" size="sm" variant="secondary" errorMessage={getMfaCopy(locale).messages.genericFailure}><KeyRound className="size-3.5" />{copy.confirmSso}</OidcStepUpButton>
              </div>
            ) : null}
          <form action={action} className="space-y-4">
            <input type="hidden" name="required" value="false" />
            <input type="hidden" name="expectedRevision" value={revision} />
            <label className="flex items-start justify-between gap-4 rounded-md border border-[#dce1e5] p-4">
              <span><span className="block text-sm font-bold text-[#354555]">{copy.required}</span><span className="mt-1 block text-xs leading-5 text-[#71808b]">{copy.requiredHelp}</span></span>
              <input name="required" value="true" type="checkbox" checked={required} onChange={(event) => setRequired(event.target.checked)} className="mt-1 size-5 shrink-0" />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              {passwordRequired ? <label><span className="mb-1.5 block text-xs font-semibold text-[#52606d]">{copy.ownerPassword}</span><input name="password" type="password" autoComplete="current-password" className={inputClass} required minLength={8} maxLength={200} /></label> : <div className="rounded-md bg-[#eef3f9] p-3 text-xs leading-5 text-[#365f8d]"><input type="hidden" name="password" value="" />{copy.freshSso}</div>}
              <label><span className="mb-1.5 block text-xs font-semibold text-[#52606d]">{copy.code}</span><input name="code" autoComplete="one-time-code" className={inputClass} required minLength={6} maxLength={32} /></label>
            </div>
            {state.message ? <p role={state.ok ? "status" : "alert"} className={`rounded-md p-3 text-xs ${state.ok ? "bg-[#e9f8f6] text-[#167e74]" : "bg-[#fdf0ee] text-[#a94339]"}`}>{localizeMfaMessage(locale, state.message)}</p> : null}
            <Button type="submit" disabled={pending}>{pending ? <LoaderCircle className="size-4 animate-spin" /> : <KeyRound className="size-4" />}{copy.save}</Button>
          </form>
          </div>
        ) : <p className="text-xs text-[#71808b]">{copy.ownerOnly}</p>}
      </div>
    </section>
  );
}
