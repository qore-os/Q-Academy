"use client";

import { ChevronLeft, ChevronRight, ExternalLink, X } from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

import { getImageLightboxCopy } from "@/lib/i18n/image-lightbox";
import { intlLocale, type AppLocale } from "@/lib/i18n/model";
import { cn } from "@/lib/utils";

export type ImageLightboxItem = Readonly<{
  id: string;
  src: string;
  alt: string;
  caption?: string | null;
  originalHref?: string;
}>;

const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function visibleFocusableElements(container: HTMLElement) {
  return [...container.querySelectorAll<HTMLElement>(focusableSelector)].filter(
    (element) =>
      !element.hasAttribute("hidden") &&
      element.getAttribute("aria-hidden") !== "true" &&
      element.getClientRects().length > 0,
  );
}

export function ImageLightbox({
  items,
  activeIndex,
  locale,
  onActiveIndexChange,
  onClose,
}: {
  items: readonly ImageLightboxItem[];
  activeIndex: number;
  locale: AppLocale;
  onActiveIndexChange: (index: number) => void;
  onClose: () => void;
}) {
  const copy = getImageLightboxCopy(locale);
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const currentIndex = Math.min(
    Math.max(activeIndex, 0),
    Math.max(items.length - 1, 0),
  );
  const current = items[currentIndex];
  const numberFormat = new Intl.NumberFormat(intlLocale(locale));
  const position = copy.position(
    numberFormat.format(currentIndex + 1),
    numberFormat.format(items.length),
  );

  useEffect(() => {
    previouslyFocusedRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
      previouslyFocusedRef.current?.focus();
    };
  }, []);

  useEffect(() => {
    dialogRef.current
      ?.querySelector<HTMLElement>(
        `[data-lightbox-thumbnail="${currentIndex}"]`,
      )
      ?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [currentIndex]);

  if (!current) return null;

  function selectRelative(delta: number) {
    if (items.length < 2) return;
    onActiveIndexChange((currentIndex + delta + items.length) % items.length);
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      selectRelative(-1);
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      selectRelative(1);
      return;
    }
    if (event.key !== "Tab" || !dialogRef.current) return;

    const focusable = visibleFocusableElements(dialogRef.current);
    if (!focusable.length) {
      event.preventDefault();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      className="fixed inset-0 z-[100] flex min-w-0 items-center justify-center overflow-hidden bg-[#0b141d]/90 p-2 sm:p-4"
      onKeyDown={handleKeyDown}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="grid h-[min(96dvh,960px)] max-h-[calc(100dvh-1rem)] w-full max-w-6xl min-w-0 grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden rounded-md border border-white/15 bg-[#101820] shadow-2xl sm:max-h-[calc(100dvh-2rem)]">
        <header className="flex min-w-0 items-center gap-2 border-b border-white/10 px-2 py-2 sm:px-3">
          <div className="min-w-0 flex-1 px-1">
            <h2 id={titleId} className="truncate text-sm font-bold text-white">
              {copy.dialogTitle}
            </h2>
            <p id={descriptionId} className="truncate text-xs text-white/65">
              {position} · {current.alt}
            </p>
          </div>
          <a
            href={current.originalHref ?? current.src}
            target="_blank"
            rel="noopener noreferrer"
            className="focus-ring inline-flex size-9 shrink-0 items-center justify-center rounded-md text-white/80 hover:bg-white/10 hover:text-white sm:w-auto sm:px-3"
            aria-label={copy.openOriginal}
            title={copy.openOriginal}
          >
            <ExternalLink className="size-4" />
            <span className="ml-2 hidden text-xs font-semibold sm:inline">
              {copy.openOriginal}
            </span>
          </a>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className="focus-ring grid size-9 shrink-0 place-items-center rounded-md text-white/80 hover:bg-white/10 hover:text-white"
            aria-label={copy.close}
            title={copy.close}
          >
            <X className="size-5" />
          </button>
        </header>

        <div className="relative min-h-0 min-w-0 overflow-hidden bg-black/45">
          <figure className="grid h-full min-h-0 min-w-0 grid-rows-[minmax(0,1fr)_auto]">
            <div className="flex min-h-0 min-w-0 items-center justify-center overflow-auto p-2 sm:p-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                key={current.id}
                src={current.src}
                alt={current.alt}
                className="block max-h-full max-w-full object-contain"
              />
            </div>
            {current.caption ? (
              <figcaption className="max-h-24 overflow-y-auto border-t border-white/10 bg-[#101820] px-4 py-2 text-xs leading-5 text-white/75">
                {current.caption}
              </figcaption>
            ) : null}
          </figure>

          {items.length > 1 ? (
            <>
              <button
                type="button"
                onClick={() => selectRelative(-1)}
                className="focus-ring absolute left-2 top-1/2 grid size-10 -translate-y-1/2 place-items-center rounded-md bg-[#101820]/85 text-white shadow-lg hover:bg-[#101820] sm:left-3"
                aria-label={copy.previous}
                title={copy.previous}
              >
                <ChevronLeft className="size-5" />
              </button>
              <button
                type="button"
                onClick={() => selectRelative(1)}
                className="focus-ring absolute right-2 top-1/2 grid size-10 -translate-y-1/2 place-items-center rounded-md bg-[#101820]/85 text-white shadow-lg hover:bg-[#101820] sm:right-3"
                aria-label={copy.next}
                title={copy.next}
              >
                <ChevronRight className="size-5" />
              </button>
            </>
          ) : null}
        </div>

        <div className="min-w-0 border-t border-white/10 bg-[#101820] px-2 py-2 sm:px-3">
          <ul
            className="flex min-w-0 list-none gap-2 overflow-x-auto p-0 pb-1"
            aria-label={copy.thumbnails}
          >
            {items.map((item, index) => {
              const itemPosition = copy.position(
                numberFormat.format(index + 1),
                numberFormat.format(items.length),
              );
              return (
                <li key={item.id} className="shrink-0">
                  <button
                    type="button"
                    data-lightbox-thumbnail={index}
                    onClick={() => onActiveIndexChange(index)}
                    aria-current={index === currentIndex ? "true" : undefined}
                    aria-label={copy.selectImage(itemPosition, item.alt)}
                    title={item.alt}
                    className={cn(
                      "focus-ring relative block h-14 w-20 overflow-hidden rounded-md border bg-black/40",
                      index === currentIndex
                        ? "border-[#5fd2c7] ring-2 ring-[#5fd2c7]/45"
                        : "border-white/20 opacity-70 hover:opacity-100",
                    )}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={item.src}
                      alt=""
                      loading="lazy"
                      className="size-full object-cover"
                    />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}
