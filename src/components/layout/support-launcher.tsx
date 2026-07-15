"use client";

import { Headphones } from "lucide-react";
import { useEffect } from "react";
import type { SupportLauncherConfiguration } from "@/lib/support";

declare global {
  interface Window {
    Intercom?: (command: string, options?: Record<string, unknown>) => void;
    intercomSettings?: Record<string, unknown>;
  }
}

export function SupportLauncher({
  configuration,
}: {
  configuration: SupportLauncherConfiguration | null;
}) {
  useEffect(() => {
    if (configuration?.provider !== "intercom") return;
    window.intercomSettings = {
      api_base: "https://api-iam.intercom.io",
      app_id: configuration.appId,
      user_id: configuration.userId,
      email: configuration.email,
      name: configuration.name,
      ...(configuration.userHash ? { user_hash: configuration.userHash } : {}),
      hide_default_launcher: true,
    };
    window.Intercom?.("boot", window.intercomSettings);
    const existing = document.querySelector<HTMLScriptElement>(
      `script[data-intercom-app-id="${configuration.appId}"]`,
    );
    if (existing) {
      return () => window.Intercom?.("shutdown");
    }
    const script = document.createElement("script");
    script.async = true;
    script.src = `https://widget.intercom.io/widget/${encodeURIComponent(configuration.appId)}`;
    script.dataset.intercomAppId = configuration.appId;
    script.addEventListener("load", () => {
      window.Intercom?.("boot", window.intercomSettings);
    });
    document.head.appendChild(script);
    return () => window.Intercom?.("shutdown");
  }, [configuration]);

  if (!configuration) return null;
  const className =
    "focus-ring grid size-9 place-items-center rounded-md text-[#52606d] hover:bg-[#edf1f3] hover:text-[var(--brand-primary)]";
  if (configuration.provider === "link") {
    return (
      <a
        href={configuration.url}
        target="_blank"
        rel="noreferrer"
        title={configuration.label}
        aria-label={configuration.label}
        className={className}
      >
        <Headphones className="size-[18px]" />
      </a>
    );
  }
  if (configuration.provider === "email") {
    return (
      <a
        href={`mailto:${configuration.email}`}
        title={configuration.label}
        aria-label={configuration.label}
        className={className}
      >
        <Headphones className="size-[18px]" />
      </a>
    );
  }
  return (
    <button
      type="button"
      onClick={() => window.Intercom?.("show")}
      title={configuration.label}
      aria-label={configuration.label}
      className={className}
    >
      <Headphones className="size-[18px]" />
    </button>
  );
}
