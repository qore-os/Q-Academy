"use client";

import { useState } from "react";
import { Play, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { courseIntegrationFrameClass } from "@/lib/content-blocks/integration-catalog";
import type { CourseIntegrationLayout } from "@/lib/content-blocks/integration-catalog";
import { getCourseIntegrationCopy } from "@/lib/i18n/course-integrations";
import type { AppLocale } from "@/lib/i18n/model";
import { cn } from "@/lib/utils";

export function CourseIntegrationEmbed({
  layout,
  locale,
  providerName,
  src,
  title,
}: {
  layout: CourseIntegrationLayout;
  locale: AppLocale;
  providerName: string;
  src: string;
  title: string;
}) {
  const [loaded, setLoaded] = useState(false);
  const copy = getCourseIntegrationCopy(locale);
  const frameClass = courseIntegrationFrameClass(layout);

  if (loaded) {
    return (
      <iframe
        src={src}
        title={title}
        sandbox="allow-forms allow-presentation allow-same-origin allow-scripts"
        referrerPolicy="strict-origin-when-cross-origin"
        loading="lazy"
        allow="fullscreen; picture-in-picture"
        data-course-integration-frame={providerName}
        className={cn(
          "w-full rounded-md border border-[#dfe4e8] bg-white",
          frameClass,
        )}
      />
    );
  }

  return (
    <div
      className={cn(
        "grid w-full place-items-center rounded-md border border-[#cbd7e2] bg-[#f7f9fb] p-6 text-center",
        frameClass,
      )}
      data-course-integration-consent={providerName}
    >
      <div className="max-w-md">
        <ShieldCheck
          className="mx-auto size-7 text-[#365f8d]"
          aria-hidden="true"
        />
        <p className="mt-3 text-sm font-bold text-[#354555]">
          {copy.consentTitle(providerName)}
        </p>
        <p className="mt-2 text-xs leading-5 text-[#667684]">
          {copy.consentDescription(providerName)}
        </p>
        <Button
          type="button"
          size="sm"
          className="mt-4"
          onClick={() => setLoaded(true)}
        >
          <Play className="size-4" aria-hidden="true" />
          {copy.loadContent}
        </Button>
      </div>
    </div>
  );
}
