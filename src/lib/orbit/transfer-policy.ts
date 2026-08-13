import { randomUUID } from "node:crypto";

import type { CourseVersionSnapshot, OrbitTransferJob } from "@/db/schema";
import {
  canonicalOrbitTransferAuthorMappings,
  type OrbitTransferAuthorMapping,
  type OrbitTransferAuthorProfile,
} from "@/lib/orbit/transfer-authors";

const UUID_PATTERN =
  /[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi;

export function snapshotUuidSet(snapshot: CourseVersionSnapshot) {
  return new Set(
    JSON.stringify(snapshot)
      .match(UUID_PATTERN)
      ?.map((id) => id.toLowerCase()) ?? [],
  );
}

function remapValue(
  value: unknown,
  mapping: ReadonlyMap<string, string>,
): unknown {
  if (typeof value === "string") {
    return value.replace(
      UUID_PATTERN,
      (match) => mapping.get(match.toLowerCase()) ?? match,
    );
  }
  if (Array.isArray(value))
    return value.map((entry) => remapValue(entry, mapping));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [
      key,
      remapValue(nested, mapping),
    ]),
  );
}

export function remapPublishedCourseSnapshot(input: {
  snapshot: CourseVersionSnapshot;
  sourceOrganizationId: string;
  targetOrganizationId: string;
  sourceCourseId: string;
  targetCourseId: string;
  sourceVersionId: string;
  targetVersionId: string;
  targetOwnerId: string;
  authorIdMap: ReadonlyMap<string, string>;
  targetAuthorProfiles: ReadonlyMap<string, OrbitTransferAuthorProfile>;
  targetSlug: string;
  courseIdMap: ReadonlyMap<string, string>;
  versionIdMap: ReadonlyMap<string, string>;
  mediaIdMap: ReadonlyMap<string, string>;
  capturedAt: Date;
  idFactory?: () => string;
}) {
  const idFactory = input.idFactory ?? randomUUID;
  const mapping = new Map<string, string>();
  const register = (source: string, target: string) =>
    mapping.set(source.toLowerCase(), target.toLowerCase());
  register(input.sourceOrganizationId, input.targetOrganizationId);
  register(input.sourceCourseId, input.targetCourseId);
  register(input.sourceVersionId, input.targetVersionId);
  for (const [source, target] of input.courseIdMap) register(source, target);
  for (const [source, target] of input.versionIdMap) register(source, target);
  for (const [source, target] of input.mediaIdMap) register(source, target);
  for (const [source, target] of input.authorIdMap) register(source, target);
  const sourceUuids = snapshotUuidSet(input.snapshot);
  for (const sourceUuid of [...sourceUuids].sort()) {
    if (!mapping.has(sourceUuid)) register(sourceUuid, idFactory());
  }

  const snapshot = remapValue(input.snapshot, mapping) as CourseVersionSnapshot;
  const now = input.capturedAt.toISOString();
  snapshot.capturedAt = now;
  snapshot.course = {
    ...snapshot.course,
    id: input.targetCourseId,
    organizationId: input.targetOrganizationId,
    categoryId: null,
    slug: input.targetSlug,
    status: "published",
    publishedVersionId: input.targetVersionId,
    createdById: input.targetOwnerId,
    firstPublishedAt: now,
    createdAt: now,
    updatedAt: now,
  };
  snapshot.authors = (input.snapshot.authors ?? []).map(
    (sourceAuthor, index) => {
      const targetUserId = input.authorIdMap.get(sourceAuthor.userId);
      const targetProfile = targetUserId
        ? input.targetAuthorProfiles.get(targetUserId)
        : null;
      const targetAuthor = snapshot.authors?.[index];
      if (!targetUserId || !targetProfile || !targetAuthor) {
        throw new Error(
          "Every source author must have a valid target author mapping.",
        );
      }
      return {
        ...targetAuthor,
        id: idFactory(),
        organizationId: input.targetOrganizationId,
        courseId: input.targetCourseId,
        userId: targetUserId,
        createdAt: now,
        author: targetProfile,
      };
    },
  );
  snapshot.widgets = snapshot.widgets?.map((widget, index) => {
    const sourceWidget = input.snapshot.widgets?.[index];
    if (sourceWidget?.type === "author") {
      const targetUserId = sourceWidget.authorUserId
        ? input.authorIdMap.get(sourceWidget.authorUserId)
        : null;
      const targetProfile = targetUserId
        ? input.targetAuthorProfiles.get(targetUserId)
        : null;
      if (!targetUserId || !targetProfile || widget.type !== "author") {
        throw new Error(
          "Every author widget must have a valid target author mapping.",
        );
      }
      return {
        ...widget,
        authorUserId: targetUserId,
        author: targetProfile,
      };
    }
    return {
      ...widget,
      authorUserId: null,
      authorRole: null,
      authorDescription: null,
      author: null,
    };
  });

  for (const learningModule of snapshot.modules) {
    for (const lesson of learningModule.lessons) {
      const blocks = [
        ...lesson.blocks,
        ...lesson.pages.flatMap((page) => page.blocks),
      ];
      for (const block of blocks) {
        if (block.data.agentId || block.data.formId) {
          block.data = {
            ...block.data,
            agentId: undefined,
            formId: undefined,
          };
        }
        if (block.type === "video" && block.data.videoComposition) {
          throw new Error(
            "Video compositions must be exported as standalone videos before an Orbit transfer.",
          );
        }
      }
    }
  }

  snapshot.modules.forEach((targetModule, index) => {
    const sourceModule = input.snapshot.modules[index];
    if (
      sourceModule?.kind === "link" &&
      sourceModule.linkedCourseId &&
      !input.courseIdMap.has(sourceModule.linkedCourseId)
    ) {
      targetModule.kind = "learning";
      targetModule.linkedCourseId = null;
      targetModule.targetVersionIdAtCapture = null;
      targetModule.isRequired = false;
    }
  });

  const serialized = JSON.stringify(snapshot).toLowerCase();
  const leaked = [...sourceUuids].find((sourceUuid) =>
    serialized.includes(sourceUuid),
  );
  if (leaked) {
    throw new Error(
      "The target course snapshot still contains a source identity.",
    );
  }
  return { snapshot, mapping, sourceUuids };
}

export function canonicalOrbitTransferRequest(input: {
  workspaceId: string;
  sourceOrganizationId: string;
  targetOrganizationId: string;
  sourceCourseIds: readonly string[];
  authorMappings?: readonly OrbitTransferAuthorMapping[];
}) {
  return JSON.stringify({
    workspaceId: input.workspaceId,
    sourceOrganizationId: input.sourceOrganizationId,
    targetOrganizationId: input.targetOrganizationId,
    sourceCourseIds: [...new Set(input.sourceCourseIds)].sort(),
    authorMappings: canonicalOrbitTransferAuthorMappings(
      input.authorMappings ?? [],
    ),
  });
}

export function publicOrbitTransferJob(job: OrbitTransferJob) {
  const { authorMappings, ...preflight } = job.preflight;
  return {
    id: job.id,
    workspaceId: job.workspaceId,
    sourceOrganizationId: job.sourceOrganizationId,
    targetOrganizationId: job.targetOrganizationId,
    targetCourseIds: job.targetCourseIds,
    status: job.status,
    preflight: {
      ...preflight,
      authorMappingCount: authorMappings?.length ?? 0,
    },
    failureCode: job.failureCode,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}
