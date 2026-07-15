"use client";

import { ArrowLeft, ArrowRight, CheckCircle2, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, buttonClassName } from "@/components/ui/button";
import {
  getAuthPageCopy,
  type AuthPageCopy,
} from "@/lib/i18n/auth-pages";
import type { AppLocale } from "@/lib/i18n/model";

async function readError(response: Response, copy: AuthPageCopy) {
  await response.body?.cancel();
  return copy.requestFailed;
}

export function InvitationAcceptForm({
  token,
  locale,
}: {
  token: string;
  locale: AppLocale;
}) {
  const copy = getAuthPageCopy(locale);
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(formData: FormData) {
    const password = String(formData.get("password") ?? "");
    const confirmation = String(formData.get("confirmation") ?? "");
    if (password !== confirmation) return setError(copy.passwordMismatch);
    setPending(true);
    setError(null);
    const response = await fetch(
      `/api/v1/invitations/${encodeURIComponent(token)}/accept`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      },
    );
    if (!response.ok) {
      setError(await readError(response, copy));
      setPending(false);
      return;
    }
    const payload = (await response.json()) as {
      data?: { user?: { role?: string }; mfaRequired?: boolean };
    };
    if (payload.data?.mfaRequired) {
      router.push("/login/mfa");
      router.refresh();
      return;
    }
    router.push(payload.data?.user?.role === "member" ? "/academy" : "/admin");
    router.refresh();
  }

  return (
    <form action={submit} className="space-y-4">
      <PasswordFields copy={copy} />
      {error ? (
        <p role="alert" className="rounded-md border border-[#f4c8c2] bg-[#fdf0ee] px-3 py-2.5 text-xs text-[#a94339]">
          {error}
        </p>
      ) : null}
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? <LoaderCircle className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
        {pending ? copy.acceptingInvitation : copy.acceptInvitation}
      </Button>
    </form>
  );
}

export function PasswordForgotForm({ locale }: { locale: AppLocale }) {
  const copy = getAuthPageCopy(locale);
  const [pending, setPending] = useState(false);
  const [complete, setComplete] = useState(false);
  const [developmentToken, setDevelopmentToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit(formData: FormData) {
    setPending(true);
    setError(null);
    const response = await fetch("/api/v1/password/forgot", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: formData.get("email") }),
    });
    if (!response.ok) {
      setError(await readError(response, copy));
      setPending(false);
      return;
    }
    const payload = (await response.json()) as {
      data?: { developmentToken?: string };
    };
    setDevelopmentToken(payload.data?.developmentToken ?? null);
    setComplete(true);
    setPending(false);
  }

  if (complete) {
    return (
      <div className="space-y-4">
        <div className="rounded-md border border-[#b9e8e3] bg-[#edf9f7] p-4 text-sm leading-6 text-[#176f68]">
          {copy.resetSent}
        </div>
        {developmentToken ? (
          <Link
            className={buttonClassName({ className: "w-full" })}
            href={`/password/reset?token=${encodeURIComponent(developmentToken)}`}
          >
            {copy.localResetLink}<ArrowRight className="size-4" />
          </Link>
        ) : null}
        <BackToLogin copy={copy} />
      </div>
    );
  }

  return (
    <form action={submit} className="space-y-4">
      <label className="block">
        <span className="mb-1.5 block text-xs font-semibold text-[#354555]">{copy.email}</span>
        <input name="email" type="email" autoComplete="email" className="focus-ring h-11 w-full rounded-md border border-[#dce1e5] px-3.5 text-sm" required />
      </label>
      {error ? <p role="alert" className="rounded-md border border-[#f4c8c2] bg-[#fdf0ee] px-3 py-2.5 text-xs text-[#a94339]">{error}</p> : null}
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? <LoaderCircle className="size-4 animate-spin" /> : <ArrowRight className="size-4" />}
        {pending ? copy.requesting : copy.requestLink}
      </Button>
      <BackToLogin copy={copy} />
    </form>
  );
}

export function PasswordResetForm({
  token,
  locale,
}: {
  token: string;
  locale: AppLocale;
}) {
  const copy = getAuthPageCopy(locale);
  const [pending, setPending] = useState(false);
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(formData: FormData) {
    const password = String(formData.get("password") ?? "");
    if (password !== String(formData.get("confirmation") ?? "")) {
      return setError(copy.passwordMismatch);
    }
    setPending(true);
    setError(null);
    const response = await fetch("/api/v1/password/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password }),
    });
    if (!response.ok) {
      setError(await readError(response, copy));
      setPending(false);
      return;
    }
    setComplete(true);
    setPending(false);
  }

  if (complete) {
    return (
      <div className="space-y-4">
        <div className="rounded-md border border-[#b9e8e3] bg-[#edf9f7] p-4 text-sm text-[#176f68]">
          {copy.passwordUpdated}
        </div>
        <Link className={buttonClassName({ className: "w-full" })} href="/login">
          {copy.signInNow}<ArrowRight className="size-4" />
        </Link>
      </div>
    );
  }
  return (
    <form action={submit} className="space-y-4">
      <PasswordFields copy={copy} />
      {error ? <p role="alert" className="rounded-md border border-[#f4c8c2] bg-[#fdf0ee] px-3 py-2.5 text-xs text-[#a94339]">{error}</p> : null}
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? <LoaderCircle className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
        {pending ? copy.saving : copy.savePassword}
      </Button>
    </form>
  );
}

function BackToLogin({ copy }: { copy: AuthPageCopy }) {
  return (
    <Link href="/login" className="focus-ring flex items-center justify-center gap-2 rounded-md py-2 text-xs font-semibold text-[#52606d]">
      <ArrowLeft className="size-4" />{copy.backToLogin}
    </Link>
  );
}

function PasswordFields({ copy }: { copy: AuthPageCopy }) {
  return (
    <>
      <label className="block">
        <span className="mb-1.5 block text-xs font-semibold text-[#354555]">{copy.newPassword}</span>
        <input name="password" type="password" autoComplete="new-password" minLength={10} className="focus-ring h-11 w-full rounded-md border border-[#dce1e5] px-3.5 text-sm" required />
      </label>
      <label className="block">
        <span className="mb-1.5 block text-xs font-semibold text-[#354555]">{copy.confirmPassword}</span>
        <input name="confirmation" type="password" autoComplete="new-password" minLength={10} className="focus-ring h-11 w-full rounded-md border border-[#dce1e5] px-3.5 text-sm" required />
      </label>
      <p className="text-[11px] leading-5 text-[#7b8791]">{copy.passwordHint}</p>
    </>
  );
}
