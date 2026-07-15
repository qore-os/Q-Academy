"use client";

import { useActionState } from "react";
import { KeyRound } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  transferOrganizationOwnershipAdminAction,
  type OwnershipTransferState,
} from "@/lib/admin/member-actions";
import { getSettingsAdminCopy } from "@/lib/i18n/settings-admin";
import type { AppLocale } from "@/lib/i18n/model";

const initialState: OwnershipTransferState = { ok: null, message: "" };

export function OwnershipTransferForm({
  targetUserId,
  targetEmail,
  locale,
}: {
  targetUserId: string;
  targetEmail: string;
  locale: AppLocale;
}) {
  const [state, action, pending] = useActionState(
    transferOrganizationOwnershipAdminAction,
    initialState,
  );
  const copy = getSettingsAdminCopy(locale);
  const message = state.code
    ? state.code === "ownershipTransferred"
      ? copy.messages.ownershipTransferred(state.targetEmail ?? targetEmail)
      : copy.messages[state.code]
    : "";

  return (
    <section className="panel border-[#f1c7bd] p-5">
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-md bg-[#fff0ed] text-[#a84735]">
          <KeyRound className="size-4" />
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-[#243444]">{copy.ownership.title}</h2>
          <p className="mt-1 text-xs leading-5 text-[#66727f]">
            {copy.ownership.description}
          </p>
        </div>
      </div>

      <form action={action} className="mt-4 grid gap-3 sm:grid-cols-2">
        <input type="hidden" name="targetUserId" value={targetUserId} />
        <label className="grid gap-1 text-xs font-semibold text-[#43515e]">
          {copy.ownership.confirmEmail}
          <input
            className="focus-ring h-10 w-full rounded-md border border-[#dfe4e8] bg-white px-3 text-sm text-[#243444]"
            name="confirmationEmail"
            type="email"
            autoComplete="off"
            placeholder={targetEmail}
            required
          />
        </label>
        <label className="grid gap-1 text-xs font-semibold text-[#43515e]">
          {copy.ownership.password}
          <input
            className="focus-ring h-10 w-full rounded-md border border-[#dfe4e8] bg-white px-3 text-sm text-[#243444]"
            name="password"
            type="password"
            autoComplete="current-password"
          />
        </label>
        <div className="flex items-center gap-3 sm:col-span-2">
          <Button
            variant="danger"
            type="submit"
            disabled={pending}
          >
            <KeyRound className="size-4" />
            {pending ? copy.ownership.transferring : copy.ownership.submit}
          </Button>
          {state.code ? (
            <p
              className={`text-xs ${state.ok ? "text-[#267267]" : "text-[#a84735]"}`}
              role="status"
            >
              {message}
            </p>
          ) : null}
        </div>
      </form>
    </section>
  );
}
