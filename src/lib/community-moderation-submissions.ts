import "server-only";

import { db } from "@/db";
import { queryOwnCommunityModerationSubmissions } from "@/lib/community-moderation-submissions-core";

export async function getOwnCommunityModerationSubmissions(input: {
  organizationId: string;
  authorId: string;
  limit?: number;
}) {
  return queryOwnCommunityModerationSubmissions(db, input);
}

export type {
  CommunityOwnModerationStatus,
  CommunityOwnModerationSubmission,
} from "@/lib/community-moderation-submissions-core";
