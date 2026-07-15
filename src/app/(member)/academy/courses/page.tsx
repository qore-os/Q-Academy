import type { Metadata } from "next";
import { MemberCourseExplorer } from "@/components/academy/member-course-explorer";
import { PageHeader } from "@/components/ui/page-header";
import { requireUser } from "@/lib/auth";
import { getMemberCourses } from "@/lib/data";
import { getCoreDictionary } from "@/lib/i18n/dictionaries";
import { resolveUserLocale } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const user = await requireUser();
  const locale = await resolveUserLocale(user);
  return { title: getCoreDictionary(locale).experience.courses.title };
}

export default async function MemberCoursesPage() {
  const user = await requireUser();
  const [courses, locale] = await Promise.all([
    getMemberCourses(user.id, user.organizationId),
    resolveUserLocale(user),
  ]);
  const copy = getCoreDictionary(locale).experience.courses;
  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <PageHeader
        eyebrow={copy.eyebrow}
        title={copy.title}
        description={copy.description}
      />
      <MemberCourseExplorer courses={courses} locale={locale} />
    </div>
  );
}
