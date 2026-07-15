import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { CourseModuleAccessAdmin } from "@/components/admin/course-module-access-admin";
import { buttonClassName } from "@/components/ui/button";
import { db } from "@/db";
import { courseModules, courses, enrollments, modules, users } from "@/db/schema";
import { requireOrganizationAdmin } from "@/lib/auth";
import {
  listCourseModuleAccessOverrides,
  listCourseModuleAccessRequests,
} from "@/lib/course-module-access-service";
import { getCourseSupportCopy } from "@/lib/i18n/course-support";
import { intlLocale } from "@/lib/i18n/model";
import { resolveUserLocale } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const actor = await requireOrganizationAdmin();
  const locale = await resolveUserLocale(actor);
  return { title: getCourseSupportCopy(locale).accessPage.eyebrow };
}

export default async function CourseModuleAccessPage({
  params,
}: PageProps<"/admin/courses/[id]/access">) {
  const { id } = await params;
  const actor = await requireOrganizationAdmin();
  const locale = await resolveUserLocale(actor);
  const copy = getCourseSupportCopy(locale);
  const numberFormatter = new Intl.NumberFormat(intlLocale(locale));
  const [course] = await db
    .select({ id: courses.id, title: courses.title, status: courses.status })
    .from(courses)
    .where(
      and(
        eq(courses.id, id),
        eq(courses.organizationId, actor.organizationId),
      ),
    )
    .limit(1);
  if (!course) notFound();

  const [assignedModules, enrolledMembers, requests, overrides] =
    await Promise.all([
      db
        .select({
          id: modules.id,
          title: modules.title,
          sortOrder: courseModules.sortOrder,
        })
        .from(courseModules)
        .innerJoin(
          modules,
          and(
            eq(modules.id, courseModules.moduleId),
            eq(modules.organizationId, courseModules.organizationId),
          ),
        )
        .where(
          and(
            eq(courseModules.organizationId, actor.organizationId),
            eq(courseModules.courseId, course.id),
          ),
        )
        .orderBy(asc(courseModules.sortOrder), asc(modules.id)),
      db
        .select({
          id: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
          email: users.email,
        })
        .from(enrollments)
        .innerJoin(
          users,
          and(
            eq(users.id, enrollments.userId),
            eq(users.organizationId, actor.organizationId),
            eq(users.role, "member"),
            eq(users.status, "active"),
          ),
        )
        .where(
          and(
            eq(enrollments.courseId, course.id),
            eq(enrollments.accessActive, true),
          ),
        )
        .orderBy(asc(users.lastName), asc(users.firstName), asc(users.id)),
      listCourseModuleAccessRequests({
        organizationId: actor.organizationId,
        courseId: course.id,
      }),
      listCourseModuleAccessOverrides({
        organizationId: actor.organizationId,
        courseId: course.id,
      }),
    ]);
  const members = enrolledMembers.map((member) => ({
    id: member.id,
    name: `${member.firstName} ${member.lastName}`.trim(),
    email: member.email,
  }));

  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <Link
            href={`/admin/courses/${course.id}`}
            className={buttonClassName({
              variant: "secondary",
              size: "icon",
            })}
            aria-label={copy.common.backToCourse}
          >
            <ArrowLeft className="size-4" />
          </Link>
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-xs font-semibold text-[#167e74]">
              <ShieldCheck className="size-4" />
              {copy.accessPage.eyebrow}
            </p>
            <h1 className="mt-1 truncate text-xl font-bold text-[#1d2b38]">
              {course.title}
            </h1>
          </div>
        </div>
        <span className="text-xs text-[#71808b]">
          {copy.accessPage.summary(
            numberFormatter.format(assignedModules.length),
            numberFormatter.format(members.length),
          )}
        </span>
      </header>

      {course.status !== "published" ? (
        <p className="border-l-2 border-[#d6a536] bg-[#fffbef] px-4 py-3 text-xs text-[#6f664d]">
          {copy.accessPage.unpublishedNotice}
        </p>
      ) : null}

      <div className="space-y-5">
        {assignedModules.map((learningModule) => (
          <div key={learningModule.id} className="panel p-5 md:p-6">
            <CourseModuleAccessAdmin
              courseId={course.id}
              locale={locale}
              moduleId={learningModule.id}
              moduleTitle={learningModule.title}
              members={members}
              requests={requests.filter(
                (request) => request.moduleId === learningModule.id,
              )}
              overrides={overrides.filter(
                (override) => override.moduleId === learningModule.id,
              )}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
