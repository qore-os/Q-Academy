"use client";

import {
  ArrowRight,
  Building2,
  Eye,
  EyeOff,
  LoaderCircle,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { useActionState, useState } from "react";
import { Button, buttonClassName } from "@/components/ui/button";
import { demoLoginAction, loginAction, type ActionState } from "@/lib/actions";
import { getCoreDictionary } from "@/lib/i18n/dictionaries";
import type { AppLocale } from "@/lib/i18n/model";
import { useHydrated } from "@/lib/use-hydrated";

const initialState: ActionState = {};
const showDevelopmentLogin = process.env.NODE_ENV === "development";

export function LoginForm({
  platformName = "Q-Academy",
  oidc = {
    enabled: false,
    displayName: "Unternehmens-Login",
    passwordLoginEnabled: true,
  },
  oidcError,
  locale,
  initialEmail,
}: {
  platformName?: string;
  oidc?: {
    enabled: boolean;
    displayName: string;
    passwordLoginEnabled: boolean;
  };
  oidcError?: string;
  locale: AppLocale;
  initialEmail?: string;
}) {
  const copy = getCoreDictionary(locale).auth;
  const [state, action, pending] = useActionState(loginAction, initialState);
  const [email, setEmail] = useState(
    initialEmail ?? (showDevelopmentLogin ? "lea@q-academy.de" : ""),
  );
  const [password, setPassword] = useState(
    showDevelopmentLogin ? "Demo123!" : "",
  );
  const hydrated = useHydrated();
  const [showPassword, setShowPassword] = useState(false);
  const memberDemo = demoLoginAction.bind(null, "member");
  const adminDemo = demoLoginAction.bind(null, "admin");

  return (
    <div>
      {showDevelopmentLogin ? (
        <div className="mb-7 grid grid-cols-2 gap-2 rounded-md bg-[#f1f3f5] p-1">
          <form action={memberDemo}>
            <button
              type="submit"
              disabled={!hydrated}
              className="focus-ring flex min-h-10 w-full items-center justify-center gap-2 rounded bg-white px-3 text-xs font-semibold text-[#17324d] shadow-sm hover:bg-[#f8fafb]"
            >
              <UserRound className="size-4 text-[#2bb7a9]" />
              {copy.demoMember}
            </button>
          </form>
          <form action={adminDemo}>
            <button
              type="submit"
              disabled={!hydrated}
              className="focus-ring flex min-h-10 w-full items-center justify-center gap-2 rounded px-3 text-xs font-semibold text-[#52606d] hover:bg-white"
            >
              <ShieldCheck className="size-4 text-[#4f7cac]" />
              {copy.demoAdmin}
            </button>
          </form>
        </div>
      ) : null}

      {oidcError ? (
        <p
          role="alert"
          className="mb-4 rounded-md border border-[#f4c8c2] bg-[#fdf0ee] px-3 py-2.5 text-xs text-[#a94339]"
        >
          {oidcError}
        </p>
      ) : null}

      {oidc.enabled ? (
        <a
          href="/api/v1/auth/oidc/start"
          className={buttonClassName({
            variant: "navy",
            size: "lg",
            className: "w-full",
          })}
        >
          <Building2 className="size-4" />
          {copy.signInAt(oidc.displayName)}
        </a>
      ) : null}

      {oidc.enabled && oidc.passwordLoginEnabled ? (
        <div className="my-5 flex items-center gap-3" aria-hidden="true">
          <span className="h-px flex-1 bg-[#e1e5e8]" />
          <span className="text-[10px] font-semibold uppercase text-[#8a949d]">
            {copy.orPassword}
          </span>
          <span className="h-px flex-1 bg-[#e1e5e8]" />
        </div>
      ) : null}

      {oidc.passwordLoginEnabled ? (
        <form action={action} className="space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-[#354555]">
              {copy.email}
            </span>
            <input
              name="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={!hydrated}
              className="focus-ring h-11 w-full rounded-md border border-[#dce1e5] bg-white px-3.5 text-sm text-[#243444]"
              required
            />
          </label>
          <label className="block">
            <span className="mb-1.5 flex items-center justify-between gap-3 text-xs font-semibold text-[#354555]">
              {copy.password}
              <Link
                href="/password/forgot"
                className="focus-ring rounded text-[11px] font-medium text-[#365f8d] hover:underline"
              >
                {copy.forgot}
              </Link>
            </span>
            <span className="relative block">
              <input
                aria-label={copy.password}
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={!hydrated}
                className="focus-ring h-11 w-full rounded-md border border-[#dce1e5] bg-white px-3.5 pr-11 text-sm text-[#243444]"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword((value) => !value)}
                disabled={!hydrated}
                className="focus-ring absolute right-1 top-1 grid size-9 place-items-center rounded text-[#75818b] hover:bg-[#f1f3f5]"
                aria-label={
                  showPassword ? copy.hidePassword : copy.showPassword
                }
              >
                {showPassword ? (
                  <EyeOff className="size-4" />
                ) : (
                  <Eye className="size-4" />
                )}
              </button>
            </span>
          </label>
          {state.error ? (
            <p
              role="alert"
              className="rounded-md border border-[#f4c8c2] bg-[#fdf0ee] px-3 py-2.5 text-xs text-[#a94339]"
            >
              {state.error}
            </p>
          ) : null}
          <Button
            type="submit"
            size="lg"
            className="mt-2 w-full"
            disabled={pending || !hydrated}
          >
            {pending ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <ArrowRight className="size-4" />
            )}
            {pending ? copy.signingIn : copy.signInAt(platformName)}
          </Button>
        </form>
      ) : null}
      {showDevelopmentLogin && oidc.passwordLoginEnabled ? (
        <p className="mt-5 text-center text-[11px] leading-5 text-[#596773]">
          {copy.demoPassword}{" "}
          <strong className="font-semibold text-[#52606d]">Demo123!</strong>
        </p>
      ) : null}
    </div>
  );
}
