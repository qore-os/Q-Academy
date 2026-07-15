import type { Metadata } from "next";
import { SubmissionCenter } from "@/components/admin/submission-center";
import { FeedbackCenter } from "@/components/admin/feedback-center";
import { ExamOperationsCenter } from "@/components/admin/exam-operations-center";
import { PageHeader } from "@/components/ui/page-header";
import { requireAdmin } from "@/lib/auth";
import {
  coursePermissionAllows,
  coursePermissionMapForUser,
} from "@/lib/course-permissions";
import { getAdminFeedback, getAdminSubmissions } from "@/lib/data";
import { listAdminExamOperations } from "@/lib/admin/exam-operations";
import { getMainPageDictionary } from "@/lib/i18n/main-pages";
import { resolveUserLocale } from "@/lib/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const user = await requireAdmin();
  const locale = await resolveUserLocale(user);
  return { title: getMainPageDictionary(locale).admin.headers.tasks.title };
}

export default async function TasksPage() {
  const user = await requireAdmin();
  const [submissions, feedback, examAttempts, locale] = await Promise.all([
    getAdminSubmissions(user.organizationId),
    getAdminFeedback(user.organizationId),
    listAdminExamOperations(user),
    resolveUserLocale(user),
  ]);
  const copy = getMainPageDictionary(locale).admin.headers.tasks;
  const permissions = await coursePermissionMapForUser(user, [
    ...submissions.map((submission) => submission.courseId),
    ...feedback.flatMap((entry) => (entry.courseId ? [entry.courseId] : [])),
  ]);
  const visibleSubmissions = submissions.filter((submission) =>
    coursePermissionAllows(permissions.get(submission.courseId) ?? null, "edit"),
  );
  const visibleFeedback = feedback.filter((entry) =>
    entry.courseId
      ? coursePermissionAllows(permissions.get(entry.courseId) ?? null, "edit")
      : user.role === "owner" || user.role === "admin",
  );
  return (
    <div className="mx-auto max-w-[1500px] space-y-6">
      <PageHeader
        {...copy}
      />
      <ExamOperationsCenter attempts={examAttempts} locale={locale} />
      <SubmissionCenter submissions={visibleSubmissions} locale={locale} />
      <FeedbackCenter feedback={visibleFeedback} locale={locale} />
    </div>
  );
}
