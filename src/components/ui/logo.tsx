"use client";

import Link from "next/link";
import { useState } from "react";
import {
  DEFAULT_TENANT_BRANDING,
  type TenantBranding,
} from "@/lib/branding-model";
import { brandLogoSource } from "@/lib/branding-asset-policy";
import { getLogoCopy } from "@/lib/i18n/logo";
import type { AppLocale } from "@/lib/i18n/model";
import { cn } from "@/lib/utils";

export function Logo({
  href = "/",
  compact = false,
  className,
  branding = DEFAULT_TENANT_BRANDING,
  surface = "auto",
  locale,
}: {
  href?: string;
  compact?: boolean;
  className?: string;
  branding?: TenantBranding;
  surface?: "light" | "dark" | "auto";
  locale: AppLocale;
}) {
  const copy = getLogoCopy(locale);
  const [failedLogoUrl, setFailedLogoUrl] = useState<string | null>(null);
  const lightLogoSource = brandLogoSource(branding, "light");
  const darkLogoSource = brandLogoSource(branding, "dark");
  const logoSource =
    surface === "dark" ? darkLogoSource : lightLogoSource;
  const autoDarkLogoSource =
    surface === "auto" && darkLogoSource !== failedLogoUrl
      ? darkLogoSource
      : null;
  const showImage = Boolean(
    logoSource && logoSource !== failedLogoUrl,
  );

  return (
    <Link
      href={href}
      className={cn(
        "focus-ring inline-flex min-w-0 items-center gap-2.5 rounded-sm",
        className,
      )}
      aria-label={copy.home(branding.platformName)}
    >
      {showImage ? (
        <picture>
          {autoDarkLogoSource ? (
            <source
              media="(prefers-color-scheme: dark)"
              srcSet={autoDarkLogoSource}
            />
          ) : null}
          <img
            src={logoSource!}
            alt={copy.logoAlt(branding.platformName)}
            width={144}
            height={36}
            className="h-9 w-auto max-w-36 shrink-0 object-contain object-left"
            onError={(event) => {
              const current = event.currentTarget.currentSrc;
              setFailedLogoUrl(
                autoDarkLogoSource && current.endsWith(autoDarkLogoSource)
                  ? autoDarkLogoSource
                  : logoSource,
              );
            }}
          />
        </picture>
      ) : (
        <span className="brand-radius grid size-9 shrink-0 place-items-center bg-[var(--brand-primary)] text-lg font-black text-white">
          {branding.logoMark}
        </span>
      )}
      {!compact ? (
        <span className="min-w-0 leading-none">
          <span
            className={cn(
              "block max-w-44 truncate text-[15px] font-bold",
              surface === "dark"
                ? "text-white"
                : surface === "auto"
                  ? "theme-logo-title"
                  : "text-[var(--brand-primary)]",
            )}
          >
            {branding.platformName}
          </span>
          <span
            className={cn(
              "mt-1 block text-[9px] font-semibold uppercase",
              surface === "dark"
                ? "text-white/65"
                : surface === "auto"
                  ? "theme-logo-subtitle"
                  : "text-[#72808c]",
            )}
          >
            {copy.tagline}
          </span>
        </span>
      ) : null}
    </Link>
  );
}
