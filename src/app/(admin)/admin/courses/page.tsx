import type { Metadata } from "next";
import { CourseExplorer } from "@/components/admin/course-explorer";
import { CourseCategoryManager } from "@/components/admin/course-category-manager";
import { PageHeader } from "@/components/ui/page-header";
import { requireAdmin } from "@/lib/auth";
import { canManageCourseCategories } from "@/lib/course-category-policy";
import { coursePermissionMapForUser } from "@/lib/course-permissions";
import { getAdminCourses } from "@/lib/data";
import { getMainPageDictionary } from "@/lib/i18n/main-pages";
import { getCourseSupportCopy } from "@/lib/i18n/course-support";
import { resolveUserLocale } from "@/lib/i18n/server";
import { getTeamAccessForUser } from "@/lib/team-permissions";

export async function generateMetadata(): Promise<Metadata> {
  const user = await requireAdmin();
  const locale = await resolveUserLocale(user);
  return { title: getCourseSupportCopy(locale).page.metadataTitle };
}

export default async function CoursesPage() {
  const user = await requireAdmin();
  const [data, locale, teamAccess] = await Promise.all([
    getAdminCourses(user.organizationId),
    resolveUserLocale(user),
    getTeamAccessForUser(user),
  ]);
  const copy = getMainPageDictionary(locale).admin.headers.courses;
  const permissions = await coursePermissionMapForUser(
    user,
    data.courses.map((course) => course.id),
  );
  const visibleCourses = data.courses.flatMap((course) => {
    const permission = permissions.get(course.id);
    return permission ? [{ ...course, permission }] : [];
  });
  const canManageCategories = canManageCourseCategories({
    role: user.role,
    assignmentExists: Boolean(teamAccess.customRole),
    customRoleActive: teamAccess.customRole?.active,
    customPermissions: teamAccess.permissions,
  });
  return (
    <div className="mx-auto max-w-[1500px] space-y-6">
      <PageHeader {...copy} />
      {canManageCategories ? (
        <CourseCategoryManager
          key={data.categories
            .map(
              (category) =>
                `${category.id}:${category.sortOrder}:${category.name}:${category.courseCount}`,
            )
            .join("|")}
          categories={data.categories}
          locale={locale}
        />
      ) : null}
      <CourseExplorer
        courses={visibleCourses}
        categories={data.categories}
        locale={locale}
      />
    </div>
  );
}
