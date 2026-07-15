"use server";

import { randomBytes } from "node:crypto";
import { hash } from "bcryptjs";
import { and, count, eq, inArray, isNull, sql } from "drizzle-orm";
import { revalidatePath, updateTag } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/db";
import {
  activityEvents,
  courseCategories,
  courseCollaborators,
  courses,
  customDomainClaims,
  eventAttendees,
  events,
  lessonProgress,
  mediaAssets,
  mediaPlaybackProgress,
  organizations,
  platformSettings,
  postLikes,
  submissions,
  users,
  type User,
} from "@/db/schema";
import {
  hasPassedRequiredQuiz,
  submitAssessmentAttempt,
} from "@/lib/assessments";
import type { AssessmentAnswerInput } from "@/lib/assessment-engine";
import { ApiError } from "@/lib/api/errors";
import {
  lockCourseForVersion,
  publishCourseVersion,
} from "@/lib/api/course-versioning";
import { assessmentSubmissionSchema } from "@/lib/api/schemas";
import { enqueueWebhook } from "@/lib/api/webhooks";
import {
  createSession,
  deleteSession,
  PasswordLoginDisabledError,
  requireAdmin,
  requireTeamPermission,
  requireUser,
} from "@/lib/auth";
import { InactiveOrganizationError } from "@/lib/organization-status";
import {
  assertOrganizationCourseCapacity,
  assertOrganizationSeatCapacity,
} from "@/lib/organization-contracts";
import { logServerError } from "@/lib/server-error-logging";
import {
  canonicalTenantAuthOrigin,
  getAuthTenantForRequest,
  getCanonicalTenantAuthOrigin,
  tenantBrandingInputSchema,
  trustedRequestHostname,
} from "@/lib/branding";
import { BRANDING_CACHE_TAG } from "@/lib/branding-model";
import {
  assertReadyBrandingMediaAssets,
  BrandingMediaBindingError,
} from "@/lib/branding-media";
import {
  BRANDING_MEDIA_ASSET_FIELDS,
  type BrandingMediaAssetField,
} from "@/lib/branding-media-policy";
import {
  assertCourseCanBecomeUnavailable,
  clearPublishedCourseLinkEdges,
  lockCourseLinkGraph,
} from "@/lib/course-link-service";
import {
  coursePermissionAllows,
  coursePermissionForUser,
  requireCoursePermission,
  requireCoursePermissionInTransaction,
} from "@/lib/course-permissions";
import { slugify } from "@/lib/utils";
import { createInvitationToken } from "@/lib/auth-tokens";
import { verifyActiveUserPassword } from "@/lib/auth-credentials";
import { getPublicOidcLoginConfiguration } from "@/lib/oidc-configuration";
import { beginMfaLoginChallenge } from "@/lib/mfa/login-challenge";
import {
  getOrganizationDefaultLocale,
  resolveUserLocale,
} from "@/lib/i18n/server";
import { getCoreDictionary } from "@/lib/i18n/dictionaries";
import { getCourseSupportCopy } from "@/lib/i18n/course-support";
import { normalizeLocale } from "@/lib/i18n/model";
import {
  clearAuthRateLimit,
  consumeAuthRateLimit,
  normalizeAuthEmail,
  tenantAuthIdentifier,
} from "@/lib/auth-rate-limit";
import { DEFAULT_COURSE_COVER } from "@/lib/course-cover";
import {
  recalculateRelatedCourseEnrollments,
  relatedPublishedCourseIdsForLesson,
} from "@/lib/course-progress";
import { eventVisibilitySql } from "@/lib/event-access";
import { awardPoints } from "@/lib/gamification";
import { getCourseLearningAccess } from "@/lib/learning-access";
import { lockMemberCourseProgress } from "@/lib/progress-lock";
import {
  createSubmissionAttempt,
  hasApprovedRequiredSubmissions,
  reviewSubmissionAttempt,
} from "@/lib/submissions";
import { submissionReviewAnnotationsInputSchema } from "@/lib/submission-review-annotations";
import {
  projectSubmissionRichTextPlainText,
  submissionRichTextDocumentSchema,
} from "@/lib/submission-rich-text";
import { MAX_SUBMISSION_ATTACHMENTS } from "@/lib/media/submission-attachments";
import {
  playbackWindowMilliseconds,
  sanitizeVideoPlaybackPolicy,
} from "@/lib/media/video-playback-policy";
import {
  COMMUNITY_REACTION_TYPES,
  type CommunityReactionType,
} from "@/lib/community-domain";
import {
  createCommunityCommentMutation,
  createCommunityPostMutation,
  setCommentReactionMutation,
  setPostReactionMutation,
  setPostVoteMutation,
} from "@/lib/community-mutations";
import type {
  CommunityActionCode,
  CommunityActionParams,
} from "@/lib/i18n/community-actions";

export type SubmissionReviewMessageCode =
  | "invalid_annotations"
  | "invalid_input"
  | "forbidden"
  | "approved"
  | "revision_requested"
  | "save_failed";

export type RsvpMessageCode =
  | "rsvpInvalid"
  | "rsvpUnavailable"
  | "rsvpEnded"
  | "rsvpCancelled"
  | "rsvpFull"
  | "rsvpSaved";

export type ActionState = {
  error?: string;
  success?: string;
  messageCode?: SubmissionReviewMessageCode;
  memberMessageCode?:
    | "inviteInvalid"
    | "inviteDuplicate"
    | "inviteCapacity"
    | "inviteFailed"
    | "inviteCreated";
  memberLimit?: number;
  rsvpMessageCode?: RsvpMessageCode;
  settingsMessageCode?:
    | "designInvalid"
    | "designLegalUrlInvalid"
    | "designAssetInvalid"
    | "designAssetUnavailable"
    | "designSaved";
  communityCode?: CommunityActionCode;
  communityParams?: CommunityActionParams;
  profileHref?: string;
  missingFields?: Array<{ key: string; label: string }>;
  inviteLink?: string;
  submissionId?: string;
  attemptNumber?: number;
};

function communityContentFromFormData(formData: FormData):
  | { input: { content: string } | { richText: unknown } }
  | { error: string } {
  const richText = formData.get("richText");
  if (richText !== null && richText !== "") {
    if (typeof richText !== "string" || richText.length > 100_000) {
      return { error: "Der formatierte Community-Inhalt ist ungueltig." };
    }
    try {
      return { input: { richText: JSON.parse(richText) as unknown } };
    } catch {
      return { error: "Der formatierte Community-Inhalt ist ungueltig." };
    }
  }
  const content = formData.get("content");
  return { input: { content: typeof content === "string" ? content : "" } };
}

function communityMutationError(
  error: unknown,
  fallback: string,
  target: "post" | "answer",
): ActionState {
  if (!(error instanceof ApiError)) {
    return {
      error: fallback,
      communityCode: "contentCreateFailed",
      communityParams: { target },
    };
  }
  const result: ActionState = {
    error: fallback,
    communityCode:
      error.code === "profile_incomplete"
        ? "profileIncomplete"
        : error.code === "rate_limit_exceeded"
          ? "contentRateLimited"
          : "contentCreateFailed",
    communityParams: { target },
  };
  if (
    error.code === "profile_incomplete" &&
    typeof error.details === "object" &&
    error.details !== null
  ) {
    if (
      "profileHref" in error.details &&
      typeof error.details.profileHref === "string"
    ) {
      result.profileHref = error.details.profileHref;
    }
    if ("missingFields" in error.details && Array.isArray(error.details.missingFields)) {
      result.missingFields = error.details.missingFields.flatMap((field) =>
        typeof field === "object" &&
        field !== null &&
        "key" in field &&
        typeof field.key === "string" &&
        "label" in field &&
        typeof field.label === "string"
          ? [{ key: field.key, label: field.label }]
          : [],
      );
    }
  }
  return result;
}
export type AssessmentActionState = ActionState & {
  attemptNumber?: number;
  passed?: boolean;
  score?: number;
  passingScore?: number;
  maxAttempts?: number | null;
  attemptsUsed?: number;
  attemptsRemaining?: number | null;
  maxAttemptsReached?: boolean;
  questionFeedback?: Array<{
    blockId: string;
    correct: boolean;
    feedback: string | null;
  }>;
};

const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .email("Bitte eine gueltige E-Mail-Adresse eingeben.")
    .max(255),
  password: z
    .string()
    .min(8, "Das Passwort muss mindestens 8 Zeichen haben.")
    .max(200),
});

const identifierSchema = z.string().uuid();
const demoRoleSchema = z.enum(["member", "admin"]);
const rsvpStatusSchema = z.enum(["going", "maybe", "declined"]);

function isDemoLoginEnabled() {
  return (
    process.env.NODE_ENV === "development" ||
    process.env.ENABLE_DEMO_LOGIN === "true"
  );
}

async function completeLessonForUser(
  user: Pick<User, "id" | "organizationId">,
  courseId: string,
  lessonId: string,
) {
  return db.transaction(async (tx) => {
    const relatedCourseIds = await relatedPublishedCourseIdsForLesson(tx, {
      organizationId: user.organizationId,
      userId: user.id,
      lessonId,
    });
    for (const relatedCourseId of [...relatedCourseIds].sort()) {
      await lockMemberCourseProgress(tx, {
        organizationId: user.organizationId,
        userId: user.id,
        courseId: relatedCourseId,
      });
    }
    const learningAccess = await getCourseLearningAccess(tx, {
      organizationId: user.organizationId,
      userId: user.id,
      courseId,
    });
    const accessibleLesson = learningAccess?.lessons.get(lessonId);
    if (!learningAccess || !accessibleLesson?.access.canInteract) {
      return "not_accessible" as const;
    }

    const assessmentPassed = await hasPassedRequiredQuiz(tx, {
      organizationId: user.organizationId,
      userId: user.id,
      courseId,
      lessonId,
    });
    if (!assessmentPassed) return "assessment_required" as const;

    const submissionsApproved = await hasApprovedRequiredSubmissions(tx, {
      organizationId: user.organizationId,
      userId: user.id,
      courseId,
      lessonId,
      lesson: accessibleLesson.lesson,
    });
    if (!submissionsApproved) return "submission_required" as const;

    const playbackBlocks = [
      ...accessibleLesson.lesson.blocks,
      ...accessibleLesson.lesson.pages.flatMap((page) => page.blocks),
    ].filter(
      (block) =>
        block.type === "video" &&
        sanitizeVideoPlaybackPolicy(block.data.videoPlayback).completionMode ===
          "required",
    );
    if (playbackBlocks.length) {
      const assetIds = playbackBlocks.flatMap((block) =>
        typeof block.data.mediaAssetId === "string"
          ? [block.data.mediaAssetId]
          : [],
      );
      if (assetIds.length !== playbackBlocks.length) {
        return "media_playback_required" as const;
      }
      const [assetRows, progressRows] = await Promise.all([
        tx
          .select({
            id: mediaAssets.id,
            durationMilliseconds: mediaAssets.durationMilliseconds,
          })
          .from(mediaAssets)
          .where(
            and(
              eq(mediaAssets.organizationId, user.organizationId),
              eq(mediaAssets.status, "ready"),
              inArray(mediaAssets.id, assetIds),
            ),
          ),
        tx
          .select()
          .from(mediaPlaybackProgress)
          .where(
            and(
              eq(mediaPlaybackProgress.organizationId, user.organizationId),
              eq(mediaPlaybackProgress.userId, user.id),
              eq(mediaPlaybackProgress.courseId, courseId),
              eq(mediaPlaybackProgress.lessonId, lessonId),
              inArray(
                mediaPlaybackProgress.blockId,
                playbackBlocks.map((block) => block.id),
              ),
            ),
          ),
      ]);
      const assetsById = new Map(assetRows.map((asset) => [asset.id, asset]));
      const progressByBlock = new Map(
        progressRows.map((progress) => [progress.blockId, progress]),
      );
      const complete = playbackBlocks.every((block) => {
        const assetId = String(block.data.mediaAssetId);
        const asset = assetsById.get(assetId);
        const window = playbackWindowMilliseconds(
          block.data.videoPlayback,
          asset?.durationMilliseconds ?? null,
        );
        const progress = progressByBlock.get(block.id);
        return Boolean(
          window &&
            progress?.mediaAssetId === assetId &&
            progress.requiredMilliseconds === window.requiredMs &&
            progress.watchedMilliseconds >= window.requiredMs &&
            progress.completedAt,
        );
      });
      if (!complete) return "media_playback_required" as const;
    }

    const [previousProgress] = await tx
      .select({ status: lessonProgress.status })
      .from(lessonProgress)
      .where(
        and(
          eq(lessonProgress.userId, user.id),
          eq(lessonProgress.lessonId, lessonId),
        ),
      )
      .limit(1);

    const now = new Date();
    await tx
      .insert(lessonProgress)
      .values({
        userId: user.id,
        lessonId,
        status: "completed",
        percent: 100,
        startedAt: now,
        completedAt: now,
      })
      .onConflictDoUpdate({
        target: [lessonProgress.userId, lessonProgress.lessonId],
        set: { status: "completed", percent: 100, completedAt: now },
      });

    await recalculateRelatedCourseEnrollments(tx, {
      organizationId: user.organizationId,
      userId: user.id,
      lessonId,
      courseIds: relatedCourseIds,
      now,
    });

    await tx.insert(activityEvents).values({
      organizationId: user.organizationId,
      userId: user.id,
      type: "lesson.completed",
      entityType: "lesson",
      entityId: lessonId,
    });
    if (previousProgress?.status !== "completed") {
      await awardPoints(tx, {
        organizationId: user.organizationId,
        userId: user.id,
        amount: 20,
        reason: "lesson.completed",
        entityType: "lesson",
        entityId: lessonId,
      });
    }
    return "completed" as const;
  });
}

export async function loginAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const requestHeaders = await headers();
  const branding = await getAuthTenantForRequest(requestHeaders);
  const locale = await getOrganizationDefaultLocale(branding.organizationId);
  const authCopy = getCoreDictionary(locale).auth;
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: authCopy.genericCredentialError };

  const email = normalizeAuthEmail(parsed.data.email);
  const tenantScope = branding.organizationId ?? "unresolved";
  const rateIdentifier = tenantAuthIdentifier(tenantScope, email);
  const rateLimit = await consumeAuthRateLimit({
    action: "login",
    identifier: rateIdentifier,
    scopeIdentifier: tenantScope,
    headers: requestHeaders,
  });
  if (rateLimit.limited) {
    return {
      error: authCopy.rateLimited,
    };
  }

  const loginConfiguration = await getPublicOidcLoginConfiguration(
    branding.organizationId,
  );
  if (!loginConfiguration.passwordLoginEnabled) {
    return { error: authCopy.genericCredentialError };
  }

  const [user] = branding.organizationId
    ? await db
        .select()
        .from(users)
        .where(
          and(
            eq(users.organizationId, branding.organizationId),
            eq(users.email, email),
          ),
        )
        .limit(1)
    : [];
  if (!(await verifyActiveUserPassword(user, parsed.data.password))) {
    return { error: authCopy.genericCredentialError };
  }

  if (await beginMfaLoginChallenge(user, { method: "password" })) {
    redirect("/login/mfa");
  }
  await clearAuthRateLimit({
    action: "login",
    identifier: rateIdentifier,
  });
  await db
    .update(users)
    .set({ lastLoginAt: new Date() })
    .where(eq(users.id, user.id));
  try {
    await createSession(user, { method: "password" });
  } catch (error) {
    if (
      error instanceof InactiveOrganizationError ||
      error instanceof PasswordLoginDisabledError
    ) {
      return { error: authCopy.genericCredentialError };
    }
    throw error;
  }
  redirect(user.role === "member" ? "/academy" : "/admin");
}

export async function demoLoginAction(role: "member" | "admin") {
  if (!isDemoLoginEnabled()) redirect("/login");
  const parsedRole = demoRoleSchema.safeParse(role);
  if (!parsedRole.success) redirect("/login");

  const email =
    parsedRole.data === "admin" ? "admin@q-academy.de" : "lea@q-academy.de";
  const [record] = await db
    .select({ user: users })
    .from(users)
    .innerJoin(
      organizations,
      and(
        eq(organizations.id, users.organizationId),
        eq(organizations.status, "active"),
      ),
    )
    .where(eq(users.email, email))
    .limit(1);
  const user = record?.user;
  const expectedRole =
    parsedRole.data === "member"
      ? user?.role === "member"
      : user?.role === "owner" || user?.role === "admin";
  if (!user || user.status !== "active" || !expectedRole) redirect("/login");
  if (await beginMfaLoginChallenge(user, { method: "password" })) {
    redirect("/login/mfa");
  }
  await db
    .update(users)
    .set({ lastLoginAt: new Date() })
    .where(eq(users.id, user.id));
  await createSession(user, { method: "password" });
  redirect(parsedRole.data === "admin" ? "/admin" : "/academy");
}

export async function logoutAction() {
  const requestHeaders = await headers();
  const requestTenant = await getAuthTenantForRequest(requestHeaders);
  const trustedHostname = trustedRequestHostname(requestHeaders);
  const originHeader = requestHeaders.get("origin");
  let destination = "/login";
  if (requestTenant.organizationId && trustedHostname) {
    const originCandidates = [
      originHeader,
      requestHeaders.get("host")
        ? `http://${requestHeaders.get("host")}`
        : null,
    ];
    let developmentOrigin: string | null = null;
    for (const candidate of originCandidates) {
      if (!candidate) continue;
      try {
        const origin = new URL(candidate);
        const originHostname = origin.hostname
          .replace(/^\[|\]$/g, "")
          .toLowerCase();
        if (
          !origin.username &&
          !origin.password &&
          originHostname === trustedHostname &&
          (origin.protocol === "http:" || origin.protocol === "https:")
        ) {
          developmentOrigin = origin.origin;
          break;
        }
      } catch {
        // Try the next trusted request-derived origin candidate.
      }
    }
    destination = new URL(
      "/login",
      canonicalTenantAuthOrigin(requestTenant, developmentOrigin),
    ).toString();
  }
  await deleteSession();
  return destination;
}

export async function createCourseAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireTeamPermission("courses.manage");
  const locale = normalizeLocale(
    formData.get("locale"),
    await resolveUserLocale(user),
  );
  const copy = getCourseSupportCopy(locale).actions.course;
  const parsed = z
    .object({
      title: z.string().min(3).max(220),
      description: z.string().min(10).max(500),
      categoryId: z.string().uuid().optional().or(z.literal("")),
    })
    .safeParse({
      title: formData.get("title"),
      description: formData.get("description"),
      categoryId: formData.get("categoryId") ?? "",
    });
  if (!parsed.success) {
    return {
      error: parsed.error.issues.some((issue) => issue.path[0] === "title")
        ? copy.invalidTitle
        : copy.invalidDescription,
    };
  }

  let courseId: string | null;
  try {
    courseId = await db.transaction(async (tx) => {
      const [currentActor] = await tx
        .select({ id: users.id, role: users.role })
        .from(users)
        .where(
          and(
            eq(users.id, user.id),
            eq(users.organizationId, user.organizationId),
            eq(users.status, "active"),
            inArray(users.role, ["owner", "admin", "trainer"]),
          ),
        )
        .limit(1)
        .for("update");
      if (!currentActor) {
        throw new ApiError(
          403,
          "forbidden",
          "Deine Berechtigung zum Erstellen von Kursen ist nicht mehr aktiv.",
        );
      }

      if (parsed.data.categoryId) {
        const [category] = await tx
          .select({ id: courseCategories.id })
          .from(courseCategories)
          .where(
            and(
              eq(courseCategories.id, parsed.data.categoryId),
              eq(courseCategories.organizationId, user.organizationId),
            ),
          )
          .limit(1);
        if (!category) return null;
      }

      let slug = slugify(parsed.data.title);
      const [existing] = await tx
        .select({ id: courses.id })
        .from(courses)
        .where(
          and(
            eq(courses.organizationId, user.organizationId),
            eq(courses.slug, slug),
          ),
        )
        .limit(1);
      if (existing) slug = `${slug}-${Date.now().toString().slice(-5)}`;

      await assertOrganizationCourseCapacity(tx, user.organizationId);
      const [course] = await tx
        .insert(courses)
        .values({
          organizationId: user.organizationId,
          categoryId: parsed.data.categoryId || null,
          title: parsed.data.title,
          slug,
          shortDescription: parsed.data.description,
          description: parsed.data.description,
          status: "draft",
          createdById: currentActor.id,
          coverImage: DEFAULT_COURSE_COVER,
        })
        .returning({ id: courses.id });

      if (currentActor.role === "trainer") {
        await tx.insert(courseCollaborators).values({
          organizationId: user.organizationId,
          courseId: course.id,
          userId: currentActor.id,
          permission: "manage",
          grantedById: currentActor.id,
        });
      }

      await tx.insert(activityEvents).values({
        organizationId: user.organizationId,
        userId: currentActor.id,
        type: "course.created",
        entityType: "course",
        entityId: course.id,
      });
      return course.id;
    });
  } catch (error) {
    logServerError(error, { action: "course.create" });
    return { error: copy.createFailed };
  }
  if (!courseId)
    return { error: copy.categoryUnavailable };

  revalidatePath("/admin/courses");
  redirect(`/admin/courses/${courseId}`);
}

function coursePublicationChangelog(
  formData: FormData | undefined,
  fallback: string,
) {
  const submitted = formData?.get("changelog");
  if (typeof submitted !== "string") return fallback;
  return submitted.trim().slice(0, 5_000) || fallback;
}

async function courseMutationWithAccessRedirect<T>(mutation: () => Promise<T>) {
  try {
    return await mutation();
  } catch (error) {
    if (
      error instanceof ApiError &&
      (error.status === 403 || error.status === 404)
    ) {
      redirect("/admin/courses");
    }
    throw error;
  }
}

export async function toggleCourseStatusAction(
  courseId: string,
  formData?: FormData,
) {
  const { user } = await requireCoursePermission(courseId, "manage");
  const locale = normalizeLocale(
    formData?.get("locale"),
    await resolveUserLocale(user),
  );
  const copy = getCourseSupportCopy(locale).actions.course;
  if (!identifierSchema.safeParse(courseId).success) return;
  const result = await courseMutationWithAccessRedirect(() =>
    db.transaction(async (tx) => {
      await lockCourseLinkGraph(tx, user.organizationId);
      await requireCoursePermissionInTransaction(tx, user, courseId, "manage");
      const current = await lockCourseForVersion(
        tx,
        courseId,
        user.organizationId,
      );
      const publishedAt = new Date();
      const publishing = current.status !== "published";
      const publication = publishing
        ? await publishCourseVersion(tx, {
            organizationId: user.organizationId,
            course: current,
            changelog: coursePublicationChangelog(
              formData,
              copy.publishedFromAdmin,
            ),
            publishedAt,
            createdById: user.id,
          })
        : null;
      if (!publishing) {
        await assertCourseCanBecomeUnavailable(tx, {
          organizationId: user.organizationId,
          courseId,
        });
        await clearPublishedCourseLinkEdges(tx, {
          organizationId: user.organizationId,
          sourceCourseId: courseId,
        });
      }
      const course = publication
        ? publication.course
        : (
            await tx
              .update(courses)
              .set({ status: "draft", updatedAt: publishedAt })
              .where(
                and(
                  eq(courses.id, courseId),
                  eq(courses.organizationId, user.organizationId),
                ),
              )
              .returning()
          )[0];
      if (!course) throw new ApiError(404, "not_found", "Kurs nicht gefunden.");
      const version = publication?.version ?? null;
      await tx.insert(activityEvents).values({
        organizationId: user.organizationId,
        userId: user.id,
        type: publishing ? "course.published" : "course.unpublished",
        entityType: "course",
        entityId: course.id,
        metadata: version ? { version: version.version } : {},
      });
      await enqueueWebhook(
        user.organizationId,
        publishing ? "course.published" : "course.updated",
        {
          ...course,
          mutation: publishing ? "published" : "unpublished",
          ...(version
            ? { versionId: version.id, version: version.version }
            : {}),
        },
        tx,
      );
      return course;
    }),
  );
  revalidatePath(`/admin/courses/${courseId}`);
  revalidatePath("/admin/courses");
  revalidatePath(`/academy/courses/${result.slug}`);
}

export async function publishCourseChangesAction(
  courseId: string,
  formData?: FormData,
) {
  const { user } = await requireCoursePermission(courseId, "manage");
  const locale = normalizeLocale(
    formData?.get("locale"),
    await resolveUserLocale(user),
  );
  const copy = getCourseSupportCopy(locale).actions.course;
  if (!identifierSchema.safeParse(courseId).success) return;
  const result = await courseMutationWithAccessRedirect(() =>
    db.transaction(async (tx) => {
      await lockCourseLinkGraph(tx, user.organizationId);
      await requireCoursePermissionInTransaction(tx, user, courseId, "manage");
      const current = await lockCourseForVersion(
        tx,
        courseId,
        user.organizationId,
      );
      const publishedAt = new Date();
      const publication = await publishCourseVersion(tx, {
        organizationId: user.organizationId,
        course: current,
        changelog: coursePublicationChangelog(
          formData,
          copy.changesPublishedFromAdmin,
        ),
        publishedAt,
        createdById: user.id,
      });
      await tx.insert(activityEvents).values({
        organizationId: user.organizationId,
        userId: user.id,
        type: "course.published",
        entityType: "course",
        entityId: publication.course.id,
        metadata: { version: publication.version.version },
      });
      await enqueueWebhook(
        user.organizationId,
        "course.published",
        {
          ...publication.course,
          mutation: "republished",
          versionId: publication.version.id,
          version: publication.version.version,
        },
        tx,
      );
      return publication.course;
    }),
  );
  revalidatePath(`/admin/courses/${courseId}`);
  revalidatePath("/admin/courses");
  revalidatePath("/academy");
  revalidatePath("/academy/courses");
  revalidatePath(`/academy/courses/${result.slug}`);
}

export async function completeLessonAction(
  courseId: string,
  lessonId: string,
): Promise<ActionState> {
  const user = await requireUser();
  const parsed = z
    .object({ courseId: identifierSchema, lessonId: identifierSchema })
    .safeParse({
      courseId,
      lessonId,
    });
  if (!parsed.success) return { error: "Kurs oder Lektion ist nicht gueltig." };

  const completed = await completeLessonForUser(
    user,
    parsed.data.courseId,
    parsed.data.lessonId,
  );
  if (completed === "not_accessible") {
    return { error: "Kurs oder Lektion ist nicht verfuegbar." };
  }
  if (completed === "assessment_required") {
    return { error: "Bestehe zuerst das Pflichtquiz dieser Lektion." };
  }
  if (completed === "submission_required") {
    return {
      error: "Warte auf die Freigabe aller Pflichtabgaben dieser Lektion.",
    };
  }
  if (completed === "media_playback_required") {
    return { error: "Sieh zuerst alle Pflichtvideos dieser Lektion an." };
  }

  revalidatePath("/academy");
  revalidatePath("/academy/courses");
  revalidatePath("/academy/courses/[slug]/learn/[lessonId]", "page");
  return { success: "Lektion abgeschlossen." };
}

export async function submitAssessmentAction(
  courseId: string,
  lessonId: string,
  answers: AssessmentAnswerInput[],
): Promise<AssessmentActionState> {
  const user = await requireUser();
  const parsed = assessmentSubmissionSchema.safeParse({
    courseId,
    lessonId,
    answers,
  });
  if (!parsed.success) {
    return { error: "Bitte beantworte alle Pflichtfragen." };
  }

  try {
    const attempt = await submitAssessmentAttempt({
      organizationId: user.organizationId,
      userId: user.id,
      ...parsed.data,
    });
    revalidatePath("/academy");
    revalidatePath("/academy/courses");
    revalidatePath("/academy/courses/[slug]/learn/[lessonId]", "page");
    return {
      attemptNumber: attempt.attemptNumber,
      passed: attempt.passed,
      score: attempt.score,
      passingScore: attempt.passingScore,
      maxAttempts: attempt.maxAttempts,
      attemptsUsed: attempt.attemptsUsed,
      attemptsRemaining: attempt.attemptsRemaining,
      maxAttemptsReached: attempt.maxAttemptsReached,
      questionFeedback: attempt.answers.map((answer) => ({
        blockId: answer.blockId,
        correct: answer.correct,
        feedback: answer.questionSnapshot.feedback,
      })),
      ...(attempt.passed
        ? {
            success:
              "Pflichtquiz bestanden. Du kannst die Lektion jetzt abschliessen.",
          }
        : {
            error:
              "Noch nicht bestanden. Pruefe deine Antworten und versuche es erneut.",
          }),
    };
  } catch (error) {
    if (error instanceof ApiError) {
      return {
        error: error.message,
        ...(error.status === 409 && error.code === "conflict"
          ? { maxAttemptsReached: true }
          : {}),
      };
    }
    logServerError(error, { action: "assessment.submit" });
    return { error: "Das Quiz konnte nicht ausgewertet werden." };
  }
}

export async function createSubmissionAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const richTextValue = formData.get("richText");
  let richTextInput: unknown = null;
  if (typeof richTextValue === "string" && richTextValue) {
    try {
      const decoded = JSON.parse(richTextValue) as unknown;
      if (
        decoded &&
        typeof decoded === "object" &&
        "version" in decoded &&
        decoded.version === 1 &&
        "blocks" in decoded &&
        Array.isArray(decoded.blocks) &&
        decoded.blocks.length === 0
      ) {
        richTextInput = null;
      } else {
        richTextInput = decoded;
      }
    } catch {
      return { error: "Der formatierte Abgabetext ist ungueltig." };
    }
  } else if (richTextValue !== null) {
    return { error: "Der formatierte Abgabetext ist ungueltig." };
  }
  const parsed = z
    .object({
      courseId: z.string().uuid(),
      lessonId: z.string().uuid(),
      blockId: z.string().uuid(),
      title: z.string().trim().min(3).max(220),
      content: z.string().trim().max(50_000),
      richText: submissionRichTextDocumentSchema.nullable(),
      attachmentIds: z
        .array(z.string().uuid())
        .max(MAX_SUBMISSION_ATTACHMENTS)
        .refine((ids) => new Set(ids).size === ids.length, {
          message: "Dateianhaenge duerfen nicht doppelt vorkommen.",
        }),
    })
    .superRefine((input, context) => {
      if (input.richText && input.content) {
        context.addIssue({
          code: "custom",
          path: ["richText"],
          message: "Plaintext und Rich-Text duerfen nicht kombiniert werden.",
        });
      }
      const projectedText = input.richText
        ? projectSubmissionRichTextPlainText(input.richText)
        : input.content;
      if (!input.attachmentIds.length && projectedText.length < 20) {
        context.addIssue({
          code: "custom",
          path: ["content"],
          message: "Beschreibe deine Loesung etwas genauer.",
        });
      }
    })
    .safeParse({
      courseId: formData.get("courseId"),
      lessonId: formData.get("lessonId"),
      blockId: formData.get("blockId"),
      title: formData.get("title"),
      content:
        typeof formData.get("content") === "string"
          ? formData.get("content")
          : "",
      richText: richTextInput,
      attachmentIds: formData.getAll("attachmentIds"),
    });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };

  try {
    const created = await createSubmissionAttempt({
      organizationId: user.organizationId,
      userId: user.id,
      ...parsed.data,
    });

    revalidatePath("/academy");
    revalidatePath("/academy/courses");
    revalidatePath("/academy/courses/[slug]/learn/[lessonId]", "page");
    revalidatePath("/admin/tasks");
    return {
      success: `Versuch ${created.attemptNumber} wurde zur Bewertung eingereicht.`,
      submissionId: created.id,
      attemptNumber: created.attemptNumber,
    };
  } catch (error) {
    if (error instanceof ApiError) return { error: error.message };
    logServerError(error, { action: "submission.create" });
    return { error: "Die Abgabe konnte nicht eingereicht werden." };
  }
}

export async function createPostAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const communityContent = communityContentFromFormData(formData);
  if ("error" in communityContent) {
    return {
      error: communityContent.error,
      communityCode: "invalidRichContent",
      communityParams: { target: "post" },
    };
  }
  const parsed = z
    .object({
      spaceId: z.string().uuid(),
      title: z.string().trim().max(240).optional(),
      attachmentIds: z.array(z.string().uuid()).max(6),
    })
    .safeParse({
      spaceId: formData.get("spaceId"),
      title: formData.get("title") || undefined,
      attachmentIds: formData.getAll("attachmentIds"),
    });
  if (!parsed.success) {
    return {
      error: "Der Beitrag ist ungueltig.",
      communityCode: "contentInvalid",
      communityParams: { target: "post" },
    };
  }

  let created: Awaited<ReturnType<typeof createCommunityPostMutation>>;
  try {
    created = await createCommunityPostMutation({
      organizationId: user.organizationId,
      authorId: user.id,
      spaceId: parsed.data.spaceId,
      title: parsed.data.title,
      ...communityContent.input,
      attachmentIds: parsed.data.attachmentIds,
    });
  } catch (error) {
    if (error instanceof ApiError) {
      return communityMutationError(
        error,
        "Der Beitrag konnte nicht veroeffentlicht werden.",
        "post",
      );
    }
    logServerError(error, { action: "community.post.create" });
    return {
      error: "Der Beitrag konnte nicht veroeffentlicht werden.",
      communityCode: "contentCreateFailed",
      communityParams: { target: "post" },
    };
  }

  revalidatePath("/academy/community");
  revalidatePath("/admin/community");
  return {
    success:
      created.moderationState === "pending"
        ? "Beitrag wurde zur Freigabe eingereicht."
        : created.moderationState === "held"
          ? "Beitrag wird vor der Veroeffentlichung geprueft."
          : "Beitrag veroeffentlicht.",
    communityCode: "contentCreated",
    communityParams: {
      target: "post",
      moderationState: created.moderationState,
    },
  };
}

export async function togglePostLikeAction(postId: string) {
  const user = await requireUser();
  const parsedId = identifierSchema.safeParse(postId);
  if (!parsedId.success) return;
  const [existing] = await db
    .select({ reaction: postLikes.reaction })
    .from(postLikes)
    .where(
      and(
        eq(postLikes.organizationId, user.organizationId),
        eq(postLikes.postId, parsedId.data),
        eq(postLikes.userId, user.id),
      ),
    )
    .limit(1);
  await setPostReactionMutation({
    organizationId: user.organizationId,
    userId: user.id,
    postId: parsedId.data,
    reaction: existing ? null : "like",
  });

  revalidatePath("/academy/community");
}

export async function setPostReactionAction(
  postId: string,
  reaction: CommunityReactionType | null,
) {
  const user = await requireUser();
  const parsed = z
    .object({
      postId: identifierSchema,
      reaction: z.enum(COMMUNITY_REACTION_TYPES).nullable(),
    })
    .safeParse({ postId, reaction });
  if (!parsed.success) return;
  await setPostReactionMutation({
    organizationId: user.organizationId,
    userId: user.id,
    postId: parsed.data.postId,
    reaction: parsed.data.reaction,
  });
  revalidatePath("/academy/community");
}

export async function setCommentReactionAction(
  commentId: string,
  reaction: CommunityReactionType | null,
) {
  const user = await requireUser();
  const parsed = z
    .object({
      commentId: identifierSchema,
      reaction: z.enum(COMMUNITY_REACTION_TYPES).nullable(),
    })
    .safeParse({ commentId, reaction });
  if (!parsed.success) return;
  const result = await setCommentReactionMutation({
    organizationId: user.organizationId,
    userId: user.id,
    commentId: parsed.data.commentId,
    reaction: parsed.data.reaction,
  });
  revalidatePath("/academy/community");
  return result;
}

export async function setPostVoteAction(postId: string, value: -1 | 0 | 1) {
  const user = await requireUser();
  const parsed = z
    .object({
      postId: identifierSchema,
      value: z.union([z.literal(-1), z.literal(0), z.literal(1)]),
    })
    .safeParse({ postId, value });
  if (!parsed.success) return;
  await setPostVoteMutation({
    organizationId: user.organizationId,
    userId: user.id,
    postId: parsed.data.postId,
    value: parsed.data.value,
  });
  revalidatePath("/academy/community");
}

export async function createCommentAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const communityContent = communityContentFromFormData(formData);
  if ("error" in communityContent) {
    return {
      error: communityContent.error,
      communityCode: "invalidRichContent",
      communityParams: { target: "answer" },
    };
  }
  const parsed = z
    .object({
      postId: identifierSchema,
      parentId: identifierSchema.nullable().optional(),
      attachmentIds: z.array(z.string().uuid()).max(3),
    })
    .safeParse({
      postId: formData.get("postId"),
      parentId: formData.get("parentId") || null,
      attachmentIds: formData.getAll("attachmentIds"),
    });
  if (!parsed.success) {
    return {
      error: "Die Antwort ist ungueltig.",
      communityCode: "contentInvalid",
      communityParams: { target: "answer" },
    };
  }

  let created: Awaited<ReturnType<typeof createCommunityCommentMutation>>;
  try {
    created = await createCommunityCommentMutation({
      organizationId: user.organizationId,
      authorId: user.id,
      postId: parsed.data.postId,
      parentId: parsed.data.parentId,
      ...communityContent.input,
      attachmentIds: parsed.data.attachmentIds,
    });
  } catch (error) {
    if (error instanceof ApiError) {
      return communityMutationError(
        error,
        "Die Antwort konnte nicht veroeffentlicht werden.",
        "answer",
      );
    }
    logServerError(error, { action: "community.comment.create" });
    return {
      error: "Die Antwort konnte nicht veroeffentlicht werden.",
      communityCode: "contentCreateFailed",
      communityParams: { target: "answer" },
    };
  }

  revalidatePath("/academy/community");
  revalidatePath("/admin/community");
  return {
    success:
      created.moderationState === "pending"
        ? "Antwort wurde zur Freigabe eingereicht."
        : created.moderationState === "held"
          ? "Antwort wird vor der Veroeffentlichung geprueft."
          : "Antwort veroeffentlicht.",
    communityCode: "contentCreated",
    communityParams: {
      target: "answer",
      moderationState: created.moderationState,
    },
  };
}

export async function rsvpEventAction(
  eventId: string,
  status: "going" | "maybe" | "declined",
): Promise<ActionState> {
  const user = await requireUser();
  const parsed = z
    .object({ eventId: identifierSchema, status: rsvpStatusSchema })
    .safeParse({ eventId, status });
  if (!parsed.success) return { error: "Die Teilnahmeangaben sind ungueltig.", rsvpMessageCode: "rsvpInvalid" };

  const changed = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`event:${parsed.data.eventId}`}))`,
    );
    const [event] = await tx
      .select({
        id: events.id,
        capacity: events.capacity,
        endsAt: events.endsAt,
        status: events.status,
      })
      .from(events)
      .where(
        and(
          eq(events.id, parsed.data.eventId),
          eq(events.organizationId, user.organizationId),
          eventVisibilitySql(user.id, user.organizationId),
        ),
      )
      .limit(1);
    if (!event) return "missing" as const;
    if (event.status === "cancelled") return "cancelled" as const;
    if (event.endsAt <= new Date()) return "ended" as const;

    const [existing] = await tx
      .select({ status: eventAttendees.status })
      .from(eventAttendees)
      .where(
        and(
          eq(eventAttendees.eventId, event.id),
          eq(eventAttendees.userId, user.id),
        ),
      )
      .limit(1);
    if (
      parsed.data.status === "going" &&
      existing?.status !== "going" &&
      event.capacity
    ) {
      const [attendance] = await tx
        .select({ value: count() })
        .from(eventAttendees)
        .where(
          and(
            eq(eventAttendees.eventId, event.id),
            eq(eventAttendees.status, "going"),
          ),
        );
      if (Number(attendance?.value ?? 0) >= event.capacity) {
        return "full" as const;
      }
    }

    await tx
      .insert(eventAttendees)
      .values({
        eventId: event.id,
        userId: user.id,
        status: parsed.data.status,
      })
      .onConflictDoUpdate({
        target: [eventAttendees.eventId, eventAttendees.userId],
        set: { status: parsed.data.status, respondedAt: new Date() },
      });
    return "updated" as const;
  });
  if (changed === "missing")
    return { error: "Dieser Termin ist nicht verfuegbar.", rsvpMessageCode: "rsvpUnavailable" };
  if (changed === "ended")
    return { error: "Dieser Termin ist bereits beendet.", rsvpMessageCode: "rsvpEnded" };
  if (changed === "cancelled")
    return { error: "Dieser Termin wurde abgesagt.", rsvpMessageCode: "rsvpCancelled" };
  if (changed === "full")
    return { error: "Dieser Termin ist bereits ausgebucht.", rsvpMessageCode: "rsvpFull" };

  revalidatePath("/academy/events");
  revalidatePath("/admin/events");
  return { success: "Teilnahmestatus gespeichert.", rsvpMessageCode: "rsvpSaved" };
}

export async function reviewSubmissionAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireAdmin();
  let annotationInput: unknown;
  try {
    const value = formData.get("annotations");
    annotationInput = typeof value === "string" ? JSON.parse(value) : [];
  } catch {
    return {
      error: "Die Review-Kommentare sind ungueltig.",
      messageCode: "invalid_annotations",
    };
  }
  const parsed = z
    .object({
      submissionId: z.string().uuid(),
      status: z.enum(["revision", "approved"]),
      feedback: z.string().trim().min(3, "Bitte Feedback ergaenzen.").max(2000),
      score: z.coerce.number().min(0).max(100),
      annotations: submissionReviewAnnotationsInputSchema,
    })
    .safeParse({
      submissionId: formData.get("submissionId"),
      status: formData.get("status"),
      feedback: formData.get("feedback"),
      score: formData.get("score"),
      annotations: annotationInput,
    });
  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message,
      messageCode: "invalid_input",
    };
  }

  const [submission] = await db
    .select({ courseId: submissions.courseId })
    .from(submissions)
    .where(
      and(
        eq(submissions.id, parsed.data.submissionId),
        eq(submissions.organizationId, user.organizationId),
      ),
    )
    .limit(1);
  const permission = submission
    ? await coursePermissionForUser(user, submission.courseId)
    : null;
  if (!coursePermissionAllows(permission, "edit")) {
    return {
      error: "Diese Abgabe ist nicht fuer dich freigegeben.",
      messageCode: "forbidden",
    };
  }

  try {
    await reviewSubmissionAttempt({
      organizationId: user.organizationId,
      submissionId: parsed.data.submissionId,
      reviewerId: user.id,
      decision: parsed.data.status,
      feedback: parsed.data.feedback,
      score: parsed.data.score,
      annotations: parsed.data.annotations,
    });

    revalidatePath("/admin/tasks");
    revalidatePath("/academy");
    revalidatePath("/academy/courses");
    revalidatePath("/academy/courses/[slug]/learn/[lessonId]", "page");
    return {
      success:
        parsed.data.status === "approved"
          ? "Abgabe freigegeben."
          : "Ueberarbeitung angefordert.",
      messageCode:
        parsed.data.status === "approved" ? "approved" : "revision_requested",
    };
  } catch (error) {
    if (error instanceof ApiError) {
      return { error: error.message, messageCode: "save_failed" };
    }
    logServerError(error, { action: "submission.review" });
    return {
      error: "Die Bewertung konnte nicht gespeichert werden.",
      messageCode: "save_failed",
    };
  }
}

export async function createMemberAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireTeamPermission("members.manage");
  const parsed = z
    .object({
      firstName: z.string().min(2).max(100),
      lastName: z.string().min(2).max(100),
      email: z.string().email(),
      department: z.string().max(120).optional(),
    })
    .safeParse({
      firstName: formData.get("firstName"),
      lastName: formData.get("lastName"),
      email: formData.get("email"),
      department: formData.get("department") || undefined,
    });
  if (!parsed.success)
    return {
      error: "invalid_member",
      memberMessageCode: "inviteInvalid",
    };
  const email = parsed.data.email.toLowerCase().trim();
  const invitationOrigin = await getCanonicalTenantAuthOrigin(
    user.organizationId,
  );
  const passwordHash = await hash(randomBytes(32).toString("base64url"), 12);
  let created: { memberId: string; inviteLink: string } | null;
  try {
    created = await db.transaction(async (tx) => {
      const [duplicate] = await tx
        .select({ id: users.id })
        .from(users)
        .where(
          and(
            eq(users.organizationId, user.organizationId),
            eq(users.email, email),
          ),
        )
        .limit(1);
      if (duplicate) return null;
      await assertOrganizationSeatCapacity(tx, {
        organizationId: user.organizationId,
      });
      const [member] = await tx
        .insert(users)
        .values({
          organizationId: user.organizationId,
          email,
          passwordHash,
          firstName: parsed.data.firstName.trim(),
          lastName: parsed.data.lastName.trim(),
          department: parsed.data.department?.trim(),
          role: "member",
          status: "invited",
        })
        .onConflictDoNothing({ target: [users.organizationId, users.email] })
        .returning({ id: users.id });
      if (!member) return null;

      await tx.insert(activityEvents).values({
        organizationId: user.organizationId,
        userId: user.id,
        type: "member.invited",
        entityType: "user",
        entityId: member.id,
      });
      const { link: inviteLink } = await createInvitationToken(
        {
          organizationId: user.organizationId,
          userId: member.id,
          email,
          createdById: user.id,
          deliveryOrigin: invitationOrigin,
        },
        tx,
      );
      return { memberId: member.id, inviteLink };
    });
  } catch (error) {
    if (error instanceof ApiError) {
      const limit =
        error.details &&
        typeof error.details === "object" &&
        "limit" in error.details &&
        typeof error.details.limit === "number" &&
        Number.isSafeInteger(error.details.limit)
          ? error.details.limit
          : undefined;
      return {
        error: "member_action_failed",
        memberMessageCode: limit ? "inviteCapacity" : "inviteFailed",
        memberLimit: limit,
      };
    }
    logServerError(error, { action: "member.invite" });
    return {
      error: "member_action_failed",
      memberMessageCode: "inviteFailed",
    };
  }
  if (!created)
    return {
      error: "member_already_exists",
      memberMessageCode: "inviteDuplicate",
    };

  revalidatePath("/admin/members");
  return {
    success: "member_invited",
    memberMessageCode: "inviteCreated",
    inviteLink: created.inviteLink,
  };
}

export async function updateDesignAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireTeamPermission("settings.manage");
  const optionalValue = (key: string) => {
    const entry = formData.get(key);
    return typeof entry === "string" && entry.trim() ? entry.trim() : null;
  };
  const parsed = tenantBrandingInputSchema.safeParse({
    platformName: formData.get("platformName"),
    primaryColor: formData.get("primaryColor"),
    accentColor: formData.get("accentColor"),
    logoUrl: null,
    logoLightUrl: null,
    logoDarkUrl: null,
    logoAssetId: optionalValue("logoAssetId"),
    logoLightAssetId: optionalValue("logoLightAssetId"),
    logoDarkAssetId: optionalValue("logoDarkAssetId"),
    faviconUrl: null,
    faviconAssetId: optionalValue("faviconAssetId"),
    socialPreviewImageUrl: null,
    socialPreviewImageAssetId: optionalValue("socialPreviewImageAssetId"),
    emailSenderName: formData.get("emailSenderName"),
    fontFamily: formData.get("fontFamily"),
    cornerRadius: Number(formData.get("cornerRadius")),
    colorMode: formData.get("colorMode"),
    loginHostname: null,
    loginEyebrow: formData.get("loginEyebrow"),
    loginTitle: formData.get("loginTitle"),
    loginDescription: formData.get("loginDescription"),
    loginBackgroundUrl: null,
    loginBackgroundAssetId: optionalValue("loginBackgroundAssetId"),
    loginBackgroundColor: formData.get("loginBackgroundColor"),
    privacyPolicyUrl: optionalValue("privacyPolicyUrl"),
    aiTransparencyUrl: optionalValue("aiTransparencyUrl"),
  });
  if (!parsed.success) {
    const hasInvalidLegalUrl = parsed.error.issues.some(
      (issue) =>
        issue.path[0] === "privacyPolicyUrl" ||
        issue.path[0] === "aiTransparencyUrl",
    );
    return {
      settingsMessageCode: hasInvalidLegalUrl
        ? "designLegalUrlInvalid"
        : "designInvalid",
      error:
        parsed.error.issues[0]?.message ??
        "Bitte die Branding-Einstellungen pruefen.",
    };
  }

  const clearFields = new Set(
    (Object.keys(BRANDING_MEDIA_ASSET_FIELDS) as BrandingMediaAssetField[]).filter(
      (field) => formData.get(`${field}Clear`) === "true",
    ),
  );
  try {
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext('tenant-branding-login-hostname'))`,
      );
      const [verifiedDomain] = await tx
        .select({ hostname: customDomainClaims.hostname })
        .from(customDomainClaims)
        .where(
          and(
            eq(customDomainClaims.organizationId, user.organizationId),
            eq(customDomainClaims.status, "verified"),
            isNull(customDomainClaims.revokedAt),
          ),
        )
        .limit(1);

      const [existing] = await tx
        .select({ value: platformSettings.value })
        .from(platformSettings)
        .where(
          and(
            eq(platformSettings.organizationId, user.organizationId),
            eq(platformSettings.key, "design"),
          ),
        )
        .limit(1)
        .for("update");
      const previous = existing?.value ?? {};
      const requestedAssets = Object.fromEntries(
        (Object.keys(BRANDING_MEDIA_ASSET_FIELDS) as BrandingMediaAssetField[]).map(
          (field) => {
            const submitted = parsed.data[field];
            const retained = z.string().uuid().safeParse(previous[field]);
            return [
              field,
              submitted ??
                (clearFields.has(field)
                  ? null
                  : retained.success
                    ? retained.data
                    : null),
            ];
          },
        ),
      ) as Record<BrandingMediaAssetField, string | null>;
      await assertReadyBrandingMediaAssets(
        tx,
        user.organizationId,
        requestedAssets,
      );

      const value: Record<string, unknown> = {
        ...previous,
        ...parsed.data,
        ...requestedAssets,
        loginHostname: verifiedDomain?.hostname ?? null,
      };
      const legacyFields: Record<BrandingMediaAssetField, string> = {
        logoAssetId: "logoUrl",
        logoLightAssetId: "logoLightUrl",
        logoDarkAssetId: "logoDarkUrl",
        faviconAssetId: "faviconUrl",
        socialPreviewImageAssetId: "socialPreviewImageUrl",
        loginBackgroundAssetId: "loginBackgroundUrl",
      };
      for (const field of Object.keys(
        BRANDING_MEDIA_ASSET_FIELDS,
      ) as BrandingMediaAssetField[]) {
        const legacyField = legacyFields[field];
        value[legacyField] = requestedAssets[field]
          ? null
          : clearFields.has(field)
            ? null
            : previous[legacyField] ?? null;
      }
      await tx
        .insert(platformSettings)
        .values({
          organizationId: user.organizationId,
          key: "design",
          value,
        })
        .onConflictDoUpdate({
          target: [platformSettings.organizationId, platformSettings.key],
          set: { value, updatedAt: new Date() },
        });
      await tx.insert(activityEvents).values({
        organizationId: user.organizationId,
        userId: user.id,
        type: "platform.design.updated",
        entityType: "organization",
        entityId: user.organizationId,
        metadata: {
          platformName: parsed.data.platformName,
          fontFamily: parsed.data.fontFamily,
          cornerRadius: parsed.data.cornerRadius,
          colorMode: parsed.data.colorMode,
          loginCustomized: Boolean(
            requestedAssets.loginBackgroundAssetId || value.loginBackgroundUrl,
          ),
          managedImageCount: Object.values(requestedAssets).filter(Boolean).length,
          privacyPolicyUrl: parsed.data.privacyPolicyUrl,
          aiTransparencyUrl: parsed.data.aiTransparencyUrl,
          customDomainActive: Boolean(verifiedDomain),
        },
      });
      return true;
    });
  } catch (error) {
    if (error instanceof BrandingMediaBindingError) {
      return {
        error: error.message,
        settingsMessageCode: "designAssetUnavailable",
      };
    }
    if (error instanceof ApiError) {
      return { error: error.message, settingsMessageCode: "designAssetInvalid" };
    }
    throw error;
  }
  updateTag(BRANDING_CACHE_TAG);
  revalidatePath("/admin/settings");
  revalidatePath("/admin", "layout");
  revalidatePath("/academy", "layout");
  revalidatePath("/login");
  revalidatePath("/", "layout");
  return { success: "Design gespeichert.", settingsMessageCode: "designSaved" };
}
