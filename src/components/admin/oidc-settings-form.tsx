"use client";

import {
  Building2,
  KeyRound,
  Link2,
  LoaderCircle,
  Save,
  ShieldCheck,
} from "lucide-react";
import { type FormEvent, useState, useTransition } from "react";
import { OidcStepUpButton } from "@/components/auth/oidc-step-up-button";
import { OwnerStepUpControl } from "@/components/admin/owner-step-up-control";
import { Button } from "@/components/ui/button";
import {
  updateOidcSettingsAction,
  type OidcSettingsActionState,
} from "@/lib/oidc-actions";
import type { OidcConfigurationView } from "@/lib/oidc-model";
import type { AppLocale } from "@/lib/i18n/model";
import {
  getSystemExperienceCopy,
  resolveOidcSettingsMessage,
} from "@/lib/i18n/system-experience";
import { getMfaCopy } from "@/lib/i18n/mfa";
import { useHydrated } from "@/lib/use-hydrated";

const initialState: OidcSettingsActionState = {};
const inputClassName =
  "focus-ring brand-radius h-10 w-full border border-[#dce1e5] bg-white px-3 text-sm text-[#243444] placeholder:text-[var(--theme-muted-text)] disabled:bg-[#f4f6f7] disabled:text-[#7b8791]";

function Toggle({
  name,
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  name: string;
  label: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-3 border-t border-[#edf0f2] py-4 first:border-t-0">
      <input
        type="checkbox"
        name={name}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="focus-ring mt-0.5 size-4 accent-[var(--brand-accent)]"
      />
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-[#243444]">{label}</span>
        <span className="mt-0.5 block text-xs leading-5 text-[#71808b]">{description}</span>
      </span>
    </label>
  );
}

export function OidcSettingsForm({
  defaults,
  callbackUrl,
  canManage,
  mfaStepUpRequired,
  locale,
}: {
  defaults: OidcConfigurationView;
  callbackUrl: string;
  canManage: boolean;
  mfaStepUpRequired: boolean;
  locale: AppLocale;
}) {
  const copy = getSystemExperienceCopy(locale).oidc;
  const mfaCopy = getMfaCopy(locale);
  const hydrated = useHydrated();
  const [enabled, setEnabled] = useState(defaults.enabled);
  const [displayName, setDisplayName] = useState(defaults.displayName);
  const [clientId, setClientId] = useState(defaults.clientId ?? "");
  const [issuer, setIssuer] = useState(defaults.issuer ?? "");
  const [clientSecret, setClientSecret] = useState("");
  const [clearClientSecret, setClearClientSecret] = useState(false);
  const [allowedEmailDomains, setAllowedEmailDomains] = useState(
    defaults.allowedEmailDomains.join("\n"),
  );
  const [autoProvisionMembers, setAutoProvisionMembers] = useState(
    defaults.autoProvisionMembers,
  );
  const [passwordLoginEnabled, setPasswordLoginEnabled] = useState(
    defaults.passwordLoginEnabled,
  );
  const [savedPasswordLoginEnabled, setSavedPasswordLoginEnabled] = useState(
    defaults.passwordLoginEnabled,
  );
  const [state, setState] = useState<OidcSettingsActionState>(initialState);
  const [pending, startTransition] = useTransition();
  function submitSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await updateOidcSettingsAction(state, formData);
      setState(result);
      if (result.success) {
        setClientSecret("");
        setClearClientSecret(false);
        setSavedPasswordLoginEnabled(
          formData.get("passwordLoginEnabled") === "on",
        );
      }
    });
  }
  const displayedVersion = state.version ?? defaults.version;
  const savedConnectionEnabled = state.success ? enabled : defaults.enabled;

  return (
    <>
      <form
        id="sso"
        onSubmit={submitSettings}
        className="panel scroll-mt-24 overflow-hidden"
      >
      <input type="hidden" name="version" value={displayedVersion} />
      <fieldset
        disabled={!canManage || !hydrated}
        className="min-w-0 border-0 p-0"
      >
      <header className="flex flex-col gap-4 border-b border-[#edf0f2] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Building2 className="size-4 text-[var(--brand-accent)]" />
            <h2 className="text-base font-bold text-[#243444]">{copy.title}</h2>
          </div>
          <p className="mt-1 text-xs leading-5 text-[#6c7882]">
            {copy.description}
          </p>
        </div>
        <label className="flex shrink-0 items-center gap-2 text-xs font-semibold text-[#52606d]">
          <input
            type="checkbox"
            name="enabled"
            checked={enabled}
            disabled={!canManage}
            onChange={(event) => setEnabled(event.target.checked)}
            className="focus-ring size-4 accent-[var(--brand-accent)]"
          />
          {copy.active}
        </label>
      </header>

      <div className="space-y-5 p-5">
        {!canManage ? (
          <div className="flex items-center gap-2 rounded-md border border-[#dfe4e8] bg-[#f5f7f8] px-3 py-2.5 text-xs text-[#52606d]">
            <ShieldCheck className="size-4 shrink-0" />
            {copy.ownerOnly}
          </div>
        ) : null}
        <div className="grid gap-4 md:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-[#52606d]">{copy.displayName}</span>
            <input
              name="displayName"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              minLength={2}
              maxLength={80}
              required
              disabled={!canManage}
              className={inputClassName}
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-[#52606d]">{copy.clientId}</span>
            <input
              name="clientId"
              value={clientId}
              onChange={(event) => setClientId(event.target.value)}
              maxLength={512}
              disabled={!canManage}
              className={inputClassName}
              autoComplete="off"
            />
          </label>
        </div>
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-[#52606d]">{copy.issuerUrl}</span>
          <input
            name="issuer"
            type="url"
            value={issuer}
            onChange={(event) => setIssuer(event.target.value)}
            maxLength={2000}
            placeholder="https://identity.example.com/tenant"
            disabled={!canManage}
            className={inputClassName}
          />
        </label>
        <label className="block">
          <span className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-[#52606d]">
            <KeyRound className="size-3.5" /> {copy.clientSecret}
          </span>
          <input
            name="clientSecret"
            type="password"
            value={clientSecret}
            onChange={(event) => setClientSecret(event.target.value)}
            minLength={8}
            maxLength={4096}
            placeholder={defaults.clientSecretConfigured ? copy.unchangedSecret : copy.clientSecret}
            disabled={!canManage}
            className={inputClassName}
            autoComplete="new-password"
          />
        </label>
        {defaults.clientSecretConfigured && canManage ? (
          <label className="flex items-center gap-2 text-xs text-[#52606d]">
            <input
              name="clearClientSecret"
              type="checkbox"
              checked={clearClientSecret}
              onChange={(event) => setClearClientSecret(event.target.checked)}
              className="focus-ring size-4 accent-[#d85d50]"
            />
            {copy.removeSecret}
          </label>
        ) : null}
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-[#52606d]">{copy.allowedDomains}</span>
          <textarea
            name="allowedEmailDomains"
            value={allowedEmailDomains}
            onChange={(event) => setAllowedEmailDomains(event.target.value)}
            rows={4}
            maxLength={12000}
            placeholder={"example.com\ntochter.example.com"}
            disabled={!canManage}
            className="focus-ring brand-radius min-h-28 w-full resize-y border border-[#dce1e5] bg-white p-3 font-mono text-sm leading-6 text-[#243444] placeholder:text-[var(--theme-muted-text)] disabled:bg-[#f4f6f7]"
          />
        </label>
        <div className="border-y border-[#edf0f2]">
          <Toggle
            name="autoProvisionMembers"
            label={copy.autoProvision}
            description={copy.autoProvisionDescription}
            checked={autoProvisionMembers}
            disabled={!canManage}
            onChange={setAutoProvisionMembers}
          />
          <Toggle
            name="passwordLoginEnabled"
            label={copy.passwordLogin}
            description={copy.passwordLoginDescription}
            checked={passwordLoginEnabled}
            disabled={!canManage}
            onChange={setPasswordLoginEnabled}
          />
        </div>
        <div className="rounded-md border border-[#dfe4e8] bg-[#f8fafb] px-3 py-2.5">
          <p className="text-[10px] font-bold uppercase text-[#71808b]">{copy.redirectUri}</p>
          <code className="mt-1 block break-all text-xs text-[#354555]">{callbackUrl}</code>
        </div>
        {canManage ? (
          <OwnerStepUpControl
            mode={savedPasswordLoginEnabled ? "password" : "oidc"}
            returnTo="/admin/settings#sso"
            locale={locale}
            passwordName="currentPassword"
          />
        ) : null}
        {canManage && mfaStepUpRequired ? (
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-[#52606d]">
              {mfaCopy.policy.code}
            </span>
            <input
              name="mfaCode"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              minLength={6}
              maxLength={64}
              className={inputClassName}
            />
          </label>
        ) : null}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div aria-live="polite" className="min-h-5 text-xs">
            {state.error ? (
              <span role="alert" className="text-[#a94339]">
                {resolveOidcSettingsMessage(locale, state.messageCode)}
              </span>
            ) : state.success ? (
              <span className="text-[#167e74]">
                {resolveOidcSettingsMessage(locale, state.messageCode)}
              </span>
            ) : (
              <span className="text-[#7b8791]">
                {defaults.enabled ? copy.connectionActive : copy.connectionInactive}
              </span>
            )}
          </div>
          {canManage ? (
            <Button type="submit" disabled={pending}>
              {pending ? <LoaderCircle className="size-4 animate-spin" /> : <Save className="size-4" />}
              {pending ? copy.checking : copy.checkAndSave}
            </Button>
          ) : null}
        </div>
      </div>
      </fieldset>
      </form>
      {savedConnectionEnabled ? (
        <div className="flex justify-end">
          <OidcStepUpButton
            returnTo="/admin/settings"
            variant="secondary"
            errorMessage={copy.stepUpFailed}
          >
            <Link2 className="size-4" />
            {copy.linkAccount}
          </OidcStepUpButton>
        </div>
      ) : null}
    </>
  );
}
