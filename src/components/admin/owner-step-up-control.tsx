"use client";

import { ShieldAlert } from "lucide-react";
import { OidcStepUpButton } from "@/components/auth/oidc-step-up-button";
import { cn } from "@/lib/utils";
import { getSettingsAdminCopy } from "@/lib/i18n/settings-admin";
import type { AppLocale } from "@/lib/i18n/model";

export type OwnerStepUpMode = "password" | "oidc";

export function OwnerStepUpControl({
  mode,
  returnTo,
  locale,
  passwordName = "password",
  passwordLabel,
  oidcDescription,
  oidcButtonLabel,
  oidcErrorMessage,
  className,
}: {
  mode: OwnerStepUpMode;
  returnTo: string;
  locale: AppLocale;
  passwordName?: string;
  passwordLabel?: string;
  oidcDescription?: string;
  oidcButtonLabel?: string;
  oidcErrorMessage?: string;
  className?: string;
}) {
  const copy = getSettingsAdminCopy(locale).stepUp;
  const resolvedPasswordLabel = passwordLabel ?? copy.password;
  const resolvedOidcDescription = oidcDescription ?? copy.oidcDescription;
  const resolvedOidcButtonLabel = oidcButtonLabel ?? copy.oidcButton;
  const resolvedOidcErrorMessage = oidcErrorMessage ?? copy.oidcError;
  if (mode === "password") {
    return (
      <label className={cn("block", className)}>
        <span className="mb-1.5 block text-xs font-semibold text-[#52606d]">
          {resolvedPasswordLabel}
        </span>
        <input
          name={passwordName}
          type="password"
          autoComplete="current-password"
          required
          minLength={8}
          maxLength={256}
          className="focus-ring h-10 w-full rounded-md border border-[#dce1e5] bg-white px-3 text-sm"
        />
      </label>
    );
  }

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-md border border-[#cfe0e8] bg-[#f3f8fa] p-3.5 sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
    >
      <p className="text-xs leading-5 text-[#526b78]">
        {resolvedOidcDescription}
      </p>
      <OidcStepUpButton
        returnTo={returnTo}
        variant="secondary"
        errorMessage={resolvedOidcErrorMessage}
      >
        <ShieldAlert className="size-4" />
        {resolvedOidcButtonLabel}
      </OidcStepUpButton>
    </div>
  );
}
