"use client";

import { useActionState } from "react";
import { Ban, LoaderCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  reissueCertificateAction,
  revokeCertificateAction,
  type CertificateActionState,
} from "@/lib/certificate-actions";
import type { AppLocale } from "@/lib/i18n/model";
import {
  getCertificateCopy,
  resolveCertificateMessage,
} from "@/lib/i18n/certificates";

const initialState: CertificateActionState = { ok: null, message: "" };

export function CertificateAdminActions({
  certificateId,
  revoked,
  locale,
}: {
  certificateId: string;
  revoked: boolean;
  locale: AppLocale;
}) {
  const copy = getCertificateCopy(locale).actions;
  const revoke = revokeCertificateAction.bind(null, certificateId);
  const reissue = reissueCertificateAction.bind(null, certificateId);
  const [revokeState, revokeAction, revokePending] = useActionState(
    revoke,
    initialState,
  );
  const [reissueState, reissueAction, reissuePending] = useActionState(
    reissue,
    initialState,
  );
  const messageState = reissueState.message ? reissueState : revokeState;

  if (revoked) {
    return (
      <form action={reissueAction} className="space-y-2">
        <Button type="submit" size="sm" variant="secondary" disabled={reissuePending}>
          {reissuePending ? (
            <LoaderCircle className="size-3.5 animate-spin" />
          ) : (
            <RefreshCw className="size-3.5" />
          )}
          {copy.reissue}
        </Button>
        {messageState.message ? (
          <p
            role="status"
            className={`max-w-64 text-[10px] leading-4 ${messageState.ok ? "text-[#167e74]" : "text-[#b8493e]"}`}
          >
            {resolveCertificateMessage(locale, messageState.messageCode)}
          </p>
        ) : null}
      </form>
    );
  }

  return (
    <details className="group max-w-72">
      <summary className="focus-ring inline-flex h-8 cursor-pointer list-none items-center gap-2 rounded-md border border-[#efc7c2] bg-white px-3 text-xs font-semibold text-[#b8493e] hover:bg-[#fff5f3]">
        <Ban className="size-3.5" />
        {copy.revoke}
      </summary>
      <form action={revokeAction} className="mt-2 space-y-2 rounded-md border border-[#eadfdd] bg-[#fffafa] p-3">
        <label className="block text-[10px] font-semibold text-[#6b5552]">
          {copy.reason}
          <textarea
            name="reason"
            maxLength={500}
            placeholder={copy.optional}
            className="focus-ring mt-1 min-h-16 w-full resize-y rounded-md border border-[#dfd2d0] bg-white p-2 text-xs text-[#243444]"
          />
        </label>
        <Button type="submit" size="sm" variant="danger" disabled={revokePending}>
          {revokePending ? <LoaderCircle className="size-3.5 animate-spin" /> : <Ban className="size-3.5" />}
          {copy.confirmRevoke}
        </Button>
        {messageState.message ? (
          <p
            role="status"
            className={`text-[10px] leading-4 ${messageState.ok ? "text-[#167e74]" : "text-[#b8493e]"}`}
          >
            {resolveCertificateMessage(locale, messageState.messageCode)}
          </p>
        ) : null}
      </form>
    </details>
  );
}
