import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { ArrowLeft, ShieldCheck, UsersRound } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button, buttonClassName } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { db } from "@/db";
import { courseCollaborators, courses, users } from "@/db/schema";
import { setCourseCollaboratorAction } from "@/lib/admin/course-collaborator-actions";
import { requireOrganizationAdmin } from "@/lib/auth";
import { getCourseSupportCopy } from "@/lib/i18n/course-support";
import { intlLocale } from "@/lib/i18n/model";
import { resolveUserLocale } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const actor = await requireOrganizationAdmin();
  const locale = await resolveUserLocale(actor);
  return { title: getCourseSupportCopy(locale).team.eyebrow };
}

export default async function CourseTeamPage({
  params,
}: PageProps<"/admin/courses/[id]/team">) {
  const { id } = await params;
  const actor = await requireOrganizationAdmin();
  const locale = await resolveUserLocale(actor);
  const copy = getCourseSupportCopy(locale);
  const numberFormatter = new Intl.NumberFormat(intlLocale(locale));
  const [course] = await db
    .select({ id: courses.id, title: courses.title })
    .from(courses)
    .where(
      and(
        eq(courses.id, id),
        eq(courses.organizationId, actor.organizationId),
      ),
    )
    .limit(1);
  if (!course) notFound();

  const trainers = await db
    .select({
      id: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      email: users.email,
      status: users.status,
      permission: courseCollaborators.permission,
    })
    .from(users)
    .leftJoin(
      courseCollaborators,
      and(
        eq(courseCollaborators.organizationId, users.organizationId),
        eq(courseCollaborators.userId, users.id),
        eq(courseCollaborators.courseId, course.id),
      ),
    )
    .where(
      and(
        eq(users.organizationId, actor.organizationId),
        eq(users.role, "trainer"),
      ),
    )
    .orderBy(asc(users.lastName), asc(users.firstName), asc(users.id));

  return (
    <div className="mx-auto max-w-[1100px] space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <Link
            href={`/admin/courses/${course.id}`}
            className={buttonClassName({ variant: "secondary", size: "icon" })}
            aria-label={copy.common.backToCourse}
          >
            <ArrowLeft className="size-4" />
          </Link>
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-xs font-semibold text-[#167e74]">
              <UsersRound className="size-4" />
              {copy.team.eyebrow}
            </p>
            <h1 className="mt-1 truncate text-xl font-bold text-[#1d2b38]">
              {course.title}
            </h1>
            <p className="mt-1 text-xs leading-5 text-[#71808b]">
              {copy.team.description}
            </p>
          </div>
        </div>
        <Badge tone="navy">
          <ShieldCheck className="mr-1 size-3.5" />
          {copy.team.assigned(
            numberFormatter.format(
              trainers.filter((trainer) => trainer.permission).length,
            ),
          )}
        </Badge>
      </header>

      {trainers.length ? (
        <div className="panel overflow-hidden">
          <div className="table-scroll overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-left">
              <thead>
                <tr className="bg-[#f7f8f9] text-[10px] font-bold uppercase text-[#7c8790]">
                  <th className="px-5 py-3">{copy.team.columns.trainer}</th>
                  <th className="px-5 py-3">{copy.team.columns.status}</th>
                  <th className="px-5 py-3">{copy.team.columns.permission}</th>
                  <th className="px-5 py-3 text-right">{copy.team.columns.action}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#edf0f2]">
                {trainers.map((trainer) => {
                  const action = setCourseCollaboratorAction.bind(
                    null,
                    course.id,
                    trainer.id,
                  );
                  return (
                    <tr key={trainer.id}>
                      <td className="px-5 py-4">
                        <p className="text-sm font-semibold text-[#243444]">
                          {trainer.firstName} {trainer.lastName}
                        </p>
                        <p className="mt-0.5 text-xs text-[#7a8690]">
                          {trainer.email}
                        </p>
                      </td>
                      <td className="px-5 py-4">
                        <Badge
                          tone={trainer.status === "active" ? "teal" : "neutral"}
                        >
                          {trainer.status === "active"
                            ? copy.common.active
                            : trainer.status === "invited"
                              ? copy.common.invited
                              : copy.common.disabled}
                        </Badge>
                      </td>
                      <td className="px-5 py-4">
                        <form action={action} className="flex items-center gap-2">
                          <label className="sr-only" htmlFor={`permission-${trainer.id}`}>
                            {copy.team.permissionFor(
                              `${trainer.firstName} ${trainer.lastName}`,
                            )}
                          </label>
                          <select
                            id={`permission-${trainer.id}`}
                            name="permission"
                            defaultValue={trainer.permission ?? "none"}
                            disabled={trainer.status === "disabled"}
                            className="focus-ring h-9 min-w-48 rounded-md border border-[#dce1e5] bg-white px-2 text-xs text-[#354555] disabled:bg-[#f1f3f5]"
                          >
                            {Object.entries(copy.common.permission).map(
                              ([permission, label]) => (
                                <option key={permission} value={permission}>
                                  {label}
                                </option>
                              ),
                            )}
                          </select>
                          <Button
                            type="submit"
                            size="sm"
                            variant="secondary"
                            disabled={trainer.status === "disabled"}
                          >
                            {copy.team.save}
                          </Button>
                        </form>
                      </td>
                      <td className="px-5 py-4 text-right text-xs text-[#71808b]">
                        {trainer.permission
                          ? copy.common.permission[trainer.permission]
                          : copy.common.notAssigned}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <EmptyState
          icon={UsersRound}
          title={copy.team.emptyTitle}
          description={copy.team.emptyDescription}
          action={
            <Link
              href="/admin/members"
              className={buttonClassName({ variant: "secondary", size: "sm" })}
            >
              {copy.team.manageMembers}
            </Link>
          }
        />
      )}
    </div>
  );
}
