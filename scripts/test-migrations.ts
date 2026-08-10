import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { assertUtf8DatabaseEncoding } from "../src/lib/database-encoding";

const databaseName =
  process.env.MIGRATION_TEST_DATABASE ?? "q_academy_migration_test";
if (!/^q_academy_[a-z0-9_]+_test$/.test(databaseName)) {
  throw new Error(
    "MIGRATION_TEST_DATABASE must match q_academy_*_test to protect non-test databases.",
  );
}

const adminUrl =
  process.env.POSTGRES_ADMIN_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/postgres";
const testUrl = new URL(adminUrl);
testUrl.pathname = `/${databaseName}`;
const freshDatabaseName = databaseName.replace(/_test$/, "_fresh_test");
if (freshDatabaseName.length > 63) {
  throw new Error("Fresh migration test database name exceeds 63 characters.");
}
const freshTestUrl = new URL(adminUrl);
freshTestUrl.pathname = `/${freshDatabaseName}`;
const admin = postgres(adminUrl, { max: 1 });
const expectedMigrationCount = readdirSync(
  new URL("../drizzle", import.meta.url),
).filter((fileName) => /^\d+_.+\.sql$/.test(fileName)).length;
let testClient: ReturnType<typeof postgres> | null = null;
let freshTestClient: ReturnType<typeof postgres> | null = null;
const concurrentClients: ReturnType<typeof postgres>[] = [];
const stagedMigrationFolder = mkdtempSync(
  path.join(tmpdir(), "q-academy-migrations-"),
);

function databaseErrorCode(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error
    ? error.code
    : null;
}

async function withTimeout<T>(
  operation: Promise<T>,
  milliseconds: number,
  label: string,
) {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`${label} exceeded ${milliseconds}ms.`)),
          milliseconds,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function expectOneConstraintRejection(
  results: PromiseSettledResult<unknown>[],
  label: string,
) {
  const fulfilled = results.filter((result) => result.status === "fulfilled");
  const rejected = results.filter((result) => result.status === "rejected");
  if (
    fulfilled.length !== 1 ||
    rejected.length !== 1 ||
    databaseErrorCode(rejected[0].reason) !== "23514"
  ) {
    throw new Error(`${label} did not serialize to one constraint rejection.`);
  }
}

async function expectConstraintViolation(
  operation: () => Promise<unknown>,
  label: string,
) {
  return expectDatabaseError(operation, ["23514"], label);
}

async function expectDatabaseError(
  operation: () => Promise<unknown>,
  expectedCodes: string[],
  label: string,
) {
  try {
    await operation();
  } catch (error) {
    const code = databaseErrorCode(error);
    if (typeof code === "string" && expectedCodes.includes(code)) return;
    throw error;
  }
  throw new Error(`${label} unexpectedly passed its database constraint.`);
}

try {
  await admin.unsafe(`drop database if exists "${databaseName}" with (force)`);
  await admin.unsafe(
    `create database "${databaseName}" with template template0 encoding 'UTF8' lc_collate 'C' lc_ctype 'C'`,
  );
  testClient = postgres(testUrl.toString(), { max: 1 });
  const [database] = await testClient<[{ encoding: string }]>`
    select current_setting('server_encoding') as encoding
  `;
  assertUtf8DatabaseEncoding(database.encoding);
  await testClient.begin(async (tx) => {
    await tx`create temporary table utf8_migration_probe (value text not null) on commit drop`;
    await tx`insert into utf8_migration_probe (value) values ('Migration: äöü € 😀')`;
    const [probe] = await tx<[{ value: string }]>`
      select value from utf8_migration_probe
    `;
    if (probe.value !== "Migration: äöü € 😀") {
      throw new Error("Migration database failed the UTF-8 round-trip probe.");
    }
  });
  const migrationFolder = fileURLToPath(
    new URL("../drizzle/", import.meta.url),
  );
  const journal = JSON.parse(
    readFileSync(path.join(migrationFolder, "meta", "_journal.json"), "utf8"),
  ) as { entries: Array<{ idx: number; tag: string }> };
  const legacyJournal = {
    ...journal,
    entries: journal.entries.filter((entry) => entry.idx < 40),
  };
  mkdirSync(path.join(stagedMigrationFolder, "meta"), { recursive: true });
  writeFileSync(
    path.join(stagedMigrationFolder, "meta", "_journal.json"),
    JSON.stringify(legacyJournal),
  );
  for (const entry of legacyJournal.entries) {
    copyFileSync(
      path.join(migrationFolder, `${entry.tag}.sql`),
      path.join(stagedMigrationFolder, `${entry.tag}.sql`),
    );
  }
  await migrate(drizzle(testClient), {
    migrationsFolder: stagedMigrationFolder,
  });

  const [legacyOrganization] = await testClient<[{ id: string }]>`
    insert into organizations (name, slug)
    values ('Legacy exam upgrade', 'legacy-exam-upgrade')
    returning id
  `;
  const [legacyUser] = await testClient<[{ id: string }]>`
    insert into users (
      organization_id, email, password_hash, first_name, last_name
    ) values (
      ${legacyOrganization.id}, 'legacy-exam@example.test', 'not-a-secret',
      'Legacy', 'Learner'
    )
    returning id
  `;
  const [legacyCourse] = await testClient<[{ id: string }]>`
    insert into courses (
      organization_id, title, slug, short_description, description
    ) values (
      ${legacyOrganization.id}, 'Legacy course', 'legacy-course',
      'Legacy course', 'Legacy course'
    )
    returning id
  `;
  const [legacyModule] = await testClient<[{ id: string }]>`
    insert into modules (organization_id, title, kind)
    values (${legacyOrganization.id}, 'Legacy quiz module', 'learning')
    returning id
  `;
  const [legacyLesson] = await testClient<[{ id: string }]>`
    insert into lessons (organization_id, module_id, title, slug, type)
    values (
      ${legacyOrganization.id}, ${legacyModule.id}, 'Legacy quiz',
      'legacy-quiz', 'quiz'
    )
    returning id
  `;
  const legacyAttempts = await testClient<Array<{ id: string }>>`
    insert into assessment_attempts (
      organization_id, user_id, course_id, lesson_id, attempt_number,
      status, question_count, assessment_snapshot
    ) values
      (
        ${legacyOrganization.id}, ${legacyUser.id}, ${legacyCourse.id},
        ${legacyLesson.id}, 1, 'in_progress', 1, '{}'::jsonb
      ),
      (
        ${legacyOrganization.id}, ${legacyUser.id}, ${legacyCourse.id},
        ${legacyLesson.id}, 2, 'submitted', 1, '{}'::jsonb
      )
    returning id
  `;

  const preModerationJournal = {
    ...journal,
    entries: journal.entries.filter((entry) => entry.idx < 48),
  };
  writeFileSync(
    path.join(stagedMigrationFolder, "meta", "_journal.json"),
    JSON.stringify(preModerationJournal),
  );
  for (const entry of preModerationJournal.entries) {
    copyFileSync(
      path.join(migrationFolder, `${entry.tag}.sql`),
      path.join(stagedMigrationFolder, `${entry.tag}.sql`),
    );
  }
  await migrate(drizzle(testClient), {
    migrationsFolder: stagedMigrationFolder,
  });

  const [legacyCommunityOrganization] = await testClient<[{ id: string }]>`
    insert into organizations (name, slug)
    values ('Legacy community upgrade', 'legacy-community-upgrade')
    returning id
  `;
  const [legacyCommunityAuthor] = await testClient<[{ id: string }]>`
    insert into users (
      organization_id, email, password_hash, first_name, last_name, points
    ) values (
      ${legacyCommunityOrganization.id}, 'legacy-community-author@example.test',
      'not-a-secret', 'Legacy', 'Author', -7
    ) returning id
  `;
  const [legacyCommunityReporter] = await testClient<[{ id: string }]>`
    insert into users (
      organization_id, email, password_hash, first_name, last_name
    ) values (
      ${legacyCommunityOrganization.id}, 'legacy-community-reporter@example.test',
      'not-a-secret', 'Legacy', 'Reporter'
    ) returning id
  `;
  const [legacyCommunityReviewer] = await testClient<[{ id: string }]>`
    insert into users (
      organization_id, email, password_hash, first_name, last_name, role
    ) values (
      ${legacyCommunityOrganization.id}, 'legacy-community-reviewer@example.test',
      'not-a-secret', 'Legacy', 'Reviewer', 'admin'
    ) returning id
  `;
  const [legacyCommunitySpace] = await testClient<[{ id: string }]>`
    insert into community_spaces (organization_id, title, slug)
    values (
      ${legacyCommunityOrganization.id}, 'Legacy community', 'legacy-community'
    ) returning id
  `;
  const [legacyCommunityPost] = await testClient<
    [{ id: string; createdAt: Date }]
  >`
    insert into posts (
      organization_id, space_id, author_id, title, content, created_at,
      updated_at
    ) values (
      ${legacyCommunityOrganization.id}, ${legacyCommunitySpace.id},
      ${legacyCommunityAuthor.id}, 'Legacy post', 'Legacy post body',
      '2025-01-02T03:04:05.000Z', '2025-01-02T03:04:05.000Z'
    ) returning id, created_at as "createdAt"
  `;
  const [legacyCommunityComment] = await testClient<
    [{ id: string; createdAt: Date }]
  >`
    insert into comments (
      organization_id, post_id, author_id, content, created_at, updated_at
    ) values (
      ${legacyCommunityOrganization.id}, ${legacyCommunityPost.id},
      ${legacyCommunityAuthor.id}, 'Legacy comment',
      '2025-01-03T03:04:05.000Z', '2025-01-03T03:04:05.000Z'
    ) returning id, created_at as "createdAt"
  `;
  await testClient`
    insert into community_reports (
      organization_id, reporter_id, target_type, target_id, target_author_id,
      content_excerpt, reason, status, created_at, updated_at
    ) values (
      ${legacyCommunityOrganization.id}, ${legacyCommunityReporter.id},
      'post', ${legacyCommunityPost.id}, ${legacyCommunityAuthor.id},
      'Legacy post body', 'spam', 'open',
      '2025-01-04T03:04:05.000Z', '2025-01-04T03:04:05.000Z'
    )
  `;
  await testClient`
    insert into community_reports (
      organization_id, reporter_id, target_type, target_id, target_author_id,
      content_excerpt, reason, status, handled_by_id, outcome,
      resolution_note, resolved_at, created_at, updated_at
    ) values (
      ${legacyCommunityOrganization.id}, ${legacyCommunityReviewer.id},
      'post', ${legacyCommunityPost.id}, ${legacyCommunityAuthor.id},
      'Legacy post body', 'privacy', 'resolved',
      ${legacyCommunityReviewer.id}, 'content_removed', 'Legacy resolution',
      '2025-01-06T03:04:05.000Z', '2025-01-05T03:04:05.000Z',
      '2025-01-06T03:04:05.000Z'
    )
  `;
  await testClient`
    insert into community_reports (
      organization_id, reporter_id, target_type, target_id, target_author_id,
      content_excerpt, reason, status, handled_by_id, outcome,
      resolution_note, resolved_at, created_at, updated_at
    ) values (
      ${legacyCommunityOrganization.id}, ${legacyCommunityReporter.id},
      'comment', ${legacyCommunityComment.id}, ${legacyCommunityAuthor.id},
      'Legacy comment', 'other', 'dismissed',
      ${legacyCommunityReviewer.id}, 'dismissed', 'Legacy dismissal',
      '2025-01-07T03:04:05.000Z', '2025-01-06T03:04:05.000Z',
      '2025-01-07T03:04:05.000Z'
    )
  `;

  const preScoringJournal = {
    ...journal,
    entries: journal.entries.filter((entry) => entry.idx < 49),
  };
  writeFileSync(
    path.join(stagedMigrationFolder, "meta", "_journal.json"),
    JSON.stringify(preScoringJournal),
  );
  for (const entry of preScoringJournal.entries) {
    copyFileSync(
      path.join(migrationFolder, `${entry.tag}.sql`),
      path.join(stagedMigrationFolder, `${entry.tag}.sql`),
    );
  }
  await migrate(drizzle(testClient), {
    migrationsFolder: stagedMigrationFolder,
  });

  const [guardedLegacyLevelSettings] = await testClient<
    [{ enabled: boolean; revision: number }]
  >`
    select enabled, revision
    from community_level_settings
    where organization_id = ${legacyCommunityOrganization.id}
  `;
  if (
    guardedLegacyLevelSettings.enabled ||
    guardedLegacyLevelSettings.revision !== 1
  ) {
    throw new Error(
      "Migration 0048 did not keep community levels disabled before score backfill.",
    );
  }

  await testClient`
    insert into post_likes (organization_id, post_id, user_id, reaction)
    values
      (
        ${legacyCommunityOrganization.id}, ${legacyCommunityPost.id},
        ${legacyCommunityReporter.id}, 'celebrate'
      ),
      (
        ${legacyCommunityOrganization.id}, ${legacyCommunityPost.id},
        ${legacyCommunityAuthor.id}, 'like'
      )
  `;
  const [legacyReporterComment] = await testClient<[{ id: string }]>`
    insert into comments (
      organization_id, post_id, author_id, content, created_at, updated_at
    ) values (
      ${legacyCommunityOrganization.id}, ${legacyCommunityPost.id},
      ${legacyCommunityReporter.id}, 'A scored top-level comment',
      '2025-01-08T03:04:05.000Z', '2025-01-08T03:04:05.000Z'
    ) returning id
  `;
  await testClient`
    insert into comments (
      organization_id, post_id, author_id, parent_id, content, created_at,
      updated_at
    ) values (
      ${legacyCommunityOrganization.id}, ${legacyCommunityPost.id},
      ${legacyCommunityAuthor.id}, ${legacyReporterComment.id},
      'A scored reply', '2025-01-09T03:04:05.000Z',
      '2025-01-09T03:04:05.000Z'
    )
  `;
  const [legacyHeldPost] = await testClient<[{ id: string }]>`
    insert into posts (
      organization_id, space_id, author_id, title, content, moderation_state,
      published_at
    ) values (
      ${legacyCommunityOrganization.id}, ${legacyCommunitySpace.id},
      ${legacyCommunityAuthor.id}, 'Held legacy post', 'Not score eligible',
      'held', null
    ) returning id
  `;
  await testClient`
    insert into post_likes (organization_id, post_id, user_id, reaction)
    values (
      ${legacyCommunityOrganization.id}, ${legacyHeldPost.id},
      ${legacyCommunityReporter.id}, 'insightful'
    )
  `;
  await testClient`
    insert into comments (
      organization_id, post_id, author_id, content
    ) values (
      ${legacyCommunityOrganization.id}, ${legacyHeldPost.id},
      ${legacyCommunityReporter.id}, 'Comment on held post'
    )
  `;

  const preParityJournal = {
    ...journal,
    // The fixtures below intentionally exercise the 0056 data backfills.
    entries: journal.entries.filter((entry) => entry.idx < 56),
  };
  writeFileSync(
    path.join(stagedMigrationFolder, "meta", "_journal.json"),
    JSON.stringify(preParityJournal),
  );
  for (const entry of preParityJournal.entries) {
    copyFileSync(
      path.join(migrationFolder, `${entry.tag}.sql`),
      path.join(stagedMigrationFolder, `${entry.tag}.sql`),
    );
  }
  await migrate(drizzle(testClient), {
    migrationsFolder: stagedMigrationFolder,
  });

  const [legacyLearningOrganization] = await testClient<[{ id: string }]>`
    insert into organizations (name, slug)
    values ('Legacy learning time', 'legacy-learning-time')
    returning id
  `;
  const [legacyLearningUser] = await testClient<[{ id: string }]>`
    insert into users (
      organization_id, email, password_hash, first_name, last_name
    ) values (
      ${legacyLearningOrganization.id}, 'legacy-learning-time@example.test',
      'not-a-secret', 'Legacy', 'Learning Time'
    ) returning id
  `;
  const [legacyLearningCourse] = await testClient<[{ id: string }]>`
    insert into courses (
      organization_id, title, slug, short_description, description,
      status
    ) values (
      ${legacyLearningOrganization.id}, 'Legacy measured course',
      'legacy-measured-course', 'Legacy measured course',
      'Legacy measured course', 'published'
    ) returning id
  `;
  const [legacyLearningModule] = await testClient<[{ id: string }]>`
    insert into modules (organization_id, title, kind)
    values (
      ${legacyLearningOrganization.id}, 'Legacy measured module', 'learning'
    ) returning id
  `;
  const [legacyLearningLesson] = await testClient<[{ id: string }]>`
    insert into lessons (
      organization_id, module_id, title, slug, status, visibility
    ) values (
      ${legacyLearningOrganization.id}, ${legacyLearningModule.id},
      'Legacy snapshot lesson', 'legacy-snapshot-lesson', 'published',
      'visible'
    ) returning id
  `;
  const [legacyLearningVersion] = await testClient<[{ id: string }]>`
    insert into course_versions (
      organization_id, course_id, version, snapshot, published_at
    ) values (
      ${legacyLearningOrganization.id}, ${legacyLearningCourse.id}, 1,
      jsonb_build_object(
        'modules', jsonb_build_array(
          jsonb_build_object(
            'lessons', jsonb_build_array(
              jsonb_build_object(
                'id', ${legacyLearningLesson.id}::text,
                'title', 'Legacy snapshot lesson'
              )
            ),
            'sections', '[]'::jsonb
          )
        )
      ),
      '2025-02-01T10:00:00.000Z'
    ) returning id
  `;
  await testClient`
    update courses
    set published_version_id = ${legacyLearningVersion.id},
        first_published_at = '2025-02-01T10:00:00.000Z'
    where id = ${legacyLearningCourse.id}
  `;
  const [legacyLearningSession] = await testClient<[{ id: string }]>`
    insert into lesson_learning_time_sessions (
      id, organization_id, user_id, course_id, lesson_id, last_sequence,
      active_seconds, started_at, last_heartbeat_at, updated_at
    ) values (
      gen_random_uuid(), ${legacyLearningOrganization.id}, ${legacyLearningUser.id},
      ${legacyLearningCourse.id}, ${legacyLearningLesson.id}, 2, 30,
      '2025-02-01T10:00:00.000Z', '2025-02-01T10:00:30.000Z',
      '2025-02-01T10:00:30.000Z'
    ) returning id
  `;
  const [legacyAnnouncement] = await testClient<[{ id: string }]>`
    insert into announcements (
      organization_id, title, body, placement, audience, starts_at
    ) values (
      ${legacyLearningOrganization.id}, 'Legacy announcement',
      'Legacy dismissal must become an interaction.', 'banner', 'all',
      '2025-02-01T10:00:00.000Z'
    ) returning id
  `;
  await testClient`
    insert into announcement_dismissals (
      announcement_id, user_id, dismissed_at
    ) values (
      ${legacyAnnouncement.id}, ${legacyLearningUser.id},
      '2025-02-01T10:01:00.000Z'
    )
  `;
  const [legacyPushSession] = await testClient<[{ id: string }]>`
    insert into user_sessions (
      organization_id, user_id, jti_hash, expires_at
    ) values (
      ${legacyLearningOrganization.id}, ${legacyLearningUser.id},
      ${"a".repeat(64)}, '2030-02-01T10:00:00.000Z'
    ) returning id
  `;
  const [legacyPushSubscription] = await testClient<[{ id: string }]>`
    insert into web_push_subscriptions (
      organization_id, user_id, endpoint_hash, subscription_encrypted
    ) values (
      ${legacyLearningOrganization.id}, ${legacyLearningUser.id},
      ${"b".repeat(64)},
      jsonb_build_object(
        'v', 2, 'alg', 'A256GCM', 'kid', 'legacy-key', 'iv', 'legacy-iv',
        'tag', 'legacy-tag', 'ciphertext', 'legacy-ciphertext'
      )
    ) returning id
  `;
  const [legacyPushNotification] = await testClient<[{ id: string }]>`
    insert into notifications (user_id, title, body, created_at)
    values (
      ${legacyLearningUser.id}, 'Legacy push', 'Re-subscribe after upgrade.',
      '2025-02-01T10:02:00.000Z'
    ) returning id
  `;
  await testClient`
    insert into push_notification_deliveries (
      organization_id, user_id, notification_id, subscription_id
    ) values (
      ${legacyLearningOrganization.id}, ${legacyLearningUser.id},
      ${legacyPushNotification.id}, ${legacyPushSubscription.id}
    )
  `;

  const legacyInvalidPrivacyCreatedAt = "2025-02-01T11:00:00.000Z";
  const [legacyInvalidPrivacyRequest] = await testClient<[{ id: string }]>`
    insert into privacy_requests (
      organization_id, subject_user_id, subject_reference, client_request_id,
      type, status, due_at, identity_verified_at, approved_at,
      processing_started_at, created_at, updated_at
    ) values (
      ${legacyLearningOrganization.id}, ${legacyLearningUser.id},
      ${"c".repeat(64)}, 'legacy-incomplete-processing-claim',
      'access_export', 'processing', '2025-03-01T11:00:00.000Z',
      '2025-02-01T11:01:00.000Z', '2025-02-01T11:02:00.000Z',
      '2025-02-01T11:03:00.000Z', ${legacyInvalidPrivacyCreatedAt}::timestamptz,
      ${legacyInvalidPrivacyCreatedAt}::timestamptz
    ) returning id
  `;
  const [legacyInvalidPrivacyArtifact] = await testClient<[{ id: string }]>`
    insert into privacy_export_artifacts (
      organization_id, request_id, status, format, storage_driver,
      storage_key, safe_file_name, content_type, expires_at, created_at,
      updated_at
    ) values (
      ${legacyLearningOrganization.id}, ${legacyInvalidPrivacyRequest.id},
      'building', 'zip', 'filesystem',
      ${`tenants/${legacyLearningOrganization.id}/privacy-exports/${legacyInvalidPrivacyRequest.id}/legacy.enc`},
      'privacy-export-migration.zip', 'application/zip',
      '2025-02-08T11:00:00.000Z', ${legacyInvalidPrivacyCreatedAt}::timestamptz,
      ${legacyInvalidPrivacyCreatedAt}::timestamptz
    ) returning id
  `;

  const preIntercomIdentityJournal = {
    ...journal,
    entries: journal.entries.filter((entry) => entry.idx < 73),
  };
  writeFileSync(
    path.join(stagedMigrationFolder, "meta", "_journal.json"),
    JSON.stringify(preIntercomIdentityJournal),
  );
  for (const entry of preIntercomIdentityJournal.entries) {
    copyFileSync(
      path.join(migrationFolder, `${entry.tag}.sql`),
      path.join(stagedMigrationFolder, `${entry.tag}.sql`),
    );
  }
  await migrate(drizzle(testClient), {
    migrationsFolder: stagedMigrationFolder,
  });
  await testClient`
    insert into organization_support_settings (
      organization_id, enabled, provider, launcher_label, intercom_app_id,
      identity_secret_encrypted
    ) values (
      ${legacyLearningOrganization.id}, true, 'intercom', 'Legacy support',
      'legacy-app', null
    )
  `;

  await migrate(drizzle(testClient), { migrationsFolder: "drizzle" });

  const [normalizedIntercomSupport] = await testClient<
    [{ enabled: boolean; identitySecretEncrypted: string | null }]
  >`
    select enabled,
           identity_secret_encrypted as "identitySecretEncrypted"
    from organization_support_settings
    where organization_id = ${legacyLearningOrganization.id}
  `;
  if (
    normalizedIntercomSupport.enabled ||
    normalizedIntercomSupport.identitySecretEncrypted !== null
  ) {
    throw new Error(
      "Migration 0073 did not disable an active Intercom channel without an identity secret.",
    );
  }

  const [normalizedPrivacyClaim] = await testClient<
    [
      {
        status: string;
        statusReason: string | null;
        processingClaimToken: string | null;
        processingClaimedAt: Date | null;
        processingLeaseExpiresAt: Date | null;
        updatedAt: string;
        artifactStatus: string;
        artifactFailureCode: string | null;
        artifactUpdatedAt: string;
      },
    ]
  >`
    select
      request.status,
      request.status_reason as "statusReason",
      request.processing_claim_token as "processingClaimToken",
      request.processing_claimed_at as "processingClaimedAt",
      request.processing_lease_expires_at as "processingLeaseExpiresAt",
      request.updated_at as "updatedAt",
      artifact.status as "artifactStatus",
      artifact.failure_code as "artifactFailureCode",
      artifact.updated_at as "artifactUpdatedAt"
    from privacy_requests request
    join privacy_export_artifacts artifact
      on artifact.request_id = request.id
     and artifact.organization_id = request.organization_id
    where request.id = ${legacyInvalidPrivacyRequest.id}
      and artifact.id = ${legacyInvalidPrivacyArtifact.id}
  `;
  if (
    normalizedPrivacyClaim.status !== "failed" ||
    normalizedPrivacyClaim.statusReason !==
      "processing_claim_invariant_migration" ||
    normalizedPrivacyClaim.processingClaimToken !== null ||
    normalizedPrivacyClaim.processingClaimedAt !== null ||
    normalizedPrivacyClaim.processingLeaseExpiresAt !== null ||
    normalizedPrivacyClaim.artifactStatus !== "failed" ||
    normalizedPrivacyClaim.artifactFailureCode !==
      "processing_claim_invariant_migration" ||
    new Date(normalizedPrivacyClaim.updatedAt).getTime() <=
      new Date(legacyInvalidPrivacyCreatedAt).getTime() ||
    new Date(normalizedPrivacyClaim.artifactUpdatedAt).getTime() <=
      new Date(legacyInvalidPrivacyCreatedAt).getTime()
  ) {
    throw new Error(
      "Migration 0069 did not normalize an incomplete privacy processing claim.",
    );
  }

  const privacyConstraintCreatedAt = "2026-07-14T04:00:00.000Z";
  const privacyConstraintClaimedAt = "2026-07-14T04:03:00.000Z";
  const privacyConstraintLeaseExpiresAt = "2026-07-14T04:18:00.000Z";
  await expectConstraintViolation(
    () =>
      testClient!`
        insert into privacy_requests (
          organization_id, subject_reference, client_request_id, type, status,
          due_at, identity_verified_at, approved_at, processing_started_at,
          created_at, updated_at
        ) values (
          ${legacyLearningOrganization.id}, ${"d".repeat(64)},
          'invalid-processing-without-claim', 'access_export', 'processing',
          '2026-08-13T04:00:00.000Z', '2026-07-14T04:01:00.000Z',
          '2026-07-14T04:02:00.000Z', ${privacyConstraintClaimedAt}::timestamptz,
          ${privacyConstraintCreatedAt}::timestamptz,
          ${privacyConstraintCreatedAt}::timestamptz
        )
      `,
    "Privacy processing status without a complete claim",
  );
  await expectConstraintViolation(
    () =>
      testClient!`
        insert into privacy_requests (
          organization_id, subject_reference, client_request_id, type, status,
          due_at, identity_verified_at, approved_at, processing_claim_token,
          processing_claimed_at, processing_lease_expires_at, created_at,
          updated_at
        ) values (
          ${legacyLearningOrganization.id}, ${"e".repeat(64)},
          'invalid-approved-with-claim', 'access_export', 'approved',
          '2026-08-13T04:00:00.000Z', '2026-07-14T04:01:00.000Z',
          '2026-07-14T04:02:00.000Z', gen_random_uuid(),
          ${privacyConstraintClaimedAt}::timestamptz,
          ${privacyConstraintLeaseExpiresAt}::timestamptz,
          ${privacyConstraintCreatedAt}::timestamptz,
          ${privacyConstraintCreatedAt}::timestamptz
        )
      `,
    "Non-processing privacy status with claim fields",
  );
  const [validProcessingClaim] = await testClient<[{ id: string }]>`
    insert into privacy_requests (
      organization_id, subject_reference, client_request_id, type, status,
      due_at, identity_verified_at, approved_at, processing_started_at,
      processing_claim_token, processing_claimed_at,
      processing_lease_expires_at, created_at, updated_at
    ) values (
      ${legacyLearningOrganization.id}, ${"f".repeat(64)},
      'valid-processing-claim', 'access_export', 'processing',
      '2026-08-13T04:00:00.000Z', '2026-07-14T04:01:00.000Z',
      '2026-07-14T04:02:00.000Z', ${privacyConstraintClaimedAt}::timestamptz,
      gen_random_uuid(), ${privacyConstraintClaimedAt}::timestamptz,
      ${privacyConstraintLeaseExpiresAt}::timestamptz,
      ${privacyConstraintCreatedAt}::timestamptz,
      ${privacyConstraintCreatedAt}::timestamptz
    ) returning id
  `;
  await expectConstraintViolation(
    () =>
      testClient!`
        update privacy_requests
        set status = 'failed', status_reason = 'invalid_transition'
        where id = ${validProcessingClaim.id}
      `,
    "Privacy processing transition retaining claim fields",
  );
  await expectConstraintViolation(
    () =>
      testClient!`
        update privacy_requests
        set processing_lease_expires_at = processing_claimed_at
        where id = ${validProcessingClaim.id}
      `,
    "Privacy processing claim with a non-positive lease",
  );
  await testClient`
    update privacy_requests
    set status = 'failed', status_reason = 'constraint_test_complete',
        processing_claim_token = null, processing_claimed_at = null,
        processing_lease_expires_at = null
    where id = ${validProcessingClaim.id}
  `;

  const [upgradedLearningSession] = await testClient<
    [{ courseVersionId: string; lessonTitle: string }]
  >`
    select course_version_id as "courseVersionId",
           lesson_title as "lessonTitle"
    from lesson_learning_time_sessions
    where id = ${legacyLearningSession.id}
  `;
  if (
    upgradedLearningSession.courseVersionId !== legacyLearningVersion.id ||
    upgradedLearningSession.lessonTitle !== "Legacy snapshot lesson"
  ) {
    throw new Error(
      "Migration 0056 did not bind legacy learning time to its published snapshot.",
    );
  }
  await testClient`
    delete from lessons
    where id = ${legacyLearningLesson.id}
      and organization_id = ${legacyLearningOrganization.id}
  `;
  const [durableLearningSession] = await testClient<[{ count: number }]>`
    select count(*)::int as count
    from lesson_learning_time_sessions
    where id = ${legacyLearningSession.id}
      and course_version_id = ${legacyLearningVersion.id}
      and lesson_title = 'Legacy snapshot lesson'
  `;
  if (durableLearningSession.count !== 1) {
    throw new Error(
      "Migrated learning time was lost with its mutable live lesson.",
    );
  }
  const [upgradedAnnouncement] = await testClient<
    [
      {
        ruleVersion: number;
        conjunction: string;
        conditionCount: number;
        dismissInteractions: number;
      },
    ]
  >`
    select
      (a.target_rule_set ->> 'version')::int as "ruleVersion",
      a.target_rule_set ->> 'conjunction' as conjunction,
      jsonb_array_length(a.target_rule_set -> 'conditions') as "conditionCount",
      (
        select count(*)::int
        from announcement_interactions interaction
        where interaction.announcement_id = a.id
          and interaction.user_id = ${legacyLearningUser.id}
          and interaction.organization_id = ${legacyLearningOrganization.id}
          and interaction.kind = 'dismiss'
          and interaction.occurred_at = '2025-02-01T10:01:00.000Z'
      ) as "dismissInteractions"
    from announcements a
    where a.id = ${legacyAnnouncement.id}
  `;
  if (
    upgradedAnnouncement.ruleVersion !== 1 ||
    upgradedAnnouncement.conjunction !== "and" ||
    upgradedAnnouncement.conditionCount !== 0 ||
    upgradedAnnouncement.dismissInteractions !== 1
  ) {
    throw new Error(
      "Migration 0056 did not backfill announcement rules and dismissals.",
    );
  }
  const [revokedLegacyPush] = await testClient<
    [{ subscriptions: number; deliveries: number }]
  >`
    select
      (
        select count(*)::int from web_push_subscriptions
        where id = ${legacyPushSubscription.id}
      ) as subscriptions,
      (
        select count(*)::int from push_notification_deliveries
        where subscription_id = ${legacyPushSubscription.id}
      ) as deliveries
  `;
  if (
    revokedLegacyPush.subscriptions !== 0 ||
    revokedLegacyPush.deliveries !== 0
  ) {
    throw new Error(
      "Migration 0056 retained a capability that cannot be rebound securely.",
    );
  }
  const [sessionBoundPush] = await testClient<[{ id: string }]>`
    insert into web_push_subscriptions (
      organization_id, user_id, session_id, endpoint_hash,
      subscription_encrypted
    ) values (
      ${legacyLearningOrganization.id}, ${legacyLearningUser.id},
      ${legacyPushSession.id}, ${"c".repeat(64)},
      jsonb_build_object(
        'v', 2, 'alg', 'A256GCM', 'kid', 'current-key', 'iv', 'current-iv',
        'tag', 'current-tag', 'ciphertext', 'current-ciphertext'
      )
    ) returning id
  `;
  await testClient`
    update user_sessions set revoked_at = now()
    where id = ${legacyPushSession.id}
  `;
  const [purgedSessionBoundPush] = await testClient<[{ count: number }]>`
    select count(*)::int as count from web_push_subscriptions
    where id = ${sessionBoundPush.id}
  `;
  if (purgedSessionBoundPush.count !== 0) {
    throw new Error(
      "Migration 0056 did not purge push capability on session revocation.",
    );
  }

  const upgradedLegacyAttempts = await testClient<
    Array<{
      id: string;
      status: string;
      finalizationReason: string | null;
      resultReleasedAt: Date | null;
      reviewReleasedAt: Date | null;
    }>
  >`
    select id, status, finalization_reason as "finalizationReason",
           result_released_at as "resultReleasedAt",
           review_released_at as "reviewReleasedAt"
    from assessment_attempts
    where id in ${testClient(legacyAttempts.map((attempt) => attempt.id))}
    order by id
  `;
  if (
    upgradedLegacyAttempts.length !== 2 ||
    upgradedLegacyAttempts.some(
      (attempt) =>
        attempt.status !== "graded" ||
        attempt.finalizationReason !== "administrator" ||
        !attempt.resultReleasedAt ||
        !attempt.reviewReleasedAt,
    )
  ) {
    throw new Error(
      "Migration 0040 did not safely finalize legacy active attempts.",
    );
  }

  const [upgradedLegacyPost] = await testClient<
    [
      {
        moderationState: string;
        publishedAt: string | null;
        publicationPreserved: boolean;
      },
    ]
  >`
    select moderation_state as "moderationState",
           published_at as "publishedAt",
           published_at = created_at as "publicationPreserved"
    from posts where id = ${legacyCommunityPost.id}
  `;
  const [upgradedLegacyComment] = await testClient<
    [
      {
        moderationState: string;
        publishedAt: string | null;
        publicationPreserved: boolean;
      },
    ]
  >`
    select moderation_state as "moderationState",
           published_at as "publishedAt",
           published_at = created_at as "publicationPreserved"
    from comments where id = ${legacyCommunityComment.id}
  `;
  if (
    upgradedLegacyPost.moderationState !== "published" ||
    !upgradedLegacyPost.publishedAt ||
    !upgradedLegacyPost.publicationPreserved ||
    upgradedLegacyComment.moderationState !== "published" ||
    !upgradedLegacyComment.publishedAt ||
    !upgradedLegacyComment.publicationPreserved
  ) {
    throw new Error(
      "Migration 0048 did not preserve legacy community publication visibility.",
    );
  }

  const [normalizedLegacyCommunityAuthor] = await testClient<
    [{ points: number; communityPoints: number }]
  >`
    select points, community_points as "communityPoints"
    from users where id = ${legacyCommunityAuthor.id}
  `;
  if (
    normalizedLegacyCommunityAuthor.points !== 0 ||
    normalizedLegacyCommunityAuthor.communityPoints !== 3
  ) {
    throw new Error(
      "Community upgrade did not normalize learning points and backfill community points independently.",
    );
  }

  const legacyCommunityScores = await testClient<
    Array<{ id: string; communityPoints: number }>
  >`
    select id, community_points as "communityPoints"
    from users
    where id in (
      ${legacyCommunityReporter.id}, ${legacyCommunityReviewer.id}
    )
    order by id
  `;
  const legacyReporterScore = legacyCommunityScores.find(
    (user) => user.id === legacyCommunityReporter.id,
  );
  const legacyReviewerScore = legacyCommunityScores.find(
    (user) => user.id === legacyCommunityReviewer.id,
  );
  if (
    legacyReporterScore?.communityPoints !== 1 ||
    legacyReviewerScore?.communityPoints !== 0
  ) {
    throw new Error(
      "Migration 0049 did not backfill reply points or exclude unrelated users.",
    );
  }
  const legacyContributionCounts = await testClient<
    Array<{ kind: string; count: number }>
  >`
    select kind, count(*)::int as count
    from community_score_contributions
    where organization_id = ${legacyCommunityOrganization.id}
    group by kind
    order by kind
  `;
  const expectedLegacyContributions = new Map([
    ["comment_reply", 1],
    ["post_comment", 1],
    ["post_reaction", 1],
  ]);
  if (
    legacyContributionCounts.length !== expectedLegacyContributions.size ||
    legacyContributionCounts.some(
      (row) => expectedLegacyContributions.get(row.kind) !== row.count,
    )
  ) {
    throw new Error(
      "Migration 0049 did not backfill the exact eligible contribution set.",
    );
  }

  const [legacyLevelSettings] = await testClient<
    [{ enabled: boolean; revision: number }]
  >`
    select enabled, revision
    from community_level_settings
    where organization_id = ${legacyCommunityOrganization.id}
  `;
  const legacyLevelThresholds = await testClient<Array<{ minPoints: number }>>`
    select min_points as "minPoints"
    from community_levels
    where organization_id = ${legacyCommunityOrganization.id}
    order by position
  `;
  const expectedLegacyLevelThresholds = [
    0, 20, 60, 180, 540, 1620, 4860, 14580, 43740,
  ];
  if (
    !legacyLevelSettings.enabled ||
    legacyLevelSettings.revision !== 2 ||
    legacyLevelThresholds.length !== expectedLegacyLevelThresholds.length ||
    legacyLevelThresholds.some(
      (level, index) =>
        level.minPoints !== expectedLegacyLevelThresholds[index],
    )
  ) {
    throw new Error(
      "Migration 0049 did not enable the guarded level defaults after backfill.",
    );
  }

  const [legacyModerationPolicy] = await testClient<
    [
      {
        postApproval: string;
        commentApproval: string;
        automationMode: string;
        reportThreshold: number | null;
        duplicateWindowMinutes: number;
        linkLimit: number;
        version: number;
      },
    ]
  >`
    select post_approval as "postApproval",
           comment_approval as "commentApproval",
           automation_mode as "automationMode",
           report_threshold as "reportThreshold",
           duplicate_window_minutes as "duplicateWindowMinutes",
           link_limit as "linkLimit", version
    from community_space_moderation_policies
    where organization_id = ${legacyCommunityOrganization.id}
      and space_id = ${legacyCommunitySpace.id}
  `;
  if (
    legacyModerationPolicy.postApproval !== "off" ||
    legacyModerationPolicy.commentApproval !== "off" ||
    legacyModerationPolicy.automationMode !== "off" ||
    legacyModerationPolicy.reportThreshold !== null ||
    legacyModerationPolicy.duplicateWindowMinutes !== 0 ||
    legacyModerationPolicy.linkLimit !== 0 ||
    legacyModerationPolicy.version !== 1
  ) {
    throw new Error(
      "Migration 0048 did not preserve public community policy defaults.",
    );
  }

  const upgradedLegacyCases = await testClient<
    Array<{
      id: string;
      targetType: string;
      status: string;
      resolvedAt: Date | null;
      reportCount: number;
    }>
  >`
    select cases.id, cases.target_type as "targetType", cases.status,
           cases.resolved_at as "resolvedAt", count(reports.id)::int as "reportCount"
    from community_moderation_cases cases
    inner join community_reports reports
      on reports.organization_id = cases.organization_id
      and reports.case_id = cases.id
    where cases.organization_id = ${legacyCommunityOrganization.id}
    group by cases.id
    order by cases.target_type
  `;
  const legacyCommentCase = upgradedLegacyCases.find(
    (moderationCase) => moderationCase.targetType === "comment",
  );
  const legacyPostCase = upgradedLegacyCases.find(
    (moderationCase) => moderationCase.targetType === "post",
  );
  if (
    upgradedLegacyCases.length !== 2 ||
    !legacyPostCase ||
    legacyPostCase.status !== "open" ||
    legacyPostCase.resolvedAt !== null ||
    legacyPostCase.reportCount !== 2 ||
    !legacyCommentCase ||
    legacyCommentCase.status !== "resolved" ||
    !legacyCommentCase.resolvedAt ||
    legacyCommentCase.reportCount !== 1
  ) {
    throw new Error(
      "Migration 0048 did not consolidate legacy reports into valid cases.",
    );
  }
  const [legacyModerationEventCount] = await testClient<[{ count: number }]>`
    select count(*)::int as count
    from community_moderation_events
    where organization_id = ${legacyCommunityOrganization.id}
  `;
  if (legacyModerationEventCount.count !== 2) {
    throw new Error("Migration 0048 did not create case audit events.");
  }

  const [tables] = await testClient<[{ count: number }]>`
    select count(table_name)::int as count
    from information_schema.tables
    where table_schema = 'public'
  `;
  const [migrations] = await testClient<[{ count: number }]>`
    select count(hash)::int as count from drizzle.__drizzle_migrations
  `;
  if (tables.count < 58 || migrations.count !== expectedMigrationCount) {
    throw new Error(
      `Unexpected migration result: ${tables.count} tables, ${migrations.count} migrations.`,
    );
  }

  const [organization] = await testClient<[{ id: string }]>`
    insert into organizations (name, slug)
    values ('Migration Exam Guard', 'migration-exam-guard')
    returning id
  `;
  const [durationAssetIdentity] = await testClient<[{ id: string }]>`
    select gen_random_uuid() as id
  `;
  await testClient`
    insert into media_assets (
      id, organization_id, purpose, kind, status, storage_driver,
      storage_key, staging_storage_key, original_file_name, safe_file_name,
      declared_mime_type, detected_mime_type, declared_size_bytes,
      actual_size_bytes, duration_milliseconds, quota_bytes, upload_expires_at,
      uploaded_at, scan_completed_at
    ) values (
      ${durationAssetIdentity.id}, ${organization.id}, 'submission', 'audio',
      'ready', 'filesystem',
      ${`tenants/${organization.id}/assets/${durationAssetIdentity.id}/ready.mp4`},
      ${`incoming/tenants/${organization.id}/assets/${durationAssetIdentity.id}/incoming.mp4`},
      'duration.mp4', 'duration.mp4', 'audio/mp4', 'audio/mp4',
      1024, 1024, 1000, 1024, now() + interval '1 hour', now(), now()
    )
  `;
  await expectDatabaseError(
    () =>
      testClient!`
        update media_assets
        set duration_milliseconds = 1001
        where id = ${durationAssetIdentity.id}
      `,
    ["55000"],
    "ready media duration immutability",
  );
  const [pendingDurationAssetIdentity] = await testClient<[{ id: string }]>`
    select gen_random_uuid() as id
  `;
  await expectConstraintViolation(
    () =>
      testClient!`
        insert into media_assets (
          id, organization_id, purpose, kind, status, storage_driver,
          storage_key, staging_storage_key, original_file_name, safe_file_name,
          declared_mime_type, declared_size_bytes, duration_milliseconds,
          quota_bytes, upload_expires_at
        ) values (
          ${pendingDurationAssetIdentity.id}, ${organization.id}, 'submission',
          'audio', 'pending', 'filesystem',
          ${`tenants/${organization.id}/assets/${pendingDurationAssetIdentity.id}/ready.mp4`},
          ${`incoming/tenants/${organization.id}/assets/${pendingDurationAssetIdentity.id}/incoming.mp4`},
          'pending-duration.mp4', 'pending-duration.mp4', 'audio/mp4',
          1024, 1000, 1024, now() + interval '1 hour'
        )
      `,
    "pending media duration state",
  );

  const [multipartAbortAssetIdentity] = await testClient<[{ id: string }]>`
    select gen_random_uuid() as id
  `;
  await testClient`
    insert into media_assets (
      id, organization_id, purpose, kind, status, storage_driver,
      storage_key, staging_storage_key, original_file_name, safe_file_name,
      declared_mime_type, declared_size_bytes, quota_bytes, upload_expires_at,
      deleted_at
    ) values (
      ${multipartAbortAssetIdentity.id}, ${organization.id}, 'submission',
      'video', 'deleted', 's3',
      ${`tenants/${organization.id}/assets/${multipartAbortAssetIdentity.id}/ready.mp4`},
      ${`incoming/tenants/${organization.id}/assets/${multipartAbortAssetIdentity.id}/incoming.mp4`},
      'multipart-abort.mp4', 'multipart-abort.mp4', 'video/mp4',
      2000000000, 2000000000, now() + interval '24 hours', now()
    )
  `;
  await expectConstraintViolation(
    () =>
      testClient!`
        update media_assets
        set quota_bytes = 0,
            staging_deleted_at = now(),
            storage_deleted_at = now()
        where id = ${multipartAbortAssetIdentity.id}
      `,
    "multipart quota release without verified abort proof",
  );
  await testClient`
    update media_assets
    set quota_bytes = 0,
        staging_deleted_at = now(),
        storage_deleted_at = now(),
        multipart_abort_verified_at = now()
    where id = ${multipartAbortAssetIdentity.id}
  `;
  const [releasedMultipartAbortAsset] = await testClient<
    [{ quotaBytes: number; abortVerifiedAt: Date | null }]
  >`
    select quota_bytes::int as "quotaBytes",
           multipart_abort_verified_at as "abortVerifiedAt"
    from media_assets
    where id = ${multipartAbortAssetIdentity.id}
  `;
  if (
    releasedMultipartAbortAsset.quotaBytes !== 0 ||
    !releasedMultipartAbortAsset.abortVerifiedAt
  ) {
    throw new Error("Verified multipart abort did not release reserved quota.");
  }
  await expectConstraintViolation(
    () =>
      testClient!`
        update media_assets
        set multipart_abort_verified_at = null
        where id = ${multipartAbortAssetIdentity.id}
      `,
    "multipart quota release proof removal",
  );
  await expectConstraintViolation(
    () =>
      testClient!`
        update media_assets
        set staging_deleted_at = null
        where id = ${multipartAbortAssetIdentity.id}
      `,
    "multipart abort proof without staging deletion",
  );
  await expectConstraintViolation(
    () =>
      testClient!`
        update media_assets
        set storage_deleted_at = null
        where id = ${multipartAbortAssetIdentity.id}
      `,
    "multipart abort proof without final storage deletion",
  );
  const [multipartRecoveryAssetIdentity] = await testClient<[{ id: string }]>`
    select gen_random_uuid() as id
  `;
  await testClient`
    insert into media_assets (
      id, organization_id, purpose, kind, status, storage_driver,
      storage_key, staging_storage_key, original_file_name, safe_file_name,
      declared_mime_type, declared_size_bytes, quota_bytes, upload_expires_at
    ) values (
      ${multipartRecoveryAssetIdentity.id}, ${organization.id}, 'submission',
      'video', 'pending', 's3',
      ${`tenants/${organization.id}/assets/${multipartRecoveryAssetIdentity.id}/ready.mp4`},
      ${`incoming/tenants/${organization.id}/assets/${multipartRecoveryAssetIdentity.id}/incoming.mp4`},
      'multipart-recovery.mp4', 'multipart-recovery.mp4', 'video/mp4',
      67108864, 67108864, now() + interval '24 hours'
    )
  `;
  await testClient`
    insert into media_upload_sessions (
      asset_id, organization_id, provider_upload_id, part_size_bytes,
      expected_part_count, expires_at, upload_deadline_at, state
    ) values (
      ${multipartRecoveryAssetIdentity.id}, ${organization.id},
      'migration-recovery-upload', 33554432, 2,
      now() + interval '24 hours', now() + interval '24 hours', 'uploading'
    )
  `;
  await testClient`
    update media_upload_sessions
    set provider_upload_id = null,
        initialization_token = gen_random_uuid(),
        state = 'recovering',
        updated_at = now()
    where asset_id = ${multipartRecoveryAssetIdentity.id}
  `;
  const [recoveringMultipartSession] = await testClient<
    [{ state: string; providerUploadId: string | null }]
  >`
    select state, provider_upload_id as "providerUploadId"
    from media_upload_sessions
    where asset_id = ${multipartRecoveryAssetIdentity.id}
  `;
  if (
    recoveringMultipartSession.state !== "recovering" ||
    recoveringMultipartSession.providerUploadId !== null
  ) {
    throw new Error("Multipart recovery claim did not preserve its DB invariant.");
  }
  await expectConstraintViolation(
    () =>
      testClient!`
        update media_upload_sessions
        set state = 'unknown_state', provider_upload_id = 'unexpected'
        where asset_id = ${multipartRecoveryAssetIdentity.id}
      `,
    "multipart upload session allowed states",
  );

  const [communityAuthor] = await testClient<[{ id: string }]>`
    insert into users (
      organization_id, email, password_hash, first_name, last_name
    ) values (
      ${organization.id}, 'community-author@example.test', 'unusable',
      'Community', 'Author'
    ) returning id
  `;
  const [communityOther] = await testClient<[{ id: string }]>`
    insert into users (
      organization_id, email, password_hash, first_name, last_name
    ) values (
      ${organization.id}, 'community-other@example.test', 'unusable',
      'Community', 'Other'
    ) returning id
  `;
  const [protectedPublicCustomField] = await testClient<[{ id: string }]>`
    insert into custom_field_definitions (
      organization_id, key, label, type, visibility, active, sort_order
    ) values (
      ${organization.id}, 'public_department_code', 'Department code',
      'text', 'member', true, 0
    )
    returning id
  `;
  await testClient`
    insert into community_profile_settings (
      organization_id, completion_gate_enabled, revision
    ) values (${organization.id}, false, 1)
  `;
  await testClient`
    insert into community_public_profile_fields (
      organization_id, custom_field_id, required_for_posting, sort_order
    ) values (
      ${organization.id}, ${protectedPublicCustomField.id}, false, 0
    )
  `;
  await expectDatabaseError(
    () =>
      testClient!`
        delete from custom_field_definitions
        where id = ${protectedPublicCustomField.id}
      `,
    ["23503"],
    "public community custom-field deletion protection",
  );
  const [communityArea] = await testClient<[{ id: string }]>`
    insert into community_areas (organization_id, title, slug, sort_order)
    values (${organization.id}, 'Allgemein', 'allgemein', 0)
    returning id
  `;
  const [communitySpace] = await testClient<[{ id: string }]>`
    insert into community_spaces (
      organization_id, area_id, title, slug, type, access_mode, sort_order
    ) values (
      ${organization.id}, ${communityArea.id}, 'Restricted community',
      'restricted-community', 'discussion', 'restricted', 0
    ) returning id
  `;
  await expectConstraintViolation(
    () =>
      testClient!`
        insert into community_space_access_rules (
          organization_id, space_id, subject_type, subject_role,
          can_view, can_post, can_comment
        ) values (
          ${organization.id}, ${communitySpace.id}, 'role', 'member',
          false, true, false
        )
      `,
    "Community write permission without view permission",
  );
  await testClient`
    insert into community_space_access_rules (
      organization_id, space_id, subject_type, subject_role,
      can_view, can_post, can_comment
    ) values (
      ${organization.id}, ${communitySpace.id}, 'role', 'member',
      true, true, true
    )
  `;
  const revisionValue = async () => {
    const [row] = await testClient!<[{ value: number }]>`
      select revision::int as value
      from community_feed_revisions
      where organization_id = ${organization.id}
    `;
    if (!row) throw new Error("Community feed revision row is missing.");
    return row.value;
  };
  const expectCommunityRevisionBump = async (
    operation: () => Promise<unknown>,
    label: string,
  ) => {
    const before = await revisionValue();
    await operation();
    const after = await revisionValue();
    if (after !== before + 1) {
      throw new Error(`${label} did not bump the feed revision exactly once.`);
    }
  };
  const feedRevisionFunctions = await testClient<
    Array<{
      name: string;
      securityDefiner: boolean;
      hardenedSearchPath: boolean;
      publicExecuteRevoked: boolean;
    }>
  >`
    select
      procedure.proname as name,
      procedure.prosecdef as "securityDefiner",
      coalesce(
        procedure.proconfig @>
          array['search_path=pg_catalog, public']::text[],
        false
      ) as "hardenedSearchPath",
      not exists (
        select 1
        from aclexplode(
          coalesce(
            procedure.proacl,
            acldefault('f', procedure.proowner)
          )
        ) privilege
        where privilege.grantee = 0
          and privilege.privilege_type = 'EXECUTE'
      ) as "publicExecuteRevoked"
    from pg_proc procedure
    inner join pg_namespace namespace
      on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname in (
        'bump_community_feed_revision',
        'bump_community_feed_revision_from_group_member',
        'bump_community_feed_revision_from_member_bundle'
      )
      and pg_get_function_identity_arguments(procedure.oid) = ''
    order by procedure.proname
  `;
  if (
    feedRevisionFunctions.length !== 3 ||
    feedRevisionFunctions.some(
      (procedure) =>
        !procedure.securityDefiner ||
        !procedure.hardenedSearchPath ||
        !procedure.publicExecuteRevoked,
    )
  ) {
    throw new Error(
      "Community feed trigger functions are not fully SECURITY DEFINER/search_path/PUBLIC EXECUTE hardened.",
    );
  }

  const moderationTriggerFunctions = await testClient<
    Array<{
      name: string;
      securityDefiner: boolean;
      hardenedSearchPath: boolean;
      publicExecuteRevoked: boolean;
    }>
  >`
    select
      procedure.proname as name,
      procedure.prosecdef as "securityDefiner",
      coalesce(
        procedure.proconfig @> array['search_path=pg_catalog']::text[],
        false
      ) as "hardenedSearchPath",
      not exists (
        select 1
        from aclexplode(
          coalesce(
            procedure.proacl,
            acldefault('f', procedure.proowner)
          )
        ) privilege
        where privilege.grantee = 0
          and privilege.privilege_type = 'EXECUTE'
      ) as "publicExecuteRevoked"
    from pg_proc procedure
    inner join pg_namespace namespace
      on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname in (
        'apply_community_score_contribution_delta',
        'enforce_community_content_publication_timeline',
        'reject_community_moderation_event_mutation',
        'reject_community_score_contribution_truncate',
        'validate_community_score_contribution'
      )
      and pg_get_function_identity_arguments(procedure.oid) = ''
    order by procedure.proname
  `;
  if (
    moderationTriggerFunctions.length !== 5 ||
    moderationTriggerFunctions.some(
      (procedure) =>
        !procedure.securityDefiner ||
        !procedure.hardenedSearchPath ||
        !procedure.publicExecuteRevoked,
    )
  ) {
    throw new Error(
      "Community moderation or scoring trigger functions are not fully hardened.",
    );
  }

  await testClient`
    insert into community_space_moderation_policies (
      organization_id, space_id, post_approval, comment_approval,
      automation_mode, report_threshold, duplicate_window_minutes,
      link_limit, updated_by_id
    ) values (
      ${organization.id}, ${communitySpace.id}, 'members', 'non_admins',
      'observe', 3, 30, 2, ${communityAuthor.id}
    )
  `;
  await expectConstraintViolation(
    () =>
      testClient!`
        update community_space_moderation_policies
        set report_threshold = 1
        where organization_id = ${organization.id}
          and space_id = ${communitySpace.id}
      `,
    "Community moderation report threshold",
  );

  const [defaultPublishedPost] = await testClient<
    [{ id: string; moderationState: string; publishedAt: Date | null }]
  >`
    insert into posts (organization_id, space_id, author_id, content)
    values (
      ${organization.id}, ${communitySpace.id}, ${communityAuthor.id},
      'Default-visible moderation post'
    )
    returning id, moderation_state as "moderationState",
              published_at as "publishedAt"
  `;
  if (
    defaultPublishedPost.moderationState !== "published" ||
    !defaultPublishedPost.publishedAt
  ) {
    throw new Error("Public post defaults are not upgrade-compatible.");
  }

  const [pendingModerationPost] = await testClient<[{ id: string }]>`
    insert into posts (
      organization_id, space_id, author_id, content, moderation_state,
      published_at
    ) values (
      ${organization.id}, ${communitySpace.id}, ${communityAuthor.id},
      'Pending moderation post', 'pending', null
    ) returning id
  `;
  const [rejectedModerationPost] = await testClient<
    [{ publishedAt: Date | null }]
  >`
    insert into posts (
      organization_id, space_id, author_id, content, moderation_state,
      published_at
    ) values (
      ${organization.id}, ${communitySpace.id}, ${communityAuthor.id},
      'Rejected moderation post', 'rejected', null
    ) returning published_at as "publishedAt"
  `;
  const [initialHeldModerationPost] = await testClient<[{ id: string }]>`
    insert into posts (
      organization_id, space_id, author_id, content, moderation_state,
      published_at
    ) values (
      ${organization.id}, ${communitySpace.id}, ${communityAuthor.id},
      'Initially held moderation post', 'held', null
    ) returning id
  `;
  if (rejectedModerationPost.publishedAt !== null) {
    throw new Error("Rejected first submissions received published_at.");
  }
  await expectConstraintViolation(
    () =>
      testClient!`
        insert into posts (
          organization_id, space_id, author_id, content, moderation_state
        ) values (
          ${organization.id}, ${communitySpace.id}, ${communityAuthor.id},
          'Invalid pending default', 'pending'
        )
      `,
    "Pending first submission publication timestamp",
  );
  await expectConstraintViolation(
    () =>
      testClient!`
        insert into posts (
          organization_id, space_id, author_id, content, moderation_state,
          published_at
        ) values (
          ${organization.id}, ${communitySpace.id}, ${communityAuthor.id},
          'Invalid held timestamp', 'held', now()
        )
      `,
    "Never-published held content timestamp",
  );
  await expectConstraintViolation(
    () =>
      testClient!`
        update posts set published_at = now()
        where id = ${initialHeldModerationPost.id}
      `,
    "Held content publication history",
  );

  await expectCommunityRevisionBump(
    () =>
      testClient!`
        update posts
        set moderation_state = 'published', published_at = clock_timestamp(),
            moderation_version = moderation_version + 1
        where id = ${pendingModerationPost.id}
      `,
    "Post publication moderation transition",
  );
  const [publishedModerationPost] = await testClient<[{ publishedAt: string }]>`
    select published_at as "publishedAt"
    from posts where id = ${pendingModerationPost.id}
  `;
  await expectCommunityRevisionBump(
    () =>
      testClient!`
        update posts
        set moderation_state = 'held',
            moderation_version = moderation_version + 1
        where id = ${pendingModerationPost.id}
      `,
    "Published post hold transition",
  );
  const [heldPublishedPost] = await testClient<
    [{ publishedAt: string | null }]
  >`
    select published_at as "publishedAt"
    from posts where id = ${pendingModerationPost.id}
  `;
  if (
    !heldPublishedPost.publishedAt ||
    heldPublishedPost.publishedAt !== publishedModerationPost.publishedAt
  ) {
    throw new Error("Held content did not retain its initial publication.");
  }
  await expectConstraintViolation(
    () =>
      testClient!`
        update posts set published_at = published_at + interval '1 second'
        where id = ${pendingModerationPost.id}
      `,
    "Immutable initial publication timestamp",
  );

  const [pendingModerationComment] = await testClient<[{ id: string }]>`
    insert into comments (
      organization_id, post_id, author_id, content, moderation_state,
      published_at
    ) values (
      ${organization.id}, ${defaultPublishedPost.id}, ${communityOther.id},
      'Pending moderation comment', 'pending', null
    ) returning id
  `;
  await expectCommunityRevisionBump(
    () =>
      testClient!`
        update comments
        set moderation_state = 'published', published_at = clock_timestamp(),
            moderation_version = moderation_version + 1
        where id = ${pendingModerationComment.id}
      `,
    "Comment publication moderation transition",
  );

  const [legacyModerationEvent] = await testClient<[{ id: string }]>`
    select id from community_moderation_events
    where organization_id = ${legacyCommunityOrganization.id}
    order by created_at, id limit 1
  `;
  await expectDatabaseError(
    () =>
      testClient!`
        update community_moderation_events set note = 'mutated'
        where id = ${legacyModerationEvent.id}
      `,
    ["55000"],
    "Append-only moderation event update",
  );
  await expectDatabaseError(
    () =>
      testClient!`
        delete from community_moderation_events
        where id = ${legacyModerationEvent.id}
      `,
    ["55000"],
    "Append-only moderation event delete",
  );
  await expectDatabaseError(
    () => testClient!`truncate table community_moderation_events`,
    ["55000"],
    "Append-only moderation event truncate",
  );
  await expectDatabaseError(
    () =>
      testClient!`
        delete from community_moderation_cases
        where id = ${legacyCommentCase.id}
      `,
    ["23503"],
    "Moderation case audit retention",
  );
  await expectDatabaseError(
    () =>
      testClient!`
        insert into community_moderation_cases (
          organization_id, target_type, target_id, target_author_id,
          reason, status
        ) values (
          ${legacyCommunityOrganization.id}, 'post', ${legacyCommunityPost.id},
          ${legacyCommunityAuthor.id}, 'manual', 'open'
        )
      `,
    ["23505"],
    "One active moderation case per target",
  );
  await expectDatabaseError(
    () =>
      testClient!`
        insert into community_reports (
          organization_id, case_id, reporter_id, target_type, target_id,
          target_author_id, content_excerpt, reason
        ) values (
          ${legacyCommunityOrganization.id}, ${legacyPostCase.id},
          ${legacyCommunityReporter.id}, 'post', ${legacyCommunityPost.id},
          ${legacyCommunityAuthor.id}, 'Duplicate report', 'spam'
        )
      `,
    ["23505"],
    "One reporter per moderation case",
  );
  await testClient`
    insert into community_moderation_assessments (
      organization_id, case_id, revision, policy_version, fingerprint,
      signals, outcome
    ) values (
      ${legacyCommunityOrganization.id}, ${legacyPostCase.id}, 1, 1,
      ${"a".repeat(64)}, '{"linkCount":0}'::jsonb, 'pending'
    )
  `;
  await expectConstraintViolation(
    () =>
      testClient!`
        insert into community_moderation_assessments (
          organization_id, case_id, revision, policy_version, fingerprint,
          signals, outcome
        ) values (
          ${legacyCommunityOrganization.id}, ${legacyPostCase.id}, 2, 1,
          ${"b".repeat(64)}, '[]'::jsonb, 'held'
        )
      `,
    "Bounded moderation assessment signals",
  );
  await testClient`
    insert into community_moderation_appeals (
      organization_id, case_id, appellant_id, statement, decision_version
    ) values (
      ${legacyCommunityOrganization.id}, ${legacyCommentCase.id},
      ${legacyCommunityAuthor.id}, 'Bitte pruefen Sie diese Entscheidung.', 1
    )
  `;
  await expectDatabaseError(
    () =>
      testClient!`
        insert into community_moderation_appeals (
          organization_id, case_id, appellant_id, statement, decision_version
        ) values (
          ${legacyCommunityOrganization.id}, ${legacyCommentCase.id},
          ${legacyCommunityAuthor.id}, 'Zweiter offener Einspruch.', 1
        )
      `,
    ["23505"],
    "One active appeal per moderation case",
  );
  const revisionBeforeProfileUpdate = await revisionValue();
  await testClient`
    update users set points = points + 1, first_name = first_name
    where id = ${communityOther.id} and organization_id = ${organization.id}
  `;
  if ((await revisionValue()) !== revisionBeforeProfileUpdate) {
    throw new Error(
      "Profile or points update unexpectedly bumped the feed revision.",
    );
  }
  await testClient`
    update users set status = 'disabled'
    where id = ${communityOther.id} and organization_id = ${organization.id}
  `;
  if ((await revisionValue()) !== revisionBeforeProfileUpdate + 1) {
    throw new Error("User status update did not bump the feed revision.");
  }
  await testClient`
    update users set status = 'active'
    where id = ${communityOther.id} and organization_id = ${organization.id}
  `;
  if ((await revisionValue()) !== revisionBeforeProfileUpdate + 2) {
    throw new Error("User status restoration did not bump the feed revision.");
  }
  const revisionBeforeBulk = await revisionValue();
  const bulkPostIds = await testClient<[{ id: string }]>`
    insert into posts (organization_id, space_id, author_id, title, content)
    select ${organization.id}, ${communitySpace.id}, ${communityAuthor.id},
           'Revision bulk ' || value::text, 'Revision bulk content'
    from generate_series(1, 100) value
    returning id
  `;
  if ((await revisionValue()) !== revisionBeforeBulk) {
    throw new Error(
      "Snapshot-frozen post inserts unexpectedly bumped the feed revision.",
    );
  }
  await testClient`
    update posts set pinned = true
    where organization_id = ${organization.id}
      and id = any(${bulkPostIds.map((row) => row.id)}::uuid[])
  `;
  if ((await revisionValue()) !== revisionBeforeBulk + 1) {
    throw new Error(
      "Bulk pin mutation did not bump the feed revision exactly once.",
    );
  }
  await testClient`
    update community_space_access_rules set can_comment = false
    where organization_id = ${organization.id}
      and space_id = ${communitySpace.id}
  `;
  if ((await revisionValue()) !== revisionBeforeBulk + 2) {
    throw new Error("Community ACL mutation did not bump the feed revision.");
  }
  await testClient`
    insert into post_likes (organization_id, post_id, user_id, reaction)
    values (${organization.id}, ${bulkPostIds[0]!.id}, ${communityOther.id}, 'like')
  `;
  await testClient`
    delete from post_likes
    where organization_id = ${organization.id}
      and post_id = ${bulkPostIds[0]!.id}
      and user_id = ${communityOther.id}
  `;
  if ((await revisionValue()) !== revisionBeforeBulk + 3) {
    throw new Error(
      "Reaction deletion did not bump the feed revision exactly once.",
    );
  }
  await testClient`
    delete from posts
    where organization_id = ${organization.id}
      and id = any(${bulkPostIds.map((row) => row.id)}::uuid[])
  `;
  if ((await revisionValue()) !== revisionBeforeBulk + 4) {
    throw new Error(
      "Bulk post delete did not deduplicate the feed revision bump.",
    );
  }

  const revisionBeforeFollowInsert = await revisionValue();
  const [feedRevisionFollow] = await testClient<[{ id: string }]>`
    insert into community_follows (
      organization_id, follower_id, target_type, target_author_id
    ) values (
      ${organization.id}, ${communityAuthor.id}, 'author', ${communityOther.id}
    )
    returning id
  `;
  if ((await revisionValue()) !== revisionBeforeFollowInsert) {
    throw new Error(
      "Snapshot-frozen follow insert unexpectedly bumped the feed revision.",
    );
  }
  await expectCommunityRevisionBump(
    () => testClient!`
      delete from community_follows
      where id = ${feedRevisionFollow.id}
        and organization_id = ${organization.id}
    `,
    "Follow deletion",
  );

  const revisionBeforeBoostInsert = await revisionValue();
  const [feedRevisionBoost] = await testClient<[{ id: string }]>`
    insert into community_author_boosts (
      organization_id, author_id, strength, starts_at, ends_at, reason,
      created_by_id
    ) values (
      ${organization.id}, ${communityOther.id}, 'light',
      now() - interval '1 day', now() + interval '30 days',
      'Migration feed revision regression', ${communityAuthor.id}
    )
    returning id
  `;
  if ((await revisionValue()) !== revisionBeforeBoostInsert) {
    throw new Error(
      "Snapshot-frozen boost insert unexpectedly bumped the feed revision.",
    );
  }
  await expectCommunityRevisionBump(
    () => testClient!`
      update community_author_boosts set strength = 'medium'
      where id = ${feedRevisionBoost.id}
        and organization_id = ${organization.id}
    `,
    "Boost strength update",
  );
  await expectCommunityRevisionBump(
    () => testClient!`
      update community_author_boosts
      set starts_at = starts_at + interval '1 hour'
      where id = ${feedRevisionBoost.id}
        and organization_id = ${organization.id}
    `,
    "Boost start update",
  );
  await expectCommunityRevisionBump(
    () => testClient!`
      update community_author_boosts
      set ends_at = ends_at + interval '1 hour'
      where id = ${feedRevisionBoost.id}
        and organization_id = ${organization.id}
    `,
    "Boost end update",
  );
  await expectCommunityRevisionBump(
    () => testClient!`
      delete from community_author_boosts
      where id = ${feedRevisionBoost.id}
        and organization_id = ${organization.id}
    `,
    "Boost cleanup deletion",
  );

  const revisionBeforeAclSubjects = await revisionValue();
  const [feedAclGroup] = await testClient<[{ id: string }]>`
    insert into groups (organization_id, name)
    values (${organization.id}, 'Community feed ACL regression group')
    returning id
  `;
  const [feedAclBundle] = await testClient<[{ id: string }]>`
    insert into bundles (organization_id, name)
    values (${organization.id}, 'Community feed ACL regression bundle')
    returning id
  `;
  if ((await revisionValue()) !== revisionBeforeAclSubjects) {
    throw new Error(
      "Snapshot-frozen group or bundle insert unexpectedly bumped the feed revision.",
    );
  }
  const feedAclRuleIds = await testClient<Array<{ id: string }>>`
    insert into community_space_access_rules (
      organization_id, space_id, subject_type, subject_group_id,
      subject_bundle_id, can_view, can_post, can_comment
    ) values
      (
        ${organization.id}, ${communitySpace.id}, 'group', ${feedAclGroup.id},
        null, true, false, false
      ),
      (
        ${organization.id}, ${communitySpace.id}, 'bundle', null,
        ${feedAclBundle.id}, true, false, false
      )
    returning id
  `;
  if (feedAclRuleIds.length !== 2) {
    throw new Error(
      "Community feed ACL regression rules were not created exactly.",
    );
  }
  await expectCommunityRevisionBump(
    () => testClient!`
      insert into group_members (group_id, user_id)
      values (${feedAclGroup.id}, ${communityOther.id})
    `,
    "Group membership grant",
  );
  await expectCommunityRevisionBump(
    () => testClient!`
      insert into group_bundles (group_id, bundle_id)
      values (${feedAclGroup.id}, ${feedAclBundle.id})
    `,
    "Group bundle ACL grant",
  );
  await expectCommunityRevisionBump(
    () => testClient!`
      delete from group_bundles
      where group_id = ${feedAclGroup.id}
        and bundle_id = ${feedAclBundle.id}
    `,
    "Group bundle ACL revocation",
  );
  await expectCommunityRevisionBump(
    () => testClient!`
      delete from group_members
      where group_id = ${feedAclGroup.id}
        and user_id = ${communityOther.id}
    `,
    "Group membership revocation",
  );
  await expectCommunityRevisionBump(
    () => testClient!`
      insert into member_bundles (user_id, bundle_id)
      values (${communityOther.id}, ${feedAclBundle.id})
    `,
    "Direct member bundle ACL grant",
  );
  await expectCommunityRevisionBump(
    () => testClient!`
      delete from member_bundles
      where user_id = ${communityOther.id}
        and bundle_id = ${feedAclBundle.id}
    `,
    "Direct member bundle ACL revocation",
  );
  await testClient`
    delete from community_space_access_rules
    where organization_id = ${organization.id}
      and id = any(${feedAclRuleIds.map((row) => row.id)}::uuid[])
  `;
  await testClient`
    delete from bundles
    where id = ${feedAclBundle.id}
      and organization_id = ${organization.id}
  `;
  await testClient`
    delete from groups
    where id = ${feedAclGroup.id}
      and organization_id = ${organization.id}
  `;
  const [communityForeignOrganization] = await testClient<[{ id: string }]>`
    insert into organizations (name, slug)
    values ('Community foreign tenant', 'community-foreign-tenant')
    returning id
  `;
  const [communityForeignUser] = await testClient<[{ id: string }]>`
    insert into users (
      organization_id, email, password_hash, first_name, last_name
    ) values (
      ${communityForeignOrganization.id}, 'foreign-community@example.test',
      'unusable', 'Foreign', 'Community'
    ) returning id
  `;
  await expectDatabaseError(
    () =>
      testClient!`
        insert into community_space_access_rules (
          organization_id, space_id, subject_type, subject_user_id,
          can_view, can_post, can_comment
        ) values (
          ${organization.id}, ${communitySpace.id}, 'user',
          ${communityForeignUser.id}, true, false, false
        )
      `,
    ["23503"],
    "Cross-tenant community access rule",
  );

  const scoringIndexes = await testClient<
    Array<{ name: string; definition: string }>
  >`
    select indexname as name, indexdef as definition
    from pg_indexes
    where schemaname = 'public'
      and indexname in (
        'community_score_contributions_post_reaction_uidx',
        'community_score_contributions_post_comment_uidx',
        'community_score_contributions_comment_reply_uidx',
        'community_score_contributions_comment_reaction_uidx'
      )
    order by indexname
  `;
  if (
    scoringIndexes.length !== 4 ||
    scoringIndexes.some(
      (indexDefinition) =>
        !indexDefinition.definition.includes("CREATE UNIQUE INDEX") ||
        !indexDefinition.definition.includes(" WHERE "),
    )
  ) {
    throw new Error(
      "Community score source uniqueness is not enforced by partial unique indexes.",
    );
  }

  const communityScoreValue = async (userId: string) => {
    const [user] = await testClient!<
      [{ communityPoints: number; learningPoints: number }]
    >`
      select community_points as "communityPoints", points as "learningPoints"
      from users
      where id = ${userId} and organization_id = ${organization.id}
    `;
    if (!user) throw new Error("Community score test user is missing.");
    return user;
  };
  const [scorePost] = await testClient<[{ id: string }]>`
    insert into posts (organization_id, space_id, author_id, title, content)
    values (
      ${organization.id}, ${communitySpace.id}, ${communityAuthor.id},
      'Community score source', 'Community score source'
    ) returning id
  `;
  await testClient`
    insert into post_likes (organization_id, post_id, user_id, reaction)
    values (
      ${organization.id}, ${scorePost.id}, ${communityOther.id}, 'celebrate'
    )
  `;
  const [initialScoreContribution] = await testClient<[{ id: string }]>`
    insert into community_score_contributions (
      organization_id, recipient_id, actor_id, kind, post_id, points
    ) values (
      ${organization.id}, ${communityAuthor.id}, ${communityOther.id},
      'post_reaction', ${scorePost.id}, 1
    ) returning id
  `;
  const scoreAfterInsert = await communityScoreValue(communityAuthor.id);
  if (
    scoreAfterInsert.communityPoints !== 1 ||
    scoreAfterInsert.learningPoints !== 0
  ) {
    throw new Error(
      "Community contribution did not update its independent aggregate exactly once.",
    );
  }
  await expectDatabaseError(
    () =>
      testClient!`
        update community_score_contributions
        set created_at = created_at
        where id = ${initialScoreContribution.id}
      `,
    ["55000"],
    "Immutable community score contribution",
  );
  await expectDatabaseError(
    () =>
      testClient!`
        insert into community_score_contributions (
          organization_id, recipient_id, actor_id, kind, post_id, points
        ) values (
          ${organization.id}, ${communityAuthor.id}, ${communityOther.id},
          'post_reaction', ${scorePost.id}, 1
        )
      `,
    ["23505"],
    "Duplicate community score source",
  );
  await testClient`
    delete from community_score_contributions
    where id = ${initialScoreContribution.id}
  `;
  if ((await communityScoreValue(communityAuthor.id)).communityPoints !== 0) {
    throw new Error("Community contribution deletion did not reverse points.");
  }
  const [reinsertedScoreContribution] = await testClient<[{ id: string }]>`
    insert into community_score_contributions (
      organization_id, recipient_id, actor_id, kind, post_id, points
    ) values (
      ${organization.id}, ${communityAuthor.id}, ${communityOther.id},
      'post_reaction', ${scorePost.id}, 1
    ) returning id
  `;
  if ((await communityScoreValue(communityAuthor.id)).communityPoints !== 1) {
    throw new Error(
      "Community contribution could not be reinserted exactly once.",
    );
  }
  await testClient`
    delete from post_likes
    where organization_id = ${organization.id}
      and post_id = ${scorePost.id}
      and user_id = ${communityOther.id}
  `;
  const [cascadedContribution] = await testClient<[{ count: number }]>`
    select count(*)::int as count
    from community_score_contributions
    where id = ${reinsertedScoreContribution.id}
  `;
  if (
    cascadedContribution.count !== 0 ||
    (await communityScoreValue(communityAuthor.id)).communityPoints !== 0
  ) {
    throw new Error(
      "Deleting a score source did not cascade and reverse its contribution.",
    );
  }

  await testClient`
    insert into post_likes (organization_id, post_id, user_id, reaction)
    values
      (${organization.id}, ${scorePost.id}, ${communityOther.id}, 'like'),
      (${organization.id}, ${scorePost.id}, ${communityAuthor.id}, 'like')
  `;
  await expectConstraintViolation(
    () =>
      testClient!`
        insert into community_score_contributions (
          organization_id, recipient_id, actor_id, kind, post_id, points
        ) values (
          ${organization.id}, ${communityAuthor.id}, ${communityOther.id},
          'post_reaction', ${scorePost.id}, 2
        )
      `,
    "Community score contribution shape",
  );
  await expectConstraintViolation(
    () =>
      testClient!`
        insert into community_score_contributions (
          organization_id, recipient_id, actor_id, kind, post_id, points
        ) values (
          ${organization.id}, ${communityAuthor.id}, ${communityAuthor.id},
          'post_reaction', ${scorePost.id}, 1
        )
      `,
    "Self-engagement community score",
  );
  await expectDatabaseError(
    () =>
      testClient!`
        insert into community_score_contributions (
          organization_id, recipient_id, actor_id, kind, post_id, points
        ) values (
          ${organization.id}, ${communityForeignUser.id}, ${communityOther.id},
          'post_reaction', ${scorePost.id}, 1
        )
      `,
    ["23503", "23514"],
    "Cross-tenant community score recipient",
  );
  const [nonnegativeContribution] = await testClient<[{ id: string }]>`
    insert into community_score_contributions (
      organization_id, recipient_id, actor_id, kind, post_id, points
    ) values (
      ${organization.id}, ${communityAuthor.id}, ${communityOther.id},
      'post_reaction', ${scorePost.id}, 1
    ) returning id
  `;
  await testClient`
    update users set community_points = 0
    where id = ${communityAuthor.id} and organization_id = ${organization.id}
  `;
  await expectConstraintViolation(
    () =>
      testClient!`
        delete from community_score_contributions
        where id = ${nonnegativeContribution.id}
      `,
    "Nonnegative community score reversal",
  );
  const [preservedContribution] = await testClient<[{ count: number }]>`
    select count(*)::int as count
    from community_score_contributions
    where id = ${nonnegativeContribution.id}
  `;
  if (preservedContribution.count !== 1) {
    throw new Error(
      "Failed community score reversal did not roll back contribution deletion.",
    );
  }
  await testClient`
    update users set community_points = 1
    where id = ${communityAuthor.id} and organization_id = ${organization.id}
  `;
  await testClient`
    delete from community_score_contributions
    where id = ${nonnegativeContribution.id}
  `;
  await testClient`
    delete from post_likes
    where organization_id = ${organization.id} and post_id = ${scorePost.id}
  `;

  const [scoreComment] = await testClient<[{ id: string }]>`
    insert into comments (organization_id, post_id, author_id, content)
    values (
      ${organization.id}, ${scorePost.id}, ${communityAuthor.id},
      'Comment reaction score source'
    ) returning id
  `;
  const revisionBeforeCommentReaction = await revisionValue();
  await testClient`
    insert into comment_reactions (
      organization_id, comment_id, post_id, user_id, reaction
    ) values (
      ${organization.id}, ${scoreComment.id}, ${scorePost.id},
      ${communityOther.id}, 'insightful'
    )
  `;
  if ((await revisionValue()) !== revisionBeforeCommentReaction) {
    throw new Error(
      "Snapshot-frozen comment reaction insert unexpectedly bumped the feed revision.",
    );
  }
  await expectDatabaseError(
    () =>
      testClient!`
        insert into comment_reactions (
          organization_id, comment_id, post_id, user_id, reaction
        ) values (
          ${organization.id}, ${scoreComment.id}, ${scorePost.id},
          ${communityForeignUser.id}, 'like'
        )
      `,
    ["23503"],
    "Cross-tenant comment reaction",
  );
  await testClient`
    insert into community_score_contributions (
      organization_id, recipient_id, actor_id, kind, reaction_comment_id,
      points
    ) values (
      ${organization.id}, ${communityAuthor.id}, ${communityOther.id},
      'comment_reaction', ${scoreComment.id}, 1
    )
  `;
  if ((await communityScoreValue(communityAuthor.id)).communityPoints !== 1) {
    throw new Error("Comment reaction contribution did not add one point.");
  }
  await expectCommunityRevisionBump(
    () => testClient!`
      update comment_reactions set reaction = 'question'
      where organization_id = ${organization.id}
        and comment_id = ${scoreComment.id}
        and user_id = ${communityOther.id}
    `,
    "Comment reaction update",
  );
  await expectCommunityRevisionBump(
    () => testClient!`
      delete from comment_reactions
      where organization_id = ${organization.id}
        and comment_id = ${scoreComment.id}
        and user_id = ${communityOther.id}
    `,
    "Comment reaction deletion",
  );
  if ((await communityScoreValue(communityAuthor.id)).communityPoints !== 0) {
    throw new Error(
      "Comment reaction source deletion did not reverse its contribution.",
    );
  }
  await expectDatabaseError(
    () => testClient!`truncate table community_score_contributions`,
    ["55000"],
    "Community score contribution truncate",
  );

  const parallelPosts = await testClient<Array<{ id: string }>>`
    insert into posts (organization_id, space_id, author_id, title, content)
    values
      (
        ${organization.id}, ${communitySpace.id}, ${communityAuthor.id},
        'Parallel score A', 'Parallel score A'
      ),
      (
        ${organization.id}, ${communitySpace.id}, ${communityAuthor.id},
        'Parallel score B', 'Parallel score B'
      )
    returning id
  `;
  await testClient`
    insert into post_likes (organization_id, post_id, user_id, reaction)
    values
      (
        ${organization.id}, ${parallelPosts[0]!.id}, ${communityOther.id},
        'like'
      ),
      (
        ${organization.id}, ${parallelPosts[1]!.id}, ${communityOther.id},
        'like'
      )
  `;
  const scoreClientA = postgres(testUrl.toString(), { max: 1 });
  const scoreClientB = postgres(testUrl.toString(), { max: 1 });
  concurrentClients.push(scoreClientA, scoreClientB);
  const parallelContributionResults = await withTimeout(
    Promise.all([
      scoreClientA<Array<{ id: string }>>`
        insert into community_score_contributions (
          organization_id, recipient_id, actor_id, kind, post_id, points
        ) values (
          ${organization.id}, ${communityAuthor.id}, ${communityOther.id},
          'post_reaction', ${parallelPosts[0]!.id}, 1
        ) returning id
      `,
      scoreClientB<Array<{ id: string }>>`
        insert into community_score_contributions (
          organization_id, recipient_id, actor_id, kind, post_id, points
        ) values (
          ${organization.id}, ${communityAuthor.id}, ${communityOther.id},
          'post_reaction', ${parallelPosts[1]!.id}, 1
        ) returning id
      `,
    ]),
    10_000,
    "Parallel community score inserts",
  );
  const parallelContributionIds = parallelContributionResults
    .flat()
    .map((row) => row.id);
  if (
    parallelContributionIds.length !== 2 ||
    (await communityScoreValue(communityAuthor.id)).communityPoints !== 2
  ) {
    throw new Error(
      "Parallel community contributions lost an aggregate increment.",
    );
  }
  await withTimeout(
    Promise.all([
      scoreClientA`
        delete from community_score_contributions
        where id = ${parallelContributionIds[0]!}
      `,
      scoreClientB`
        delete from community_score_contributions
        where id = ${parallelContributionIds[1]!}
      `,
    ]),
    10_000,
    "Parallel community score deletes",
  );
  if ((await communityScoreValue(communityAuthor.id)).communityPoints !== 0) {
    throw new Error(
      "Parallel community contribution reversals lost an aggregate decrement.",
    );
  }
  await testClient`
    delete from posts
    where organization_id = ${organization.id}
      and id = any(${parallelPosts.map((post) => post.id)}::uuid[])
  `;
  await testClient`
    delete from organizations where id = ${communityForeignOrganization.id}
  `;
  const [communityPost] = await testClient<[{ id: string }]>`
    insert into posts (organization_id, space_id, author_id, title, content)
    values (
      ${organization.id}, ${communitySpace.id}, ${communityAuthor.id},
      'Attachment invariants', 'Attachment invariants'
    ) returning id
  `;
  const [postAssetId] = await testClient<[{ id: string }]>`
    select gen_random_uuid() as id
  `;
  await testClient`
    insert into media_assets (
      id, organization_id, uploaded_by_id, owner_user_id, purpose, kind,
      status, storage_driver, storage_key, staging_storage_key,
      original_file_name, safe_file_name, declared_mime_type,
      detected_mime_type, declared_size_bytes, actual_size_bytes, quota_bytes,
      upload_expires_at, uploaded_at, scan_completed_at
    ) values (
      ${postAssetId.id}, ${organization.id}, ${communityAuthor.id},
      ${communityAuthor.id}, 'community', 'image', 'ready', 'filesystem',
      ${`tenants/${organization.id}/assets/${postAssetId.id}/ready.jpg`},
      ${`incoming/tenants/${organization.id}/assets/${postAssetId.id}/incoming.jpg`},
      'post.jpg', 'post.jpg', 'image/jpeg', 'image/jpeg', 128, 128, 128,
      now() + interval '1 hour', now(), now()
    )
  `;
  await testClient`
    insert into community_post_attachments (
      organization_id, post_id, media_asset_id, sort_order
    ) values (${organization.id}, ${communityPost.id}, ${postAssetId.id}, 0)
  `;
  await expectDatabaseError(
    () =>
      testClient!`
        update community_asset_bindings set created_at = now()
        where media_asset_id = ${postAssetId.id}
      `,
    ["55000"],
    "Direct community binding registry update",
  );
  await expectDatabaseError(
    () =>
      testClient!`
        update media_assets set status = 'failed'
        where id = ${postAssetId.id}
      `,
    ["55000"],
    "Bound community asset status immutability",
  );
  await expectDatabaseError(
    () =>
      testClient!`
        update community_post_attachments set created_at = now() + interval '1 second'
        where media_asset_id = ${postAssetId.id}
      `,
    ["55000"],
    "Immutable community post attachment",
  );
  await expectDatabaseError(
    () =>
      testClient!`
        update posts set author_id = ${communityOther.id}
        where id = ${communityPost.id}
      `,
    ["55000"],
    "Community attachment author invariant",
  );
  await testClient`delete from posts where id = ${communityPost.id}`;
  const [deletedPostAsset] = await testClient<
    [{ status: string; deletedAt: Date | null }]
  >`
    select status, deleted_at as "deletedAt"
    from media_assets where id = ${postAssetId.id}
  `;
  if (deletedPostAsset.status !== "deleted" || !deletedPostAsset.deletedAt) {
    throw new Error("Post cascade did not soft-delete its community asset.");
  }

  const [racePost] = await testClient<[{ id: string }]>`
    insert into posts (organization_id, space_id, author_id, title, content)
    values (
      ${organization.id}, ${communitySpace.id}, ${communityAuthor.id},
      'Attachment race', 'Attachment race'
    ) returning id
  `;
  const [raceComment] = await testClient<[{ id: string }]>`
    insert into comments (organization_id, post_id, author_id, content)
    values (
      ${organization.id}, ${racePost.id}, ${communityAuthor.id},
      'Attachment race comment'
    ) returning id
  `;
  const [raceAssetId] = await testClient<[{ id: string }]>`
    select gen_random_uuid() as id
  `;
  await testClient`
    insert into media_assets (
      id, organization_id, uploaded_by_id, owner_user_id, purpose, kind,
      status, storage_driver, storage_key, staging_storage_key,
      original_file_name, safe_file_name, declared_mime_type,
      detected_mime_type, declared_size_bytes, actual_size_bytes, quota_bytes,
      upload_expires_at, uploaded_at, scan_completed_at
    ) values (
      ${raceAssetId.id}, ${organization.id}, ${communityAuthor.id},
      ${communityAuthor.id}, 'community', 'image', 'ready', 'filesystem',
      ${`tenants/${organization.id}/assets/${raceAssetId.id}/ready.jpg`},
      ${`incoming/tenants/${organization.id}/assets/${raceAssetId.id}/incoming.jpg`},
      'race.jpg', 'race.jpg', 'image/jpeg', 'image/jpeg', 128, 128, 128,
      now() + interval '1 hour', now(), now()
    )
  `;
  const communityRaceClientA = postgres(testUrl.toString(), { max: 1 });
  const communityRaceClientB = postgres(testUrl.toString(), { max: 1 });
  concurrentClients.push(communityRaceClientA, communityRaceClientB);
  const attachmentRace = await withTimeout(
    Promise.allSettled([
      communityRaceClientA.begin(
        (tx) =>
          tx`
          insert into community_post_attachments (
            organization_id, post_id, media_asset_id, sort_order
          ) values (
            ${organization.id}, ${racePost.id}, ${raceAssetId.id}, 0
          )
        `,
      ),
      communityRaceClientB.begin(
        (tx) =>
          tx`
          insert into community_comment_attachments (
            organization_id, comment_id, post_id, media_asset_id, sort_order
          ) values (
            ${organization.id}, ${raceComment.id}, ${racePost.id},
            ${raceAssetId.id}, 0
          )
        `,
      ),
    ]),
    10_000,
    "community cross-table attachment race",
  );
  const attachmentRaceFailures = attachmentRace.filter(
    (result) => result.status === "rejected",
  );
  if (
    attachmentRace.filter((result) => result.status === "fulfilled").length !==
      1 ||
    attachmentRaceFailures.length !== 1 ||
    databaseErrorCode(attachmentRaceFailures[0].reason) !== "23505"
  ) {
    throw new Error(
      "Community cross-table attachment race did not serialize to one binding.",
    );
  }
  await testClient`delete from posts where id = ${racePost.id}`;
  const [deletedRaceAsset] = await testClient<[{ status: string }]>`
    select status from media_assets where id = ${raceAssetId.id}
  `;
  if (deletedRaceAsset.status !== "deleted") {
    throw new Error("Comment/post cascade did not soft-delete raced asset.");
  }

  const [cascadeOrganization] = await testClient<[{ id: string }]>`
    insert into organizations (name, slug)
    values ('Community cascade tenant', 'community-cascade-tenant')
    returning id
  `;
  const [cascadeUser] = await testClient<[{ id: string }]>`
    insert into users (
      organization_id, email, password_hash, first_name, last_name
    ) values (
      ${cascadeOrganization.id}, 'cascade-community@example.test',
      'unusable', 'Cascade', 'Community'
    ) returning id
  `;
  const [cascadeArea] = await testClient<[{ id: string }]>`
    insert into community_areas (organization_id, title, slug, sort_order)
    values (${cascadeOrganization.id}, 'Allgemein', 'allgemein', 0)
    returning id
  `;
  const [cascadeSpace] = await testClient<[{ id: string }]>`
    insert into community_spaces (
      organization_id, area_id, title, slug, sort_order
    ) values (
      ${cascadeOrganization.id}, ${cascadeArea.id}, 'Cascade space',
      'cascade-space', 0
    )
    returning id
  `;
  const [cascadePost] = await testClient<[{ id: string }]>`
    insert into posts (organization_id, space_id, author_id, content)
    values (
      ${cascadeOrganization.id}, ${cascadeSpace.id}, ${cascadeUser.id},
      'Cascade post'
    ) returning id
  `;
  const [cascadeAssetId] = await testClient<[{ id: string }]>`
    select gen_random_uuid() as id
  `;
  await testClient`
    insert into media_assets (
      id, organization_id, uploaded_by_id, owner_user_id, purpose, kind,
      status, storage_driver, storage_key, staging_storage_key,
      original_file_name, safe_file_name, declared_mime_type,
      detected_mime_type, declared_size_bytes, actual_size_bytes, quota_bytes,
      upload_expires_at, uploaded_at, scan_completed_at
    ) values (
      ${cascadeAssetId.id}, ${cascadeOrganization.id}, ${cascadeUser.id},
      ${cascadeUser.id}, 'community', 'image', 'ready', 'filesystem',
      ${`tenants/${cascadeOrganization.id}/assets/${cascadeAssetId.id}/ready.jpg`},
      ${`incoming/tenants/${cascadeOrganization.id}/assets/${cascadeAssetId.id}/incoming.jpg`},
      'cascade.jpg', 'cascade.jpg', 'image/jpeg', 'image/jpeg',
      128, 128, 128, now() + interval '1 hour', now(), now()
    )
  `;
  await testClient`
    insert into community_post_attachments (
      organization_id, post_id, media_asset_id, sort_order
    ) values (
      ${cascadeOrganization.id}, ${cascadePost.id}, ${cascadeAssetId.id}, 0
    )
  `;
  await testClient`
    delete from organizations where id = ${cascadeOrganization.id}
  `;
  const [cascadeResidue] = await testClient<[{ count: number }]>`
    select (
      (select count(*) from community_asset_bindings
        where organization_id = ${cascadeOrganization.id}) +
      (select count(*) from media_assets
        where organization_id = ${cascadeOrganization.id})
    )::int as count
  `;
  if (cascadeResidue.count !== 0) {
    throw new Error("Tenant cascade left community media registry residue.");
  }

  const validExam = await testClient.begin(async (tx) => {
    const [learningModule] = await tx<[{ id: string }]>`
      insert into modules (organization_id, title, kind)
      values (${organization.id}, 'Valid exam', 'exam')
      returning id
    `;
    const [lesson] = await tx<[{ id: string }]>`
      insert into lessons (
        organization_id, module_id, title, slug, type, section_id
      ) values (
        ${organization.id}, ${learningModule.id}, 'Valid exam',
        'valid-exam', 'exam', null
      )
      returning id
    `;
    const [page] = await tx<[{ id: string }]>`
      insert into lesson_pages (lesson_id, title, slug, sort_order)
      values (${lesson.id}, 'Valid exam', 'valid-exam', 0)
      returning id
    `;
    return {
      moduleId: learningModule.id,
      lessonId: lesson.id,
      pageId: page.id,
    };
  });

  await expectConstraintViolation(
    () =>
      testClient!.begin(async (tx) => {
        await tx`
          insert into module_sections (organization_id, module_id, title)
          values (${organization.id}, ${validExam.moduleId}, 'Forbidden section')
        `;
      }),
    "Exam section insert",
  );
  await expectConstraintViolation(
    () =>
      testClient!.begin(async (tx) => {
        await tx`
          insert into lessons (
            organization_id, module_id, title, slug, type, section_id
          ) values (
            ${organization.id}, ${validExam.moduleId}, 'Second exam',
            'second-exam', 'exam', null
          )
        `;
      }),
    "Second exam lesson insert",
  );
  await expectConstraintViolation(
    () =>
      testClient!.begin(async (tx) => {
        await tx`delete from lesson_pages where id = ${validExam.pageId}`;
      }),
    "Last exam page delete",
  );
  await expectConstraintViolation(
    () =>
      testClient!.begin(async (tx) => {
        await tx`
          insert into modules (organization_id, title, kind)
          values (${organization.id}, 'Exam without content', 'exam')
        `;
      }),
    "Empty exam module insert",
  );

  const [sourceCourse] = await testClient<[{ id: string }]>`
    insert into courses (
      organization_id, title, slug, short_description, description
    ) values (
      ${organization.id}, 'Link source', 'link-source', 'Source', 'Source'
    )
    returning id
  `;
  const [targetCourse] = await testClient<[{ id: string }]>`
    insert into courses (
      organization_id, title, slug, short_description, description
    ) values (
      ${organization.id}, 'Link target', 'link-target', 'Target', 'Target'
    )
    returning id
  `;
  const [linkModule] = await testClient<[{ id: string }]>`
    insert into modules (
      organization_id, title, kind, linked_course_id
    ) values (
      ${organization.id}, 'Open target', 'link', ${targetCourse.id}
    )
    returning id
  `;
  await testClient`
    insert into course_modules (
      organization_id, course_id, module_id, sort_order, indent_level,
      is_required
    ) values (
      ${organization.id}, ${sourceCourse.id}, ${linkModule.id}, 0, 0, false
    )
  `;

  await expectConstraintViolation(
    () =>
      testClient!.begin(async (tx) => {
        await tx`
          insert into lessons (
            organization_id, module_id, title, slug, type
          ) values (
            ${organization.id}, ${linkModule.id}, 'Forbidden content',
            'forbidden-content', 'lesson'
          )
        `;
      }),
    "Link lesson insert",
  );
  await expectConstraintViolation(
    () =>
      testClient!.begin(async (tx) => {
        await tx`
          update course_modules
          set is_required = true
          where course_id = ${sourceCourse.id}
            and module_id = ${linkModule.id}
        `;
      }),
    "Required link module",
  );
  await expectConstraintViolation(
    () =>
      testClient!.begin(async (tx) => {
        await tx`
          update course_modules
          set indent_level = 1
          where course_id = ${sourceCourse.id}
            and module_id = ${linkModule.id}
        `;
      }),
    "Indented first module",
  );
  await expectDatabaseError(
    () =>
      testClient!`
        update course_modules
        set indent_level = 4
        where course_id = ${sourceCourse.id}
          and module_id = ${linkModule.id}
      `,
    ["23514"],
    "Indent level above three",
  );

  const [outlineModule] = await testClient<[{ id: string }]>`
    insert into modules (organization_id, title, kind)
    values (${organization.id}, 'Outline child', 'learning')
    returning id
  `;
  await expectConstraintViolation(
    () =>
      testClient!.begin(async (tx) => {
        await tx`
          insert into course_modules (
            organization_id, course_id, module_id, sort_order, indent_level
          ) values (
            ${organization.id}, ${sourceCourse.id}, ${outlineModule.id}, 1, 2
          )
        `;
      }),
    "Outline jump above one level",
  );

  const [selfLink] = await testClient<[{ id: string }]>`
    insert into modules (
      organization_id, title, kind, linked_course_id
    ) values (
      ${organization.id}, 'Self link', 'link', ${sourceCourse.id}
    )
    returning id
  `;
  await expectConstraintViolation(
    () =>
      testClient!.begin(async (tx) => {
        await tx`
          insert into course_modules (
            organization_id, course_id, module_id, sort_order, is_required
          ) values (
            ${organization.id}, ${sourceCourse.id}, ${selfLink.id}, 1, false
          )
        `;
      }),
    "Self course link",
  );

  await expectConstraintViolation(
    () =>
      testClient!.begin(async (tx) => {
        const [reverseLink] = await tx<[{ id: string }]>`
          insert into modules (
            organization_id, title, kind, linked_course_id
          ) values (
            ${organization.id}, 'Reverse link', 'link', ${sourceCourse.id}
          )
          returning id
        `;
        await tx`
          insert into course_modules (
            organization_id, course_id, module_id, sort_order, is_required
          ) values (
            ${organization.id}, ${targetCourse.id}, ${reverseLink.id}, 0, false
          )
        `;
      }),
    "Cyclic draft course links",
  );

  const [foreignOrganization] = await testClient<[{ id: string }]>`
    insert into organizations (name, slug)
    values ('Foreign link tenant', 'foreign-link-tenant')
    returning id
  `;
  const [foreignCourse] = await testClient<[{ id: string }]>`
    insert into courses (
      organization_id, title, slug, short_description, description
    ) values (
      ${foreignOrganization.id}, 'Foreign target', 'foreign-target',
      'Foreign', 'Foreign'
    )
    returning id
  `;
  await expectDatabaseError(
    () =>
      testClient!`
        insert into modules (
          organization_id, title, kind, linked_course_id
        ) values (
          ${organization.id}, 'Cross tenant link', 'link', ${foreignCourse.id}
        )
      `,
    ["23503"],
    "Cross-tenant link target",
  );

  const [sourceVersion] = await testClient<[{ id: string }]>`
    insert into course_versions (
      organization_id, course_id, version, snapshot, published_at
    ) values (
      ${organization.id}, ${sourceCourse.id}, 1, '{}'::jsonb, now()
    )
    returning id
  `;
  const [targetVersion] = await testClient<[{ id: string }]>`
    insert into course_versions (
      organization_id, course_id, version, snapshot, published_at
    ) values (
      ${organization.id}, ${targetCourse.id}, 1, '{}'::jsonb, now()
    )
    returning id
  `;
  await testClient`
    insert into published_course_link_edges (
      organization_id, source_course_id, source_version_id, link_module_id,
      target_course_id
    ) values (
      ${organization.id}, ${sourceCourse.id}, ${sourceVersion.id},
      ${linkModule.id}, ${targetCourse.id}
    )
  `;
  await expectConstraintViolation(
    () =>
      testClient!.begin(async (tx) => {
        await tx`
          insert into published_course_link_edges (
            organization_id, source_course_id, source_version_id,
            link_module_id, target_course_id
          ) values (
            ${organization.id}, ${targetCourse.id}, ${targetVersion.id},
            ${selfLink.id}, ${sourceCourse.id}
          )
        `;
      }),
    "Cyclic published course links",
  );
  await expectDatabaseError(
    () => testClient!`delete from courses where id = ${targetCourse.id}`,
    ["23503"],
    "Published link target delete",
  );

  const [atomicOutlineCourse] = await testClient<[{ id: string }]>`
    insert into courses (
      organization_id, title, slug, short_description, description
    ) values (
      ${organization.id}, 'Atomic outline', 'atomic-outline',
      'Atomic outline', 'Atomic outline'
    )
    returning id
  `;
  const atomicOutlineModules = await testClient<Array<{ id: string }>>`
    insert into modules (organization_id, title, kind)
    values
      (${organization.id}, 'Outline 1', 'learning'),
      (${organization.id}, 'Outline 2', 'learning'),
      (${organization.id}, 'Outline 3', 'learning'),
      (${organization.id}, 'Outline 4', 'learning')
    returning id
  `;
  await testClient`
    insert into course_modules (
      organization_id, course_id, module_id, sort_order, indent_level
    ) values
      (${organization.id}, ${atomicOutlineCourse.id}, ${atomicOutlineModules[0].id}, 0, 0),
      (${organization.id}, ${atomicOutlineCourse.id}, ${atomicOutlineModules[1].id}, 1, 0),
      (${organization.id}, ${atomicOutlineCourse.id}, ${atomicOutlineModules[2].id}, 2, 0),
      (${organization.id}, ${atomicOutlineCourse.id}, ${atomicOutlineModules[3].id}, 3, 0)
  `;
  const desiredOutline = [0, 1, 2, 1];
  await testClient.begin(async (tx) => {
    await tx`select q_academy_lock_course_link_graph(${organization.id})`;
    for (const [sortOrder, learningModule] of atomicOutlineModules.entries()) {
      await tx`
        update course_modules
        set sort_order = ${sortOrder}, indent_level = ${desiredOutline[sortOrder]}
        where organization_id = ${organization.id}
          and course_id = ${atomicOutlineCourse.id}
          and module_id = ${learningModule.id}
      `;
    }
  });
  const atomicOutline = await testClient<Array<{ indentLevel: number }>>`
    select indent_level as "indentLevel"
    from course_modules
    where organization_id = ${organization.id}
      and course_id = ${atomicOutlineCourse.id}
    order by sort_order, module_id
  `;
  if (
    JSON.stringify(atomicOutline.map((row) => row.indentLevel)) !==
    JSON.stringify(desiredOutline)
  ) {
    throw new Error("Atomic valid outline was not persisted exactly.");
  }

  const raceClientA = postgres(testUrl.toString(), { max: 1 });
  const raceClientB = postgres(testUrl.toString(), { max: 1 });
  concurrentClients.push(raceClientA, raceClientB);

  const draftCourses = await testClient<Array<{ id: string }>>`
    insert into courses (
      organization_id, title, slug, short_description, description
    ) values
      (${organization.id}, 'Draft race A', 'draft-race-a', 'A', 'A'),
      (${organization.id}, 'Draft race B', 'draft-race-b', 'B', 'B')
    returning id
  `;
  const draftLinks = await testClient<Array<{ id: string }>>`
    insert into modules (
      organization_id, title, kind, linked_course_id
    ) values
      (${organization.id}, 'A to B', 'link', ${draftCourses[1].id}),
      (${organization.id}, 'B to A', 'link', ${draftCourses[0].id})
    returning id
  `;
  const draftRace = await withTimeout(
    Promise.allSettled([
      raceClientA.begin(async (tx) => {
        await tx.unsafe("set local statement_timeout = '5s'");
        await tx`select q_academy_lock_course_link_graph(${organization.id})`;
        await tx`
          insert into course_modules (
            organization_id, course_id, module_id, sort_order, is_required
          ) values (
            ${organization.id}, ${draftCourses[0].id}, ${draftLinks[0].id},
            0, false
          )
        `;
      }),
      raceClientB.begin(async (tx) => {
        await tx.unsafe("set local statement_timeout = '5s'");
        await tx`select q_academy_lock_course_link_graph(${organization.id})`;
        await tx`
          insert into course_modules (
            organization_id, course_id, module_id, sort_order, is_required
          ) values (
            ${organization.id}, ${draftCourses[1].id}, ${draftLinks[1].id},
            0, false
          )
        `;
      }),
    ]),
    10_000,
    "Concurrent draft counter-links",
  );
  expectOneConstraintRejection(draftRace, "Concurrent draft counter-links");

  const publishedCourses = await testClient<Array<{ id: string }>>`
    insert into courses (
      organization_id, title, slug, short_description, description
    ) values
      (${organization.id}, 'Published race A', 'published-race-a', 'A', 'A'),
      (${organization.id}, 'Published race B', 'published-race-b', 'B', 'B')
    returning id
  `;
  const publishedVersions: Array<{ id: string }> = [];
  for (const [version, course] of publishedCourses.entries()) {
    const [created] = await testClient<[{ id: string }]>`
      insert into course_versions (
        organization_id, course_id, version, snapshot, published_at
      ) values (
        ${organization.id}, ${course.id}, ${version + 1}, '{}'::jsonb, now()
      )
      returning id
    `;
    publishedVersions.push(created);
  }
  const publishedRace = await withTimeout(
    Promise.allSettled([
      raceClientA.begin(async (tx) => {
        await tx.unsafe("set local statement_timeout = '5s'");
        await tx`select q_academy_lock_course_link_graph(${organization.id})`;
        await tx`
          insert into published_course_link_edges (
            organization_id, source_course_id, source_version_id,
            link_module_id, target_course_id
          ) values (
            ${organization.id}, ${publishedCourses[0].id},
            ${publishedVersions[0].id}, ${draftLinks[0].id},
            ${publishedCourses[1].id}
          )
        `;
      }),
      raceClientB.begin(async (tx) => {
        await tx.unsafe("set local statement_timeout = '5s'");
        await tx`select q_academy_lock_course_link_graph(${organization.id})`;
        await tx`
          insert into published_course_link_edges (
            organization_id, source_course_id, source_version_id,
            link_module_id, target_course_id
          ) values (
            ${organization.id}, ${publishedCourses[1].id},
            ${publishedVersions[1].id}, ${draftLinks[1].id},
            ${publishedCourses[0].id}
          )
        `;
      }),
    ]),
    10_000,
    "Concurrent published counter-links",
  );
  expectOneConstraintRejection(
    publishedRace,
    "Concurrent published counter-links",
  );

  const retargetCourses = await testClient<Array<{ id: string }>>`
    insert into courses (
      organization_id, title, slug, short_description, description
    ) values
      (${organization.id}, 'Retarget source', 'retarget-source', 'S', 'S'),
      (${organization.id}, 'Retarget first', 'retarget-first', 'T1', 'T1'),
      (${organization.id}, 'Retarget second', 'retarget-second', 'T2', 'T2')
    returning id
  `;
  const [retargetLink] = await testClient<[{ id: string }]>`
    insert into modules (
      organization_id, title, kind, linked_course_id
    ) values (
      ${organization.id}, 'Retarget link', 'link', ${retargetCourses[1].id}
    )
    returning id
  `;
  await testClient`
    insert into course_modules (
      organization_id, course_id, module_id, sort_order, is_required
    ) values (
      ${organization.id}, ${retargetCourses[0].id}, ${retargetLink.id},
      0, false
    )
  `;
  const retargetOutlineRace = await withTimeout(
    Promise.allSettled([
      raceClientA.begin(async (tx) => {
        await tx.unsafe("set local statement_timeout = '5s'");
        await tx`select q_academy_lock_course_link_graph(${organization.id})`;
        await tx`
          update modules
          set linked_course_id = ${retargetCourses[2].id}
          where id = ${retargetLink.id}
        `;
        await tx`select pg_sleep(0.05)`;
      }),
      raceClientB.begin(async (tx) => {
        await tx.unsafe("set local statement_timeout = '5s'");
        await tx`select q_academy_lock_course_link_graph(${organization.id})`;
        await tx`
          update course_modules
          set sort_order = 0, indent_level = 0
          where course_id = ${retargetCourses[0].id}
            and module_id = ${retargetLink.id}
        `;
      }),
    ]),
    10_000,
    "Link retarget versus outline lock",
  );
  if (retargetOutlineRace.some((result) => result.status === "rejected")) {
    throw new Error(
      "Link retarget versus outline lock did not serialize cleanly.",
    );
  }

  const deleteOutlineRace = await withTimeout(
    Promise.allSettled([
      raceClientA.begin(async (tx) => {
        await tx.unsafe("set local statement_timeout = '5s'");
        await tx`select q_academy_lock_course_link_graph(${organization.id})`;
        await tx`
          delete from course_modules
          where course_id = ${retargetCourses[0].id}
            and module_id = ${retargetLink.id}
        `;
        await tx`select pg_sleep(0.05)`;
      }),
      raceClientB.begin(async (tx) => {
        await tx.unsafe("set local statement_timeout = '5s'");
        await tx`select q_academy_lock_course_link_graph(${organization.id})`;
        await tx`
          update course_modules
          set sort_order = 0, indent_level = 0
          where course_id = ${retargetCourses[0].id}
            and module_id = ${retargetLink.id}
        `;
      }),
    ]),
    10_000,
    "Link delete versus outline lock",
  );
  if (deleteOutlineRace.some((result) => result.status === "rejected")) {
    throw new Error(
      "Link delete versus outline lock did not serialize cleanly.",
    );
  }

  await expectConstraintViolation(
    () =>
      testClient!`
        insert into oidc_configurations (
          organization_id, enabled, display_name
        ) values (
          ${organization.id}, true, 'Enterprise Login'
        )
      `,
    "Enabled OIDC configuration without credentials",
  );
  await expectConstraintViolation(
    () =>
      testClient!`
        insert into oidc_configurations (
          organization_id, enabled, display_name, password_login_enabled
        ) values (
          ${organization.id}, false, 'Enterprise Login', false
        )
      `,
    "OIDC configuration without any login method",
  );
  await expectConstraintViolation(
    () =>
      testClient!`
        insert into oidc_configurations (
          organization_id, display_name, allowed_email_domains
        ) values (
          ${organization.id}, 'Enterprise Login', '{}'::jsonb
        )
      `,
    "OIDC configuration with non-array domains",
  );
  await expectConstraintViolation(
    () =>
      testClient!`
        insert into oidc_configurations (
          organization_id, display_name, auto_provision_members,
          allowed_email_domains
        ) values (
          ${organization.id}, 'Enterprise Login', true, '[]'::jsonb
        )
      `,
    "OIDC auto-provisioning without domains",
  );
  await expectConstraintViolation(
    () =>
      testClient!`
        insert into oidc_configurations (
          organization_id, display_name, client_secret_encrypted
        ) values (
          ${organization.id}, 'Enterprise Login', '{"v":2}'::jsonb
        )
      `,
    "OIDC malformed encrypted secret",
  );

  await testClient`
    insert into oidc_configurations (
      organization_id, enabled, display_name, issuer, client_id,
      client_secret_encrypted, allowed_email_domains
    ) values (
      ${organization.id}, true, 'Enterprise Login',
      'https://identity.example.test/tenant', 'q-academy-test',
      '{"v":2,"kid":"migration-test","iv":"iv","tag":"tag","ciphertext":"ciphertext"}'::jsonb,
      '["example.test"]'::jsonb
    )
  `;
  const [oidcUser] = await testClient<[{ id: string }]>`
    insert into users (
      organization_id, email, password_hash, first_name, last_name
    ) values (
      ${organization.id}, 'oidc@example.test', 'unusable', 'OIDC', 'User'
    )
    returning id
  `;
  const [foreignOidcUser] = await testClient<[{ id: string }]>`
    insert into users (
      organization_id, email, password_hash, first_name, last_name
    ) values (
      ${foreignOrganization.id}, 'foreign-oidc@example.test', 'unusable',
      'Foreign', 'OIDC'
    )
    returning id
  `;
  await testClient`
    insert into oidc_identities (
      organization_id, user_id, issuer, subject, email_at_link
    ) values (
      ${organization.id}, ${oidcUser.id},
      'https://identity.example.test/tenant', 'subject-1',
      'oidc@example.test'
    )
  `;
  await expectDatabaseError(
    () =>
      testClient!`
        insert into oidc_identities (
          organization_id, user_id, issuer, subject, email_at_link
        ) values (
          ${organization.id}, ${foreignOidcUser.id},
          'https://identity.example.test/tenant', 'foreign-subject',
          'foreign-oidc@example.test'
        )
      `,
    ["23503"],
    "Cross-tenant OIDC identity",
  );
  await expectDatabaseError(
    () =>
      testClient!`
        insert into oidc_identities (
          organization_id, user_id, issuer, subject, email_at_link
        ) values (
          ${organization.id}, ${oidcUser.id},
          'https://identity.example.test/tenant', 'subject-1',
          'oidc@example.test'
        )
      `,
    ["23505"],
    "Duplicate OIDC subject",
  );

  await admin.unsafe(
    `drop database if exists "${freshDatabaseName}" with (force)`,
  );
  await admin.unsafe(
    `create database "${freshDatabaseName}" with template template0 encoding 'UTF8' lc_collate 'C' lc_ctype 'C'`,
  );
  freshTestClient = postgres(freshTestUrl.toString(), { max: 1 });
  await migrate(drizzle(freshTestClient), { migrationsFolder: "drizzle" });
  const [freshMigrationResult] = await freshTestClient<
    [{ tables: number; migrations: number }]
  >`
    select
      (
        select count(*)::int
        from information_schema.tables
        where table_schema = 'public'
      ) as tables,
      (
        select count(*)::int
        from drizzle.__drizzle_migrations
      ) as migrations
  `;
  if (
    freshMigrationResult.tables !== tables.count ||
    freshMigrationResult.migrations !== expectedMigrationCount
  ) {
    throw new Error(
      `Fresh migration result diverged: ${freshMigrationResult.tables} tables, ${freshMigrationResult.migrations} migrations.`,
    );
  }
  const [freshOrganization] = await freshTestClient<[{ id: string }]>`
    insert into organizations (name, slug)
    values ('Fresh moderation tenant', 'fresh-moderation-tenant')
    returning id
  `;
  const [freshUser] = await freshTestClient<
    [{ id: string; communityPoints: number }]
  >`
    insert into users (
      organization_id, email, password_hash, first_name, last_name
    ) values (
      ${freshOrganization.id}, 'fresh-moderation@example.test',
      'not-a-secret', 'Fresh', 'Moderator'
    ) returning id, community_points as "communityPoints"
  `;
  if (freshUser.communityPoints !== 0) {
    throw new Error("Fresh users did not receive a zero community score.");
  }
  const [freshOtherUser] = await freshTestClient<[{ id: string }]>`
    insert into users (
      organization_id, email, password_hash, first_name, last_name
    ) values (
      ${freshOrganization.id}, 'fresh-community-actor@example.test',
      'not-a-secret', 'Fresh', 'Actor'
    ) returning id
  `;
  const [freshArea] = await freshTestClient<[{ id: string }]>`
    insert into community_areas (organization_id, title, slug, sort_order)
    values (${freshOrganization.id}, 'Allgemein', 'allgemein', 0)
    returning id
  `;
  const [freshSpace] = await freshTestClient<[{ id: string }]>`
    insert into community_spaces (
      organization_id, area_id, title, slug, sort_order
    ) values (
      ${freshOrganization.id}, ${freshArea.id}, 'Fresh community',
      'fresh-community', 0
    )
    returning id
  `;
  const [freshDefaultPost] = await freshTestClient<
    [{ id: string; moderationState: string; publishedAt: Date | null }]
  >`
    insert into posts (organization_id, space_id, author_id, content)
    values (
      ${freshOrganization.id}, ${freshSpace.id}, ${freshUser.id},
      'Fresh default-visible post'
    )
    returning id, moderation_state as "moderationState",
              published_at as "publishedAt"
  `;
  if (
    freshDefaultPost.moderationState !== "published" ||
    !freshDefaultPost.publishedAt
  ) {
    throw new Error("Fresh migration did not install public content defaults.");
  }
  await expectConstraintViolation(
    () =>
      freshTestClient!`
        update users set points = -1 where id = ${freshUser.id}
      `,
    "Fresh users points nonnegative invariant",
  );
  await expectConstraintViolation(
    () =>
      freshTestClient!`
        update users set community_points = -1 where id = ${freshUser.id}
      `,
    "Fresh users community points nonnegative invariant",
  );
  await freshTestClient`
    insert into post_likes (organization_id, post_id, user_id, reaction)
    values (
      ${freshOrganization.id}, ${freshDefaultPost.id}, ${freshOtherUser.id},
      'like'
    )
  `;
  await freshTestClient`
    insert into community_score_contributions (
      organization_id, recipient_id, actor_id, kind, post_id, points
    ) values (
      ${freshOrganization.id}, ${freshUser.id}, ${freshOtherUser.id},
      'post_reaction', ${freshDefaultPost.id}, 1
    )
  `;
  const [freshScore] = await freshTestClient<[{ communityPoints: number }]>`
    select community_points as "communityPoints"
    from users where id = ${freshUser.id}
  `;
  if (freshScore.communityPoints !== 1) {
    throw new Error("Fresh community score trigger was not installed.");
  }
  await freshTestClient`
    delete from post_likes
    where organization_id = ${freshOrganization.id}
      and post_id = ${freshDefaultPost.id}
      and user_id = ${freshOtherUser.id}
  `;
  const [freshReversedScore] = await freshTestClient<
    [{ communityPoints: number }]
  >`
    select community_points as "communityPoints"
    from users where id = ${freshUser.id}
  `;
  if (freshReversedScore.communityPoints !== 0) {
    throw new Error("Fresh community score source cascade was not installed.");
  }

  await testClient`delete from organizations where id = ${organization.id}`;
  await testClient`
    delete from organizations where id = ${foreignOrganization.id}
  `;
  console.log(
    `Migration smoke passed: ${tables.count} public tables, ${migrations.count} migrations, exam/link/outline/OIDC constraints enforced.`,
  );
} finally {
  rmSync(stagedMigrationFolder, { recursive: true, force: true });
  await Promise.all(concurrentClients.map((client) => client.end()));
  if (freshTestClient) await freshTestClient.end();
  if (testClient) await testClient.end();
  await admin.unsafe(
    `drop database if exists "${freshDatabaseName}" with (force)`,
  );
  await admin.unsafe(`drop database if exists "${databaseName}" with (force)`);
  await admin.end();
}
