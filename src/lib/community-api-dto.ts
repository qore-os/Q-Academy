import type {
  comments,
  communityAreas,
  communitySpaceAccessRules,
  communitySpaces,
  posts,
} from "@/db/schema";

type CommunityPostApiSource = Pick<
  typeof posts.$inferSelect,
  | "id"
  | "spaceId"
  | "authorId"
  | "title"
  | "content"
  | "contentFormat"
  | "richText"
  | "contentProjectionVersion"
  | "imageUrl"
  | "pinned"
  | "locked"
  | "moderationState"
  | "moderationVersion"
  | "publishedAt"
  | "createdAt"
  | "updatedAt"
>;

type CommunityCommentApiSource = Pick<
  typeof comments.$inferSelect,
  | "id"
  | "postId"
  | "authorId"
  | "parentId"
  | "content"
  | "contentFormat"
  | "richText"
  | "contentProjectionVersion"
  | "moderationState"
  | "moderationVersion"
  | "publishedAt"
  | "createdAt"
  | "updatedAt"
>;

export function communityPostApiDto(post: CommunityPostApiSource) {
  return {
    id: post.id,
    spaceId: post.spaceId,
    authorId: post.authorId,
    title: post.title,
    content: post.content,
    contentFormat: post.contentFormat,
    richText: post.richText,
    contentProjectionVersion: post.contentProjectionVersion,
    imageUrl: post.imageUrl,
    pinned: post.pinned,
    locked: post.locked,
    moderationState: post.moderationState,
    moderationVersion: post.moderationVersion,
    publishedAt: post.publishedAt,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
  };
}

export function communityCommentApiDto(comment: CommunityCommentApiSource) {
  return {
    id: comment.id,
    postId: comment.postId,
    authorId: comment.authorId,
    parentId: comment.parentId,
    content: comment.content,
    contentFormat: comment.contentFormat,
    richText: comment.richText,
    contentProjectionVersion: comment.contentProjectionVersion,
    moderationState: comment.moderationState,
    moderationVersion: comment.moderationVersion,
    publishedAt: comment.publishedAt,
    createdAt: comment.createdAt,
    updatedAt: comment.updatedAt,
  };
}

type CommunityAreaApiSource = Pick<
  typeof communityAreas.$inferSelect,
  | "id"
  | "title"
  | "slug"
  | "description"
  | "sortOrder"
  | "createdAt"
  | "updatedAt"
>;

type CommunitySpaceApiSource = Pick<
  typeof communitySpaces.$inferSelect,
  | "id"
  | "areaId"
  | "title"
  | "slug"
  | "description"
  | "color"
  | "type"
  | "accessMode"
  | "sortOrder"
  | "createdAt"
  | "updatedAt"
>;

type CommunityAccessRuleApiSource = Pick<
  typeof communitySpaceAccessRules.$inferSelect,
  "subjectType" | "canView" | "canPost" | "canComment"
> &
  Partial<
    Pick<
      typeof communitySpaceAccessRules.$inferSelect,
      | "subjectRole"
      | "subjectUserId"
      | "subjectGroupId"
      | "subjectBundleId"
    >
  >;

export function communityAreaApiDto(
  area: CommunityAreaApiSource,
  spaceIds: readonly string[] = [],
) {
  return {
    id: area.id,
    title: area.title,
    slug: area.slug,
    description: area.description,
    sortOrder: area.sortOrder,
    createdAt: area.createdAt,
    updatedAt: area.updatedAt,
    spaceIds: [...spaceIds],
  };
}

export function communitySpaceApiDto(space: CommunitySpaceApiSource) {
  return {
    id: space.id,
    areaId: space.areaId,
    title: space.title,
    slug: space.slug,
    description: space.description,
    color: space.color,
    type: space.type,
    accessMode: space.accessMode,
    sortOrder: space.sortOrder,
    createdAt: space.createdAt,
    updatedAt: space.updatedAt,
  };
}

export function communityAccessRuleApiDto(rule: CommunityAccessRuleApiSource) {
  return {
    subjectType: rule.subjectType,
    subjectRole: rule.subjectRole ?? null,
    subjectUserId: rule.subjectUserId ?? null,
    subjectGroupId: rule.subjectGroupId ?? null,
    subjectBundleId: rule.subjectBundleId ?? null,
    canView: rule.canView,
    canPost: rule.canPost,
    canComment: rule.canComment,
  };
}

export function communitySpaceAccessPolicyApiDto(input: {
  id: string;
  accessMode: "open" | "restricted";
  rules: readonly CommunityAccessRuleApiSource[];
}) {
  return {
    spaceId: input.id,
    accessMode: input.accessMode,
    rules: input.rules.map(communityAccessRuleApiDto),
  };
}
