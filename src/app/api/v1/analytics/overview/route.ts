import { and, asc, count, desc, eq, gte, sql } from "drizzle-orm";
import { db } from "@/db";
import { activityEvents, courses, enrollments, events, lessonLearningTimeSessions, submissions, users } from "@/db/schema";
import { apiOptions, handleApi } from "@/lib/api/handler";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

export async function GET(request: Request) {
  return handleApi(request, { scopes: ["analytics:read"], action: "analytics.overview", resourceType: "analytics" }, async (context) => {
    const since = new Date(Date.now() - 29 * 24 * 60 * 60 * 1000);
    const [memberStats, courseStats, enrollmentStats, learningTimeStats, submissionStats, eventStats, coursePerformance, activity] = await Promise.all([
      db.select({
        total: count(users.id),
        active: sql<number>`count(*) filter (where ${users.status} = 'active')`,
        invited: sql<number>`count(*) filter (where ${users.status} = 'invited')`,
        trainers: sql<number>`count(*) filter (where ${users.role} in ('owner', 'admin', 'trainer'))`,
      }).from(users).where(eq(users.organizationId, context.organizationId)),
      db.select({
        total: count(courses.id),
        published: sql<number>`count(*) filter (where ${courses.status} = 'published')`,
        drafts: sql<number>`count(*) filter (where ${courses.status} = 'draft')`,
      }).from(courses).where(eq(courses.organizationId, context.organizationId)),
      db.select({
        total: count(enrollments.id),
        averageProgress: sql<number>`coalesce(avg(${enrollments.progress}), 0)`,
        completed: sql<number>`count(*) filter (where ${enrollments.status} = 'completed')`,
        active: sql<number>`count(*) filter (where ${enrollments.status} = 'in_progress')`,
      }).from(enrollments).innerJoin(courses, and(eq(courses.id, enrollments.courseId), eq(courses.organizationId, context.organizationId))),
      db.select({
        activeSeconds: sql<number>`coalesce(sum(${lessonLearningTimeSessions.activeSeconds}), 0)`.mapWith(Number),
      }).from(lessonLearningTimeSessions).where(eq(lessonLearningTimeSessions.organizationId, context.organizationId)),
      db.select({
        total: count(submissions.id),
        waitingForReview: sql<number>`count(*) filter (where ${submissions.status} in ('open', 'in_review'))`,
        revision: sql<number>`count(*) filter (where ${submissions.status} = 'revision')`,
        approved: sql<number>`count(*) filter (where ${submissions.status} = 'approved')`,
        averageScore: sql<number>`coalesce(avg(${submissions.score}), 0)`,
      }).from(submissions).where(eq(submissions.organizationId, context.organizationId)),
      db.select({ upcoming: count(events.id) }).from(events).where(and(eq(events.organizationId, context.organizationId), gte(events.startsAt, new Date()))),
      db.select({
        id: courses.id,
        title: courses.title,
        status: courses.status,
        enrollments: count(enrollments.id),
        averageProgress: sql<number>`coalesce(avg(${enrollments.progress}), 0)`,
        completions: sql<number>`count(*) filter (where ${enrollments.status} = 'completed')`,
      }).from(courses).leftJoin(enrollments, eq(enrollments.courseId, courses.id)).where(eq(courses.organizationId, context.organizationId)).groupBy(courses.id).orderBy(desc(count(enrollments.id)), asc(courses.title)).limit(10),
      db.select({
        date: sql<string>`to_char(date_trunc('day', ${activityEvents.createdAt}), 'YYYY-MM-DD')`,
        count: count(activityEvents.id),
      }).from(activityEvents).where(and(eq(activityEvents.organizationId, context.organizationId), gte(activityEvents.createdAt, since))).groupBy(sql`date_trunc('day', ${activityEvents.createdAt})`).orderBy(asc(sql`date_trunc('day', ${activityEvents.createdAt})`)),
    ]);
    const enrollment = enrollmentStats[0];
    const submission = submissionStats[0];
    return {
      data: {
        members: memberStats[0],
        courses: courseStats[0],
        enrollments: { ...enrollment, averageProgress: Number(enrollment?.averageProgress ?? 0) },
        learningTime: learningTimeStats[0] ?? { activeSeconds: 0 },
        submissions: { ...submission, averageScore: Number(submission?.averageScore ?? 0) },
        upcomingEvents: eventStats[0]?.upcoming ?? 0,
        coursePerformance: coursePerformance.map((row) => ({ ...row, averageProgress: Number(row.averageProgress) })),
        activity,
        generatedAt: new Date().toISOString(),
      },
    };
  });
}
