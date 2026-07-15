"use client";

import { LoaderCircle, MessageCircle, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  CommunityFeed,
  type CommunityMentionCandidateView,
  type CommunityProfileCompletionView,
  type CommunitySpaceView,
} from "@/components/academy/community-feed";
import {
  COMMUNITY_FOLLOW_CHANGED_EVENT,
} from "@/components/academy/community-follow-context";
import { Button } from "@/components/ui/button";
import type {
  CommunityFeedMode,
  CommunityFeedPageDto,
  CommunityFeedPostDto,
} from "@/lib/community-feed";
import type { AppLocale } from "@/lib/i18n/model";
import { getMainPageDictionary } from "@/lib/i18n/main-pages";
import { cn } from "@/lib/utils";

export const communityFeedModes = ["for_you", "following", "latest"] as const;

export type CommunityFeedModeView = CommunityFeedMode;
export type CommunityFeedPageView = CommunityFeedPageDto;

function responsePage(payload: unknown, invalidResponse: string): CommunityFeedPageView {
  const candidate =
    payload && typeof payload === "object" && "data" in payload
      ? (payload as { data: unknown }).data
      : payload;
  if (
    !candidate ||
    typeof candidate !== "object" ||
    !Array.isArray((candidate as { items?: unknown }).items)
  ) {
    throw new Error(invalidResponse);
  }
  return candidate as CommunityFeedPageView;
}

function mergeUniquePosts(
  current: CommunityFeedPostDto[],
  incoming: CommunityFeedPostDto[],
) {
  const byId = new Map(current.map((post) => [post.id, post]));
  for (const post of incoming) byId.set(post.id, post);
  return [...byId.values()];
}

function FeedSkeleton({ label }: { label: string }) {
  return (
    <div className="space-y-4" aria-label={label} aria-busy="true">
      {[0, 1, 2].map((item) => (
        <div key={item} className="panel min-h-44 animate-pulse p-5">
          <div className="flex items-center gap-3">
            <div className="size-11 rounded-full bg-[#e5eaed]" />
            <div className="space-y-2">
              <div className="h-3 w-36 rounded bg-[#e5eaed]" />
              <div className="h-2.5 w-24 rounded bg-[#edf0f2]" />
            </div>
          </div>
          <div className="mt-5 h-3 w-4/5 rounded bg-[#e5eaed]" />
          <div className="mt-2 h-3 w-3/5 rounded bg-[#edf0f2]" />
        </div>
      ))}
    </div>
  );
}

export function PersonalizedCommunityFeed({
  initialPage,
  spaces,
  currentUserId,
  mentionCandidates,
  profileCompletion,
  locale,
}: {
  initialPage: CommunityFeedPageView;
  spaces: CommunitySpaceView[];
  currentUserId: string;
  mentionCandidates: CommunityMentionCandidateView[];
  profileCompletion?: CommunityProfileCompletionView;
  locale: AppLocale;
}) {
  return (
    <PersonalizedCommunityFeedState
      initialPage={initialPage}
      spaces={spaces}
      currentUserId={currentUserId}
      mentionCandidates={mentionCandidates}
      profileCompletion={profileCompletion}
      locale={locale}
    />
  );
}

function PersonalizedCommunityFeedState({
  initialPage,
  spaces,
  currentUserId,
  mentionCandidates,
  profileCompletion,
  locale,
}: {
  initialPage: CommunityFeedPageView;
  spaces: CommunitySpaceView[];
  currentUserId: string;
  mentionCandidates: CommunityMentionCandidateView[];
  profileCompletion?: CommunityProfileCompletionView;
  locale: AppLocale;
}) {
  const copy = getMainPageDictionary(locale).academy.communityUi;
  const [mode, setMode] = useState<CommunityFeedModeView>(initialPage.mode);
  const [page, setPage] = useState<CommunityFeedPageView | null>(initialPage);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [appendError, setAppendError] = useState<string | null>(null);
  const requestController = useRef<AbortController | null>(null);
  const [serverPageAsOf, setServerPageAsOf] = useState(initialPage.asOf);

  if (serverPageAsOf !== initialPage.asOf) {
    setServerPageAsOf(initialPage.asOf);
    if (mode === initialPage.mode) {
      setPage(initialPage);
      setLoading(false);
      setLoadingMore(false);
      setError(null);
      setAppendError(null);
    }
  }

  const loadPage = useCallback(
    async (
      requestedMode: CommunityFeedModeView,
      cursor: string | null,
      append: boolean,
    ) => {
      requestController.current?.abort();
      const controller = new AbortController();
      requestController.current = controller;
      setError(null);
      setAppendError(null);
      if (append) setLoadingMore(true);
      else setLoading(true);
      let shouldAppend = append;
      try {
        const query = new URLSearchParams({ mode: requestedMode, limit: "20" });
        if (cursor) query.set("cursor", cursor);
        let response = await fetch(`/api/community/feed?${query.toString()}`, {
          credentials: "same-origin",
          cache: "no-store",
          signal: controller.signal,
        });
        if (response.status === 422 && cursor) {
          shouldAppend = false;
          query.delete("cursor");
          setLoadingMore(false);
          setLoading(true);
          response = await fetch(`/api/community/feed?${query.toString()}`, {
            credentials: "same-origin",
            cache: "no-store",
            signal: controller.signal,
          });
        }
        if (!response.ok) {
          throw new Error(copy.personalized.loadFailed);
        }
        const incoming = responsePage(
          await response.json(),
          copy.personalized.invalidResponse,
        );
        if (controller.signal.aborted) return;
        setPage((current) => ({
          ...incoming,
          items:
            shouldAppend && current
              ? mergeUniquePosts(current.items, incoming.items)
              : incoming.items,
        }));
      } catch (unknownError) {
        if (
          !(unknownError instanceof DOMException && unknownError.name === "AbortError")
        ) {
          if (shouldAppend) setAppendError(copy.personalized.loadFailed);
          else setError(copy.personalized.loadFailed);
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [copy.personalized.invalidResponse, copy.personalized.loadFailed],
  );

  useEffect(() => () => requestController.current?.abort(), []);

  useEffect(() => {
    if (mode === initialPage.mode) return;
    const refreshTimer = window.setTimeout(() => {
      void loadPage(mode, null, false);
    }, 0);
    return () => window.clearTimeout(refreshTimer);
  }, [initialPage.asOf, initialPage.mode, loadPage, mode]);

  useEffect(() => {
    function refreshFollowingFeed() {
      if (mode !== "latest") void loadPage(mode, null, false);
    }
    window.addEventListener(
      COMMUNITY_FOLLOW_CHANGED_EVENT,
      refreshFollowingFeed,
    );
    return () =>
      window.removeEventListener(
        COMMUNITY_FOLLOW_CHANGED_EVENT,
        refreshFollowingFeed,
      );
  }, [loadPage, mode]);

  function selectMode(nextMode: CommunityFeedModeView) {
    if (nextMode === mode) return;
    requestController.current?.abort();
    setPage(null);
    setError(null);
    setAppendError(null);
    setMode(nextMode);
    void loadPage(nextMode, null, false);
  }

  const items = page?.items ?? [];

  return (
    <section className="min-w-0" aria-labelledby="personal-community-feed-heading">
      <h2 id="personal-community-feed-heading" className="sr-only">
        {copy.personalized.heading}
      </h2>
      <div
        className="grid grid-cols-3 rounded-md border border-[#dfe4e8] bg-[#f5f7f8] p-1"
        role="group"
        aria-label={copy.personalized.modeLabel}
      >
        {communityFeedModes.map((modeOption) => (
          <button
            key={modeOption}
            type="button"
            onClick={() => selectMode(modeOption)}
            aria-pressed={mode === modeOption}
            className={cn(
              "focus-ring min-w-0 rounded px-2 py-2 text-xs font-semibold sm:px-4",
              mode === modeOption
                ? "bg-white text-[#17324d] shadow-sm"
                : "text-[#6f7b85] hover:text-[#354555]",
            )}
          >
            <span className="block truncate">
              {copy.personalized.modes[modeOption]}
            </span>
          </button>
        ))}
      </div>

      <div className="mt-4 min-h-[420px]" aria-live="polite">
        {loading ? <FeedSkeleton label={copy.personalized.loadingLabel} /> : null}
        {!loading && error ? (
          <div className="panel px-5 py-10 text-center">
            <RefreshCw className="mx-auto size-5 text-[#a94339]" />
            <p className="mt-2 text-sm font-semibold text-[#455463]">{error}</p>
            <Button
              variant="secondary"
              size="sm"
              className="mt-4"
              onClick={() => void loadPage(mode, null, false)}
            >
              <RefreshCw className="size-3.5" /> {copy.personalized.reload}
            </Button>
          </div>
        ) : null}
        {!loading && !error && items.length ? (
          <CommunityFeed
            key={mode}
            posts={items}
            spaces={spaces}
            currentUserId={currentUserId}
            mentionCandidates={mentionCandidates}
            profileCompletion={profileCompletion}
            locale={locale}
          />
        ) : null}
        {!loading && !error && !items.length ? (
          <div className="panel px-5 py-10 text-center">
            <MessageCircle className="mx-auto size-5 text-[#91a0aa]" />
            <p className="mt-2 text-sm font-semibold text-[#455463]">
              {copy.personalized.empty[mode]}
            </p>
          </div>
        ) : null}
      </div>

      {!loading && !error && page?.hasMore && page.nextCursor ? (
        <div className="mt-4 flex flex-col items-center gap-2">
          {appendError ? (
            <p className="text-center text-xs text-[#a94339]">{appendError}</p>
          ) : null}
          <Button
            variant="secondary"
            disabled={loadingMore}
            onClick={() =>
              void loadPage(
                mode,
                appendError ? null : page.nextCursor,
                !appendError,
              )
            }
          >
            {loadingMore ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : null}
            {loadingMore
              ? copy.personalized.loading
              : appendError
                ? copy.common.retry
                : copy.personalized.loadMore}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
