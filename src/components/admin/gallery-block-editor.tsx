"use client";

import { useId, useState } from "react";
import { Grid2X2, LayoutPanelTop, Plus, Trash2 } from "lucide-react";

import { CourseMediaSourceField } from "@/components/admin/course-media-source-field";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  sanitizeGalleryDocument,
  type GalleryDocument,
} from "@/lib/content-blocks/interactive-documents";
import { getCourseSupportCopy } from "@/lib/i18n/course-support";
import type { AppLocale } from "@/lib/i18n/model";

type EditableGalleryItem = {
  key: string;
  source?: string;
  alt: string;
  caption?: string;
  mediaAssetId?: string;
  mediaAssetName?: string;
};

const inputClass =
  "focus-ring h-10 w-full rounded-md border border-[#dce1e5] bg-white px-3 text-sm text-[#243444] placeholder:text-[var(--theme-muted-text)]";

export function GalleryBlockEditor({
  initialValue,
  locale,
}: {
  initialValue: unknown;
  locale: AppLocale;
}) {
  const copy = getCourseSupportCopy(locale).gallery;
  const numberFormatter = new Intl.NumberFormat(locale);
  const instanceId = useId();
  const initial = sanitizeGalleryDocument(initialValue);
  const [layout, setLayout] = useState<GalleryDocument["layout"]>(
    initial.layout,
  );
  const [items, setItems] = useState<EditableGalleryItem[]>(() => {
    const existing = initial.items.map((item, index) => ({
      ...item,
      key: `existing-${index}`,
    }));
    return existing.length
      ? existing
      : [{ key: "new-0", alt: "", caption: "" }];
  });

  return (
    <div className="space-y-4">
      <input type="hidden" name="galleryItemCount" value={items.length} />
      <fieldset>
        <legend className="mb-1.5 text-xs font-semibold text-[#52606d]">
          {copy.display}
        </legend>
        <div className="inline-grid grid-cols-2 rounded-md border border-[#dce1e5] bg-[#f3f5f7] p-0.5">
          {(
            [
              { value: "grid", label: copy.grid, icon: Grid2X2 },
              { value: "featured", label: copy.featured, icon: LayoutPanelTop },
            ] as const
          ).map((option) => {
            const Icon = option.icon;
            return (
              <label
                key={option.value}
                className={cn(
                  "focus-within:ring-2 focus-within:ring-[#2b9188] flex h-9 cursor-pointer items-center gap-2 rounded px-3 text-xs font-semibold",
                  layout === option.value
                    ? "bg-white text-[#294f79] shadow-sm"
                    : "text-[#71808b]",
                )}
              >
                <input
                  type="radio"
                  name="galleryLayout"
                  value={option.value}
                  checked={layout === option.value}
                  onChange={() => setLayout(option.value)}
                  className="sr-only"
                />
                <Icon className="size-3.5" />
                {option.label}
              </label>
            );
          })}
        </div>
      </fieldset>

      <div className="space-y-3">
        {items.map((item, index) => {
          const label = copy.image(numberFormatter.format(index + 1));
          return (
            <section
              key={item.key}
              aria-label={label}
              className="rounded-md border border-[#dce1e5] bg-[#f8fafb] p-3.5"
            >
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="text-xs font-bold text-[#354555]">{label}</h3>
                {items.length > 1 ? (
                  <button
                    type="button"
                    onClick={() =>
                      setItems((current) =>
                        current.filter((candidate) => candidate.key !== item.key),
                      )
                    }
                    aria-label={copy.remove(label)}
                    title={copy.remove(label)}
                    className="focus-ring grid size-8 place-items-center rounded-md text-[#71808b] hover:bg-white hover:text-[#a94339]"
                  >
                    <Trash2 className="size-4" />
                  </button>
                ) : null}
              </div>
              <CourseMediaSourceField
                locale={locale}
                kind="image"
                label={label}
                mediaAssetIdName={`gallery.${index}.mediaAssetId`}
                urlName={`gallery.${index}.url`}
                defaultAssetId={item.mediaAssetId}
                defaultFileName={item.mediaAssetName}
                defaultUrl={item.mediaAssetId ? undefined : item.source}
              />
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1.5 block text-xs font-semibold text-[#52606d]">
                    {copy.altText}
                  </span>
                  <input
                    name={`gallery.${index}.alt`}
                    defaultValue={item.alt}
                    maxLength={300}
                    required
                    className={inputClass}
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs font-semibold text-[#52606d]">
                    {copy.caption}
                  </span>
                  <input
                    name={`gallery.${index}.caption`}
                    defaultValue={item.caption ?? ""}
                    maxLength={1_000}
                    className={inputClass}
                  />
                </label>
              </div>
            </section>
          );
        })}
      </div>

      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={items.length >= 8}
        onClick={() =>
          setItems((current) => [
            ...current,
            {
              key: `${instanceId}-${current.length}-${Date.now()}`,
              alt: "",
              caption: "",
            },
          ])
        }
      >
        <Plus className="size-4" />
        {copy.addImage}
      </Button>
    </div>
  );
}
