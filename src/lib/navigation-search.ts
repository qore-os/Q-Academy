import "server-only";

import { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  communitySpaces,
  courseCollaborators,
  courses,
  events,
  hubs,
  modules,
  posts,
  users,
  type User,
} from "@/db/schema";
import { resolveCoursePermission } from "@/lib/course-permission-policy";
import { getMemberCourses, getMemberHubs } from "@/lib/data";
import { eventVisibilitySql } from "@/lib/event-access";
import { communitySpaceVisibilitySql } from "@/lib/community-access";
import { getTeamAccessForUser } from "@/lib/team-permissions";
import { teamPermissionAllows } from "@/lib/team-permission-policy";

export type NavigationSearchMode = "admin" | "member";
export type NavigationSearchKind =
  "course" | "module" | "member" | "community" | "hub" | "event";

export type NavigationSearchResult = {
  id: string;
  kind: NavigationSearchKind;
  title: string;
  description: string | null;
  href: string;
};

type SearchUser = Pick<User, "id" | "organizationId" | "role">;
type RankedResult = NavigationSearchResult & { score: number };

const ADMIN_ROLES: readonly User["role"][] = ["owner", "admin", "trainer"];
const RESULTS_PER_CATEGORY = 5;

export class NavigationSearchForbiddenError extends Error {}

function likePattern(query: string) {
  return `%${query.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}

function excerpt(value: string | null, maxLength = 150) {
  if (!value) return null;
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length <= maxLength
    ? compact
    : `${compact.slice(0, maxLength - 3).trimEnd()}...`;
}

function relevance(query: string, title: string, searchable: string | null) {
  const normalizedQuery = query.toLocaleLowerCase("de-DE");
  const normalizedTitle = title.toLocaleLowerCase("de-DE");
  const normalizedSearchable = searchable?.toLocaleLowerCase("de-DE") ?? "";

  if (normalizedTitle === normalizedQuery) return 100;
  if (normalizedTitle.startsWith(normalizedQuery)) return 80;
  if (normalizedTitle.includes(normalizedQuery)) return 60;
  if (normalizedSearchable.includes(normalizedQuery)) return 30;
  return 10;
}

function ranked(
  result: NavigationSearchResult,
  query: string,
  searchable: string | null = result.description,
): RankedResult {
  return { ...result, score: relevance(query, result.title, searchable) };
}

function finish(results: RankedResult[]) {
  return results
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.title.localeCompare(right.title, "de-DE"),
    )
    .slice(0, RESULTS_PER_CATEGORY)
    .map(({ id, kind, title, description, href }) => ({
      id,
      kind,
      title,
      description,
      href,
    }));
}

async function searchAdminCourses(
  user: SearchUser,
  query: string,
  pattern: string,
) {
  const rows = await db
    .select({
      id: courses.id,
      title: courses.title,
      shortDescription: courses.shortDescription,
      description: courses.description,
      permission: courseCollaborators.permission,
    })
    .from(courses)
    .leftJoin(
      courseCollaborators,
      and(
        eq(courseCollaborators.organizationId, courses.organizationId),
        eq(courseCollaborators.courseId, courses.id),
        eq(courseCollaborators.userId, user.id),
      ),
    )
    .where(
      and(
        eq(courses.organizationId, user.organizationId),
        user.role === "trainer"
          ? eq(courseCollaborators.userId, user.id)
          : undefined,
        or(
          ilike(courses.title, pattern),
          ilike(courses.shortDescription, pattern),
          ilike(courses.description, pattern),
        ),
      ),
    )
    .orderBy(asc(courses.title))
    .limit(RESULTS_PER_CATEGORY * 2);

  return finish(
    rows.map((course) => {
      const permission = resolveCoursePermission(user.role, course.permission);
      return ranked(
        {
          id: course.id,
          kind: "course",
          title: course.title,
          description: excerpt(course.shortDescription),
          href:
            permission === "view"
              ? `/admin/courses/${course.id}/preview`
              : `/admin/courses/${course.id}`,
        },
        query,
        `${course.shortDescription} ${course.description}`,
      );
    }),
  );
}

async function searchAdminModules(
  organizationId: string,
  query: string,
  pattern: string,
) {
  const rows = await db
    .select({
      id: modules.id,
      title: modules.title,
      description: modules.description,
      folder: modules.folder,
    })
    .from(modules)
    .where(
      and(
        eq(modules.organizationId, organizationId),
        or(
          ilike(modules.title, pattern),
          ilike(modules.description, pattern),
          ilike(modules.folder, pattern),
        ),
      ),
    )
    .orderBy(asc(modules.title))
    .limit(RESULTS_PER_CATEGORY * 2);

  return finish(
    rows.map((module) =>
      ranked(
        {
          id: module.id,
          kind: "module",
          title: module.title,
          description: excerpt(
            [module.folder, module.description].filter(Boolean).join(" - "),
          ),
          href: `/admin/modules#module-${module.id}`,
        },
        query,
        `${module.folder} ${module.description ?? ""}`,
      ),
    ),
  );
}

async function searchAdminMembers(
  organizationId: string,
  query: string,
  pattern: string,
) {
  const rows = await db
    .select({
      id: users.id,
      firstName: users.firstName,
      lastName: users.lastName,
      email: users.email,
      department: users.department,
      jobTitle: users.jobTitle,
    })
    .from(users)
    .where(
      and(
        eq(users.organizationId, organizationId),
        or(
          ilike(
            sql<string>`concat(${users.firstName}, ' ', ${users.lastName})`,
            pattern,
          ),
          ilike(users.firstName, pattern),
          ilike(users.lastName, pattern),
          ilike(users.email, pattern),
          ilike(users.department, pattern),
          ilike(users.jobTitle, pattern),
        ),
      ),
    )
    .orderBy(asc(users.lastName), asc(users.firstName))
    .limit(RESULTS_PER_CATEGORY * 2);

  return finish(
    rows.map((member) => {
      const title = `${member.firstName} ${member.lastName}`;
      const details = [member.jobTitle, member.department, member.email]
        .filter(Boolean)
        .join(" - ");
      return ranked(
        {
          id: member.id,
          kind: "member",
          title,
          description: excerpt(details),
          href: `/admin/members/${member.id}`,
        },
        query,
        `${member.email} ${member.department ?? ""} ${member.jobTitle ?? ""}`,
      );
    }),
  );
}

async function searchCommunity(
  user: SearchUser,
  query: string,
  pattern: string,
  mode: NavigationSearchMode,
) {
  const [spaceRows, postRows] = await Promise.all([
    db
      .select({
        id: communitySpaces.id,
        title: communitySpaces.title,
        description: communitySpaces.description,
      })
      .from(communitySpaces)
      .where(
        and(
          eq(communitySpaces.organizationId, user.organizationId),
          communitySpaceVisibilitySql(user),
          or(
            ilike(communitySpaces.title, pattern),
            ilike(communitySpaces.description, pattern),
          ),
        ),
      )
      .orderBy(asc(communitySpaces.title))
      .limit(RESULTS_PER_CATEGORY),
    db
      .select({
        id: posts.id,
        content: posts.content,
        spaceTitle: communitySpaces.title,
        firstName: users.firstName,
        lastName: users.lastName,
        createdAt: posts.createdAt,
      })
      .from(posts)
      .innerJoin(
        communitySpaces,
        and(
          eq(communitySpaces.id, posts.spaceId),
          eq(communitySpaces.organizationId, user.organizationId),
        ),
      )
      .innerJoin(
        users,
        and(
          eq(users.id, posts.authorId),
          eq(users.organizationId, user.organizationId),
        ),
      )
      .where(
        and(
          eq(posts.organizationId, user.organizationId),
          eq(posts.moderationState, "published"),
          communitySpaceVisibilitySql(user),
          or(
            ilike(posts.content, pattern),
            ilike(communitySpaces.title, pattern),
            ilike(users.firstName, pattern),
            ilike(users.lastName, pattern),
          ),
        ),
      )
      .orderBy(desc(posts.pinned), desc(posts.createdAt))
      .limit(RESULTS_PER_CATEGORY),
  ]);

  const href = mode === "admin" ? "/admin/community" : "/academy/community";
  return finish([
    ...spaceRows.map((space) =>
      ranked(
        {
          id: space.id,
          kind: "community",
          title: space.title,
          description: excerpt(space.description),
          href,
        },
        query,
      ),
    ),
    ...postRows.map((post) => {
      const author = `${post.firstName} ${post.lastName}`;
      return ranked(
        {
          id: post.id,
          kind: "community",
          title: `Beitrag in ${post.spaceTitle}`,
          description: excerpt(post.content),
          href,
        },
        query,
        `${post.content} ${post.spaceTitle} ${author}`,
      );
    }),
  ]);
}

async function searchAdminHubs(
  organizationId: string,
  query: string,
  pattern: string,
) {
  const rows = await db
    .select({ id: hubs.id, title: hubs.title, description: hubs.description })
    .from(hubs)
    .where(
      and(
        eq(hubs.organizationId, organizationId),
        or(ilike(hubs.title, pattern), ilike(hubs.description, pattern)),
      ),
    )
    .orderBy(asc(hubs.title))
    .limit(RESULTS_PER_CATEGORY * 2);

  return finish(
    rows.map((hub) =>
      ranked(
        {
          id: hub.id,
          kind: "hub",
          title: hub.title,
          description: excerpt(hub.description),
          href: `/admin/hubs#hub-${hub.id}`,
        },
        query,
      ),
    ),
  );
}

async function searchMemberHubs(user: SearchUser, query: string) {
  const normalizedQuery = query.toLocaleLowerCase("de-DE");
  const accessibleHubs = await getMemberHubs(user.id, user.organizationId);

  return finish(
    accessibleHubs
      .filter((hub) => hub.status === "published")
      .filter((hub) =>
        `${hub.title} ${hub.description ?? ""}`
          .toLocaleLowerCase("de-DE")
          .includes(normalizedQuery),
      )
      .map((hub) =>
        ranked(
          {
            id: hub.id,
            kind: "hub",
            title: hub.title,
            description: excerpt(hub.description),
            href: `/academy/hub?hub=${encodeURIComponent(hub.slug)}`,
          },
          query,
        ),
      ),
  );
}

async function searchEvents(
  organizationId: string,
  query: string,
  pattern: string,
  mode: NavigationSearchMode,
  userId?: string,
) {
  const rows = await db
    .select({
      id: events.id,
      title: events.title,
      description: events.description,
      location: events.location,
      startsAt: events.startsAt,
    })
    .from(events)
    .where(
      and(
        eq(events.organizationId, organizationId),
        ...(userId ? [eventVisibilitySql(userId, organizationId)] : []),
        or(
          ilike(events.title, pattern),
          ilike(events.description, pattern),
          ilike(events.location, pattern),
        ),
      ),
    )
    .orderBy(asc(events.startsAt))
    .limit(RESULTS_PER_CATEGORY * 2);

  const baseHref = mode === "admin" ? "/admin/events" : "/academy/events";
  return finish(
    rows.map((event) =>
      ranked(
        {
          id: event.id,
          kind: "event",
          title: event.title,
          description: excerpt(
            [event.location, event.description].filter(Boolean).join(" - "),
          ),
          href: `${baseHref}#event-${event.id}`,
        },
        query,
        `${event.location ?? ""} ${event.description ?? ""}`,
      ),
    ),
  );
}

async function searchMemberCourses(
  user: SearchUser,
  query: string,
) {
  const normalizedQuery = query.toLocaleLowerCase("de-DE");
  const rows = (await getMemberCourses(user.id, user.organizationId)).filter(
    (course) =>
      `${course.title} ${course.shortDescription}`
        .toLocaleLowerCase("de-DE")
        .includes(normalizedQuery),
  );

  return finish(
    rows.map((course) =>
      ranked(
        {
          id: course.id,
          kind: "course",
          title: course.title,
          description: excerpt(course.shortDescription),
          href: `/academy/courses/${course.slug}`,
        },
        query,
        course.shortDescription,
      ),
    ),
  );
}

export async function searchNavigation(
  user: SearchUser,
  mode: NavigationSearchMode,
  query: string,
) {
  if (mode === "admin" && !ADMIN_ROLES.includes(user.role)) {
    throw new NavigationSearchForbiddenError();
  }

  const pattern = likePattern(query);
  if (mode === "admin") {
    const access = await getTeamAccessForUser(user);
    const searches: Array<Promise<NavigationSearchResult[]>> = [];
    if (teamPermissionAllows(access.permissions, "courses.view")) {
      searches.push(
        searchAdminCourses(user, query, pattern),
        searchAdminModules(user.organizationId, query, pattern),
      );
    }
    if (teamPermissionAllows(access.permissions, "members.view")) {
      searches.push(searchAdminMembers(user.organizationId, query, pattern));
    }
    if (teamPermissionAllows(access.permissions, "community.view")) {
      searches.push(searchCommunity(user, query, pattern, mode));
    }
    if (teamPermissionAllows(access.permissions, "settings.view")) {
      searches.push(searchAdminHubs(user.organizationId, query, pattern));
    }
    if (teamPermissionAllows(access.permissions, "events.view")) {
      searches.push(searchEvents(user.organizationId, query, pattern, mode));
    }
    const groups = await Promise.all(searches);
    return groups.flat();
  }

  const groups = await Promise.all([
    searchMemberCourses(user, query),
    searchCommunity(user, query, pattern, mode),
    searchMemberHubs(user, query),
    searchEvents(user.organizationId, query, pattern, mode, user.id),
  ]);
  return groups.flat();
}
