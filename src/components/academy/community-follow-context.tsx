"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { toast } from "sonner";
import { getMainPageDictionary } from "@/lib/i18n/main-pages";
import type { AppLocale } from "@/lib/i18n/model";

export type CommunityFollowTargetType = "author" | "space";
export const COMMUNITY_FOLLOW_CHANGED_EVENT = "community-follow-changed";

type FollowSeed = {
  targetType: CommunityFollowTargetType;
  targetId: string;
  following: boolean;
};

type CommunityFollowContextValue = {
  resolved: boolean;
  revision: number;
  isFollowing: (
    targetType: CommunityFollowTargetType,
    targetId: string,
    fallback?: boolean,
  ) => boolean;
  isPending: (targetType: CommunityFollowTargetType, targetId: string) => boolean;
  toggle: (
    targetType: CommunityFollowTargetType,
    targetId: string,
    notify?: boolean,
  ) => Promise<void>;
};

const CommunityFollowContext = createContext<CommunityFollowContextValue | null>(
  null,
);

function targetKey(targetType: CommunityFollowTargetType, targetId: string) {
  return `${targetType}:${targetId}`;
}

function followRows(payload: unknown) {
  if (!payload || typeof payload !== "object") return [];
  const envelope = payload as {
    data?: unknown;
    items?: unknown;
  };
  const candidate = Array.isArray(envelope.data)
    ? envelope.data
    : envelope.data && typeof envelope.data === "object"
      ? (envelope.data as { items?: unknown }).items
      : envelope.items;
  if (!Array.isArray(candidate)) return [];
  return candidate.filter(
    (
      item,
    ): item is {
      targetType: CommunityFollowTargetType;
      targetId: string;
    } =>
      Boolean(item) &&
      typeof item === "object" &&
      ((item as { targetType?: unknown }).targetType === "author" ||
        (item as { targetType?: unknown }).targetType === "space") &&
      typeof (item as { targetId?: unknown }).targetId === "string",
  );
}

export function CommunityFollowProvider({
  initial,
  locale,
  children,
}: {
  initial: FollowSeed[];
  locale: AppLocale;
  children: React.ReactNode;
}) {
  const copy = getMainPageDictionary(locale).academy.communityUi;
  const [following, setFollowing] = useState<Map<string, boolean>>(
    () =>
      new Map(
        initial.map((entry) => [
          targetKey(entry.targetType, entry.targetId),
          entry.following,
        ]),
      ),
  );
  const [pending, setPending] = useState<Set<string>>(() => new Set());
  const [resolved, setResolved] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/api/community/follows", {
          credentials: "same-origin",
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(copy.follow.loadFailed);
        const rows = followRows(await response.json());
        setFollowing((current) => {
          const next = new Map(current);
          for (const key of next.keys()) next.set(key, false);
          for (const row of rows) {
            next.set(targetKey(row.targetType, row.targetId), true);
          }
          return next;
        });
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          // Seeded post state stays usable when the optional overview request fails.
        }
      } finally {
        if (!controller.signal.aborted) setResolved(true);
      }
    })();
    return () => controller.abort();
  }, [copy.follow.loadFailed]);

  const isFollowing = useCallback(
    (
      targetType: CommunityFollowTargetType,
      targetId: string,
      fallback = false,
    ) => following.get(targetKey(targetType, targetId)) ?? fallback,
    [following],
  );
  const isPending = useCallback(
    (targetType: CommunityFollowTargetType, targetId: string) =>
      pending.has(targetKey(targetType, targetId)),
    [pending],
  );
  const toggle = useCallback(
    async (
      targetType: CommunityFollowTargetType,
      targetId: string,
      notify = false,
    ) => {
      const key = targetKey(targetType, targetId);
      if (pending.has(key)) return;
      const previous = following.get(key) ?? false;
      setFollowing((current) => new Map(current).set(key, !previous));
      setPending((current) => new Set(current).add(key));
      try {
        const response = await fetch(
          `/api/community/follows/${targetType}/${encodeURIComponent(targetId)}`,
          {
            method: previous ? "DELETE" : "PUT",
            credentials: "same-origin",
            headers: previous ? undefined : { "Content-Type": "application/json" },
            body: previous ? undefined : JSON.stringify({ notify }),
          },
        );
        if (!response.ok) throw new Error(copy.follow.saveFollowFailed);
        setRevision((current) => current + 1);
        window.dispatchEvent(new Event(COMMUNITY_FOLLOW_CHANGED_EVENT));
      } catch {
        setFollowing((current) => new Map(current).set(key, previous));
        toast.error(
          previous
            ? copy.follow.saveUnfollowFailed
            : copy.follow.saveFollowFailed,
        );
      } finally {
        setPending((current) => {
          const next = new Set(current);
          next.delete(key);
          return next;
        });
      }
    },
    [
      copy.follow.saveFollowFailed,
      copy.follow.saveUnfollowFailed,
      following,
      pending,
    ],
  );

  const value = useMemo<CommunityFollowContextValue>(
    () => ({ resolved, revision, isFollowing, isPending, toggle }),
    [isFollowing, isPending, resolved, revision, toggle],
  );

  return (
    <CommunityFollowContext.Provider value={value}>
      {children}
    </CommunityFollowContext.Provider>
  );
}

export function useCommunityFollows() {
  const context = useContext(CommunityFollowContext);
  if (!context) {
    throw new Error("useCommunityFollows requires CommunityFollowProvider.");
  }
  return context;
}
