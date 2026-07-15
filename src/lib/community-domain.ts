export const COMMUNITY_SPACE_TYPES = [
  "feed",
  "discussion",
  "announcement",
] as const;
export type CommunitySpaceType = (typeof COMMUNITY_SPACE_TYPES)[number];

export const COMMUNITY_REACTION_TYPES = [
  "like",
  "celebrate",
  "insightful",
  "question",
] as const;
export type CommunityReactionType =
  (typeof COMMUNITY_REACTION_TYPES)[number];

const MENTION_PATTERN =
  /(?:^|[\s([{])@([a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?)/gi;
const VALID_HANDLE_PATTERN =
  /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/;

export function mentionHandleForEmail(email: string) {
  const separator = email.indexOf("@");
  if (separator <= 0) return null;
  const handle = email.slice(0, separator).trim().toLowerCase();
  return VALID_HANDLE_PATTERN.test(handle) ? handle : null;
}

export function extractMentionHandles(content: string, limit = 20) {
  const handles: string[] = [];
  const seen = new Set<string>();
  for (const match of content.matchAll(MENTION_PATTERN)) {
    const handle = match[1]?.toLowerCase();
    if (!handle || seen.has(handle)) continue;
    seen.add(handle);
    handles.push(handle);
    if (handles.length >= limit) break;
  }
  return handles;
}

export function communitySpaceRequiresTitle(type: CommunitySpaceType) {
  return type === "discussion" || type === "announcement";
}

export function canCreateCommunityPost(
  role: "owner" | "admin" | "trainer" | "member",
  type: CommunitySpaceType,
) {
  return type !== "announcement" || role === "owner" || role === "admin";
}

export function canReplyToCommunityPost(input: {
  type: CommunitySpaceType;
  locked: boolean;
}) {
  return !input.locked && input.type !== "announcement";
}
