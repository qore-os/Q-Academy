import { randomUUID } from "node:crypto";

import { expect, test, type APIResponse } from "@playwright/test";
import postgres from "postgres";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";
const apiAuthorization = {
  Authorization: `Bearer ${process.env.DEMO_API_KEY ?? "qak_demo_qacademy_2026_local_development"}`,
};

type Fixture = {
  organizationId: string;
  reviewerId: string;
  memberId: string;
  courseId: string;
  moduleId: string;
  lessonId: string;
  blockId: string;
};

function rememberRequestId(response: APIResponse, requestIds: string[]) {
  const requestId = response.headers()["x-request-id"];
  if (requestId) requestIds.push(requestId);
}

async function createFixture(
  sql: postgres.Sql,
  suffix: string,
): Promise<Fixture> {
  const [identity] = await sql<
    Array<{ organization_id: string; reviewer_id: string }>
  >`
    select organization_id, id as reviewer_id
    from users
    where email = 'admin@q-academy.de'
    limit 1
  `;
  if (!identity) throw new Error("Media review test admin was not found.");

  return sql.begin(async (tx) => {
    const [member] = await tx<Array<{ id: string }>>`
      insert into users (
        organization_id, email, password_hash, first_name, last_name, role, status
      ) values (
        ${identity.organization_id},
        ${`media-timestamp-${suffix}@example.test`},
        'unused-e2e-password-hash', 'Media', ${`Review ${suffix}`},
        'member', 'active'
      )
      returning id
    `;
    const [course] = await tx<Array<{ id: string }>>`
      insert into courses (
        organization_id, title, slug, short_description, description, status,
        certificate_enabled, created_by_id
      ) values (
        ${identity.organization_id}, ${`Media Timestamp Review ${suffix}`},
        ${`media-timestamp-review-${suffix}`},
        'Isolierter E2E-Kurs fuer zeitcodiertes Medienfeedback.',
        'Prueft die Bindung von Review-Zeitmarken an das konkrete Abgabemedium.',
        'draft', false, ${identity.reviewer_id}
      )
      returning id
    `;
    const [learningModule] = await tx<Array<{ id: string }>>`
      insert into modules (
        organization_id, title, description, folder, is_reusable,
        estimated_minutes
      ) values (
        ${identity.organization_id}, ${`Media Review Modul ${suffix}`},
        'E2E-Modul fuer eine Audioabgabe.', 'E2E', false, 10
      )
      returning id
    `;
    await tx`
      insert into course_modules (
        organization_id, course_id, module_id, sort_order, is_required
      ) values (
        ${identity.organization_id}, ${course.id}, ${learningModule.id}, 0, true
      )
    `;
    const [lesson] = await tx<Array<{ id: string }>>`
      insert into lessons (
        organization_id, module_id, title, slug, summary, type,
        duration_minutes, sort_order, status
      ) values (
        ${identity.organization_id}, ${learningModule.id},
        'Audio-Praxisabgabe', ${`audio-practice-${suffix}`},
        'Eine Audioabgabe mit punktgenauem Trainerfeedback.',
        'assignment', 10, 0, 'published'
      )
      returning id
    `;
    const [block] = await tx<Array<{ id: string }>>`
      insert into content_blocks (
        lesson_id, type, title, sort_order, required, data
      ) values (
        ${lesson.id}, 'submission', 'Audioantwort', 0, true,
        ${tx.json({ prompt: "Reiche deine eingesprochene Antwort ein." })}
      )
      returning id
    `;
    const [enrollment] = await tx<Array<{ id: string }>>`
      insert into enrollments (user_id, course_id, access_active)
      values (${member.id}, ${course.id}, true)
      returning id
    `;
    await tx`
      insert into course_access_grants (
        organization_id, user_id, course_id, source
      ) values (
        ${identity.organization_id}, ${member.id}, ${course.id},
        ${`direct:${enrollment.id}`}
      )
    `;

    return {
      organizationId: identity.organization_id,
      reviewerId: identity.reviewer_id,
      memberId: member.id,
      courseId: course.id,
      moduleId: learningModule.id,
      lessonId: lesson.id,
      blockId: block.id,
    };
  });
}

async function createReadyAudioAsset(
  sql: postgres.Sql,
  fixture: Fixture,
  suffix: string,
  label: string,
  durationMilliseconds: number | null = null,
) {
  const id = randomUUID();
  const safeLabel = label.toLowerCase().replaceAll(/[^a-z0-9]/g, "-");
  const size = 8_192;
  const [asset] = await sql<Array<{ id: string }>>`
    insert into media_assets (
      id, organization_id, uploaded_by_id, owner_user_id, purpose, kind,
      status, storage_driver, storage_key, staging_storage_key,
      original_file_name, safe_file_name, declared_mime_type,
      detected_mime_type, declared_size_bytes, actual_size_bytes, quota_bytes,
      duration_milliseconds, upload_expires_at, uploaded_at, scan_completed_at
    ) values (
      ${id}, ${fixture.organizationId}, ${fixture.memberId}, ${fixture.memberId},
      'submission', 'audio', 'ready', 'filesystem',
      ${`tenants/${fixture.organizationId}/assets/${id}/${safeLabel}.wav`},
      ${`incoming/tenants/${fixture.organizationId}/assets/${id}/${safeLabel}.wav`},
      ${`${label}-${suffix}.wav`}, ${`${safeLabel}-${id.slice(0, 8)}.wav`},
      'audio/wav', 'audio/wav', ${size}, ${size}, ${size},
      ${durationMilliseconds}, now() + interval '1 hour', now(), now()
    )
    returning id
  `;
  return asset.id;
}

test("media timestamp reviews accept only audio bound to the reviewed submission", async ({
  request,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "focused Chromium API flow");
  test.setTimeout(120_000);

  const sql = postgres(databaseUrl, { max: 4, prepare: false });
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const keyPrefix = `media-timestamp-review-${suffix}`;
  const requestIds: string[] = [];
  const mediaAssetIds: string[] = [];
  let fixture: Fixture | null = null;
  let submissionId = "";

  try {
    fixture = await createFixture(sql, suffix);

    const publish = await request.post(
      `/api/v1/courses/${fixture.courseId}/publish`,
      {
        headers: {
          ...apiAuthorization,
          "Idempotency-Key": `${keyPrefix}-publish`,
        },
        data: { changelog: "Media timestamp review E2E fixture" },
      },
    );
    rememberRequestId(publish, requestIds);
    expect(publish.status()).toBe(201);

    const boundAudioId = await createReadyAudioAsset(
      sql,
      fixture,
      suffix,
      "bound-audio",
    );
    const knownDurationMilliseconds = 15_000;
    const boundedAudioId = await createReadyAudioAsset(
      sql,
      fixture,
      suffix,
      "bounded-audio",
      knownDurationMilliseconds,
    );
    const unboundAudioId = await createReadyAudioAsset(
      sql,
      fixture,
      suffix,
      "unbound-audio",
    );
    mediaAssetIds.push(boundAudioId, boundedAudioId, unboundAudioId);

    const [storedDurations] = await sql<
      Array<{
        unknown_duration: number | null;
        known_duration: number | null;
      }>
    >`
      select
        max(duration_milliseconds) filter (where id = ${boundAudioId})::int
          as unknown_duration,
        max(duration_milliseconds) filter (where id = ${boundedAudioId})::int
          as known_duration
      from media_assets
      where id in (${boundAudioId}, ${boundedAudioId})
    `;
    expect(storedDurations).toEqual({
      unknown_duration: null,
      known_duration: knownDurationMilliseconds,
    });
    await expect(
      sql`
        update media_assets
        set duration_milliseconds = ${knownDurationMilliseconds + 1}
        where id = ${boundedAudioId}
      `,
    ).rejects.toMatchObject({ code: "55000" });

    const submission = await request.post("/api/v1/submissions", {
      headers: {
        ...apiAuthorization,
        "Idempotency-Key": `${keyPrefix}-submission`,
      },
      data: {
        userId: fixture.memberId,
        courseId: fixture.courseId,
        lessonId: fixture.lessonId,
        blockId: fixture.blockId,
        title: `Audioantwort ${suffix}`,
        type: "audio",
        attachmentIds: [boundAudioId, boundedAudioId],
      },
    });
    rememberRequestId(submission, requestIds);
    expect(submission.status()).toBe(201);
    const submissionBody = (await submission.json()) as {
      data: {
        id: string;
        status: string;
        attachments: Array<{ id: string; kind: string }>;
      };
    };
    submissionId = submissionBody.data.id;
    expect(submissionBody.data).toMatchObject({
      status: "in_review",
      attachments: expect.arrayContaining([
        expect.objectContaining({ id: boundAudioId, kind: "audio" }),
        expect.objectContaining({ id: boundedAudioId, kind: "audio" }),
      ]),
    });

    const [binding] = await sql<
      Array<{
        submission_id: string;
        media_asset_id: string;
        status: string;
        kind: string;
      }>
    >`
      select sa.submission_id, sa.media_asset_id, ma.status, ma.kind
      from submission_attachments sa
      inner join media_assets ma
        on ma.id = sa.media_asset_id
       and ma.organization_id = sa.organization_id
      where sa.submission_id = ${submissionId}
        and sa.media_asset_id = ${boundAudioId}
    `;
    expect(binding).toEqual({
      submission_id: submissionId,
      media_asset_id: boundAudioId,
      status: "ready",
      kind: "audio",
    });

    const rejectedReview = await request.post(
      `/api/v1/submissions/${submissionId}/review`,
      {
        headers: {
          ...apiAuthorization,
          "Idempotency-Key": `${keyPrefix}-unbound-review`,
        },
        data: {
          decision: "approved",
          feedback: "Diese Bewertung darf nicht teilweise gespeichert werden.",
          score: 91,
          annotations: [
            {
              type: "media_timestamp",
              body: "Dieses Audio gehoert nicht zu der bewerteten Abgabe.",
              mediaAssetId: unboundAudioId,
              timestampMilliseconds: 4_200,
            },
          ],
        },
      },
    );
    rememberRequestId(rejectedReview, requestIds);
    expect(rejectedReview.status()).toBe(422);
    await expect(rejectedReview.json()).resolves.toMatchObject({
      code: "validation_error",
      detail:
        "Zeitmarken benoetigen ein an diese Abgabe gebundenes Audio- oder Video-Asset.",
    });

    const [afterRejection] = await sql<
      Array<{
        status: string;
        review_count: number;
        annotation_count: number;
      }>
    >`
      select s.status,
        (select count(*)::int from submission_reviews sr
          where sr.submission_id = s.id) as review_count,
        (select count(*)::int from submission_review_annotations sra
          where sra.submission_id = s.id) as annotation_count
      from submissions s
      where s.id = ${submissionId}
    `;
    expect(afterRejection).toEqual({
      status: "in_review",
      review_count: 0,
      annotation_count: 0,
    });

    const overDurationReview = await request.post(
      `/api/v1/submissions/${submissionId}/review`,
      {
        headers: {
          ...apiAuthorization,
          "Idempotency-Key": `${keyPrefix}-over-duration-review`,
        },
        data: {
          decision: "approved",
          feedback: "Diese Zeitmarke liegt ausserhalb des Mediums.",
          score: 92,
          annotations: [
            {
              type: "media_timestamp",
              body: "Ausserhalb der bekannten Mediendauer.",
              mediaAssetId: boundedAudioId,
              timestampMilliseconds: knownDurationMilliseconds + 1,
            },
          ],
        },
      },
    );
    rememberRequestId(overDurationReview, requestIds);
    expect(overDurationReview.status()).toBe(422);
    await expect(overDurationReview.json()).resolves.toMatchObject({
      code: "validation_error",
      detail:
        "Zeitmarken duerfen die bekannte Dauer des Abgabemediums nicht ueberschreiten.",
    });

    const [afterDurationRejection] = await sql<
      Array<{
        status: string;
        review_count: number;
        annotation_count: number;
      }>
    >`
      select s.status,
        (select count(*)::int from submission_reviews sr
          where sr.submission_id = s.id) as review_count,
        (select count(*)::int from submission_review_annotations sra
          where sra.submission_id = s.id) as annotation_count
      from submissions s
      where s.id = ${submissionId}
    `;
    expect(afterDurationRejection).toEqual({
      status: "in_review",
      review_count: 0,
      annotation_count: 0,
    });

    const timestampMilliseconds = knownDurationMilliseconds;
    const annotationBody = "Hier beginnt die entscheidende Begruendung.";
    const acceptedReview = await request.post(
      `/api/v1/submissions/${submissionId}/review`,
      {
        headers: {
          ...apiAuthorization,
          "Idempotency-Key": `${keyPrefix}-bound-review`,
        },
        data: {
          decision: "approved",
          feedback: "Die Audioantwort ist fachlich vollstaendig.",
          score: 96,
          annotations: [
            {
              type: "media_timestamp",
              body: annotationBody,
              mediaAssetId: boundAudioId,
              timestampMilliseconds: 123_456,
            },
            {
              type: "media_timestamp",
              body: "Innerhalb der serverseitig bekannten Dauer.",
              mediaAssetId: boundedAudioId,
              timestampMilliseconds,
            },
          ],
        },
      },
    );
    rememberRequestId(acceptedReview, requestIds);
    expect(acceptedReview.status()).toBe(200);
    const acceptedBody = (await acceptedReview.json()) as {
      data: {
        submission: { id: string; status: string; score: number };
        review: {
          reviewerId: string;
          annotations: Array<Record<string, unknown>>;
        };
      };
    };
    expect(acceptedBody.data.submission).toMatchObject({
      id: submissionId,
      status: "approved",
      score: 96,
    });
    expect(acceptedBody.data.review.reviewerId).toBe(fixture.reviewerId);
    expect(acceptedBody.data.review.annotations).toHaveLength(2);
    expect(acceptedBody.data.review.annotations[0]).toMatchObject({
      type: "media_timestamp",
      body: annotationBody,
      mediaAssetId: boundAudioId,
      timestampMilliseconds: 123_456,
    });
    expect(acceptedBody.data.review.annotations[1]).toMatchObject({
      type: "media_timestamp",
      mediaAssetId: boundedAudioId,
      timestampMilliseconds,
    });
    for (const privateField of [
      "organizationId",
      "reviewId",
      "sortOrder",
      "fingerprint",
      "mediaAssetKind",
    ]) {
      expect(acceptedBody.data.review.annotations[0]).not.toHaveProperty(
        privateField,
      );
    }

    const detail = await request.get(`/api/v1/submissions/${submissionId}`, {
      headers: apiAuthorization,
    });
    rememberRequestId(detail, requestIds);
    expect(detail.status()).toBe(200);
    const detailBody = (await detail.json()) as {
      data: {
        submission: { id: string; status: string };
        reviews: Array<{
          reviewerId: string;
          annotations: Array<Record<string, unknown>>;
        }>;
      };
    };
    expect(detailBody.data.submission).toMatchObject({
      id: submissionId,
      status: "approved",
    });
    expect(detailBody.data.reviews).toHaveLength(1);
    expect(detailBody.data.reviews[0]).toMatchObject({
      reviewerId: fixture.reviewerId,
      annotations: [
        expect.objectContaining({
          type: "media_timestamp",
          body: annotationBody,
          mediaAssetId: boundAudioId,
          timestampMilliseconds: 123_456,
        }),
        expect.objectContaining({
          type: "media_timestamp",
          mediaAssetId: boundedAudioId,
          timestampMilliseconds,
        }),
      ],
    });
    expect(detailBody.data.reviews[0]!.annotations[0]).not.toHaveProperty(
      "fingerprint",
    );

    const stored = await sql<
      Array<{
        media_asset_id: string;
        media_asset_kind: string;
        timestamp_milliseconds: number;
      }>
    >`
      select sra.media_asset_id, sra.media_asset_kind,
        sra.timestamp_milliseconds
      from submission_review_annotations sra
      inner join submission_attachments sa
        on sa.media_asset_id = sra.media_asset_id
       and sa.submission_id = sra.submission_id
       and sa.organization_id = sra.organization_id
      where sra.submission_id = ${submissionId}
      order by sra.sort_order
    `;
    expect(stored).toEqual([
      {
        media_asset_id: boundAudioId,
        media_asset_kind: "audio",
        timestamp_milliseconds: 123_456,
      },
      {
        media_asset_id: boundedAudioId,
        media_asset_kind: "audio",
        timestamp_milliseconds: timestampMilliseconds,
      },
    ]);
  } finally {
    for (const requestId of requestIds) {
      await sql`delete from api_audit_logs where request_id = ${requestId}`;
    }
    await sql`
      delete from api_idempotency_keys where key like ${`${keyPrefix}%`}
    `;
    if (fixture) {
      await sql`
        delete from webhook_deliveries
        where payload -> 'data' ->> 'id' in (${fixture.courseId}, ${submissionId || null})
           or payload -> 'data' ->> 'courseId' = ${fixture.courseId}
      `;
      await sql`
        delete from activity_events
        where entity_id in (${fixture.courseId}, ${submissionId || null})
           or user_id = ${fixture.memberId}
      `;
      await sql`delete from notifications where user_id = ${fixture.memberId}`;
      await sql`delete from courses where id = ${fixture.courseId}`;
      await sql`delete from modules where id = ${fixture.moduleId}`;
      if (mediaAssetIds.length) {
        await sql`delete from media_assets where id in ${sql(mediaAssetIds)}`;
      }
      await sql`delete from users where id = ${fixture.memberId}`;
    }
    await sql.end();
  }
});
