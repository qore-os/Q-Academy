import {
  ArrowLeft,
  Award,
  BriefcaseBusiness,
  Building2,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ApiError } from "@/lib/api/errors";
import { requireUser } from "@/lib/auth";
import {
  getCommunityPublicProfile,
  type CommunityPublicProfileField,
} from "@/lib/community-public-profile";
import { getMainPageDictionary } from "@/lib/i18n/main-pages";
import { resolveUserLocale } from "@/lib/i18n/server";

function fieldValue(
  field: CommunityPublicProfileField,
  notProvided: string,
) {
  if (field.kind === "standard" && field.key === "badges") {
    const badges = Array.isArray(field.value) ? field.value : [];
    return badges.length ? (
      <span className="flex flex-wrap gap-2">
        {badges.map((badge) => (
          <span
            key={badge.id}
            className="inline-flex min-h-8 max-w-full items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-bold text-[#354555]"
            style={{
              borderColor: `${badge.color}66`,
              backgroundColor: `${badge.color}14`,
            }}
            title={badge.description}
          >
            <Award className="size-3.5 shrink-0" style={{ color: badge.color }} />
            <span className="truncate">{badge.name}</span>
          </span>
        ))}
      </span>
    ) : (
      <span className="text-[var(--theme-muted-text)]">{notProvided}</span>
    );
  }
  const value = field.value;
  if (value === null || value === "") {
    return <span className="text-[var(--theme-muted-text)]">{notProvided}</span>;
  }
  return <span className="whitespace-pre-wrap break-words">{String(value)}</span>;
}

export default async function CommunityMemberProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const viewer = await requireUser();
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const locale = await resolveUserLocale(viewer);
  const copy = getMainPageDictionary(locale).academy.communityProfile;
  let profile;
  try {
    profile = await getCommunityPublicProfile({
      organizationId: viewer.organizationId,
      memberId: id,
      locale,
    });
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound();
    throw error;
  }

  const configuredKeys = new Set(profile.fields.map((field) => field.key));
  const headerFieldKeys = new Set([
    "avatar",
    "job_title",
    "department",
    "community_points",
  ]);
  const detailFields = profile.fields.filter(
    (field) => !headerFieldKeys.has(field.key),
  );

  return (
    <div className="mx-auto max-w-[980px] space-y-6">
      <Link
        href="/academy/community"
        className="focus-ring inline-flex h-9 items-center gap-2 rounded-md px-2 text-xs font-bold text-[#52606d] hover:bg-[#edf1f3]"
      >
        <ArrowLeft className="size-4" /> {copy.back}
      </Link>

      <header className="overflow-hidden rounded-md bg-[#17324d] px-5 py-6 text-white sm:px-7 sm:py-8">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
          <Avatar
            firstName={profile.firstName}
            lastName={profile.lastName}
            src={profile.avatarUrl}
            size="xl"
            className="ring-4 ring-white/15"
          />
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-bold uppercase text-[#63d5ca]">
              {copy.eyebrow}
            </p>
            <h1 className="mt-1 break-words text-2xl font-bold sm:text-3xl">
              {profile.firstName} {profile.lastName}
            </h1>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-white/70">
              {configuredKeys.has("job_title") ? (
                <span className="inline-flex items-center gap-1.5">
                  <BriefcaseBusiness className="size-3.5" />{" "}
                  {profile.jobTitle || copy.jobNotProvided}
                </span>
              ) : null}
              {configuredKeys.has("department") ? (
                <span className="inline-flex items-center gap-1.5">
                  <Building2 className="size-3.5" />{" "}
                  {profile.department || copy.departmentNotProvided}
                </span>
              ) : null}
              {configuredKeys.has("community_points") ? (
                <Badge tone="teal">
                  {profile.communityPoints !== null
                    ? copy.points(profile.communityPoints)
                    : copy.pointsNotProvided}
                </Badge>
              ) : null}
            </div>
          </div>
        </div>
      </header>

      <section className="panel overflow-hidden" aria-labelledby="community-profile-fields-heading">
        <div className="flex items-center gap-2 border-b border-[#e7ebee] px-4 py-4 sm:px-5">
          <UserRound className="size-4 text-[#365f8d]" />
          <h2 id="community-profile-fields-heading" className="text-sm font-bold text-[#243444]">
            {copy.profileInformation}
          </h2>
        </div>
        {detailFields.length ? (
          <dl className="divide-y divide-[#edf0f2]">
            {detailFields.map((field) => (
              <div
                key={field.kind === "custom" ? field.id : field.key}
                className="grid gap-1.5 px-4 py-4 sm:grid-cols-[180px_minmax(0,1fr)] sm:gap-5 sm:px-5"
              >
                <dt className="text-[10px] font-bold uppercase text-[#71808b]">
                  {field.label}
                </dt>
                <dd className="min-w-0 text-sm leading-6 text-[#455463]">
                  {fieldValue(field, copy.notProvided)}
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="px-5 py-9 text-center text-sm text-[#71808b]">
            {copy.noPublicInformation}
          </p>
        )}
      </section>
    </div>
  );
}
