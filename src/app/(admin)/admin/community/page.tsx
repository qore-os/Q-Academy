import { Flag, MessageCircleMore, MessagesSquare, Users } from "lucide-react";
import type { Metadata } from "next";
import { AdminCreateButton } from "@/components/admin/admin-create-dialog";
import { CommunityAccessPolicyEditor } from "@/components/admin/community-access-policy-editor";
import { CommunityBoostManager } from "@/components/admin/community-boost-manager";
import { CommunityBadgeManager } from "@/components/admin/community-badge-manager";
import { CommunityGovernanceSettings } from "@/components/admin/community-governance-settings";
import { CommunityModeration } from "@/components/admin/community-moderation";
import { CommunityModerationQueue } from "@/components/admin/community-moderation-queue";
import { CommunityLayoutManager } from "@/components/admin/community-layout-manager";
import { CommunityPublicProfileSettings } from "@/components/admin/community-public-profile-settings";
import { CommunityComposer } from "@/components/academy/community-feed";
import { PageHeader } from "@/components/ui/page-header";
import { requireTeamPermission } from "@/lib/auth";
import { listCommunityAuthorBoosts } from "@/lib/community-boosts";
import {
  getCommunityOverviewData,
  getExplainableCommunityFeed,
} from "@/lib/community-feed";
import { getCommunityReports } from "@/lib/community-reports";
import { getCommunityMentionCandidates } from "@/lib/community-mentions";
import { getCommunityAccessPolicyAdminData } from "@/lib/community-access";
import { getCommunityGovernanceAdminData } from "@/lib/community-governance";
import { getCommunityModerationQueue } from "@/lib/community-moderation-queue";
import { getCommunityBadgeAdminData } from "@/lib/community-badge-admin";
import { listCommunityLayout } from "@/lib/community-layout";
import {
  getCommunityProfileSettingsAdminData,
  getOwnCommunityProfileCompletion,
} from "@/lib/community-public-profile";
import { getMainPageDictionary } from "@/lib/i18n/main-pages";
import { formatCommunityAdminNumber } from "@/lib/i18n/community-admin";
import { resolveUserLocale } from "@/lib/i18n/server";
import { teamPermissionAllows } from "@/lib/team-permission-policy";
import { getTeamAccessForUser } from "@/lib/team-permissions";

export async function generateMetadata(): Promise<Metadata> {
  const user = await requireTeamPermission("community.view");
  const locale = await resolveUserLocale(user);
  return {
    title: getMainPageDictionary(locale).admin.headers.community.title,
  };
}

export default async function AdminCommunityPage() {
  const user = await requireTeamPermission("community.view");
  const teamAccess = await getTeamAccessForUser(user);
  const canManage = teamPermissionAllows(
    teamAccess.permissions,
    "community.manage",
  );
  const actor = {
    id: user.id,
    organizationId: user.organizationId,
    role: user.role,
  };
  const referenceTime = new Date();
  const [
    overview,
    initialFeed,
    reports,
    mentionCandidates,
    accessPolicyData,
    boosts,
    governance,
    moderationQueue,
    badgeData,
    layout,
    profileSettings,
    profileCompletion,
    locale,
  ] = await Promise.all([
    getCommunityOverviewData(user.id, user.organizationId),
    getExplainableCommunityFeed({
      actor,
      mode: "latest",
      limit: 20,
      referenceTime,
      downloadContext: "session",
    }),
    getCommunityReports(user.organizationId),
    getCommunityMentionCandidates(user.organizationId),
    getCommunityAccessPolicyAdminData(user.organizationId),
    listCommunityAuthorBoosts({ actor, state: "all", referenceTime }),
    getCommunityGovernanceAdminData(user.organizationId),
    getCommunityModerationQueue(user.organizationId),
    getCommunityBadgeAdminData(user.organizationId),
    listCommunityLayout(user.organizationId),
    getCommunityProfileSettingsAdminData(user.organizationId),
    getOwnCommunityProfileCompletion({
      organizationId: user.organizationId,
      userId: user.id,
    }),
    resolveUserLocale(user),
  ]);
  const dictionary = getMainPageDictionary(locale).admin;
  const headerCopy = dictionary.headers.community;
  const copy = dictionary.community;
  const spaces = overview.spaces.map((space) => ({
    ...space,
    commentCount: space.answerCount,
  }));
  const overviewSpacesById = new Map(
    overview.spaces.map((space) => [space.id, space] as const),
  );
  const communityAreas = layout.map((area) => ({
    id: area.id,
    title: area.title,
    description: area.description,
    spaces: area.spaces.flatMap((space) => {
      const visible = overviewSpacesById.get(space.id);
      return visible ? [visible] : [];
    }),
  }));
  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <PageHeader
        {...headerCopy}
        actions={
          canManage ? (
            <AdminCreateButton
              resource="community-space"
              communityAreas={layout.map(({ id, title }) => ({ id, title }))}
              locale={locale}
            />
          ) : undefined
        }
      />
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="panel flex items-center gap-4 p-4">
          <MessageCircleMore className="size-5 text-[#2b9188]" />
          <div>
            <p className="text-xl font-bold text-[#243444]">
              {formatCommunityAdminNumber(overview.totalPostCount, locale)}
            </p>
            <p className="text-[11px] text-[#71808b]">{copy.posts}</p>
          </div>
        </div>
        <div className="panel flex items-center gap-4 p-4">
          <Users className="size-5 text-[#365f8d]" />
          <div>
            <p className="text-xl font-bold text-[#243444]">
              {formatCommunityAdminNumber(overview.memberCount, locale)}
            </p>
            <p className="text-[11px] text-[#71808b]">{copy.activeMembers}</p>
          </div>
        </div>
        <div className="panel flex items-center gap-4 p-4">
          <MessagesSquare className="size-5 text-[#d6a536]" />
          <div>
            <p className="text-xl font-bold text-[#243444]">
              {formatCommunityAdminNumber(overview.totalAnswerCount, locale)}
            </p>
            <p className="text-[11px] text-[#71808b]">{copy.answers}</p>
          </div>
        </div>
        <div className="panel flex items-center gap-4 p-4">
          <Flag className="size-5 text-[#b84e42]" />
          <div>
            <p className="text-xl font-bold text-[#243444]">
              {formatCommunityAdminNumber(moderationQueue.length, locale)}
            </p>
            <p className="text-[11px] text-[#71808b]">{copy.openReports}</p>
          </div>
        </div>
      </section>
      <CommunityLayoutManager
        areas={layout}
        canManage={canManage}
        locale={locale}
      />
      <CommunityPublicProfileSettings
        data={profileSettings}
        canManage={canManage}
        locale={locale}
      />
      <CommunityModerationQueue
        items={moderationQueue}
        currentAdminId={user.id}
        locale={locale}
      />
      <CommunityComposer
        spaces={overview.spaces}
        currentUser={{ firstName: user.firstName, lastName: user.lastName }}
        mentionCandidates={mentionCandidates.filter(
          (candidate) => candidate.id !== user.id,
        )}
        canCreateAnnouncements={canManage}
        areas={communityAreas}
        profileCompletion={profileCompletion}
        locale={locale}
      />
      <CommunityAccessPolicyEditor
        data={accessPolicyData}
        spaceTitles={overview.spaces.map(({ id, title }) => ({ id, title }))}
        locale={locale}
      />
      <CommunityGovernanceSettings data={governance} locale={locale} />
      <CommunityBadgeManager data={badgeData} locale={locale} />
      <CommunityBoostManager
        initialBoosts={boosts}
        authors={mentionCandidates.map(({ id, firstName, lastName }) => ({
          id,
          firstName,
          lastName,
        }))}
        referenceTime={initialFeed.asOf}
        locale={locale}
      />
      <CommunityModeration
        spaces={spaces}
        initialFeed={initialFeed}
        reports={reports}
        locale={locale}
      />
    </div>
  );
}
