"use client";

import { useEffect, useState } from "react";
import {
  Building2,
  Captions,
  Code2,
  FileText,
  Layers3,
  Languages,
  MessageSquareText,
  Palette,
  Scale,
  ShieldCheck,
  SlidersHorizontal,
  Smartphone,
  Link2,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { getSettingsAdminCopy } from "@/lib/i18n/settings-admin";
import type { AppLocale } from "@/lib/i18n/model";

const sectionDefinitions = [
  { id: "sicherheit", label: "security", icon: ShieldCheck },
  { id: "sprache", label: "language", icon: Languages },
  { id: "app-start", label: "appStart", icon: Smartphone },
  { id: "mitglieder-links", label: "memberLinks", icon: Link2 },
  { id: "design", label: "design", icon: Palette },
  { id: "custom-code", label: "customCode", icon: Code2 },
  { id: "datenschutz", label: "privacy", icon: Scale },
  { id: "sso", label: "sso", icon: Building2 },
  { id: "willkommen", label: "welcome", icon: MessageSquareText },
  { id: "transkripte", label: "transcripts", icon: Captions },
  { id: "profilfelder", label: "profileFields", icon: SlidersHorizontal },
  { id: "datenprofile", label: "dataProfiles", icon: Layers3 },
  { id: "datenformulare", label: "forms", icon: FileText },
] as const;

type SectionId = (typeof sectionDefinitions)[number]["id"];

function hashSection(): SectionId | null {
  const hash = window.location.hash.slice(1);
  return sectionDefinitions.some((section) => section.id === hash)
    ? (hash as SectionId)
    : null;
}

export function SettingsSectionNav({ locale }: { locale: AppLocale }) {
  const copy = getSettingsAdminCopy(locale);
  const [active, setActive] = useState<SectionId>("sicherheit");

  useEffect(() => {
    const updateFromViewport = () => {
      let current: SectionId = "sicherheit";
      for (const section of sectionDefinitions) {
        const element = document.getElementById(section.id);
        if (element && element.getBoundingClientRect().top <= 140) {
          current = section.id;
        }
      }
      setActive(current);
    };
    const updateFromHash = () => {
      const section = hashSection();
      if (section) setActive(section);
    };
    updateFromHash();
    updateFromViewport();
    window.addEventListener("hashchange", updateFromHash);
    window.addEventListener("scroll", updateFromViewport, { passive: true });
    window.addEventListener("resize", updateFromViewport);
    return () => {
      window.removeEventListener("hashchange", updateFromHash);
      window.removeEventListener("scroll", updateFromViewport);
      window.removeEventListener("resize", updateFromViewport);
    };
  }, []);

  return (
    <nav
      className="flex gap-1 overflow-x-auto border-b border-[#dfe4e8]"
      aria-label={copy.nav.aria}
    >
      {sectionDefinitions.map((section) => {
        const Icon = section.icon;
        const selected = active === section.id;
        return (
          <a
            key={section.id}
            href={`#${section.id}`}
            aria-current={selected ? "location" : undefined}
            onClick={() => setActive(section.id)}
            className={cn(
              "focus-ring flex h-10 shrink-0 items-center gap-2 border-b-2 px-4 text-xs font-semibold",
              selected
                ? "border-[var(--brand-accent)] text-[var(--brand-primary)]"
                : "border-transparent text-[#71808b] hover:text-[#354555]",
            )}
          >
            <Icon className="size-3.5" />
            {copy.nav[section.label]}
          </a>
        );
      })}
    </nav>
  );
}
