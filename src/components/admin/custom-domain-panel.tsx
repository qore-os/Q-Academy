"use client";

import { useActionState, useState } from "react";
import {
  Check,
  Clipboard,
  Globe2,
  LoaderCircle,
  RefreshCw,
  RotateCw,
  ShieldCheck,
  Trash2,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  createCustomDomainClaimAction,
  revokeCustomDomainClaimAction,
  rotateCustomDomainChallengeAction,
  verifyCustomDomainClaimAction,
  type CustomDomainActionState,
} from "@/lib/custom-domain-actions";
import { cn, PLATFORM_TIME_ZONE } from "@/lib/utils";
import { getSettingsAdminCopy, type SettingsAdminCopy } from "@/lib/i18n/settings-admin";
import { intlLocale, type AppLocale } from "@/lib/i18n/model";

export type CustomDomainClaimView = {
  id: string;
  hostname: string;
  status: string;
  expired: boolean;
  revision: number;
  recordName: string;
  challengeExpiresAt: string;
  lastCheckedAt: string | null;
  lastCheckCode: string | null;
  verifiedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

const initialState: CustomDomainActionState = { ok: null, message: "" };
const inputClass =
  "focus-ring h-10 w-full rounded-md border border-[#dce1e5] bg-white px-3 text-sm text-[#243444] placeholder:text-[var(--theme-muted-text)]";

function ActionFeedback({ state, copy }: { state: CustomDomainActionState; copy: SettingsAdminCopy }) {
  if (!state.code) return null;
  return (
    <p
      role="status"
      className={cn(
        "text-xs leading-5",
        state.ok ? "text-[#167e74]" : "text-[#b8493e]",
      )}
    >
      {copy.messages[state.code]}
    </p>
  );
}

function ChallengeOutput({
  challenge,
  copy,
  locale,
}: {
  challenge: NonNullable<CustomDomainActionState["challenge"]>;
  copy: SettingsAdminCopy;
  locale: AppLocale;
}) {
  const [copied, setCopied] = useState<"name" | "value" | null>(null);
  async function copyToClipboard(kind: "name" | "value", value: string) {
    await navigator.clipboard.writeText(value);
    setCopied(kind);
    window.setTimeout(() => setCopied(null), 1_500);
  }
  return (
    <div className="mt-3 border-l-2 border-[#2b9188] bg-[var(--theme-layer-background)] px-3 py-3">
      <p className="text-xs font-semibold text-[var(--theme-strong-text)]">
        {copy.domain.challengeTitle}
      </p>
      {[
        ["name", copy.domain.dnsName, challenge.recordName],
        ["value", copy.domain.txtValue, challenge.recordValue],
      ].map(([kind, label, value]) => (
        <div key={kind} className="mt-2 grid min-w-0 grid-cols-[1fr_auto] gap-2">
          <div className="min-w-0">
            <span className="block text-[10px] font-bold uppercase text-[var(--theme-muted-text)]">
              {label}
            </span>
            <code className="mt-0.5 block break-all text-[11px] text-[var(--theme-strong-text)]">
              {value}
            </code>
          </div>
          <button
            type="button"
            onClick={() => copyToClipboard(kind as "name" | "value", value)}
            className="focus-ring grid size-9 place-items-center self-end rounded-md text-[var(--theme-teal-text)] hover:bg-[var(--theme-input-background)]"
            title={`${label} ${copy.common.copy}`}
            aria-label={`${label} ${copy.common.copy}`}
          >
            {copied === kind ? (
              <Check className="size-4" />
            ) : (
              <Clipboard className="size-4" />
            )}
          </button>
        </div>
      ))}
      <p className="mt-2 text-[10px] text-[var(--theme-muted-text)]">
        {copy.domain.expires}: {new Intl.DateTimeFormat(intlLocale(locale), {
          dateStyle: "medium",
          timeStyle: "short",
          timeZone: PLATFORM_TIME_ZONE,
        }).format(new Date(challenge.expiresAt))}
      </p>
    </div>
  );
}

function ClaimRow({ claim, copy, locale }: { claim: CustomDomainClaimView; copy: SettingsAdminCopy; locale: AppLocale }) {
  const [rotateState, rotateAction, rotatePending] = useActionState(
    rotateCustomDomainChallengeAction.bind(null, claim.id),
    initialState,
  );
  const [verifyState, verifyAction, verifyPending] = useActionState(
    verifyCustomDomainClaimAction.bind(null, claim.id),
    initialState,
  );
  const [revokeState, revokeAction, revokePending] = useActionState(
    revokeCustomDomainClaimAction.bind(null, claim.id),
    initialState,
  );
  const tone = claim.status === "verified" ? "teal" : claim.status === "revoked" ? "coral" : "blue";
  const status = claim.status === "verified"
    ? copy.domain.statuses.verified
    : claim.status === "revoked"
      ? copy.domain.statuses.revoked
      : claim.expired
        ? copy.domain.statuses.expired
        : copy.domain.statuses.pending;
  const checkMessages: Record<string, string> = {
    no_match: copy.messages.domainNoMatch,
    dns_error: copy.messages.domainDnsError,
    timeout: copy.messages.domainTimeout,
    expired: copy.messages.domainExpired,
    verified: copy.messages.domainVerified,
  };
  const lastCheckCode = claim.lastCheckCode
    ? checkMessages[claim.lastCheckCode] ?? claim.lastCheckCode
    : null;
  const busy = verifyPending || rotatePending || revokePending;
  return (
    <div className="border-t border-[#e8ecef] px-4 py-4 sm:px-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="break-all text-sm font-bold text-[#243444]">{claim.hostname}</p>
            <Badge tone={tone}>{status}</Badge>
          </div>
          <p className="mt-1 break-all font-mono text-[10px] text-[var(--theme-muted-text)]">TXT {claim.recordName}</p>
          {claim.lastCheckedAt ? (
            <p className="mt-1 text-[10px] text-[var(--theme-muted-text)]">
              {copy.domain.lastCheck}: {lastCheckCode} {" · "}
              {new Intl.DateTimeFormat(intlLocale(locale), {
                dateStyle: "medium",
                timeStyle: "short",
                timeZone: PLATFORM_TIME_ZONE,
              }).format(new Date(claim.lastCheckedAt))}
            </p>
          ) : null}
          {claim.status === "verified" ? (
            <p className="mt-2 max-w-2xl text-[11px] leading-5 text-[var(--theme-muted-text)]">
              {copy.domain.verifiedHint}
            </p>
          ) : null}
        </div>
        {claim.status !== "revoked" ? (
          <div className="flex flex-wrap gap-2">
            {claim.status === "pending" ? (
              <>
                <form action={verifyAction}>
                  <input type="hidden" name="expectedRevision" value={claim.revision} />
                  <Button type="submit" size="sm" disabled={busy}>
                    {verifyPending ? <LoaderCircle className="size-3.5 animate-spin" /> : <ShieldCheck className="size-3.5" />}
                    {copy.domain.verify}
                  </Button>
                </form>
                <form action={rotateAction}>
                  <input type="hidden" name="expectedRevision" value={claim.revision} />
                  <Button type="submit" size="sm" variant="secondary" disabled={busy} title={copy.domain.rotateTitle}>
                    {rotatePending ? <LoaderCircle className="size-3.5 animate-spin" /> : <RotateCw className="size-3.5" />}
                    {copy.domain.rotate}
                  </Button>
                </form>
              </>
            ) : null}
            <form action={revokeAction}>
              <input type="hidden" name="expectedRevision" value={claim.revision} />
              <Button type="submit" size="sm" variant="secondary" disabled={busy} title={copy.domain.revokeTitle}>
                {revokePending ? <LoaderCircle className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                {copy.domain.revoke}
              </Button>
            </form>
          </div>
        ) : null}
      </div>
      <div className="mt-2 space-y-1">
        <ActionFeedback state={verifyState} copy={copy} />
        <ActionFeedback state={rotateState} copy={copy} />
        <ActionFeedback state={revokeState} copy={copy} />
      </div>
      {rotateState.challenge ? (
        <ChallengeOutput challenge={rotateState.challenge} copy={copy} locale={locale} />
      ) : null}
    </div>
  );
}

export function CustomDomainPanel({
  claims,
  locale,
}: {
  claims: CustomDomainClaimView[];
  locale: AppLocale;
}) {
  const copy = getSettingsAdminCopy(locale);
  const [createState, createAction, createPending] = useActionState(
    createCustomDomainClaimAction,
    initialState,
  );
  const hasActiveClaim = claims.some((claim) => claim.status !== "revoked");
  return (
    <section className="panel overflow-hidden" aria-labelledby="custom-domain-title">
      <header className="flex items-start gap-3 px-4 py-4 sm:px-5">
        <span className="grid size-9 shrink-0 place-items-center rounded-md bg-[#e9f8f6] text-[#167e74]">
          <Globe2 className="size-4" />
        </span>
        <div className="min-w-0">
          <h2 id="custom-domain-title" className="text-sm font-bold text-[#243444]">
            {copy.domain.title}
          </h2>
          <p className="mt-1 text-xs leading-5 text-[#6c7882]">
            {copy.domain.description}
          </p>
        </div>
      </header>

      {!hasActiveClaim ? (
        <form action={createAction} className="border-t border-[#e8ecef] bg-[var(--theme-layer-background)] px-4 py-4 sm:px-5">
          <div className="flex flex-col gap-2 sm:flex-row">
            <label className="min-w-0 flex-1">
              <span className="sr-only">{copy.domain.hostname}</span>
              <input name="hostname" required maxLength={253} autoCapitalize="none" autoComplete="off" placeholder={copy.domain.placeholder} className={inputClass} />
            </label>
            <Button type="submit" disabled={createPending}>
              {createPending ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
              {copy.domain.create}
            </Button>
          </div>
          <div className="mt-2"><ActionFeedback state={createState} copy={copy} /></div>
          {createState.challenge ? <ChallengeOutput challenge={createState.challenge} copy={copy} locale={locale} /> : null}
        </form>
      ) : null}

      {claims.map((claim) => <ClaimRow key={claim.id} claim={claim} copy={copy} locale={locale} />)}
    </section>
  );
}
