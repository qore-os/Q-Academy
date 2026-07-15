"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import {
  ArrowRight,
  CircleUserRound,
  ImagePlus,
  LoaderCircle,
  X,
} from "lucide-react";
import { Button, buttonClassName } from "@/components/ui/button";
import { acknowledgeMemberWelcomeAction } from "@/lib/member-welcome-actions";
import type { PendingMemberWelcome } from "@/lib/member-welcome-model";
import { getSettingsAdminCopy } from "@/lib/i18n/settings-admin";
import type { AppLocale } from "@/lib/i18n/model";

const focusableSelector =
  'a[href], button:not([disabled]), video[controls], [tabindex]:not([tabindex="-1"])';

export function MemberWelcomeModal({
  welcome,
  locale,
}: {
  welcome: PendingMemberWelcome;
  locale: AppLocale;
}) {
  const copy = getSettingsAdminCopy(locale);
  const router = useRouter();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const pendingRef = useRef(false);
  const [open, setOpen] = useState(true);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    pendingRef.current = pending;
  }, [pending]);

  const finish = useCallback((destination?: string) => {
    if (pendingRef.current) return;
    setError("");
    startTransition(async () => {
      const result = await acknowledgeMemberWelcomeAction(welcome.version);
      if (
        result.status === "acknowledged" ||
        result.status === "already_acknowledged"
      ) {
        setOpen(false);
        if (destination) router.push(destination);
        else router.refresh();
        return;
      }
      if (result.status === "stale" || result.status === "not_available") {
        setOpen(false);
        router.refresh();
        return;
      }
      setError(copy.welcome.confirmationFailed);
    });
  }, [copy.welcome.confirmationFailed, router, welcome.version]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    previouslyFocusedRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        finish();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(focusableSelector) ??
          [],
      ).filter((element) => !element.hasAttribute("disabled"));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
      previouslyFocusedRef.current?.focus();
    };
  }, [finish, open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[90] grid place-items-center bg-[#0f263c]/55 p-3 sm:p-5">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="member-welcome-title"
        aria-describedby="member-welcome-description"
        className="brand-radius relative flex max-h-[calc(100dvh-1.5rem)] w-full max-w-2xl flex-col overflow-hidden bg-white shadow-2xl sm:max-h-[calc(100dvh-2.5rem)]"
      >
        <button
          ref={closeButtonRef}
          type="button"
          onClick={() => finish()}
          disabled={pending}
          className="focus-ring absolute right-3 top-3 z-10 grid size-9 place-items-center rounded-md bg-white/95 text-[#5f6d78] shadow-sm hover:bg-[#edf1f3]"
          aria-label={copy.welcome.modalClose}
          title={copy.welcome.finish}
        >
          {pending ? (
            <LoaderCircle className="size-4 animate-spin" />
          ) : (
            <X className="size-5" />
          )}
        </button>

        <div className="overflow-y-auto">
          {welcome.videoUrl ? (
            <video
              src={welcome.videoUrl}
              controls
              preload="metadata"
              playsInline
              className="aspect-video w-full bg-black object-contain"
            />
          ) : (
            <div className="h-2 bg-[var(--brand-accent)]" />
          )}

          <div className="p-5 sm:p-7">
            <p className="text-[10px] font-bold uppercase text-[var(--theme-teal-text)]">
              {copy.welcome.modalEyebrow}
            </p>
            <h2
              id="member-welcome-title"
              className="mt-2 pr-10 text-xl font-bold text-[#243444] sm:text-2xl"
            >
              {welcome.title}
            </h2>
            <p
              id="member-welcome-description"
              className="mt-3 whitespace-pre-line text-sm leading-6 text-[#5e6b76]"
            >
              {welcome.welcomeText}
            </p>

            {welcome.promptProfileImage ||
            welcome.promptProfileCompletion ? (
              <div className="mt-6 grid gap-2 sm:grid-cols-2">
                {welcome.promptProfileImage ? (
                  <Link
                    href="/academy/profile"
                    onClick={(event) => {
                      event.preventDefault();
                      finish("/academy/profile");
                    }}
                    aria-disabled={pending}
                    className={buttonClassName({
                      variant: "secondary",
                      className: "h-auto min-h-11 justify-start whitespace-normal py-2",
                    })}
                  >
                    <ImagePlus className="size-4 shrink-0" />
                    {copy.welcome.addProfileImage}
                  </Link>
                ) : null}
                {welcome.promptProfileCompletion ? (
                  <Link
                    href="/academy/profile"
                    onClick={(event) => {
                      event.preventDefault();
                      finish("/academy/profile");
                    }}
                    aria-disabled={pending}
                    className={buttonClassName({
                      variant: "secondary",
                      className: "h-auto min-h-11 justify-start whitespace-normal py-2",
                    })}
                  >
                    <CircleUserRound className="size-4 shrink-0" />
                    {copy.welcome.completeProfile}
                  </Link>
                ) : null}
              </div>
            ) : null}

            {error ? (
              <p role="alert" className="mt-4 text-xs text-[#a94339]">
                {error}
              </p>
            ) : null}
            <div className="mt-6 flex justify-end">
              <Button onClick={() => finish()} disabled={pending}>
                {pending ? (
                  <LoaderCircle className="size-4 animate-spin" />
                ) : (
                  <ArrowRight className="size-4" />
                )}
                {pending ? copy.welcome.confirming : copy.welcome.getStarted}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
