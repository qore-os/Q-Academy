import { and, asc, count, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { courses, enrollments, lessonLearningTimeSessions, submissions, users } from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import { apiOptions, handleApi } from "@/lib/api/handler";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleApi(request, { scopes: ["analytics:read"], action: "analytics.course", resourceType: "course" }, async (context) => {
    const [course] = await db.select().from(courses).where(and(eq(courses.id, id), eq(courses.organizationId, context.organizationId))).limit(1);
    if (!course) throw new ApiError(404, "not_found", "Kurs nicht gefunden.");
    const [stats, learningTimeStats, submissionStats, members, memberLearningTime] = await Promise.all([
      db.select({
        enrollments: count(enrollments.id),
        averageProgress: sql<number>`coalesce(avg(${enrollments.progress}), 0)`,
        completed: sql<number>`count(*) filter (where ${enrollments.status} = 'completed')`,
        inProgress: sql<number>`count(*) filter (where ${enrollments.status} = 'in_progress')`,
        notStarted: sql<number>`count(*) filter (where ${enrollments.status} = 'not_started')`,
      }).from(enrollments).where(eq(enrollments.courseId, id)),
      db.select({ activeSeconds: sql<number>`coalesce(sum(${lessonLearningTimeSessions.activeSeconds}), 0)`.mapWith(Number) }).from(lessonLearningTimeSessions).where(and(eq(lessonLearningTimeSessions.organizationId, context.organizationId), eq(lessonLearningTimeSessions.courseId, id))),
      db.select({ total: count(submissions.id), averageScore: sql<number>`coalesce(avg(${submissions.score}), 0)`, waitingForReview: sql<number>`count(*) filter (where ${submissions.status} in ('open', 'in_review'))` }).from(submissions).where(and(eq(submissions.organizationId, context.organizationId), eq(submissions.courseId, id))),
      db.select({
        id: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
        email: users.email,
        status: enrollments.status,
        progress: enrollments.progress,
        enrolledAt: enrollments.enrolledAt,
        lastAccessedAt: enrollments.lastAccessedAt,
        completedAt: enrollments.completedAt,
      }).from(enrollments).innerJoin(users, and(eq(users.id, enrollments.userId), eq(users.organizationId, context.organizationId))).where(eq(enrollments.courseId, id)).orderBy(asc(users.lastName), asc(users.firstName)),
      db.select({ userId: lessonLearningTimeSessions.userId, activeSeconds: sql<number>`coalesce(sum(${lessonLearningTimeSessions.activeSeconds}), 0)`.mapWith(Number) }).from(lessonLearningTimeSessions).where(and(eq(lessonLearningTimeSessions.organizationId, context.organizationId), eq(lessonLearningTimeSessions.courseId, id))).groupBy(lessonLearningTimeSessions.userId),
    ]);
    const activeSecondsByMember = new Map(memberLearningTime.map((row) => [row.userId, row.activeSeconds]));
    return { data: { course, stats: { ...stats[0], averageProgress: Number(stats[0]?.averageProgress ?? 0), activeLearningSeconds: learningTimeStats[0]?.activeSeconds ?? 0 }, submissions: { ...submissionStats[0], averageScore: Number(submissionStats[0]?.averageScore ?? 0) }, members: members.map((member) => ({ ...member, activeLearningSeconds: activeSecondsByMember.get(member.id) ?? 0 })) }, resourceId: id };
  });
}
