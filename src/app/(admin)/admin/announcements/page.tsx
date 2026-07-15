import { and, asc, desc, eq, sql } from "drizzle-orm";
import { Megaphone } from "lucide-react";
import type { Metadata } from "next";
import { AnnouncementManager } from "@/components/admin/announcement-manager";
import { PageHeader } from "@/components/ui/page-header";
import { db } from "@/db";
import {
  announcements,
  bundles,
  courses,
  groups,
  users,
} from "@/db/schema";
import { requireOrganizationAdmin } from "@/lib/auth";
import { listMemberPropertyVariableCatalog } from "@/lib/member-properties";
import { normalizeAnnouncementContent } from "@/lib/announcement-content";
import { getAnnouncementCopy } from "@/lib/i18n/announcements";
import { resolveUserLocale } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const user = await requireOrganizationAdmin();
  const locale = await resolveUserLocale(user);
  return { title: getAnnouncementCopy(locale).page.metadataTitle };
}

export default async function AnnouncementsPage() {
  const user = await requireOrganizationAdmin();
  const now = new Date();
  const [rows, memberRows, groupRows, bundleRows, courseRows, propertyVariables, locale] = await Promise.all([
    db
      .select({
        id: announcements.id,
        title: announcements.title,
        body: announcements.body,
        tone: announcements.tone,
        placement: announcements.placement,
        audience: announcements.audience,
        audienceId: announcements.audienceId,
        targetRuleSet: announcements.targetRuleSet,
        contentDocument: announcements.contentDocument,
        href: announcements.href,
        actionLabel: announcements.actionLabel,
        startsAt: announcements.startsAt,
        endsAt: announcements.endsAt,
        dismissible: announcements.dismissible,
        active: announcements.active,
        impressionCount:
          sql<number>`(select count(*) from announcement_interactions ai where ai.announcement_id = ${announcements.id} and ai.kind = 'impression')`.mapWith(
            Number,
          ),
        clickCount:
          sql<number>`(select count(*) from announcement_interactions ai where ai.announcement_id = ${announcements.id} and ai.kind = 'click')`.mapWith(Number),
        dismissalCount:
          sql<number>`(select count(*) from announcement_interactions ai where ai.announcement_id = ${announcements.id} and ai.kind = 'dismiss')`.mapWith(Number),
      })
      .from(announcements)
      .where(eq(announcements.organizationId, user.organizationId))
      .orderBy(desc(announcements.createdAt)),
    db
      .select({
        id: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
      })
      .from(users)
      .where(
        and(
          eq(users.organizationId, user.organizationId),
          eq(users.status, "active"),
        ),
      )
      .orderBy(asc(users.firstName), asc(users.lastName)),
    db
      .select({ id: groups.id, name: groups.name })
      .from(groups)
      .where(eq(groups.organizationId, user.organizationId))
      .orderBy(asc(groups.name)),
    db
      .select({ id: bundles.id, name: bundles.name })
      .from(bundles)
      .where(eq(bundles.organizationId, user.organizationId))
      .orderBy(asc(bundles.name)),
    db
      .select({ id: courses.id, title: courses.title })
      .from(courses)
      .where(eq(courses.organizationId, user.organizationId))
      .orderBy(asc(courses.title)),
    listMemberPropertyVariableCatalog(user.organizationId),
    resolveUserLocale(user),
  ]);
  const copy = getAnnouncementCopy(locale);

  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <PageHeader
        eyebrow={copy.page.eyebrow}
        title={copy.page.title}
        description={copy.page.description}
        actions={
          <span className="grid size-10 place-items-center rounded-md bg-[#e9f8f6] text-[#167e74]">
            <Megaphone className="size-5" />
          </span>
        }
      />
      <AnnouncementManager
        announcements={rows.map((row) => ({
          ...row,
          contentDocument: normalizeAnnouncementContent(row),
          deliveryStatus: !row.active
            ? "inactive"
            : row.startsAt > now
              ? "scheduled"
              : row.endsAt && row.endsAt <= now
                ? "ended"
                : "live",
        }))}
        users={memberRows.map((member) => ({
          id: member.id,
          label: `${member.firstName} ${member.lastName}`,
        }))}
        groups={groupRows.map((group) => ({ id: group.id, label: group.name }))}
        bundles={bundleRows.map((bundle) => ({
          id: bundle.id,
          label: bundle.name,
        }))}
        courses={courseRows.map((course) => ({
          id: course.id,
          label: course.title,
        }))}
        defaultStartsAt={now}
        locale={locale}
        variables={[
          { token: "member.firstName", label: copy.variables.firstName },
          { token: "member.lastName", label: copy.variables.lastName },
          { token: "member.fullName", label: copy.variables.fullName },
          ...propertyVariables.map((variable) => ({
            token: variable.token,
            label: variable.label,
          })),
        ]}
      />
    </div>
  );
}
