import "server-only";

import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  sql,
} from "drizzle-orm";
import { startOfDay, startOfMonth, subDays } from "date-fns";
import { db } from "@/db";
import {
  activityEvents,
  aiAgents,
  aiConversations,
  aiMessages,
  bundleCourses,
  bundles,
  communitySpaces,
  contentBlocks,
  courseCategories,
  courseAccessGrants,
  courseModuleAccessOverrides,
  courseModules,
  courses,
  customFieldDefinitions,
  customFieldValues,
  dataForms,
  enrollments,
  events,
  feedbackEntries,
  groups,
  groupBundles,
  groupCourses,
  groupMembers,
  hubs,
  lessonPages,
  lessonProgress,
  lessons,
  modules,
  memberBundles,
  mediaAssets,
  notifications,
  posts,
  submissionReviewAnnotations,
  submissionReviews,
  submissionAttachments,
  submissions,
  users,
  type User,
} from "@/db/schema";
import { getPublishedAssessmentOverview } from "@/lib/assessments";
import {
  isAssessmentQuestionType,
  publicAssessmentBlockData,
} from "@/lib/assessment-engine";
import { getMemberCourseCertificate } from "@/lib/certificates";
import { eventVisibilitySql } from "@/lib/event-access";
import {
  allPublishedLearningLessonIds,
  calculateRequiredCourseProgress,
  getCourseLearningAccess,
  resolvePublishedCourseLearningAccess,
} from "@/lib/learning-access";
import {
  findSnapshotLesson,
  getPublishedCourseContents,
} from "@/lib/published-course";
import { resolveMemberCourseAccessById } from "@/lib/member-course-access";
import { resolveMemberCourseModuleLink } from "@/lib/member-course-link-policy";
import {
  listCourseWidgetTeamMembers,
  listCourseWidgets,
} from "@/lib/course-widget-service";
import {
  getCourseAuthors,
  getCourseLearningGoals,
} from "@/lib/course-information-service";
import {
  coursePermissionAllows,
  coursePermissionMapForUser,
} from "@/lib/course-permissions";
import { getActiveExamContentLock } from "@/lib/exam-content-access";
import {
  submissionReviewAnnotationView,
  type SubmissionReviewAnnotationView,
} from "@/lib/submission-review-annotations";
import { communitySpaceVisibilitySql } from "@/lib/community-access";
import { publicHubRecord } from "@/lib/hub-layout";

export async function getAdminDashboardData(organizationId: string) {
  const [
    memberCount,
    courseCount,
    openSubmissionCount,
    activeEnrollmentCount,
    recentSubmissions,
    performance,
    activity,
    newMemberCount,
    publishedCourseCount,
    submissionsTodayCount,
    completedEnrollmentCount,
    learningMinutes,
  ] = await Promise.all([
    db
      .select({ value: count() })
      .from(users)
      .where(
        and(eq(users.organizationId, organizationId), eq(users.role, "member")),
      ),
    db
      .select({ value: count() })
      .from(courses)
      .where(eq(courses.organizationId, organizationId)),
    db
      .select({ value: count() })
      .from(submissions)
      .where(
        and(
          eq(submissions.organizationId, organizationId),
          inArray(submissions.status, ["open", "in_review"]),
        ),
      ),
    db
      .select({ value: count() })
      .from(enrollments)
      .innerJoin(courses, eq(courses.id, enrollments.courseId))
      .where(
        and(
          eq(courses.organizationId, organizationId),
          eq(enrollments.status, "in_progress"),
        ),
      ),
    db
      .select({
        id: submissions.id,
        title: submissions.title,
        status: submissions.status,
        submittedAt: submissions.submittedAt,
        firstName: users.firstName,
        lastName: users.lastName,
        courseTitle: courses.title,
      })
      .from(submissions)
      .innerJoin(users, eq(users.id, submissions.userId))
      .innerJoin(courses, eq(courses.id, submissions.courseId))
      .where(eq(submissions.organizationId, organizationId))
      .orderBy(desc(submissions.submittedAt))
      .limit(5),
    db
      .select({
        id: courses.id,
        title: courses.title,
        coverImage: courses.coverImage,
        learners: count(enrollments.id),
        averageProgress:
          sql<number>`coalesce(round(avg(${enrollments.progress})), 0)`.mapWith(
            Number,
          ),
      })
      .from(courses)
      .leftJoin(enrollments, eq(enrollments.courseId, courses.id))
      .where(
        and(
          eq(courses.organizationId, organizationId),
          eq(courses.status, "published"),
        ),
      )
      .groupBy(courses.id)
      .orderBy(desc(sql`avg(${enrollments.progress})`))
      .limit(4),
    db
      .select({
        day: sql<string>`to_char(date_trunc('day', ${activityEvents.createdAt}), 'DD.MM')`,
        total: count(activityEvents.id),
      })
      .from(activityEvents)
      .where(
        and(
          eq(activityEvents.organizationId, organizationId),
          gte(activityEvents.createdAt, subDays(new Date(), 13)),
        ),
      )
      .groupBy(sql`date_trunc('day', ${activityEvents.createdAt})`)
      .orderBy(sql`date_trunc('day', ${activityEvents.createdAt})`),
    db
      .select({ value: count() })
      .from(users)
      .where(
        and(
          eq(users.organizationId, organizationId),
          eq(users.role, "member"),
          gte(users.createdAt, startOfMonth(new Date())),
        ),
      ),
    db
      .select({ value: count() })
      .from(courses)
      .where(
        and(
          eq(courses.organizationId, organizationId),
          eq(courses.status, "published"),
        ),
      ),
    db
      .select({ value: count() })
      .from(submissions)
      .where(
        and(
          eq(submissions.organizationId, organizationId),
          gte(submissions.submittedAt, startOfDay(new Date())),
        ),
      ),
    db
      .select({ value: count() })
      .from(enrollments)
      .innerJoin(courses, eq(courses.id, enrollments.courseId))
      .where(
        and(
          eq(courses.organizationId, organizationId),
          eq(enrollments.status, "completed"),
          gte(enrollments.completedAt, subDays(new Date(), 30)),
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
      .innerJoin(lessons, eq(lessons.id, lessonProgress.lessonId))
      .innerJoin(modules, eq(modules.id, lessons.moduleId))
      .where(
        and(
          eq(modules.organizationId, organizationId),
          eq(lessonProgress.status, "completed"),
          gte(lessonProgress.completedAt, subDays(new Date(), 14)),
        ),
      ),
  ]);

  return {
    stats: {
      members: Number(memberCount[0]?.value ?? 0),
      courses: Number(courseCount[0]?.value ?? 0),
      openSubmissions: Number(openSubmissionCount[0]?.value ?? 0),
      activeEnrollments: Number(activeEnrollmentCount[0]?.value ?? 0),
      newMembersThisMonth: Number(newMemberCount[0]?.value ?? 0),
      publishedCourses: Number(publishedCourseCount[0]?.value ?? 0),
      submissionsToday: Number(submissionsTodayCount[0]?.value ?? 0),
      completedEnrollmentsLast30Days: Number(
        completedEnrollmentCount[0]?.value ?? 0,
      ),
      learningMinutesLast14Days: Number(learningMinutes[0]?.value ?? 0),
    },
    recentSubmissions,
    performance,
    activity: activity.map((item) => ({
      day: item.day,
      active: Number(item.total),
    })),
  };
}

export async function getAdminCourses(organizationId: string) {
  const [courseRows, categoryRows] = await Promise.all([
    db
      .select({
        id: courses.id,
        title: courses.title,
        slug: courses.slug,
        shortDescription: courses.shortDescription,
        coverImage: courses.coverImage,
        status: courses.status,
        difficulty: courses.difficulty,
        estimatedMinutes: courses.estimatedMinutes,
        featured: courses.featured,
        updatedAt: courses.updatedAt,
        categoryId: courseCategories.id,
        categoryName: courseCategories.name,
        categoryColor: courseCategories.color,
        learners:
          sql<number>`(select count(*) from enrollments e where e.course_id = ${courses.id})`.mapWith(
            Number,
          ),
        averageProgress:
          sql<number>`coalesce((select round(avg(e.progress)) from enrollments e where e.course_id = ${courses.id}), 0)`.mapWith(
            Number,
          ),
        moduleCount:
          sql<number>`(select count(*) from course_modules cm where cm.course_id = ${courses.id})`.mapWith(
            Number,
          ),
      })
      .from(courses)
      .leftJoin(courseCategories, eq(courseCategories.id, courses.categoryId))
      .where(eq(courses.organizationId, organizationId))
      .orderBy(desc(courses.updatedAt)),
    db
      .select({
        id: courseCategories.id,
        organizationId: courseCategories.organizationId,
        name: courseCategories.name,
        slug: courseCategories.slug,
        description: courseCategories.description,
        color: courseCategories.color,
        sortOrder: courseCategories.sortOrder,
        courseCount:
          sql<number>`(select count(*) from courses category_course where category_course.organization_id = ${organizationId} and category_course.category_id = ${courseCategories.id})`.mapWith(
            Number,
          ),
      })
      .from(courseCategories)
      .where(eq(courseCategories.organizationId, organizationId))
      .orderBy(asc(courseCategories.sortOrder), asc(courseCategories.name)),
  ]);
  return { courses: courseRows, categories: categoryRows };
}

export async function getCourseBuilderData(
  courseId: string,
  organizationId: string,
  actor: Pick<User, "id" | "organizationId" | "role">,
) {
  if (actor.organizationId !== organizationId) return null;
  const [course] = await db
    .select({
      id: courses.id,
      categoryId: courses.categoryId,
      title: courses.title,
      slug: courses.slug,
      shortDescription: courses.shortDescription,
      description: courses.description,
      coverImage: courses.coverImage,
      status: courses.status,
      difficulty: courses.difficulty,
      estimatedMinutes: courses.estimatedMinutes,
      certificateEnabled: courses.certificateEnabled,
      featured: courses.featured,
      visibleInCatalog: courses.visibleInCatalog,
      showProgressPercentage: courses.showProgressPercentage,
      notifyMembersOnModuleRelease: courses.notifyMembersOnModuleRelease,
      categoryName: courseCategories.name,
    })
    .from(courses)
    .leftJoin(courseCategories, eq(courseCategories.id, courses.categoryId))
    .where(
      and(eq(courses.id, courseId), eq(courses.organizationId, organizationId)),
    )
    .limit(1);
  if (!course) return null;

  const [
    moduleRows,
    categoryRows,
    enrollmentStats,
    accessRows,
    submissionStats,
    recentSubmissions,
    formRows,
    widgetRows,
    widgetTeamRows,
    learningGoalRows,
    courseAuthorRows,
  ] = await Promise.all([
    db
      .select({
        id: modules.id,
        title: modules.title,
        kind: modules.kind,
        linkedCourseId: modules.linkedCourseId,
        description: modules.description,
        folder: modules.folder,
        isReusable: modules.isReusable,
        estimatedMinutes: modules.estimatedMinutes,
        sortOrder: courseModules.sortOrder,
        indentLevel: courseModules.indentLevel,
        accessMode: courseModules.accessMode,
        dripDays: courseModules.dripDays,
        delayPendingState: courseModules.delayPendingState,
        availableFrom: courseModules.availableFrom,
        availableUntil: courseModules.availableUntil,
        windowDefaultState: courseModules.windowDefaultState,
        windowState: courseModules.windowState,
        requestAccessEnabled: courseModules.requestAccessEnabled,
        isRequired: courseModules.isRequired,
        usageCount:
          sql<number>`(select count(*) from course_modules usage where usage.module_id = ${modules.id})`.mapWith(
            Number,
          ),
      })
      .from(courseModules)
      .innerJoin(
        modules,
        and(
          eq(modules.id, courseModules.moduleId),
          eq(modules.organizationId, organizationId),
        ),
      )
      .where(eq(courseModules.courseId, course.id))
      .orderBy(asc(courseModules.sortOrder)),
    db
      .select({ id: courseCategories.id, name: courseCategories.name })
      .from(courseCategories)
      .where(eq(courseCategories.organizationId, organizationId))
      .orderBy(asc(courseCategories.sortOrder), asc(courseCategories.name)),
    db
      .select({
        total: count(),
        active:
          sql<number>`count(*) filter (where ${enrollments.accessActive} = true)`.mapWith(
            Number,
          ),
        inactive:
          sql<number>`count(*) filter (where ${enrollments.accessActive} = false)`.mapWith(
            Number,
          ),
        completed:
          sql<number>`count(*) filter (where ${enrollments.status} = 'completed')`.mapWith(
            Number,
          ),
        inProgress:
          sql<number>`count(*) filter (where ${enrollments.status} = 'in_progress')`.mapWith(
            Number,
          ),
        notStarted:
          sql<number>`count(*) filter (where ${enrollments.status} = 'not_started')`.mapWith(
            Number,
          ),
        averageProgress:
          sql<number>`coalesce(round(avg(${enrollments.progress}) filter (where ${enrollments.accessActive} = true)), 0)`.mapWith(
            Number,
          ),
      })
      .from(enrollments)
      .where(eq(enrollments.courseId, course.id)),
    db
      .select({ source: courseAccessGrants.source })
      .from(courseAccessGrants)
      .where(
        and(
          eq(courseAccessGrants.organizationId, organizationId),
          eq(courseAccessGrants.courseId, course.id),
        ),
      ),
    db
      .select({
        total: count(),
        open: sql<number>`count(*) filter (where ${submissions.status} in ('open', 'in_review'))`.mapWith(
          Number,
        ),
        approved:
          sql<number>`count(*) filter (where ${submissions.status} = 'approved')`.mapWith(
            Number,
          ),
      })
      .from(submissions)
      .where(
        and(
          eq(submissions.organizationId, organizationId),
          eq(submissions.courseId, course.id),
        ),
      ),
    db
      .select({
        id: submissions.id,
        title: submissions.title,
        status: submissions.status,
        score: submissions.score,
        submittedAt: submissions.submittedAt,
        firstName: users.firstName,
        lastName: users.lastName,
      })
      .from(submissions)
      .innerJoin(
        users,
        and(
          eq(users.id, submissions.userId),
          eq(users.organizationId, organizationId),
        ),
      )
      .where(
        and(
          eq(submissions.organizationId, organizationId),
          eq(submissions.courseId, course.id),
        ),
      )
      .orderBy(desc(submissions.submittedAt))
      .limit(8),
    db
      .select({
        id: dataForms.id,
        name: dataForms.name,
        profileDefinitionId: dataForms.profileDefinitionId,
      })
      .from(dataForms)
      .where(
        and(
          eq(dataForms.organizationId, organizationId),
          eq(dataForms.active, true),
        ),
      )
      .orderBy(asc(dataForms.name)),
    listCourseWidgets(course.id, organizationId),
    listCourseWidgetTeamMembers(organizationId),
    getCourseLearningGoals(course.id, organizationId),
    getCourseAuthors(course.id, organizationId),
  ]);

  const moduleIds = moduleRows.map((module) => module.id);
  const reusableModuleRows = await db
    .select({
      id: modules.id,
      title: modules.title,
      kind: modules.kind,
      linkedCourseId: modules.linkedCourseId,
      folder: modules.folder,
      estimatedMinutes: modules.estimatedMinutes,
      lessonCount:
        sql<number>`(select count(*) from lessons l where l.module_id = ${modules.id})`.mapWith(
          Number,
        ),
      usageCount:
        sql<number>`(select count(*) from course_modules cm where cm.module_id = ${modules.id})`.mapWith(
          Number,
        ),
    })
    .from(modules)
    .where(
      and(
        eq(modules.organizationId, organizationId),
        eq(modules.isReusable, true),
      ),
    )
    .orderBy(asc(modules.folder), asc(modules.title));
  const linkTargets = await db
    .select({
      id: courses.id,
      title: courses.title,
      status: courses.status,
      visibleInCatalog: courses.visibleInCatalog,
    })
    .from(courses)
    .where(eq(courses.organizationId, organizationId))
    .orderBy(asc(courses.title), asc(courses.id));
  const reusableModuleIds = reusableModuleRows.map((module) => module.id);
  const reusableModuleCourseRows = reusableModuleIds.length
    ? await db
        .select({
          moduleId: courseModules.moduleId,
          courseId: courseModules.courseId,
        })
        .from(courseModules)
        .where(
          and(
            eq(courseModules.organizationId, organizationId),
            inArray(courseModules.moduleId, reusableModuleIds),
          ),
        )
    : [];
  const permissionMap = await coursePermissionMapForUser(actor, [
    ...linkTargets.map((target) => target.id),
    ...reusableModuleCourseRows.map((row) => row.courseId),
  ]);
  const copyTargetCourses = linkTargets.filter(
    (target) =>
      target.status !== "archived" &&
      coursePermissionAllows(permissionMap.get(target.id) ?? null, "edit"),
  );
  const copyTargetCourseIds = copyTargetCourses.map((target) => target.id);
  const copyTargetModuleRows = copyTargetCourseIds.length
    ? await db
        .select({
          courseId: courseModules.courseId,
          id: modules.id,
          title: modules.title,
          sortOrder: courseModules.sortOrder,
        })
        .from(courseModules)
        .innerJoin(
          modules,
          and(
            eq(modules.id, courseModules.moduleId),
            eq(modules.organizationId, courseModules.organizationId),
            eq(modules.kind, "learning"),
          ),
        )
        .where(
          and(
            eq(courseModules.organizationId, organizationId),
            inArray(courseModules.courseId, copyTargetCourseIds),
          ),
        )
        .orderBy(
          asc(courseModules.courseId),
          asc(courseModules.sortOrder),
          asc(modules.title),
        )
    : [];
  const lessonRows = moduleIds.length
    ? await db
        .select()
        .from(lessons)
        .where(inArray(lessons.moduleId, moduleIds))
        .orderBy(asc(lessons.sortOrder), asc(lessons.id))
    : [];
  const lessonIds = lessonRows.map((lesson) => lesson.id);
  const [pageRows, blockRows] = lessonIds.length
    ? await Promise.all([
        db
          .select()
          .from(lessonPages)
          .where(inArray(lessonPages.lessonId, lessonIds))
          .orderBy(asc(lessonPages.sortOrder), asc(lessonPages.id)),
        db
          .select()
          .from(contentBlocks)
          .where(inArray(contentBlocks.lessonId, lessonIds))
          .orderBy(asc(contentBlocks.sortOrder), asc(contentBlocks.id)),
      ])
    : [[], []];

  const blockMediaAssetIds = [
    ...new Set(
      blockRows.flatMap((block) =>
        typeof block.data.mediaAssetId === "string"
          ? [block.data.mediaAssetId]
          : [],
      ),
    ),
  ];
  const blockMediaAssetRows = blockMediaAssetIds.length
    ? await db
        .select({
          id: mediaAssets.id,
          durationMilliseconds: mediaAssets.durationMilliseconds,
        })
        .from(mediaAssets)
        .where(
          and(
            eq(mediaAssets.organizationId, organizationId),
            eq(mediaAssets.status, "ready"),
            isNull(mediaAssets.deletedAt),
            inArray(mediaAssets.id, blockMediaAssetIds),
          ),
        )
    : [];
  const blockMediaAssetDurations = new Map(
    blockMediaAssetRows.map((asset) => [asset.id, asset.durationMilliseconds]),
  );
  const withMediaAssetDuration = (block: (typeof blockRows)[number]) => ({
    ...block,
    mediaAssetDurationMilliseconds:
      typeof block.data.mediaAssetId === "string"
        ? (blockMediaAssetDurations.get(block.data.mediaAssetId) ?? null)
        : null,
  });

  const modulesWithLessons = moduleRows.map((module) => ({
    ...module,
    delayPendingState:
      module.delayPendingState === "locked"
        ? ("locked" as const)
        : ("hidden" as const),
    lessons: lessonRows
      .filter((lesson) => lesson.moduleId === module.id)
      .map((lesson) => ({
        ...lesson,
        blocks: blockRows
          .filter((block) => block.lessonId === lesson.id && !block.pageId)
          .map(withMediaAssetDuration),
        pages: pageRows
          .filter((page) => page.lessonId === lesson.id)
          .map((page) => ({
            ...page,
            blocks: blockRows
              .filter((block) => block.pageId === page.id)
              .map(withMediaAssetDuration),
          })),
      })),
  }));
  const grants = {
    direct: accessRows.filter((row) => row.source.startsWith("direct:")).length,
    groups: accessRows.filter((row) => row.source.startsWith("group:")).length,
    bundles: accessRows.filter((row) => row.source.includes(":bundle:")).length,
    total: accessRows.length,
  };

  return {
    course,
    categories: categoryRows,
    modules: modulesWithLessons,
    availableModules: reusableModuleRows.filter((module) => {
      if (moduleIds.includes(module.id)) return false;
      if (actor.role === "owner" || actor.role === "admin") return true;
      const referencedCourseIds = reusableModuleCourseRows
        .filter((row) => row.moduleId === module.id)
        .map((row) => row.courseId);
      return (
        referencedCourseIds.length > 0 &&
        referencedCourseIds.every((referencedCourseId) =>
          coursePermissionAllows(
            permissionMap.get(referencedCourseId) ?? null,
            "edit",
          ),
        )
      );
    }),
    linkTargets: linkTargets.filter(
      (target) =>
        target.id !== course.id &&
        coursePermissionAllows(permissionMap.get(target.id) ?? null, "view"),
    ),
    copyTargets: copyTargetCourses.map((target) => ({
      id: target.id,
      title: target.title,
      modules: copyTargetModuleRows
        .filter((module) => module.courseId === target.id)
        .map((module) => ({
          id: module.id,
          title: module.title,
        })),
    })),
    access: { ...enrollmentStats[0], grants },
    statistics: { ...enrollmentStats[0], submissions: submissionStats[0] },
    recentSubmissions: recentSubmissions.map((submission) => ({
      ...submission,
      submittedAt: submission.submittedAt.toISOString(),
    })),
    dataForms: formRows,
    widgets: widgetRows,
    widgetTeamMembers: widgetTeamRows,
    learningGoals: learningGoalRows,
    courseAuthors: courseAuthorRows,
  };
}

export async function getAdminMembers(organizationId: string) {
  return db
    .select({
      id: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      email: users.email,
      role: users.role,
      status: users.status,
      department: users.department,
      jobTitle: users.jobTitle,
      points: users.points,
      lastLoginAt: users.lastLoginAt,
      createdAt: users.createdAt,
      groupCount:
        sql<number>`(select count(*) from group_members gm where gm.user_id = ${users.id})`.mapWith(
          Number,
        ),
      courseCount:
        sql<number>`(select count(*) from enrollments e where e.user_id = ${users.id})`.mapWith(
          Number,
        ),
      averageProgress:
        sql<number>`coalesce((select round(avg(e.progress)) from enrollments e where e.user_id = ${users.id}), 0)`.mapWith(
          Number,
        ),
    })
    .from(users)
    .where(eq(users.organizationId, organizationId))
    .orderBy(asc(users.firstName));
}

export async function getAdminMemberProfile(
  memberId: string,
  organizationId: string,
) {
  const [member] = await db
    .select({
      id: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      email: users.email,
      role: users.role,
      status: users.status,
      department: users.department,
      jobTitle: users.jobTitle,
      phone: users.phone,
      points: users.points,
      lastLoginAt: users.lastLoginAt,
      createdAt: users.createdAt,
      groupCount:
        sql<number>`(select count(*) from group_members gm where gm.user_id = ${users.id})`.mapWith(
          Number,
        ),
      courseCount:
        sql<number>`(select count(*) from enrollments e where e.user_id = ${users.id})`.mapWith(
          Number,
        ),
      averageProgress:
        sql<number>`coalesce((select round(avg(e.progress)) from enrollments e where e.user_id = ${users.id}), 0)`.mapWith(
          Number,
        ),
    })
    .from(users)
    .where(
      and(eq(users.id, memberId), eq(users.organizationId, organizationId)),
    )
    .limit(1);
  if (!member) return null;

  const fields = await db
    .select({
      id: customFieldDefinitions.id,
      key: customFieldDefinitions.key,
      label: customFieldDefinitions.label,
      description: customFieldDefinitions.description,
      type: customFieldDefinitions.type,
      category: customFieldDefinitions.category,
      required: customFieldDefinitions.required,
      options: customFieldDefinitions.options,
      value: customFieldValues.value,
    })
    .from(customFieldDefinitions)
    .leftJoin(
      customFieldValues,
      and(
        eq(customFieldValues.fieldId, customFieldDefinitions.id),
        eq(customFieldValues.userId, member.id),
        eq(customFieldValues.organizationId, organizationId),
      ),
    )
    .where(
      and(
        eq(customFieldDefinitions.organizationId, organizationId),
        eq(customFieldDefinitions.active, true),
      ),
    )
    .orderBy(
      asc(customFieldDefinitions.category),
      asc(customFieldDefinitions.sortOrder),
      asc(customFieldDefinitions.label),
    );

  return {
    member,
    fields: fields.map((field) => ({ ...field, value: field.value ?? null })),
  };
}

export async function getAdminModules(organizationId: string) {
  return db
    .select({
      id: modules.id,
      title: modules.title,
      kind: modules.kind,
      description: modules.description,
      folder: modules.folder,
      isReusable: modules.isReusable,
      estimatedMinutes: modules.estimatedMinutes,
      updatedAt: modules.updatedAt,
      firstCourseId: sql<
        string | null
      >`(select cm.course_id::text from course_modules cm where cm.module_id = ${modules.id} order by cm.sort_order asc limit 1)`,
      lessonCount:
        sql<number>`(select count(*) from lessons l where l.module_id = ${modules.id})`.mapWith(
          Number,
        ),
      usageCount:
        sql<number>`(select count(*) from course_modules cm where cm.module_id = ${modules.id})`.mapWith(
          Number,
        ),
    })
    .from(modules)
    .where(eq(modules.organizationId, organizationId))
    .orderBy(asc(modules.folder), asc(modules.title));
}

export async function getAdminSubmissions(organizationId: string) {
  const [rows, reviews, attachments, annotationRows] = await Promise.all([
    db
      .select({
        id: submissions.id,
        userId: submissions.userId,
        courseId: submissions.courseId,
        lessonId: submissions.lessonId,
        blockId: submissions.blockId,
        attemptNumber: submissions.attemptNumber,
        supersedesId: submissions.supersedesId,
        title: submissions.title,
        type: submissions.type,
        content: submissions.content,
        contentFormat: submissions.contentFormat,
        richText: submissions.richText,
        contentProjectionVersion: submissions.contentProjectionVersion,
        status: submissions.status,
        score: submissions.score,
        feedback: submissions.feedback,
        submittedAt: submissions.submittedAt,
        reviewedAt: submissions.reviewedAt,
        firstName: users.firstName,
        lastName: users.lastName,
        email: users.email,
        courseTitle: courses.title,
      })
      .from(submissions)
      .innerJoin(users, eq(users.id, submissions.userId))
      .innerJoin(courses, eq(courses.id, submissions.courseId))
      .where(eq(submissions.organizationId, organizationId))
      .orderBy(desc(submissions.submittedAt)),
    db
      .select({
        id: submissionReviews.id,
        submissionId: submissionReviews.submissionId,
        reviewerId: submissionReviews.reviewerId,
        reviewerName: sql<string | null>`(
          select concat(reviewer.first_name, ' ', reviewer.last_name)
          from users reviewer
          where reviewer.id = ${submissionReviews.reviewerId}
          limit 1
        )`,
        decision: submissionReviews.decision,
        feedback: submissionReviews.feedback,
        score: submissionReviews.score,
        reviewedAt: submissionReviews.reviewedAt,
      })
      .from(submissionReviews)
      .where(eq(submissionReviews.organizationId, organizationId))
      .orderBy(desc(submissionReviews.reviewedAt)),
    db
      .select({
        submissionId: submissionAttachments.submissionId,
        id: mediaAssets.id,
        originalFileName: mediaAssets.originalFileName,
        kind: mediaAssets.kind,
        declaredMimeType: mediaAssets.declaredMimeType,
        detectedMimeType: mediaAssets.detectedMimeType,
        declaredSizeBytes: mediaAssets.declaredSizeBytes,
        actualSizeBytes: mediaAssets.actualSizeBytes,
        sortOrder: submissionAttachments.sortOrder,
      })
      .from(submissionAttachments)
      .innerJoin(
        mediaAssets,
        and(
          eq(mediaAssets.id, submissionAttachments.mediaAssetId),
          eq(mediaAssets.organizationId, submissionAttachments.organizationId),
        ),
      )
      .where(
        and(
          eq(submissionAttachments.organizationId, organizationId),
          eq(mediaAssets.status, "ready"),
          isNull(mediaAssets.deletedAt),
        ),
      )
      .orderBy(
        asc(submissionAttachments.submissionId),
        asc(submissionAttachments.sortOrder),
      ),
    db
      .select({
        id: submissionReviewAnnotations.id,
        reviewId: submissionReviewAnnotations.reviewId,
        type: submissionReviewAnnotations.type,
        body: submissionReviewAnnotations.body,
        startOffset: submissionReviewAnnotations.startOffset,
        endOffset: submissionReviewAnnotations.endOffset,
        mediaAssetId: submissionReviewAnnotations.mediaAssetId,
        timestampMilliseconds:
          submissionReviewAnnotations.timestampMilliseconds,
        sortOrder: submissionReviewAnnotations.sortOrder,
        createdAt: submissionReviewAnnotations.createdAt,
      })
      .from(submissionReviewAnnotations)
      .where(eq(submissionReviewAnnotations.organizationId, organizationId))
      .orderBy(
        asc(submissionReviewAnnotations.reviewId),
        asc(submissionReviewAnnotations.sortOrder),
      ),
  ]);
  const annotationsByReview = new Map<
    string,
    SubmissionReviewAnnotationView[]
  >();
  for (const annotation of annotationRows) {
    const current = annotationsByReview.get(annotation.reviewId) ?? [];
    current.push(submissionReviewAnnotationView(annotation));
    annotationsByReview.set(annotation.reviewId, current);
  }
  const reviewsWithAnnotations = reviews.map((review) => ({
    ...review,
    annotations: annotationsByReview.get(review.id) ?? [],
  }));
  const reviewsBySubmission = new Map<string, typeof reviewsWithAnnotations>();
  for (const review of reviewsWithAnnotations) {
    const current = reviewsBySubmission.get(review.submissionId) ?? [];
    current.push(review);
    reviewsBySubmission.set(review.submissionId, current);
  }
  const attachmentsBySubmission = new Map<string, typeof attachments>();
  for (const attachment of attachments) {
    const current = attachmentsBySubmission.get(attachment.submissionId) ?? [];
    current.push(attachment);
    attachmentsBySubmission.set(attachment.submissionId, current);
  }
  return rows.map((submission) => ({
    ...submission,
    reviews: reviewsBySubmission.get(submission.id) ?? [],
    attachments: (attachmentsBySubmission.get(submission.id) ?? []).map(
      (attachment) => ({
        id: attachment.id,
        originalFileName: attachment.originalFileName,
        kind: attachment.kind,
        mimeType: attachment.detectedMimeType ?? attachment.declaredMimeType,
        sizeBytes: attachment.actualSizeBytes ?? attachment.declaredSizeBytes,
        downloadHref: `/api/media-assets/${attachment.id}/download`,
      }),
    ),
  }));
}

export async function getAdminFeedback(organizationId: string) {
  return db
    .select({
      id: feedbackEntries.id,
      type: feedbackEntries.type,
      rating: feedbackEntries.rating,
      content: feedbackEntries.content,
      testimonialConsent: feedbackEntries.testimonialConsent,
      status: feedbackEntries.status,
      reviewedAt: feedbackEntries.reviewedAt,
      createdAt: feedbackEntries.createdAt,
      userId: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      email: users.email,
      courseId: courses.id,
      courseTitle: courses.title,
      lessonId: feedbackEntries.lessonId,
      lessonTitle: lessons.title,
    })
    .from(feedbackEntries)
    .innerJoin(
      users,
      and(
        eq(users.id, feedbackEntries.userId),
        eq(users.organizationId, organizationId),
      ),
    )
    .leftJoin(
      courses,
      and(
        eq(courses.id, feedbackEntries.courseId),
        eq(courses.organizationId, organizationId),
      ),
    )
    .leftJoin(
      lessons,
      and(
        eq(lessons.id, feedbackEntries.lessonId),
        eq(lessons.organizationId, organizationId),
      ),
    )
    .where(eq(feedbackEntries.organizationId, organizationId))
    .orderBy(desc(feedbackEntries.createdAt));
}

export async function getMemberDashboard(
  userId: string,
  organizationId: string,
) {
  const [dashboardActor] = await db
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(
      and(
        eq(users.id, userId),
        eq(users.organizationId, organizationId),
        eq(users.status, "active"),
      ),
    )
    .limit(1);
  if (!dashboardActor) throw new Error("Active dashboard member not found.");
  const communityActor = { ...dashboardActor, organizationId };
  const [
    courseEnrollmentRows,
    upcomingEvents,
    recentPosts,
    unreadNotifications,
  ] = await Promise.all([
    db
      .select({
        courseId: courses.id,
        progress: enrollments.progress,
        status: enrollments.status,
        lastAccessedAt: enrollments.lastAccessedAt,
      })
      .from(enrollments)
      .innerJoin(
        courses,
        and(
          eq(courses.id, enrollments.courseId),
          eq(courses.organizationId, organizationId),
          eq(courses.status, "published"),
        ),
      )
      .where(
        and(eq(enrollments.userId, userId), eq(enrollments.accessActive, true)),
      )
      .orderBy(desc(enrollments.lastAccessedAt)),
    db
      .select({
        id: events.id,
        title: events.title,
        type: events.type,
        startsAt: events.startsAt,
        endsAt: events.endsAt,
        timezone: events.timezone,
        location: events.location,
        color: events.color,
      })
      .from(events)
      .where(
        and(
          eq(events.organizationId, organizationId),
          gte(events.startsAt, new Date()),
          eventVisibilitySql(userId, organizationId),
        ),
      )
      .orderBy(asc(events.startsAt))
      .limit(3),
    db
      .select({
        id: posts.id,
        content: posts.content,
        createdAt: posts.createdAt,
        firstName: users.firstName,
        lastName: users.lastName,
        spaceTitle: communitySpaces.title,
        likes:
          sql<number>`(select count(*) from post_likes pl where pl.organization_id = ${organizationId} and pl.post_id = ${posts.id})`.mapWith(
            Number,
          ),
        comments:
          sql<number>`(select count(*) from comments c where c.organization_id = ${organizationId} and c.post_id = ${posts.id} and c.moderation_state = 'published')`.mapWith(
            Number,
          ),
      })
      .from(posts)
      .innerJoin(users, eq(users.id, posts.authorId))
      .innerJoin(communitySpaces, eq(communitySpaces.id, posts.spaceId))
      .where(
        and(
          eq(posts.organizationId, organizationId),
          eq(posts.moderationState, "published"),
          communitySpaceVisibilitySql(communityActor),
        ),
      )
      .orderBy(desc(posts.createdAt))
      .limit(2),
    db
      .select({ value: count() })
      .from(notifications)
      .where(
        and(eq(notifications.userId, userId), eq(notifications.read, false)),
      ),
  ]);
  const courseAccess = await resolveMemberCourseAccessById({
    userId,
    organizationId,
    courseIds: courseEnrollmentRows.map((row) => row.courseId),
  });
  const accessibleEnrollmentRows = courseEnrollmentRows.filter(
    (row) => courseAccess.get(row.courseId)?.accessible,
  );
  const publishedCourses = await getPublishedCourseContents(db, {
    organizationId,
    courseIds: accessibleEnrollmentRows.map((row) => row.courseId),
  });
  const courseRows = accessibleEnrollmentRows.flatMap((enrollment) => {
    const published = publishedCourses.get(enrollment.courseId);
    if (!published) return [];
    const course = published.snapshot.course;
    if (course.visibleInCatalog === false) return [];
    return [
      {
        id: course.id,
        title: course.title,
        slug: course.slug,
        shortDescription: course.shortDescription,
        coverImage: course.coverImage,
        estimatedMinutes: course.estimatedMinutes,
        difficulty: course.difficulty,
        progress: enrollment.progress,
        showProgressPercentage: course.showProgressPercentage !== false,
        status: enrollment.status,
        lastAccessedAt: enrollment.lastAccessedAt,
      },
    ];
  });
  return {
    courses: courseRows,
    upcomingEvents,
    recentPosts,
    unreadNotifications: Number(unreadNotifications[0]?.value ?? 0),
  };
}

export async function getMemberCourses(userId: string, organizationId: string) {
  const enrollmentRows = await db
    .select({
      id: enrollments.id,
      courseId: courses.id,
      progress: enrollments.progress,
      status: enrollments.status,
      enrolledAt: enrollments.enrolledAt,
    })
    .from(enrollments)
    .innerJoin(
      courses,
      and(
        eq(courses.id, enrollments.courseId),
        eq(courses.organizationId, organizationId),
        eq(courses.status, "published"),
      ),
    )
    .where(
      and(eq(enrollments.userId, userId), eq(enrollments.accessActive, true)),
    );
  const courseAccess = await resolveMemberCourseAccessById({
    userId,
    organizationId,
    courseIds: enrollmentRows.map((row) => row.courseId),
  });
  const visibleEnrollmentRows = enrollmentRows.filter(
    (row) => courseAccess.get(row.courseId)?.visible,
  );
  const publishedCourses = await getPublishedCourseContents(db, {
    organizationId,
    courseIds: visibleEnrollmentRows.map((row) => row.courseId),
  });
  const categoryIds = [
    ...new Set(
      [...publishedCourses.values()]
        .map((content) => content.snapshot.course.categoryId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const categoryRows = categoryIds.length
    ? await db
        .select({
          id: courseCategories.id,
          name: courseCategories.name,
          color: courseCategories.color,
        })
        .from(courseCategories)
        .where(
          and(
            eq(courseCategories.organizationId, organizationId),
            inArray(courseCategories.id, categoryIds),
          ),
        )
    : [];
  const categories = new Map(
    categoryRows.map((category) => [category.id, category]),
  );
  const visibleLessonIds = [
    ...new Set(
      [...publishedCourses.values()].flatMap((published) =>
        allPublishedLearningLessonIds(published.snapshot),
      ),
    ),
  ];
  const completedRows = visibleLessonIds.length
    ? await db
        .select({ lessonId: lessonProgress.lessonId })
        .from(lessonProgress)
        .where(
          and(
            eq(lessonProgress.userId, userId),
            eq(lessonProgress.status, "completed"),
            inArray(lessonProgress.lessonId, visibleLessonIds),
          ),
        )
    : [];
  const moduleOverrideRows = visibleEnrollmentRows.length
    ? await db
        .select({
          courseId: courseModuleAccessOverrides.courseId,
          moduleId: courseModuleAccessOverrides.moduleId,
          state: courseModuleAccessOverrides.state,
          expiresAt: courseModuleAccessOverrides.expiresAt,
        })
        .from(courseModuleAccessOverrides)
        .where(
          and(
            eq(courseModuleAccessOverrides.organizationId, organizationId),
            eq(courseModuleAccessOverrides.userId, userId),
            inArray(
              courseModuleAccessOverrides.courseId,
              visibleEnrollmentRows.map((row) => row.courseId),
            ),
          ),
        )
    : [];
  const completedLessonIds = new Set(
    completedRows.map((progress) => progress.lessonId),
  );

  return visibleEnrollmentRows
    .flatMap((enrollment) => {
      const published = publishedCourses.get(enrollment.courseId);
      if (!published) return [];
      const access = courseAccess.get(enrollment.courseId);
      if (!access) return [];
      const course = published.snapshot.course;
      if (course.visibleInCatalog === false) return [];
      const category = course.categoryId
        ? categories.get(course.categoryId)
        : null;
      const learningAccess = resolvePublishedCourseLearningAccess({
        published,
        enrollment,
        courseAccessStartedAt: access.accessStartedAt,
        completedLessonIds,
        moduleOverrides: new Map(
          moduleOverrideRows
            .filter((row) => row.courseId === enrollment.courseId)
            .map((row) => [
              row.moduleId,
              { state: row.state, expiresAt: row.expiresAt },
            ]),
        ),
      });
      const progress = calculateRequiredCourseProgress(
        learningAccess.requiredLessonIds,
        completedLessonIds,
      );
      return [
        {
          id: course.id,
          title: course.title,
          slug: course.slug,
          shortDescription: course.shortDescription,
          coverImage: course.coverImage,
          estimatedMinutes: course.estimatedMinutes,
          difficulty: course.difficulty,
          certificateEnabled: course.certificateEnabled,
          featured: course.featured,
          progress,
          showProgressPercentage: course.showProgressPercentage !== false,
          status: (learningAccess.requiredLessonIds.length && progress === 100
            ? "completed"
            : progress > 0
              ? "in_progress"
              : "not_started") as "not_started" | "in_progress" | "completed",
          categoryName: category?.name ?? null,
          categoryColor: category?.color ?? null,
          access: {
            state: access.state,
            accessible: access.accessible,
            availableAt: access.availableAt?.toISOString() ?? null,
            expiresAt: access.expiresAt?.toISOString() ?? null,
          },
        },
      ];
    })
    .sort(
      (left, right) =>
        Number(right.featured) - Number(left.featured) ||
        left.title.localeCompare(right.title, "de"),
    );
}

export async function getMemberCourse(
  courseSlug: string,
  userId: string,
  organizationId: string,
) {
  const enrollmentRows = await db
    .select({
      id: enrollments.id,
      courseId: courses.id,
      progress: enrollments.progress,
      status: enrollments.status,
      enrolledAt: enrollments.enrolledAt,
    })
    .from(enrollments)
    .innerJoin(
      courses,
      and(
        eq(courses.id, enrollments.courseId),
        eq(courses.organizationId, organizationId),
        eq(courses.status, "published"),
      ),
    )
    .where(
      and(eq(enrollments.userId, userId), eq(enrollments.accessActive, true)),
    );
  const courseAccess = await resolveMemberCourseAccessById({
    userId,
    organizationId,
    courseIds: enrollmentRows.map((row) => row.courseId),
  });
  const accessibleEnrollmentRows = enrollmentRows.filter(
    (row) => courseAccess.get(row.courseId)?.accessible,
  );
  const publishedCourses = await getPublishedCourseContents(db, {
    organizationId,
    courseIds: accessibleEnrollmentRows.map((row) => row.courseId),
  });
  const publishedContent = [...publishedCourses.values()].find(
    (content) => content.snapshot.course.slug === courseSlug,
  );
  if (!publishedContent) return null;
  const enrollment = accessibleEnrollmentRows.find(
    (row) => row.courseId === publishedContent.courseId,
  );
  if (!enrollment) return null;
  const snapshot = publishedContent.snapshot;
  const snapshotCourse = snapshot.course;

  const lessonIds = allPublishedLearningLessonIds(snapshot);
  const [progressRows, categoryRows, certificate, learningAccess] =
    await Promise.all([
      lessonIds.length
        ? db
            .select()
            .from(lessonProgress)
            .where(
              and(
                eq(lessonProgress.userId, userId),
                inArray(lessonProgress.lessonId, lessonIds),
              ),
            )
        : Promise.resolve([]),
      snapshotCourse.categoryId
        ? db
            .select({ name: courseCategories.name })
            .from(courseCategories)
            .where(
              and(
                eq(courseCategories.id, snapshotCourse.categoryId),
                eq(courseCategories.organizationId, organizationId),
              ),
            )
            .limit(1)
        : Promise.resolve([]),
      getMemberCourseCertificate(userId, organizationId, snapshotCourse.id),
      getCourseLearningAccess(db, {
        organizationId,
        userId,
        courseId: snapshotCourse.id,
      }),
    ]);
  if (!learningAccess) return null;
  const progressByLesson = new Map(
    progressRows.map((progress) => [progress.lessonId, progress]),
  );
  const completedLessonIds = new Set(
    progressRows
      .filter((progress) => progress.status === "completed")
      .map((progress) => progress.lessonId),
  );
  const requiredProgress = calculateRequiredCourseProgress(
    learningAccess.requiredLessonIds,
    completedLessonIds,
  );
  const hasStarted = progressRows.some(
    (progress) => progress.status !== "not_started",
  );
  const accessibleCourseSlugsById = new Map(
    [...publishedCourses.entries()].map(([courseId, content]) => [
      courseId,
      content.snapshot.course.slug,
    ]),
  );

  const moduleList = learningAccess.modules
    .filter((resolvedModule) => resolvedModule.access.listed)
    .flatMap((resolvedModule) => {
      const link = resolveMemberCourseModuleLink({
        moduleKind: resolvedModule.module.kind ?? "learning",
        linkedCourseId: resolvedModule.module.linkedCourseId,
        accessibleCourseSlugsById,
      });
      if (!link.visible) return [];
      return [
        {
          id: resolvedModule.module.id,
          title: resolvedModule.module.title,
          kind:
            resolvedModule.module.kind === "exam"
              ? ("exam" as const)
              : resolvedModule.module.kind === "link"
                ? ("link" as const)
                : ("learning" as const),
          description: resolvedModule.module.description,
          estimatedMinutes: resolvedModule.module.estimatedMinutes,
          sortOrder: resolvedModule.module.sortOrder,
          indentLevel: resolvedModule.module.indentLevel ?? 0,
          targetCourseSlug: link.targetCourseSlug,
          dripDays: resolvedModule.module.dripDays,
          isRequired: resolvedModule.module.isRequired,
          access: resolvedModule.access,
          lessons: resolvedModule.lessons
            .filter((resolvedLesson) => resolvedLesson.access.listed)
            .map((resolvedLesson) => ({
              id: resolvedLesson.lesson.id,
              title: resolvedLesson.lesson.title,
              summary: resolvedLesson.lesson.summary,
              type: resolvedLesson.lesson.type,
              durationMinutes: resolvedLesson.lesson.durationMinutes,
              sortOrder: resolvedLesson.lesson.sortOrder,
              dripDays: resolvedLesson.lesson.dripDays,
              unlockAfterPrevious: resolvedLesson.lesson.unlockAfterPrevious,
              status: resolvedLesson.lesson.status,
              availableAt: resolvedLesson.lesson.availableAt,
              required: resolvedLesson.required,
              access: resolvedLesson.access,
              progressStatus:
                progressByLesson.get(resolvedLesson.lesson.id)?.status ?? null,
              percent:
                progressByLesson.get(resolvedLesson.lesson.id)?.percent ?? null,
            })),
        },
      ];
    });
  const visibleModuleIds = new Set(moduleList.map((module) => module.id));
  const memberPublishedContent = {
    ...publishedContent,
    snapshot: {
      ...publishedContent.snapshot,
      modules: publishedContent.snapshot.modules.filter(
        (learningModule) =>
          learningModule.kind !== "link" ||
          visibleModuleIds.has(learningModule.id),
      ),
    },
  };
  return {
    course: {
      ...snapshotCourse,
      progress: requiredProgress,
      status:
        learningAccess.requiredLessonIds.length && requiredProgress === 100
          ? "completed"
          : hasStarted
            ? "in_progress"
            : "not_started",
      categoryName: categoryRows[0]?.name ?? null,
    },
    modules: moduleList,
    widgets: snapshot.widgets ?? [],
    certificate,
    publishedContent: memberPublishedContent,
    requiredLessonIds: learningAccess.requiredLessonIds,
  };
}

export async function getLessonReader(
  courseSlug: string,
  lessonId: string,
  userId: string,
  organizationId: string,
) {
  const courseData = await getMemberCourse(courseSlug, userId, organizationId);
  if (!courseData) return null;
  const lessonIds = courseData.modules.flatMap((module) =>
    module.lessons.map((lesson) => lesson.id),
  );
  if (!lessonIds.includes(lessonId)) return null;
  const resolved = findSnapshotLesson(
    courseData.publishedContent.snapshot,
    lessonId,
  );
  if (!resolved) return null;
  const progressLesson = courseData.modules
    .flatMap((module) => module.lessons)
    .find((entry) => entry.id === lessonId);
  if (!progressLesson?.access.accessible) return null;
  const lesson = {
    id: resolved.lesson.id,
    title: resolved.lesson.title,
    summary: resolved.lesson.summary,
    type: resolved.lesson.type,
    durationMinutes: resolved.lesson.durationMinutes,
    progressStatus: progressLesson?.progressStatus ?? null,
    access: progressLesson.access,
  };
  const pageRows = resolved.lesson.pages.filter(
    (page) => page.status === "published",
  );
  const blockRows = [
    ...resolved.lesson.blocks,
    ...pageRows.flatMap((page) => page.blocks),
  ].sort(
    (left, right) =>
      left.sortOrder - right.sortOrder || left.id.localeCompare(right.id),
  );
  const submissionBlockIds = blockRows
    .filter((block) => block.type === "submission")
    .map((block) => block.id);
  const [assessment, submissionRows, activeExamLock] = await Promise.all([
    getPublishedAssessmentOverview(db, {
      organizationId,
      userId,
      courseId: courseData.course.id,
      lessonId: lesson.id,
      snapshot: courseData.publishedContent.snapshot,
    }),
    submissionBlockIds.length
      ? db
          .select({
            id: submissions.id,
            blockId: submissions.blockId,
            attemptNumber: submissions.attemptNumber,
            supersedesId: submissions.supersedesId,
            title: submissions.title,
            content: submissions.content,
            contentFormat: submissions.contentFormat,
            richText: submissions.richText,
            contentProjectionVersion: submissions.contentProjectionVersion,
            status: submissions.status,
            score: submissions.score,
            feedback: submissions.feedback,
            submittedAt: submissions.submittedAt,
            reviewedAt: submissions.reviewedAt,
          })
          .from(submissions)
          .where(
            and(
              eq(submissions.organizationId, organizationId),
              eq(submissions.userId, userId),
              eq(submissions.courseId, courseData.course.id),
              eq(submissions.lessonId, lesson.id),
              inArray(submissions.blockId, submissionBlockIds),
            ),
          )
          .orderBy(
            asc(submissions.blockId),
            asc(submissions.attemptNumber),
            asc(submissions.submittedAt),
          )
      : Promise.resolve([]),
    getActiveExamContentLock(db, { organizationId, userId }),
  ]);
  const [attachmentRows, learnerAnnotationRows] = submissionRows.length
    ? await Promise.all([
        db
          .select({
            submissionId: submissionAttachments.submissionId,
            id: mediaAssets.id,
            originalFileName: mediaAssets.originalFileName,
            kind: mediaAssets.kind,
            declaredMimeType: mediaAssets.declaredMimeType,
            detectedMimeType: mediaAssets.detectedMimeType,
            declaredSizeBytes: mediaAssets.declaredSizeBytes,
            actualSizeBytes: mediaAssets.actualSizeBytes,
            sortOrder: submissionAttachments.sortOrder,
          })
          .from(submissionAttachments)
          .innerJoin(
            mediaAssets,
            and(
              eq(mediaAssets.id, submissionAttachments.mediaAssetId),
              eq(
                mediaAssets.organizationId,
                submissionAttachments.organizationId,
              ),
            ),
          )
          .where(
            and(
              eq(submissionAttachments.organizationId, organizationId),
              inArray(
                submissionAttachments.submissionId,
                submissionRows.map((submission) => submission.id),
              ),
              eq(mediaAssets.status, "ready"),
              isNull(mediaAssets.deletedAt),
            ),
          )
          .orderBy(
            asc(submissionAttachments.submissionId),
            asc(submissionAttachments.sortOrder),
          ),
        db
          .select({
            id: submissionReviewAnnotations.id,
            submissionId: submissionReviewAnnotations.submissionId,
            type: submissionReviewAnnotations.type,
            body: submissionReviewAnnotations.body,
            startOffset: submissionReviewAnnotations.startOffset,
            endOffset: submissionReviewAnnotations.endOffset,
            mediaAssetId: submissionReviewAnnotations.mediaAssetId,
            timestampMilliseconds:
              submissionReviewAnnotations.timestampMilliseconds,
            sortOrder: submissionReviewAnnotations.sortOrder,
            createdAt: submissionReviewAnnotations.createdAt,
          })
          .from(submissionReviewAnnotations)
          .where(
            and(
              eq(submissionReviewAnnotations.organizationId, organizationId),
              inArray(
                submissionReviewAnnotations.submissionId,
                submissionRows.map((submission) => submission.id),
              ),
            ),
          )
          .orderBy(
            asc(submissionReviewAnnotations.submissionId),
            asc(submissionReviewAnnotations.sortOrder),
          ),
      ])
    : [[], []];
  const attachmentsBySubmission = new Map<string, typeof attachmentRows>();
  for (const attachment of attachmentRows) {
    const current = attachmentsBySubmission.get(attachment.submissionId) ?? [];
    current.push(attachment);
    attachmentsBySubmission.set(attachment.submissionId, current);
  }
  const annotationsBySubmission = new Map<
    string,
    SubmissionReviewAnnotationView[]
  >();
  for (const annotation of learnerAnnotationRows) {
    const current = annotationsBySubmission.get(annotation.submissionId) ?? [];
    current.push(submissionReviewAnnotationView(annotation));
    annotationsBySubmission.set(annotation.submissionId, current);
  }
  const questionRank = new Map(
    assessment.questionOrder.map((blockId, index) => [blockId, index]),
  );
  const orderQuestions = (rows: typeof blockRows) => {
    if (!assessment.shuffleQuestions || questionRank.size < 2) return rows;
    const shuffled = rows
      .filter((block) => questionRank.has(block.id))
      .sort(
        (left, right) =>
          questionRank.get(left.id)! - questionRank.get(right.id)!,
      );
    let questionIndex = 0;
    return rows.map((block) =>
      questionRank.has(block.id) ? shuffled[questionIndex++] : block,
    );
  };
  const sanitizeBlock = (block: (typeof blockRows)[number]) => ({
    ...block,
    data: publicAssessmentBlockData(block),
  });
  const learnerVisibleBlockRows =
    lesson.type === "exam"
      ? blockRows.filter((block) => !isAssessmentQuestionType(block.type))
      : blockRows;
  const blocks =
    lesson.type === "exam"
      ? []
      : orderQuestions(
          learnerVisibleBlockRows.filter((block) => !block.pageId),
        ).map(sanitizeBlock);
  const pages =
    lesson.type === "exam"
      ? []
      : pageRows.map((page) => ({
          ...page,
          blocks: orderQuestions(
            learnerVisibleBlockRows.filter((block) => block.pageId === page.id),
          ).map(sanitizeBlock),
        }));
  const examQuestionIds = new Set(
    blockRows
      .filter((block) => isAssessmentQuestionType(block.type))
      .map((block) => block.id),
  );
  const configuredPools =
    lesson.type === "exam" ? resolved.lesson.examQuestionPools : [];
  const pooledQuestionIds = new Set(
    configuredPools.flatMap((pool) =>
      pool.questionIds.filter((questionId) => examQuestionIds.has(questionId)),
    ),
  );
  const selectedQuestionCount =
    [...examQuestionIds].filter(
      (questionId) => !pooledQuestionIds.has(questionId),
    ).length +
    configuredPools.reduce(
      (total, pool) =>
        total +
        Math.min(
          pool.drawCount,
          pool.questionIds.filter((questionId) =>
            examQuestionIds.has(questionId),
          ).length,
        ),
      0,
    );
  return {
    course: courseData.course,
    modules: courseData.modules,
    lesson,
    blocks,
    pages,
    assessment,
    exam:
      lesson.type === "exam"
        ? {
            questionCount: selectedQuestionCount,
            durationSeconds: resolved.lesson.examDurationSeconds,
            passingScore: assessment.passingScore,
            maxAttempts: assessment.maxAttempts,
            attemptsUsed: assessment.attemptsUsed,
            attemptsRemaining: assessment.attemptsRemaining,
            maxAttemptsReached: assessment.maxAttemptsReached,
            resultReleaseMode: resolved.lesson.examResultReleaseMode,
            reviewReleaseMode: resolved.lesson.examReviewReleaseMode,
            contentAccessMode: resolved.lesson.examContentAccessMode,
            navigationLock:
              activeExamLock?.courseId === courseData.course.id &&
              activeExamLock.lessonId === lesson.id
                ? {
                    attemptId: activeExamLock.attemptId,
                    courseId: activeExamLock.courseId,
                    lessonId: activeExamLock.lessonId,
                    mode: activeExamLock.mode,
                  }
                : null,
            pendingAttempt: assessment.pendingAttempt,
            latestAttempt: assessment.latestAttempt
              ? {
                  ...assessment.latestAttempt,
                  submittedAt:
                    assessment.latestAttempt.submittedAt?.toISOString() ?? null,
                }
              : null,
          }
        : null,
    submissions: submissionRows.map((submission) => ({
      ...submission,
      submittedAt: submission.submittedAt.toISOString(),
      reviewedAt: submission.reviewedAt?.toISOString() ?? null,
      annotations: (annotationsBySubmission.get(submission.id) ?? []).map(
        (annotation) => ({
          ...annotation,
          createdAt: annotation.createdAt.toISOString(),
        }),
      ),
      attachments: (attachmentsBySubmission.get(submission.id) ?? []).map(
        (attachment) => ({
          id: attachment.id,
          originalFileName: attachment.originalFileName,
          kind: attachment.kind,
          mimeType: attachment.detectedMimeType ?? attachment.declaredMimeType,
          sizeBytes: attachment.actualSizeBytes ?? attachment.declaredSizeBytes,
          downloadHref: `/api/media-assets/${attachment.id}/download`,
        }),
      ),
    })),
  };
}

export async function getOrganizationExperienceData(organizationId: string) {
  const [
    hubRows,
    groupRows,
    bundleRows,
    agentRows,
    agentConversationStats,
    agentMessageStats,
  ] = await Promise.all([
    db
      .select({
        id: hubs.id,
        organizationId: hubs.organizationId,
        title: hubs.title,
        slug: hubs.slug,
        description: hubs.description,
        status: hubs.status,
        layout: hubs.layout,
        createdAt: hubs.createdAt,
        accessRuleCount:
          sql<number>`(select count(*) from hub_access_grants hag where hag.hub_id = ${hubs.id})`.mapWith(
            Number,
          ),
      })
      .from(hubs)
      .where(eq(hubs.organizationId, organizationId))
      .orderBy(asc(hubs.title)),
    db
      .select({
        id: groups.id,
        name: groups.name,
        description: groups.description,
        color: groups.color,
        createdAt: groups.createdAt,
        memberCount:
          sql<number>`(select count(*) from group_members gm where gm.group_id = ${groups.id})`.mapWith(
            Number,
          ),
        courseCount:
          sql<number>`(select count(*) from group_courses gc where gc.group_id = ${groups.id})`.mapWith(
            Number,
          ),
        bundleCount:
          sql<number>`(select count(*) from group_bundles gb where gb.group_id = ${groups.id})`.mapWith(
            Number,
          ),
      })
      .from(groups)
      .where(eq(groups.organizationId, organizationId))
      .orderBy(asc(groups.name)),
    db
      .select({
        id: bundles.id,
        name: bundles.name,
        description: bundles.description,
        color: bundles.color,
        active: bundles.active,
        createdAt: bundles.createdAt,
        courseCount:
          sql<number>`(select count(*) from bundle_courses bc where bc.bundle_id = ${bundles.id})`.mapWith(
            Number,
          ),
        assignmentCount: sql<number>`(
            (select count(*) from member_bundles mb where mb.bundle_id = ${bundles.id})
            + (select count(*) from group_bundles gb where gb.bundle_id = ${bundles.id})
          )`.mapWith(Number),
      })
      .from(bundles)
      .where(eq(bundles.organizationId, organizationId))
      .orderBy(asc(bundles.name)),
    db
      .select({
        id: aiAgents.id,
        organizationId: aiAgents.organizationId,
        name: aiAgents.name,
        description: aiAgents.description,
        systemPrompt: aiAgents.systemPrompt,
        color: aiAgents.color,
        icon: aiAgents.icon,
        active: aiAgents.active,
        createdAt: aiAgents.createdAt,
      })
      .from(aiAgents)
      .where(eq(aiAgents.organizationId, organizationId))
      .orderBy(asc(aiAgents.name)),
    db
      .select({
        agentId: aiConversations.agentId,
        conversationCount: count(aiConversations.id),
        memberCount:
          sql<number>`count(distinct ${aiConversations.userId})`.mapWith(
            Number,
          ),
        lastMessageAt: sql<Date | null>`max(${aiConversations.lastMessageAt})`,
      })
      .from(aiConversations)
      .where(eq(aiConversations.organizationId, organizationId))
      .groupBy(aiConversations.agentId),
    db
      .select({
        agentId: aiConversations.agentId,
        messageCount: count(aiMessages.id),
      })
      .from(aiConversations)
      .innerJoin(
        aiMessages,
        and(
          eq(aiMessages.conversationId, aiConversations.id),
          eq(aiMessages.organizationId, organizationId),
        ),
      )
      .where(eq(aiConversations.organizationId, organizationId))
      .groupBy(aiConversations.agentId),
  ]);
  const conversationStatsByAgent = new Map(
    agentConversationStats.map((stats) => [stats.agentId, stats]),
  );
  const messageStatsByAgent = new Map(
    agentMessageStats.map((stats) => [stats.agentId, stats.messageCount]),
  );
  return {
    hubs: hubRows,
    groups: groupRows,
    bundles: bundleRows,
    agents: agentRows.map((agent) => {
      const stats = conversationStatsByAgent.get(agent.id);
      return {
        ...agent,
        conversationCount: stats?.conversationCount ?? 0,
        messageCount: messageStatsByAgent.get(agent.id) ?? 0,
        memberCount: stats?.memberCount ?? 0,
        lastMessageAt: stats?.lastMessageAt ?? null,
      };
    }),
  };
}

export async function getAdminGroupDetail(
  groupId: string,
  organizationId: string,
) {
  const [group] = await db
    .select({
      id: groups.id,
      name: groups.name,
      description: groups.description,
      color: groups.color,
      createdAt: groups.createdAt,
      memberCount:
        sql<number>`(select count(*) from group_members gm where gm.group_id = ${groups.id})`.mapWith(
          Number,
        ),
      directCourseCount:
        sql<number>`(select count(*) from group_courses gc where gc.group_id = ${groups.id})`.mapWith(
          Number,
        ),
      bundleCount:
        sql<number>`(select count(*) from group_bundles gb where gb.group_id = ${groups.id})`.mapWith(
          Number,
        ),
      effectiveLearnerCount:
        sql<number>`(select count(distinct cag.user_id) from course_access_grants cag where cag.organization_id = ${organizationId} and cag.source like ${`group:${groupId}:%`})`.mapWith(
          Number,
        ),
    })
    .from(groups)
    .where(
      and(eq(groups.id, groupId), eq(groups.organizationId, organizationId)),
    )
    .limit(1);
  if (!group) return null;

  const [
    memberRows,
    directCourseRows,
    bundleRows,
    memberCandidates,
    courseCandidates,
    bundleCandidates,
  ] = await Promise.all([
    db
      .select({
        id: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
        email: users.email,
        status: users.status,
        department: users.department,
        joinedAt: groupMembers.joinedAt,
      })
      .from(groupMembers)
      .innerJoin(
        users,
        and(
          eq(users.id, groupMembers.userId),
          eq(users.organizationId, organizationId),
        ),
      )
      .where(eq(groupMembers.groupId, groupId))
      .orderBy(asc(users.lastName), asc(users.firstName)),
    db
      .select({
        id: courses.id,
        title: courses.title,
        status: courses.status,
        difficulty: courses.difficulty,
        estimatedMinutes: courses.estimatedMinutes,
      })
      .from(groupCourses)
      .innerJoin(
        courses,
        and(
          eq(courses.id, groupCourses.courseId),
          eq(courses.organizationId, organizationId),
        ),
      )
      .where(eq(groupCourses.groupId, groupId))
      .orderBy(asc(courses.title)),
    db
      .select({
        id: bundles.id,
        name: bundles.name,
        description: bundles.description,
        color: bundles.color,
        active: bundles.active,
        courseCount:
          sql<number>`(select count(*) from bundle_courses bc where bc.bundle_id = ${bundles.id})`.mapWith(
            Number,
          ),
      })
      .from(groupBundles)
      .innerJoin(
        bundles,
        and(
          eq(bundles.id, groupBundles.bundleId),
          eq(bundles.organizationId, organizationId),
        ),
      )
      .where(eq(groupBundles.groupId, groupId))
      .orderBy(asc(bundles.name)),
    db
      .select({
        id: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
        email: users.email,
        status: users.status,
      })
      .from(users)
      .where(
        and(
          eq(users.organizationId, organizationId),
          eq(users.role, "member"),
          inArray(users.status, ["active", "invited"]),
        ),
      )
      .orderBy(asc(users.lastName), asc(users.firstName)),
    db
      .select({ id: courses.id, title: courses.title, status: courses.status })
      .from(courses)
      .where(eq(courses.organizationId, organizationId))
      .orderBy(asc(courses.title)),
    db
      .select({ id: bundles.id, name: bundles.name, active: bundles.active })
      .from(bundles)
      .where(eq(bundles.organizationId, organizationId))
      .orderBy(asc(bundles.name)),
  ]);

  const memberIds = new Set(memberRows.map((member) => member.id));
  const courseIds = new Set(directCourseRows.map((course) => course.id));
  const bundleIds = new Set(bundleRows.map((bundle) => bundle.id));
  return {
    group,
    members: memberRows,
    directCourses: directCourseRows,
    bundles: bundleRows,
    availableMembers: memberCandidates.filter(
      (member) => !memberIds.has(member.id),
    ),
    availableCourses: courseCandidates.filter(
      (course) => !courseIds.has(course.id),
    ),
    availableBundles: bundleCandidates.filter(
      (bundle) => !bundleIds.has(bundle.id),
    ),
  };
}

export async function getAdminBundleDetail(
  bundleId: string,
  organizationId: string,
) {
  const [bundle] = await db
    .select({
      id: bundles.id,
      name: bundles.name,
      description: bundles.description,
      color: bundles.color,
      active: bundles.active,
      createdAt: bundles.createdAt,
      courseCount:
        sql<number>`(select count(*) from bundle_courses bc where bc.bundle_id = ${bundles.id})`.mapWith(
          Number,
        ),
      groupCount:
        sql<number>`(select count(*) from group_bundles gb where gb.bundle_id = ${bundles.id})`.mapWith(
          Number,
        ),
      directMemberCount:
        sql<number>`(select count(*) from member_bundles mb where mb.bundle_id = ${bundles.id})`.mapWith(
          Number,
        ),
      effectiveLearnerCount:
        sql<number>`(select count(distinct cag.user_id) from course_access_grants cag where cag.organization_id = ${organizationId} and cag.source like ${`%:bundle:${bundleId}`})`.mapWith(
          Number,
        ),
    })
    .from(bundles)
    .where(
      and(eq(bundles.id, bundleId), eq(bundles.organizationId, organizationId)),
    )
    .limit(1);
  if (!bundle) return null;

  const [courseRows, courseCandidates, assignedGroups, assignedMembers] =
    await Promise.all([
      db
        .select({
          id: courses.id,
          title: courses.title,
          status: courses.status,
          difficulty: courses.difficulty,
          estimatedMinutes: courses.estimatedMinutes,
          availableFrom: bundleCourses.availableFrom,
          availableUntil: bundleCourses.availableUntil,
          delayDays: bundleCourses.delayDays,
          visible: bundleCourses.visible,
        })
        .from(bundleCourses)
        .innerJoin(
          courses,
          and(
            eq(courses.id, bundleCourses.courseId),
            eq(courses.organizationId, organizationId),
          ),
        )
        .where(eq(bundleCourses.bundleId, bundleId))
        .orderBy(asc(courses.title)),
      db
        .select({
          id: courses.id,
          title: courses.title,
          status: courses.status,
        })
        .from(courses)
        .where(eq(courses.organizationId, organizationId))
        .orderBy(asc(courses.title)),
      db
        .select({ id: groups.id, name: groups.name, color: groups.color })
        .from(groupBundles)
        .innerJoin(
          groups,
          and(
            eq(groups.id, groupBundles.groupId),
            eq(groups.organizationId, organizationId),
          ),
        )
        .where(eq(groupBundles.bundleId, bundleId))
        .orderBy(asc(groups.name)),
      db
        .select({
          id: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
          email: users.email,
        })
        .from(memberBundles)
        .innerJoin(
          users,
          and(
            eq(users.id, memberBundles.userId),
            eq(users.organizationId, organizationId),
          ),
        )
        .where(eq(memberBundles.bundleId, bundleId))
        .orderBy(asc(users.lastName), asc(users.firstName)),
    ]);
  const courseIds = new Set(courseRows.map((course) => course.id));
  return {
    bundle,
    courses: courseRows,
    availableCourses: courseCandidates.filter(
      (course) => !courseIds.has(course.id),
    ),
    assignedGroups,
    assignedMembers,
  };
}

export async function getMemberHubs(userId: string, organizationId: string) {
  const rows = await db
    .select()
    .from(hubs)
    .where(
      and(
        eq(hubs.organizationId, organizationId),
        eq(hubs.status, "published"),
        sql`(
          not exists (select 1 from hub_access_grants hag where hag.hub_id = ${hubs.id})
          or exists (
            select 1 from hub_access_grants hag
            where hag.hub_id = ${hubs.id} and hag.subject_type = 'user' and hag.subject_id = ${userId}
          )
          or exists (
            select 1 from hub_access_grants hag
            inner join group_members gm on gm.group_id = hag.subject_id
            where hag.hub_id = ${hubs.id} and hag.subject_type = 'group' and gm.user_id = ${userId}
          )
          or exists (
            select 1 from hub_access_grants hag
            where hag.hub_id = ${hubs.id} and hag.subject_type = 'bundle' and (
              exists (select 1 from member_bundles mb where mb.bundle_id = hag.subject_id and mb.user_id = ${userId})
              or exists (
                select 1 from group_bundles gb
                inner join group_members gm on gm.group_id = gb.group_id
                where gb.bundle_id = hag.subject_id and gm.user_id = ${userId}
              )
            )
          )
        )`,
      ),
    )
    .orderBy(asc(hubs.title));
  return rows.map(publicHubRecord);
}
