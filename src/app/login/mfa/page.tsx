import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { MfaLoginForm } from "@/components/auth/mfa-login-form";
import { AuthPrivacyLink } from "@/components/auth/auth-privacy-link";
import { Logo } from "@/components/ui/logo";
import { getCurrentUser } from "@/lib/auth";
import { getTenantBranding } from "@/lib/branding";
import { brandingCssVariables } from "@/lib/branding-model";
import {
  getMfaLoginChallengeView,
  MfaLoginChallengeError,
} from "@/lib/mfa/login-challenge";
import { getPublicLegalLinks } from "@/lib/server-environment";
import { getCoreDictionary } from "@/lib/i18n/dictionaries";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  try {
    const challenge = await getMfaLoginChallengeView();
    const copy = getCoreDictionary(challenge.locale).mfa;
    return {
      title: challenge.mode === "enroll" ? copy.enrollTitle : copy.verifyTitle,
    };
  } catch (error) {
    if (error instanceof MfaLoginChallengeError) {
      return { title: getCoreDictionary("de").mfa.verifyTitle };
    }
    throw error;
  }
}

export default async function MfaLoginPage() {
  let challenge;
  try {
    challenge = await getMfaLoginChallengeView();
  } catch (error) {
    if (error instanceof MfaLoginChallengeError) {
      const current = await getCurrentUser();
      if (current) redirect(current.role === "member" ? "/academy" : "/admin");
      redirect("/login?mfa_error=expired");
    }
    throw error;
  }
  const branding = await getTenantBranding(challenge.organizationId);
  const copy = getCoreDictionary(challenge.locale);
  const legal = getPublicLegalLinks();
  const privacyUrl = branding.privacyPolicyUrl ?? legal.privacyUrl;
  return (
    <main
      className="grid min-h-screen place-items-center bg-[#f3f6f7] px-4 py-10"
      lang={challenge.locale}
      style={brandingCssVariables(branding)}
    >
      <div className="w-full max-w-[470px]">
        <div className="mb-5 flex justify-center">
          <Logo
            href="/login"
            branding={branding}
            locale={challenge.locale}
          />
        </div>
        <section className="rounded-md border border-[#dfe4e8] bg-white p-6 shadow-sm sm:p-8">
          <header className="mb-6 text-center">
            <span className="mx-auto grid size-11 place-items-center rounded-md bg-[#e9f8f6] text-[#167e74]">
              <ShieldCheck className="size-5" />
            </span>
            <h1 className="mt-4 text-xl font-bold text-[#17212b]">
              {challenge.mode === "enroll" ? copy.mfa.enrollTitle : copy.mfa.verifyTitle}
            </h1>
            <p className="mt-2 text-xs text-[#71808b]">
              {challenge.email} | {challenge.organizationName}
            </p>
          </header>
          <MfaLoginForm
            mode={challenge.mode}
            secret={challenge.secret}
            otpAuthUri={challenge.otpAuthUri}
            locale={challenge.locale}
          />
          {privacyUrl ? (
            <div className="mt-6 border-t border-[#edf0f2] pt-4 text-center text-[11px] text-[#7b8791]">
              <AuthPrivacyLink
                href={privacyUrl}
                className="hover:text-[#52606d]"
                label={copy.navigation.items.privacy}
              />
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}
