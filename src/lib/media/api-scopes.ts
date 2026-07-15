import "server-only";

import { and, eq, exists, inArray, ne, not, or, sql, type SQL } from "drizzle-orm";

import { db } from "@/db";
import {
  apiKeys,
  courseCollaborators,
  courseMediaAssets,
  comments,
  communityAssetBindings,
  communityCommentAttachments,
  communityPublicProfileFields,
  communityPostAttachments,
  communitySpaces,
  mediaAssets,
  submissionAttachments,
  submissions,
  posts,
  users,
} from "@/db/schema";
import type { ApiContext } from "@/lib/api/auth";
import { ApiError } from "@/lib/api/errors";
import type { MediaPurpose } from "@/lib/media/mime-policy";
import { communitySpaceVisibilitySql } from "@/lib/community-access";

type AccessMode = "read" | "write";
type MediaActor = Readonly<{
  id: string;
  organizationId: string;
  role: "owner" | "admin" | "trainer" | "member";
}>;

const purposeScopes: Record<
  MediaPurpose,
  Record<AccessMode, readonly string[]>
> = {
  course_content: {
    read: ["courses:read", "modules:read"],
    write: ["courses:write", "modules:write"],
  },
  submission: {
    read: ["submissions:read"],
    write: ["submissions:write"],
  },
  community: {
    read: ["community:read"],
    write: ["community:write"],
  },
  avatar: {
    read: ["members:read"],
    write: ["members:write"],
  },
  branding: {
    read: ["organization:read"],
    write: ["organization:write"],
  },
  profile: {
    read: ["members:read"],
    write: ["members:write"],
  },
};

function hasAnyScope(context: ApiContext, scopes: readonly string[]) {
  return (
    context.scopes.includes("*") ||
    scopes.some((scope) => context.scopes.includes(scope))
  );
}

export function assertMediaPurposeAccess(
  context: ApiContext,
  purpose: MediaPurpose,
  mode: AccessMode,
) {
  const accepted = purposeScopes[purpose][mode];
  if (!hasAnyScope(context, accepted)) {
    throw new ApiError(
      403,
      "insufficient_scope",
      "Dem API-Schluessel fehlt ein passender Media-Scope.",
      { accepted },
    );
  }
}

export function readableMediaPurposes(context: ApiContext) {
  return (Object.keys(purposeScopes) as MediaPurpose[]).filter((purpose) =>
    hasAnyScope(context, purposeScopes[purpose].read),
  );
}

export async function mediaActorForContext(
  context: ApiContext,
): Promise<MediaActor> {
  const [actor] = await db
    .select({
      id: users.id,
      organizationId: users.organizationId,
      role: users.role,
    })
    .from(apiKeys)
    .innerJoin(
      users,
      and(
        eq(users.id, apiKeys.createdById),
        eq(users.organizationId, apiKeys.organizationId),
        eq(users.status, "active"),
      ),
    )
    .where(
      and(
        eq(apiKeys.id, context.apiKeyId),
        eq(apiKeys.organizationId, context.organizationId),
      ),
    )
    .limit(1);
  if (!actor) {
    throw new ApiError(
      403,
      "forbidden",
      "Der API-Schluessel ist keinem aktiven Media-Akteur zugeordnet.",
    );
  }
  return actor;
}

function courseMediaBindingExists() {
  return exists(
    db
      .select({ id: courseMediaAssets.mediaAssetId })
      .from(courseMediaAssets)
      .where(
        and(
          eq(courseMediaAssets.organizationId, mediaAssets.organizationId),
          eq(courseMediaAssets.mediaAssetId, mediaAssets.id),
        ),
      ),
  );
}

function trainerCourseMediaGrant(
  actorId: string,
  permissions?: readonly ("edit" | "manage")[],
) {
  return exists(
    db
      .select({ id: courseMediaAssets.mediaAssetId })
      .from(courseMediaAssets)
      .innerJoin(
        courseCollaborators,
        and(
          eq(courseCollaborators.organizationId, courseMediaAssets.organizationId),
          eq(courseCollaborators.courseId, courseMediaAssets.courseId),
          eq(courseCollaborators.userId, actorId),
          permissions
            ? inArray(courseCollaborators.permission, [...permissions])
            : undefined,
        ),
      )
      .where(
        and(
          eq(courseMediaAssets.organizationId, mediaAssets.organizationId),
          eq(courseMediaAssets.mediaAssetId, mediaAssets.id),
        ),
      ),
  );
}

function submissionAttachmentExists() {
  return exists(
    db
      .select({ id: submissionAttachments.id })
      .from(submissionAttachments)
      .where(
        and(
          eq(submissionAttachments.organizationId, mediaAssets.organizationId),
          eq(submissionAttachments.mediaAssetId, mediaAssets.id),
        ),
      ),
  );
}

function communityAttachmentExists() {
  return exists(
    db
      .select({ id: communityAssetBindings.mediaAssetId })
      .from(communityAssetBindings)
      .where(
        and(
          eq(
            communityAssetBindings.organizationId,
            mediaAssets.organizationId,
          ),
          eq(communityAssetBindings.mediaAssetId, mediaAssets.id),
        ),
      ),
  );
}

function visibleCommunityBinding(actor: MediaActor) {
  const policyActor = {
    id: actor.id,
    role: actor.role,
    organizationId: actor.organizationId,
  };
  return or(
    exists(
      db
        .select({ id: communityPostAttachments.id })
        .from(communityPostAttachments)
        .innerJoin(
          posts,
          and(
            eq(posts.id, communityPostAttachments.postId),
            eq(posts.organizationId, communityPostAttachments.organizationId),
          ),
        )
        .innerJoin(
          communitySpaces,
          and(
            eq(communitySpaces.id, posts.spaceId),
            eq(communitySpaces.organizationId, posts.organizationId),
          ),
        )
        .where(
          and(
            eq(
              communityPostAttachments.organizationId,
              mediaAssets.organizationId,
            ),
            eq(communityPostAttachments.mediaAssetId, mediaAssets.id),
            eq(posts.moderationState, "published"),
            communitySpaceVisibilitySql(policyActor),
          ),
        ),
    ),
    exists(
      db
        .select({ id: communityCommentAttachments.id })
        .from(communityCommentAttachments)
        .innerJoin(
          comments,
          and(
            eq(comments.id, communityCommentAttachments.commentId),
            eq(comments.postId, communityCommentAttachments.postId),
            eq(
              comments.organizationId,
              communityCommentAttachments.organizationId,
            ),
          ),
        )
        .innerJoin(
          posts,
          and(
            eq(posts.id, comments.postId),
            eq(posts.organizationId, comments.organizationId),
          ),
        )
        .innerJoin(
          communitySpaces,
          and(
            eq(communitySpaces.id, posts.spaceId),
            eq(communitySpaces.organizationId, posts.organizationId),
          ),
        )
        .where(
          and(
            eq(
              communityCommentAttachments.organizationId,
              mediaAssets.organizationId,
            ),
            eq(communityCommentAttachments.mediaAssetId, mediaAssets.id),
            eq(comments.moderationState, "published"),
            eq(posts.moderationState, "published"),
            communitySpaceVisibilitySql(policyActor),
          ),
        ),
    ),
  )!;
}

function trainerSubmissionGrant(actorId: string) {
  return exists(
    db
      .select({ id: submissionAttachments.id })
      .from(submissionAttachments)
      .innerJoin(
        submissions,
        and(
          eq(submissions.organizationId, submissionAttachments.organizationId),
          eq(submissions.id, submissionAttachments.submissionId),
        ),
      )
      .innerJoin(
        courseCollaborators,
        and(
          eq(courseCollaborators.organizationId, submissions.organizationId),
          eq(courseCollaborators.courseId, submissions.courseId),
          eq(courseCollaborators.userId, actorId),
          inArray(courseCollaborators.permission, ["edit", "manage"]),
        ),
      )
      .where(
        and(
          eq(submissionAttachments.organizationId, mediaAssets.organizationId),
          eq(submissionAttachments.mediaAssetId, mediaAssets.id),
        ),
      ),
  );
}

function memberOwnSubmission(actorId: string) {
  return exists(
    db
      .select({ id: submissionAttachments.id })
      .from(submissionAttachments)
      .innerJoin(
        submissions,
        and(
          eq(submissions.organizationId, submissionAttachments.organizationId),
          eq(submissions.id, submissionAttachments.submissionId),
          eq(submissions.userId, actorId),
        ),
      )
      .where(
        and(
          eq(submissionAttachments.organizationId, mediaAssets.organizationId),
          eq(submissionAttachments.mediaAssetId, mediaAssets.id),
        ),
      ),
  );
}

function ownUnboundAsset(actorId: string, bindingExists: SQL) {
  return and(
    or(
      eq(mediaAssets.uploadedById, actorId),
      eq(mediaAssets.ownerUserId, actorId),
    ),
    not(bindingExists),
  )!;
}

function publicCommunityAvatarBindingExists() {
  return exists(
    db
      .select({ id: users.id })
      .from(users)
      .innerJoin(
        communityPublicProfileFields,
        and(
          eq(
            communityPublicProfileFields.organizationId,
            users.organizationId,
          ),
          eq(communityPublicProfileFields.standardField, "avatar"),
        ),
      )
      .where(
        and(
          eq(users.organizationId, mediaAssets.organizationId),
          eq(users.id, mediaAssets.ownerUserId),
          eq(users.status, "active"),
          sql`${users.avatarUrl} = '/api/media-assets/' || ${mediaAssets.id}::text || '/download'`,
        ),
      ),
  );
}

export function sessionMediaAssetReadVisibility(actor: MediaActor) {
  if (isMediaAdmin(actor)) {
    return or(
      and(
        ne(mediaAssets.purpose, "community"),
        ne(mediaAssets.purpose, "avatar"),
      ),
      and(
        eq(mediaAssets.purpose, "community"),
        or(
          not(communityAttachmentExists()),
          visibleCommunityBinding(actor),
        ),
      ),
      and(
        eq(mediaAssets.purpose, "avatar"),
        or(
          eq(mediaAssets.ownerUserId, actor.id),
          publicCommunityAvatarBindingExists(),
        ),
      ),
    )!;
  }

  const courseVisibility =
    actor.role === "trainer"
      ? or(
          ownUnboundAsset(actor.id, courseMediaBindingExists()),
          trainerCourseMediaGrant(actor.id),
        )!
      : sql<boolean>`false`;
  const submissionVisibility =
    actor.role === "trainer"
      ? or(
          ownUnboundAsset(actor.id, submissionAttachmentExists()),
          trainerSubmissionGrant(actor.id),
        )!
      : or(
          ownUnboundAsset(actor.id, submissionAttachmentExists()),
          memberOwnSubmission(actor.id),
        )!;
  const communityVisibility = or(
    ownUnboundAsset(actor.id, communityAttachmentExists()),
    visibleCommunityBinding(actor),
  )!;
  const avatarVisibility = or(
    eq(mediaAssets.ownerUserId, actor.id),
    publicCommunityAvatarBindingExists(),
  )!;
  const brandingVisibility = sql<boolean>`false`;
  const profileVisibility = eq(mediaAssets.ownerUserId, actor.id);

  return or(
    and(eq(mediaAssets.purpose, "course_content"), courseVisibility),
    and(eq(mediaAssets.purpose, "submission"), submissionVisibility),
    and(eq(mediaAssets.purpose, "community"), communityVisibility),
    and(eq(mediaAssets.purpose, "avatar"), avatarVisibility),
    and(eq(mediaAssets.purpose, "branding"), brandingVisibility),
    and(eq(mediaAssets.purpose, "profile"), profileVisibility),
  )!;
}

export function sessionMediaAssetManageVisibility(actor: MediaActor) {
  if (isMediaAdmin(actor)) return sql<boolean>`true`;

  const courseVisibility =
    actor.role === "trainer"
      ? or(
          ownUnboundAsset(actor.id, courseMediaBindingExists()),
          trainerCourseMediaGrant(actor.id, ["edit", "manage"]),
        )!
      : sql<boolean>`false`;
  const submissionVisibility =
    actor.role === "trainer"
      ? or(
          ownUnboundAsset(actor.id, submissionAttachmentExists()),
          trainerSubmissionGrant(actor.id),
        )!
      : or(
          ownUnboundAsset(actor.id, submissionAttachmentExists()),
          memberOwnSubmission(actor.id),
        )!;
  const communityVisibility = or(
    eq(mediaAssets.uploadedById, actor.id),
    eq(mediaAssets.ownerUserId, actor.id),
  )!;
  const avatarVisibility = eq(mediaAssets.ownerUserId, actor.id);
  const brandingVisibility = sql<boolean>`false`;
  const profileVisibility = eq(mediaAssets.ownerUserId, actor.id);

  return or(
    and(eq(mediaAssets.purpose, "course_content"), courseVisibility),
    and(eq(mediaAssets.purpose, "submission"), submissionVisibility),
    and(eq(mediaAssets.purpose, "community"), communityVisibility),
    and(eq(mediaAssets.purpose, "avatar"), avatarVisibility),
    and(eq(mediaAssets.purpose, "branding"), brandingVisibility),
    and(eq(mediaAssets.purpose, "profile"), profileVisibility),
  )!;
}

export function apiMediaReadVisibility(actor: MediaActor) {
  return or(
    and(
      ne(mediaAssets.purpose, "submission"),
      ne(mediaAssets.purpose, "community"),
      ne(mediaAssets.purpose, "avatar"),
      ne(mediaAssets.purpose, "profile"),
    ),
    and(
      eq(mediaAssets.purpose, "submission"),
      or(
        eq(mediaAssets.uploadedById, actor.id),
        eq(mediaAssets.ownerUserId, actor.id),
        submissionAttachmentExists(),
      ),
    ),
    and(
      eq(mediaAssets.purpose, "community"),
      or(
        ownUnboundAsset(actor.id, communityAttachmentExists()),
        visibleCommunityBinding(actor),
      ),
    ),
    and(
      eq(mediaAssets.purpose, "avatar"),
      or(
        eq(mediaAssets.ownerUserId, actor.id),
        isMediaAdmin(actor) ? sql<boolean>`true` : sql<boolean>`false`,
        publicCommunityAvatarBindingExists(),
      ),
    ),
    and(
      eq(mediaAssets.purpose, "profile"),
      isMediaAdmin(actor)
        ? sql<boolean>`true`
        : eq(mediaAssets.ownerUserId, actor.id),
    ),
  )!;
}

export async function assertApiPublicCommunityAvatarReadVisibility(
  context: ApiContext,
  asset: Readonly<{ id: string; purpose: MediaPurpose }>,
) {
  if (asset.purpose !== "avatar") {
    throw new ApiError(404, "not_found", "Media-Asset nicht gefunden.");
  }
  await mediaActorForContext(context);
  const [visible] = await db
    .select({ id: mediaAssets.id })
    .from(mediaAssets)
    .where(
      and(
        eq(mediaAssets.id, asset.id),
        eq(mediaAssets.organizationId, context.organizationId),
        eq(mediaAssets.purpose, "avatar"),
        publicCommunityAvatarBindingExists(),
      ),
    )
    .limit(1);
  if (!visible) {
    throw new ApiError(404, "not_found", "Profilbild nicht gefunden.");
  }
}

export function apiMediaManageVisibility(actor: MediaActor) {
  return isMediaAdmin(actor)
    ? sql<boolean>`true`
    : or(
        and(
          eq(mediaAssets.purpose, "community"),
          or(
            eq(mediaAssets.uploadedById, actor.id),
            eq(mediaAssets.ownerUserId, actor.id),
          ),
        ),
        and(
          ne(mediaAssets.purpose, "community"),
          eq(mediaAssets.uploadedById, actor.id),
        ),
      )!;
}

export async function assertApiMediaReadVisibility(
  context: ApiContext,
  asset: Readonly<{
    id: string;
    organizationId: string;
    purpose: MediaPurpose;
    uploadedById: string | null;
    ownerUserId: string | null;
  }>,
) {
  const actor = await mediaActorForContext(context);
  const [visible] = await db
    .select({ id: mediaAssets.id })
    .from(mediaAssets)
    .where(
      and(
        eq(mediaAssets.id, asset.id),
        eq(mediaAssets.organizationId, context.organizationId),
        apiMediaReadVisibility(actor),
      ),
    )
    .limit(1);
  if (!visible) {
    throw new ApiError(404, "not_found", "Media-Asset nicht gefunden.");
  }
  return actor;
}

export function isMediaAdmin(actor: MediaActor) {
  return actor.role === "owner" || actor.role === "admin";
}

export async function assertApiMediaManageVisibility(
  context: ApiContext,
  asset: Readonly<{ id: string }>,
) {
  const actor = await mediaActorForContext(context);
  const [visible] = await db
    .select({ id: mediaAssets.id })
    .from(mediaAssets)
    .where(
      and(
        eq(mediaAssets.id, asset.id),
        eq(mediaAssets.organizationId, context.organizationId),
        apiMediaManageVisibility(actor),
      ),
    )
    .limit(1);
  if (!visible) {
    throw new ApiError(404, "not_found", "Media-Asset nicht gefunden.");
  }
  return actor;
}

export async function resolveMediaOwner(input: {
  context: ApiContext;
  actor: MediaActor;
  purpose: MediaPurpose;
  requestedOwnerUserId?: string | null;
}) {
  const requiresOwner =
    input.purpose === "submission" ||
    input.purpose === "community" ||
    input.purpose === "avatar" ||
    input.purpose === "profile";
  const ownerUserId =
    input.requestedOwnerUserId === undefined
      ? requiresOwner
        ? input.actor.id
        : null
      : input.requestedOwnerUserId;

  if (!ownerUserId) {
    if (requiresOwner) {
      throw new ApiError(
        422,
        "validation_error",
        "ownerUserId ist fuer Submission-, Community-, Avatar- und Profilmedien erforderlich.",
      );
    }
    return null;
  }
  if (ownerUserId !== input.actor.id && !isMediaAdmin(input.actor)) {
    throw new ApiError(
      403,
      "forbidden",
      "Nur Administratoren duerfen Media-Assets fuer andere Mitglieder anlegen.",
    );
  }

  const [owner] = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.id, ownerUserId),
        eq(users.organizationId, input.context.organizationId),
        eq(users.status, "active"),
      ),
    )
    .limit(1);
  if (!owner) {
    throw new ApiError(
      404,
      "not_found",
      "Media-Eigentuemer nicht gefunden oder nicht aktiv.",
    );
  }
  return owner.id;
}

export type { MediaActor };
