"use client";

import { Globe2, LoaderCircle, Save } from "lucide-react";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { getCoreDictionary } from "@/lib/i18n/dictionaries";
import { LOCALE_OPTIONS, type AppLocale } from "@/lib/i18n/model";
import {
  updateOrganizationDefaultLocaleAction,
  updateOwnLocaleAction,
  type LocaleActionState,
} from "@/lib/locale-actions";

const initialState: LocaleActionState = { ok: null };
const selectClassName =
  "focus-ring h-10 w-full rounded-md border border-[#dce1e5] bg-white px-3 text-sm text-[#243444]";

function ActionMessage({
  state,
  copy,
}: {
  state: LocaleActionState;
  copy: ReturnType<typeof getCoreDictionary>["language"];
}) {
  if (!state.code) return null;
  return (
    <p
      aria-live="polite"
      className={`rounded-md p-3 text-xs ${state.ok ? "bg-[#e9f8f6] text-[#167e74]" : "bg-[#fdf0ee] text-[#a94339]"}`}
    >
      {copy[state.code]}
    </p>
  );
}

export function ProfileLocaleSettings({
  locale,
  preferredLocale,
  defaultLocale,
}: {
  locale: AppLocale;
  preferredLocale: AppLocale | null;
  defaultLocale: AppLocale;
}) {
  const [state, action, pending] = useActionState(
    updateOwnLocaleAction,
    initialState,
  );
  const copy = getCoreDictionary(locale).language;
  return (
    <form action={action} className="panel overflow-hidden">
      <header className="flex items-center gap-3 border-b border-[#e8ebee] px-5 py-4">
        <span className="grid size-9 place-items-center rounded-md bg-[#eef3f9] text-[#365f8d]">
          <Globe2 className="size-4" />
        </span>
        <div>
          <h2 className="text-base font-bold text-[#243444]">{copy.profileLabel}</h2>
          <p className="mt-0.5 text-xs text-[#71808b]">{copy.profileHelp}</p>
        </div>
      </header>
      <div className="grid gap-4 p-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <label>
          <span className="mb-1.5 block text-xs font-semibold text-[#52606d]">
            {copy.profileLabel}
          </span>
          <select
            name="preferredLocale"
            defaultValue={preferredLocale ?? "inherit"}
            className={selectClassName}
          >
            <option value="inherit">{copy.inherit} ({defaultLocale.toUpperCase()})</option>
            {LOCALE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <Button type="submit" disabled={pending}>
          {pending ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}
          {pending ? copy.saving : copy.save}
        </Button>
        <div className="sm:col-span-2"><ActionMessage state={state} copy={copy} /></div>
      </div>
    </form>
  );
}

export function OrganizationLocaleSettings({
  defaultLocale,
}: {
  defaultLocale: AppLocale;
}) {
  const [state, action, pending] = useActionState(
    updateOrganizationDefaultLocaleAction,
    initialState,
  );
  const copy = getCoreDictionary(defaultLocale).language;
  return (
    <form id="sprache" action={action} className="panel scroll-mt-24 overflow-hidden">
      <header className="flex items-center gap-3 border-b border-[#e8ebee] px-5 py-4">
        <span className="grid size-9 place-items-center rounded-md bg-[#e9f8f6] text-[#167e74]">
          <Globe2 className="size-4" />
        </span>
        <div>
          <h2 className="text-base font-bold text-[#243444]">{copy.organizationTitle}</h2>
          <p className="mt-0.5 text-xs text-[#71808b]">{copy.organizationHelp}</p>
        </div>
      </header>
      <div className="grid gap-4 p-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <label>
          <span className="mb-1.5 block text-xs font-semibold text-[#52606d]">{copy.organizationLabel}</span>
          <select name="defaultLocale" defaultValue={defaultLocale} className={selectClassName}>
            {LOCALE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <Button type="submit" disabled={pending}>
          {pending ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}
          {pending ? copy.saving : copy.save}
        </Button>
        <div className="sm:col-span-2"><ActionMessage state={state} copy={copy} /></div>
      </div>
    </form>
  );
}
