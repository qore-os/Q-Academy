"use client";

import { useEffect, useState, useTransition, type MouseEvent } from "react";
import {
  CircleAlert,
  CircleCheck,
  Info,
  TriangleAlert,
  X,
} from "lucide-react";
import {
  dismissAnnouncementAction,
  recordAnnouncementClickAction,
  recordAnnouncementImpressionsAction,
} from "@/lib/announcement-actions";
import { AnnouncementContentView } from "@/components/announcement-content";
import type {
  AnnouncementContentBlock,
  AnnouncementContentDocument,
} from "@/lib/announcement-content";
import { getAnnouncementCopy } from "@/lib/i18n/announcements";
import type { AppLocale } from "@/lib/i18n/model";
import { cn } from "@/lib/utils";
import { useHydrated } from "@/lib/use-hydrated";
import { useModalFocus } from "@/lib/use-modal-focus";

type Announcement = {
  id: string;
  title: string;
  body: string;
  tone: string;
  placement: string;
  href: string | null;
  actionLabel: string | null;
  contentDocument: AnnouncementContentDocument;
  dismissible: boolean;
};

const toneStyles = {
  info: {
    container: "border-[#bad0e2] bg-[#f1f6fa] text-[#294d70]",
    icon: Info,
  },
  success: {
    container: "border-[#b8ddd9] bg-[#eef9f7] text-[#176f68]",
    icon: CircleCheck,
  },
  warning: {
    container: "border-[#ead9a8] bg-[#fbf8ed] text-[#6f5617]",
    icon: TriangleAlert,
  },
  critical: {
    container: "border-[#efc3bd] bg-[#fdf2f0] text-[#913c33]",
    icon: CircleAlert,
  },
};

export function AnnouncementLayer({
  announcements,
  locale,
}: {
  announcements: Announcement[];
  locale: AppLocale;
}) {
  const copy = getAnnouncementCopy(locale).layer;
  const hydrated = useHydrated();
  const [hidden, setHidden] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();
  const visible = announcements.filter((entry) => !hidden.includes(entry.id));
  const modal = visible.find((entry) => entry.placement === "modal");
  const banners = visible.filter((entry) => entry.placement === "banner");
  const renderedIds = [...banners.map((entry) => entry.id), ...(modal ? [modal.id] : [])];
  const renderedIdsKey = renderedIds.join(",");

  useEffect(() => {
    if (!renderedIdsKey) return;
    void recordAnnouncementImpressionsAction(renderedIdsKey.split(","));
  }, [renderedIdsKey]);

  const dismiss = (id: string) => {
    startTransition(async () => {
      await dismissAnnouncementAction(id);
      setHidden((current) => [...current, id]);
    });
  };
  const modalDialogRef = useModalFocus<HTMLDivElement>({
    open: Boolean(modal),
    onClose: () => {
      if (modal) dismiss(modal.id);
    },
    closeDisabled: pending || !hydrated || !modal?.dismissible,
  });
  const trackCtaClick = (
    event: MouseEvent<HTMLAnchorElement>,
    announcementId: string,
    block: Extract<AnnouncementContentBlock, { type: "cta" }>,
  ) => {
    const internal = block.href.startsWith("/") && !block.href.startsWith("//");
    if (
      !internal ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      void recordAnnouncementClickAction(announcementId);
      return;
    }
    event.preventDefault();
    startTransition(async () => {
      await recordAnnouncementClickAction(announcementId);
      window.location.assign(block.href);
    });
  };

  return (
    <>
      {banners.length ? (
        <div className="mb-5 space-y-2" aria-label={copy.announcements}>
          {banners.map((announcement) => {
            const tone =
              toneStyles[announcement.tone as keyof typeof toneStyles] ??
              toneStyles.info;
            const Icon = tone.icon;
            return (
              <section
                key={announcement.id}
                className={cn(
                  "flex items-start gap-3 rounded-md border px-4 py-3",
                  tone.container,
                )}
              >
                <Icon className="mt-0.5 size-4 shrink-0" />
                <div className="min-w-0 flex-1">
                  <h2 className="text-sm font-bold">{announcement.title}</h2>
                  <div className="mt-2 text-xs opacity-90">
                    <AnnouncementContentView
                      document={announcement.contentDocument}
                      compact
                      onCtaClick={(event, block) =>
                        trackCtaClick(event, announcement.id, block)
                      }
                    />
                  </div>
                </div>
                {announcement.dismissible ? (
                  <button
                    type="button"
                    disabled={pending || !hydrated}
                    onClick={() => dismiss(announcement.id)}
                    className="focus-ring grid size-8 shrink-0 place-items-center rounded-md hover:bg-black/5"
                    aria-label={copy.closeAnnouncement}
                    title={copy.close}
                  >
                    <X className="size-4" />
                  </button>
                ) : null}
              </section>
            );
          })}
        </div>
      ) : null}

      {modal ? (
        <div
          ref={modalDialogRef}
          tabIndex={-1}
          className="fixed inset-0 z-[75] grid place-items-center bg-[#0f263c]/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby={`announcement-title-${modal.id}`}
        >
          <div className="relative w-full max-w-lg overflow-hidden rounded-md bg-white shadow-2xl">
            <div
              className={cn(
                "h-1.5",
                modal.tone === "critical" && "bg-[#d65345]",
                modal.tone === "warning" && "bg-[#d6a536]",
                modal.tone === "success" && "bg-[#2b9188]",
                modal.tone === "info" && "bg-[#4f7cac]",
              )}
            />
            {modal.dismissible ? (
              <button
                type="button"
                disabled={pending || !hydrated}
                onClick={() => dismiss(modal.id)}
                className="focus-ring absolute right-3 top-4 grid size-9 place-items-center rounded-md text-[#66727f] hover:bg-[#edf1f3]"
                aria-label={copy.closeAnnouncement}
                title={copy.close}
              >
                <X className="size-5" />
              </button>
            ) : null}
            <div className="p-6 pr-14">
              <p className="text-[10px] font-bold uppercase text-[#2b9188]">
                {copy.modalEyebrow}
              </p>
              <h2
                id={`announcement-title-${modal.id}`}
                className="mt-2 text-xl font-bold text-[#243444]"
              >
                {modal.title}
              </h2>
              <div className="mt-4 text-sm text-[#5e6b76]">
                <AnnouncementContentView
                  document={modal.contentDocument}
                  onCtaClick={(event, block) =>
                    trackCtaClick(event, modal.id, block)
                  }
                />
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
