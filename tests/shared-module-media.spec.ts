import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";
import postgres from "postgres";

import {
  MAX_AUTOMATIC_TRANSCRIPTION_DURATION_MS,
  TRANSCRIPT_PROCESSING_PROVIDER,
} from "../src/lib/media/transcription-contract";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";

test("shared video media remains manageable from every referencing course", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const sql = postgres(databaseUrl, { prepare: false });
  const suffix = randomUUID().slice(0, 8);
  const trainerEmail = `shared-media-${suffix}@example.test`;
  const moduleTitle = `Shared Media ${suffix}`;
  const sectionTitle = `Shared Section ${suffix}`;
  const blockTitle = `Shared Video ${suffix}`;
  const assetIds = {
    video: randomUUID(),
    poster: randomUUID(),
    audio: randomUUID(),
  };
  const overlongVideoId = randomUUID();
  const unboundVideoId = randomUUID();
  const unboundTranscriptJobId = randomUUID();
  const transcriptJobId = randomUUID();
  const currentTranscriptJobId = randomUUID();
  const transcriptRequestKey = randomUUID().replaceAll("-", "").repeat(2);
  const currentTranscriptRequestKey = randomUUID()
    .replaceAll("-", "")
    .repeat(2);
  let trainerId = "";
  let moduleId = "";
  let sourceCourseId = "";
  let targetCourseId = "";
  let blockId = "";
  let pageId = "";

  try {
    const [fixture] = await sql<
      Array<{
        organizationId: string;
        organizationSlug: string;
        ownerId: string;
        passwordHash: string;
      }>
    >`
      select
        owner.organization_id as "organizationId",
        organization.slug as "organizationSlug",
        owner.id as "ownerId",
        member.password_hash as "passwordHash"
      from users owner
      join organizations organization on organization.id = owner.organization_id
      join users member
        on member.organization_id = owner.organization_id
       and member.email = 'lea@q-academy.de'
      where owner.email = 'admin@q-academy.de'
      limit 1
    `;
    const [trainer] = await sql<Array<{ id: string }>>`
      insert into users (
        organization_id, email, password_hash, first_name, last_name, role, status
      ) values (
        ${fixture.organizationId}, ${trainerEmail}, ${fixture.passwordHash},
        'Shared', 'Trainer', 'trainer', 'active'
      ) returning id
    `;
    trainerId = trainer.id;
    const courses = await sql<Array<{ id: string }>>`
      insert into courses (
        organization_id, title, slug, short_description, description, status,
        created_by_id
      ) values
        (${fixture.organizationId}, ${`Shared Source ${suffix}`}, ${`shared-source-${suffix}`}, 'Shared source.', 'Shared media source course.', 'draft', ${fixture.ownerId}),
        (${fixture.organizationId}, ${`Shared Target ${suffix}`}, ${`shared-target-${suffix}`}, 'Shared target.', 'Shared media target course.', 'draft', ${fixture.ownerId})
      returning id
    `;
    [sourceCourseId, targetCourseId] = courses.map((course) => course.id);
    await sql`
      insert into course_collaborators (
        organization_id, course_id, user_id, permission, granted_by_id
      ) values
        (${fixture.organizationId}, ${sourceCourseId}, ${trainerId}, 'edit', ${fixture.ownerId}),
        (${fixture.organizationId}, ${targetCourseId}, ${trainerId}, 'edit', ${fixture.ownerId})
    `;
    const [learningModule] = await sql<Array<{ id: string }>>`
      insert into modules (
        organization_id, title, description, folder, is_reusable,
        estimated_minutes
      ) values (
        ${fixture.organizationId}, ${moduleTitle}, 'Shared media module.',
        'E2E', true, 10
      ) returning id
    `;
    moduleId = learningModule.id;
    await sql`
      insert into course_modules (
        organization_id, course_id, module_id, sort_order, drip_days,
        is_required
      ) values (
        ${fixture.organizationId}, ${sourceCourseId}, ${moduleId}, 0, 0, true
      )
    `;
    const [section] = await sql<Array<{ id: string }>>`
      insert into module_sections (
        organization_id, module_id, title, sort_order
      ) values (
        ${fixture.organizationId}, ${moduleId}, ${sectionTitle}, 0
      ) returning id
    `;
    const [lesson] = await sql<Array<{ id: string }>>`
      insert into lessons (
        organization_id, module_id, section_id, title, slug, type, status,
        duration_minutes, sort_order
      ) values (
        ${fixture.organizationId}, ${moduleId}, ${section.id},
        ${`Shared Lesson ${suffix}`},
        ${`shared-lesson-${suffix}`}, 'lesson', 'published', 10, 0
      ) returning id
    `;
    const [lessonPage] = await sql<Array<{ id: string }>>`
      insert into lesson_pages (
        lesson_id, title, slug, sort_order, status
      ) values (
        ${lesson.id}, ${`Shared Page ${suffix}`}, ${`shared-page-${suffix}`},
        0, 'published'
      ) returning id
    `;
    pageId = lessonPage.id;
    for (const [kind, assetId] of Object.entries(assetIds)) {
      const mediaKind = kind === "poster" ? "image" : kind;
      const extension = kind === "poster" ? "png" : kind === "audio" ? "mp3" : "mp4";
      const mimeType =
        kind === "poster"
          ? "image/png"
          : kind === "audio"
            ? "audio/mpeg"
            : "video/mp4";
      await sql`
        insert into media_assets (
          id, organization_id, uploaded_by_id, purpose, kind, status,
          storage_driver, storage_key, staging_storage_key, original_file_name,
          safe_file_name, declared_mime_type, detected_mime_type,
          declared_size_bytes, actual_size_bytes, duration_milliseconds,
          quota_bytes, content_sha256, upload_expires_at, uploaded_at,
          scan_completed_at
        ) values (
          ${assetId}, ${fixture.organizationId}, ${fixture.ownerId},
          'course_content', ${mediaKind}, 'ready', 'filesystem',
          ${`tenants/${fixture.organizationId}/assets/${assetId}/shared.${extension}`},
          ${`incoming/tenants/${fixture.organizationId}/assets/${assetId}/shared.${extension}`},
          ${`shared.${extension}`}, ${`shared.${extension}`}, ${mimeType},
          ${mimeType}, 1, 1,
          ${mediaKind === "image" ? null : 10_000}, 1, ${"a".repeat(64)},
          now() + interval '1 hour', now(), now()
        )
      `;
      await sql`
        insert into course_media_assets (
          organization_id, course_id, media_asset_id, attached_by_id
        ) values (
          ${fixture.organizationId}, ${sourceCourseId}, ${assetId},
          ${fixture.ownerId}
        )
      `;
    }
    await sql`
      insert into media_assets (
        id, organization_id, uploaded_by_id, purpose, kind, status,
        storage_driver, storage_key, staging_storage_key, original_file_name,
        safe_file_name, declared_mime_type, detected_mime_type,
        declared_size_bytes, actual_size_bytes, duration_milliseconds,
        quota_bytes, content_sha256, upload_expires_at, uploaded_at,
        scan_completed_at
      ) values (
        ${unboundVideoId}, ${fixture.organizationId}, ${trainerId},
        'course_content', 'video', 'ready', 'filesystem',
        ${`tenants/${fixture.organizationId}/assets/${unboundVideoId}/replacement.mp4`},
        ${`incoming/tenants/${fixture.organizationId}/assets/${unboundVideoId}/replacement.mp4`},
        'replacement.mp4', 'replacement.mp4', 'video/mp4', 'video/mp4',
        1, 1, 10_000, 1, ${"b".repeat(64)}, now() + interval '1 hour',
        now(), now()
      )
    `;
    await sql`
      insert into media_processing_jobs (
        id, organization_id, source_asset_id, requested_by_id, type, status,
        request_key, source_content_sha256, provider, options, result,
        completed_at
      ) values (
        ${unboundTranscriptJobId}, ${fixture.organizationId}, ${unboundVideoId},
        ${trainerId}, 'transcript', 'succeeded',
        ${randomUUID().replaceAll("-", "").repeat(2)}, ${"b".repeat(64)},
        'e2e-transcript', ${sql.json({ language: "de" })}, ${sql.json({})},
        now()
      )
    `;
    await sql`
      insert into media_asset_transcripts (
        organization_id, source_asset_id, processing_job_id,
        source_content_sha256, language, provider, document
      ) values (
        ${fixture.organizationId}, ${unboundVideoId},
        ${unboundTranscriptJobId}, ${"b".repeat(64)}, 'de', 'e2e-transcript',
        ${sql.json({
          version: 1,
          language: "de",
          segments: [
            {
              startMs: 0,
              endMs: 2_000,
              text: "Ein noch nicht gespeichertes Ersatzvideo.",
            },
          ],
        })}
      )
    `;
    await sql`
      insert into media_processing_jobs (
        id, organization_id, source_asset_id, requested_by_id, type, status,
        request_key, source_content_sha256, provider, options, result,
        completed_at
      ) values (
        ${transcriptJobId}, ${fixture.organizationId}, ${assetIds.video},
        ${fixture.ownerId}, 'transcript', 'succeeded', ${transcriptRequestKey},
        ${"a".repeat(64)}, 'configured-transcript-v1', ${sql.json({ language: "de" })},
        ${sql.json({})}, now()
      )
    `;
    await sql`
      insert into media_asset_transcripts (
        organization_id, source_asset_id, processing_job_id,
        source_content_sha256, language, provider, document, created_at
      ) values (
        ${fixture.organizationId}, ${assetIds.video}, ${transcriptJobId},
        ${"a".repeat(64)}, 'de', ${TRANSCRIPT_PROCESSING_PROVIDER},
        ${sql.json({
          version: 1,
          language: "de",
          segments: [
            {
              startMs: 0,
              endMs: 2_000,
              text: "Dieses Legacy-Transkript darf nicht sichtbar sein.",
            },
          ],
        })}, now() - interval '1 minute'
      )
    `;
    await sql`
      insert into media_processing_jobs (
        id, organization_id, source_asset_id, requested_by_id, type, status,
        request_key, source_content_sha256, provider, options
      ) values (
        ${currentTranscriptJobId}, ${fixture.organizationId}, ${assetIds.video},
        ${fixture.ownerId}, 'transcript', 'queued',
        ${currentTranscriptRequestKey}, ${"a".repeat(64)},
        ${TRANSCRIPT_PROCESSING_PROVIDER}, ${sql.json({ language: "de" })}
      )
    `;
    await sql`
      insert into media_asset_transcripts (
        organization_id, source_asset_id, processing_job_id,
        source_content_sha256, language, provider, document, created_at
      ) values (
        ${fixture.organizationId}, ${assetIds.video}, ${currentTranscriptJobId},
        ${"a".repeat(64)}, 'de', 'legacy-looking-row-provider',
        ${sql.json({
          version: 1,
          language: "de",
          segments: [
            {
              startMs: 0,
              endMs: 2_000,
              text: "Nur dieses aktuelle Transkript darf sichtbar sein.",
            },
          ],
        })}, now()
      )
    `;
    const [block] = await sql<Array<{ id: string }>>`
      insert into content_blocks (
        lesson_id, page_id, type, title, sort_order, required, data
      ) values (
        ${lesson.id}, ${pageId}, 'video', ${blockTitle}, 0, false,
        ${sql.json({
          mediaAssetId: assetIds.video,
          mediaAssetName: "shared.mp4",
          videoUrl: `/api/media-assets/${assetIds.video}/download`,
          caption: "",
          videoDescriptionIntent: "automatic",
          transcriptLanguage: "de",
          videoPoster: {
            version: 1,
            source: "upload",
            mediaAssetId: assetIds.poster,
            mediaAssetName: "shared.png",
          },
          videoComposition: {
            version: 1,
            renderJobId: transcriptJobId,
            audioTracks: [
              {
                id: randomUUID(),
                mediaAssetId: assetIds.audio,
                mediaAssetName: "shared.mp3",
                timelineStartMs: 0,
                sourceStartMs: 0,
                sourceEndMs: 5_000,
                volume: 1,
              },
            ],
          },
        })}
      ) returning id
    `;
    blockId = block.id;
    await sql`
      insert into video_description_jobs (
        organization_id, origin_course_id, live_block_id, block_reference_id,
        live_source_asset_id, source_asset_reference_id, requested_by_id,
        requester_subject_reference, source_content_sha256, locale,
        transcript_language, expected_block_revision, request_key, status,
        deadline_at
      ) values (
        ${fixture.organizationId}, ${sourceCourseId}, ${blockId}, ${blockId},
        ${assetIds.video}, ${assetIds.video}, ${fixture.ownerId},
        ${"c".repeat(64)}, ${"a".repeat(64)}, 'de', 'de', 1,
        ${randomUUID().replaceAll("-", "").repeat(2)}, 'queued',
        now() + interval '24 hours'
      )
    `;

    const login = await page.request.post("/api/v1/auth/login", {
      data: {
        organizationSlug: fixture.organizationSlug,
        email: trainerEmail,
        password: "Demo123!",
      },
    });
    expect(login.status()).toBe(200);
    await page.goto(`/admin/courses/${targetCourseId}`);
    await page.getByRole("button", { name: "Modul anlegen", exact: true }).click();
    const attachDialog = page.getByRole("dialog", { name: "Modul anlegen" });
    await attachDialog
      .getByRole("radio", { name: `${moduleTitle} auswaehlen`, exact: true })
      .check({ force: true });
    await attachDialog.getByRole("button", { name: "Hinzufuegen" }).click();
    await expect(
      page.getByText("Wiederverwendbares Modul hinzugefuegt.", { exact: true }),
    ).toBeVisible();

    const [jobsBeforeInvalidLanguage] = await sql<Array<{ count: number }>>`
      select count(*)::int as count
      from media_processing_jobs
      where organization_id = ${fixture.organizationId}
        and source_asset_id = ${assetIds.video}
    `;
    const invalidLanguage = await page.request.post(
      `/api/media-assets/${assetIds.video}/processing`,
      {
        headers: { Origin: "http://127.0.0.1:3000" },
        data: {
          type: "transcript",
          language: "deu",
          courseId: targetCourseId,
          blockId,
        },
      },
    );
    expect(invalidLanguage.status(), await invalidLanguage.text()).toBe(422);
    const [jobsAfterInvalidLanguage] = await sql<Array<{ count: number }>>`
      select count(*)::int as count
      from media_processing_jobs
      where organization_id = ${fixture.organizationId}
        and source_asset_id = ${assetIds.video}
    `;
    expect(jobsAfterInvalidLanguage.count).toBe(jobsBeforeInvalidLanguage.count);

    const invalidDescriptionLanguage = await page.request.post(
      `/api/media-assets/${assetIds.video}/video-description`,
      {
        headers: { Origin: "http://127.0.0.1:3000" },
        data: {
          courseId: targetCourseId,
          blockId,
          locale: "de",
          transcriptLanguage: "deu",
        },
      },
    );
    expect(
      invalidDescriptionLanguage.status(),
      await invalidDescriptionLanguage.text(),
    ).toBe(422);

    const queuedProcessing = await page.request.get(
      `/api/media-assets/${assetIds.video}/processing?language=de`,
    );
    expect(queuedProcessing.status(), await queuedProcessing.text()).toBe(200);
    expect((await queuedProcessing.json()).transcript).toBeNull();
    const queuedDescription = await page.request.post(
      `/api/media-assets/${assetIds.video}/video-description`,
      {
        headers: { Origin: "http://127.0.0.1:3000" },
        data: {
          courseId: targetCourseId,
          blockId,
          locale: "de",
          transcriptLanguage: "de",
        },
      },
    );
    expect(
      queuedDescription.status(),
      await queuedDescription.text(),
    ).toBe(422);

    await sql`
      update media_processing_jobs
      set status = 'succeeded', result = ${sql.json({})}, completed_at = now(),
          updated_at = now()
      where id = ${currentTranscriptJobId}
    `;
    const succeededProcessing = await page.request.get(
      `/api/media-assets/${assetIds.video}/processing?language=de`,
    );
    expect(
      succeededProcessing.status(),
      await succeededProcessing.text(),
    ).toBe(200);
    const succeededProcessingBody = await succeededProcessing.json();
    expect(succeededProcessingBody.transcript?.webVtt).toContain(
      "Nur dieses aktuelle Transkript darf sichtbar sein.",
    );
    expect(succeededProcessingBody.transcript?.webVtt).not.toContain(
      "Dieses Legacy-Transkript darf nicht sichtbar sein.",
    );

    await sql`
      insert into media_assets (
        id, organization_id, uploaded_by_id, purpose, kind, status,
        storage_driver, storage_key, staging_storage_key, original_file_name,
        safe_file_name, declared_mime_type, detected_mime_type,
        declared_size_bytes, actual_size_bytes, duration_milliseconds,
        quota_bytes, content_sha256, upload_expires_at, uploaded_at,
        scan_completed_at
      ) values (
        ${overlongVideoId}, ${fixture.organizationId}, ${fixture.ownerId},
        'course_content', 'video', 'ready', 'filesystem',
        ${`tenants/${fixture.organizationId}/assets/${overlongVideoId}/overlong.mp4`},
        ${`incoming/tenants/${fixture.organizationId}/assets/${overlongVideoId}/overlong.mp4`},
        'overlong.mp4', 'overlong.mp4', 'video/mp4', 'video/mp4',
        1, 1, ${MAX_AUTOMATIC_TRANSCRIPTION_DURATION_MS + 1}, 1,
        ${"d".repeat(64)}, now() + interval '1 hour', now(), now()
      )
    `;
    await sql`
      insert into course_media_assets (
        organization_id, course_id, media_asset_id, attached_by_id
      ) values
        (${fixture.organizationId}, ${sourceCourseId}, ${overlongVideoId}, ${fixture.ownerId}),
        (${fixture.organizationId}, ${targetCourseId}, ${overlongVideoId}, ${fixture.ownerId})
    `;
    const [overlongBlock] = await sql<Array<{ id: string }>>`
      insert into content_blocks (
        lesson_id, page_id, type, title, sort_order, required, data
      ) values (
        ${lesson.id}, ${pageId}, 'video', ${`Overlong Video ${suffix}`}, 1,
        false, ${sql.json({
          mediaAssetId: overlongVideoId,
          mediaAssetName: "overlong.mp4",
          videoUrl: `/api/media-assets/${overlongVideoId}/download`,
          videoDescriptionIntent: "automatic",
          transcriptLanguage: "de",
        })}
      ) returning id
    `;
    const overlongDescription = await page.request.post(
      `/api/media-assets/${overlongVideoId}/video-description`,
      {
        headers: { Origin: "http://127.0.0.1:3000" },
        data: {
          courseId: targetCourseId,
          blockId: overlongBlock.id,
          locale: "de",
          transcriptLanguage: "de",
        },
      },
    );
    expect(
      overlongDescription.status(),
      await overlongDescription.text(),
    ).toBe(422);
    await sql`delete from content_blocks where id = ${overlongBlock.id}`;

    await page
      .getByRole("button", { name: `Shared Lesson ${suffix} 1 Seite` })
      .click();
    await page
      .getByRole("button", { name: `1. Shared Page ${suffix}`, exact: true })
      .click();
    await page.getByLabel("Seite duplizieren").click();
    await expect.poll(async () => {
      const [counts] = await sql<
        Array<{ blocks: number; jobs: number }>
      >`
        select
          (select count(*)::int from content_blocks
           where lesson_id = ${lesson.id} and type = 'video') as blocks,
          (select count(*)::int from video_description_jobs
           where organization_id = ${fixture.organizationId}
             and source_asset_reference_id = ${assetIds.video}) as jobs
      `;
      return counts;
    }).toEqual({ blocks: 2, jobs: 2 });
    const [copiedVideo] = await sql<
      Array<{
        id: string;
        renderJobId: string | null;
        intent: string | null;
      }>
    >`
      select block.id,
             block.data->'videoComposition'->>'renderJobId' as "renderJobId",
             block.data->>'videoDescriptionIntent' as intent
      from content_blocks block
      join lesson_pages page on page.id = block.page_id
      where page.lesson_id = ${lesson.id}
        and page.id <> ${pageId}
        and block.type = 'video'
      limit 1
    `;
    expect(copiedVideo).toMatchObject({
      renderJobId: null,
      intent: "automatic",
    });
    await sql`
      update content_blocks
      set data = data #- '{videoComposition,renderJobId}'
      where id = ${blockId}
    `;

    const replacementProcessing = await page.request.post(
      `/api/media-assets/${unboundVideoId}/processing`,
      {
        headers: { Origin: "http://127.0.0.1:3000" },
        data: {
          type: "thumbnail",
          atMilliseconds: 1_000,
          courseId: targetCourseId,
          blockId,
        },
      },
    );
    expect(
      replacementProcessing.status(),
      await replacementProcessing.text(),
    ).toBe(422);
    const replacementDescription = await page.request.post(
      `/api/media-assets/${unboundVideoId}/video-description`,
      {
        headers: { Origin: "http://127.0.0.1:3000" },
        data: {
          courseId: targetCourseId,
          blockId,
          locale: "de",
          transcriptLanguage: "de",
        },
      },
    );
    expect(
      replacementDescription.status(),
      await replacementDescription.text(),
    ).toBe(422);
    const [replacementJobs] = await sql<Array<{ count: number }>>`
      select count(*)::int as count
      from media_processing_jobs
      where source_asset_id = ${unboundVideoId}
        and id <> ${unboundTranscriptJobId}
    `;
    expect(replacementJobs.count).toBe(0);

    const bindingsAfterAttach = await sql<
      Array<{ mediaAssetId: string; count: number }>
    >`
      select media_asset_id as "mediaAssetId", count(*)::int as count
      from course_media_assets
      where organization_id = ${fixture.organizationId}
        and media_asset_id in (${assetIds.video}, ${assetIds.poster}, ${assetIds.audio})
        and course_id in (${sourceCourseId}, ${targetCourseId})
      group by media_asset_id
    `;
    expect(
      Object.fromEntries(
        bindingsAfterAttach.map((binding) => [binding.mediaAssetId, binding.count]),
      ),
    ).toEqual({
      [assetIds.video]: 2,
      [assetIds.poster]: 2,
      [assetIds.audio]: 2,
    });

    const frame = await page.request.post(
      `/api/media-assets/${assetIds.video}/processing`,
      {
        headers: { Origin: "http://127.0.0.1:3000" },
        data: {
          type: "thumbnail",
          atMilliseconds: 1_000,
          courseId: targetCourseId,
          blockId,
        },
      },
    );
    expect(frame.status()).not.toBe(422);
    expect(frame.status()).not.toBe(403);
    expect(frame.status()).not.toBe(404);

    const description = await page.request.post(
      `/api/media-assets/${assetIds.video}/video-description`,
      {
        headers: { Origin: "http://127.0.0.1:3000" },
        data: {
          courseId: targetCourseId,
          blockId,
          locale: "de",
          transcriptLanguage: "de",
        },
      },
    );
    expect(description.status()).not.toBe(422);
    expect(description.status()).not.toBe(403);
    expect(description.status()).not.toBe(404);

    await sql`
      delete from course_media_assets
      where organization_id = ${fixture.organizationId}
        and course_id = ${targetCourseId}
        and media_asset_id = ${assetIds.poster}
    `;
    await page.reload();
    await page.getByRole("button", { name: `${blockTitle}: Bearbeiten` }).click();
    const editor = page.getByRole("dialog", {
      name: "Inhaltselement bearbeiten",
    });
    await editor.getByRole("button", { name: "Aenderungen speichern" }).click();
    await expect(editor).not.toBeVisible();
    const [posterBindings] = await sql<Array<{ count: number }>>`
      select count(*)::int as count
      from course_media_assets
      where organization_id = ${fixture.organizationId}
        and media_asset_id = ${assetIds.poster}
        and course_id in (${sourceCourseId}, ${targetCourseId})
    `;
    expect(posterBindings.count).toBe(2);

    await sql`
      delete from course_media_assets
      where organization_id = ${fixture.organizationId}
        and course_id = ${sourceCourseId}
        and media_asset_id = ${assetIds.poster}
    `;
    await page.getByRole("button", { name: "Lektion kopieren", exact: true }).click();
    const lessonCopyDialog = page.getByRole("dialog", {
      name: "Lektion kopieren nach",
    });
    await lessonCopyDialog
      .getByRole("button", { name: "Kopie erstellen" })
      .click();
    await expect(
      page.getByText("Lektion samt Seiten und Inhalten kopiert.", {
        exact: true,
      }),
    ).toBeVisible();
    const [posterBindingsAfterLessonCopy] = await sql<Array<{ count: number }>>`
      select count(*)::int as count
      from course_media_assets
      where organization_id = ${fixture.organizationId}
        and media_asset_id = ${assetIds.poster}
        and course_id in (${sourceCourseId}, ${targetCourseId})
    `;
    expect(posterBindingsAfterLessonCopy.count).toBe(2);

    await sql`
      delete from course_media_assets
      where organization_id = ${fixture.organizationId}
        and course_id = ${sourceCourseId}
        and media_asset_id = ${assetIds.audio}
    `;
    await page
      .getByRole("button", { name: `Sektion kopieren: ${sectionTitle}` })
      .click();
    const sectionCopyDialog = page.getByRole("dialog", {
      name: "Sektion kopieren nach",
    });
    await sectionCopyDialog
      .getByRole("button", { name: "Kopie erstellen" })
      .click();
    await expect(
      page.getByText("Sektion samt Lektionen, Seiten und Inhalten kopiert.", {
        exact: true,
      }),
    ).toBeVisible();
    const [audioBindingsAfterSectionCopy] = await sql<Array<{ count: number }>>`
      select count(*)::int as count
      from course_media_assets
      where organization_id = ${fixture.organizationId}
        and media_asset_id = ${assetIds.audio}
        and course_id in (${sourceCourseId}, ${targetCourseId})
    `;
    expect(audioBindingsAfterSectionCopy.count).toBe(2);
  } finally {
    if (moduleId) {
      await sql`delete from activity_events where entity_id = ${moduleId}`;
    }
    if (targetCourseId) await sql`delete from courses where id = ${targetCourseId}`;
    if (sourceCourseId) await sql`delete from courses where id = ${sourceCourseId}`;
    if (moduleId) await sql`delete from modules where id = ${moduleId}`;
    await sql`
      delete from media_assets
      where id in (
        ${assetIds.video}, ${assetIds.poster}, ${assetIds.audio},
        ${unboundVideoId}, ${overlongVideoId}
      )
    `;
    if (trainerId) await sql`delete from users where id = ${trainerId}`;
    await sql.end();
  }
});
