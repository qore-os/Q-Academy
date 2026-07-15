"use client";

import {
  Gauge,
  LoaderCircle,
  Pencil,
  Save,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type {
  CommunityAuthorBoostDto,
  CommunityBoostStrength,
} from "@/lib/community-boosts";
import {
  formatCommunityAdminDateTime,
  getCommunityAdminCopy,
} from "@/lib/i18n/community-admin";
import type { AppLocale } from "@/lib/i18n/model";
import { cn } from "@/lib/utils";

type AuthorOption = {
  id: string;
  firstName: string;
  lastName: string;
};

type BoostView = "active" | "scheduled" | "expired";

function localDateTime(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function defaultForm(referenceTime = Date.now()) {
  const startsAt = new Date(referenceTime);
  startsAt.setSeconds(0, 0);
  const endsAt = new Date(startsAt.getTime() + 7 * 24 * 60 * 60_000);
  return {
    authorId: "",
    strength: "medium" as CommunityBoostStrength,
    startsAt: localDateTime(startsAt),
    endsAt: localDateTime(endsAt),
    reason: "",
  };
}

function boostState(boost: CommunityAuthorBoostDto, now: number): BoostView {
  if (new Date(boost.endsAt).getTime() <= now) return "expired";
  if (new Date(boost.startsAt).getTime() > now) return "scheduled";
  return "active";
}

function responseBoost(payload: unknown, errorMessage: string) {
  const candidate =
    payload && typeof payload === "object" && "data" in payload
      ? (payload as { data: unknown }).data
      : payload;
  if (!candidate || typeof candidate !== "object") {
    throw new Error(errorMessage);
  }
  return candidate as CommunityAuthorBoostDto;
}

function RemoveBoostDialog({
  boost,
  pending,
  onClose,
  onConfirm,
  locale,
}: {
  boost: CommunityAuthorBoostDto;
  pending: boolean;
  onClose: () => void;
  onConfirm: () => void;
  locale: AppLocale;
}) {
  const copy = getCommunityAdminCopy(locale);
  return (
    <div
      className="fixed inset-0 z-[70] grid grid-cols-[minmax(0,1fr)] place-items-center overflow-x-hidden overflow-y-auto bg-[#0f263c]/45 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={copy.boost.removeAria}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !pending) onClose();
      }}
    >
      <div className="my-4 w-full max-w-md overflow-hidden rounded-md bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-[#e8ebee] px-4 py-3 sm:px-5">
          <h2 className="text-base font-bold text-[#243444]">
            {copy.boost.removeTitle}
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="focus-ring grid size-9 shrink-0 place-items-center rounded-md text-[#52606d] hover:bg-[#edf1f3]"
            aria-label={copy.common.closeDialog}
            title={copy.common.close}
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="p-4 sm:p-5">
          <p className="text-sm leading-6 text-[#52606d]">
            {copy.boost.removeDescription(boost.authorName)}
          </p>
          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={onClose} disabled={pending}>
              {copy.common.cancel}
            </Button>
            <Button variant="danger" onClick={onConfirm} disabled={pending}>
              {pending ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <Trash2 className="size-4" />
              )}
              {copy.common.remove}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function CommunityBoostManager({
  initialBoosts,
  authors,
  referenceTime,
  locale,
}: {
  initialBoosts: CommunityAuthorBoostDto[];
  authors: AuthorOption[];
  referenceTime: string;
  locale: AppLocale;
}) {
  const copy = getCommunityAdminCopy(locale);
  const strengthLabels = copy.boost.strengths;
  const viewLabels = copy.boost.views;
  const [boosts, setBoosts] = useState(initialBoosts);
  const [view, setView] = useState<BoostView>("active");
  const [form, setForm] = useState(() =>
    defaultForm(new Date(referenceTime).getTime()),
  );
  const [pending, setPending] = useState(false);
  const [removing, setRemoving] = useState<CommunityAuthorBoostDto | null>(null);
  const [now, setNow] = useState(() => new Date(referenceTime).getTime());

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(interval);
  }, []);

  const visibleBoosts = useMemo(
    () => boosts.filter((boost) => boostState(boost, now) === view),
    [boosts, now, view],
  );

  function editBoost(boost: CommunityAuthorBoostDto) {
    setForm({
      authorId: boost.authorId,
      strength: boost.strength,
      startsAt: localDateTime(new Date(boost.startsAt)),
      endsAt: localDateTime(new Date(boost.endsAt)),
      reason: boost.reason,
    });
    document.getElementById("community-boost-form")?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }

  async function saveBoost() {
    const startsAt = new Date(form.startsAt);
    const endsAt = new Date(form.endsAt);
    const duration = endsAt.getTime() - startsAt.getTime();
    if (!form.authorId) {
      toast.error(copy.boost.selectPersonError);
      return;
    }
    if (
      !Number.isFinite(startsAt.getTime()) ||
      !Number.isFinite(endsAt.getTime()) ||
      duration <= 0 ||
      duration > 90 * 24 * 60 * 60_000
    ) {
      toast.error(copy.boost.periodError);
      return;
    }
    if (form.reason.trim().length < 3) {
      toast.error(copy.boost.reasonError);
      return;
    }
    setPending(true);
    try {
      const response = await fetch(
        `/api/admin/community/boosts/${encodeURIComponent(form.authorId)}`,
        {
          method: "PUT",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            strength: form.strength,
            startsAt: startsAt.toISOString(),
            endsAt: endsAt.toISOString(),
            reason: form.reason.trim(),
          }),
        },
      );
       if (!response.ok) throw new Error(copy.boost.saveFailed);
       const saved = responseBoost(await response.json(), copy.boost.invalidResponse);
      setBoosts((current) => [
        ...current.filter((boost) => boost.authorId !== saved.authorId),
        saved,
      ]);
       const currentTime = new Date(saved.updatedAt).getTime();
      setForm(defaultForm(currentTime));
      setNow(currentTime);
      setView(boostState(saved, currentTime));
       toast.success(copy.boost.saved);
     } catch {
       toast.error(copy.boost.saveFailed);
    } finally {
      setPending(false);
    }
  }

  async function removeBoost() {
    if (!removing) return;
    setPending(true);
    try {
      const response = await fetch(
        `/api/admin/community/boosts/${encodeURIComponent(removing.authorId)}`,
        { method: "DELETE", credentials: "same-origin" },
      );
       if (!response.ok) throw new Error(copy.boost.removeFailed);
      setBoosts((current) =>
        current.filter((boost) => boost.authorId !== removing.authorId),
      );
       if (form.authorId === removing.authorId) setForm(defaultForm(now));
      setRemoving(null);
       toast.success(copy.boost.removed);
     } catch {
       toast.error(copy.boost.removeFailed);
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="panel min-w-0 overflow-hidden" aria-labelledby="community-boost-heading">
      <div className="border-b border-[#e8ebee] px-4 py-4 sm:px-5">
        <h2
          id="community-boost-heading"
          className="flex items-center gap-2 text-sm font-bold text-[#243444]"
        >
          <Sparkles className="size-4 text-[#8d6a12]" />
          {copy.boost.heading}
        </h2>
        <p className="mt-1 text-[11px] leading-5 text-[#71808b]">
          {copy.boost.description}
        </p>
      </div>

      <div id="community-boost-form" className="scroll-mt-24 p-4 sm:p-5">
        <div className="grid min-w-0 gap-4 lg:grid-cols-2 xl:grid-cols-4">
          <label className="min-w-0 xl:col-span-2">
            <span className="mb-1.5 block text-xs font-semibold text-[#52606d]">
              {copy.boost.person}
            </span>
            <select
              value={form.authorId}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  authorId: event.target.value,
                }))
              }
              className="focus-ring h-10 w-full min-w-0 rounded-md border border-[#dce1e5] bg-white px-3 text-sm text-[#354555]"
            >
              <option value="">{copy.boost.selectPerson}</option>
              {authors.map((author) => (
                <option key={author.id} value={author.id}>
                  {author.firstName} {author.lastName}
                </option>
              ))}
            </select>
          </label>
          <label className="min-w-0">
            <span className="mb-1.5 block text-xs font-semibold text-[#52606d]">
              {copy.boost.strength}
            </span>
            <select
              value={form.strength}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  strength: event.target.value as CommunityBoostStrength,
                }))
              }
              className="focus-ring h-10 w-full min-w-0 rounded-md border border-[#dce1e5] bg-white px-3 text-sm text-[#354555]"
            >
              <option value="light">{strengthLabels.light}</option>
              <option value="medium">{strengthLabels.medium}</option>
              <option value="high">{strengthLabels.high}</option>
            </select>
          </label>
          <div className="hidden xl:block" />
          <label className="min-w-0">
            <span className="mb-1.5 block text-xs font-semibold text-[#52606d]">
              {copy.boost.startsAt}
            </span>
            <input
              type="datetime-local"
              value={form.startsAt}
              onChange={(event) =>
                setForm((current) => ({ ...current, startsAt: event.target.value }))
              }
              className="focus-ring h-10 w-full min-w-0 rounded-md border border-[#dce1e5] bg-white px-3 text-sm text-[#354555]"
            />
          </label>
          <label className="min-w-0">
            <span className="mb-1.5 block text-xs font-semibold text-[#52606d]">
              {copy.boost.endsAt}
            </span>
            <input
              type="datetime-local"
              value={form.endsAt}
              onChange={(event) =>
                setForm((current) => ({ ...current, endsAt: event.target.value }))
              }
              className="focus-ring h-10 w-full min-w-0 rounded-md border border-[#dce1e5] bg-white px-3 text-sm text-[#354555]"
            />
          </label>
          <label className="min-w-0 lg:col-span-2">
            <span className="mb-1.5 block text-xs font-semibold text-[#52606d]">
              {copy.boost.internalReason}
            </span>
            <input
              value={form.reason}
              onChange={(event) =>
                setForm((current) => ({ ...current, reason: event.target.value }))
              }
              minLength={3}
              maxLength={500}
              placeholder={copy.boost.reasonPlaceholder}
              className="focus-ring h-10 w-full min-w-0 rounded-md border border-[#dce1e5] bg-white px-3 text-sm text-[#354555]"
            />
          </label>
        </div>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          {form.authorId ? (
            <Button
              variant="secondary"
              onClick={() => setForm(defaultForm(now))}
            >
              <X className="size-4" /> {copy.boost.reset}
            </Button>
          ) : null}
          <Button onClick={() => void saveBoost()} disabled={pending}>
            {pending ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <Save className="size-4" />
            )}
            {copy.common.save}
          </Button>
        </div>
      </div>

      <div className="border-t border-[#e8ebee]">
        <div className="flex min-w-0 gap-1 overflow-x-auto px-4 py-3 sm:px-5">
          {(["active", "scheduled", "expired"] as const).map((option) => {
            const count = boosts.filter(
              (boost) => boostState(boost, now) === option,
            ).length;
            return (
              <button
                key={option}
                type="button"
                onClick={() => setView(option)}
                aria-pressed={view === option}
                className={cn(
                  "focus-ring h-8 shrink-0 rounded px-3 text-xs font-semibold",
                  view === option
                    ? "bg-[#eaf0f4] text-[#17324d]"
                    : "text-[#71808b] hover:bg-[#f4f6f7]",
                )}
              >
                {viewLabels[option]} ({count})
              </button>
            );
          })}
        </div>
        <div className="divide-y divide-[#edf0f2]">
          {visibleBoosts.map((boost) => (
            <div
              key={boost.id}
              className="flex min-w-0 flex-col gap-3 px-4 py-4 sm:px-5 lg:flex-row lg:items-center"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="break-words text-sm font-semibold text-[#354555]">
                    {boost.authorName}
                  </p>
                  <Badge tone={view === "active" ? "teal" : view === "scheduled" ? "blue" : "neutral"}>
                    {viewLabels[boostState(boost, now)]}
                  </Badge>
                  <Badge tone="neutral">
                    <Gauge className="mr-1 size-3" />
                    {strengthLabels[boost.strength]}
                  </Badge>
                </div>
                <p className="mt-1 text-[11px] leading-5 text-[#71808b]">
                  {copy.boost.dateRange(
                    formatCommunityAdminDateTime(boost.startsAt, locale),
                    formatCommunityAdminDateTime(boost.endsAt, locale),
                  )}
                </p>
                <p className="mt-1 break-words text-xs leading-5 text-[#52606d]">
                  {boost.reason}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1 self-end lg:self-auto">
                <button
                  type="button"
                  onClick={() => editBoost(boost)}
                  className="focus-ring grid size-9 place-items-center rounded-md text-[#52606d] hover:bg-[#edf1f3]"
                  aria-label={copy.boost.editNamed(boost.authorName)}
                  title={copy.common.edit}
                >
                  <Pencil className="size-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setRemoving(boost)}
                  className="focus-ring grid size-9 place-items-center rounded-md text-[#a94339] hover:bg-[#fdf0ee]"
                  aria-label={copy.boost.removeNamed(boost.authorName)}
                  title={copy.common.remove}
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            </div>
          ))}
          {!visibleBoosts.length ? (
            <p className="px-5 py-9 text-center text-sm text-[#71808b]">
              {copy.boost.empty(viewLabels[view])}
            </p>
          ) : null}
        </div>
      </div>

      {removing ? (
        <RemoveBoostDialog
          boost={removing}
          pending={pending}
          onClose={() => setRemoving(null)}
          onConfirm={() => void removeBoost()}
          locale={locale}
        />
      ) : null}
    </section>
  );
}
