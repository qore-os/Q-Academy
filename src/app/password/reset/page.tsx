import Link from "next/link";
import type { Metadata } from "next";
import { PasswordResetForm } from "@/components/auth/account-recovery-forms";
import { AuthPrivacyLink } from "@/components/auth/auth-privacy-link";
import { TenantFavicon } from "@/components/branding/tenant-favicon";
import { Logo } from "@/components/ui/logo";
import { resolveRequestBranding } from "@/lib/branding";
import { brandingCssVariables } from "@/lib/branding-model";
import { getPublicLegalLinks } from "@/lib/server-environment";
import { getOrganizationDefaultLocale } from "@/lib/i18n/server";
import { getAuthPageCopy } from "@/lib/i18n/auth-pages";
import { getCoreDictionary } from "@/lib/i18n/dictionaries";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const branding = await resolveRequestBranding();
  const locale = await getOrganizationDefaultLocale(branding.organizationId);
  return { title: getAuthPageCopy(locale).resetTitle };
}

export default async function PasswordResetPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const [{ token }, branding] = await Promise.all([
    searchParams,
    resolveRequestBranding(),
  ]);
  const legal = getPublicLegalLinks();
  const locale = await getOrganizationDefaultLocale(branding.organizationId);
  const copy = getAuthPageCopy(locale);
  const privacyUrl = branding.privacyPolicyUrl ?? legal.privacyUrl;
  return (
    <main
      className="grid min-h-screen place-items-center bg-[#f4f6f7] px-5 py-10"
      lang={locale}
      style={brandingCssVariables(branding)}
    >
      <TenantFavicon href={branding.faviconUrl} />
      <section className="w-full max-w-md rounded-md border border-[#dfe4e8] bg-white p-6 shadow-sm sm:p-8">
        <Logo href="/login" branding={branding} locale={locale} />
        <p className="mt-10 text-[10px] font-bold uppercase text-[var(--theme-teal-text)]">
          {copy.security}
        </p>
        <h1 className="mt-2 text-2xl font-bold text-[#17212b]">
          {copy.resetTitle}
        </h1>
        <p className="mt-2 text-sm leading-6 text-[#66727f]">
          {copy.resetDescription}
        </p>
        <div className="mt-7">
          {token ? (
            <PasswordResetForm token={token} locale={locale} />
          ) : (
            <div className="space-y-4">
              <p className="rounded-md border border-[#f4c8c2] bg-[#fdf0ee] p-4 text-sm text-[#a94339]">
                {copy.missingToken}
              </p>
              <Link
                href="/password/forgot"
                className="focus-ring block rounded-md py-2 text-center text-xs font-semibold text-[#365f8d]"
              >
                {copy.requestNewLink}
              </Link>
            </div>
          )}
        </div>
        {privacyUrl ? (
          <div className="mt-6 border-t border-[#edf0f2] pt-4 text-center text-[11px] text-[#7b8791]">
            <AuthPrivacyLink
              href={privacyUrl}
              className="hover:text-[#52606d]"
              label={getCoreDictionary(locale).navigation.items.privacy}
            />
          </div>
        ) : null}
      </section>
    </main>
  );
}
