import {
  Award,
  Crown,
  MessageCircleMore,
  MessagesSquare,
  TrendingUp,
  Users,
} from "lucide-react";
import Link from "next/link";
import type { Metadata } from "next";
import { CommunityComposer } from "@/components/academy/community-feed";
import { CommunityFollowProvider } from "@/components/academy/community-follow-context";
import { CommunityOwnSubmissions } from "@/components/academy/community-own-submissions";
import { CommunitySpacesSidebar } from "@/components/academy/community-spaces-sidebar";
import { PersonalizedCommunityFeed } from "@/components/academy/personalized-community-feed";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { requireUser } from "@/lib/auth";
import {
  getCommunityOverviewData,
  getExplainableCommunityFeed,
} from "@/lib/community-feed";
import { getCommunityMentionCandidates } from "@/lib/community-mentions";
import { listCommunityLayout } from "@/lib/community-layout";
import { getOwnCommunityProfileCompletion } from "@/lib/community-public-profile";
import { getOwnCommunityModerationSubmissions } from "@/lib/community-moderation-submissions";
import { getMainPageDictionary } from "@/lib/i18n/main-pages";
import { resolveUserLocale } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const user = await requireUser();
  const locale = await resolveUserLocale(user);
  return {
    title: getMainPageDictionary(locale).academy.communityUi.common.community,
  };
}

export default async function CommunityPage() {
  const user = await requireUser();
  const actor = {
    id: user.id,
    organizationId: user.organizationId,
    role: user.role,
  };
  const [
    overview,
    initialFeed,
    mentionCandidates,
    ownSubmissions,
    layout,
    profileCompletion,
    locale,
  ] =
    await Promise.all([
      getCommunityOverviewData(user.id, user.organizationId),
      getExplainableCommunityFeed({
        actor,
        mode: "for_you",
        limit: 20,
        downloadContext: "session",
      }),
      getCommunityMentionCandidates(user.organizationId),
      getOwnCommunityModerationSubmissions({
        organizationId: user.organizationId,
        authorId: user.id,
      }),
      listCommunityLayout(user.organizationId),
      getOwnCommunityProfileCompletion({
        organizationId: user.organizationId,
        userId: user.id,
      }),
      resolveUserLocale(user),
    ]);
  const copy = getMainPageDictionary(locale).academy.community;
  const ui = getMainPageDictionary(locale).academy.communityUi;
  const availableMentionCandidates = mentionCandidates.filter(
    (candidate) => candidate.id !== user.id,
  );
  const visibleSpacesById = new Map(
    overview.spaces.map((space) => [space.id, space] as const),
  );
  const communityAreas = layout
    .map((area) => ({
      id: area.id,
      title: area.title,
      description: area.description,
      spaces: area.spaces.flatMap((space) => {
        const visible = visibleSpacesById.get(space.id);
        return visible ? [visible] : [];
      }),
    }))
    .filter((area) => area.spaces.length > 0);

  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <section className="overflow-hidden rounded-md bg-[#17324d] px-6 py-7 text-white md:px-8">
        <div className="flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase text-[#63d5ca]">
              {copy.eyebrow}
            </p>
            <h1 className="mt-2 text-3xl font-bold">{copy.title}</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-white/70">
              {copy.description}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <CommunityStat
              icon={<Users className="size-4 text-[#63d5ca]" />}
              value={overview.memberCount}
              label={copy.members}
            />
            <CommunityStat
              icon={<MessageCircleMore className="size-4 text-[#f39486]" />}
              value={overview.totalPostCount}
              label={copy.posts}
            />
            <CommunityStat
              className="hidden sm:block"
              icon={<MessagesSquare className="size-4 text-[#e5c86d]" />}
              value={overview.totalAnswerCount}
              label={copy.answers}
            />
          </div>
        </div>
      </section>

      <CommunityFollowProvider
        locale={locale}
        initial={initialFeed.items.flatMap((post) => [
          {
            targetType: "author" as const,
            targetId: post.authorId,
            following: post.isFollowingAuthor,
          },
          {
            targetType: "space" as const,
            targetId: post.spaceId,
            following: post.isFollowingSpace,
          },
        ])}
      >
        <div className="grid grid-cols-[minmax(0,1fr)] gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0 space-y-4">
            <CommunityComposer
              spaces={overview.spaces}
              currentUser={{
                firstName: user.firstName,
                lastName: user.lastName,
              }}
              mentionCandidates={availableMentionCandidates}
              areas={communityAreas}
              profileCompletion={profileCompletion}
              locale={locale}
            />
            <CommunityOwnSubmissions
              submissions={ownSubmissions}
              locale={locale}
            />
            <PersonalizedCommunityFeed
              initialPage={initialFeed}
              spaces={overview.spaces}
              currentUserId={user.id}
              mentionCandidates={availableMentionCandidates}
              profileCompletion={profileCompletion}
              locale={locale}
            />
          </div>

          <aside className="min-w-0 space-y-4">
            <CommunitySpacesSidebar
              spaces={overview.spaces}
              areas={communityAreas}
              locale={locale}
            />

            <section className="panel p-4">
              <div className="flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-sm font-bold text-[#243444]">
                  <TrendingUp className="size-4 text-[#2b9188]" />
                  {copy.ranking}
                </h2>
                <Badge tone="neutral">{ui.feed.topFive}</Badge>
              </div>
              <div className="mt-3 space-y-3">
                {overview.leaderboard.map((person, index) => (
                  <div key={person.id} className="flex items-center gap-3">
                    <span className="grid size-6 place-items-center text-xs font-bold text-[#7a8690]">
                      {index === 0 ? (
                        <Crown className="size-4 text-[#d6a536]" />
                      ) : (
                        index + 1
                      )}
                    </span>
                    <Link
                      href={`/academy/community/members/${person.id}`}
                      className="focus-ring flex min-w-0 flex-1 items-center gap-3 rounded-md"
                    >
                      <Avatar
                        firstName={person.firstName}
                        lastName={person.lastName}
                        src={person.avatarUrl}
                        size="sm"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-semibold text-[#455463]">
                          {person.firstName} {person.lastName}
                        </span>
                        {person.level ? (
                          <span className="block truncate text-[9px] text-[#7a8690]">
                            {person.level.name}
                          </span>
                        ) : null}
                      </span>
                    </Link>
                    <span className="text-[10px] font-bold text-[#2b9188]">
                      {person.communityPoints} {ui.feed.pointsAbbreviation}
                    </span>
                  </div>
                ))}
                {!overview.leaderboard.length ? (
                  <p className="py-3 text-xs text-[#71808b]">
                    {copy.noPoints}
                  </p>
                ) : null}
              </div>
            </section>

            <section className="panel border-[#d8e5e3] bg-[#f3f8f7] p-4">
              <div className="flex items-center justify-between">
                <Award
                  className="size-5"
                  style={{
                    color: overview.levelProgress.current?.color ?? "#2b9188",
                  }}
                />
                <span className="text-[10px] font-bold text-[#35645f]">
                  {copy.points(overview.currentUser.communityPoints)}
                </span>
              </div>
              <h2 className="mt-3 text-sm font-bold text-[#244a46]">
                {overview.levelProgress.current?.name ?? copy.level}
              </h2>
              <p className="mt-1 text-xs leading-5 text-[#55736f]">
                {overview.levelProgress.next
                    ? copy.nextLevel(
                      overview.levelProgress.pointsRemaining ?? 0,
                      overview.levelProgress.next.name,
                    )
                  : overview.levelProgress.current
                    ? copy.highestLevel
                    : copy.levelUnavailable}
              </p>
              {overview.levelProgress.progress !== null ? (
                <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[#dce9e7]">
                  <div
                    className="h-full rounded-full bg-[#2b9188]"
                    style={{
                      width: `${overview.levelProgress.progress}%`,
                      backgroundColor:
                        overview.levelProgress.current?.color ?? "#2b9188",
                    }}
                  />
                </div>
              ) : null}
            </section>
          </aside>
        </div>
      </CommunityFollowProvider>
    </div>
  );
}

function CommunityStat({
  icon,
  value,
  label,
  className = "",
}: {
  icon: React.ReactNode;
  value: number;
  label: string;
  className?: string;
}) {
  return (
    <div className={`rounded-md bg-white/10 p-3 text-center ${className}`}>
      <span className="grid place-items-center">{icon}</span>
      <p className="mt-1 text-lg font-bold">{value}</p>
      <p className="text-[9px] text-white/60">{label}</p>
    </div>
  );
}
