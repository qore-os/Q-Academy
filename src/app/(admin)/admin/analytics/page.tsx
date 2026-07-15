import {
  Award,
  BookOpenCheck,
  Clock3,
  Download,
  Target,
  TrendingUp,
  Users,
} from "lucide-react";
import { AnalyticsMemberTable } from "@/components/admin/analytics-member-table";
import { ActivityChart } from "@/components/charts/activity-chart";
import { ProgressRing } from "@/components/charts/progress-ring";
import { buttonClassName } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { getAdminAnalyticsData } from "@/lib/admin-analytics";
import { requireTeamPermission } from "@/lib/auth";
import { getMainPageDictionary } from "@/lib/i18n/main-pages";
import { resolveUserLocale } from "@/lib/i18n/server";
import { formatLearningTime } from "@/lib/utils";

export default async function AnalyticsPage() {
  const user = await requireTeamPermission("analytics.view");
  const [data, locale] = await Promise.all([
    getAdminAnalyticsData(user.organizationId),
    resolveUserLocale(user),
  ]);
  const copy = getMainPageDictionary(locale).admin.analytics;
  const canReset = user.role === "owner" || user.role === "admin";

  return (
    <div className="mx-auto max-w-[1500px] space-y-6">
      <PageHeader
        eyebrow={copy.eyebrow}
        title={copy.title}
        description={copy.description}
        actions={canReset ? (
          <a
            download="q-academy-kursbericht.csv"
            href="/admin/analytics/export"
            className={buttonClassName({ variant: "secondary" })}
          >
            <Download className="size-4" />
            {copy.exportReport}
          </a>
        ) : undefined}
      />

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          {
            icon: Users,
            label: copy.activeAssignments,
            value: data.overview.activeAssignments,
            detail: copy.activeInProgress(data.overview.activeEnrollments),
            color: "text-[#167e74] bg-[#e9f8f6]",
          },
          {
            icon: Target,
            label: copy.averageProgress,
            value: `${data.overview.averageProgress}%`,
            detail: copy.acrossActiveAssignments,
            color: "text-[#365f8d] bg-[#eef3f9]",
          },
          {
            icon: Award,
            label: copy.completions,
            value: data.overview.completedEnrollmentsLast30Days,
            detail: copy.lastThirtyDays,
            color: "text-[#8d6a12] bg-[#fbf6e7]",
          },
          {
            icon: Clock3,
            label: copy.activeLearningTime,
            value: formatLearningTime(
              data.overview.activeLearningSecondsLast14Days,
              locale,
            ),
            detail: copy.measuredLastFourteenDays,
            color: "text-[#b84e42] bg-[#fdf0ee]",
          },
        ].map((item) => {
          const Icon = item.icon;
          return (
            <article className="panel flex items-center gap-4 p-4" key={item.label}>
              <span
                className={`grid size-11 shrink-0 place-items-center rounded-md ${item.color}`}
              >
                <Icon className="size-5" />
              </span>
              <div className="min-w-0">
                <p className="text-[11px] text-[#71808b]">{item.label}</p>
                <p className="mt-0.5 text-xl font-bold text-[#243444]">
                  {item.value}
                </p>
                <p className="mt-0.5 text-[10px] leading-4 text-[#8a949d]">
                  {item.detail}
                </p>
              </div>
            </article>
          );
        })}
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.6fr)]">
        <article className="panel min-w-0 p-5">
          <div>
            <h2 className="text-base font-bold text-[#243444]">
              {copy.activityLog}
            </h2>
            <p className="mt-1 text-xs text-[#71808b]">
              {copy.activityLogDescription}
            </p>
          </div>
          <ActivityChart
            data={data.activity}
            ariaLabel={copy.activeLearnersByDay}
            emptyLabel={copy.noActivityData}
            seriesLabel={copy.activeLearners}
            locale={locale}
            className="mt-2"
          />
        </article>
        <article className="panel flex flex-col items-center justify-center p-5 text-center">
          <ProgressRing
            value={data.overview.averageProgress}
            size={150}
            label={copy.progress}
          />
          <h2 className="mt-4 text-base font-bold text-[#243444]">
            {copy.overallProgress}
          </h2>
          <p className="mt-1 max-w-xs text-xs leading-5 text-[#71808b]">
            {copy.overallProgressDescription}
          </p>
        </article>
      </section>

      <section className="panel overflow-hidden">
        <div className="border-b border-[#e8ebee] px-5 py-4">
          <h2 className="text-base font-bold text-[#243444]">
            {copy.liveCoursePerformance}
          </h2>
          <p className="mt-1 text-xs text-[#71808b]">
            {copy.liveCoursePerformanceDescription}
          </p>
        </div>
        {data.courses.length ? (
          <div className="grid gap-4 p-5 md:grid-cols-2">
            {data.courses.map((course) => (
              <div
                key={course.id}
                className="flex items-center gap-4 rounded-md border border-[#e1e5e8] p-4"
              >
                <BookOpenCheck className="size-5 shrink-0 text-[#4f7cac]" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-[#354555]">
                    {course.title}
                  </p>
                  <p className="mt-1 text-xs text-[#7a8690]">
                    {copy.courseMetrics(
                      course.learners,
                      course.completions,
                      course.averageProgress,
                    )}
                  </p>
                  <p className="mt-1 text-[11px] font-medium text-[#52606d]">
                    {copy.activeTime(
                      formatLearningTime(course.activeLearningSeconds, locale),
                    )}
                  </p>
                </div>
                <TrendingUp className="size-4 shrink-0 text-[#2bb7a9]" />
              </div>
            ))}
          </div>
        ) : (
          <p className="px-5 py-10 text-center text-sm text-[#7a8690]">
            {copy.noLiveCourses}
          </p>
        )}
      </section>

      <AnalyticsMemberTable
        members={data.members}
        canReset={canReset}
        locale={locale}
      />
    </div>
  );
}
