"use client";

import { LayoutDashboard, LoaderCircle, MessageCircleMore, Save, Smartphone } from "lucide-react";
import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  updateNativeStartDestinationAction,
  type NativeStartDestinationActionState,
} from "@/lib/mobile/start-destination-actions";
import type { NativeStartDestination } from "@/lib/mobile/start-destination-model";
import { getSettingsAdminCopy } from "@/lib/i18n/settings-admin";
import type { AppLocale } from "@/lib/i18n/model";
import { useHydrated } from "@/lib/use-hydrated";

const initialState: NativeStartDestinationActionState = {
  ok: null,
  message: "",
};

export function NativeStartSettings({
  destination,
  locale,
}: {
  destination: NativeStartDestination;
  locale: AppLocale;
}) {
  const copy = getSettingsAdminCopy(locale);
  const hydrated = useHydrated();
  const [selected, setSelected] = useState(destination);
  const [saved, setSaved] = useState(destination);
  const [state, action, pending] = useActionState(
    async (previous: NativeStartDestinationActionState, formData: FormData) => {
      const result = await updateNativeStartDestinationAction(previous, formData);
      if (result.ok) setSaved(selected);
      return result;
    },
    initialState,
  );
  const message = state.code ? copy.messages[state.code] : "";
  return (
    <form id="app-start" action={action} className="panel scroll-mt-24 overflow-hidden">
      <header className="flex items-center gap-3 border-b border-[#e8ebee] px-5 py-4">
        <span className="grid size-9 place-items-center rounded-md bg-[#eef3f9] text-[#365f8d]">
          <Smartphone className="size-4" />
        </span>
        <div>
          <h2 className="text-base font-bold text-[#243444]">{copy.nativeStart.title}</h2>
          <p className="mt-0.5 text-xs text-[#71808b]">{copy.nativeStart.description}</p>
        </div>
      </header>
      <div className="space-y-4 p-5">
        <fieldset>
          <legend className="mb-2 text-xs font-semibold text-[#52606d]">{copy.nativeStart.legend}</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {[
              { value: "dashboard" as const, label: copy.nativeStart.dashboard, icon: LayoutDashboard },
              { value: "community" as const, label: copy.nativeStart.community, icon: MessageCircleMore },
            ].map((option) => {
              const Icon = option.icon;
              return (
                <label key={option.value} className="focus-within:focus-ring flex min-h-12 cursor-pointer items-center gap-3 rounded-md border border-[#dce1e5] px-3 text-sm font-semibold text-[#354555] has-[:checked]:border-[var(--brand-accent)] has-[:checked]:bg-[#eef9f7] has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60">
                  <input
                    type="radio"
                    name="destination"
                    value={option.value}
                    checked={selected === option.value}
                    onChange={() => setSelected(option.value)}
                    disabled={!hydrated || pending}
                    className="size-4 accent-[var(--brand-accent)]"
                  />
                  <Icon className="size-4 text-[#52606d]" />
                  {option.label}
                </label>
              );
            })}
          </div>
        </fieldset>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p aria-live="polite" className={`min-h-5 text-xs ${state.ok === false ? "text-[#a94339]" : "text-[#167e74]"}`}>
            {message}
          </p>
          <Button type="submit" disabled={!hydrated || pending || selected === saved}>
            {pending ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}
            {pending ? copy.common.saving : copy.nativeStart.save}
          </Button>
        </div>
      </div>
    </form>
  );
}
