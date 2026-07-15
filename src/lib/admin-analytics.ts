import "server-only";

import { and, asc, count, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { subDays } from "date-fns";
import { db } from "@/db";
import {
  activityEvents,
  assessmentAttempts,
  courseCertificates,
  courseModules,
  courses,
  enrollments,
  lessonLearningTimeSessions,
  lessonProgress,
  lessons,
  modules,
  submissions,
  users,
} from "@/db/schema";

export type AdminAnalyticsEnrollment = {
  id: string;
  courseId: string;
  courseTitle: string;
  courseSlug: string;
  courseStatus: "draft" | "published" | "archived";
  accessActive: boolean;
  status: "not_started" | "in_progress" | "completed";
  progress: number;
  enrolledAt: Date;
  lastAccessedAt: Date | null;
  completedAt: Date | null;
  lessonProgressCount: number;
  assessmentAttemptCount: number;
  submissionCount: number;
  activeCertificateId: string | null;
  activeCertificateNumber: string | null;
  activeLearningSeconds: number;
};

export type AdminAnalyticsMember = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  status: "active" | "invited" | "disabled";
  department: string | null;
  assignedCourses: number;
  completedCourses: number;
  inProgressCourses: number;
  averageProgress: number;
  lastActivityAt: Date | null;
  lastLessonTitle: string | null;
  lastLessonAt: Date | null;
  measuredEventsLast30Days: number;
  estimatedCompletedMinutes: number;
  activeLearningSeconds: number;
  courses: AdminAnalyticsEnrollment[];
};

export type AdminAnalyticsCourse = {
  id: string;
  title: string;
  learners: number;
  completions: number;
  averageProgress: number;
  activeLearningSeconds: number;
};

export type AdminAnalyticsData = {
  overview: {
    activeAssignments: number;
    activeEnrollments: number;
    averageProgress: number;
    completedEnrollmentsLast30Days: number;
    estimatedCompletedMinutesLast14Days: number;
    activeLearningSecondsLast14Days: number;
  };
  activity: { day: string; active: number }[];
  courses: AdminAnalyticsCourse[];
  members: AdminAnalyticsMember[];
};

function toDate(value: Date | string | null | undefined) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function getAdminAnalyticsData(
  organizationId: string,
): Promise<AdminAnalyticsData> {
  const now = new Date();
  const thirtyDaysAgo = subDays(now, 30);
  const fourteenDaysAgo = subDays(now, 13);

  const [
    overviewRows,
    overviewLearningTimeRows,
    estimatedMinutesRows,
    activityRows,
    courseRows,
    courseLearningTimeRows,
    memberRows,
    enrollmentRows,
    memberActivityRows,
    memberLessonRows,
    courseProgressCountRows,
    learningTimeCountRows,
    assessmentCountRows,
    submissionCountRows,
  ] = await Promise.all([
    db
      .select({
        activeAssignments:
          sql<number>`count(*) filter (where ${enrollments.accessActive} = true)`.mapWith(
            Number,
          ),
        activeEnrollments:
          sql<number>`count(*) filter (where ${enrollments.accessActive} = true and ${enrollments.status} = 'in_progress')`.mapWith(
            Number,
          ),
        averageProgress:
          sql<number>`coalesce(round(avg(${enrollments.progress}) filter (where ${enrollments.accessActive} = true)), 0)`.mapWith(
            Number,
          ),
        completedEnrollmentsLast30Days:
          sql<number>`count(*) filter (where ${enrollments.status} = 'completed' and ${enrollments.completedAt} >= ${thirtyDaysAgo.toISOString()}::timestamptz)`.mapWith(
            Number,
          ),
      })
      .from(enrollments)
      .innerJoin(
        users,
        and(
          eq(users.id, enrollments.userId),
          eq(users.organizationId, organizationId),
          eq(users.role, "member"),
        ),
      )
      .innerJoin(
        courses,
        and(
          eq(courses.id, enrollments.courseId),
          eq(courses.organizationId, organizationId),
        ),
      ),
    db
      .select({
        value:
          sql<number>`coalesce(sum(${lessonLearningTimeSessions.activeSeconds}), 0)`.mapWith(
            Number,
          ),
      })
      .from(lessonLearningTimeSessions)
      .where(
        and(
          eq(lessonLearningTimeSessions.organizationId, organizationId),
          gte(lessonLearningTimeSessions.lastHeartbeatAt, fourteenDaysAgo),
        ),
      ),
    db
      .select({
        value:
          sql<number>`coalesce(sum(${lessons.durationMinutes}), 0)`.mapWith(
            Number,
          ),
      })
      .from(lessonProgress)
      .innerJoin(
        users,
        and(
          eq(users.id, lessonProgress.userId),
          eq(users.organizationId, organizationId),
          eq(users.role, "member"),
        ),
      )
      .innerJoin(lessons, eq(lessons.id, lessonProgress.lessonId))
      .innerJoin(
        modules,
        and(
          eq(modules.id, lessons.moduleId),
          eq(modules.organizationId, organizationId),
        ),
      )
      .where(
        and(
          eq(lessonProgress.status, "completed"),
          gte(lessonProgress.completedAt, fourteenDaysAgo),
        ),
      ),
    db
      .select({
        day: sql<string>`to_char(date_trunc('day', ${activityEvents.createdAt}), 'DD.MM')`,
        total: count(activityEvents.id),
      })
      .from(activityEvents)
      .where(
        and(
          eq(activityEvents.organizationId, organizationId),
          gte(activityEvents.createdAt, fourteenDaysAgo),
        ),
      )
      .groupBy(sql`date_trunc('day', ${activityEvents.createdAt})`)
      .orderBy(asc(sql`date_trunc('day', ${activityEvents.createdAt})`)),
    db
      .select({
        id: courses.id,
        title: courses.title,
        learners:
          sql<number>`count(${users.id}) filter (where ${enrollments.accessActive} = true)`.mapWith(
            Number,
          ),
        completions:
          sql<number>`count(${users.id}) filter (where ${enrollments.status} = 'completed')`.mapWith(
            Number,
          ),
        averageProgress:
          sql<number>`coalesce(round(avg(${enrollments.progress}) filter (where ${users.id} is not null and ${enrollments.accessActive} = true)), 0)`.mapWith(
            Number,
          ),
      })
      .from(courses)
      .leftJoin(enrollments, eq(enrollments.courseId, courses.id))
      .leftJoin(
        users,
        and(
          eq(users.id, enrollments.userId),
          eq(users.organizationId, organizationId),
          eq(users.role, "member"),
        ),
      )
      .where(
        and(
          eq(courses.organizationId, organizationId),
          eq(courses.status, "published"),
        ),
      )
      .groupBy(courses.id)
      .orderBy(desc(sql`avg(${enrollments.progress})`), asc(courses.title)),
    db
      .select({
        courseId: lessonLearningTimeSessions.courseId,
        value:
          sql<number>`coalesce(sum(${lessonLearningTimeSessions.activeSeconds}), 0)`.mapWith(
            Number,
          ),
      })
      .from(lessonLearningTimeSessions)
      .where(eq(lessonLearningTimeSessions.organizationId, organizationId))
      .groupBy(lessonLearningTimeSessions.courseId),
    db
      .select({
        id: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
        email: users.email,
        status: users.status,
        department: users.department,
        lastLoginAt: users.lastLoginAt,
      })
      .from(users)
      .where(
        and(
          eq(users.organizationId, organizationId),
          eq(users.role, "member"),
        ),
      )
      .orderBy(asc(users.lastName), asc(users.firstName)),
    db
      .select({
        id: enrollments.id,
        userId: enrollments.userId,
        courseId: courses.id,
        courseTitle: courses.title,
        courseSlug: courses.slug,
        courseStatus: courses.status,
        accessActive: enrollments.accessActive,
        status: enrollments.status,
        progress: enrollments.progress,
        enrolledAt: enrollments.enrolledAt,
        lastAccessedAt: enrollments.lastAccessedAt,
        completedAt: enrollments.completedAt,
        activeCertificateId: courseCertificates.id,
        activeCertificateNumber: courseCertificates.certificateNumber,
      })
      .from(enrollments)
      .innerJoin(
        users,
        and(
          eq(users.id, enrollments.userId),
          eq(users.organizationId, organizationId),
          eq(users.role, "member"),
        ),
      )
      .innerJoin(
        courses,
        and(
          eq(courses.id, enrollments.courseId),
          eq(courses.organizationId, organizationId),
        ),
      )
      .leftJoin(
        courseCertificates,
        and(
          eq(courseCertificates.organizationId, organizationId),
          eq(courseCertificates.userId, enrollments.userId),
          eq(courseCertificates.courseId, courses.id),
          isNull(courseCertificates.revokedAt),
        ),
      )
      .orderBy(asc(courses.title)),
    db
      .select({
        userId: activityEvents.userId,
        lastActivityAt: sql<Date | null>`max(${activityEvents.createdAt})`,
        measuredEventsLast30Days:
          sql<number>`count(*) filter (where ${activityEvents.createdAt} >= ${thirtyDaysAgo.toISOString()}::timestamptz)`.mapWith(
            Number,
          ),
      })
      .from(activityEvents)
      .innerJoin(
        users,
        and(
          eq(users.id, activityEvents.userId),
          eq(users.organizationId, organizationId),
          eq(users.role, "member"),
        ),
      )
      .where(eq(activityEvents.organizationId, organizationId))
      .groupBy(activityEvents.userId),
    db
      .select({
        userId: lessonProgress.userId,
        title: lessons.title,
        durationMinutes: lessons.durationMinutes,
        status: lessonProgress.status,
        startedAt: lessonProgress.startedAt,
        completedAt: lessonProgress.completedAt,
      })
      .from(lessonProgress)
      .innerJoin(
        users,
        and(
          eq(users.id, lessonProgress.userId),
          eq(users.organizationId, organizationId),
          eq(users.role, "member"),
        ),
      )
      .innerJoin(lessons, eq(lessons.id, lessonProgress.lessonId))
      .innerJoin(
        modules,
        and(
          eq(modules.id, lessons.moduleId),
          eq(modules.organizationId, organizationId),
        ),
      ),
    db
      .select({
        userId: lessonProgress.userId,
        courseId: courseModules.courseId,
        value: count(lessonProgress.id),
      })
      .from(lessonProgress)
      .innerJoin(
        users,
        and(
          eq(users.id, lessonProgress.userId),
          eq(users.organizationId, organizationId),
          eq(users.role, "member"),
        ),
      )
      .innerJoin(lessons, eq(lessons.id, lessonProgress.lessonId))
      .innerJoin(
        modules,
        and(
          eq(modules.id, lessons.moduleId),
          eq(modules.organizationId, organizationId),
        ),
      )
      .innerJoin(courseModules, eq(courseModules.moduleId, modules.id))
      .innerJoin(
        courses,
        and(
          eq(courses.id, courseModules.courseId),
          eq(courses.organizationId, organizationId),
        ),
      )
      .groupBy(lessonProgress.userId, courseModules.courseId),
    db
      .select({
        userId: lessonLearningTimeSessions.userId,
        courseId: lessonLearningTimeSessions.courseId,
        value:
          sql<number>`coalesce(sum(${lessonLearningTimeSessions.activeSeconds}), 0)`.mapWith(
            Number,
          ),
      })
      .from(lessonLearningTimeSessions)
      .where(eq(lessonLearningTimeSessions.organizationId, organizationId))
      .groupBy(
        lessonLearningTimeSessions.userId,
        lessonLearningTimeSessions.courseId,
      ),
    db
      .select({
        userId: assessmentAttempts.userId,
        courseId: assessmentAttempts.courseId,
        value: count(assessmentAttempts.id),
      })
      .from(assessmentAttempts)
      .innerJoin(
        users,
        and(
          eq(users.id, assessmentAttempts.userId),
          eq(users.organizationId, organizationId),
          eq(users.role, "member"),
        ),
      )
      .where(eq(assessmentAttempts.organizationId, organizationId))
      .groupBy(assessmentAttempts.userId, assessmentAttempts.courseId),
    db
      .select({
        userId: submissions.userId,
        courseId: submissions.courseId,
        value: count(submissions.id),
      })
      .from(submissions)
      .innerJoin(
        users,
        and(
          eq(users.id, submissions.userId),
          eq(users.organizationId, organizationId),
          eq(users.role, "member"),
        ),
      )
      .where(eq(submissions.organizationId, organizationId))
      .groupBy(submissions.userId, submissions.courseId),
  ]);

  const courseMetricKey = (userId: string, courseId: string) =>
    `${userId}:${courseId}`;
  const courseProgressCounts = new Map(
    courseProgressCountRows.map((row) => [
      courseMetricKey(row.userId, row.courseId),
      Number(row.value),
    ]),
  );
  const assessmentCounts = new Map(
    assessmentCountRows.map((row) => [
      courseMetricKey(row.userId, row.courseId),
      Number(row.value),
    ]),
  );
  const learningTimeCounts = new Map(
    learningTimeCountRows.map((row) => [
      courseMetricKey(row.userId, row.courseId),
      Number(row.value),
    ]),
  );
  const courseLearningTime = new Map(
    courseLearningTimeRows.map((row) => [row.courseId, Number(row.value)]),
  );
  const submissionCounts = new Map(
    submissionCountRows.map((row) => [
      courseMetricKey(row.userId, row.courseId),
      Number(row.value),
    ]),
  );
  const memberActivity = new Map(
    memberActivityRows.flatMap((row) =>
      row.userId
        ? [
            [
              row.userId,
              {
                lastActivityAt: toDate(row.lastActivityAt),
                measuredEventsLast30Days: row.measuredEventsLast30Days,
              },
            ] as const,
          ]
        : [],
    ),
  );
  const memberLessons = new Map<
    string,
    {
      lastLessonTitle: string | null;
      lastLessonAt: Date | null;
      estimatedCompletedMinutes: number;
    }
  >();
  for (const lesson of memberLessonRows) {
    const aggregate = memberLessons.get(lesson.userId) ?? {
      lastLessonTitle: null,
      lastLessonAt: null,
      estimatedCompletedMinutes: 0,
    };
    const lessonAt = toDate(lesson.completedAt ?? lesson.startedAt);
    if (
      lessonAt &&
      (!aggregate.lastLessonAt || lessonAt > aggregate.lastLessonAt)
    ) {
      aggregate.lastLessonAt = lessonAt;
      aggregate.lastLessonTitle = lesson.title;
    }
    if (lesson.status === "completed") {
      aggregate.estimatedCompletedMinutes += lesson.durationMinutes;
    }
    memberLessons.set(lesson.userId, aggregate);
  }

  const enrollmentsByMember = new Map<string, AdminAnalyticsEnrollment[]>();
  for (const enrollment of enrollmentRows) {
    const enrolledAt = toDate(enrollment.enrolledAt);
    if (!enrolledAt) {
      throw new Error(`Enrollment ${enrollment.id} has no valid enrolledAt timestamp.`);
    }
    const memberEnrollments = enrollmentsByMember.get(enrollment.userId) ?? [];
    memberEnrollments.push({
      id: enrollment.id,
      courseId: enrollment.courseId,
      courseTitle: enrollment.courseTitle,
      courseSlug: enrollment.courseSlug,
      courseStatus: enrollment.courseStatus,
      accessActive: enrollment.accessActive,
      status: enrollment.status,
      progress: enrollment.progress,
      enrolledAt,
      lastAccessedAt: toDate(enrollment.lastAccessedAt),
      completedAt: toDate(enrollment.completedAt),
      lessonProgressCount:
        courseProgressCounts.get(
          courseMetricKey(enrollment.userId, enrollment.courseId),
        ) ?? 0,
      assessmentAttemptCount:
        assessmentCounts.get(
          courseMetricKey(enrollment.userId, enrollment.courseId),
        ) ?? 0,
      submissionCount:
        submissionCounts.get(
          courseMetricKey(enrollment.userId, enrollment.courseId),
        ) ?? 0,
      activeCertificateId: enrollment.activeCertificateId,
      activeCertificateNumber: enrollment.activeCertificateNumber,
      activeLearningSeconds:
        learningTimeCounts.get(
          courseMetricKey(enrollment.userId, enrollment.courseId),
        ) ?? 0,
    });
    enrollmentsByMember.set(enrollment.userId, memberEnrollments);
  }

  const overview = overviewRows[0];
  return {
    overview: {
      activeAssignments: overview?.activeAssignments ?? 0,
      activeEnrollments: overview?.activeEnrollments ?? 0,
      averageProgress: overview?.averageProgress ?? 0,
      completedEnrollmentsLast30Days:
        overview?.completedEnrollmentsLast30Days ?? 0,
      estimatedCompletedMinutesLast14Days:
        estimatedMinutesRows[0]?.value ?? 0,
      activeLearningSecondsLast14Days:
        overviewLearningTimeRows[0]?.value ?? 0,
    },
    activity: activityRows.map((item) => ({
      day: item.day,
      active: Number(item.total),
    })),
    courses: courseRows.map((course) => ({
      ...course,
      activeLearningSeconds: courseLearningTime.get(course.id) ?? 0,
    })),
    members: memberRows.map((member) => {
      const memberCourses = enrollmentsByMember.get(member.id) ?? [];
      const activeCourses = memberCourses.filter((course) => course.accessActive);
      const lessonStats = memberLessons.get(member.id) ?? {
        lastLessonTitle: null,
        lastLessonAt: null,
        estimatedCompletedMinutes: 0,
      };
      const activityStats = memberActivity.get(member.id);
      const activityCandidates = [
        toDate(member.lastLoginAt),
        activityStats?.lastActivityAt ?? null,
        lessonStats.lastLessonAt,
        ...memberCourses.map((course) => course.lastAccessedAt),
      ].filter((value): value is Date => value instanceof Date);
      const lastActivityAt = activityCandidates.length
        ? new Date(
            Math.max(...activityCandidates.map((value) => value.getTime())),
          )
        : null;
      return {
        id: member.id,
        firstName: member.firstName,
        lastName: member.lastName,
        email: member.email,
        status: member.status,
        department: member.department,
        assignedCourses: activeCourses.length,
        completedCourses: memberCourses.filter(
          (course) => course.status === "completed",
        ).length,
        inProgressCourses: activeCourses.filter(
          (course) => course.status === "in_progress",
        ).length,
        averageProgress: activeCourses.length
          ? Math.round(
              activeCourses.reduce((sum, course) => sum + course.progress, 0) /
                activeCourses.length,
            )
          : 0,
        lastActivityAt,
        lastLessonTitle: lessonStats.lastLessonTitle,
        lastLessonAt: lessonStats.lastLessonAt,
        measuredEventsLast30Days:
          activityStats?.measuredEventsLast30Days ?? 0,
        estimatedCompletedMinutes: lessonStats.estimatedCompletedMinutes,
        activeLearningSeconds: memberCourses.reduce(
          (total, course) => total + course.activeLearningSeconds,
          0,
        ),
        courses: memberCourses,
      };
    }),
  };
}

function csvCell(value: string | number) {
  const text = String(value);
  const inspected =
    typeof value === "string" ? text.replace(/^[ \uFEFF]*/, "") : text;
  const safeText =
    typeof value === "string" && /^[=+\-@\t\r\n]/.test(inspected)
      ? `'${text}`
      : text;
  return `"${safeText.replaceAll('"', '""')}"`;
}

function csvDate(value: Date | null) {
  return value?.toISOString() ?? "";
}

export function buildAdminAnalyticsCsv(members: AdminAnalyticsMember[]) {
  const rows: (string | number)[][] = [
    [
      "Mitglied",
      "E-Mail",
      "Mitgliedsstatus",
      "Kurs",
      "Zugriff",
      "Fortschrittsstatus",
      "Fortschritt Prozent",
      "Abgeschlossen am",
      "Letzte gemessene Aktivitaet",
      "Letzte Lektion",
      "Letzte Lektion am",
      "Protokollierte Ereignisse 30 Tage",
      "Aktive Lernzeit Sekunden",
      "Geschaetzter abgeschlossener Inhaltsumfang Minuten",
    ],
  ];

  for (const member of members) {
    const enrollments = member.courses.length ? member.courses : [null];
    for (const enrollment of enrollments) {
      rows.push([
        `${member.firstName} ${member.lastName}`.trim(),
        member.email,
        member.status,
        enrollment?.courseTitle ?? "",
        enrollment ? (enrollment.accessActive ? "aktiv" : "entzogen") : "",
        enrollment?.status ?? "nicht_zugewiesen",
        enrollment?.progress ?? 0,
        csvDate(enrollment?.completedAt ?? null),
        csvDate(member.lastActivityAt),
        member.lastLessonTitle ?? "",
        csvDate(member.lastLessonAt),
        member.measuredEventsLast30Days,
        enrollment?.activeLearningSeconds ?? 0,
        member.estimatedCompletedMinutes,
      ]);
    }
  }

  return rows.map((row) => row.map(csvCell).join(";")).join("\r\n");
}
