import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { AlertTriangle, Award, CheckCircle2, UserRound } from "lucide-react";
import Link from "next/link";
import { MemberDataProfileManager } from "@/components/admin/member-data-profile-manager";
import { MfaSecurityPanel } from "@/components/academy/mfa-security-panel";
import { ProfileLocaleSettings } from "@/components/shared/locale-settings-panel";
import {
  PasswordForm,
  ProfileDetailsForm,
  NotificationPreferencesForm,
  SessionManager,
  SsoAccountStatus,
} from "@/components/academy/profile-settings";
import { PageHeader } from "@/components/ui/page-header";
import { db } from "@/db";
import { oidcIdentities, userSessions } from "@/db/schema";
import { getSession, requireUser } from "@/lib/auth";
import { getMemberDataProfileBundle } from "@/lib/data-profiles";
import { getOidcConfiguration } from "@/lib/oidc-configuration";
import { getOwnMfaState } from "@/lib/mfa/queries";
import { getOrganizationDefaultLocale, resolveUserLocale } from "@/lib/i18n/server";
import { getCoreDictionary } from "@/lib/i18n/dictionaries";
import { getMemberExperienceCopy } from "@/lib/i18n/member-experience";
import { effectiveLocale, normalizeLocale } from "@/lib/i18n/model";
import { avatarMediaAssetId } from "@/lib/avatar-policy";
import { visibleCommunityBadgesForUsers } from "@/lib/community-badges";
import { getNotificationPreferences } from "@/lib/notification-preferences";
import { getOwnCommunityProfileCompletion } from "@/lib/community-public-profile";

export async function generateMetadata() {
  const user = await requireUser();
  const locale = await resolveUserLocale(user);
  return { title: getCoreDictionary(locale).experience.profile.title };
}

export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ profile?: string; community?: string }>;
}) {
  const user = await requireUser();
  const { profile: selectedProfileId, community } = await searchParams;
  const [profile, currentSession, sessions, loginConfiguration, identities, mfaState, defaultLocale, locale, badgeMap, notificationPreferences, communityCompletion] = await Promise.all([
    getMemberDataProfileBundle({
      memberId: user.id,
      organizationId: user.organizationId,
      viewer: user,
      selectedProfileId,
    }),
    getSession(),
    db
      .select({
        id: userSessions.id,
        ipAddress: userSessions.ipAddress,
        userAgent: userSessions.userAgent,
        lastSeenAt: userSessions.lastSeenAt,
        expiresAt: userSessions.expiresAt,
        createdAt: userSessions.createdAt,
        authenticatedAt: userSessions.authenticatedAt,
        authMethod: userSessions.authMethod,
      })
      .from(userSessions)
      .where(
        and(
          eq(userSessions.userId, user.id),
          eq(userSessions.organizationId, user.organizationId),
          isNull(userSessions.revokedAt),
          gt(userSessions.expiresAt, new Date()),
        ),
      )
      .orderBy(desc(userSessions.lastSeenAt)),
    getOidcConfiguration(user.organizationId),
    db
      .select({
        issuer: oidcIdentities.issuer,
        emailAtLink: oidcIdentities.emailAtLink,
        lastLoginAt: oidcIdentities.lastLoginAt,
      })
      .from(oidcIdentities)
      .where(
        and(
          eq(oidcIdentities.userId, user.id),
          eq(oidcIdentities.organizationId, user.organizationId),
        ),
      )
      .orderBy(desc(oidcIdentities.lastLoginAt)),
    getOwnMfaState(user),
    getOrganizationDefaultLocale(user.organizationId),
    resolveUserLocale(user),
    visibleCommunityBadgesForUsers({
      organizationId: user.organizationId,
      userIds: [user.id],
    }),
    getNotificationPreferences({
      userId: user.id,
      organizationId: user.organizationId,
    }),
    getOwnCommunityProfileCompletion({
      organizationId: user.organizationId,
      userId: user.id,
    }),
  ]);
  const badges = badgeMap.get(user.id) ?? [];
  const pageCopy = getCoreDictionary(locale).experience.profile;
  const memberCopy = getMemberExperienceCopy(locale).profile;
  const linkedIdentity = identities.find(
    (identity) => identity.issuer === loginConfiguration.issuer,
  );
  const sessionRows = sessions.map((session) => ({
    ...session,
    authMethod: session.authMethod === "oidc" ? "oidc" as const : "password" as const,
    current: session.id === currentSession?.sessionId,
  }));
  const currentSessionRow = sessionRows.find((session) => session.current);

  return (
    <div className="mx-auto max-w-[1100px] space-y-6">
      <PageHeader
        eyebrow={pageCopy.eyebrow}
        title={pageCopy.title}
        description={pageCopy.description}
        actions={
          <span className="flex items-center gap-2 rounded-md bg-[#eef3f9] px-3 py-2 text-xs font-semibold text-[#365f8d]">
            <UserRound className="size-4" />
            {user.email}
          </span>
        }
      />
      {community === "required" ||
      (communityCompletion.gateEnabled && !communityCompletion.complete) ? (
        <section
          className={
            communityCompletion.complete
              ? "panel flex flex-col gap-3 border-[#b9ddd8] bg-[#f2faf8] p-4 sm:flex-row sm:items-center"
              : "panel flex flex-col gap-3 border-[#edcf9f] bg-[#fffaf1] p-4 sm:flex-row sm:items-center"
          }
          role="status"
          data-testid="community-profile-requirements"
        >
          {communityCompletion.complete ? (
            <CheckCircle2 className="size-5 shrink-0 text-[#167e74]" />
          ) : (
            <AlertTriangle className="size-5 shrink-0 text-[#a56c18]" />
          )}
          <div className="min-w-0 flex-1">
            <h2 className="text-xs font-bold text-[#354555]">
              {communityCompletion.complete
                ? memberCopy.communityComplete
                : memberCopy.communityIncomplete}
            </h2>
            {!communityCompletion.complete ? (
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] leading-4 text-[#84652f]">
                <span>{memberCopy.missing}</span>
                {communityCompletion.missingFields.map((field) => (
                  <a
                    key={field.key}
                    href={`#community-field-${encodeURIComponent(field.key)}`}
                    className="focus-ring rounded font-bold underline underline-offset-2"
                  >
                    {field.label}
                  </a>
                ))}
              </div>
            ) : null}
          </div>
          {communityCompletion.complete ? (
            <Link
              href="/academy/community"
              className="focus-ring inline-flex h-9 items-center justify-center rounded-md bg-[#17324d] px-3 text-xs font-bold text-white hover:bg-[#244765]"
            >
              {memberCopy.openCommunity}
            </Link>
          ) : null}
        </section>
      ) : null}
      <ProfileDetailsForm
        locale={locale}
        user={{
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          jobTitle: user.jobTitle,
          department: user.department,
          phone: user.phone,
          bio: user.bio,
          avatarUrl: user.avatarUrl,
          avatarAssetId: avatarMediaAssetId(user.avatarUrl),
        }}
        communityRequiredFields={communityCompletion.missingFields.map(
          (field) => field.key,
        )}
      />
      <NotificationPreferencesForm
        preferences={notificationPreferences}
        locale={locale}
      />
      {badges.length ? (
        <section className="panel p-4 sm:p-5" aria-labelledby="profile-badges-heading">
          <div className="mb-4 flex items-center gap-2">
            <Award className="size-4 text-[#b07c14]" />
            <h2 id="profile-badges-heading" className="text-sm font-bold text-[#243444]">
              {memberCopy.myBadges}
            </h2>
          </div>
          <div className="flex flex-wrap gap-2">
            {badges.map((badge) => (
              <div
                key={badge.id}
                className="flex min-h-11 max-w-full items-center gap-2 rounded-md border px-3 py-2"
                style={{
                  borderColor: `${badge.color}66`,
                  backgroundColor: `${badge.color}14`,
                }}
                title={badge.description}
              >
                <Award className="size-4 shrink-0" style={{ color: badge.color }} />
                <span className="min-w-0">
                  <span className="block truncate text-xs font-bold text-[#334454]">
                    {badge.name}
                  </span>
                  {badge.groupName ? (
                    <span className="block truncate text-[10px] text-[#71808b]">
                      {badge.groupName}
                    </span>
                  ) : null}
                </span>
              </div>
            ))}
          </div>
        </section>
      ) : null}
      <ProfileLocaleSettings
        locale={effectiveLocale({
          preferredLocale: user.preferredLocale,
          defaultLocale,
        })}
        preferredLocale={user.preferredLocale ? normalizeLocale(user.preferredLocale) : null}
        defaultLocale={defaultLocale}
      />
      <MemberDataProfileManager
        memberId={user.id}
        profiles={profile.profiles}
        definitions={profile.definitions}
        selectedProfile={profile.selectedProfile}
        fields={profile.fields}
        selfService
        basePath="/academy/profile"
        locale={locale}
        communityRequiredFieldKeys={communityCompletion.missingFields.map(
          (field) => field.key,
        )}
      />
      {mfaState ? (
        <MfaSecurityPanel
          state={mfaState}
          passwordRequired={loginConfiguration.passwordLoginEnabled}
          locale={locale}
        />
      ) : null}
      <div className="grid gap-6 xl:grid-cols-2 xl:items-start">
        {loginConfiguration.passwordLoginEnabled ? (
          <PasswordForm locale={locale} />
        ) : (
          <SsoAccountStatus
            locale={locale}
            account={{
              displayName: loginConfiguration.displayName,
              identityEmail: linkedIdentity?.emailAtLink ?? null,
              lastLoginAt: linkedIdentity?.lastLoginAt ?? null,
              currentAuthMethod: currentSessionRow?.authMethod ?? null,
              authenticatedAt: currentSessionRow?.authenticatedAt ?? null,
            }}
          />
        )}
        <SessionManager
          locale={locale}
          sessions={sessionRows}
        />
      </div>
    </div>
  );
}
