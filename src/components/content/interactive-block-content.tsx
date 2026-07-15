"use client";

import {
  ArrowRight,
  ArrowUpRight,
  Check,
  Copy,
  Download,
  Images,
  Quote,
} from "lucide-react";
import { useState } from "react";

import { ImageLightbox } from "@/components/content/image-lightbox";
import { buttonClassName } from "@/components/ui/button";
import { getImageLightboxCopy } from "@/lib/i18n/image-lightbox";
import type { AppLocale } from "@/lib/i18n/model";
import { getStructuredContentCopy } from "@/lib/i18n/structured-content";
import { isExternalRichTextHref } from "@/lib/rich-text/document";
import {
  sanitizeGalleryDocument,
  sanitizeLinkButtonDocument,
} from "@/lib/content-blocks/interactive-documents";
import { cn } from "@/lib/utils";
import {
  sanitizeAccordionDocument,
  sanitizeCalloutDocument,
  sanitizeCodeDocument,
  sanitizeColumnsDocument,
  sanitizeDividerDocument,
  sanitizeDownloadDocument,
  sanitizeQuoteDocument,
  sanitizeTableDocument,
  sanitizeTabsDocument,
} from "@/lib/content-blocks/layout-documents";

export function LinkButtonContent({
  document,
  compact = false,
}: {
  document: unknown;
  compact?: boolean;
}) {
  const button = sanitizeLinkButtonDocument(document);
  if (!button) return null;
  const external = isExternalRichTextHref(button.href);
  const Icon = external ? ArrowUpRight : ArrowRight;
  const securityProps = external
    ? {
        target: "_blank" as const,
        rel: "noopener noreferrer nofollow",
        referrerPolicy: "no-referrer" as const,
      }
    : {};

  if (button.variant === "link") {
    return (
      <a
        href={button.href}
        {...securityProps}
        className="focus-ring inline-flex min-h-9 items-center gap-2 rounded-sm font-semibold text-[#276b88] underline decoration-[#8ab5c5] underline-offset-4 hover:text-[#174d67]"
      >
        {button.label}
        <Icon className="size-4" />
      </a>
    );
  }

  return (
    <a
      href={button.href}
      {...securityProps}
      className={buttonClassName({
        variant: button.variant,
        size: compact ? "sm" : "md",
      })}
    >
      {button.label}
      <Icon className="size-4" />
    </a>
  );
}

export function GalleryContent({
  document,
  locale,
  compact = false,
  showEmpty = false,
}: {
  document: unknown;
  locale: AppLocale;
  compact?: boolean;
  showEmpty?: boolean;
}) {
  const [activeImageIndex, setActiveImageIndex] = useState<number | null>(null);
  const copy = getImageLightboxCopy(locale);
  const gallery = sanitizeGalleryDocument(document);
  if (!gallery.items.length) {
    return showEmpty ? (
      <div className="grid min-h-36 place-items-center rounded-md border border-dashed border-[#cbd5dc] bg-[#f8fafb] text-center">
        <div>
          <Images className="mx-auto size-5 text-[#7a8690]" />
          <p className="mt-2 text-xs font-semibold text-[#66727f]">
            {copy.emptyGallery}
          </p>
        </div>
      </div>
    ) : null;
  }

  return (
    <section aria-label={copy.galleryLabel}>
      <ul
        className={cn(
          "grid list-none gap-3 p-0",
          gallery.items.length > 1 && "sm:grid-cols-2",
          compact && "gap-2",
        )}
      >
        {gallery.items.map((item, index) => {
          const featured = gallery.layout === "featured" && index === 0;
          return (
            <li
              key={`${item.source}-${index}`}
              className={cn(
                featured && gallery.items.length > 1 && "sm:col-span-2",
              )}
            >
              <figure className="overflow-hidden rounded-md border border-[#e1e5e8] bg-[#f8fafb]">
                <button
                  type="button"
                  onClick={() => setActiveImageIndex(index)}
                  aria-label={copy.openImage(item.alt)}
                  className="focus-ring group block w-full overflow-hidden text-left"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={item.source}
                    alt={item.alt}
                    loading="lazy"
                    decoding="async"
                    className={cn(
                      "w-full object-cover transition-transform group-hover:scale-[1.01]",
                      featured ? "aspect-[16/7]" : "aspect-[4/3]",
                      compact && (featured ? "max-h-72" : "max-h-56"),
                    )}
                  />
                </button>
                {item.caption ? (
                  <figcaption className="px-3 py-2 text-xs leading-5 text-[#66727f]">
                    {item.caption}
                  </figcaption>
                ) : null}
              </figure>
            </li>
          );
        })}
      </ul>
      {activeImageIndex !== null ? (
        <ImageLightbox
          items={gallery.items.map((item, index) => ({
            id: `${item.source}-${index}`,
            src: item.source,
            alt: item.alt,
            caption: item.caption,
            originalHref: item.source,
          }))}
          activeIndex={activeImageIndex}
          locale={locale}
          onActiveIndexChange={setActiveImageIndex}
          onClose={() => setActiveImageIndex(null)}
        />
      ) : null}
    </section>
  );
}

export function StructuredBlockContent({
  type,
  document,
  locale,
  compact = false,
  showEmpty = false,
}: {
  type: string;
  document: unknown;
  locale: AppLocale;
  compact?: boolean;
  showEmpty?: boolean;
}) {
  const copy = getStructuredContentCopy(locale);
  const [codeCopied, setCodeCopied] = useState(false);
  const callout = type === "callout" ? sanitizeCalloutDocument(document) : null;
  const quote = type === "quote" ? sanitizeQuoteDocument(document) : null;
  const divider = type === "divider" ? sanitizeDividerDocument(document) : null;
  const accordion =
    type === "accordion" ? sanitizeAccordionDocument(document) : null;
  const tabs = type === "tabs" ? sanitizeTabsDocument(document) : null;
  const columns = type === "columns" ? sanitizeColumnsDocument(document) : null;
  const download =
    type === "download" ? sanitizeDownloadDocument(document) : null;
  const code = type === "code" ? sanitizeCodeDocument(document) : null;
  const table = type === "table" ? sanitizeTableDocument(document) : null;

  if (callout) {
    const tones = {
      info: "border-[#3d7fa3] bg-[#eef7fb] text-[#244e66]",
      success: "border-[#2b9188] bg-[#edf8f6] text-[#176f68]",
      warning: "border-[#d6a536] bg-[#fbf6e7] text-[#6f5617]",
      danger: "border-[#c95b4f] bg-[#fdf0ee] text-[#753b35]",
    } as const;
    return (
      <aside
        className={cn(
          "rounded-md border-l-4 p-5",
          tones[callout.tone],
          compact && "p-4",
        )}
      >
        {callout.heading ? (
          <p className="text-sm font-bold">{callout.heading}</p>
        ) : null}
        <p
          className={cn(
            "whitespace-pre-wrap text-sm leading-7",
            callout.heading && "mt-1",
          )}
        >
          {callout.body}
        </p>
      </aside>
    );
  }
  if (quote) {
    const attribution = quote.attribution ? (
      quote.sourceUrl ? (
        <a
          href={quote.sourceUrl}
          target="_blank"
          rel="noopener noreferrer nofollow"
          referrerPolicy="no-referrer"
          className="underline underline-offset-4"
        >
          {quote.attribution}
        </a>
      ) : (
        quote.attribution
      )
    ) : null;
    return (
      <figure
        className={cn("border-l-2 border-[#8ab5c5] pl-5", compact && "pl-4")}
      >
        <Quote className="mb-2 size-5 text-[#3d7fa3]" aria-hidden="true" />
        <blockquote className="whitespace-pre-wrap text-base leading-8 text-[#354555]">
          {quote.quote}
        </blockquote>
        {attribution ? (
          <figcaption className="mt-2 text-xs font-semibold text-[#66727f]">
            {attribution}
          </figcaption>
        ) : null}
      </figure>
    );
  }
  if (divider) {
    return (
      <hr
        className={cn(
          "border-0 border-t border-[#cbd5dc]",
          divider.style === "dashed" && "border-dashed",
          divider.style === "dotted" && "border-dotted",
          divider.spacing === "compact"
            ? "my-2"
            : divider.spacing === "wide"
              ? "my-10"
              : "my-5",
        )}
      />
    );
  }
  if (accordion) {
    return (
      <div className="divide-y divide-[#dce3e8] border-y border-[#dce3e8]">
        {accordion.items.map((item) => (
          <details
            key={item.id}
            open={item.openByDefault}
            className="group py-1"
          >
            <summary className="focus-ring cursor-pointer list-none px-2 py-3 text-sm font-bold text-[#354555] marker:hidden">
              {item.title}
            </summary>
            <p className="whitespace-pre-wrap px-2 pb-4 text-sm leading-7 text-[#5f6f7b]">
              {item.body}
            </p>
          </details>
        ))}
      </div>
    );
  }
  if (tabs) return <TabsContent document={tabs} label={copy.tabsLabel} />;
  if (columns) {
    return (
      <div
        className={cn(
          "grid gap-5",
          columns.columns.length === 2 ? "md:grid-cols-2" : "md:grid-cols-3",
          columns.layout === "sidebar_left" &&
            columns.columns.length === 2 &&
            "md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]",
          columns.layout === "sidebar_right" &&
            columns.columns.length === 2 &&
            "md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]",
        )}
      >
        {columns.columns.map((column) => (
          <section key={column.id} className="min-w-0">
            {column.heading ? (
              <h3 className="mb-2 text-sm font-bold text-[#354555]">
                {column.heading}
              </h3>
            ) : null}
            <p className="whitespace-pre-wrap text-sm leading-7 text-[#5f6f7b]">
              {column.body}
            </p>
          </section>
        ))}
      </div>
    );
  }
  if (download) {
    return (
      <a
        href={`/api/media-assets/${download.mediaAssetId}/download`}
        className="focus-ring flex items-center gap-4 rounded-md border border-[#cbd7e2] bg-[#f7f9fb] p-4 hover:bg-[#eef3f7]"
        download={download.fileName}
      >
        <span className="grid size-10 shrink-0 place-items-center rounded-md bg-white text-[#365f8d] shadow-sm">
          <Download className="size-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold text-[#354555]">
            {download.label}
          </span>
          <span className="mt-0.5 block truncate text-xs text-[#71808b]">
            {download.description || download.fileName}
          </span>
        </span>
      </a>
    );
  }
  if (code) {
    const lines = code.code.split("\n");
    return (
      <section className="overflow-hidden rounded-md border border-[#263746] bg-[#101820] text-[#e7eef2]">
        <header className="flex min-h-10 items-center justify-between gap-3 border-b border-white/10 px-3">
          <span className="truncate font-mono text-[11px] font-semibold text-[#a8bdc8]">
            {copy.codeLanguage(code.language)}
          </span>
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(code.code).then(() => {
                setCodeCopied(true);
                window.setTimeout(() => setCodeCopied(false), 1_500);
              }).catch(() => undefined);
            }}
            className="focus-ring inline-flex min-h-8 items-center gap-2 rounded px-2 text-xs font-semibold text-[#d8e4e9] hover:bg-white/10"
          >
            {codeCopied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            {codeCopied ? copy.copied : copy.copyCode}
          </button>
        </header>
        <pre
          className={cn(
            "overflow-x-auto p-4 font-mono text-xs leading-6",
            code.wrap && "whitespace-pre-wrap break-words",
          )}
        >
          <code>
            {code.lineNumbers
              ? lines.map((line, index) => (
                  <span key={index} className="grid grid-cols-[3ch_minmax(0,1fr)] gap-4">
                    <span aria-hidden="true" className="select-none text-right text-[#718894]">{index + 1}</span>
                    <span>{line || " "}</span>
                  </span>
                ))
              : code.code}
          </code>
        </pre>
      </section>
    );
  }
  if (table) {
    return (
      <div className="overflow-x-auto rounded-md border border-[#dce3e8]">
        <table className="w-full min-w-[32rem] border-collapse text-left text-sm text-[#354555]">
          {table.caption ? (
            <caption className="border-b border-[#dce3e8] bg-[#f8fafb] px-4 py-3 text-left text-sm font-bold">
              {table.caption}
            </caption>
          ) : null}
          <thead className="bg-[#edf2f5]">
            <tr>
              {table.headers.map((header, index) => (
                <th key={`${index}-${header}`} scope="col" className="border-b border-[#cbd5dc] px-4 py-3 font-bold">
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, rowIndex) => (
              <tr key={rowIndex} className={table.striped && rowIndex % 2 === 1 ? "bg-[#f8fafb]" : undefined}>
                {row.map((cell, columnIndex) => (
                  <td key={columnIndex} className="border-b border-[#e5e9ec] px-4 py-3 align-top last:border-r-0">
                    <span className="whitespace-pre-wrap">{cell}</span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  return showEmpty ? (
    <div className="grid min-h-20 place-items-center rounded-md border border-dashed border-[#cbd5dc] bg-[#f8fafb] text-xs font-semibold text-[#66727f]">
      {copy.incomplete}
    </div>
  ) : null;
}

function TabsContent({
  document,
  label,
}: {
  document: NonNullable<ReturnType<typeof sanitizeTabsDocument>>;
  label: string;
}) {
  const [activeId, setActiveId] = useState(document.defaultTabId);
  const active =
    document.tabs.find((tab) => tab.id === activeId) ?? document.tabs[0];
  return (
    <section>
      <div
        role="tablist"
        aria-label={label}
        className="flex gap-1 overflow-x-auto border-b border-[#dce3e8]"
      >
        {document.tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={tab.id === active.id}
            aria-controls={`tab-panel-${tab.id}`}
            onClick={() => setActiveId(tab.id)}
            className={cn(
              "focus-ring min-h-10 shrink-0 border-b-2 px-3 text-sm font-bold",
              tab.id === active.id
                ? "border-[#2b9188] text-[#176f68]"
                : "border-transparent text-[#66727f]",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div
        id={`tab-panel-${active.id}`}
        role="tabpanel"
        className="whitespace-pre-wrap px-2 py-4 text-sm leading-7 text-[#5f6f7b]"
      >
        {active.body}
      </div>
    </section>
  );
}
