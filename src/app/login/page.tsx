import Image from "next/image";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BookOpenCheck, BrainCircuit, ShieldCheck } from "lucide-react";
import { TenantFavicon } from "@/components/branding/tenant-favicon";
import { LoginForm } from "@/components/auth/login-form";
import { AuthPrivacyLink } from "@/components/auth/auth-privacy-link";
import { Logo } from "@/components/ui/logo";
import { getCurrentUser, hasBrowserSessionCookie } from "@/lib/auth";
import { resolveRequestBranding } from "@/lib/branding";
import { brandingCssVariables } from "@/lib/branding-model";
import { getPublicOidcLoginConfiguration } from "@/lib/oidc-configuration";
import { getPublicLegalLinks } from "@/lib/server-environment";
import { getCoreDictionary } from "@/lib/i18n/dictionaries";
import { getOrganizationDefaultLocale } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const branding = await resolveRequestBranding();
  const locale = await getOrganizationDefaultLocale(branding.organizationId);
  return {
    title: getCoreDictionary(locale).auth.signInAt(branding.platformName),
  };
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams?: Promise<{
    oidc_error?: string | string[];
    mfa_error?: string | string[];
    account?: string | string[];
  }>;
}) {
  const user = (await hasBrowserSessionCookie())
    ? await getCurrentUser()
    : null;
  if (user) redirect(user.role === "member" ? "/academy" : "/admin");
  const branding = await resolveRequestBranding();
  const locale = await getOrganizationDefaultLocale(branding.organizationId);
  const copy = getCoreDictionary(locale).auth;
  const oidc = await getPublicOidcLoginConfiguration(
    branding.organizationId,
  );
  const resolvedSearch = await searchParams;
  const accountCandidate = resolvedSearch?.account;
  const initialEmail =
    typeof accountCandidate === "string" &&
    accountCandidate.length <= 255 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(accountCandidate)
      ? accountCandidate
      : undefined;
  const errorCode = resolvedSearch?.oidc_error;
  const oidcError =
    typeof errorCode === "string" ? copy.oidcErrors[errorCode] : undefined;
  const mfaErrorCode = resolvedSearch?.mfa_error;
  const authenticationError =
    (typeof mfaErrorCode === "string"
      ? copy.mfaExpired
      : undefined) ?? oidcError;
  const legal = getPublicLegalLinks();

  return (
    <main
      className="grid min-h-screen bg-white lg:grid-cols-[minmax(420px,0.88fr)_1.12fr]"
      lang={locale}
      data-public-branding={branding.organizationSlug ?? "default"}
      style={brandingCssVariables(branding)}
    >
      <TenantFavicon href={branding.faviconUrl} />
      <section className="flex min-h-screen flex-col px-6 py-6 sm:px-10 lg:px-[clamp(3rem,6vw,6rem)] lg:py-8">
        <Logo href="/login" branding={branding} locale={locale} />
        <div className="my-auto w-full max-w-[430px] py-12">
          <p className="mb-2 text-[11px] font-bold uppercase text-[var(--brand-primary)]">
            {branding.loginEyebrow}
          </p>
          <h1 className="text-3xl font-bold leading-tight text-[#17212b] sm:text-4xl">
            {branding.loginTitle}
          </h1>
          <p className="mt-3 max-w-md text-sm leading-6 text-[#66727f]">
            {branding.loginDescription}
          </p>
          <div className="mt-8">
            <LoginForm
              platformName={branding.platformName}
              oidc={oidc}
              oidcError={authenticationError}
              locale={locale}
              initialEmail={initialEmail}
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-[#8a949d]">
          <span>{branding.platformName} | {copy.learningEnvironment}</span>
          {legal.imprintUrl ? <a className="hover:text-[#52606d] hover:underline" href={legal.imprintUrl}>{copy.imprint}</a> : null}
          <AuthPrivacyLink
            href={branding.privacyPolicyUrl ?? legal.privacyUrl}
            className="hover:text-[#52606d]"
            label={getCoreDictionary(locale).navigation.items.privacy}
          />
          {legal.supportEmail ? <a className="hover:text-[#52606d] hover:underline" href={`mailto:${legal.supportEmail}`}>{copy.support}</a> : null}
        </div>
      </section>

      <section
        className="relative hidden min-h-screen overflow-hidden lg:block"
        style={{ backgroundColor: branding.loginBackgroundColor }}
      >
        {branding.loginBackgroundUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- Tenant-managed login assets use validated HTTP(S) URLs.
          <img
            src={branding.loginBackgroundUrl}
            alt={branding.platformName}
            className="absolute inset-0 size-full object-cover opacity-55"
          />
        ) : (
          <Image
            src="/images/courses/workflows.webp"
            alt={copy.heroImageAlt}
            fill
            loading="eager"
            sizes="55vw"
            className="object-cover opacity-55"
          />
        )}
        <div className="absolute inset-0 bg-[#0f263c]/35" />
        <div className="absolute inset-x-0 bottom-0 bg-[#0f263c]/90 p-[clamp(2rem,5vw,5rem)] text-white">
          <p className="text-xs font-bold uppercase text-[var(--brand-accent)]">
            {copy.heroEyebrow}
          </p>
          <h2 className="mt-2 max-w-2xl text-3xl font-bold leading-tight">
            {copy.heroTitle}
          </h2>
          <div className="mt-7 grid max-w-2xl grid-cols-3 gap-6 border-t border-white/15 pt-6">
            <div>
              <BookOpenCheck className="size-5 text-[var(--brand-accent)]" />
              <p className="mt-3 text-sm font-semibold">{copy.heroCourses}</p>
              <p className="mt-1 text-xs leading-5 text-white/65">
                {copy.heroCoursesBody}
              </p>
            </div>
            <div>
              <BrainCircuit className="size-5 text-[#f39486]" />
              <p className="mt-3 text-sm font-semibold">Q-Coach</p>
              <p className="mt-1 text-xs leading-5 text-white/65">
                {copy.heroCoachBody}
              </p>
            </div>
            <div>
              <ShieldCheck className="size-5 text-[#e5c86d]" />
              <p className="mt-3 text-sm font-semibold">{copy.heroSecurity}</p>
              <p className="mt-1 text-xs leading-5 text-white/65">
                {copy.heroSecurityBody}
              </p>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
