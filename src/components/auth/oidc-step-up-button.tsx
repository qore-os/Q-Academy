"use client";

import { LoaderCircle } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { useHydrated } from "@/lib/use-hydrated";

type OidcStepUpButtonProps = Pick<
  ButtonProps,
  "className" | "size" | "variant"
> & {
  children: ReactNode;
  returnTo: string;
  errorMessage: string;
};

export function OidcStepUpButton({
  children,
  returnTo,
  errorMessage,
  ...buttonProps
}: OidcStepUpButtonProps) {
  const hydrated = useHydrated();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function startStepUp() {
    setPending(true);
    setError("");
    try {
      const response = await fetch(
        `/api/v1/auth/oidc/start?return_to=${encodeURIComponent(returnTo)}`,
        {
          method: "POST",
          headers: { Accept: "application/json" },
          cache: "no-store",
        },
      );
      if (response.redirected) {
        window.location.assign(response.url);
        return;
      }
      if (!response.ok) throw new Error("OIDC step-up could not be started.");
      const payload = (await response.json()) as { authorizationUrl?: unknown };
      if (typeof payload.authorizationUrl !== "string") {
        throw new Error("OIDC step-up returned an invalid destination.");
      }
      const destination = new URL(payload.authorizationUrl);
      if (destination.protocol !== "https:" && destination.protocol !== "http:") {
        throw new Error("OIDC step-up returned an invalid protocol.");
      }
      window.location.assign(destination.toString());
    } catch {
      setPending(false);
      setError(errorMessage);
    }
  }

  return (
    <span className="flex flex-col items-end gap-1.5">
      <Button
        {...buttonProps}
        type="button"
        disabled={!hydrated || pending}
        aria-busy={pending}
        onClick={() => void startStepUp()}
      >
        {pending ? <LoaderCircle className="size-4 animate-spin" /> : null}
        {children}
      </Button>
      {error ? (
        <span role="alert" className="text-xs text-[#a94339]">
          {error}
        </span>
      ) : null}
    </span>
  );
}
