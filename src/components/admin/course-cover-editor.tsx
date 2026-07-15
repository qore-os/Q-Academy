"use client";

import Image from "next/image";
import { Check } from "lucide-react";
import { useState } from "react";

import { CourseMediaSourceField } from "@/components/admin/course-media-source-field";
import {
  COURSE_COVER_PRESETS,
  DEFAULT_COURSE_COVER,
  courseCoverImageProps,
  courseCoverMediaAssetId,
  isCourseCoverPreset,
  safeCourseCoverSource,
} from "@/lib/course-cover";
import { getCourseParityCopy } from "@/lib/i18n/course-parity";
import type { AppLocale } from "@/lib/i18n/model";
import { cn } from "@/lib/utils";

const PRESET_KEYS = [
  "foundations",
  "workflows",
  "prompts",
  "responsibleAi",
] as const;

export function CourseCoverEditor({
  courseId,
  currentCover,
  locale,
  stockImagesEnabled,
}: {
  courseId: string;
  currentCover: string | null;
  locale: AppLocale;
  stockImagesEnabled: boolean;
}) {
  const copy = getCourseParityCopy(locale).cover;
  const initialSource = safeCourseCoverSource(currentCover) ?? DEFAULT_COURSE_COVER;
  const [source, setSource] = useState(initialSource);
  const image = courseCoverImageProps(source);

  return (
    <div className="space-y-4 rounded-md border border-[#dce3e8] bg-[#f8fafb] p-3">
      <input type="hidden" name="coverImage" value={source} />
      <div className="overflow-hidden rounded-md border border-[#dce3e8] bg-white">
        <Image
          src={image.src}
          alt={copy.currentPreview}
          width={960}
          height={540}
          unoptimized={image.unoptimized}
          className="aspect-video w-full object-cover"
        />
      </div>

      <fieldset>
        <legend className="mb-2 text-xs font-bold text-[#354555]">
          {copy.presets}
        </legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {COURSE_COVER_PRESETS.map((preset, index) => {
            const selected = source === preset;
            return (
              <button
                key={preset}
                type="button"
                onClick={() => setSource(preset)}
                aria-pressed={selected}
                aria-label={copy.presetNames[PRESET_KEYS[index]]}
                className={cn(
                  "focus-ring relative overflow-hidden rounded-md border bg-white text-left",
                  selected ? "border-[#2b9188] ring-1 ring-[#2b9188]" : "border-[#dce1e5]",
                )}
              >
                <Image
                  src={preset}
                  alt=""
                  width={240}
                  height={135}
                  className="aspect-video w-full object-cover"
                />
                <span className="block truncate px-2 py-1.5 text-[10px] font-semibold text-[#52606d]">
                  {copy.presetNames[PRESET_KEYS[index]]}
                </span>
                {selected ? (
                  <span className="absolute right-1.5 top-1.5 grid size-5 place-items-center rounded-full bg-[#167e74] text-white">
                    <Check className="size-3" />
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </fieldset>

      <div className="border-t border-[#e1e6e9] pt-4">
        <p className="mb-2 text-xs font-bold text-[#354555]">{copy.customImage}</p>
        <CourseMediaSourceField
          locale={locale}
          courseId={courseId}
          kind="image"
          label={copy.label}
          defaultAssetId={courseCoverMediaAssetId(initialSource) ?? undefined}
          stockImagesEnabled={stockImagesEnabled}
          allowExternalUrl={false}
          mediaAssetIdName="coverMediaAssetId"
          stockSelectionIdName="coverStockImageSelectionId"
          materializeStockSelection
          onAssetChange={(assetId) => {
            if (assetId) {
              setSource(`/api/media-assets/${assetId}/download`);
            } else if (!isCourseCoverPreset(source)) {
              setSource(DEFAULT_COURSE_COVER);
            }
          }}
        />
      </div>
    </div>
  );
}
