import { and, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { communitySpaces, posts, users } from "@/db/schema";
import { apiOptions, handleApi, parseJson } from "@/lib/api/handler";
import { ApiError } from "@/lib/api/errors";
import { paginationMeta, parsePagination } from "@/lib/api/pagination";
import { postCreateSchema } from "@/lib/api/schemas";
import { createCommunityPostMutation } from "@/lib/community-mutations";
import {
  assertCommunityApiActorCanActAs,
  communityApiActorForContext,
  communitySpaceVisibilitySql,
} from "@/lib/community-access";
import { communityAttachmentsForPosts } from "@/lib/community-attachments";
import { communityPostApiDto } from "@/lib/community-api-dto";
import {
  communityCourseLinkForActor,
  communityCourseLinksForPosts,
} from "@/lib/community-course-links";
import { getCommunityPublicProfiles } from "@/lib/community-public-profile";

export const dynamic = "force-dynamic";
export const OPTIONS = apiOptions;

export async function GET(request: Request) {
  return handleApi(request, { scopes: ["community:read"], action: "community.post.list", resourceType: "post" }, async (context) => {
    const actor = await communityApiActorForContext(context);
    const url = new URL(request.url);
    const pagination = parsePagination(url);
    const conditions: SQL[] = [
      eq(posts.organizationId, context.organizationId),
      eq(posts.moderationState, "published"),
      communitySpaceVisibilitySql(actor),
      sql`exists (
        select 1 from users api_post_list_actor
        where api_post_list_actor.id = ${actor.id}
          and api_post_list_actor.organization_id = ${actor.organizationId}
          and api_post_list_actor.status = 'active'
          and api_post_list_actor.role = ${actor.role}
      )`,
    ];
    const spaceId = url.searchParams.get("spaceId");
    const authorId = url.searchParams.get("authorId");
    const search = url.searchParams.get("search")?.trim();
    if (spaceId) conditions.push(eq(posts.spaceId, spaceId));
    if (authorId) conditions.push(eq(posts.authorId, authorId));
    if (search) {
      conditions.push(
        or(
          ilike(posts.content, `%${search}%`),
          ilike(posts.title, `%${search}%`),
        )!,
      );
    }
    const rows = await db
      .select({
        id: posts.id,
        title: posts.title,
        content: posts.content,
        contentFormat: posts.contentFormat,
        richText: posts.richText,
        contentProjectionVersion: posts.contentProjectionVersion,
        imageUrl: posts.imageUrl,
        pinned: posts.pinned,
        locked: posts.locked,
        createdAt: posts.createdAt,
        updatedAt: posts.updatedAt,
        linkedCourseId: posts.linkedCourseId,
        spaceId: communitySpaces.id,
        spaceTitle: communitySpaces.title,
        spaceType: communitySpaces.type,
        authorId: users.id,
        authorFirstName: users.firstName,
        authorLastName: users.lastName,
        reactionCount:
          sql<number>`(select count(*) from post_likes pl where pl.organization_id = ${context.organizationId} and pl.post_id = ${posts.id})`.mapWith(Number),
        likeCount:
          sql<number>`(select count(*) from post_likes pl where pl.organization_id = ${context.organizationId} and pl.post_id = ${posts.id} and pl.reaction = 'like')`.mapWith(Number),
        celebrateCount:
          sql<number>`(select count(*) from post_likes pl where pl.organization_id = ${context.organizationId} and pl.post_id = ${posts.id} and pl.reaction = 'celebrate')`.mapWith(Number),
        insightfulCount:
          sql<number>`(select count(*) from post_likes pl where pl.organization_id = ${context.organizationId} and pl.post_id = ${posts.id} and pl.reaction = 'insightful')`.mapWith(Number),
        questionCount:
          sql<number>`(select count(*) from post_likes pl where pl.organization_id = ${context.organizationId} and pl.post_id = ${posts.id} and pl.reaction = 'question')`.mapWith(Number),
        voteScore:
          sql<number>`coalesce((select sum(pv.value) from post_votes pv where pv.organization_id = ${context.organizationId} and pv.post_id = ${posts.id}), 0)`.mapWith(Number),
        commentCount:
          sql<number>`(select count(*) from comments c where c.organization_id = ${context.organizationId} and c.post_id = ${posts.id} and c.moderation_state = 'published')`.mapWith(Number),
      })
      .from(posts)
      .innerJoin(communitySpaces, and(eq(communitySpaces.id, posts.spaceId), eq(communitySpaces.organizationId, context.organizationId)))
      .innerJoin(
        users,
        and(
          eq(users.id, posts.authorId),
          eq(users.organizationId, context.organizationId),
          eq(users.status, "active"),
        ),
      )
      .where(and(...conditions))
      .orderBy(desc(posts.pinned), desc(posts.createdAt))
      .limit(pagination.limit + 1)
      .offset(pagination.offset);
    const hasMore = rows.length > pagination.limit;
    const pageRows = hasMore ? rows.slice(0, pagination.limit) : rows;
    const [attachments, courseLinks, profilesByUser] = await Promise.all([
      communityAttachmentsForPosts({
        organizationId: context.organizationId,
        postIds: pageRows.map((post) => post.id),
        downloadContext: "api",
      }),
      communityCourseLinksForPosts(actor, pageRows),
      getCommunityPublicProfiles({
        organizationId: context.organizationId,
        memberIds: pageRows.map((post) => post.authorId),
        downloadContext: "api",
      }),
    ]);
    const data = pageRows.map((post) => {
      const { linkedCourseId, ...publicPost } = post;
      return {
        ...publicPost,
        authorAvatarUrl: profilesByUser.get(post.authorId)?.avatarUrl ?? null,
        authorProfile: profilesByUser.get(post.authorId) ?? null,
        courseLink: linkedCourseId ? (courseLinks.get(post.id) ?? null) : null,
        attachments: attachments.get(post.id) ?? [],
      };
    });
    const finalActor = await communityApiActorForContext(context);
    if (finalActor.id !== actor.id || finalActor.role !== actor.role) {
      throw new ApiError(403, "forbidden", "Community-Berechtigung hat sich geaendert.");
    }
    return { data, meta: { pagination: paginationMeta(pagination, data.length, hasMore) } };
  });
}

export async function POST(request: Request) {
  return handleApi(request, { scopes: ["community:write"], action: "community.post.create", resourceType: "post", idempotent: true }, async (context) => {
    const input = await parseJson(request, postCreateSchema);
    const actor = await communityApiActorForContext(context);
    assertCommunityApiActorCanActAs(actor, input.authorId);
    const post = await createCommunityPostMutation({
      organizationId: context.organizationId,
      ...input,
      allowModeration: actor.role === "owner" || actor.role === "admin",
    });
    const attachments = await communityAttachmentsForPosts({
      organizationId: context.organizationId,
      postIds: [post.id],
      downloadContext: "api",
    });
    const courseLink = post.linkedCourseId
      ? await communityCourseLinkForActor(actor, post.linkedCourseId)
      : null;
    return {
      data: {
        ...communityPostApiDto(post),
        courseLink,
        attachments: attachments.get(post.id) ?? [],
      },
      status: 201,
      resourceId: post.id,
    };
  });
}
