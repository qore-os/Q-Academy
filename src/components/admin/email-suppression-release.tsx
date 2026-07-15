"use client";

import { useActionState } from "react";
import { Unlock } from "lucide-react";
import {
  releaseEmailSuppressionAction,
  type EmailSuppressionActionState,
} from "@/lib/admin/email-suppression-actions";
import type { EmailSuppressionCopy } from "@/lib/email-suppression-copy";

const initialState: EmailSuppressionActionState = { ok: false };

export function EmailSuppressionRelease({
  id,
  copy,
}: {
  id: string;
  copy: EmailSuppressionCopy;
}) {
  const [state, action, pending] = useActionState(
    releaseEmailSuppressionAction,
    initialState,
  );
  return (
    <form action={action} className="flex min-w-52 flex-col gap-2">
      <input type="hidden" name="id" value={id} />
      <label className="sr-only" htmlFor={`release-reason-${id}`}>
        {copy.releaseReason}
      </label>
      <select
        id={`release-reason-${id}`}
        name="reason"
        defaultValue="address_corrected"
        className="focus-ring h-9 rounded border border-[#dfe4e8] bg-white px-2 text-xs text-[#354555]"
      >
        <option value="address_corrected">{copy.addressCorrected}</option>
        <option value="provider_error">{copy.providerError}</option>
        <option value="member_request">{copy.memberRequest}</option>
        <option value="other_verified">{copy.otherVerified}</option>
      </select>
      <button
        type="submit"
        disabled={pending}
        title={copy.release}
        className="focus-ring inline-flex h-9 items-center justify-center gap-2 rounded bg-[var(--brand-primary)] px-3 text-xs font-semibold text-white disabled:opacity-50"
      >
        <Unlock className="size-3.5" />
        {copy.release}
      </button>
      {state.code ? (
        <p
          role="status"
          className={state.ok ? "text-xs text-emerald-700" : "text-xs text-red-700"}
        >
          {state.code === "released"
            ? copy.releasedSuccess
            : state.code === "invalid"
              ? copy.invalidRelease
              : copy.releaseError}
        </p>
      ) : null}
    </form>
  );
}
