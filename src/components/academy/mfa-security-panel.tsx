"use client";

import { useActionState, useEffect, useState } from "react";
import QRCode from "qrcode";
import {
  Check,
  Clipboard,
  KeyRound,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  ShieldOff,
} from "lucide-react";
import { OidcStepUpButton } from "@/components/auth/oidc-step-up-button";
import { Button } from "@/components/ui/button";
import {
  beginOwnMfaEnrollmentAction,
  confirmOwnMfaEnrollmentAction,
  disableOwnMfaAction,
  regenerateOwnMfaRecoveryCodesAction,
  type MfaManagementActionState,
} from "@/lib/mfa/management-actions";
import { getMfaCopy, localizeMfaMessage } from "@/lib/i18n/mfa";
import type { AppLocale } from "@/lib/i18n/model";
import { formatDateTime } from "@/lib/utils";

const initialState: MfaManagementActionState = { ok: null, message: "" };
const inputClass = "focus-ring h-10 w-full rounded-md border border-[#dce1e5] bg-white px-3 text-sm text-[#243444]";

function Result({
  state,
  locale,
}: {
  state: MfaManagementActionState;
  locale: AppLocale;
}) {
  if (!state.message) return null;
  return (
    <p role={state.ok ? "status" : "alert"} className={`rounded-md p-3 text-xs ${state.ok ? "bg-[#e9f8f6] text-[#167e74]" : "bg-[#fdf0ee] text-[#a94339]"}`}>
      {localizeMfaMessage(locale, state.message)}
    </p>
  );
}

function RecoveryCodes({ codes, locale }: { codes: string[]; locale: AppLocale }) {
  const copy = getMfaCopy(locale).account;
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-3 rounded-md border border-[#bfe5df] bg-[#eefaf8] p-4">
      <p className="text-xs font-bold text-[#24443f]">{copy.recoveryVisibleOnce}</p>
      <div className="grid grid-cols-1 gap-2 font-mono text-xs text-[#243444] sm:grid-cols-2">
        {codes.map((code) => <code key={code}>{code}</code>)}
      </div>
      <Button type="button" size="sm" variant="secondary" onClick={async () => {
        await navigator.clipboard.writeText(codes.join("\n"));
        setCopied(true);
      }}>
        {copied ? <Check className="size-3.5" /> : <Clipboard className="size-3.5" />}
        {copied ? copy.copied : copy.copyCodes}
      </Button>
    </div>
  );
}

function SetupQr({
  uri,
  secret,
  locale,
}: {
  uri: string;
  secret: string;
  locale: AppLocale;
}) {
  const copy = getMfaCopy(locale).account;
  const [source, setSource] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void QRCode.toDataURL(uri, { width: 200, margin: 2, errorCorrectionLevel: "M", color: { dark: "#17212b", light: "#ffffff" } })
      .then((value) => { if (active) setSource(value); });
    return () => { active = false; };
  }, [uri]);
  return (
    <div className="grid gap-4 sm:grid-cols-[216px_minmax(0,1fr)] sm:items-center">
      <div className="grid size-[216px] place-items-center rounded-md border border-[#dce1e5] bg-white p-2">
        {source ? (
          // eslint-disable-next-line @next/next/no-img-element -- Locally generated, short-lived QR bitmap.
          <img src={source} alt={copy.qrAlt} className="size-[200px]" />
        ) : <LoaderCircle className="size-5 animate-spin text-[#71808b]" />}
      </div>
      <div>
        <p className="text-xs leading-5 text-[#66727f]">{copy.scanQr}</p>
        <code className="mt-3 block break-all rounded-md bg-[#f1f4f6] p-3 text-xs font-semibold text-[#243444]">{secret}</code>
      </div>
    </div>
  );
}

function PrimaryFactorField({
  passwordRequired,
  label,
  locale,
}: {
  passwordRequired: boolean;
  label?: string;
  locale: AppLocale;
}) {
  const copy = getMfaCopy(locale).account;
  if (!passwordRequired) {
    return (
      <div className="rounded-md bg-[#eef3f9] p-3 text-xs leading-5 text-[#365f8d]">
        <input type="hidden" name="password" value="" />
        {copy.freshSso}
      </div>
    );
  }
  return (
    <label>
      <span className="mb-1.5 block text-xs font-semibold text-[#52606d]">{label ?? copy.currentPassword}</span>
      <input name="password" type="password" autoComplete="current-password" className={inputClass} required minLength={8} maxLength={200} />
    </label>
  );
}

export function MfaSecurityPanel({
  state,
  passwordRequired,
  locale,
}: {
  state: {
    status: "disabled" | "pending" | "enabled";
    enabledAt: Date | null;
    recoveryCodesRemaining: number;
    requiredByPolicy: boolean;
  };
  passwordRequired: boolean;
  locale: AppLocale;
}) {
  const copy = getMfaCopy(locale).account;
  const [beginState, beginAction, beginPending] = useActionState(beginOwnMfaEnrollmentAction, initialState);
  const [confirmState, confirmAction, confirmPending] = useActionState(confirmOwnMfaEnrollmentAction, initialState);
  const [regenerateState, regenerateAction, regeneratePending] = useActionState(regenerateOwnMfaRecoveryCodesAction, initialState);
  const [disableState, disableAction, disablePending] = useActionState(disableOwnMfaAction, initialState);
  const setupVisible = Boolean(beginState.ok && beginState.otpAuthUri && beginState.secret);
  const disabledInThisView = Boolean(disableState.ok);
  const active =
    !disabledInThisView &&
    (state.status === "enabled" || Boolean(confirmState.ok));
  const confirmedRecoveryCodes =
    disabledInThisView || regenerateState.recoveryCodes
    ? undefined
    : confirmState.recoveryCodes;
  const recoveryCodesRemaining =
    regenerateState.recoveryCodes?.length ??
    confirmedRecoveryCodes?.length ??
    state.recoveryCodesRemaining;

  return (
    <section className="panel overflow-hidden" id="mfa">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[#e8ebee] px-5 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className={`grid size-9 place-items-center rounded-md ${active ? "bg-[#e9f8f6] text-[#167e74]" : "bg-[#f1f4f6] text-[#52606d]"}`}>
            <ShieldCheck className="size-4" />
          </span>
          <div>
            <h2 className="text-base font-bold text-[#243444]">{copy.title}</h2>
            <p className="mt-0.5 text-xs text-[#71808b]">{copy.description}</p>
          </div>
        </div>
        <span className={`rounded px-2 py-1 text-[9px] font-bold uppercase ${active ? "bg-[#e9f8f6] text-[#167e74]" : "bg-[#f1f4f6] text-[#71808b]"}`}>
          {active ? copy.active : state.requiredByPolicy ? copy.required : copy.inactive}
        </span>
      </header>

      {!passwordRequired ? (
        <div className="border-b border-[#edf0f2] bg-[#f8fafb] px-5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-[#52606d]">{copy.recentSsoRequired}</p>
            <OidcStepUpButton returnTo="/academy/profile#mfa" size="sm" variant="secondary" errorMessage={getMfaCopy(locale).messages.genericFailure}><KeyRound className="size-3.5" />{copy.confirmSso}</OidcStepUpButton>
          </div>
        </div>
      ) : null}

      {!active ? (
        <div className="space-y-5 p-5">
          {disableState.ok ? <Result state={disableState} locale={locale} /> : null}
          {state.requiredByPolicy ? <p className="rounded-md border border-[#e8d8a7] bg-[#fff9e8] p-3 text-xs text-[#786124]">{copy.policyRequired}</p> : null}
          {!setupVisible ? (
            <form action={beginAction} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
              <PrimaryFactorField passwordRequired={passwordRequired} locale={locale} />
              <Button type="submit" disabled={beginPending}>
                {beginPending ? <LoaderCircle className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
                {copy.startSetup}
              </Button>
            </form>
          ) : (
            <div className="space-y-5">
              <SetupQr uri={beginState.otpAuthUri!} secret={beginState.secret!} locale={locale} />
              <form action={confirmAction} className="grid gap-3 sm:grid-cols-2">
                <PrimaryFactorField passwordRequired={passwordRequired} locale={locale} />
                <label>
                  <span className="mb-1.5 block text-xs font-semibold text-[#52606d]">{copy.sixDigitCode}</span>
                  <input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" className={inputClass} required />
                </label>
                <Button type="submit" className="sm:col-span-2" disabled={confirmPending}>
                  {confirmPending ? <LoaderCircle className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
                  {copy.enable}
                </Button>
              </form>
            </div>
          )}
          <Result state={beginState} locale={locale} />
          <Result state={confirmState} locale={locale} />
          {confirmedRecoveryCodes ? <RecoveryCodes codes={confirmedRecoveryCodes} locale={locale} /> : null}
        </div>
      ) : (
        <div className="divide-y divide-[#edf0f2]">
          {confirmedRecoveryCodes ? <div className="p-5"><RecoveryCodes codes={confirmedRecoveryCodes} locale={locale} /></div> : null}
          <div className="grid gap-3 px-5 py-4 text-xs text-[#52606d] sm:grid-cols-2">
            <p><span className="block font-semibold text-[#354555]">{copy.activeSince}</span>{state.enabledAt ? formatDateTime(state.enabledAt, locale) : copy.justEnabled}</p>
            <p><span className="block font-semibold text-[#354555]">{copy.recoveryCodes}</span>{copy.remainingCodes(recoveryCodesRemaining)}</p>
          </div>
          <div className="space-y-4 p-5">
            <div className="flex items-center gap-2 text-sm font-bold text-[#243444]"><RefreshCw className="size-4 text-[#365f8d]" />{copy.renewCodes}</div>
            <form action={regenerateAction} className="grid gap-3 sm:grid-cols-2">
              <PrimaryFactorField passwordRequired={passwordRequired} label={copy.passwordForCodes} locale={locale} />
              <input aria-label={copy.codeForCodes} name="code" autoComplete="one-time-code" placeholder={copy.codePlaceholder} className={inputClass} required minLength={6} maxLength={32} />
              <Button type="submit" variant="secondary" className="sm:col-span-2" disabled={regeneratePending}>
                {regeneratePending ? <LoaderCircle className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}{copy.createCodes}
              </Button>
            </form>
            <Result state={regenerateState} locale={locale} />
            {regenerateState.recoveryCodes ? <RecoveryCodes codes={regenerateState.recoveryCodes} locale={locale} /> : null}
          </div>
          <div className="space-y-4 p-5">
            <div className="flex items-center gap-2 text-sm font-bold text-[#8e3f38]"><ShieldOff className="size-4" />{copy.disable}</div>
            <form action={disableAction} className="grid gap-3 sm:grid-cols-2">
              <PrimaryFactorField passwordRequired={passwordRequired} label={copy.passwordToDisable} locale={locale} />
              <input aria-label={copy.codeToDisable} name="code" autoComplete="one-time-code" placeholder={copy.codePlaceholder} className={inputClass} required minLength={6} maxLength={32} />
              <Button type="submit" variant="danger" className="sm:col-span-2" disabled={disablePending || state.requiredByPolicy}>
                {disablePending ? <LoaderCircle className="size-4 animate-spin" /> : <ShieldOff className="size-4" />}{copy.disable}
              </Button>
            </form>
            <Result state={disableState} locale={locale} />
          </div>
        </div>
      )}
    </section>
  );
}
