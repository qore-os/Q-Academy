import "server-only";

import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import {
  courseCollaborators,
  courses,
  enrollments,
} from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import type { CommunityPolicyActor } from "@/lib/community-access";
import {
  coursePermissionAllows,
  resolveCoursePermission,
} from "@/lib/course-permission-policy";
import { resolveMemberCourseAccessWithReader } from "@/lib/member-course-access";
import { getPublishedCourseContent } from "@/lib/published-course";
import { getTeamAccessForUser } from "@/lib/team-permissions";
import { teamPermissionAllows } from "@/lib/team-permission-policy";

type CourseLinkReader = Pick<typeof db, "select">;

export type CommunityCourseLink = Readonly<{
  type: "course";
  courseId: string;
  title: string;
  slug: string;
  href: string;
}>;

async function actorCanViewCourse(
  reader: CourseLinkReader,
  actor: CommunityPolicyActor,
  courseId: string,
) {
  if (actor.role === "owner") return true;
  if (actor.role === "member") {
    const [enrollment] = await reader
      .select({ id: enrollments.id })
      .from(enrollments)
      .where(
        and(
          eq(enrollments.userId, actor.id),
          eq(enrollments.courseId, courseId),
          eq(enrollments.accessActive, true),
        ),
      )
      .limit(1);
    if (!enrollment) return false;
    const access = await resolveMemberCourseAccessWithReader(reader, {
      organizationId: actor.organizationId,
      userId: actor.id,
      courseIds: [courseId],
    });
    return access.get(courseId)?.accessible === true;
  }
  const [collaboration] = await reader
    .select({ permission: courseCollaborators.permission })
    .from(courseCollaborators)
    .where(
      and(
        eq(courseCollaborators.organizationId, actor.organizationId),
        eq(courseCollaborators.courseId, courseId),
        eq(courseCollaborators.userId, actor.id),
      ),
    )
    .limit(1);
  const teamAccess = await getTeamAccessForUser(actor, reader);
  if (!teamPermissionAllows(teamAccess.permissions, "courses.view")) {
    return false;
  }
  return coursePermissionAllows(
    resolveCoursePermission(actor.role, collaboration?.permission ?? null),
    "view",
  );
}

export async function communityCourseLinkForActor(
  actor: CommunityPolicyActor,
  courseId: string,
  reader: CourseLinkReader = db,
): Promise<CommunityCourseLink | null> {
  const published = await getPublishedCourseContent(reader, {
    organizationId: actor.organizationId,
    courseId,
  });
  if (!published) return null;
  if (
    actor.role === "member" &&
    published.snapshot.course.visibleInCatalog === false
  ) {
    return null;
  }
  if (!(await actorCanViewCourse(reader, actor, courseId))) return null;
  return {
    type: "course",
    courseId,
    title: published.snapshot.course.title,
    slug: published.snapshot.course.slug,
    href: `/academy/courses/${published.snapshot.course.slug}`,
  };
}

export async function requireCommunityCourseLinkForActor(
  reader: CourseLinkReader,
  actor: CommunityPolicyActor,
  courseId: string,
) {
  const [locked] = await reader
    .select({ id: courses.id })
    .from(courses)
    .where(
      and(
        eq(courses.id, courseId),
        eq(courses.organizationId, actor.organizationId),
        eq(courses.status, "published"),
      ),
    )
    .limit(1)
    .for("share", { of: courses });
  const link = locked
    ? await communityCourseLinkForActor(actor, courseId, reader)
    : null;
  if (!link) {
    throw new ApiError(
      422,
      "validation_error",
      "courseId verweist nicht auf einen sichtbaren veroeffentlichten Kurs.",
    );
  }
  return link;
}

export async function communityCourseLinksForPosts(
  actor: CommunityPolicyActor,
  postsWithLinks: readonly Readonly<{
    id: string;
    linkedCourseId: string | null;
  }>[],
  reader: CourseLinkReader = db,
) {
  const linksByCourse = new Map<string, CommunityCourseLink | null>();
  for (const courseId of new Set(
    postsWithLinks.flatMap((post) =>
      post.linkedCourseId ? [post.linkedCourseId] : [],
    ),
  )) {
    linksByCourse.set(
      courseId,
      await communityCourseLinkForActor(actor, courseId, reader),
    );
  }
  return new Map(
    postsWithLinks.map((post) => [
      post.id,
      post.linkedCourseId
        ? (linksByCourse.get(post.linkedCourseId) ?? null)
        : null,
    ]),
  );
}
