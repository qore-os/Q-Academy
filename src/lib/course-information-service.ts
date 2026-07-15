import "server-only";

import { and, asc, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  courseAuthors,
  courseLearningGoals,
  courses,
  users,
} from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import {
  courseAuthorIdsSchema,
  courseLearningGoalsSchema,
  type CourseInformationCollections,
} from "@/lib/course-information";
import { safeAvatarSource } from "@/lib/avatar-policy";

export type CourseInformationTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0];

export async function getCourseLearningGoals(
  courseId: string,
  organizationId: string,
) {
  return db
    .select()
    .from(courseLearningGoals)
    .where(
      and(
        eq(courseLearningGoals.courseId, courseId),
        eq(courseLearningGoals.organizationId, organizationId),
      ),
    )
    .orderBy(asc(courseLearningGoals.sortOrder), asc(courseLearningGoals.id));
}

export async function getCourseAuthors(
  courseId: string,
  organizationId: string,
) {
  const rows = await db
    .select({
      id: courseAuthors.id,
      organizationId: courseAuthors.organizationId,
      courseId: courseAuthors.courseId,
      userId: courseAuthors.userId,
      sortOrder: courseAuthors.sortOrder,
      createdAt: courseAuthors.createdAt,
      author: {
        id: users.id,
        firstName: users.firstName,
        lastName: users.lastName,
        avatarUrl: users.avatarUrl,
        role: users.role,
        status: users.status,
        jobTitle: users.jobTitle,
        bio: users.bio,
      },
    })
    .from(courseAuthors)
    .innerJoin(
      users,
      and(
        eq(users.id, courseAuthors.userId),
        eq(users.organizationId, courseAuthors.organizationId),
      ),
    )
    .where(
      and(
        eq(courseAuthors.courseId, courseId),
        eq(courseAuthors.organizationId, organizationId),
      ),
    )
    .orderBy(asc(courseAuthors.sortOrder), asc(courseAuthors.id));
  return rows.map((row) => ({
    ...row,
    author: {
      ...row.author,
      avatarUrl: safeAvatarSource(row.author.avatarUrl),
    },
  }));
}

async function lockCourse(
  tx: CourseInformationTransaction,
  courseId: string,
  organizationId: string,
) {
  const [course] = await tx
    .select({ id: courses.id })
    .from(courses)
    .where(
      and(
        eq(courses.id, courseId),
        eq(courses.organizationId, organizationId),
      ),
    )
    .limit(1)
    .for("update");
  if (!course) throw new ApiError(404, "not_found", "Kurs nicht gefunden.");
}

async function eligibleAuthors(
  tx: CourseInformationTransaction,
  authorIds: string[],
  organizationId: string,
) {
  if (!authorIds.length) return [];
  return tx
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.organizationId, organizationId),
        eq(users.status, "active"),
        inArray(users.role, ["owner", "admin", "trainer"]),
        inArray(users.id, authorIds),
      ),
    )
    .for("share");
}

export async function replaceCourseInformationCollections(
  tx: CourseInformationTransaction,
  input: {
    courseId: string;
    organizationId: string;
  } & CourseInformationCollections,
) {
  await lockCourse(tx, input.courseId, input.organizationId);
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${`course-information:${input.courseId}`}))`,
  );

  const parsedGoals = input.learningGoals
    ? courseLearningGoalsSchema.safeParse(input.learningGoals)
    : null;
  const parsedAuthors = input.authorIds
    ? courseAuthorIdsSchema.safeParse(input.authorIds)
    : null;
  if (parsedGoals && !parsedGoals.success) {
    throw new ApiError(
      422,
      "validation_error",
      parsedGoals.error.issues[0]?.message ?? "Lernziele sind ungueltig.",
    );
  }
  if (parsedAuthors && !parsedAuthors.success) {
    throw new ApiError(
      422,
      "validation_error",
      parsedAuthors.error.issues[0]?.message ?? "Kursautoren sind ungueltig.",
    );
  }
  if (parsedAuthors?.success) {
    const authors = await eligibleAuthors(
      tx,
      parsedAuthors.data,
      input.organizationId,
    );
    if (authors.length !== parsedAuthors.data.length) {
      throw new ApiError(
        422,
        "validation_error",
        "Alle Kursautoren muessen aktive Teammitglieder dieser Organisation sein.",
      );
    }
  }

  if (parsedGoals?.success) {
    await tx
      .delete(courseLearningGoals)
      .where(
        and(
          eq(courseLearningGoals.courseId, input.courseId),
          eq(courseLearningGoals.organizationId, input.organizationId),
        ),
      );
    if (parsedGoals.data.length) {
      await tx.insert(courseLearningGoals).values(
        parsedGoals.data.map((text, sortOrder) => ({
          organizationId: input.organizationId,
          courseId: input.courseId,
          text,
          sortOrder,
        })),
      );
    }
  }

  if (parsedAuthors?.success) {
    await tx
      .delete(courseAuthors)
      .where(
        and(
          eq(courseAuthors.courseId, input.courseId),
          eq(courseAuthors.organizationId, input.organizationId),
        ),
      );
    if (parsedAuthors.data.length) {
      await tx.insert(courseAuthors).values(
        parsedAuthors.data.map((userId, sortOrder) => ({
          organizationId: input.organizationId,
          courseId: input.courseId,
          userId,
          sortOrder,
        })),
      );
    }
  }
}

export async function assertCourseAuthorsActiveForPublication(
  tx: CourseInformationTransaction,
  courseId: string,
  organizationId: string,
) {
  const relations = await tx
    .select({ id: courseAuthors.id, userId: courseAuthors.userId })
    .from(courseAuthors)
    .where(
      and(
        eq(courseAuthors.courseId, courseId),
        eq(courseAuthors.organizationId, organizationId),
      ),
    )
    .orderBy(asc(courseAuthors.sortOrder), asc(courseAuthors.id))
    .for("share");
  const authors = await eligibleAuthors(
    tx,
    relations.map((relation) => relation.userId),
    organizationId,
  );
  if (authors.length !== relations.length) {
    throw new ApiError(
      409,
      "conflict",
      "Kurs kann nur mit aktiven Teammitgliedern als Autoren veroeffentlicht werden.",
    );
  }
}
