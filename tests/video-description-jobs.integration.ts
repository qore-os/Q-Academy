import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";

import { sql as drizzleSql } from "drizzle-orm";
import postgres from "postgres";

import { db, postgresClient } from "../src/db/index";
import {
  cleanupTerminalVideoDescriptionJobs,
  enqueueCopiedVideoDescriptionJobsInTransaction,
  enqueueVideoDescriptionJobInTransaction,
  processVideoDescriptionJobs,
} from "../src/lib/ai/video-description-jobs";
import { enqueueReadyTranscriptInTransaction } from "../src/lib/media/processing-worker";
import { privacySubjectReference } from "../src/lib/privacy/subject-reference";
import {
  applyMemberErasure,
  buildMemberErasureMediaPlan,
} from "../src/lib/privacy/erasure-executor";
import { createPrivacyLegalHold } from "../src/lib/privacy/request-service";
import { buildUserDataExport } from "../scripts/export-user-data";

process.env.AI_API_KEY ??= "integration-video-description-key";
process.env.PRIVACY_SUBJECT_HMAC_SECRET ??=
  "integration-video-description-privacy-hmac-secret-2026";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";
const cleanupDatabaseUrl = new URL(
  process.env.POSTGRES_ADMIN_URL ?? databaseUrl,
);
cleanupDatabaseUrl.pathname = new URL(databaseUrl).pathname;
const sql = postgres(databaseUrl, { max: 4, prepare: false });
const cleanupSql = postgres(cleanupDatabaseUrl.toString(), {
  max: 1,
  prepare: false,
});
const originalFetch = globalThis.fetch;

type Fixture = {
  organizationId: string;
  userId: string;
  courseId: string;
  moduleId: string;
  lessonId: string;
  blockId: string;
  assetId: string;
  digest: string;
};

function providerResponse(description: string) {
  return new Response(
    JSON.stringify({ choices: [{ message: { content: description } }] }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

async function createFixture(input?: {
  caption?: string;
  organizationId?: string;
  userId?: string;
}) {
  const organizationId = input?.organizationId ?? randomUUID();
  const userId = input?.userId ?? randomUUID();
  const courseId = randomUUID();
  const moduleId = randomUUID();
  const lessonId = randomUUID();
  const blockId = randomUUID();
  const assetId = randomUUID();
  const digest = "a".repeat(64);
  if (!input?.organizationId) {
    await sql`
      insert into organizations (id, name, slug)
      values (
        ${organizationId}, 'Description jobs',
        ${`description-jobs-${organizationId.slice(0, 8)}`}
      )
    `;
  }
  if (!input?.userId) {
    await sql`
      insert into users (
        id, organization_id, email, password_hash, first_name, last_name,
        role, status
      ) values (
        ${userId}, ${organizationId},
        ${`description-${userId}@example.test`}, 'credential',
        'Video', 'Author', 'owner', 'active'
      )
    `;
  }
  await sql`
    insert into courses (
      id, organization_id, title, slug, short_description, description,
      created_by_id
    ) values (
      ${courseId}, ${organizationId}, 'Video course',
      ${`video-course-${courseId.slice(0, 8)}`}, 'Short', 'Description',
      ${userId}
    )
  `;
  await sql`
    insert into modules (id, organization_id, title, is_reusable)
    values (${moduleId}, ${organizationId}, 'Shared video module', true)
  `;
  await sql`
    insert into course_modules (organization_id, course_id, module_id, sort_order)
    values (${organizationId}, ${courseId}, ${moduleId}, 0)
  `;
  await sql`
    insert into lessons (id, organization_id, module_id, title, slug)
    values (
      ${lessonId}, ${organizationId}, ${moduleId}, 'Video lesson',
      ${`video-lesson-${lessonId.slice(0, 8)}`}
    )
  `;
  await sql`
    insert into media_assets (
      id, organization_id, uploaded_by_id, purpose, kind, status,
      storage_driver, storage_key, staging_storage_key, original_file_name,
      safe_file_name, declared_mime_type, detected_mime_type,
      declared_size_bytes, actual_size_bytes, duration_milliseconds,
      quota_bytes, content_sha256, upload_expires_at, uploaded_at,
      scan_completed_at
    ) values (
      ${assetId}, ${organizationId}, ${userId}, 'course_content', 'video',
      'ready', 'filesystem',
      ${`tenants/${organizationId}/assets/${assetId}/video.mp4`},
      ${`incoming/tenants/${organizationId}/assets/${assetId}/video.mp4`},
      'video.mp4', 'video.mp4', 'video/mp4', 'video/mp4', 20, 20, 10000,
      20, ${digest}, now() + interval '1 hour', now(), now()
    )
  `;
  await sql`
    insert into content_blocks (
      id, lesson_id, type, title, data, revision
    ) values (
      ${blockId}, ${lessonId}, 'video', 'Durable video',
      ${sql.json({
        mediaAssetId: assetId,
        mediaAssetName: "video.mp4",
        caption: input?.caption ?? "",
        videoDescriptionIntent: "automatic",
      })},
      1
    )
  `;
  await sql`
    insert into course_media_assets (
      organization_id, course_id, media_asset_id, attached_by_id
    ) values (
      ${organizationId}, ${courseId}, ${assetId}, ${userId}
    )
  `;
  return {
    organizationId,
    userId,
    courseId,
    moduleId,
    lessonId,
    blockId,
    assetId,
    digest,
  } satisfies Fixture;
}

async function enqueueFixture(fixture: Fixture, language = "de") {
  return db.transaction(async (transaction) => {
    const transcriptJob = await enqueueReadyTranscriptInTransaction(
      transaction,
      {
        organizationId: fixture.organizationId,
        sourceAssetId: fixture.assetId,
        sourceContentSha256: fixture.digest,
        requestedById: fixture.userId,
        language,
      },
    );
    const descriptionJob = await enqueueVideoDescriptionJobInTransaction(
      transaction,
      {
        organizationId: fixture.organizationId,
        originCourseId: fixture.courseId,
        blockId: fixture.blockId,
        sourceAssetId: fixture.assetId,
        sourceContentSha256: fixture.digest,
        expectedBlockRevision: 1,
        locale: "de",
        transcriptLanguage: language,
        requestedById: fixture.userId,
      },
    );
    return { transcriptJob, descriptionJob };
  });
}

async function completeTranscript(input: {
  fixture: Fixture;
  processingJobId: string;
  language?: string;
  text?: string;
}) {
  const language = input.language ?? "de";
  await sql`
    update media_processing_jobs
    set status = 'succeeded', result = ${sql.json({})}, completed_at = now(),
        updated_at = now()
    where id = ${input.processingJobId}
  `;
  await sql`
    insert into media_asset_transcripts (
      organization_id, source_asset_id, processing_job_id,
      source_content_sha256, language, provider, document
    ) values (
      ${input.fixture.organizationId}, ${input.fixture.assetId},
      ${input.processingJobId}, ${input.fixture.digest}, ${language},
      'integration-transcript',
      ${sql.json({
        version: 1,
        language,
        segments: [
          {
            startMs: 0,
            endMs: 2_000,
            text: input.text ?? "deutscher-inhalt",
          },
        ],
      })}
    )
  `;
}

async function forceJobDue(jobId: string) {
  await sql`
    update video_description_jobs
    set next_retry_at = now() - interval '1 second', updated_at = now()
    where id = ${jobId}
  `;
}

async function installBlockUpdateFault(
  blockId: string,
  mode: "once" | "always",
) {
  await sql.unsafe("drop trigger if exists test_video_description_apply_fault on content_blocks");
  await sql.unsafe("drop function if exists test_video_description_apply_fault()");
  await sql.unsafe("drop sequence if exists test_video_description_apply_fault_seq");
  await sql.unsafe("create sequence test_video_description_apply_fault_seq start 1");
  await sql.unsafe(`
    create function test_video_description_apply_fault() returns trigger
    language plpgsql as $$
    begin
      if new.id = '${blockId}'::uuid
         and coalesce(new.data->>'caption', '') <> ''
         and (${mode === "always" ? "true" : "nextval('test_video_description_apply_fault_seq') = 1"})
      then
        raise exception 'description apply fault';
      end if;
      return new;
    end $$
  `);
  await sql.unsafe(`
    create trigger test_video_description_apply_fault
    before update on content_blocks
    for each row execute function test_video_description_apply_fault()
  `);
}

async function removeBlockUpdateFault() {
  await sql.unsafe("drop trigger if exists test_video_description_apply_fault on content_blocks");
  await sql.unsafe("drop function if exists test_video_description_apply_fault()");
  await sql.unsafe("drop sequence if exists test_video_description_apply_fault_seq");
}

after(async () => {
  globalThis.fetch = originalFetch;
  await removeBlockUpdateFault().catch(() => undefined);
  await Promise.all([
    sql.end({ timeout: 5 }),
    cleanupSql.end({ timeout: 5 }),
    postgresClient.end({ timeout: 5 }),
  ]);
});

test("saved auto-description intent survives close and uses the exact later transcript", async () => {
  const fixture = await createFixture();
  try {
    const queued = await enqueueFixture(fixture, "de");
    assert.deepEqual(await processVideoDescriptionJobs(1), ["waiting"]);
    await completeTranscript({
      fixture,
      processingJobId: queued.transcriptJob.id,
      language: "de",
      text: "deutscher-inhalt",
    });
    const englishJob = await db.transaction((transaction) =>
      enqueueReadyTranscriptInTransaction(transaction, {
        organizationId: fixture.organizationId,
        sourceAssetId: fixture.assetId,
        sourceContentSha256: fixture.digest,
        requestedById: fixture.userId,
        language: "en",
      }),
    );
    await completeTranscript({
      fixture,
      processingJobId: englishJob.id,
      language: "en",
      text: "newer-english-content",
    });
    let providerCalls = 0;
    let requestBody = "";
    globalThis.fetch = async (_input, init) => {
      providerCalls += 1;
      requestBody = String(init?.body ?? "");
      return providerResponse("Automatisch erstellte Beschreibung.");
    };
    await forceJobDue(queued.descriptionJob.id);
    assert.deepEqual(await processVideoDescriptionJobs(1), ["succeeded"]);
    assert.equal(providerCalls, 1);
    assert.match(requestBody, /deutscher-inhalt/);
    assert.doesNotMatch(requestBody, /newer-english-content/);
    const [block] = await sql<Array<{ data: { caption?: string }; revision: number }>>`
      select data, revision from content_blocks where id = ${fixture.blockId}
    `;
    assert.equal(block?.data.caption, "Automatisch erstellte Beschreibung.");
    assert.equal(block?.revision, 2);
    const [job] = await sql<
      Array<{ status: string; generatedDescription: string | null }>
    >`
      select status, generated_description as "generatedDescription"
      from video_description_jobs where id = ${queued.descriptionJob.id}
    `;
    assert.deepEqual(job, {
      status: "succeeded",
      generatedDescription: null,
    });
  } finally {
    await sql`delete from organizations where id = ${fixture.organizationId}`;
  }
});

test("copied videos keep saved and legacy English transcript jobs in a German course", async () => {
  const fixture = await createFixture();
  const legacyBlockId = randomUUID();
  const transcript = {
    version: 1 as const,
    language: "EN",
    segments: [{ startMs: 0, endMs: 2_000, text: "English source" }],
  };
  try {
    await sql`
      update content_blocks
      set data = ${sql.json({
        mediaAssetId: fixture.assetId,
        mediaAssetName: "video.mp4",
        caption: "",
        transcriptLanguage: "en",
        transcript,
        videoDescriptionIntent: "automatic",
      })}
      where id = ${fixture.blockId}
    `;
    await sql`
      insert into content_blocks (id, lesson_id, type, title, data, revision)
      values (
        ${legacyBlockId}, ${fixture.lessonId}, 'video', 'Legacy copied video',
        ${sql.json({
          mediaAssetId: fixture.assetId,
          mediaAssetName: "video.mp4",
          caption: "",
          transcript,
          videoDescriptionIntent: "automatic",
        })},
        1
      )
    `;
    const persistedBlocks = await sql<
      Array<{
        id: string;
        type: string;
        data: {
          mediaAssetId: string;
          caption: string;
          transcriptLanguage?: string;
          transcript?: typeof transcript;
          videoDescriptionIntent: "automatic";
        };
        revision: number;
      }>
    >`
      select id, type, data, revision
      from content_blocks
      where id in (${fixture.blockId}, ${legacyBlockId})
      order by id
    `;

    const jobs = await db.transaction((transaction) =>
      enqueueCopiedVideoDescriptionJobsInTransaction(transaction, {
        organizationId: fixture.organizationId,
        originCourseId: fixture.courseId,
        requestedById: fixture.userId,
        blocks: persistedBlocks,
        locale: "de",
      }),
    );

    assert.equal(jobs.length, 2);
    const transcriptJobs = await sql<
      Array<{ language: string | null }>
    >`
      select options->>'language' as language
      from media_processing_jobs
      where organization_id = ${fixture.organizationId}
        and source_asset_id = ${fixture.assetId}
        and type = 'transcript'
    `;
    assert.deepEqual([...transcriptJobs], [{ language: "en" }]);
    const descriptionJobs = await sql<
      Array<{ locale: string; transcriptLanguage: string }>
    >`
      select locale, transcript_language as "transcriptLanguage"
      from video_description_jobs
      where organization_id = ${fixture.organizationId}
      order by live_block_id
    `;
    assert.deepEqual([...descriptionJobs], [
      { locale: "de", transcriptLanguage: "en" },
      { locale: "de", transcriptLanguage: "en" },
    ]);
  } finally {
    await sql`delete from organizations where id = ${fixture.organizationId}`;
  }
});

test("manual caption and asset changes supersede queued output without provider use", async () => {
  for (const change of ["caption", "asset"] as const) {
    const fixture = await createFixture();
    try {
      const queued = await enqueueFixture(fixture);
      await completeTranscript({
        fixture,
        processingJobId: queued.transcriptJob.id,
      });
      if (change === "caption") {
        await sql`
          update content_blocks
          set data = jsonb_set(data, '{caption}', '"Manuell"'::jsonb),
              revision = revision + 1
          where id = ${fixture.blockId}
        `;
      } else {
        await sql`
          update content_blocks
          set data = jsonb_set(data, '{mediaAssetId}', to_jsonb(${randomUUID()}::text)),
              revision = revision + 1
          where id = ${fixture.blockId}
        `;
      }
      let providerCalls = 0;
      globalThis.fetch = async () => {
        providerCalls += 1;
        return providerResponse("Darf nicht erscheinen.");
      };
      assert.deepEqual(await processVideoDescriptionJobs(1), ["superseded"]);
      assert.equal(providerCalls, 0);
      const [job] = await sql<
        Array<{ status: string; generatedDescription: string | null }>
      >`
        select status, generated_description as "generatedDescription"
        from video_description_jobs where id = ${queued.descriptionJob.id}
      `;
      assert.deepEqual(job, {
        status: "superseded",
        generatedDescription: null,
      });
    } finally {
      await sql`delete from organizations where id = ${fixture.organizationId}`;
    }
  }
});

test("requester erasure during provider work prevents caption and attribution", async () => {
  const fixture = await createFixture();
  try {
    const queued = await enqueueFixture(fixture);
    await completeTranscript({
      fixture,
      processingJobId: queued.transcriptJob.id,
    });
    let releaseProvider!: () => void;
    let providerStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      providerStarted = resolve;
    });
    const released = new Promise<void>((resolve) => {
      releaseProvider = resolve;
    });
    globalThis.fetch = async () => {
      providerStarted();
      await released;
      return providerResponse("Verspaetete Beschreibung.");
    };
    const processing = processVideoDescriptionJobs(1);
    await started;
    await sql`
      update video_description_jobs
      set requested_by_id = null, updated_at = now()
      where id = ${queued.descriptionJob.id}
    `;
    releaseProvider();
    assert.deepEqual(await processing, ["superseded"]);
    const [block] = await sql<Array<{ data: { caption?: string } }>>`
      select data from content_blocks where id = ${fixture.blockId}
    `;
    assert.equal(block?.data.caption, "");
    const [job] = await sql<
      Array<{
        status: string;
        requestedById: string | null;
        generatedDescription: string | null;
      }>
    >`
      select status, requested_by_id as "requestedById",
             generated_description as "generatedDescription"
      from video_description_jobs where id = ${queued.descriptionJob.id}
    `;
    assert.deepEqual(job, {
      status: "superseded",
      requestedById: null,
      generatedDescription: null,
    });
    const [audit] = await sql<Array<{ count: number }>>`
      select count(*)::int as count from activity_events
      where organization_id = ${fixture.organizationId}
        and user_id = ${fixture.userId}
        and type = 'course.video_description.applied'
    `;
    assert.equal(audit?.count, 0);
  } finally {
    await sql`delete from organizations where id = ${fixture.organizationId}`;
  }
});

test("member erasure and description apply share the asset-before-job lock order", async () => {
  const fixture = await createFixture();
  let releaseBlockRow = () => {};
  let releaseJobTable = () => {};
  let blockTransaction: Promise<unknown> | undefined;
  let tableTransaction: Promise<unknown> | undefined;
  try {
    const queued = await enqueueFixture(fixture);
    await completeTranscript({
      fixture,
      processingJobId: queued.transcriptJob.id,
    });
    await sql`
      update video_description_jobs
      set generated_description = 'Bereits erzeugte Beschreibung.'
      where id = ${queued.descriptionJob.id}
    `;
    const mediaPlan = await buildMemberErasureMediaPlan({
      sql,
      organizationId: fixture.organizationId,
      subjectUserId: fixture.userId,
      snapshotAt: new Date(Date.now() + 60_000),
    });
    assert.deepEqual(
      mediaPlan.retainShared.map((asset) => asset.id),
      [fixture.assetId],
    );

    let blockReady!: (pid: number) => void;
    const blockReadyPromise = new Promise<number>((resolve) => {
      blockReady = resolve;
    });
    const blockRelease = new Promise<void>((resolve) => {
      releaseBlockRow = resolve;
    });
    blockTransaction = sql.begin(async (transaction) => {
      const [connection] = await transaction<Array<{ pid: number }>>`
        select pg_backend_pid()::int as pid
      `;
      await transaction`
        select id from content_blocks
        where id = ${fixture.blockId}
        for update
      `;
      blockReady(connection.pid);
      await blockRelease;
    });
    const blockPid = await blockReadyPromise;

    const processing = processVideoDescriptionJobs(1);
    const processingDeadline = Date.now() + 5_000;
    while (Date.now() < processingDeadline) {
      const [state] = await sql<Array<{ status: string }>>`
        select status from video_description_jobs
        where id = ${queued.descriptionJob.id}
      `;
      if (state?.status === "processing") break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const [claimed] = await sql<Array<{ status: string }>>`
      select status from video_description_jobs
      where id = ${queued.descriptionJob.id}
    `;
    assert.equal(claimed.status, "processing");
    const [workerBlockedOnBlock] = await sql<Array<{ blocked: boolean }>>`
      select exists(
        select 1 from pg_stat_activity activity
        where ${blockPid} = any(pg_blocking_pids(activity.pid))
      ) as blocked
    `;
    assert.equal(workerBlockedOnBlock.blocked, true);

    let tableReady!: (pid: number) => void;
    const tableReadyPromise = new Promise<number>((resolve) => {
      tableReady = resolve;
    });
    const tableRelease = new Promise<void>((resolve) => {
      releaseJobTable = resolve;
    });
    tableTransaction = sql.begin(async (transaction) => {
      const [connection] = await transaction<Array<{ pid: number }>>`
        select pg_backend_pid()::int as pid
      `;
      await transaction.unsafe(
        "lock table video_description_jobs in access exclusive mode",
      );
      tableReady(connection.pid);
      await tableRelease;
    });
    const tablePid = await tableReadyPromise;

    let erasureReady!: (pid: number) => void;
    const erasureReadyPromise = new Promise<number>((resolve) => {
      erasureReady = resolve;
    });
    const subjectReference = privacySubjectReference(
      fixture.organizationId,
      fixture.userId,
    );
    const erasure = db.transaction(async (transaction) => {
      const [connection] = await transaction.execute(
        drizzleSql`select pg_backend_pid()::int as pid`,
      );
      erasureReady(Number(connection!.pid));
      return applyMemberErasure({
        tx: transaction,
        organizationId: fixture.organizationId,
        subjectUserId: fixture.userId,
        subjectReference,
        mediaPlan,
        now: new Date(),
      });
    });
    const erasurePid = await erasureReadyPromise;
    const erasureDeadline = Date.now() + 5_000;
    let erasureBlocked = false;
    while (Date.now() < erasureDeadline) {
      const [state] = await sql<Array<{ blocked: boolean }>>`
        select ${tablePid} = any(pg_blocking_pids(${erasurePid})) as blocked
      `;
      if (state.blocked) {
        erasureBlocked = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(erasureBlocked, true);

    releaseBlockRow();
    await blockTransaction;
    const workerDeadline = Date.now() + 5_000;
    let workerBlockedOnErasure = false;
    while (Date.now() < workerDeadline) {
      const [state] = await sql<Array<{ blocked: boolean }>>`
        select exists(
          select 1 from pg_stat_activity activity
          where ${erasurePid} = any(pg_blocking_pids(activity.pid))
        ) as blocked
      `;
      if (state.blocked) {
        workerBlockedOnErasure = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(workerBlockedOnErasure, true);

    releaseJobTable();
    await tableTransaction;
    const completed = await Promise.race([
      Promise.all([processing, erasure]),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Description/erasure lock timeout.")), 10_000),
      ),
    ]);
    assert.deepEqual(completed[0], ["superseded"]);
    const [job] = await sql<
      Array<{
        status: string;
        requestedById: string | null;
        generatedDescription: string | null;
      }>
    >`
      select status, requested_by_id as "requestedById",
             generated_description as "generatedDescription"
      from video_description_jobs where id = ${queued.descriptionJob.id}
    `;
    assert.deepEqual(job, {
      status: "superseded",
      requestedById: null,
      generatedDescription: null,
    });
  } finally {
    releaseBlockRow();
    releaseJobTable();
    await Promise.allSettled(
      [blockTransaction, tableTransaction].filter(
        (promise): promise is Promise<unknown> => Boolean(promise),
      ),
    );
    globalThis.fetch = originalFetch;
    await sql`delete from organizations where id = ${fixture.organizationId}`;
  }
});

test("a transient apply fault reuses durable provider output exactly once", async () => {
  const fixture = await createFixture();
  try {
    const queued = await enqueueFixture(fixture);
    await completeTranscript({
      fixture,
      processingJobId: queued.transcriptJob.id,
    });
    await installBlockUpdateFault(fixture.blockId, "once");
    let providerCalls = 0;
    globalThis.fetch = async () => {
      providerCalls += 1;
      return providerResponse("Einmal bezahlte Beschreibung.");
    };
    assert.deepEqual(await processVideoDescriptionJobs(1), ["retrying"]);
    assert.equal(providerCalls, 1);
    await forceJobDue(queued.descriptionJob.id);
    assert.deepEqual(await processVideoDescriptionJobs(1), ["succeeded"]);
    assert.equal(providerCalls, 1);
    const [block] = await sql<Array<{ data: { caption?: string } }>>`
      select data from content_blocks where id = ${fixture.blockId}
    `;
    assert.equal(block?.data.caption, "Einmal bezahlte Beschreibung.");
  } finally {
    await removeBlockUpdateFault();
    await sql`delete from organizations where id = ${fixture.organizationId}`;
  }
});

test("permanent apply failure is bounded and cannot starve a newer job", async () => {
  const first = await createFixture();
  const second = await createFixture();
  try {
    const firstQueued = await enqueueFixture(first);
    const secondQueued = await enqueueFixture(second);
    await completeTranscript({
      fixture: first,
      processingJobId: firstQueued.transcriptJob.id,
    });
    await completeTranscript({
      fixture: second,
      processingJobId: secondQueued.transcriptJob.id,
    });
    await sql`
      update video_description_jobs set max_attempts = 2
      where id = ${firstQueued.descriptionJob.id}
    `;
    await installBlockUpdateFault(first.blockId, "always");
    let providerCalls = 0;
    globalThis.fetch = async () => {
      providerCalls += 1;
      return providerResponse(`Beschreibung ${providerCalls}`);
    };
    assert.deepEqual(await processVideoDescriptionJobs(1), ["retrying"]);
    assert.deepEqual(await processVideoDescriptionJobs(1), ["succeeded"]);
    const [secondBlock] = await sql<Array<{ data: { caption?: string } }>>`
      select data from content_blocks where id = ${second.blockId}
    `;
    assert.equal(secondBlock?.data.caption, "Beschreibung 2");
    await forceJobDue(firstQueued.descriptionJob.id);
    assert.deepEqual(await processVideoDescriptionJobs(1), ["failed"]);
    assert.equal(providerCalls, 2);
    const [failed] = await sql<
      Array<{
        status: string;
        attempt: number;
        generatedDescription: string | null;
      }>
    >`
      select status, attempt,
             generated_description as "generatedDescription"
      from video_description_jobs where id = ${firstQueued.descriptionJob.id}
    `;
    assert.deepEqual(failed, {
      status: "failed",
      attempt: 2,
      generatedDescription: null,
    });
  } finally {
    await removeBlockUpdateFault();
    await sql`delete from organizations where id in (${first.organizationId}, ${second.organizationId})`;
  }
});

test("terminal cleanup respects active learning holds and deletes released jobs", async () => {
  const held = await createFixture();
  const unheld = await createFixture();
  const holdId = randomUUID();
  try {
    const heldQueued = await enqueueFixture(held);
    const unheldQueued = await enqueueFixture(unheld);
    const sharedSubjectReference = "b".repeat(64);
    await sql`
      update video_description_jobs
      set status = 'succeeded', completed_at = now() - interval '31 days',
          updated_at = now() - interval '31 days',
          requester_subject_reference = ${sharedSubjectReference}
      where id in (${heldQueued.descriptionJob.id}, ${unheldQueued.descriptionJob.id})
    `;
    await sql`
      insert into privacy_legal_holds (
        id, organization_id, subject_user_id, subject_reference, scope,
        reference, reason, legal_basis, starts_at
      ) values (
        ${holdId}, ${held.organizationId}, ${held.userId},
        ${sharedSubjectReference},
        'learning', ${`hold-${holdId}`}, 'Integration retention',
        'Legal obligation', now() - interval '1 day'
      )
    `;
    assert.equal(await cleanupTerminalVideoDescriptionJobs(10), 1);
    const remaining = await sql<Array<{ id: string }>>`
      select id from video_description_jobs
      where id in (${heldQueued.descriptionJob.id}, ${unheldQueued.descriptionJob.id})
    `;
    assert.deepEqual(remaining.map((row) => row.id), [heldQueued.descriptionJob.id]);
    await sql`
      update privacy_legal_holds
      set released_at = now(), release_reason = 'Released', updated_at = now()
      where id = ${holdId}
    `;
    assert.equal(await cleanupTerminalVideoDescriptionJobs(10), 1);
  } finally {
    await sql`delete from organizations where id in (${held.organizationId}, ${unheld.organizationId})`;
  }
});

test("a held terminal job retains immutable history after its live parents are deleted", async () => {
  const fixture = await createFixture();
  const holdId = randomUUID();
  try {
    const queued = await enqueueFixture(fixture);
    const subjectReference = privacySubjectReference(
      fixture.organizationId,
      fixture.userId,
    );
    await sql`
      update video_description_jobs
      set status = 'succeeded', completed_at = now() - interval '31 days',
          updated_at = now() - interval '31 days'
      where id = ${queued.descriptionJob.id}
    `;
    await sql`
      insert into privacy_legal_holds (
        id, organization_id, subject_user_id, subject_reference, scope,
        reference, reason, legal_basis, starts_at
      ) values (
        ${holdId}, ${fixture.organizationId}, ${fixture.userId},
        ${subjectReference}, 'audit', ${`history-hold-${holdId}`},
        'Retain historic AI lifecycle', 'Legal obligation',
        now() - interval '1 day'
      )
    `;
    await sql`delete from content_blocks where id = ${fixture.blockId}`;
    await sql`
      delete from course_media_assets where media_asset_id = ${fixture.assetId}
    `;
    await sql`delete from media_assets where id = ${fixture.assetId}`;

    const [history] = await sql<
      Array<{
        blockReferenceId: string;
        sourceAssetReferenceId: string;
        requesterSubjectReference: string | null;
        liveBlockId: string | null;
        liveSourceAssetId: string | null;
      }>
    >`
      select block_reference_id as "blockReferenceId",
             source_asset_reference_id as "sourceAssetReferenceId",
             requester_subject_reference as "requesterSubjectReference",
             live_block_id as "liveBlockId",
             live_source_asset_id as "liveSourceAssetId"
      from video_description_jobs where id = ${queued.descriptionJob.id}
    `;
    assert.deepEqual(history, {
      blockReferenceId: fixture.blockId,
      sourceAssetReferenceId: fixture.assetId,
      requesterSubjectReference: subjectReference,
      liveBlockId: fixture.blockId,
      liveSourceAssetId: fixture.assetId,
    });
    assert.equal(await cleanupTerminalVideoDescriptionJobs(10), 0);
  } finally {
    await sql`delete from organizations where id = ${fixture.organizationId}`;
  }
});

test("a missing live block or source supersedes without provider use and clears cursors", async () => {
  for (const deletedParent of ["block", "asset"] as const) {
    const fixture = await createFixture();
    try {
      const queued = await enqueueFixture(fixture);
      if (deletedParent === "block") {
        await sql`delete from content_blocks where id = ${fixture.blockId}`;
      } else {
        await sql`
          delete from course_media_assets where media_asset_id = ${fixture.assetId}
        `;
        await sql`delete from media_assets where id = ${fixture.assetId}`;
      }
      let providerCalls = 0;
      globalThis.fetch = async () => {
        providerCalls += 1;
        return providerResponse("Must not be generated.");
      };
      assert.deepEqual(await processVideoDescriptionJobs(1), ["superseded"]);
      assert.equal(providerCalls, 0);
      const [job] = await sql<
        Array<{
          status: string;
          liveBlockId: string | null;
          liveSourceAssetId: string | null;
          blockReferenceId: string;
          sourceAssetReferenceId: string;
        }>
      >`
        select status, live_block_id as "liveBlockId",
               live_source_asset_id as "liveSourceAssetId",
               block_reference_id as "blockReferenceId",
               source_asset_reference_id as "sourceAssetReferenceId"
        from video_description_jobs where id = ${queued.descriptionJob.id}
      `;
      assert.deepEqual(job, {
        status: "superseded",
        liveBlockId: null,
        liveSourceAssetId: null,
        blockReferenceId: fixture.blockId,
        sourceAssetReferenceId: fixture.assetId,
      });
    } finally {
      globalThis.fetch = originalFetch;
      await sql`delete from organizations where id = ${fixture.organizationId}`;
    }
  }
});

test("cleanup observes a hold committed while it waits for the subject fence", async () => {
  const fixture = await createFixture();
  const queued = await enqueueFixture(fixture);
  const subjectReference = privacySubjectReference(
    fixture.organizationId,
    fixture.userId,
  );
  const requestId = randomUUID();
  let releaseBlocker!: () => void;
  const release = new Promise<void>((resolve) => {
    releaseBlocker = resolve;
  });
  let blockerReady!: (pid: number) => void;
  const ready = new Promise<number>((resolve) => {
    blockerReady = resolve;
  });
  try {
    await sql`
      update video_description_jobs
      set status = 'succeeded', completed_at = now() - interval '31 days',
          updated_at = now() - interval '31 days'
      where id = ${queued.descriptionJob.id}
    `;
    await sql`
      insert into privacy_requests (
        id, organization_id, subject_user_id, subject_reference,
        requested_by_id, client_request_id, type, status, due_at,
        policy_version, policy_snapshot
      ) values (
        ${requestId}, ${fixture.organizationId}, ${fixture.userId},
        ${subjectReference}, ${fixture.userId}, ${`hold-race-${requestId}`},
        'access_export', 'received', now() + interval '30 days',
        'privacy-dsar-v1', ${sql.json({ fixture: true })}
      )
    `;
    const blocker = sql.begin(async (transaction) => {
      const [connection] = await transaction<Array<{ pid: number }>>`
        select pg_backend_pid()::int as pid
      `;
      await transaction.unsafe(
        "lock table video_description_jobs in access exclusive mode",
      );
      blockerReady(connection.pid);
      await release;
    });
    const blockerPid = await ready;
    const cleanup = cleanupTerminalVideoDescriptionJobs(10);
    const deadline = Date.now() + 5_000;
    let isBlocked = false;
    while (Date.now() < deadline) {
      const [state] = await sql<Array<{ blocked: boolean }>>`
        select exists(
          select 1 from pg_stat_activity activity
          where ${blockerPid} = any(pg_blocking_pids(activity.pid))
        ) as blocked
      `;
      if (state.blocked) {
        isBlocked = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(isBlocked, true);
    await createPrivacyLegalHold(
      fixture.organizationId,
      requestId,
      { kind: "user", id: fixture.userId, userId: fixture.userId },
      {
        reference: `race-hold-${requestId}`,
        scope: "learning",
        reason: "Cleanup race",
        legalBasis: "Legal obligation",
      },
    );
    releaseBlocker();
    await blocker;
    assert.equal(await cleanup, 0);
    const [remaining] = await sql<Array<{ count: number }>>`
      select count(*)::int as count from video_description_jobs
      where id = ${queued.descriptionJob.id}
    `;
    assert.equal(remaining.count, 1);
  } finally {
    releaseBlocker?.();
    await cleanupSql.begin(async (transaction) => {
      await transaction.unsafe("set local session_replication_role = replica");
      await transaction`
        delete from privacy_request_events
        where organization_id = ${fixture.organizationId}
      `;
      await transaction.unsafe("set local session_replication_role = origin");
      await transaction`
        delete from organizations where id = ${fixture.organizationId}
      `;
    });
  }
});

test("member erasure only retains the requester reference under an active hold", async () => {
  for (const held of [false, true]) {
    const fixture = await createFixture();
    const queued = await enqueueFixture(fixture);
    const subjectReference = privacySubjectReference(
      fixture.organizationId,
      fixture.userId,
    );
    try {
      if (held) {
        await sql`
          insert into privacy_legal_holds (
            organization_id, subject_user_id, subject_reference, scope,
            reference, reason, legal_basis
          ) values (
            ${fixture.organizationId}, ${fixture.userId}, ${subjectReference},
            'audit', ${`erasure-hold-${fixture.userId}`}, 'Erasure evidence',
            'Legal obligation'
          )
        `;
      }
      await db.transaction((transaction) =>
        applyMemberErasure({
          tx: transaction,
          organizationId: fixture.organizationId,
          subjectUserId: fixture.userId,
          subjectReference,
          mediaPlan: { purge: [], retainShared: [] },
          now: new Date(Date.now() + 1_000),
        }),
      );
      const [job] = await sql<
        Array<{
          requestedById: string | null;
          requesterSubjectReference: string | null;
        }>
      >`
        select requested_by_id as "requestedById",
               requester_subject_reference as "requesterSubjectReference"
        from video_description_jobs where id = ${queued.descriptionJob.id}
      `;
      assert.deepEqual(job, {
        requestedById: null,
        requesterSubjectReference: held ? subjectReference : null,
      });
    } finally {
      await sql`delete from organizations where id = ${fixture.organizationId}`;
    }
  }
});

test("shared-module description survives deletion of its origin course", async () => {
  const fixture = await createFixture();
  const consumerCourseId = randomUUID();
  try {
    await sql`
      insert into courses (
        id, organization_id, title, slug, short_description, description,
        created_by_id
      ) values (
        ${consumerCourseId}, ${fixture.organizationId}, 'Consumer course',
        ${`consumer-course-${consumerCourseId.slice(0, 8)}`}, 'Short',
        'Description', ${fixture.userId}
      )
    `;
    await sql`
      insert into course_modules (
        organization_id, course_id, module_id, sort_order
      ) values (
        ${fixture.organizationId}, ${consumerCourseId}, ${fixture.moduleId}, 0
      )
    `;
    const queued = await enqueueFixture(fixture);
    await completeTranscript({
      fixture,
      processingJobId: queued.transcriptJob.id,
      text: "geteiltes-video",
    });
    await sql`delete from courses where id = ${fixture.courseId}`;
    let providerCalls = 0;
    globalThis.fetch = async () => {
      providerCalls += 1;
      return providerResponse("Beschreibung fuer den verbleibenden Kurs.");
    };

    assert.deepEqual(await processVideoDescriptionJobs(1), ["succeeded"]);
    assert.equal(providerCalls, 1);
    const [row] = await sql<
      Array<{
        caption: string;
        originCourseId: string | null;
        status: string;
      }>
    >`
      select b.data->>'caption' as caption,
             j.origin_course_id as "originCourseId", j.status
      from video_description_jobs j
      join content_blocks b on b.id = j.live_block_id
      where j.id = ${queued.descriptionJob.id}
    `;
    assert.deepEqual(row, {
      caption: "Beschreibung fuer den verbleibenden Kurs.",
      originCourseId: fixture.courseId,
      status: "succeeded",
    });
  } finally {
    globalThis.fetch = originalFetch;
    await sql`delete from organizations where id = ${fixture.organizationId}`;
  }
});

test("description is superseded before provider use after the last course detaches", async () => {
  const fixture = await createFixture();
  try {
    const queued = await enqueueFixture(fixture);
    await completeTranscript({
      fixture,
      processingJobId: queued.transcriptJob.id,
    });
    await sql`
      delete from course_modules
      where organization_id = ${fixture.organizationId}
        and course_id = ${fixture.courseId}
        and module_id = ${fixture.moduleId}
    `;
    let providerCalls = 0;
    globalThis.fetch = async () => {
      providerCalls += 1;
      return providerResponse("Darf nicht erstellt werden.");
    };

    assert.deepEqual(await processVideoDescriptionJobs(1), ["superseded"]);
    assert.equal(providerCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    await sql`delete from organizations where id = ${fixture.organizationId}`;
  }
});

test("enqueue rejects stale, mismatched, and foreign tenant cursors", async () => {
  const fixture = await createFixture();
  const foreign = await createFixture();
  try {
    const enqueue = (input: {
      courseId?: string;
      blockId?: string;
      assetId?: string;
      digest?: string;
      revision?: number;
    }) => db.transaction((transaction) =>
      enqueueVideoDescriptionJobInTransaction(transaction, {
        organizationId: fixture.organizationId,
        originCourseId: input.courseId ?? fixture.courseId,
        blockId: input.blockId ?? fixture.blockId,
        sourceAssetId: input.assetId ?? fixture.assetId,
        sourceContentSha256: input.digest ?? fixture.digest,
        expectedBlockRevision: input.revision ?? 1,
        locale: "de",
        transcriptLanguage: "de",
        requestedById: fixture.userId,
      }),
    );
    await assert.rejects(enqueue({ revision: 2 }), /context is unavailable/);
    await assert.rejects(
      enqueue({ assetId: foreign.assetId, digest: foreign.digest }),
      /context is unavailable/,
    );
    await assert.rejects(
      enqueue({ courseId: foreign.courseId }),
      /context is unavailable/,
    );
  } finally {
    await sql`delete from organizations where id in (${fixture.organizationId}, ${foreign.organizationId})`;
  }
});

test("user deletion only unlinks the live requester cursor", async () => {
  const fixture = await createFixture();
  try {
    const queued = await enqueueFixture(fixture);
    await sql`
      delete from course_media_assets where media_asset_id = ${fixture.assetId}
    `;
    await sql`delete from users where id = ${fixture.userId}`;
    const [job] = await sql<
      Array<{
        organizationId: string;
        requestedById: string | null;
        requesterSubjectReference: string | null;
      }>
    >`
      select organization_id as "organizationId",
             requested_by_id as "requestedById",
             requester_subject_reference as "requesterSubjectReference"
      from video_description_jobs where id = ${queued.descriptionJob.id}
    `;
    assert.deepEqual(job, {
      organizationId: fixture.organizationId,
      requestedById: null,
      requesterSubjectReference: privacySubjectReference(
        fixture.organizationId,
        fixture.userId,
      ),
    });
  } finally {
    await sql`delete from organizations where id = ${fixture.organizationId}`;
  }
});

test("DSAR exports only safe live-subject description lifecycle metadata", async () => {
  const fixture = await createFixture();
  const foreign = await createFixture();
  try {
    const queued = await enqueueFixture(fixture);
    const foreignQueued = await enqueueFixture(foreign);
    const exportBundle = (await buildUserDataExport(
      sql,
      `description-jobs-${fixture.organizationId.slice(0, 8)}`,
      `description-${fixture.userId}@example.test`,
    )) as {
      data: {
        learning: {
          videoDescriptionJobs: Array<Record<string, unknown>>;
        };
      };
    };
    const jobs = exportBundle.data.learning.videoDescriptionJobs;
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0]?.id, queued.descriptionJob.id);
    assert.notEqual(jobs[0]?.id, foreignQueued.descriptionJob.id);
    assert.equal(jobs[0]?.originCourseId, fixture.courseId);
    assert.equal(jobs[0]?.blockReferenceId, fixture.blockId);
    assert.equal(jobs[0]?.sourceAssetReferenceId, fixture.assetId);
    for (const internalField of [
      "requestKey",
      "sourceContentSha256",
      "claimToken",
      "generatedDescription",
      "requesterSubjectReference",
      "failureCode",
      "nextRetryAt",
    ]) {
      assert.equal(internalField in jobs[0]!, false);
    }
    await sql`delete from courses where id = ${fixture.courseId}`;
    const afterOriginDeletion = (await buildUserDataExport(
      sql,
      `description-jobs-${fixture.organizationId.slice(0, 8)}`,
      `description-${fixture.userId}@example.test`,
    )) as {
      data: {
        learning: {
          videoDescriptionJobs: Array<Record<string, unknown>>;
        };
      };
    };
    assert.equal(
      afterOriginDeletion.data.learning.videoDescriptionJobs[0]
        ?.originCourseId,
      null,
    );
    assert.equal(
      afterOriginDeletion.data.learning.videoDescriptionJobs[0]
        ?.blockReferenceId,
      fixture.blockId,
    );
  } finally {
    await sql`delete from organizations where id in (${fixture.organizationId}, ${foreign.organizationId})`;
  }
});
