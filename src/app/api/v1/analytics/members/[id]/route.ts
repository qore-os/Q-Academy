import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { activityEvents, courses, enrollments, lessonLearningTimeSessions, lessonProgress, submissions, users } from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import { apiOptions, handleApi } from "@/lib/api/handler";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleApi(request, { scopes: ["analytics:read"], action: "analytics.member", resourceType: "member" }, async (context) => {
    const [member] = await db.select({ id: users.id, email: users.email, firstName: users.firstName, lastName: users.lastName, role: users.role, status: users.status, points: users.points, createdAt: users.createdAt, lastLoginAt: users.lastLoginAt }).from(users).where(and(eq(users.id, id), eq(users.organizationId, context.organizationId))).limit(1);
    if (!member) throw new ApiError(404, "not_found", "Mitglied nicht gefunden.");
    const [memberEnrollments, lessonStats, learningTimeByCourse, memberSubmissions, recentActivity] = await Promise.all([
      db.select({ courseId: courses.id, courseTitle: courses.title, courseSlug: courses.slug, status: enrollments.status, progress: enrollments.progress, enrolledAt: enrollments.enrolledAt, lastAccessedAt: enrollments.lastAccessedAt, completedAt: enrollments.completedAt }).from(enrollments).innerJoin(courses, and(eq(courses.id, enrollments.courseId), eq(courses.organizationId, context.organizationId))).where(eq(enrollments.userId, id)).orderBy(desc(enrollments.lastAccessedAt)),
      db.select({ total: sql<number>`count(*)`, completed: sql<number>`count(*) filter (where ${lessonProgress.status} = 'completed')`, averagePercent: sql<number>`coalesce(avg(${lessonProgress.percent}), 0)` }).from(lessonProgress).where(eq(lessonProgress.userId, id)),
      db.select({ courseId: lessonLearningTimeSessions.courseId, activeSeconds: sql<number>`coalesce(sum(${lessonLearningTimeSessions.activeSeconds}), 0)`.mapWith(Number) }).from(lessonLearningTimeSessions).where(and(eq(lessonLearningTimeSessions.organizationId, context.organizationId), eq(lessonLearningTimeSessions.userId, id))).groupBy(lessonLearningTimeSessions.courseId),
      db.select({ id: submissions.id, title: submissions.title, courseId: submissions.courseId, status: submissions.status, score: submissions.score, submittedAt: submissions.submittedAt, reviewedAt: submissions.reviewedAt }).from(submissions).where(and(eq(submissions.organizationId, context.organizationId), eq(submissions.userId, id))).orderBy(desc(submissions.submittedAt)),
      db.select({ id: activityEvents.id, type: activityEvents.type, entityType: activityEvents.entityType, entityId: activityEvents.entityId, metadata: activityEvents.metadata, createdAt: activityEvents.createdAt }).from(activityEvents).where(and(eq(activityEvents.organizationId, context.organizationId), eq(activityEvents.userId, id))).orderBy(desc(activityEvents.createdAt)).limit(50),
    ]);
    const activeSecondsByCourse = new Map(learningTimeByCourse.map((row) => [row.courseId, row.activeSeconds]));
    return { data: { member, enrollments: memberEnrollments.map((enrollment) => ({ ...enrollment, activeLearningSeconds: activeSecondsByCourse.get(enrollment.courseId) ?? 0 })), learningTime: { activeSeconds: learningTimeByCourse.reduce((total, row) => total + row.activeSeconds, 0) }, lessonProgress: { ...lessonStats[0], averagePercent: Number(lessonStats[0]?.averagePercent ?? 0) }, submissions: memberSubmissions, recentActivity }, resourceId: id };
  });
}
