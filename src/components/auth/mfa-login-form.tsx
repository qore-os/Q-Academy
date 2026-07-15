"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import {
  Check,
  Clipboard,
  KeyRound,
  LoaderCircle,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { getCoreDictionary } from "@/lib/i18n/dictionaries";
import type { AppLocale } from "@/lib/i18n/model";
import { useHydrated } from "@/lib/use-hydrated";

type MfaLoginState = {
  ok: boolean | null;
  message: string;
  recoveryCodes?: string[];
  redirectTo?: string;
};

const initialState: MfaLoginState = { ok: null, message: "" };

const API_ERROR_COPY: Record<AppLocale, Record<string, string>> = {
  de: {
    invalid_code: "Der MFA- oder Recovery-Code ist nicht korrekt.",
    rate_limited: "Zu viele MFA-Versuche. Bitte versuche es spaeter erneut.",
    expired: "Die MFA-Anfrage ist abgelaufen. Bitte melde dich erneut an.",
    configuration_changed:
      "Die MFA-Konfiguration wurde geaendert. Bitte melde dich erneut an.",
  },
  en: {
    invalid_code: "The MFA or recovery code is incorrect.",
    rate_limited: "Too many MFA attempts. Please try again later.",
    expired: "The MFA request expired. Please sign in again.",
    configuration_changed:
      "The MFA configuration changed. Please sign in again.",
  },
  it: {
    invalid_code: "Il codice MFA o di recupero non è corretto.",
    rate_limited: "Troppi tentativi MFA. Riprova più tardi.",
    expired: "La richiesta MFA è scaduta. Accedi di nuovo.",
    configuration_changed: "La configurazione MFA è cambiata. Accedi di nuovo.",
  },
  es: {
    invalid_code: "El código MFA o de recuperación no es correcto.",
    rate_limited: "Demasiados intentos MFA. Inténtalo más tarde.",
    expired: "La solicitud MFA ha caducado. Inicia sesión de nuevo.",
    configuration_changed:
      "La configuración MFA ha cambiado. Inicia sesión de nuevo.",
  },
  fr: {
    invalid_code: "Le code MFA ou de récupération est incorrect.",
    rate_limited: "Trop de tentatives MFA. Réessayez plus tard.",
    expired: "La demande MFA a expiré. Connectez-vous à nouveau.",
    configuration_changed:
      "La configuration MFA a changé. Connectez-vous à nouveau.",
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function safeRedirectDestination(value: unknown) {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.startsWith("//")
  ) {
    return "/admin";
  }
  try {
    const parsed = new URL(value, window.location.origin);
    const allowed =
      parsed.pathname === "/admin" ||
      parsed.pathname.startsWith("/admin/") ||
      parsed.pathname === "/academy/profile";
    return parsed.origin === window.location.origin && allowed
      ? `${parsed.pathname}${parsed.search}${parsed.hash}`
      : "/admin";
  } catch {
    return "/admin";
  }
}

export function MfaLoginForm({
  mode,
  secret,
  otpAuthUri,
  locale,
}: {
  mode: "verify" | "enroll";
  secret: string | null;
  otpAuthUri: string | null;
  locale: AppLocale;
}) {
  const copy = getCoreDictionary(locale).mfa;
  const router = useRouter();
  const [state, setState] = useState<MfaLoginState>(initialState);
  const [pending, setPending] = useState(false);
  const hydrated = useHydrated();
  const submissionInFlight = useRef(false);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!otpAuthUri) return;
    let active = true;
    void QRCode.toDataURL(otpAuthUri, {
      width: 220,
      margin: 2,
      errorCorrectionLevel: "M",
      color: { dark: "#17212b", light: "#ffffff" },
    }).then((value) => {
      if (active) setQrCode(value);
    });
    return () => {
      active = false;
    };
  }, [otpAuthUri]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submissionInFlight.current) return;
    submissionInFlight.current = true;
    setPending(true);
    setState(initialState);
    try {
      const code = String(
        new FormData(event.currentTarget).get("code") ?? "",
      ).trim();
      const response = await fetch("/api/v1/auth/mfa", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ code }),
      });
      let payload: unknown = null;
      try {
        payload = await response.json();
      } catch {
        // The generic message below also covers invalid gateway responses.
      }
      if (!response.ok) {
        const errorCode =
          isRecord(payload) && typeof payload.code === "string"
            ? payload.code
            : null;
        const message = errorCode
          ? (API_ERROR_COPY[locale][errorCode] ?? copy.requestFailed)
          : copy.requestFailed;
        setState({ ok: false, message });
        return;
      }
      const data =
        isRecord(payload) && isRecord(payload.data) ? payload.data : null;
      const recoveryCodes =
        data &&
        Array.isArray(data.recoveryCodes) &&
        data.recoveryCodes.length > 0 &&
        data.recoveryCodes.every((value) => typeof value === "string")
          ? data.recoveryCodes
          : undefined;
      if (mode === "enroll" && !recoveryCodes) {
        setState({
          ok: false,
          message: copy.missingRecovery,
        });
        return;
      }
      const redirectTo = safeRedirectDestination(data?.redirectTo);
      setState({
        ok: true,
        message: recoveryCodes ? copy.enabled : copy.verified,
        recoveryCodes,
        redirectTo,
      });
      if (!recoveryCodes) {
        router.replace(redirectTo);
        router.refresh();
      }
    } catch {
      setState({
        ok: false,
        message: copy.connectionFailed,
      });
    } finally {
      submissionInFlight.current = false;
      setPending(false);
    }
  }

  if (state.ok && state.recoveryCodes) {
    return (
      <section className="space-y-5" aria-live="polite">
        <div className="flex items-start gap-3 rounded-md border border-[#bfe5df] bg-[#eefaf8] p-4">
          <Check className="mt-0.5 size-5 shrink-0 text-[#167e74]" />
          <div>
            <h2 className="text-sm font-bold text-[#24443f]">
              {copy.saveRecovery}
            </h2>
            <p className="mt-1 text-xs leading-5 text-[#52716c]">
              {copy.recoveryOnlyOnce}
            </p>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-2 rounded-md border border-[#dce1e5] bg-[#f7f9fa] p-4 font-mono text-xs text-[#243444] sm:grid-cols-2">
          {state.recoveryCodes.map((code) => (
            <code key={code}>{code}</code>
          ))}
        </div>
        <Button
          type="button"
          variant="secondary"
          className="w-full"
          onClick={async () => {
            await navigator.clipboard.writeText(
              state.recoveryCodes!.join("\n"),
            );
            setCopied(true);
          }}
        >
          {copied ? (
            <Check className="size-4" />
          ) : (
            <Clipboard className="size-4" />
          )}
          {copied ? copy.copied : copy.copy}
        </Button>
        <label className="flex items-start gap-3 text-xs leading-5 text-[#52606d]">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(event) => setAcknowledged(event.target.checked)}
            className="mt-1 size-4"
          />
          {copy.acknowledge}
        </label>
        <Button
          type="button"
          className="w-full"
          disabled={!acknowledged}
          onClick={() => {
            router.replace(state.redirectTo ?? "/admin");
            router.refresh();
          }}
        >
          <ShieldCheck className="size-4" />
          {copy.continue}
        </Button>
      </section>
    );
  }

  return (
    <form
      action="/api/v1/auth/mfa"
      method="post"
      onSubmit={handleSubmit}
      className="space-y-5"
    >
      {mode === "enroll" ? (
        <div className="space-y-4">
          <p className="text-xs leading-5 text-[#66727f]">{copy.enrollIntro}</p>
          <div className="mx-auto grid size-[236px] place-items-center rounded-md border border-[#dce1e5] bg-white p-2">
            {qrCode ? (
              // eslint-disable-next-line @next/next/no-img-element -- QRCode is generated locally as a short-lived data URL.
              <img src={qrCode} alt={copy.qrAlt} className="size-[220px]" />
            ) : (
              <LoaderCircle className="size-6 animate-spin text-[#71808b]" />
            )}
          </div>
          <div className="rounded-md bg-[#f1f4f6] p-3">
            <p className="text-[10px] font-bold uppercase text-[#71808b]">
              {copy.manualKey}
            </p>
            <code className="mt-1 block break-all text-xs font-semibold text-[#243444]">
              {secret}
            </code>
          </div>
        </div>
      ) : (
        <p className="text-xs leading-5 text-[#66727f]">{copy.verifyIntro}</p>
      )}
      <label className="block">
        <span className="mb-1.5 block text-xs font-semibold text-[#354555]">
          {mode === "enroll" ? copy.confirmCode : copy.code}
        </span>
        <span className="relative block">
          <KeyRound className="pointer-events-none absolute left-3.5 top-3 size-4 text-[#75818b]" />
          <input
            name="code"
            inputMode={mode === "enroll" ? "numeric" : "text"}
            autoComplete="one-time-code"
            pattern={mode === "enroll" ? "[0-9]{6}" : undefined}
            minLength={6}
            maxLength={32}
            className="focus-ring h-11 w-full rounded-md border border-[#dce1e5] bg-white pl-10 pr-3 text-sm text-[#243444]"
            required
            autoFocus
            disabled={!hydrated || pending}
          />
        </span>
      </label>
      {state.message ? (
        <p
          role={state.ok ? "status" : "alert"}
          className={`rounded-md px-3 py-2.5 text-xs ${state.ok ? "bg-[#eefaf8] text-[#167e74]" : "border border-[#f4c8c2] bg-[#fdf0ee] text-[#a94339]"}`}
        >
          {state.message}
        </p>
      ) : null}
      <Button
        type="submit"
        size="lg"
        className="w-full"
        disabled={!hydrated || pending}
      >
        {pending ? (
          <LoaderCircle className="size-4 animate-spin" />
        ) : (
          <ShieldCheck className="size-4" />
        )}
        {pending
          ? copy.verifying
          : mode === "enroll"
            ? copy.activate
            : copy.finish}
      </Button>
    </form>
  );
}
