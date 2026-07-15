import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import {
  ArrowLeft,
  BookOpen,
  CalendarDays,
  Layers3,
  Phone,
  Trophy,
} from "lucide-react";
import { MemberDataProfileManager } from "@/components/admin/member-data-profile-manager";
import { OwnershipTransferForm } from "@/components/admin/ownership-transfer-form";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { requireAdmin } from "@/lib/auth";
import { getAdminMemberProfile } from "@/lib/data";
import {
  DataProfileNotFoundError,
  getMemberDataProfileBundle,
} from "@/lib/data-profiles";
import { getCoreDictionary } from "@/lib/i18n/dictionaries";
import { getMainPageDictionary } from "@/lib/i18n/main-pages";
import { resolveUserLocale } from "@/lib/i18n/server";
import { formatDate } from "@/lib/utils";

const memberIdSchema = z.string().uuid();

export default async function AdminMemberDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ profile?: string }>;
}) {
  const { id } = await params;
  if (!memberIdSchema.safeParse(id).success) notFound();

  const { profile: selectedProfileId } = await searchParams;
  const actor = await requireAdmin();
  const data = await getAdminMemberProfile(id, actor.organizationId);
  if (!data) notFound();

  const [profiles, locale] = await Promise.all([
    getMemberDataProfileBundle({
      memberId: id,
      organizationId: actor.organizationId,
      viewer: actor,
      selectedProfileId,
    }),
    resolveUserLocale(actor),
  ]).catch((error: unknown) => {
    if (error instanceof DataProfileNotFoundError) notFound();
    throw error;
  });
  const copy = getMainPageDictionary(locale).admin.memberDetail;
  const roleCopy = getCoreDictionary(locale).navigation.roles;
  const { member } = data;

  return (
    <div className="mx-auto max-w-[1300px] space-y-6">
      <header className="flex min-w-0 items-start gap-3">
        <Link
          href="/admin/members"
          className="focus-ring mt-0.5 grid size-9 shrink-0 place-items-center rounded-md border border-[#dfe4e8] bg-white text-[#66727f] hover:bg-[#f1f3f5]"
          aria-label={copy.backToMembers}
          title={copy.back}
        >
          <ArrowLeft className="size-4" />
        </Link>
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase text-[#2b9188]">
            {copy.eyebrow}
          </p>
          <h1 className="mt-1 truncate text-2xl font-bold text-[#17212b]">
            {member.firstName} {member.lastName}
          </h1>
          <p className="mt-1 truncate text-sm text-[#66727f]">{member.email}</p>
        </div>
      </header>

      <section className="panel overflow-hidden">
        <div className="flex flex-col gap-4 border-b border-[#e8ebee] p-5 sm:flex-row sm:items-center">
          <Avatar
            firstName={member.firstName}
            lastName={member.lastName}
            size="xl"
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-bold text-[#243444]">
                {member.firstName} {member.lastName}
              </h2>
              <Badge
                tone={
                  member.role === "owner" || member.role === "admin"
                    ? "blue"
                    : member.role === "trainer"
                      ? "amber"
                      : "neutral"
                }
              >
                {roleCopy[member.role]}
              </Badge>
              <Badge
                tone={
                  member.status === "active"
                    ? "teal"
                    : member.status === "invited"
                      ? "amber"
                      : "coral"
                }
              >
                {copy.status[member.status]}
              </Badge>
            </div>
            <p className="mt-1 text-xs text-[#7a8690]">
              {member.jobTitle ?? copy.noPosition}
              {member.department ? ` | ${member.department}` : ""}
            </p>
            {member.phone ? (
              <a
                href={`tel:${member.phone}`}
                className="focus-ring mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-[#365f8d] hover:underline"
              >
                <Phone className="size-3.5" />
                {member.phone}
              </a>
            ) : null}
          </div>
          <div className="flex items-center gap-2 text-xs text-[#7a8690]">
            <CalendarDays className="size-4" />{" "}
            {copy.since(formatDate(member.createdAt, undefined, locale))}
          </div>
        </div>
        <div className="grid divide-y divide-[#edf0f2] sm:grid-cols-4 sm:divide-x sm:divide-y-0">
          {[
            { label: copy.courses, value: member.courseCount, icon: BookOpen },
            { label: copy.groups, value: member.groupCount, icon: Layers3 },
            { label: copy.points, value: member.points, icon: Trophy },
          ].map((stat) => {
            const Icon = stat.icon;
            return (
              <div
                key={stat.label}
                className="flex items-center gap-3 px-5 py-4"
              >
                <span className="grid size-9 place-items-center rounded-md bg-[#eef3f9] text-[#365f8d]">
                  <Icon className="size-4" />
                </span>
                <div>
                  <p className="text-lg font-bold text-[#243444]">
                    {stat.value}
                  </p>
                  <p className="text-[10px] text-[#7a8690]">{stat.label}</p>
                </div>
              </div>
            );
          })}
          <div className="px-5 py-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[10px] text-[#7a8690]">
                {copy.learningProgress}
              </p>
              <strong className="text-xs text-[#2b9188]">
                {member.averageProgress}%
              </strong>
            </div>
            <Progress value={member.averageProgress} className="mt-3" />
          </div>
        </div>
      </section>

      <MemberDataProfileManager
        memberId={member.id}
        profiles={profiles.profiles}
        definitions={profiles.definitions}
        selectedProfile={profiles.selectedProfile}
        fields={profiles.fields}
        basePath={`/admin/members/${member.id}`}
        readOnly={actor.role === "trainer"}
        locale={locale}
      />

      {actor.role === "owner" &&
      actor.id !== member.id &&
      member.role === "admin" &&
      member.status === "active" ? (
        <OwnershipTransferForm
          targetUserId={member.id}
          targetEmail={member.email}
          locale={locale}
        />
      ) : null}
    </div>
  );
}
