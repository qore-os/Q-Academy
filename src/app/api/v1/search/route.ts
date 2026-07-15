import { and, asc, desc, eq, ilike, or } from "drizzle-orm";
import { db } from "@/db";
import {
  communityApiActorForContext,
  communitySpaceVisibilitySql,
  type CommunityPolicyActor,
} from "@/lib/community-access";
import { communitySpaces, courses, events, hubs, modules, posts, users } from "@/db/schema";
import { apiOptions, handleApi } from "@/lib/api/handler";
import { globalSearchQuerySchema } from "@/lib/api/schemas";
import { ApiError } from "@/lib/api/errors";
import { apiScopeIsGranted } from "@/lib/api/scopes";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

type SearchType = "courses" | "modules" | "members" | "community" | "hubs" | "events";

type SearchResult = {
  type: SearchType;
  id: string;
  title: string;
  description: string | null;
  href: string;
  metadata: Record<string, unknown>;
};

type RankedResult = {
  result: SearchResult;
  score: number;
};

function likePattern(query: string) {
  return `%${query.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}

function excerpt(value: string | null, maxLength = 320) {
  if (!value) return null;
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length <= maxLength ? compact : `${compact.slice(0, maxLength - 1).trimEnd()}...`;
}

function matchScore(query: string, title: string, searchableText: string | null) {
  const normalizedQuery = query.toLocaleLowerCase("de-DE");
  const normalizedTitle = title.toLocaleLowerCase("de-DE");
  const normalizedText = searchableText?.toLocaleLowerCase("de-DE") ?? "";
  if (normalizedTitle === normalizedQuery) return 100;
  if (normalizedTitle.startsWith(normalizedQuery)) return 80;
  if (normalizedTitle.includes(normalizedQuery)) return 60;
  if (normalizedText.includes(normalizedQuery)) return 30;
  return 10;
}

function ranked(result: SearchResult, query: string, searchableText: string | null = result.description): RankedResult {
  return { result, score: matchScore(query, result.title, searchableText) };
}

async function searchCourses(organizationId: string, query: string, pattern: string, limit: number) {
  const rows = await db
    .select({
      id: courses.id,
      title: courses.title,
      slug: courses.slug,
      shortDescription: courses.shortDescription,
      description: courses.description,
      status: courses.status,
      difficulty: courses.difficulty,
      estimatedMinutes: courses.estimatedMinutes,
      featured: courses.featured,
    })
    .from(courses)
    .where(
      and(
        eq(courses.organizationId, organizationId),
        or(
          ilike(courses.title, pattern),
          ilike(courses.shortDescription, pattern),
          ilike(courses.description, pattern),
        ),
      ),
    )
    .orderBy(asc(courses.title))
    .limit(limit);

  return rows.map((course) =>
    ranked(
      {
        type: "courses",
        id: course.id,
        title: course.title,
        description: excerpt(course.shortDescription),
        href: `/admin/courses/${course.id}`,
        metadata: {
          slug: course.slug,
          status: course.status,
          difficulty: course.difficulty,
          estimatedMinutes: course.estimatedMinutes,
          featured: course.featured,
        },
      },
      query,
      `${course.shortDescription} ${course.description}`,
    ),
  );
}

async function searchModules(organizationId: string, query: string, pattern: string, limit: number) {
  const rows = await db
    .select({
      id: modules.id,
      title: modules.title,
      description: modules.description,
      folder: modules.folder,
      isReusable: modules.isReusable,
      estimatedMinutes: modules.estimatedMinutes,
    })
    .from(modules)
    .where(
      and(
        eq(modules.organizationId, organizationId),
        or(ilike(modules.title, pattern), ilike(modules.description, pattern), ilike(modules.folder, pattern)),
      ),
    )
    .orderBy(asc(modules.title))
    .limit(limit);

  return rows.map((module) =>
    ranked(
      {
        type: "modules",
        id: module.id,
        title: module.title,
        description: excerpt(module.description),
        href: `/admin/modules?moduleId=${module.id}`,
        metadata: {
          folder: module.folder,
          isReusable: module.isReusable,
          estimatedMinutes: module.estimatedMinutes,
        },
      },
      query,
      `${module.description ?? ""} ${module.folder}`,
    ),
  );
}

async function searchMembers(organizationId: string, query: string, pattern: string, limit: number) {
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      firstName: users.firstName,
      lastName: users.lastName,
      role: users.role,
      status: users.status,
      jobTitle: users.jobTitle,
      department: users.department,
      bio: users.bio,
      points: users.points,
    })
    .from(users)
    .where(
      and(
        eq(users.organizationId, organizationId),
        or(
          ilike(users.firstName, pattern),
          ilike(users.lastName, pattern),
          ilike(users.email, pattern),
          ilike(users.jobTitle, pattern),
          ilike(users.department, pattern),
          ilike(users.bio, pattern),
        ),
      ),
    )
    .orderBy(asc(users.lastName), asc(users.firstName))
    .limit(limit);

  return rows.map((member) => {
    const title = `${member.firstName} ${member.lastName}`;
    const searchableText = [member.email, member.jobTitle, member.department, member.bio].filter(Boolean).join(" ");
    return ranked(
      {
        type: "members",
        id: member.id,
        title,
        description: excerpt([member.jobTitle, member.department, member.email].filter(Boolean).join(" | ")),
        href: `/admin/members?memberId=${member.id}`,
        metadata: {
          email: member.email,
          role: member.role,
          status: member.status,
          jobTitle: member.jobTitle,
          department: member.department,
          points: member.points,
        },
      },
      query,
      searchableText,
    );
  });
}

async function searchCommunity(organizationId: string, actor: CommunityPolicyActor, query: string, pattern: string, limit: number) {
  const [spaceRows, postRows] = await Promise.all([
    db
      .select({
        id: communitySpaces.id,
        title: communitySpaces.title,
        slug: communitySpaces.slug,
        description: communitySpaces.description,
        color: communitySpaces.color,
      })
      .from(communitySpaces)
      .where(
        and(
          eq(communitySpaces.organizationId, organizationId),
          communitySpaceVisibilitySql(actor),
          or(ilike(communitySpaces.title, pattern), ilike(communitySpaces.description, pattern)),
        ),
      )
      .orderBy(asc(communitySpaces.title))
      .limit(limit),
    db
      .select({
        id: posts.id,
        content: posts.content,
        pinned: posts.pinned,
        createdAt: posts.createdAt,
        spaceId: communitySpaces.id,
        spaceTitle: communitySpaces.title,
        authorId: users.id,
        authorFirstName: users.firstName,
        authorLastName: users.lastName,
      })
      .from(posts)
      .innerJoin(
        communitySpaces,
        and(eq(communitySpaces.id, posts.spaceId), eq(communitySpaces.organizationId, organizationId)),
      )
      .innerJoin(
        users,
        and(
          eq(users.id, posts.authorId),
          eq(users.organizationId, organizationId),
          eq(users.status, "active"),
        ),
      )
      .where(
        and(
          eq(posts.organizationId, organizationId),
          eq(posts.moderationState, "published"),
          communitySpaceVisibilitySql(actor),
          or(
            ilike(posts.content, pattern),
            ilike(communitySpaces.title, pattern),
            ilike(users.firstName, pattern),
            ilike(users.lastName, pattern),
          ),
        ),
      )
      .orderBy(desc(posts.pinned), desc(posts.createdAt))
      .limit(limit),
  ]);

  return [
    ...spaceRows.map((space) =>
      ranked(
        {
          type: "community",
          id: space.id,
          title: space.title,
          description: excerpt(space.description),
          href: `/admin/community?spaceId=${space.id}`,
          metadata: { kind: "space", slug: space.slug, color: space.color },
        },
        query,
      ),
    ),
    ...postRows.map((post) => {
      const authorName = `${post.authorFirstName} ${post.authorLastName}`;
      return ranked(
        {
          type: "community",
          id: post.id,
          title: `Beitrag von ${authorName}`,
          description: excerpt(post.content),
          href: `/admin/community?spaceId=${post.spaceId}&postId=${post.id}`,
          metadata: {
            kind: "post",
            spaceId: post.spaceId,
            spaceTitle: post.spaceTitle,
            authorId: post.authorId,
            authorName,
            pinned: post.pinned,
            createdAt: post.createdAt.toISOString(),
          },
        },
        query,
        `${post.content} ${post.spaceTitle} ${authorName}`,
      );
    }),
  ];
}

async function searchHubs(organizationId: string, query: string, pattern: string, limit: number) {
  const rows = await db
    .select({
      id: hubs.id,
      title: hubs.title,
      slug: hubs.slug,
      description: hubs.description,
      status: hubs.status,
    })
    .from(hubs)
    .where(
      and(
        eq(hubs.organizationId, organizationId),
        or(ilike(hubs.title, pattern), ilike(hubs.description, pattern)),
      ),
    )
    .orderBy(asc(hubs.title))
    .limit(limit);

  return rows.map((hub) =>
    ranked(
      {
        type: "hubs",
        id: hub.id,
        title: hub.title,
        description: excerpt(hub.description),
        href: `/admin/hubs?hubId=${hub.id}`,
        metadata: { slug: hub.slug, status: hub.status },
      },
      query,
    ),
  );
}

async function searchEvents(organizationId: string, query: string, pattern: string, limit: number) {
  const rows = await db
    .select({
      id: events.id,
      title: events.title,
      description: events.description,
      type: events.type,
      startsAt: events.startsAt,
      endsAt: events.endsAt,
      timezone: events.timezone,
      location: events.location,
    })
    .from(events)
    .where(
      and(
        eq(events.organizationId, organizationId),
        or(ilike(events.title, pattern), ilike(events.description, pattern), ilike(events.location, pattern)),
      ),
    )
    .orderBy(desc(events.startsAt))
    .limit(limit);

  return rows.map((event) =>
    ranked(
      {
        type: "events",
        id: event.id,
        title: event.title,
        description: excerpt(event.description),
        href: `/admin/events?eventId=${event.id}`,
        metadata: {
          type: event.type,
          startsAt: event.startsAt.toISOString(),
          endsAt: event.endsAt.toISOString(),
          timezone: event.timezone,
          location: event.location,
        },
      },
      query,
      `${event.description ?? ""} ${event.location ?? ""}`,
    ),
  );
}

export async function GET(request: Request) {
  return handleApi(
    request,
    { scopes: ["search:read"], action: "search.global", resourceType: "search" },
    async (context) => {
      const url = new URL(request.url);
      const input = globalSearchQuerySchema.parse({
        q: url.searchParams.get("q"),
        types: url.searchParams.get("types") ?? undefined,
        limit: url.searchParams.get("limit") ?? undefined,
      });
      const pattern = likePattern(input.q);
      if (
        input.types.includes("members") &&
        !apiScopeIsGranted(context.scopes, "members:read")
      ) {
        throw new ApiError(
          403,
          "insufficient_scope",
          "Die Mitgliedersuche benoetigt den Scope members:read.",
          { missing: ["members:read"] },
        );
      }
      const communityActor = input.types.includes("community")
        ? await communityApiActorForContext(context)
        : null;

      const searches: Array<Promise<RankedResult[]>> = [];
      for (const type of input.types) {
        if (type === "courses") searches.push(searchCourses(context.organizationId, input.q, pattern, input.limit));
        if (type === "modules") searches.push(searchModules(context.organizationId, input.q, pattern, input.limit));
        if (type === "members") searches.push(searchMembers(context.organizationId, input.q, pattern, input.limit));
        if (type === "community" && communityActor) searches.push(searchCommunity(context.organizationId, communityActor, input.q, pattern, input.limit));
        if (type === "hubs") searches.push(searchHubs(context.organizationId, input.q, pattern, input.limit));
        if (type === "events") searches.push(searchEvents(context.organizationId, input.q, pattern, input.limit));
      }

      const rankedResults = (await Promise.all(searches))
        .flat()
        .sort(
          (left, right) =>
            right.score - left.score ||
            left.result.title.localeCompare(right.result.title, "de") ||
            left.result.type.localeCompare(right.result.type),
        );
      const data = rankedResults.slice(0, input.limit).map(({ result }) => result);

      return {
        data,
        meta: {
          query: input.q,
          types: input.types,
          limit: input.limit,
          returned: data.length,
        },
      };
    },
  );
}
