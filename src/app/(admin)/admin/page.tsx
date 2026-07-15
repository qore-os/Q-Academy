import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import {
  ArrowRight,
  BookOpenCheck,
  CheckSquare,
  Clock3,
  Plus,
  Sparkles,
  TrendingUp,
  UserPlus,
  Users,
} from "lucide-react";
import { ActivityChart } from "@/components/charts/activity-chart";
import { Badge } from "@/components/ui/badge";
import { buttonClassName } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Progress } from "@/components/ui/progress";
import { requireAdmin } from "@/lib/auth";
import { courseCoverImageProps } from "@/lib/course-cover";
import { getAdminDashboardData } from "@/lib/data";
import { formatDateTime } from "@/lib/utils";
import { getCoreDictionary } from "@/lib/i18n/dictionaries";
import { getMainPageDictionary } from "@/lib/i18n/main-pages";
import { resolveUserLocale } from "@/lib/i18n/server";
import { getSubmissionReviewCopy } from "@/lib/i18n/submission-review";
import { getTeamAccessForUser } from "@/lib/team-permissions";
import { teamPermissionAllows } from "@/lib/team-permission-policy";

export async function generateMetadata(): Promise<Metadata> {
  const user = await requireAdmin();
  const locale = await resolveUserLocale(user);
  return { title: getCoreDictionary(locale).navigation.items.overview };
}

export default async function AdminDashboardPage() {
  const user = await requireAdmin();
  if (user.role === "trainer") redirect("/admin/courses");
  const teamAccess = await getTeamAccessForUser(user);
  const canViewDashboard =
    teamPermissionAllows(teamAccess.permissions, "members.view") &&
    teamPermissionAllows(teamAccess.permissions, "courses.view") &&
    teamPermissionAllows(teamAccess.permissions, "analytics.view");
  if (!canViewDashboard) {
    const destination = [
      ["members.view", "/admin/members"],
      ["courses.view", "/admin/courses"],
      ["community.view", "/admin/community"],
      ["events.view", "/admin/events"],
      ["analytics.view", "/admin/analytics"],
      ["settings.view", "/admin/settings"],
      ["integrations.view", "/admin/integrations"],
      ["api.view", "/admin/api"],
      ["ai.view", "/admin/ai"],
    ].find(([permission]) =>
      teamPermissionAllows(
        teamAccess.permissions,
        permission as Parameters<typeof teamPermissionAllows>[1],
      ),
    )?.[1];
    redirect(destination ?? "/academy");
  }
  const [data, locale] = await Promise.all([
    getAdminDashboardData(user.organizationId),
    resolveUserLocale(user),
  ]);
  const pageCopy = getCoreDictionary(locale).experience.admin;
  const mainPageCopy = getMainPageDictionary(locale).admin;
  const dashboardCopy = mainPageCopy.dashboard;
  const submissionStatusCopy = getSubmissionReviewCopy(locale).center.statuses;
  const canManageMembers = teamPermissionAllows(
    teamAccess.permissions,
    "members.manage",
  );
  const stats = [
    {
      label: pageCopy.members,
      value: data.stats.members,
      detail: dashboardCopy.newThisMonth(data.stats.newMembersThisMonth),
      icon: Users,
      tone: "bg-[#e9f8f6] text-[#167e74]",
    },
    {
      label: pageCopy.courses,
      value: data.stats.courses,
      detail: dashboardCopy.liveCourses(data.stats.publishedCourses),
      icon: BookOpenCheck,
      tone: "bg-[#eef3f9] text-[#365f8d]",
    },
    {
      label: pageCopy.submissions,
      value: data.stats.openSubmissions,
      detail: dashboardCopy.submissionsToday(data.stats.submissionsToday),
      icon: CheckSquare,
      tone: "bg-[#fbf6e7] text-[#8d6a12]",
    },
    {
      label: pageCopy.activePaths,
      value: data.stats.activeEnrollments,
      detail: dashboardCopy.runningEnrollments,
      icon: TrendingUp,
      tone: "bg-[#fdf0ee] text-[#b84e42]",
    },
  ];

  return (
    <div className="mx-auto max-w-[1500px] space-y-6">
      <PageHeader
        eyebrow={pageCopy.eyebrow}
        title={pageCopy.greeting(user.firstName)}
        description={pageCopy.description}
        actions={
          <>
            {canManageMembers ? (
              <Link
                href="/admin/members"
                className={buttonClassName({ variant: "secondary" })}
              >
                <UserPlus className="size-4" />
                {pageCopy.invite}
              </Link>
            ) : null}
            <Link href="/admin/courses" className={buttonClassName()}>
              <Plus className="size-4" />
              {pageCopy.createCourse}
            </Link>
          </>
        }
      />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <article
              key={stat.label}
              className="panel flex items-center gap-4 p-4"
            >
              <span
                className={`grid size-11 shrink-0 place-items-center rounded-md ${stat.tone}`}
              >
                <Icon className="size-5" />
              </span>
              <div className="min-w-0">
                <p className="text-[11px] font-semibold text-[#6e7a84]">
                  {stat.label}
                </p>
                <p className="mt-0.5 text-2xl font-bold text-[#1c2b38]">
                  {stat.value}
                </p>
                <p className="mt-0.5 truncate text-[10px] text-[#8a949d]">
                  {stat.detail}
                </p>
              </div>
            </article>
          );
        })}
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(340px,0.75fr)]">
        <article className="panel min-w-0 p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-base font-bold text-[#243444]">
                {dashboardCopy.learningActivity}
              </h2>
              <p className="mt-1 text-xs text-[#71808b]">
                {dashboardCopy.lastFourteenDays}
              </p>
            </div>
            <Badge tone="teal">
              <span className="status-live-dot mr-1.5 size-1.5 rounded-full bg-[#2bb7a9]" />
              {dashboardCopy.current}
            </Badge>
          </div>
          <ActivityChart
            data={data.activity}
            variant="bar"
            ariaLabel={mainPageCopy.analytics.activeLearnersByDay}
            emptyLabel={mainPageCopy.analytics.noActivityData}
            seriesLabel={mainPageCopy.analytics.activeLearners}
            locale={locale}
            className="mt-2"
          />
        </article>
        <article className="panel overflow-hidden">
          <div className="flex items-center justify-between border-b border-[#e8ebee] px-5 py-4">
            <div>
              <h2 className="text-base font-bold text-[#243444]">
                {dashboardCopy.quickActions}
              </h2>
              <p className="mt-1 text-xs text-[#71808b]">{dashboardCopy.frequentTasks}</p>
            </div>
            <Sparkles className="size-5 text-[#d6a536]" />
          </div>
          <div className="divide-y divide-[#edf0f2]">
            {[
              {
                href: "/admin/courses",
                title: dashboardCopy.createContent,
                copy: dashboardCopy.createContentDescription,
                icon: BookOpenCheck,
                color: "text-[#2b9188] bg-[#e9f8f6]",
              },
              {
                href: "/admin/tasks",
                title: dashboardCopy.reviewSubmissions,
                copy: dashboardCopy.waitingAnswers(data.stats.openSubmissions),
                icon: CheckSquare,
                color: "text-[#b84e42] bg-[#fdf0ee]",
              },
              {
                href: "/admin/ai",
                title: dashboardCopy.configureAgent,
                copy: dashboardCopy.agentDescription,
                icon: Sparkles,
                color: "text-[#365f8d] bg-[#eef3f9]",
              },
            ].map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className="focus-ring flex items-center gap-3 px-5 py-4 hover:bg-[#fafbfb]"
                >
                  <span
                    className={`grid size-9 shrink-0 place-items-center rounded-md ${item.color}`}
                  >
                    <Icon className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <strong className="block text-xs text-[#354555]">
                      {item.title}
                    </strong>
                    <span className="mt-0.5 block text-[10px] text-[#81909b]">
                      {item.copy}
                    </span>
                  </span>
                  <ArrowRight className="size-4 text-[#8b959e]" />
                </Link>
              );
            })}
          </div>
        </article>
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(380px,0.9fr)]">
        <article className="panel overflow-hidden">
          <div className="flex items-center justify-between border-b border-[#e8ebee] px-5 py-4">
            <div>
              <h2 className="text-base font-bold text-[#243444]">
                {dashboardCopy.recentSubmissions}
              </h2>
              <p className="mt-1 text-xs text-[#71808b]">
                {dashboardCopy.recentSubmissionsDescription}
              </p>
            </div>
            <Link
              href="/admin/tasks"
              className="text-xs font-semibold text-[#2b9188] hover:text-[#176f68]"
            >
              {dashboardCopy.showAll}
            </Link>
          </div>
          <div className="divide-y divide-[#edf0f2]">
            {data.recentSubmissions.map((submission) => (
              <Link
                href="/admin/tasks"
                key={submission.id}
                className="focus-ring grid gap-2 px-5 py-3 hover:bg-[#fafbfb] sm:grid-cols-[minmax(0,1fr)_160px_auto] sm:items-center"
              >
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold text-[#354555]">
                    {submission.title}
                  </p>
                  <p className="mt-0.5 truncate text-[10px] text-[#7c8790]">
                    {submission.firstName} {submission.lastName} ·{" "}
                    {submission.courseTitle}
                  </p>
                </div>
                <span className="flex items-center gap-1.5 text-[10px] text-[#7c8790]">
                  <Clock3 className="size-3" />
                  {formatDateTime(submission.submittedAt, locale)}
                </span>
                <Badge
                  tone={
                    submission.status === "approved"
                      ? "teal"
                      : submission.status === "revision"
                        ? "coral"
                        : "amber"
                  }
                >
                  {submissionStatusCopy[submission.status]}
                </Badge>
              </Link>
            ))}
            {!data.recentSubmissions.length ? (
              <EmptyState
                icon={CheckSquare}
                title={dashboardCopy.noSubmissions}
                description={dashboardCopy.noSubmissionsDescription}
                action={
                  <Link
                    href="/admin/tasks"
                    className={buttonClassName({ variant: "secondary", size: "sm" })}
                  >
                    {dashboardCopy.tasks}
                    <ArrowRight className="size-3.5" />
                  </Link>
                }
              />
            ) : null}
          </div>
        </article>
        <article className="panel overflow-hidden">
          <div className="border-b border-[#e8ebee] px-5 py-4">
            <h2 className="text-base font-bold text-[#243444]">
              {dashboardCopy.coursePerformance}
            </h2>
            <p className="mt-1 text-xs text-[#71808b]">
              {dashboardCopy.averageProgress}
            </p>
          </div>
          <div className="divide-y divide-[#edf0f2]">
            {data.performance.map((course) => (
              <Link
                href={`/admin/courses/${course.id}`}
                key={course.id}
                className="focus-ring flex items-center gap-3 px-5 py-3.5 hover:bg-[#fafbfb]"
              >
                <div className="relative h-11 w-[70px] shrink-0 overflow-hidden rounded">
                  <Image
                    {...courseCoverImageProps(course.coverImage)}
                    alt=""
                    fill
                    sizes="70px"
                    className="object-cover"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-3">
                    <p className="truncate text-xs font-semibold text-[#354555]">
                      {course.title}
                    </p>
                    <span className="text-xs font-bold text-[#2b9188]">
                      {course.averageProgress}%
                    </span>
                  </div>
                  <p className="mt-0.5 text-[10px] text-[#7c8790]">
                    {dashboardCopy.learners(course.learners)}
                  </p>
                  <Progress value={course.averageProgress} className="mt-2" />
                </div>
              </Link>
            ))}
            {!data.performance.length ? (
              <EmptyState
                icon={BookOpenCheck}
                title={dashboardCopy.noCourseData}
                description={dashboardCopy.noCourseDataDescription}
                action={
                  <Link
                    href="/admin/courses"
                    className={buttonClassName({ variant: "secondary", size: "sm" })}
                  >
                    {dashboardCopy.manageCourses}
                    <ArrowRight className="size-3.5" />
                  </Link>
                }
              />
            ) : null}
          </div>
        </article>
      </section>
    </div>
  );
}
