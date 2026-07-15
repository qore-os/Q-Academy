import "server-only";

import { and, eq, exists, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { db } from "@/db";
import { comments, posts, users } from "@/db/schema";

const activePostAuthor = alias(users, "community_active_post_author");
const activeCommentAuthor = alias(users, "community_active_comment_author");

export function communityPostAuthorIsActiveSql(): SQL {
  return exists(
    db
      .select({ id: activePostAuthor.id })
      .from(activePostAuthor)
      .where(
        and(
          eq(activePostAuthor.id, posts.authorId),
          eq(activePostAuthor.organizationId, posts.organizationId),
          eq(activePostAuthor.status, "active"),
        ),
      ),
  );
}

export function communityCommentAuthorIsActiveSql(): SQL {
  return exists(
    db
      .select({ id: activeCommentAuthor.id })
      .from(activeCommentAuthor)
      .where(
        and(
          eq(activeCommentAuthor.id, comments.authorId),
          eq(activeCommentAuthor.organizationId, comments.organizationId),
          eq(activeCommentAuthor.status, "active"),
        ),
      ),
  );
}

export function communityCommentAndPostAuthorsAreActiveSql(): SQL {
  return and(
    communityCommentAuthorIsActiveSql(),
    communityPostAuthorIsActiveSql(),
  )!;
}
