"use client";

import { Bookmark, BookmarkCheck, Hash, Layers3, LoaderCircle, LockKeyhole } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { useCommunityFollows } from "@/components/academy/community-follow-context";
import type { CommunitySpaceType } from "@/lib/community-domain";
import { getMainPageDictionary } from "@/lib/i18n/main-pages";
import type { AppLocale } from "@/lib/i18n/model";

type CommunitySpaceSummary = {
  id: string;
  title: string;
  description: string | null;
  color: string;
  type: CommunitySpaceType;
  accessMode: "open" | "restricted";
  isFollowing?: boolean;
};

type CommunityAreaSummary = {
  id: string;
  title: string;
  spaces: CommunitySpaceSummary[];
};

export function CommunitySpacesSidebar({
  spaces,
  areas,
  locale,
}: {
  spaces: CommunitySpaceSummary[];
  areas?: CommunityAreaSummary[];
  locale: AppLocale;
}) {
  const copy = getMainPageDictionary(locale).academy.communityUi;
  const follows = useCommunityFollows();
  const groups = areas?.length
    ? areas
    : [{ id: "all", title: copy.common.allAreas, spaces }];

  return (
    <section className="panel min-w-0 p-4">
      <h2 className="flex items-center gap-2 text-sm font-bold text-[#243444]">
        <Hash className="size-4 text-[#4f7cac]" />
        {copy.spaces.title}
      </h2>
      <div className="mt-3 space-y-4" data-testid="community-area-groups">
        {groups.map((area) => (
          <div key={area.id} className="min-w-0">
            <h3 className="mb-1.5 flex min-w-0 items-center gap-1.5 px-1 text-[10px] font-bold uppercase text-[#71808b]">
              <Layers3 className="size-3 shrink-0" />
              <span className="truncate">{area.title}</span>
            </h3>
            <div className="space-y-1.5">
        {area.spaces.map((space) => {
          const following = follows.isFollowing(
            "space",
            space.id,
            space.isFollowing,
          );
          const pending = follows.isPending("space", space.id);
          const unresolved = !follows.resolved;
          const actionLabel = following
            ? copy.follow.unfollowSpace(space.title)
            : copy.follow.space(space.title);
          return (
            <div
              key={space.id}
              className="flex min-w-0 items-start gap-2 rounded-md bg-[#f7f9fa] p-2.5"
            >
              <span
                className="mt-1.5 size-2 shrink-0 rounded-full"
                style={{ backgroundColor: space.color }}
              />
              <span className="min-w-0 flex-1">
                <span className="block break-words text-xs font-semibold text-[#455463]">
                  {space.title}
                </span>
                <span className="mt-1 flex flex-wrap items-center gap-1">
                  <Badge tone="neutral">
                    {space.type === "announcement"
                      ? copy.common.announcement
                      : space.type === "discussion"
                        ? copy.common.discussion
                        : copy.common.feed}
                  </Badge>
                  {space.accessMode === "restricted" ? (
                    <Badge tone="blue">
                      <LockKeyhole className="mr-1 size-3" /> {copy.spaces.protected}
                    </Badge>
                  ) : null}
                </span>
                <span className="mt-1 block line-clamp-2 text-[10px] leading-4 text-[#87919a]">
                  {space.description || copy.spaces.noDescription}
                </span>
              </span>
              <button
                type="button"
                onClick={() => void follows.toggle("space", space.id, true)}
                disabled={pending || unresolved}
                className="focus-ring grid size-8 shrink-0 place-items-center rounded-md text-[#52606d] hover:bg-white hover:text-[#17324d] disabled:opacity-50"
                aria-label={actionLabel}
                aria-pressed={following}
                title={actionLabel}
              >
                {pending || unresolved ? (
                  <LoaderCircle className="size-3.5 animate-spin" />
                ) : following ? (
                  <BookmarkCheck className="size-4" />
                ) : (
                  <Bookmark className="size-4" />
                )}
              </button>
            </div>
          );
        })}
            </div>
          </div>
        ))}
        {!spaces.length ? (
          <p className="py-3 text-xs text-[#71808b]">
            {copy.spaces.empty}
          </p>
        ) : null}
      </div>
    </section>
  );
}
