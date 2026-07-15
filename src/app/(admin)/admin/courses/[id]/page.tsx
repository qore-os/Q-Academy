import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  Eye,
  FilePenLine,
  ShieldCheck,
  UsersRound,
} from "lucide-react";
import { CourseBuilder } from "@/components/admin/course-builder";
import { CourseChangeOverview } from "@/components/admin/course-change-overview";
import { CourseLifecycleActions } from "@/components/admin/course-lifecycle-actions";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClassName } from "@/components/ui/button";
import {
  toggleCourseStatusAction,
} from "@/lib/actions";
import { getAdminCourseChangeOverview } from "@/lib/course-change-service";
import { requireCoursePermission } from "@/lib/course-permissions";
import { getCourseBuilderData } from "@/lib/data";
import { getMainPageDictionary } from "@/lib/i18n/main-pages";
import { resolveUserLocale } from "@/lib/i18n/server";
import { stockImageProviderStatus } from "@/lib/stock-image-provider";

export default async function CourseBuilderPage({
  params,
}: PageProps<"/admin/courses/[id]">) {
  const { id } = await params;
  const { user, permission } = await requireCoursePermission(id, "edit");
  const canManageCourse = permission === "manage";
  const locale = await resolveUserLocale(user);
  const [data, changeOverview] = await Promise.all([
    getCourseBuilderData(id, user.organizationId, user),
    getAdminCourseChangeOverview(id, user.organizationId, locale),
  ]);
  if (!data || !changeOverview) notFound();
  const copy = getMainPageDictionary(locale).admin.courseEditor;
  const toggle = toggleCourseStatusAction.bind(null, data.course.id);
  return (
    <div className="mx-auto max-w-[1600px] space-y-5">
      <header className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <Link
            href="/admin/courses"
            className="focus-ring mt-0.5 grid size-9 shrink-0 place-items-center rounded-md border border-[#dfe4e8] bg-white text-[#66727f] hover:bg-[#f1f3f5]"
            aria-label={copy.backToCourses}
          >
            <ArrowLeft className="size-4" />
          </Link>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-xl font-bold text-[#1d2b38]">
                {data.course.title}
              </h1>
              <Badge
                tone={data.course.status === "published" ? "teal" : "amber"}
              >
                {
                  copy.status[
                    data.course.status as "draft" | "published" | "archived"
                  ]
                }
              </Badge>
            </div>
            <p className="mt-1 text-xs text-[#74818c]">
              {data.course.categoryName ?? copy.uncategorized} |{" "}
              {copy.modules(data.modules.length)}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {user.role === "owner" || user.role === "admin" ? (
            <>
              <Link
                href={`/admin/courses/${data.course.id}/team`}
                className={buttonClassName({ variant: "secondary" })}
              >
                <UsersRound className="size-4" />
                {copy.teamPermissions}
              </Link>
              <Link
                href={`/admin/courses/${data.course.id}/access`}
                className={buttonClassName({ variant: "secondary" })}
              >
                <ShieldCheck className="size-4" />
                {copy.moduleAccess}
              </Link>
            </>
          ) : null}
          <Link
            href={`/admin/courses/${data.course.id}/preview`}
            className={buttonClassName({ variant: "secondary" })}
          >
            <Eye className="size-4" />
            {copy.memberPreview}
          </Link>
          {canManageCourse && data.course.status === "published" ? (
            <form action={toggle}>
              <input type="hidden" name="locale" value={locale} />
              <Button type="submit" variant="secondary">
                <FilePenLine className="size-4" />
                {copy.moveToDraft}
              </Button>
            </form>
          ) : null}
          {canManageCourse ? (
            <CourseLifecycleActions
              courseId={data.course.id}
              status={data.course.status}
              locale={locale}
            />
          ) : null}
          <CourseChangeOverview
            courseId={data.course.id}
            courseStatus={data.course.status}
            overview={changeOverview}
            canPublishCourse={
              canManageCourse && data.course.status !== "archived"
            }
            locale={locale}
          />
        </div>
      </header>
      <CourseBuilder
        data={data}
        canViewGlobalAnalytics={user.role === "owner" || user.role === "admin"}
        changeGroups={changeOverview.comparison?.groups.map(
          (group) => group.key,
        )}
        stockImagesEnabled={stockImageProviderStatus().enabled}
        locale={locale}
      />
    </div>
  );
}
