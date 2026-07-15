"use client";

import { useEffect, useRef, useState } from "react";

import type { CommunityFeedCommentDto } from "@/lib/community-feed";
import { getMainPageDictionary } from "@/lib/i18n/main-pages";
import { DEFAULT_LOCALE, type AppLocale } from "@/lib/i18n/model";

const COMMUNITY_COMMENT_MUTATED_EVENT = "community-comment-mutated";

export type CommunityCommentMutation =
  | Readonly<{
      type: "edited";
      id: string;
      content: string;
      contentFormat: CommunityFeedCommentDto["contentFormat"];
      richText: CommunityFeedCommentDto["richText"];
      moderationVersion: number;
    }>
  | Readonly<{ type: "deleted"; id: string }>
  | Readonly<{ type: "reported"; id: string }>;

export function emitCommunityCommentMutation(
  mutation: CommunityCommentMutation,
) {
  window.dispatchEvent(
    new CustomEvent<CommunityCommentMutation>(COMMUNITY_COMMENT_MUTATED_EVENT, {
      detail: mutation,
    }),
  );
}

type PageState = {
  cursor: string | null;
  hasMore: boolean;
  probed: boolean;
  loading: boolean;
  error: string | null;
};

export type CommunityCommentLoadControl = Readonly<{
  canLoad: boolean;
  loading: boolean;
  error: string | null;
  hasLoaded: boolean;
}>;

type CommentPage = Readonly<{
  items: CommunityFeedCommentDto[];
  nextCursor: string | null;
  hasMore: boolean;
}>;

const idlePage = (hasMore: boolean, probed: boolean): PageState => ({
  cursor: null,
  hasMore,
  probed,
  loading: false,
  error: null,
});

function responsePage(payload: unknown, invalidResponse: string): CommentPage {
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
  return candidate as CommentPage;
}

function mergeComments(
  current: CommunityFeedCommentDto[],
  incoming: CommunityFeedCommentDto[],
  incomingFirst = false,
) {
  const ordered = incomingFirst
    ? [...incoming, ...current]
    : [...current, ...incoming];
  const result: CommunityFeedCommentDto[] = [];
  const indexes = new Map<string, number>();
  for (const comment of ordered) {
    const index = indexes.get(comment.id);
    if (index === undefined) {
      indexes.set(comment.id, result.length);
      result.push(comment);
      continue;
    }
    const existing = result[index];
    result[index] = {
      ...existing,
      ...comment,
      replies: mergeComments(existing.replies, comment.replies),
    };
  }
  return result;
}

function applyMutation(
  comments: CommunityFeedCommentDto[],
  mutation: CommunityCommentMutation,
): CommunityFeedCommentDto[] {
  return comments
    .filter((comment) => mutation.type !== "deleted" || comment.id !== mutation.id)
    .map((comment) => {
      const updated =
        comment.id !== mutation.id
          ? comment
          : mutation.type === "edited"
            ? {
                ...comment,
                content: mutation.content,
                contentFormat: mutation.contentFormat,
                richText: mutation.richText,
                moderationVersion: mutation.moderationVersion,
              }
            : mutation.type === "reported"
              ? { ...comment, reported: true }
              : comment;
      return {
        ...updated,
        replies: applyMutation(updated.replies, mutation),
      };
    });
}

function visibleCount(comments: CommunityFeedCommentDto[]) {
  return comments.reduce(
    (total, comment) => total + 1 + comment.replies.length,
    0,
  );
}

function initialReplyPage(
  comment: CommunityFeedCommentDto,
  probeWhenUnknown = false,
) {
  const replyCount = comment.replyCount;
  if (typeof replyCount === "number") {
    const truncated = replyCount > comment.replies.length;
    return idlePage(truncated, !truncated);
  }
  if (probeWhenUnknown) return idlePage(true, false);
  return idlePage(comment.replies.length >= 2, comment.replies.length < 2);
}

function control(page: PageState): CommunityCommentLoadControl {
  return {
    canLoad: !page.probed || page.hasMore,
    loading: page.loading,
    error: page.error,
    hasLoaded: page.probed,
  };
}

export function useCommunityCommentPagination({
  postId,
  initialComments,
  totalCount,
  locale = DEFAULT_LOCALE,
}: {
  postId: string;
  initialComments: CommunityFeedCommentDto[];
  totalCount: number;
  locale?: AppLocale;
}) {
  const copy = getMainPageDictionary(locale).academy.communityUi;
  const [comments, setComments] = useState(initialComments);
  const [topPage, setTopPage] = useState<PageState>(() => {
    const truncated = visibleCount(initialComments) < totalCount;
    return idlePage(truncated, !truncated);
  });
  const [replyPages, setReplyPages] = useState<Record<string, PageState>>(() =>
    Object.fromEntries(
      initialComments.map((comment) => [
        comment.id,
        initialReplyPage(comment),
      ]),
    ),
  );
  const controllers = useRef(new Map<string, AbortController>());

  useEffect(() => {
    const activeControllers = controllers.current;
    function handleMutation(event: Event) {
      const mutation = (event as CustomEvent<CommunityCommentMutation>).detail;
      if (mutation) {
        setComments((current) => applyMutation(current, mutation));
      }
    }
    window.addEventListener(COMMUNITY_COMMENT_MUTATED_EVENT, handleMutation);
    return () => {
      window.removeEventListener(
        COMMUNITY_COMMENT_MUTATED_EVENT,
        handleMutation,
      );
      for (const controller of activeControllers.values()) controller.abort();
      activeControllers.clear();
    };
  }, []);

  function beginRequest(key: string) {
    controllers.current.get(key)?.abort();
    const controller = new AbortController();
    controllers.current.set(key, controller);
    return controller;
  }

  async function loadMoreComments() {
    if (topPage.loading || (topPage.probed && !topPage.hasMore)) return;
    const controller = beginRequest("top");
    const firstRequest = !topPage.probed;
    setTopPage((current) => ({ ...current, loading: true, error: null }));
    try {
      const query = new URLSearchParams({ limit: "20" });
      if (topPage.cursor) query.set("cursor", topPage.cursor);
      const response = await fetch(
        `/api/community/posts/${encodeURIComponent(postId)}/comments?${query.toString()}`,
        {
          credentials: "same-origin",
          cache: "no-store",
          signal: controller.signal,
        },
      );
      if (!response.ok) throw new Error(copy.comments.loadCommentsFailed);
      const page = responsePage(
        await response.json(),
        copy.comments.invalidResponse,
      );
      if (controller.signal.aborted) return;
      setComments((current) =>
        mergeComments(current, page.items, firstRequest),
      );
      setReplyPages((current) => {
        const next = { ...current };
        for (const comment of page.items) {
          if (!next[comment.id]) {
            next[comment.id] = initialReplyPage(comment, true);
          }
        }
        return next;
      });
      setTopPage({
        cursor: page.nextCursor,
        hasMore: page.hasMore,
        probed: true,
        loading: false,
        error: null,
      });
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        setTopPage((current) => ({
          ...current,
          loading: false,
          error: copy.comments.loadCommentsFailed,
        }));
      }
    }
  }

  async function loadMoreReplies(parentId: string) {
    const replyPage = replyPages[parentId] ?? idlePage(true, false);
    if (replyPage.loading || (replyPage.probed && !replyPage.hasMore)) return;
    const controller = beginRequest(`reply:${parentId}`);
    setReplyPages((current) => ({
      ...current,
      [parentId]: {
        ...(current[parentId] ?? replyPage),
        loading: true,
        error: null,
      },
    }));
    try {
      const query = new URLSearchParams({ limit: "20", parentId });
      if (replyPage.cursor) query.set("cursor", replyPage.cursor);
      const response = await fetch(
        `/api/community/posts/${encodeURIComponent(postId)}/comments?${query.toString()}`,
        {
          credentials: "same-origin",
          cache: "no-store",
          signal: controller.signal,
        },
      );
      if (!response.ok) throw new Error(copy.comments.loadAnswersFailed);
      const page = responsePage(
        await response.json(),
        copy.comments.invalidResponse,
      );
      if (controller.signal.aborted) return;
      setComments((current) =>
        current.map((comment) =>
          comment.id === parentId
            ? {
                ...comment,
                replies: mergeComments(comment.replies, page.items),
              }
            : comment,
        ),
      );
      setReplyPages((current) => ({
        ...current,
        [parentId]: {
          cursor: page.nextCursor,
          hasMore: page.hasMore,
          probed: true,
          loading: false,
          error: null,
        },
      }));
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        setReplyPages((current) => ({
          ...current,
          [parentId]: {
            ...(current[parentId] ?? replyPage),
            loading: false,
            error: copy.comments.loadAnswersFailed,
          },
        }));
      }
    }
  }

  return {
    comments,
    visibleCount: visibleCount(comments),
    commentsControl: control(topPage),
    repliesControl: (parentId: string) =>
      control(replyPages[parentId] ?? idlePage(true, false)),
    loadMoreComments,
    loadMoreReplies,
  };
}
