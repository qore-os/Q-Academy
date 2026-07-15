import Link from "next/link";
import type { Metadata } from "next";
import { Building2 } from "lucide-react";
import { InvitationAcceptForm } from "@/components/auth/account-recovery-forms";
import { AuthPrivacyLink } from "@/components/auth/auth-privacy-link";
import { TenantFavicon } from "@/components/branding/tenant-favicon";
import { buttonClassName } from "@/components/ui/button";
import { Logo } from "@/components/ui/logo";
import { getInvitationAuthContext } from "@/lib/auth-tokens";
import { getTenantBranding } from "@/lib/branding";
import { brandingCssVariables } from "@/lib/branding-model";
import { getPublicLegalLinks } from "@/lib/server-environment";
import { getOrganizationDefaultLocale } from "@/lib/i18n/server";
import { getAuthPageCopy } from "@/lib/i18n/auth-pages";
import { getCoreDictionary } from "@/lib/i18n/dictionaries";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  const invitation = await getInvitationAuthContext(token);
  const locale = invitation?.locale ?? (await getOrganizationDefaultLocale(null));
  return { title: getAuthPageCopy(locale).invitationTitle };
}

export default async function InvitationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invitation = await getInvitationAuthContext(token);
  const branding = invitation
    ? await getTenantBranding(invitation.organizationId)
    : null;
  const legal = getPublicLegalLinks();
  const privacyUrl = branding?.privacyPolicyUrl ?? legal.privacyUrl;
  const locale = invitation?.locale ?? await getOrganizationDefaultLocale(null);
  const copy = getAuthPageCopy(locale);
  return (
    <main
      className="grid min-h-screen place-items-center bg-[#f4f6f7] px-5 py-10"
      lang={locale}
      style={branding ? brandingCssVariables(branding) : undefined}
    >
      {branding ? <TenantFavicon href={branding.faviconUrl} /> : null}
      <section className="w-full max-w-md rounded-md border border-[#dfe4e8] bg-white p-6 shadow-sm sm:p-8">
        <Logo
          href="/login"
          branding={branding ?? undefined}
          locale={locale}
        />
        <p className="mt-10 text-[10px] font-bold uppercase text-[var(--theme-teal-text)]">
          {copy.welcome}
        </p>
        <h1 className="mt-2 text-2xl font-bold text-[#17212b]">
          {copy.invitationTitle}
        </h1>
        {!invitation ? (
          <div className="mt-7 space-y-4">
            <p className="text-sm leading-6 text-[#66727f]">
              {copy.invalidInvitation}
            </p>
            <Link href="/login" className={buttonClassName({ className: "w-full" })}>
              {copy.backToLogin}
            </Link>
          </div>
        ) : (
          <div className="mt-7 space-y-5">
            {invitation.oidcEnabled ? (
              <a
                href="/api/v1/auth/oidc/start?return_to=%2Facademy"
                className={buttonClassName({ className: "w-full" })}
              >
                <Building2 className="size-4" />
                {copy.activateWith(invitation.oidcDisplayName)}
              </a>
            ) : null}
            {invitation.oidcEnabled && invitation.passwordLoginEnabled ? (
              <div className="flex items-center gap-3 text-[10px] font-bold uppercase text-[#8a949d]">
                <span className="h-px flex-1 bg-[#e5e9ec]" />
                {copy.orPassword}
                <span className="h-px flex-1 bg-[#e5e9ec]" />
              </div>
            ) : null}
            {invitation.passwordLoginEnabled ? (
              <InvitationAcceptForm token={token} locale={locale} />
            ) : null}
          </div>
        )}
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
