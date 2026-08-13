import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  contentBlocks,
  courseAuthors,
  courseLearningGoals,
  courseMediaAssets,
  courseModules,
  courses,
  courseVersions,
  courseWidgets,
  lessonPages,
  lessons,
  mediaAssetDerivatives,
  mediaAssets,
  modules,
  orbitAuditEvents,
  orbitInstances,
  orbitPartnerDelegations,
  orbitPermissionSets,
  orbitTransferItems,
  orbitTransferJobs,
  orbitWorkspaceMemberships,
  publishedCourseLinkEdges,
  users,
  type CourseVersionSnapshot,
  type OrbitTransferPreflight,
  type User,
} from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import type { ApiTransaction } from "@/lib/api/handler";
import { isValidPublishedCourseSnapshot } from "@/lib/course-snapshot-validation";
import {
  courseSnapshotHasFramePoster,
  courseSnapshotHasVideoComposition,
  courseSnapshotMediaAssets,
} from "@/lib/media/course-assets";
import {
  copyStoredMediaObject,
  deleteStoredMediaObject,
  mediaStorageLimits,
  promoteStoredMediaObject,
} from "@/lib/media/storage";
import { enqueueReadyVideoThumbnailInTransaction } from "@/lib/media/processing-worker";
import { mediaTenantQuotaLockQuery } from "@/lib/media/quota-lock";
import {
  createMediaObjectKey,
  createMediaStagingObjectKey,
  type MediaObjectIdentity,
} from "@/lib/media/storage-key";
import { requireOrbitAccess } from "@/lib/orbit/access";
import { resolvedOrbitPermissions, type OrbitRole } from "@/lib/orbit/policy";
import {
  orbitTransferConfirmationMatches,
  type OrbitTransferWarningCode,
} from "@/lib/orbit/transfer-contract";
import {
  ORBIT_TRANSFER_AUTHOR_ROLES,
  MAX_ORBIT_TRANSFER_AUTHOR_MAPPINGS,
  OrbitTransferSourceAuthorError,
  extractOrbitTransferSourceAttributions,
  resolveOrbitTransferAuthorMappings,
  type OrbitTransferAuthorMapping,
  type OrbitTransferAuthorProfile,
  type OrbitTransferSourceAuthor,
  type OrbitTransferTargetAuthor,
} from "@/lib/orbit/transfer-authors";
import {
  canonicalOrbitTransferRequest,
  publicOrbitTransferJob,
  remapPublishedCourseSnapshot,
} from "@/lib/orbit/transfer-policy";
import { createOrbitTransferPreflightToken } from "@/lib/orbit/transfer-preflight";
import {
  OrbitTransferClaimLostError,
  orbitTransferLeaseDeadline,
  startOrbitTransferLeaseHeartbeat,
} from "@/lib/orbit/transfer-lease";
import { getMediaStorageConfiguration } from "@/lib/server-environment";
import { slugify } from "@/lib/utils";

type TransferInput = {
  sourceOrganizationId: string;
  targetOrganizationId: string;
  sourceCourseIds: string[];
  authorMappings?: OrbitTransferAuthorMapping[];
};

type TransferExecutionInput = TransferInput & {
  authorMappings: OrbitTransferAuthorMapping[];
  confirmationToken: string;
  acceptedWarnings: OrbitTransferWarningCode[];
};

type SourceCourse = {
  course: typeof courses.$inferSelect;
  version: typeof courseVersions.$inferSelect;
};

type SourceMedia = typeof mediaAssets.$inferSelect;

type TransferPreflightResult = Omit<
  OrbitTransferPreflight,
  "warnings" | "authorMappings"
> & {
  warnings: OrbitTransferWarningCode[];
  authorMappings: OrbitTransferAuthorMapping[];
};

type InternalPreflight = {
  result: TransferPreflightResult;
  confirmationToken: string | null;
  courses: SourceCourse[];
  media: SourceMedia[];
  targetOwnerId: string;
  actorAccountId: string;
  sourceAuthors: OrbitTransferSourceAuthor[];
  targetAuthors: OrbitTransferTargetAuthor[];
  authorMappings: OrbitTransferAuthorMapping[];
  authorMappingsComplete: boolean;
};

type CopiedMedia = {
  source: SourceMedia;
  targetId: string;
  targetOrganizationId: string;
  storageKey: string;
  stagingStorageKey: string;
  stagingVersionId: string | null;
  etag: string | null;
  storageVersionId: string | null;
  stagingDeletedAt: Date | null;
};

const UUID_IN_TEXT =
  /[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi;

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function sourceMimeType(asset: SourceMedia) {
  return asset.detectedMimeType ?? asset.declaredMimeType;
}

function actualSize(asset: SourceMedia) {
  const size = Number(asset.actualSizeBytes);
  if (!Number.isSafeInteger(size) || size <= 0) {
    throw new ApiError(
      409,
      "conflict",
      "Ein Quellmedium besitzt keine gueltige Groesse.",
    );
  }
  return size;
}

async function lockAndAssertTransferAuthorization(input: {
  tx: ApiTransaction;
  accountId: string;
  workspaceId: string;
}) {
  const [membership] = await input.tx
    .select({
      role: orbitWorkspaceMemberships.role,
      permissionSetId: orbitWorkspaceMemberships.permissionSetId,
    })
    .from(orbitWorkspaceMemberships)
    .where(
      and(
        eq(orbitWorkspaceMemberships.workspaceId, input.workspaceId),
        eq(orbitWorkspaceMemberships.accountId, input.accountId),
      ),
    )
    .limit(1)
    .for("update");
  if (!membership) {
    throw new ApiError(
      403,
      "forbidden",
      "Die Orbit-Berechtigung wurde entzogen.",
    );
  }
  const [permissionSet] = membership.permissionSetId
    ? await input.tx
        .select({ permissions: orbitPermissionSets.permissions })
        .from(orbitPermissionSets)
        .where(
          and(
            eq(orbitPermissionSets.id, membership.permissionSetId),
            eq(orbitPermissionSets.workspaceId, input.workspaceId),
          ),
        )
        .limit(1)
    : [{ permissions: null }];
  if (membership.permissionSetId && !permissionSet) {
    throw new ApiError(
      403,
      "forbidden",
      "Die Orbit-Berechtigung wurde entzogen.",
    );
  }
  const permissions = resolvedOrbitPermissions({
    role: membership.role as OrbitRole,
    permissionSet: permissionSet?.permissions ?? null,
  });
  if (!permissions.has("transfers:create")) {
    throw new ApiError(
      403,
      "forbidden",
      "Die Orbit-Berechtigung wurde entzogen.",
    );
  }
  return membership.role;
}

async function loadPreflight(
  user: User,
  workspaceId: string,
  input: TransferInput,
): Promise<InternalPreflight> {
  const access = await requireOrbitAccess({
    user,
    workspaceId,
    permission: "transfers:create",
    organizationIds: [input.sourceOrganizationId, input.targetOrganizationId],
  });
  const normalizedCourseIds = [...new Set(input.sourceCourseIds)].sort();
  if (!normalizedCourseIds.length || normalizedCourseIds.length > 25) {
    throw new ApiError(
      422,
      "validation_error",
      "Es muessen 1 bis 25 eindeutige Kurse ausgewaehlt werden.",
    );
  }
  const instanceRows = await db
    .select()
    .from(orbitInstances)
    .where(
      and(
        eq(orbitInstances.workspaceId, workspaceId),
        inArray(orbitInstances.organizationId, [
          input.sourceOrganizationId,
          input.targetOrganizationId,
        ]),
      ),
    );
  const sourceInstance = instanceRows.find(
    (instance) => instance.organizationId === input.sourceOrganizationId,
  );
  const targetInstance = instanceRows.find(
    (instance) => instance.organizationId === input.targetOrganizationId,
  );
  if (!sourceInstance || !targetInstance) {
    throw new ApiError(
      404,
      "not_found",
      "Quell- oder Zielinstanz ist nicht Teil der Orbit-Organisation.",
    );
  }
  if (
    sourceInstance.status !== "active" ||
    targetInstance.status !== "active"
  ) {
    throw new ApiError(
      409,
      "conflict",
      "Quell- und Zielinstanz muessen aktiv sein.",
    );
  }
  if (
    !sourceInstance.entitlements.includes("content_transfer") ||
    !targetInstance.entitlements.includes("content_transfer")
  ) {
    throw new ApiError(
      409,
      "conflict",
      "Content-Transfer ist fuer eine der Instanzen nicht freigeschaltet.",
    );
  }

  const courseRows = await db
    .select({ course: courses, version: courseVersions })
    .from(courses)
    .innerJoin(
      courseVersions,
      and(
        eq(courseVersions.id, courses.publishedVersionId),
        eq(courseVersions.courseId, courses.id),
        eq(courseVersions.organizationId, courses.organizationId),
      ),
    )
    .where(
      and(
        eq(courses.organizationId, input.sourceOrganizationId),
        eq(courses.status, "published"),
        inArray(courses.id, normalizedCourseIds),
      ),
    )
    .orderBy(asc(courses.id));
  if (courseRows.length !== normalizedCourseIds.length) {
    throw new ApiError(
      404,
      "not_found",
      "Mindestens ein publizierter Quellkurs wurde nicht gefunden.",
    );
  }
  for (const row of courseRows) {
    if (
      !isValidPublishedCourseSnapshot(
        row.version.snapshot,
        row.course.id,
        input.sourceOrganizationId,
      )
    ) {
      throw new ApiError(
        409,
        "conflict",
        "Ein Quellkurs besitzt keinen gueltigen publizierten Snapshot.",
      );
    }
    if (courseSnapshotHasVideoComposition(row.version.snapshot)) {
      throw new ApiError(
        409,
        "conflict",
        "Video-Mehrspur-Kompositionen muessen vor einem Orbit-Transfer als eigenstaendiges Video exportiert werden.",
      );
    }
    if (courseSnapshotHasFramePoster(row.version.snapshot)) {
      throw new ApiError(
        409,
        "conflict",
        "Aus Video-Frames gewaehlte Vorschaubilder koennen nicht uebertragen werden. Stelle sie vor dem Orbit-Transfer auf Automatisch oder ein eigenes Bild um.",
      );
    }
  }

  const expectedMedia = new Map<string, string>();
  for (const row of courseRows) {
    for (const [assetId, kind] of courseSnapshotMediaAssets(
      row.version.snapshot,
    )) {
      const previous = expectedMedia.get(assetId);
      if (previous && previous !== kind) {
        throw new ApiError(
          409,
          "conflict",
          "Ein Quellmedium wird widerspruechlich verwendet.",
        );
      }
      expectedMedia.set(assetId, kind);
    }
  }
  const mediaIds = [...expectedMedia.keys()].sort();
  const mediaRows = mediaIds.length
    ? await db
        .select()
        .from(mediaAssets)
        .where(
          and(
            eq(mediaAssets.organizationId, input.sourceOrganizationId),
            eq(mediaAssets.purpose, "course_content"),
            eq(mediaAssets.status, "ready"),
            inArray(mediaAssets.id, mediaIds),
          ),
        )
        .orderBy(mediaAssets.id)
    : [];
  const configuredDriver = getMediaStorageConfiguration().driver;
  if (
    mediaRows.length !== mediaIds.length ||
    mediaRows.some(
      (asset) =>
        asset.kind !== expectedMedia.get(asset.id) ||
        asset.storageDriver !== configuredDriver ||
        !asset.contentSha256 ||
        !asset.actualSizeBytes,
    )
  ) {
    throw new ApiError(
      409,
      "conflict",
      "Alle referenzierten Kursmedien muessen bereit und kopierbar sein.",
    );
  }
  const mediaBytes = mediaRows.reduce(
    (sum, asset) => sum + actualSize(asset),
    0,
  );

  let sourceAttributions: ReturnType<
    typeof extractOrbitTransferSourceAttributions
  >;
  try {
    sourceAttributions = extractOrbitTransferSourceAttributions(
      courseRows.map((row) => ({
        courseId: row.course.id,
        organizationId: input.sourceOrganizationId,
        snapshot: row.version.snapshot,
      })),
    );
  } catch (error) {
    if (error instanceof OrbitTransferSourceAuthorError) {
      throw new ApiError(
        409,
        "conflict",
        "Ein Quellkurs besitzt widerspruechliche Autorenreferenzen.",
      );
    }
    throw error;
  }
  if (sourceAttributions.length > MAX_ORBIT_TRANSFER_AUTHOR_MAPPINGS) {
    throw new ApiError(
      409,
      "conflict",
      "Ein Transfer kann hoechstens 1.000 eindeutige Quellautoren enthalten.",
    );
  }
  const sourceAuthorIds = sourceAttributions.map(
    (author) => author.sourceUserId,
  );
  const [[targetCounts], targetAuthorRows, sourceAuthorRows] =
    await Promise.all([
      db
        .select({
          courseCount: sql<number>`(select count(*)::int from ${courses} where ${courses.organizationId} = ${input.targetOrganizationId})`,
          userCount: sql<number>`(select count(*)::int from ${users} where ${users.organizationId} = ${input.targetOrganizationId} and ${users.status} = 'active')`,
          mediaBytes: sql<number>`(
          coalesce((select sum(${mediaAssets.quotaBytes}) from ${mediaAssets} where ${mediaAssets.organizationId} = ${input.targetOrganizationId}), 0) +
          coalesce((select sum(${mediaAssetDerivatives.sizeBytes}) from ${mediaAssetDerivatives} where ${mediaAssetDerivatives.organizationId} = ${input.targetOrganizationId}), 0)
        )::bigint`,
        })
        .from(orbitInstances)
        .where(
          and(
            eq(orbitInstances.workspaceId, workspaceId),
            eq(orbitInstances.organizationId, input.targetOrganizationId),
          ),
        )
        .limit(1),
      db
        .select({
          id: users.id,
          email: users.email,
          firstName: users.firstName,
          lastName: users.lastName,
          avatarUrl: users.avatarUrl,
          jobTitle: users.jobTitle,
          bio: users.bio,
          role: users.role,
          status: users.status,
        })
        .from(users)
        .where(
          and(
            eq(users.organizationId, input.targetOrganizationId),
            eq(users.status, "active"),
            inArray(users.role, ORBIT_TRANSFER_AUTHOR_ROLES),
          ),
        )
        .orderBy(
          sql`case when ${users.role} = 'owner' then 0 when ${users.role} = 'admin' then 1 else 2 end`,
          users.lastName,
          users.firstName,
          users.id,
        ),
      sourceAuthorIds.length
        ? db
            .select({
              id: users.id,
              email: users.email,
              firstName: users.firstName,
              lastName: users.lastName,
              avatarUrl: users.avatarUrl,
              jobTitle: users.jobTitle,
              bio: users.bio,
              role: users.role,
              status: users.status,
            })
            .from(users)
            .where(
              and(
                eq(users.organizationId, input.sourceOrganizationId),
                inArray(users.id, sourceAuthorIds),
              ),
            )
        : Promise.resolve([]),
    ]);
  const targetOwner = targetAuthorRows.find(
    (candidate) => candidate.role === "owner" || candidate.role === "admin",
  );
  if (!targetOwner) {
    throw new ApiError(
      409,
      "conflict",
      "Die Zielinstanz benoetigt einen aktiven Eigentuemer oder Administrator.",
    );
  }
  const authorResolution = resolveOrbitTransferAuthorMappings({
    attributions: sourceAttributions,
    sourceUsers: sourceAuthorRows,
    targetUsers: targetAuthorRows,
    requestedMappings: input.authorMappings,
  });
  if (!authorResolution.ok) {
    const detail =
      authorResolution.reason === "course_author_collision"
        ? "Zwei Kursautoren desselben Kurses duerfen nicht demselben Zielautor zugeordnet werden."
        : "Die Autoren-Zuordnung enthaelt ungueltige oder nicht geeignete Zielkonten.";
    throw new ApiError(422, "validation_error", detail);
  }
  const targetCourseCount = Number(targetCounts?.courseCount ?? 0);
  const targetUserCount = Number(targetCounts?.userCount ?? 0);
  const targetMediaBytes = Number(targetCounts?.mediaBytes ?? 0);
  if (targetCourseCount + courseRows.length > targetInstance.courseLimit) {
    throw new ApiError(
      409,
      "conflict",
      "Der Transfer wuerde das Kurslimit der Zielinstanz ueberschreiten.",
    );
  }
  if (targetMediaBytes + mediaBytes > mediaStorageLimits().tenantQuotaBytes) {
    throw new ApiError(
      409,
      "conflict",
      "Der Transfer wuerde das Medienkontingent der Zielinstanz ueberschreiten.",
    );
  }
  const warnings: OrbitTransferWarningCode[] = [];
  if (targetUserCount > targetInstance.seatLimit) {
    warnings.push("target_seat_limit_exceeded");
  }
  if (
    courseRows.some((row) =>
      row.version.snapshot.modules.some(
        (learningModule) =>
          learningModule.kind === "link" &&
          learningModule.linkedCourseId &&
          !normalizedCourseIds.includes(learningModule.linkedCourseId),
      ),
    )
  ) {
    warnings.push("external_course_link_neutralized");
  }
  const hasTenantBoundBlock = courseRows.some((row) =>
    row.version.snapshot.modules.some((learningModule) =>
      [...learningModule.lessons].some((lesson) =>
        [...lesson.blocks, ...lesson.pages.flatMap((page) => page.blocks)].some(
          (block) => Boolean(block.data.agentId || block.data.formId),
        ),
      ),
    ),
  );
  if (hasTenantBoundBlock) {
    warnings.push("tenant_dependency_removed");
  }
  const result: TransferPreflightResult = {
    sourceCourseCount: courseRows.length,
    targetCourseCount,
    targetCourseLimit: targetInstance.courseLimit,
    mediaAssetCount: mediaRows.length,
    mediaBytes,
    warnings,
    authorMappings: authorResolution.authorMappings,
  };
  const confirmationToken = authorResolution.complete
    ? createOrbitTransferPreflightToken({
        canonicalRequest: canonicalOrbitTransferRequest({
          workspaceId,
          ...input,
          authorMappings: authorResolution.authorMappings,
        }),
        actorAccountId: access.actor.accountId,
        targetOwnerId: targetOwner.id,
        preflight: result,
        sourceVersions: courseRows.map((row) => ({
          courseId: row.course.id,
          versionId: row.version.id,
          snapshot: row.version.snapshot,
        })),
        mediaAssets: mediaRows.map((asset) => ({
          id: asset.id,
          kind: asset.kind,
          status: asset.status,
          storageDriver: asset.storageDriver,
          storageKey: asset.storageKey,
          stagingStorageKey: asset.stagingStorageKey,
          actualSizeBytes: asset.actualSizeBytes,
          contentSha256: asset.contentSha256,
          etag: asset.etag,
          stagingStorageVersionId: asset.stagingStorageVersionId,
          storageVersionId: asset.storageVersionId,
        })),
        authorState: {
          sourceAuthors: authorResolution.sourceAuthors.map((author) => ({
            sourceUserId: author.sourceUserId,
            email: author.email,
            role: author.role,
            status: author.status,
            courseIds: author.courseIds,
            courseAuthorCourseIds: author.courseAuthorCourseIds,
          })),
          targetAuthors: targetAuthorRows.map((author) => ({
            targetUserId: author.id,
            email: author.email,
            role: author.role,
            status: author.status,
          })),
          authorMappings: authorResolution.authorMappings,
        },
      })
    : null;
  return {
    result,
    confirmationToken,
    courses: courseRows,
    media: mediaRows,
    targetOwnerId: targetOwner.id,
    actorAccountId: access.actor.accountId,
    sourceAuthors: authorResolution.sourceAuthors,
    targetAuthors: authorResolution.targetAuthors,
    authorMappings: authorResolution.authorMappings,
    authorMappingsComplete: authorResolution.complete,
  };
}

export async function preflightOrbitTransfer(
  user: User,
  workspaceId: string,
  input: TransferInput,
) {
  const preflight = await loadPreflight(user, workspaceId, input);
  return {
    ...preflight.result,
    confirmationToken: preflight.confirmationToken,
    sourceAuthors: preflight.sourceAuthors.map((author) => ({
      sourceUserId: author.sourceUserId,
      email: author.email,
      firstName: author.profile.firstName,
      lastName: author.profile.lastName,
      role: author.role,
      status: author.status,
      courseIds: author.courseIds,
      courseAuthorCourseIds: author.courseAuthorCourseIds,
      automaticTargetUserId: author.automaticTargetUserId,
    })),
    targetAuthors: preflight.targetAuthors.map((author) => ({
      targetUserId: author.targetUserId,
      email: author.email,
      firstName: author.firstName,
      lastName: author.lastName,
      role: author.role,
    })),
    authorMappingsComplete: preflight.authorMappingsComplete,
  };
}

function objectName(storageKey: string) {
  const name = storageKey.split("/").at(-1);
  if (!name)
    throw new ApiError(
      409,
      "conflict",
      "Ein Quellmedium besitzt keinen gueltigen Speicherschluessel.",
    );
  return name;
}

async function copyTransferMedia(input: {
  source: SourceMedia;
  targetId: string;
  targetOrganizationId: string;
  signal: AbortSignal;
}): Promise<CopiedMedia> {
  input.signal.throwIfAborted();
  const storageKey = createMediaObjectKey({
    organizationId: input.targetOrganizationId,
    assetId: input.targetId,
    safeFileName: objectName(input.source.storageKey),
  });
  const stagingStorageKey = createMediaStagingObjectKey({
    organizationId: input.targetOrganizationId,
    assetId: input.targetId,
    safeFileName: objectName(input.source.stagingStorageKey),
  });
  if (!storageKey || !stagingStorageKey || !input.source.contentSha256) {
    throw new ApiError(
      409,
      "conflict",
      "Der Zielschluessel fuer ein Kursmedium ist ungueltig.",
    );
  }
  const targetStaging: MediaObjectIdentity = {
    organizationId: input.targetOrganizationId,
    assetId: input.targetId,
    key: stagingStorageKey,
  };
  try {
    const staged = await copyStoredMediaObject({
      source: {
        organizationId: input.source.organizationId,
        assetId: input.source.id,
        key: input.source.storageKey,
      },
      target: targetStaging,
      expectedEtag: input.source.etag,
      expectedSourceVersionId: input.source.storageVersionId,
      expectedSha256: input.source.contentSha256,
      expectedSizeBytes: actualSize(input.source),
      mimeType: sourceMimeType(input.source),
      signal: input.signal,
    });
    input.signal.throwIfAborted();
    const promoted = await promoteStoredMediaObject({
      source: targetStaging,
      target: {
        organizationId: input.targetOrganizationId,
        assetId: input.targetId,
        key: storageKey,
      },
      expectedEtag: staged.etag,
      expectedSourceVersionId: staged.versionId,
      expectedSha256: input.source.contentSha256,
      expectedSizeBytes: actualSize(input.source),
      mimeType: sourceMimeType(input.source),
      signal: input.signal,
    });
    input.signal.throwIfAborted();
    let stagingDeletedAt: Date | null = null;
    try {
      await deleteStoredMediaObject(targetStaging);
      stagingDeletedAt = new Date();
    } catch {
      // The immutable final object is complete. Normal media maintenance retries staging cleanup.
    }
    return {
      source: input.source,
      targetId: input.targetId,
      targetOrganizationId: input.targetOrganizationId,
      storageKey,
      stagingStorageKey,
      stagingVersionId: staged.versionId,
      etag: promoted.etag,
      storageVersionId: promoted.versionId,
      stagingDeletedAt,
    };
  } catch (error) {
    // The pending reservation is the durable cleanup record. A provider copy may
    // complete after a client-side abort, so immediate deletion is not final proof.
    throw error;
  }
}

function targetSlug(source: SourceCourse, targetId: string, used: Set<string>) {
  const base = (slugify(source.course.title) || "kurs").slice(0, 160);
  let candidate = base;
  if (used.has(candidate))
    candidate = `${base.slice(0, 151)}-${targetId.slice(0, 8)}`;
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = `${base.slice(0, 168)}-${suffix}`;
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
}

async function insertSnapshotGraph(
  tx: ApiTransaction,
  organizationId: string,
  courseId: string,
  snapshot: CourseVersionSnapshot,
) {
  const targetBlockData = (
    block: CourseVersionSnapshot["modules"][number]["lessons"][number]["blocks"][number],
  ) =>
    block.type === "video"
      ? { ...block.data, videoDescriptionIntent: "touched" as const }
      : block.data;
  if (snapshot.learningGoals?.length) {
    await tx.insert(courseLearningGoals).values(
      snapshot.learningGoals.map((goal) => ({
        id: goal.id,
        organizationId,
        courseId,
        text: goal.text,
        sortOrder: goal.sortOrder,
      })),
    );
  }
  if (snapshot.authors?.length) {
    await tx.insert(courseAuthors).values(
      snapshot.authors.map((author) => ({
        id: author.id,
        organizationId,
        courseId,
        userId: author.userId,
        sortOrder: author.sortOrder,
        createdAt: new Date(author.createdAt),
      })),
    );
  }
  const widgets = snapshot.widgets ?? [];
  if (widgets.length) {
    await tx.insert(courseWidgets).values(
      widgets.map((widget) => ({
        id: widget.id,
        organizationId,
        courseId,
        type: widget.type,
        sortOrder: widget.sortOrder,
        authorUserId: widget.type === "author" ? widget.authorUserId : null,
        authorRole: widget.type === "author" ? widget.authorRole : null,
        authorDescription:
          widget.type === "author" ? widget.authorDescription : null,
        title: widget.title,
        text: widget.text,
        linkUrl: widget.linkUrl,
        imageUrl: widget.imageUrl,
        mediaAssetId: widget.mediaAssetId,
        altText: widget.altText,
      })),
    );
  }
  for (const learningModule of snapshot.modules) {
    await tx.insert(modules).values({
      id: learningModule.id,
      organizationId,
      title: learningModule.title,
      kind: learningModule.kind ?? "learning",
      linkedCourseId: learningModule.linkedCourseId ?? null,
      description: learningModule.description,
      folder: learningModule.folder,
      isReusable: learningModule.isReusable,
      estimatedMinutes: learningModule.estimatedMinutes,
    });
    await tx.insert(courseModules).values({
      organizationId,
      courseId,
      moduleId: learningModule.id,
      sortOrder: learningModule.sortOrder,
      indentLevel: learningModule.indentLevel ?? 0,
      accessMode: learningModule.accessMode ?? "visible",
      dripDays: learningModule.dripDays,
      delayPendingState: learningModule.delayPendingState ?? "locked",
      availableFrom: learningModule.availableFrom
        ? new Date(learningModule.availableFrom)
        : null,
      availableUntil: learningModule.availableUntil
        ? new Date(learningModule.availableUntil)
        : null,
      windowDefaultState: learningModule.windowDefaultState ?? "locked",
      windowState: learningModule.windowState ?? "available",
      requestAccessEnabled: learningModule.requestAccessEnabled ?? false,
      isRequired: learningModule.isRequired,
    });
    for (const lesson of learningModule.lessons) {
      await tx.insert(lessons).values({
        id: lesson.id,
        organizationId,
        moduleId: learningModule.id,
        title: lesson.title,
        slug: lesson.slug,
        summary: lesson.summary,
        type: lesson.type,
        durationMinutes: lesson.durationMinutes,
        passingScore: lesson.passingScore,
        maxAttempts: lesson.maxAttempts,
        shuffleQuestions: lesson.shuffleQuestions,
        examDurationSeconds: lesson.examDurationSeconds,
        examQuestionPools: lesson.examQuestionPools,
        examResultReleaseMode: lesson.examResultReleaseMode,
        examReviewReleaseMode: lesson.examReviewReleaseMode,
        examContentAccessMode: lesson.examContentAccessMode,
        sortOrder: lesson.sortOrder,
        status: lesson.status,
        visibility: lesson.visibility ?? "visible",
        availableAt: lesson.availableAt ? new Date(lesson.availableAt) : null,
        dripDays: lesson.dripDays,
        unlockAfterPrevious: lesson.unlockAfterPrevious,
      });
      if (lesson.blocks.length) {
        await tx.insert(contentBlocks).values(
          lesson.blocks.map((block) => ({
            id: block.id,
            lessonId: lesson.id,
            pageId: null,
            type: block.type,
            title: block.title,
            sortOrder: block.sortOrder,
            required: block.required,
            data: targetBlockData(block),
            style: block.style,
            revision: block.revision ?? 1,
          })),
        );
      }
      for (const page of lesson.pages) {
        await tx.insert(lessonPages).values({
          id: page.id,
          lessonId: lesson.id,
          title: page.title,
          titleSyncedWithLesson: page.titleSyncedWithLesson ?? false,
          slug: page.slug,
          sortOrder: page.sortOrder,
          status: page.status,
          layoutWidth: page.layoutWidth,
          backgroundTone: page.backgroundTone,
          contentSpacing: page.contentSpacing,
          revision: page.revision,
        });
        if (page.blocks.length) {
          await tx.insert(contentBlocks).values(
            page.blocks.map((block) => ({
              id: block.id,
              lessonId: lesson.id,
              pageId: page.id,
              type: block.type,
              title: block.title,
              sortOrder: block.sortOrder,
              required: block.required,
              data: targetBlockData(block),
              style: block.style,
              revision: block.revision ?? 1,
            })),
          );
        }
      }
    }
  }
}

export async function createOrbitTransfer(input: {
  user: User;
  workspaceId: string;
  request: TransferExecutionInput;
  idempotencyKey: string;
}) {
  const initialAccess = await requireOrbitAccess({
    user: input.user,
    workspaceId: input.workspaceId,
    permission: "transfers:create",
    organizationIds: [
      input.request.sourceOrganizationId,
      input.request.targetOrganizationId,
    ],
  });
  const requestHash = digest(
    canonicalOrbitTransferRequest({
      workspaceId: input.workspaceId,
      ...input.request,
    }),
  );
  const [replay] = await db
    .select()
    .from(orbitTransferJobs)
    .where(
      and(
        eq(orbitTransferJobs.workspaceId, input.workspaceId),
        eq(orbitTransferJobs.idempotencyKey, input.idempotencyKey),
      ),
    )
    .limit(1);
  if (replay) {
    if (replay.requestedByAccountId !== initialAccess.actor.accountId) {
      throw new ApiError(
        409,
        "idempotency_conflict",
        "Der Idempotency-Key wurde bereits in einem anderen Anfragekontext verwendet.",
      );
    }
    if (replay.requestHash !== requestHash) {
      throw new ApiError(
        409,
        "idempotency_conflict",
        "Der Idempotency-Key wurde fuer eine andere Transferanfrage verwendet.",
      );
    }
    if (replay.status === "processing" || replay.status === "planned") {
      throw new ApiError(
        409,
        "conflict",
        "Der idempotente Transfer wird bereits verarbeitet.",
      );
    }
    return { job: publicOrbitTransferJob(replay), created: false };
  }
  const preflight = await loadPreflight(
    input.user,
    input.workspaceId,
    input.request,
  );
  if (
    !preflight.confirmationToken ||
    !preflight.authorMappingsComplete ||
    !orbitTransferConfirmationMatches({
      expectedToken: preflight.confirmationToken,
      confirmationToken: input.request.confirmationToken,
      requiredWarnings: preflight.result.warnings,
      acceptedWarnings: input.request.acceptedWarnings,
    })
  ) {
    throw new ApiError(
      409,
      "conflict",
      "Der Transfer-Preflight, seine Autoren-Zuordnung oder seine Warnungsbestaetigung ist nicht mehr aktuell.",
    );
  }
  const courseIdMap = new Map(
    preflight.courses.map((row) => [row.course.id, randomUUID()]),
  );
  const versionIdMap = new Map(
    preflight.courses.map((row) => [row.version.id, randomUUID()]),
  );
  const mediaIdMap = new Map(
    preflight.media.map((asset) => [asset.id, randomUUID()]),
  );
  const transferClaimToken = randomUUID();
  const claim = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`orbit-transfer:${input.workspaceId}:${input.idempotencyKey}`}, 0))`,
    );
    const [existing] = await tx
      .select()
      .from(orbitTransferJobs)
      .where(
        and(
          eq(orbitTransferJobs.workspaceId, input.workspaceId),
          eq(orbitTransferJobs.idempotencyKey, input.idempotencyKey),
        ),
      )
      .limit(1)
      .for("update");
    if (existing) {
      if (existing.requestedByAccountId !== preflight.actorAccountId) {
        throw new ApiError(
          409,
          "idempotency_conflict",
          "Der Idempotency-Key wurde bereits in einem anderen Anfragekontext verwendet.",
        );
      }
      if (existing.requestHash !== requestHash) {
        throw new ApiError(
          409,
          "idempotency_conflict",
          "Der Idempotency-Key wurde fuer eine andere Transferanfrage verwendet.",
        );
      }
      if (existing.status === "processing" || existing.status === "planned") {
        throw new ApiError(
          409,
          "conflict",
          "Der idempotente Transfer wird bereits verarbeitet.",
        );
      }
      return { existing } as const;
    }
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`orbit-target:${input.request.targetOrganizationId}`}, 0))`,
    );
    await tx.execute(
      mediaTenantQuotaLockQuery(input.request.targetOrganizationId),
    );
    const [mediaUsage] = await tx
      .select({
        databaseNow: sql<string>`clock_timestamp()::text`,
        bytes: sql<number>`(
          coalesce((select sum(${mediaAssets.quotaBytes}) from ${mediaAssets} where ${mediaAssets.organizationId} = ${input.request.targetOrganizationId}), 0) +
          coalesce((select sum(${mediaAssetDerivatives.sizeBytes}) from ${mediaAssetDerivatives} where ${mediaAssetDerivatives.organizationId} = ${input.request.targetOrganizationId}), 0)
        )::bigint`,
      })
      .from(orbitInstances)
      .where(
        and(
          eq(orbitInstances.workspaceId, input.workspaceId),
          eq(orbitInstances.organizationId, input.request.targetOrganizationId),
        ),
      )
      .limit(1);
    if (
      Number(mediaUsage?.bytes ?? 0) + preflight.result.mediaBytes >
      mediaStorageLimits().tenantQuotaBytes
    ) {
      throw new ApiError(
        409,
        "conflict",
        "Das Medienkontingent der Zielinstanz wurde zwischenzeitlich erreicht.",
      );
    }
    const now = new Date(mediaUsage?.databaseNow ?? "");
    if (!Number.isFinite(now.getTime())) {
      throw new Error("The Orbit transfer database clock is unavailable.");
    }
    const leaseExpiresAt = orbitTransferLeaseDeadline(now);
    const [job] = await tx
      .insert(orbitTransferJobs)
      .values({
        workspaceId: input.workspaceId,
        sourceOrganizationId: input.request.sourceOrganizationId,
        targetOrganizationId: input.request.targetOrganizationId,
        sourceCourseIds: [...courseIdMap.keys()],
        requestedByAccountId: preflight.actorAccountId,
        idempotencyKey: input.idempotencyKey,
        requestHash,
        status: "processing",
        claimToken: transferClaimToken,
        leaseExpiresAt,
        preflight: preflight.result,
        startedAt: now,
        updatedAt: now,
      })
      .returning();
    await tx.insert(orbitTransferItems).values([
      ...preflight.courses.flatMap((row) => {
        const checksum = digest(JSON.stringify(row.version.snapshot));
        return [
          {
            jobId: job.id,
            kind: "course" as const,
            sourceId: row.course.id,
            targetId: courseIdMap.get(row.course.id)!,
            checksum,
          },
          {
            jobId: job.id,
            kind: "version" as const,
            sourceId: row.version.id,
            targetId: versionIdMap.get(row.version.id)!,
            checksum,
          },
        ];
      }),
      ...preflight.media.map((asset) => ({
        jobId: job.id,
        kind: "media_asset" as const,
        sourceId: asset.id,
        targetId: mediaIdMap.get(asset.id)!,
        checksum: asset.contentSha256!,
      })),
    ]);
    if (preflight.media.length) {
      await tx.insert(mediaAssets).values(
        preflight.media.map((source) => {
          const targetId = mediaIdMap.get(source.id)!;
          const size = actualSize(source);
          const storageKey = createMediaObjectKey({
            organizationId: input.request.targetOrganizationId,
            assetId: targetId,
            safeFileName: objectName(source.storageKey),
          });
          const stagingStorageKey = createMediaStagingObjectKey({
            organizationId: input.request.targetOrganizationId,
            assetId: targetId,
            safeFileName: objectName(source.stagingStorageKey),
          });
          if (!storageKey || !stagingStorageKey) {
            throw new ApiError(
              409,
              "conflict",
              "Der Zielschluessel fuer ein Kursmedium ist ungueltig.",
            );
          }
          return {
            id: targetId,
            organizationId: input.request.targetOrganizationId,
            uploadedById: preflight.targetOwnerId,
            ownerUserId: null,
            purpose: "course_content" as const,
            kind: source.kind,
            status: "pending" as const,
            storageDriver: source.storageDriver,
            storageKey,
            stagingStorageKey,
            originalFileName: source.originalFileName.replace(
              UUID_IN_TEXT,
              "copied",
            ),
            safeFileName: source.safeFileName,
            declaredMimeType: source.declaredMimeType,
            declaredSizeBytes: size,
            quotaBytes: size,
            uploadExpiresAt: leaseExpiresAt,
            createdAt: now,
            updatedAt: now,
          };
        }),
      );
    }
    return { job } as const;
  });
  if ("existing" in claim && claim.existing) {
    return { job: publicOrbitTransferJob(claim.existing), created: false };
  }

  const heartbeat = startOrbitTransferLeaseHeartbeat({
    jobId: claim.job.id,
    claimToken: transferClaimToken,
    targetOrganizationId: input.request.targetOrganizationId,
    targetMediaIds: [...mediaIdMap.values()],
    initialLeaseExpiresAt: claim.job.leaseExpiresAt!,
  });
  const copiedMedia: CopiedMedia[] = [];
  try {
    for (const source of preflight.media) {
      await heartbeat.assertActive();
      copiedMedia.push(
        await copyTransferMedia({
          source,
          targetId: mediaIdMap.get(source.id)!,
          targetOrganizationId: input.request.targetOrganizationId,
          signal: heartbeat.signal,
        }),
      );
    }
    await heartbeat.assertActive();
    const finalAccess = await requireOrbitAccess({
      user: input.user,
      workspaceId: input.workspaceId,
      permission: "transfers:create",
      organizationIds: [
        input.request.sourceOrganizationId,
        input.request.targetOrganizationId,
      ],
    });
    if (finalAccess.actor.accountId !== preflight.actorAccountId) {
      throw new ApiError(
        403,
        "forbidden",
        "Die Orbit-Identitaet hat sich geaendert.",
      );
    }
    await heartbeat.assertActive();
    await heartbeat.stop();
    const completed = await db.transaction(async (tx) => {
      const claimCheckedAt = new Date();
      const [ownedJob] = await tx
        .select({ id: orbitTransferJobs.id })
        .from(orbitTransferJobs)
        .where(
          and(
            eq(orbitTransferJobs.id, claim.job.id),
            eq(orbitTransferJobs.status, "processing"),
            eq(orbitTransferJobs.claimToken, transferClaimToken),
            gt(orbitTransferJobs.leaseExpiresAt, claimCheckedAt),
          ),
        )
        .limit(1)
        .for("update");
      if (!ownedJob) throw new OrbitTransferClaimLostError();
      const currentRole = await lockAndAssertTransferAuthorization({
        tx,
        accountId: finalAccess.actor.accountId,
        workspaceId: input.workspaceId,
      });
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`orbit-target:${input.request.targetOrganizationId}`}, 0))`,
      );
      await tx.execute(
        mediaTenantQuotaLockQuery(input.request.targetOrganizationId),
      );
      const currentInstances = await tx
        .select()
        .from(orbitInstances)
        .where(
          and(
            eq(orbitInstances.workspaceId, input.workspaceId),
            inArray(orbitInstances.organizationId, [
              input.request.sourceOrganizationId,
              input.request.targetOrganizationId,
            ]),
          ),
        )
        .for("update");
      const sourceInstance = currentInstances.find(
        (instance) =>
          instance.organizationId === input.request.sourceOrganizationId,
      );
      const targetInstance = currentInstances.find(
        (instance) =>
          instance.organizationId === input.request.targetOrganizationId,
      );
      if (
        !sourceInstance ||
        !targetInstance ||
        sourceInstance.status !== "active" ||
        targetInstance.status !== "active" ||
        !sourceInstance.entitlements.includes("content_transfer") ||
        !targetInstance.entitlements.includes("content_transfer")
      ) {
        throw new ApiError(
          409,
          "conflict",
          "Quell- oder Zielinstanz ist nicht mehr fuer Transfers verfuegbar.",
        );
      }
      if (currentRole === "partner") {
        const now = new Date();
        const delegations = await tx
          .select({
            organizationId: orbitPartnerDelegations.organizationId,
            permissions: orbitPartnerDelegations.permissions,
            expiresAt: orbitPartnerDelegations.expiresAt,
            revokedAt: orbitPartnerDelegations.revokedAt,
          })
          .from(orbitPartnerDelegations)
          .where(
            and(
              eq(orbitPartnerDelegations.workspaceId, input.workspaceId),
              eq(
                orbitPartnerDelegations.partnerAccountId,
                finalAccess.actor.accountId,
              ),
              inArray(orbitPartnerDelegations.organizationId, [
                input.request.sourceOrganizationId,
                input.request.targetOrganizationId,
              ]),
            ),
          )
          .for("update");
        const activeOrganizations = new Set(
          delegations
            .filter(
              (delegation) =>
                !delegation.revokedAt &&
                (!delegation.expiresAt || delegation.expiresAt > now) &&
                delegation.permissions.includes("transfers:create"),
            )
            .map((delegation) => delegation.organizationId),
        );
        if (
          !activeOrganizations.has(input.request.sourceOrganizationId) ||
          !activeOrganizations.has(input.request.targetOrganizationId)
        ) {
          throw new ApiError(
            403,
            "forbidden",
            "Die Orbit-Delegation wurde entzogen.",
          );
        }
      }
      const [courseCount] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(courses)
        .where(eq(courses.organizationId, input.request.targetOrganizationId));
      if (
        Number(courseCount?.count ?? 0) + preflight.courses.length >
        targetInstance.courseLimit
      ) {
        throw new ApiError(
          409,
          "conflict",
          "Das Kurslimit der Zielinstanz wurde zwischenzeitlich erreicht.",
        );
      }
      const [mediaUsage] = await tx
        .select({
          bytes: sql<number>`(
            coalesce((select sum(${mediaAssets.quotaBytes}) from ${mediaAssets} where ${mediaAssets.organizationId} = ${input.request.targetOrganizationId}), 0) +
            coalesce((select sum(${mediaAssetDerivatives.sizeBytes}) from ${mediaAssetDerivatives} where ${mediaAssetDerivatives.organizationId} = ${input.request.targetOrganizationId}), 0)
          )::bigint`,
        })
        .from(orbitInstances)
        .where(
          and(
            eq(orbitInstances.workspaceId, input.workspaceId),
            eq(
              orbitInstances.organizationId,
              input.request.targetOrganizationId,
            ),
          ),
        )
        .limit(1);
      if (
        Number(mediaUsage?.bytes ?? 0) > mediaStorageLimits().tenantQuotaBytes
      ) {
        throw new ApiError(
          409,
          "conflict",
          "Das Medienkontingent der Zielinstanz wurde zwischenzeitlich erreicht.",
        );
      }
      const mappedTargetUserIds = [
        ...new Set([
          preflight.targetOwnerId,
          ...preflight.authorMappings.map((mapping) => mapping.targetUserId),
        ]),
      ];
      const currentTargetAuthors = await tx
        .select({
          id: users.id,
          firstName: users.firstName,
          lastName: users.lastName,
          avatarUrl: users.avatarUrl,
          jobTitle: users.jobTitle,
          bio: users.bio,
          role: users.role,
          status: users.status,
        })
        .from(users)
        .where(
          and(
            eq(users.organizationId, input.request.targetOrganizationId),
            inArray(users.id, mappedTargetUserIds),
          ),
        )
        .for("share");
      const targetOwner = currentTargetAuthors.find(
        (author) => author.id === preflight.targetOwnerId,
      );
      const currentTargetById = new Map(
        currentTargetAuthors.map((author) => [author.id, author]),
      );
      if (
        !targetOwner ||
        targetOwner.status !== "active" ||
        (targetOwner.role !== "owner" && targetOwner.role !== "admin") ||
        preflight.authorMappings.some((mapping) => {
          const target = currentTargetById.get(mapping.targetUserId);
          return (
            !target ||
            target.status !== "active" ||
            !ORBIT_TRANSFER_AUTHOR_ROLES.some((role) => role === target.role)
          );
        })
      ) {
        throw new ApiError(
          409,
          "conflict",
          "Mindestens ein zugeordneter Zielautor ist nicht mehr aktiv oder nicht mehr als Autor geeignet.",
        );
      }
      const authorIdMap = new Map(
        preflight.authorMappings.map((mapping) => [
          mapping.sourceUserId,
          mapping.targetUserId,
        ]),
      );
      const targetAuthorProfiles = new Map<string, OrbitTransferAuthorProfile>(
        preflight.authorMappings.map((mapping) => {
          const target = currentTargetById.get(mapping.targetUserId)!;
          return [
            mapping.targetUserId,
            {
              id: target.id,
              firstName: target.firstName,
              lastName: target.lastName,
              avatarUrl: target.avatarUrl,
              jobTitle: target.jobTitle,
              bio: target.bio,
            },
          ];
        }),
      );
      const existingSlugs = new Set(
        (
          await tx
            .select({ slug: courses.slug })
            .from(courses)
            .where(
              eq(courses.organizationId, input.request.targetOrganizationId),
            )
        ).map((row) => row.slug),
      );
      const capturedAt = new Date();
      const prepared = preflight.courses.map((source) => {
        const targetCourseId = courseIdMap.get(source.course.id)!;
        const targetVersionId = versionIdMap.get(source.version.id)!;
        const slug = targetSlug(source, targetCourseId, existingSlugs);
        const remapped = remapPublishedCourseSnapshot({
          snapshot: source.version.snapshot,
          sourceOrganizationId: input.request.sourceOrganizationId,
          targetOrganizationId: input.request.targetOrganizationId,
          sourceCourseId: source.course.id,
          targetCourseId,
          sourceVersionId: source.version.id,
          targetVersionId,
          targetOwnerId: preflight.targetOwnerId,
          authorIdMap,
          targetAuthorProfiles,
          targetSlug: slug,
          courseIdMap,
          versionIdMap,
          mediaIdMap,
          capturedAt,
        });
        if (
          !isValidPublishedCourseSnapshot(
            remapped.snapshot,
            targetCourseId,
            input.request.targetOrganizationId,
          )
        ) {
          throw new ApiError(
            409,
            "conflict",
            "Der isolierte Ziel-Snapshot ist ungueltig.",
          );
        }
        return {
          source,
          targetCourseId,
          targetVersionId,
          slug,
          snapshot: remapped.snapshot,
        };
      });

      for (const asset of copiedMedia) {
        const size = actualSize(asset.source);
        const [promoted] = await tx
          .update(mediaAssets)
          .set({
            status: "ready",
            detectedMimeType: asset.source.detectedMimeType,
            actualSizeBytes: size,
            durationMilliseconds: asset.source.durationMilliseconds,
            etag: asset.etag,
            stagingStorageVersionId: asset.stagingVersionId,
            storageVersionId: asset.storageVersionId,
            contentSha256: asset.source.contentSha256,
            uploadExpiresAt: new Date(),
            uploadedAt: new Date(),
            scanCompletedAt: new Date(),
            stagingDeletedAt: asset.stagingDeletedAt,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(mediaAssets.id, asset.targetId),
              eq(
                mediaAssets.organizationId,
                input.request.targetOrganizationId,
              ),
              eq(mediaAssets.status, "pending"),
            ),
          )
          .returning({ id: mediaAssets.id });
        if (!promoted) {
          throw new ApiError(
            409,
            "conflict",
            "Eine Medienreservierung ist nicht mehr verfuegbar.",
          );
        }
      }
      await tx.insert(courses).values(
        prepared.map(({ targetCourseId, slug, snapshot }) => ({
          id: targetCourseId,
          organizationId: input.request.targetOrganizationId,
          categoryId: null,
          title: snapshot.course.title,
          slug,
          shortDescription: snapshot.course.shortDescription,
          description: snapshot.course.description,
          coverImage: snapshot.course.coverImage,
          status: "published" as const,
          difficulty: snapshot.course.difficulty,
          estimatedMinutes: snapshot.course.estimatedMinutes,
          certificateEnabled: snapshot.course.certificateEnabled,
          featured: false,
          visibleInCatalog: snapshot.course.visibleInCatalog,
          showProgressPercentage: snapshot.course.showProgressPercentage,
          notifyMembersOnModuleRelease:
            snapshot.course.notifyMembersOnModuleRelease ?? false,
          firstPublishedAt: capturedAt,
          createdById: preflight.targetOwnerId,
          createdAt: capturedAt,
          updatedAt: capturedAt,
        })),
      );
      for (const course of prepared) {
        await insertSnapshotGraph(
          tx,
          input.request.targetOrganizationId,
          course.targetCourseId,
          course.snapshot,
        );
        await tx.insert(courseVersions).values({
          id: course.targetVersionId,
          organizationId: input.request.targetOrganizationId,
          courseId: course.targetCourseId,
          version: 1,
          snapshot: course.snapshot,
          changelog: "Orbit-Transfer",
          publishedAt: capturedAt,
          createdById: preflight.targetOwnerId,
          createdAt: capturedAt,
        });
        await tx
          .update(courses)
          .set({
            publishedVersionId: course.targetVersionId,
            updatedAt: capturedAt,
          })
          .where(
            and(
              eq(courses.id, course.targetCourseId),
              eq(courses.organizationId, input.request.targetOrganizationId),
            ),
          );
        const referencedAssets = [
          ...courseSnapshotMediaAssets(course.snapshot).keys(),
        ];
        if (referencedAssets.length) {
          await tx.insert(courseMediaAssets).values(
            referencedAssets.map((mediaAssetId) => ({
              organizationId: input.request.targetOrganizationId,
              courseId: course.targetCourseId,
              mediaAssetId,
              attachedById: preflight.targetOwnerId,
            })),
          );
        }
        const linkModules = course.snapshot.modules.filter(
          (learningModule) =>
            learningModule.kind === "link" && learningModule.linkedCourseId,
        );
        if (linkModules.length) {
          await tx.insert(publishedCourseLinkEdges).values(
            linkModules.map((learningModule) => ({
              organizationId: input.request.targetOrganizationId,
              sourceCourseId: course.targetCourseId,
              sourceVersionId: course.targetVersionId,
              linkModuleId: learningModule.id,
              targetCourseId: learningModule.linkedCourseId!,
            })),
          );
        }
      }
      const targetCourseIds = prepared.map((course) => course.targetCourseId);
      for (const asset of copiedMedia) {
        if (asset.source.kind !== "video" || !asset.source.contentSha256) {
          continue;
        }
        await enqueueReadyVideoThumbnailInTransaction(tx, {
          organizationId: input.request.targetOrganizationId,
          sourceAssetId: asset.targetId,
          sourceContentSha256: asset.source.contentSha256,
          requestedById: preflight.targetOwnerId,
          atMilliseconds: 0,
        });
      }
      const [job] = await tx
        .update(orbitTransferJobs)
        .set({
          status: "completed",
          targetCourseIds,
          claimToken: null,
          leaseExpiresAt: null,
          completedAt: sql`clock_timestamp()`,
          updatedAt: sql`clock_timestamp()`,
        })
        .where(
          and(
            eq(orbitTransferJobs.id, claim.job.id),
            eq(orbitTransferJobs.status, "processing"),
            eq(orbitTransferJobs.claimToken, transferClaimToken),
          ),
        )
        .returning();
      if (!job)
        throw new ApiError(
          409,
          "conflict",
          "Der Transfer-Claim wurde verloren.",
        );
      await tx.insert(orbitAuditEvents).values({
        workspaceId: input.workspaceId,
        actorAccountId: claim.job.requestedByAccountId,
        action: "transfer.completed",
        resourceType: "transfer_job",
        resourceId: claim.job.id,
        sourceOrganizationId: input.request.sourceOrganizationId,
        targetOrganizationId: input.request.targetOrganizationId,
        outcome: "succeeded",
        metadata: {
          courseCount: targetCourseIds.length,
          mediaAssetCount: copiedMedia.length,
          authorMappingCount: preflight.authorMappings.length,
          authorMappings: preflight.authorMappings,
        },
      });
      return job;
    });
    return { job: publicOrbitTransferJob(completed), created: true };
  } catch (error) {
    await heartbeat.stop();
    const failureCode =
      error instanceof ApiError ? error.code : "transfer_execution_failed";
    const now = new Date();
    const recovery = await db
      .transaction(async (tx) => {
        const [current] = await tx
          .select()
          .from(orbitTransferJobs)
          .where(eq(orbitTransferJobs.id, claim.job.id))
          .limit(1)
          .for("update");
        if (current?.status === "completed") {
          return { completed: current, failed: false } as const;
        }
        if (
          !current ||
          current.status !== "processing" ||
          current.claimToken !== transferClaimToken ||
          !current.leaseExpiresAt ||
          current.leaseExpiresAt <= now
        ) {
          return { completed: null, failed: false } as const;
        }
        const [failed] = await tx
          .update(orbitTransferJobs)
          .set({
            status: "failed",
            failureCode,
            claimToken: null,
            leaseExpiresAt: null,
            completedAt: sql`clock_timestamp()`,
            updatedAt: sql`clock_timestamp()`,
          })
          .where(
            and(
              eq(orbitTransferJobs.id, claim.job.id),
              eq(orbitTransferJobs.status, "processing"),
              eq(orbitTransferJobs.claimToken, transferClaimToken),
            ),
          )
          .returning({ id: orbitTransferJobs.id });
        if (!failed) return { completed: null, failed: false } as const;
        if (mediaIdMap.size) {
          const cleanupAfter = orbitTransferLeaseDeadline(now);
          await tx
            .update(mediaAssets)
            .set({ uploadExpiresAt: cleanupAfter, updatedAt: now })
            .where(
              and(
                eq(
                  mediaAssets.organizationId,
                  input.request.targetOrganizationId,
                ),
                eq(mediaAssets.status, "pending"),
                inArray(mediaAssets.id, [...mediaIdMap.values()]),
              ),
            );
        }
        await tx.insert(orbitAuditEvents).values({
          workspaceId: input.workspaceId,
          actorAccountId: claim.job.requestedByAccountId,
          action: "transfer.failed",
          resourceType: "transfer_job",
          resourceId: claim.job.id,
          sourceOrganizationId: input.request.sourceOrganizationId,
          targetOrganizationId: input.request.targetOrganizationId,
          outcome: "failed",
          metadata: {
            failureCode,
            authorMappingCount: preflight.authorMappings.length,
          },
        });
        return { completed: null, failed: true } as const;
      })
      .catch(() => null);
    if (recovery?.completed) {
      return { job: publicOrbitTransferJob(recovery.completed), created: true };
    }
    if (!recovery?.failed) {
      const [completedAfterCas] = await db
        .select()
        .from(orbitTransferJobs)
        .where(eq(orbitTransferJobs.id, claim.job.id))
        .limit(1)
        .catch(() => []);
      if (completedAfterCas?.status === "completed") {
        return {
          job: publicOrbitTransferJob(completedAfterCas),
          created: true,
        };
      }
    }
    throw error;
  }
}
