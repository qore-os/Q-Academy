import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import type { CourseVersionSnapshot } from "../src/db/schema";
import { orbitOpenApiDocument } from "../src/lib/orbit/openapi";
import {
  ORBIT_PERMISSIONS,
  orbitScopeDecision,
} from "../src/lib/orbit/policy";
import {
  remapPublishedCourseSnapshot,
  snapshotUuidSet,
} from "../src/lib/orbit/transfer-policy";
import { PENDING_SCHEMA_PRIVACY_DATA_INVENTORY } from "../src/lib/privacy/pending-schema-inventory";

const ids = {
  sourceOrganization: "11111111-1111-4111-8111-111111111111",
  targetOrganization: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  sourceCourse: "22222222-2222-4222-8222-222222222222",
  targetCourse: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  sourceVersion: "33333333-3333-4333-8333-333333333333",
  targetVersion: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  targetOwner: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  sourceModule: "44444444-4444-4444-8444-444444444444",
  sourceLearningModule: "45454545-4545-4545-8545-454545454545",
  externalCourse: "55555555-5555-4555-8555-555555555555",
  externalVersion: "66666666-6666-4666-8666-666666666666",
  sourceMedia: "77777777-7777-4777-8777-777777777777",
  targetMedia: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  sourceAudio: "12121212-1212-4212-8212-121212121212",
  targetAudio: "abababab-abab-4bab-8bab-abababababab",
  sourceRenderJob: "13131313-1313-4313-8313-131313131313",
  sourceTrack: "14141414-1414-4414-8414-141414141414",
  sourceAuthor: "88888888-8888-4888-8888-888888888888",
  sourceAuthorRelation: "89898989-8989-4989-8989-898989898989",
  targetAuthor: "edededed-eded-4ded-8ded-edededededed",
  sourceWidget: "99999999-9999-4999-8999-999999999999",
  sourceAuthorWidget: "98989898-9898-4989-8989-989898989898",
};

const targetAuthorProfile = {
  id: ids.targetAuthor,
  firstName: "Target",
  lastName: "Trainer",
  avatarUrl: "/target-avatar.png",
  jobTitle: "Trainer",
  bio: "Target biography",
};

function sourceSnapshot() {
  return {
    schemaVersion: 6,
    accessPolicyVersion: 2,
    moduleKindVersion: 1,
    courseOutlineVersion: 1,
    capturedAt: "2026-01-01T10:00:00.000Z",
    course: {
      id: ids.sourceCourse,
      organizationId: ids.sourceOrganization,
      categoryId: null,
      title: "Isolation",
      slug: "isolation",
      shortDescription: "Snapshot",
      description: "Snapshot content",
      coverImage: `/api/media-assets/${ids.sourceMedia}/download`,
      status: "published",
      difficulty: "Grundlagen",
      estimatedMinutes: 20,
      certificateEnabled: true,
      featured: false,
      visibleInCatalog: true,
      showProgressPercentage: true,
      publishedVersionId: ids.sourceVersion,
      firstPublishedAt: "2026-01-01T10:00:00.000Z",
      createdById: ids.sourceAuthor,
      createdAt: "2026-01-01T10:00:00.000Z",
      updatedAt: "2026-01-01T10:00:00.000Z",
    },
    authors: [
      {
        id: ids.sourceAuthorRelation,
        organizationId: ids.sourceOrganization,
        courseId: ids.sourceCourse,
        userId: ids.sourceAuthor,
        sortOrder: 0,
        createdAt: "2026-01-01T10:00:00.000Z",
        author: {
          id: ids.sourceAuthor,
          firstName: "Source",
          lastName: "Person",
          avatarUrl: null,
          jobTitle: null,
          bio: null,
        },
      },
    ],
    widgets: [
      {
        id: ids.sourceWidget,
        organizationId: ids.sourceOrganization,
        courseId: ids.sourceCourse,
        type: "image_link",
        sortOrder: 0,
        authorUserId: null,
        authorRole: null,
        authorDescription: null,
        title: null,
        text: null,
        linkUrl: "/academy/courses",
        imageUrl: `/api/media-assets/${ids.sourceMedia}/download`,
        mediaAssetId: ids.sourceMedia,
        altText: "Transferred private widget image",
        createdAt: "2026-01-01T10:00:00.000Z",
        updatedAt: "2026-01-01T10:00:00.000Z",
        author: null,
      },
      {
        id: ids.sourceAuthorWidget,
        organizationId: ids.sourceOrganization,
        courseId: ids.sourceCourse,
        type: "author",
        sortOrder: 1,
        authorUserId: ids.sourceAuthor,
        authorRole: "Lead trainer",
        authorDescription: "Course owner",
        title: null,
        text: null,
        linkUrl: null,
        imageUrl: null,
        mediaAssetId: null,
        altText: null,
        createdAt: "2026-01-01T10:00:00.000Z",
        updatedAt: "2026-01-01T10:00:00.000Z",
        author: {
          id: ids.sourceAuthor,
          firstName: "Source",
          lastName: "Person",
          avatarUrl: null,
          jobTitle: null,
          bio: null,
        },
      },
    ],
    modules: [
      {
        id: ids.sourceModule,
        organizationId: ids.sourceOrganization,
        title: "External link",
        kind: "link",
        linkedCourseId: ids.externalCourse,
        targetVersionIdAtCapture: ids.externalVersion,
        description: null,
        folder: "Allgemein",
        isReusable: false,
        estimatedMinutes: 0,
        createdAt: "2026-01-01T10:00:00.000Z",
        updatedAt: "2026-01-01T10:00:00.000Z",
        sortOrder: 0,
        indentLevel: 0,
        dripDays: 0,
        accessMode: "visible",
        delayPendingState: "locked",
        availableFrom: null,
        availableUntil: null,
        windowDefaultState: "locked",
        windowState: "available",
        requestAccessEnabled: false,
        isRequired: false,
        lessons: [],
      },
      {
        id: ids.sourceLearningModule,
        organizationId: ids.sourceOrganization,
        title: "Composed video",
        kind: "learning",
        linkedCourseId: null,
        targetVersionIdAtCapture: null,
        description: null,
        folder: "Allgemein",
        isReusable: false,
        estimatedMinutes: 10,
        createdAt: "2026-01-01T10:00:00.000Z",
        updatedAt: "2026-01-01T10:00:00.000Z",
        sortOrder: 1,
        indentLevel: 0,
        dripDays: 0,
        accessMode: "visible",
        delayPendingState: "locked",
        availableFrom: null,
        availableUntil: null,
        windowDefaultState: "locked",
        windowState: "available",
        requestAccessEnabled: false,
        isRequired: true,
        lessons: [
          {
            id: "15151515-1515-4515-8515-151515151515",
            organizationId: ids.sourceOrganization,
            moduleId: ids.sourceLearningModule,
            visibility: "visible",
            availableAt: null,
            dripDays: 0,
            unlockAfterPrevious: false,
            blocks: [
              {
                id: "16161616-1616-4616-8616-161616161616",
                type: "video",
                data: {
                  mediaAssetId: ids.sourceMedia,
                  videoComposition: {
                    version: 1,
                    renderJobId: ids.sourceRenderJob,
                    audioTracks: [
                      {
                        id: ids.sourceTrack,
                        mediaAssetId: ids.sourceAudio,
                        timelineStartMs: 1_000,
                        sourceStartMs: 0,
                        sourceEndMs: null,
                        volume: 1,
                      },
                    ],
                  },
                },
              },
            ],
            pages: [],
          },
        ],
      },
    ],
  } as unknown as CourseVersionSnapshot;
}

test("Orbit scope policy permits only workspace and delegated tenant scopes", () => {
  const now = new Date("2026-07-12T10:00:00.000Z");
  const workspaceOrganizationIds = [ids.sourceOrganization, ids.targetOrganization];
  assert.equal(
    orbitScopeDecision({
      role: "operator",
      permissionSet: null,
      permission: "transfers:create",
      workspaceOrganizationIds,
      requestedOrganizationIds: workspaceOrganizationIds,
      delegations: [],
      now,
    }).allowed,
    true,
  );
  assert.equal(
    orbitScopeDecision({
      role: "operator",
      permissionSet: null,
      permission: "transfers:create",
      workspaceOrganizationIds,
      requestedOrganizationIds: ["99999999-9999-4999-8999-999999999999"],
      delegations: [],
      now,
    }).allowed,
    false,
  );
  assert.equal(
    orbitScopeDecision({
      role: "partner",
      permissionSet: null,
      permission: "transfers:create",
      workspaceOrganizationIds,
      requestedOrganizationIds: workspaceOrganizationIds,
      delegations: [
        {
          organizationId: ids.sourceOrganization,
          permissions: ["transfers:create"],
          expiresAt: null,
          revokedAt: null,
        },
      ],
      now,
    }).allowed,
    false,
  );
  assert.equal(
    orbitScopeDecision({
      role: "partner",
      permissionSet: null,
      permission: "transfers:create",
      workspaceOrganizationIds,
      requestedOrganizationIds: workspaceOrganizationIds,
      delegations: workspaceOrganizationIds.map((organizationId) => ({
        organizationId,
        permissions: ["transfers:create"],
        expiresAt: new Date("2026-07-13T10:00:00.000Z"),
        revokedAt: null,
      })),
      now,
    }).allowed,
    true,
  );
  assert.equal(
    orbitScopeDecision({
      role: "administrator",
      permissionSet: ["instances:read"],
      permission: "transfers:create",
      workspaceOrganizationIds,
      requestedOrganizationIds: workspaceOrganizationIds,
      delegations: [],
      now,
    }).allowed,
    false,
  );
});

test("course transfer remaps every source identity and neutralizes external links", () => {
  let sequence = 1;
  const snapshot = sourceSnapshot();
  delete snapshot.modules[1]?.lessons[0]?.blocks[0]?.data.videoComposition;
  const remapped = remapPublishedCourseSnapshot({
    snapshot,
    sourceOrganizationId: ids.sourceOrganization,
    targetOrganizationId: ids.targetOrganization,
    sourceCourseId: ids.sourceCourse,
    targetCourseId: ids.targetCourse,
    sourceVersionId: ids.sourceVersion,
    targetVersionId: ids.targetVersion,
    targetOwnerId: ids.targetOwner,
    authorIdMap: new Map([[ids.sourceAuthor, ids.targetAuthor]]),
    targetAuthorProfiles: new Map([[ids.targetAuthor, targetAuthorProfile]]),
    targetSlug: "isolation-copy",
    courseIdMap: new Map([[ids.sourceCourse, ids.targetCourse]]),
    versionIdMap: new Map([[ids.sourceVersion, ids.targetVersion]]),
    mediaIdMap: new Map([
      [ids.sourceMedia, ids.targetMedia],
      [ids.sourceAudio, ids.targetAudio],
    ]),
    capturedAt: new Date("2026-07-12T10:00:00.000Z"),
    idFactory: () =>
      `90000000-0000-4000-8000-${String(sequence++).padStart(12, "0")}`,
  });
  const serialized = JSON.stringify(remapped.snapshot).toLowerCase();
  for (const sourceId of snapshotUuidSet(snapshot)) {
    assert.equal(serialized.includes(sourceId), false, sourceId);
  }
  assert.equal(remapped.snapshot.course.id, ids.targetCourse);
  assert.equal(remapped.snapshot.course.organizationId, ids.targetOrganization);
  assert.equal(remapped.snapshot.course.publishedVersionId, ids.targetVersion);
  assert.equal(remapped.snapshot.course.createdById, ids.targetOwner);
  assert.equal(
    remapped.snapshot.course.coverImage,
    `/api/media-assets/${ids.targetMedia}/download`,
  );
  assert.equal(remapped.snapshot.authors?.[0]?.userId, ids.targetAuthor);
  assert.deepEqual(remapped.snapshot.authors?.[0]?.author, targetAuthorProfile);
  assert.notEqual(remapped.snapshot.authors?.[0]?.id, ids.sourceAuthorRelation);
  assert.equal(remapped.snapshot.widgets?.[0]?.mediaAssetId, ids.targetMedia);
  assert.equal(
    remapped.snapshot.widgets?.[0]?.imageUrl,
    `/api/media-assets/${ids.targetMedia}/download`,
  );
  assert.equal(remapped.snapshot.widgets?.[1]?.type, "author");
  assert.equal(remapped.snapshot.widgets?.[1]?.authorUserId, ids.targetAuthor);
  assert.equal(remapped.snapshot.widgets?.[1]?.authorRole, "Lead trainer");
  assert.equal(remapped.snapshot.widgets?.[1]?.authorDescription, "Course owner");
  assert.deepEqual(remapped.snapshot.widgets?.[1]?.author, targetAuthorProfile);
  assert.equal(remapped.snapshot.modules[0]?.kind, "learning");
  assert.equal(remapped.snapshot.modules[0]?.linkedCourseId, null);
  assert.equal(remapped.snapshot.modules[0]?.targetVersionIdAtCapture, null);
});

test("course transfer never creates an unrendered published video composition", () => {
  assert.throws(
    () =>
      remapPublishedCourseSnapshot({
        snapshot: sourceSnapshot(),
        sourceOrganizationId: ids.sourceOrganization,
        targetOrganizationId: ids.targetOrganization,
        sourceCourseId: ids.sourceCourse,
        targetCourseId: ids.targetCourse,
        sourceVersionId: ids.sourceVersion,
        targetVersionId: ids.targetVersion,
        targetOwnerId: ids.targetOwner,
        authorIdMap: new Map([[ids.sourceAuthor, ids.targetAuthor]]),
        targetAuthorProfiles: new Map([[ids.targetAuthor, targetAuthorProfile]]),
        targetSlug: "isolation-copy",
        courseIdMap: new Map([[ids.sourceCourse, ids.targetCourse]]),
        versionIdMap: new Map([[ids.sourceVersion, ids.targetVersion]]),
        mediaIdMap: new Map([
          [ids.sourceMedia, ids.targetMedia],
          [ids.sourceAudio, ids.targetAudio],
        ]),
        capturedAt: new Date("2026-07-12T10:00:00.000Z"),
      }),
    /must be exported as standalone videos before an Orbit transfer/,
  );
});

test("Orbit frame-poster preflight names the actionable source-side alternatives", () => {
  const transferSource = readFileSync(
    path.resolve("src/lib/orbit/transfer.ts"),
    "utf8",
  );

  assert.match(
    transferSource,
    /vor dem Orbit-Transfer auf Automatisch oder ein eigenes Bild um/,
  );
  assert.doesNotMatch(transferSource, /nach einem Orbit-Transfer neu erzeugt/);
});

test("completed Orbit transfers atomically enqueue an automatic video poster", () => {
  const transferSource = readFileSync(
    path.resolve("src/lib/orbit/transfer.ts"),
    "utf8",
  );
  const enqueue = transferSource.indexOf(
    "enqueueReadyVideoThumbnailInTransaction(tx",
  );
  const completionCommit = transferSource.indexOf(
    'status: "completed"',
    enqueue,
  );

  assert.ok(enqueue >= 0 && completionCommit > enqueue);
  assert.match(
    transferSource.slice(enqueue, completionCommit),
    /sourceAssetId: asset\.targetId[\s\S]*sourceContentSha256: asset\.source\.contentSha256[\s\S]*atMilliseconds: 0/,
  );
  assert.doesNotMatch(
    transferSource.slice(enqueue, completionCommit),
    /\.catch\(/,
  );
});

test("Orbit API, schema boundaries, and pending privacy inventory are explicit", () => {
  const privacyTables = new Set(
    Object.keys(PENDING_SCHEMA_PRIVACY_DATA_INVENTORY),
  );
  for (const table of [
    "orbit_account_identities",
    "orbit_accounts",
    "orbit_audit_events",
    "orbit_billing_accounts",
    "orbit_billing_statements",
    "orbit_instance_claims",
    "orbit_instances",
    "orbit_partner_delegations",
    "orbit_permission_sets",
    "orbit_transfer_items",
    "orbit_transfer_jobs",
    "orbit_workspace_memberships",
    "orbit_workspaces",
  ]) {
    assert.equal(privacyTables.has(table), true, table);
  }
  assert.equal(
    PENDING_SCHEMA_PRIVACY_DATA_INVENTORY.native_push_devices.exportPolicy.excludedColumns.includes(
      "token_encrypted",
    ),
    true,
  );
  assert.equal(
    PENDING_SCHEMA_PRIVACY_DATA_INVENTORY.badge_groups.erasurePolicy.action,
    "not_applicable",
  );
  assert.equal(ORBIT_PERMISSIONS.length, 10);
  const operations = [
    ["/api/orbit/workspaces", "src/app/api/orbit/workspaces/route.ts", "get", "GET"],
    ["/api/orbit/workspaces", "src/app/api/orbit/workspaces/route.ts", "post", "POST"],
    ["/api/orbit/workspaces/{workspaceId}", "src/app/api/orbit/workspaces/[workspaceId]/route.ts", "get", "GET"],
    ["/api/orbit/workspaces/{workspaceId}/permission-sets", "src/app/api/orbit/workspaces/[workspaceId]/permission-sets/route.ts", "post", "POST"],
    ["/api/orbit/workspaces/{workspaceId}/memberships", "src/app/api/orbit/workspaces/[workspaceId]/memberships/route.ts", "put", "PUT"],
    ["/api/orbit/workspaces/{workspaceId}/instances/{organizationId}", "src/app/api/orbit/workspaces/[workspaceId]/instances/[organizationId]/route.ts", "patch", "PATCH"],
    ["/api/orbit/workspaces/{workspaceId}/instance-claims", "src/app/api/orbit/workspaces/[workspaceId]/instance-claims/route.ts", "post", "POST"],
    ["/api/orbit/workspaces/{workspaceId}/billing", "src/app/api/orbit/workspaces/[workspaceId]/billing/route.ts", "get", "GET"],
    ["/api/orbit/workspaces/{workspaceId}/billing", "src/app/api/orbit/workspaces/[workspaceId]/billing/route.ts", "patch", "PATCH"],
    ["/api/orbit/workspaces/{workspaceId}/billing/statements/finalize", "src/app/api/orbit/workspaces/[workspaceId]/billing/statements/finalize/route.ts", "post", "POST"],
    ["/api/orbit/instance-claims/redeem", "src/app/api/orbit/instance-claims/redeem/route.ts", "post", "POST"],
    ["/api/orbit/workspaces/{workspaceId}/delegations", "src/app/api/orbit/workspaces/[workspaceId]/delegations/route.ts", "post", "POST"],
    ["/api/orbit/workspaces/{workspaceId}/delegations/{delegationId}", "src/app/api/orbit/workspaces/[workspaceId]/delegations/[delegationId]/route.ts", "delete", "DELETE"],
    ["/api/orbit/workspaces/{workspaceId}/transfers/preflight", "src/app/api/orbit/workspaces/[workspaceId]/transfers/preflight/route.ts", "post", "POST"],
    ["/api/orbit/workspaces/{workspaceId}/transfers", "src/app/api/orbit/workspaces/[workspaceId]/transfers/route.ts", "post", "POST"],
  ] as const;
  for (const [apiPath, file, method, exportedMethod] of operations) {
    const pathItem = orbitOpenApiDocument.paths[apiPath] as Partial<
      Record<typeof method, unknown>
    >;
    assert.ok(pathItem[method], `${method} ${apiPath}`);
    const routeSource = readFileSync(path.resolve(file), "utf8");
    assert.match(routeSource, new RegExp(`export async function ${exportedMethod}\\b`));
    assert.match(routeSource, /handleSessionRequest/);
  }
  const schemaSource = readFileSync(
    path.resolve("src/db/schema.ts"),
    "utf8",
  );
  assert.match(schemaSource, /orbit_transfer_jobs_distinct_tenants_check/);
  assert.match(schemaSource, /orbit_account_identities_user_tenant_fk/);
  assert.match(schemaSource, /orbit_partner_delegations_instance_fk/);
  const accessSource = readFileSync(
    path.resolve("src/lib/orbit/access.ts"),
    "utf8",
  );
  assert.match(accessSource, /orbitScopeDecision/);
  assert.match(accessSource, /authorization\.denied/);
  const transferSource = readFileSync(
    path.resolve("src/lib/orbit/transfer.ts"),
    "utf8",
  );
  const replayLookup = transferSource.indexOf("const [replay] = await db");
  const preflightAfterReplay = transferSource.indexOf(
    "const preflight = await loadPreflight",
    replayLookup,
  );
  assert.ok(replayLookup > 0 && preflightAfterReplay > replayLookup);
});
