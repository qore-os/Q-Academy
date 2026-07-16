import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";
import { getCourseBuilderCopy } from "../src/lib/i18n/course-builder";
import { getCourseBuilderActionMessage } from "../src/lib/i18n/course-builder-actions";
import { getTranscriptWizardUiCopy } from "../src/lib/i18n/transcript-wizard";
import { completeMemberWelcomeIfVisible } from "./helpers/member-welcome";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";
const demoKey =
  process.env.DEMO_API_KEY ?? "qak_demo_qacademy_2026_local_development";
const authorization = { Authorization: `Bearer ${demoKey}` };
const courseBuilderCopy = getCourseBuilderCopy("de");
const transcriptWizardCopy = getTranscriptWizardUiCopy("de");

async function login(page: Page, role: "admin" | "member") {
  await page.context().clearCookies();
  await page.goto("/login");
  await page
    .getByRole("button", {
      name: role === "admin" ? /Admin-Demo|Als Admin testen/ : /Lernenden-Demo|Als Mitglied testen/,
    })
    .click();
  await page.waitForURL(role === "admin" ? "**/admin" : "**/academy");
  if (role === "member") await completeMemberWelcomeIfVisible(page);
}

test("video transcripts persist, generate learning blocks, and stay redacted for members", async ({
  page,
}, testInfo) => {
  test.setTimeout(150_000);

  const sql = postgres(databaseUrl, { prepare: false });
  const suffix = `${testInfo.project.name}-${Date.now()}-${Math.random()
    .toString(16)
    .slice(2, 8)}`;
  const courseTitle = `Transkript-Kurs ${suffix}`;
  const courseSlug = `transcript-${suffix}`;
  const moduleTitle = `Video-Modul ${suffix}`;
  const lessonTitle = `Video-Lektion ${suffix}`;
  const videoTitle = `Lernvideo ${suffix}`;
  const videoUrl = "https://example.com/video.mp4";
  const alternateAnswerSecret = `ALTERNATE_ANSWER_${suffix}`;
  const feedbackSecret = `PRIVATE_FEEDBACK_${suffix}`;
  const transcriptSegments = [
    "Zuerst definieren wir ein konkretes Lernziel.",
    "Danach sammeln wir belastbare Beispieldaten.",
    "Anschliessend pruefen wir die Ergebnisse gemeinsam.",
    "Zum Schluss dokumentieren wir den freigegebenen Ablauf.",
  ];
  const webVtt = `WEBVTT

00:00:00.000 --> 00:00:06.000
${transcriptSegments[0]}

00:00:08.000 --> 00:00:14.000
${transcriptSegments[1]}

00:00:16.000 --> 00:00:23.000
${transcriptSegments[2]}

00:00:25.000 --> 00:00:33.000
${transcriptSegments[3]}
`;
  const apiRequestIds: string[] = [];
  let courseId = "";
  let moduleId = "";
  let lessonId = "";

  try {
    const [identity] = await sql<
      Array<{ organization_id: string; owner_id: string; member_id: string }>
    >`
      select
        owner.organization_id,
        owner.id as owner_id,
        member.id as member_id
      from users owner
      join users member
        on member.organization_id = owner.organization_id
       and member.email = 'lea@q-academy.de'
      where owner.email = 'admin@q-academy.de'
      limit 1
    `;
    expect(identity).toBeTruthy();

    const [course] = await sql<Array<{ id: string }>>`
      insert into courses (
        organization_id,
        title,
        slug,
        short_description,
        description,
        status,
        certificate_enabled,
        created_by_id
      ) values (
        ${identity.organization_id},
        ${courseTitle},
        ${courseSlug},
        'Video mit durchsuchbarem Transkript.',
        'Isolierter E2E-Kurs fuer Transkript, Wizard und sichere Lernansicht.',
        'draft',
        false,
        ${identity.owner_id}
      )
      returning id
    `;
    courseId = course.id;

    const [learningModule] = await sql<Array<{ id: string }>>`
      insert into modules (
        organization_id,
        title,
        description,
        is_reusable,
        estimated_minutes
      ) values (
        ${identity.organization_id},
        ${moduleTitle},
        'Fokussiertes Modul fuer den Transkript-Wizard.',
        false,
        12
      )
      returning id
    `;
    moduleId = learningModule.id;
    await sql`
      insert into course_modules (
        organization_id, course_id, module_id, sort_order, is_required
      )
      values (${identity.organization_id}, ${courseId}, ${moduleId}, 0, true)
    `;

    const [lesson] = await sql<Array<{ id: string }>>`
      insert into lessons (
        organization_id,
        module_id,
        title,
        slug,
        summary,
        type,
        duration_minutes,
        passing_score,
        sort_order,
        status
      ) values (
        ${identity.organization_id},
        ${moduleId},
        ${lessonTitle},
        ${`video-${suffix}`},
        'Transkriptgestuetzte Lektion mit automatisch erzeugten Aufgaben.',
        'lesson',
        12,
        100,
        0,
        'published'
      )
      returning id
    `;
    lessonId = lesson.id;

    const [enrollment] = await sql<Array<{ id: string }>>`
      insert into enrollments (user_id, course_id, access_active)
      values (${identity.member_id}, ${courseId}, true)
      returning id
    `;
    await sql`
      insert into course_access_grants (
        organization_id,
        user_id,
        course_id,
        source
      ) values (
        ${identity.organization_id},
        ${identity.member_id},
        ${courseId},
        ${`direct:${enrollment.id}`}
      )
    `;

    await page.route(videoUrl, (route) => route.abort());
    await login(page, "admin");
    await page.goto(`/admin/courses/${courseId}`);

    await page.getByRole("button", { name: "Video", exact: true }).click();
    await expect(
      page.getByText("Inhaltselement hinzugefuegt.", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", {
        name: `${courseBuilderCopy.palette.video}: ${courseBuilderCopy.common.edit}`,
        exact: true,
      })
      .click();

    let dialog = page.getByRole("dialog", {
      name: courseBuilderCopy.dialogs.editBlock,
    });
    await dialog.locator('input[name="title"]').fill(videoTitle);
    await dialog
      .getByRole("textbox", { name: "Video-URL", exact: true })
      .fill(videoUrl);
    await dialog
      .getByLabel("Beschreibung")
      .fill("Externes Lernvideo mit redaktionell geprueftem Transkript.");
    await dialog.getByLabel("Sprache").fill("de-DE");
    await dialog
      .getByLabel("WebVTT-Transkript")
      .fill("WEBVTT\n\nungueltige Zeitmarke");
    await expect(dialog.getByRole("status")).toHaveText("WebVTT ist ungueltig");
    await dialog
      .getByRole("button", {
        name: courseBuilderCopy.dialogs.saveChanges,
        exact: true,
      })
      .click();
    await expect(
      page.getByText(
        getCourseBuilderActionMessage("de", "course_builder.invalid_input"),
        { exact: true },
      ),
    ).toBeVisible();
    await expect(dialog).toBeVisible();

    await dialog.getByLabel("WebVTT-Transkript").fill(webVtt);
    await expect(dialog.getByRole("status")).toHaveText("4 Zeitmarken");
    await dialog
      .getByRole("button", {
        name: courseBuilderCopy.dialogs.saveChanges,
        exact: true,
      })
      .click();
    await expect(dialog).toBeHidden();
    await expect(
      page.getByText("Inhaltselement gespeichert.", { exact: true }),
    ).toBeVisible();

    const [persistedVideo] = await sql<
      Array<{
        id: string;
        sort_order: number;
        data: {
          videoUrl?: string;
          transcript?: {
            version: number;
            language: string;
            segments: Array<{ startMs: number; endMs: number; text: string }>;
          };
        };
      }>
    >`
      select id, sort_order, data
      from content_blocks
      where lesson_id = ${lessonId} and type = 'video'
      limit 1
    `;
    expect(persistedVideo.data).toMatchObject({
      videoUrl,
      transcript: {
        version: 1,
        language: "de-de",
        segments: [
          { startMs: 0, endMs: 6_000, text: transcriptSegments[0] },
          { startMs: 8_000, endMs: 14_000, text: transcriptSegments[1] },
          { startMs: 16_000, endMs: 23_000, text: transcriptSegments[2] },
          { startMs: 25_000, endMs: 33_000, text: transcriptSegments[3] },
        ],
      },
    });

    await page
      .getByRole("button", {
        name: `${videoTitle}: ${courseBuilderCopy.common.edit}`,
        exact: true,
      })
      .click();
    dialog = page.getByRole("dialog", {
      name: courseBuilderCopy.dialogs.editBlock,
    });
    await expect(dialog.getByRole("status")).toHaveText("4 Zeitmarken");
    await expect(dialog.getByLabel("WebVTT-Transkript")).toContainText(
      "00:00:16.000 --> 00:00:23.000",
    );
    await expect(dialog.getByLabel("WebVTT-Transkript")).toContainText(
      transcriptSegments[2],
    );
    await expect(dialog.getByLabel("Transkript-Wizard")).toHaveValue("mixed");
    await dialog.getByRole("button", { name: "Inhalte erstellen" }).click();
    await expect(
      dialog.getByRole("region", { name: transcriptWizardCopy.responseLabel }),
    ).toBeVisible();
    await dialog.getByRole("button", { name: "Dialog schliessen" }).click();
    await expect(dialog).toBeHidden();

    const generated = await sql<
      Array<{
        id: string;
        type: string;
        sort_order: number;
        required: boolean;
        data: Record<string, unknown>;
      }>
    >`
      select id, type, sort_order, required, data
      from content_blocks
      where lesson_id = ${lessonId}
      order by sort_order, id
    `;
    expect(generated.map((block) => [block.type, block.sort_order])).toEqual([
      ["video", 0],
      ["text", 1],
      ["multiple_choice", 2],
      ["true_false", 3],
      ["multi_select", 4],
      ["fill_blank", 5],
      ["ordering", 6],
    ]);
    const summaryBlock = generated.find((block) => block.type === "text")!;
    const multipleChoiceBlock = generated.find(
      (block) => block.type === "multiple_choice",
    )!;
    const trueFalseBlock = generated.find(
      (block) => block.type === "true_false",
    )!;
    const multiSelectBlock = generated.find(
      (block) => block.type === "multi_select",
    )!;
    const fillBlock = generated.find((block) => block.type === "fill_blank")!;
    const orderingBlock = generated.find((block) => block.type === "ordering")!;
    expect(summaryBlock.data.text).toContain("Zusammenfassung des Videos");
    for (const assessmentBlock of [
      multipleChoiceBlock,
      trueFalseBlock,
      multiSelectBlock,
    ]) {
      expect(assessmentBlock).toMatchObject({ required: true });
    }
    expect(fillBlock).toMatchObject({ required: true });
    expect(fillBlock.data).toMatchObject({
      prompt: expect.stringContaining("____"),
      acceptedAnswers: expect.arrayContaining(["Beispieldaten"]),
      caseSensitive: false,
    });
    expect(orderingBlock).toMatchObject({ required: true });
    expect(orderingBlock.data).toMatchObject({
      options: transcriptSegments,
    });

    const acceptedAnswers = fillBlock.data.acceptedAnswers as string[];
    await sql`
      update content_blocks
      set data = ${sql.json({
        ...fillBlock.data,
        acceptedAnswers: [...acceptedAnswers, alternateAnswerSecret],
        feedback: feedbackSecret,
      })}
      where id = ${fillBlock.id}
    `;
    await sql`
      update content_blocks
      set data = ${sql.json({
        ...orderingBlock.data,
        feedback: feedbackSecret,
      })}
      where id = ${orderingBlock.id}
    `;

    await page.getByRole("button", { name: "Kurs veröffentlichen" }).click();
    await expect(
      page.getByRole("button", { name: "Änderungen veröffentlichen" }),
    ).toBeVisible();
    await expect
      .poll(async () => {
        const [row] = await sql<Array<{ count: number }>>`
          select count(*)::int as count
          from course_versions
          where course_id = ${courseId} and published_at is not null
        `;
        return row.count;
      })
      .toBe(1);

    await login(page, "member");
    const learnerResponse = await page.goto(
      `/academy/courses/${courseSlug}/learn/${lessonId}`,
    );
    expect(learnerResponse?.status()).toBe(200);
    const learnerPayload = await learnerResponse!.text();

    await expect(page.getByRole("heading", { name: videoTitle })).toBeVisible();
    await expect(
      page.locator(`video source[src="${videoUrl}"]`),
    ).toHaveCount(1);
    await expect(page.locator("video track[kind='captions']")).toHaveCount(1);
    const transcriptList = page.getByRole("list", {
      name: "Zeitmarken im Transkript",
    });
    await expect(transcriptList.getByRole("listitem")).toHaveCount(4);
    const transcriptSearch = page.getByRole("searchbox", {
      name: "Transkript durchsuchen",
    });
    await transcriptSearch.fill("Ergebnisse gemeinsam");
    await expect(transcriptList.getByRole("listitem")).toHaveCount(1);
    await expect(transcriptList).toContainText(transcriptSegments[2]);
    await transcriptSearch.fill("nicht vorhanden");
    await expect(
      page.getByText("Keine passenden Transkriptstellen.", { exact: true }),
    ).toBeVisible();
    await transcriptSearch.fill("");

    await expect(page.getByText(String(summaryBlock.data.text))).toBeVisible();
    await expect(
      page.getByLabel(String(fillBlock.data.prompt)),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: String(orderingBlock.data.prompt) }),
    ).toBeVisible();

    const initialHtml = await page.content();
    for (const redacted of [
      "acceptedAnswers",
      "correctOption",
      "correctOptions",
      "correctOrder",
      "presentationOrder",
      alternateAnswerSecret,
      feedbackSecret,
    ]) {
      expect(initialHtml).not.toContain(redacted);
      expect(learnerPayload).not.toContain(redacted);
    }

    await page
      .getByLabel(String(fillBlock.data.prompt))
      .fill(acceptedAnswers[0]!);
    for (const block of [multipleChoiceBlock, trueFalseBlock]) {
      const options = block.data.options as string[];
      const correctOption = block.data.correctOption as number;
      await page
        .locator(`[data-quiz-block="${block.id}"]`)
        .getByRole("button")
        .filter({ hasText: options[correctOption]! })
        .click();
    }
    const multiSelectOptions = multiSelectBlock.data.options as string[];
    for (const correctOption of multiSelectBlock.data.correctOptions as number[]) {
      await page
        .locator(`[data-quiz-block="${multiSelectBlock.id}"]`)
        .getByRole("button", {
          name: multiSelectOptions[correctOption],
          exact: true,
        })
        .click();
    }
    const orderingSection = page.locator(
      `[data-quiz-block="${orderingBlock.id}"]`,
    );
    for (let target = 0; target < transcriptSegments.length; target += 1) {
      const label = transcriptSegments[target]!;
      while (true) {
        const texts = await orderingSection.locator("ol > li").allTextContents();
        const current = texts.findIndex((text) => text.includes(label));
        if (current <= target) break;
        await orderingSection
          .getByRole("button", { name: `${label} nach oben` })
          .click();
      }
    }
    await page.getByRole("button", { name: "Pflichtquiz abgeben" }).click();
    await expect(
      page.getByRole("main").getByText("Pflichtquiz bestanden", { exact: true }),
    ).toBeVisible();

    const [attempt] = await sql<Array<{ id: string }>>`
      select id
      from assessment_attempts
      where user_id = ${identity.member_id}
        and course_id = ${courseId}
        and lesson_id = ${lessonId}
      order by attempt_number desc
      limit 1
    `;
    expect(attempt).toBeTruthy();
    const detailResponse = await page.request.get(
      `/api/v1/assessment-attempts/${attempt.id}`,
      { headers: authorization },
    );
    apiRequestIds.push(detailResponse.headers()["x-request-id"]);
    expect(detailResponse.status()).toBe(200);
    const detailPayload = JSON.stringify(await detailResponse.json());
    for (const redacted of [
      "acceptedAnswers",
      "correctOption",
      "correctOptions",
      "correctOrder",
      "presentationOrder",
      alternateAnswerSecret,
      feedbackSecret,
    ]) {
      expect(detailPayload).not.toContain(redacted);
    }

    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(1);
    const playerBox = await page.locator("video").boundingBox();
    expect(playerBox).toBeTruthy();
    expect(playerBox!.x).toBeGreaterThanOrEqual(0);
    expect(playerBox!.x + playerBox!.width).toBeLessThanOrEqual(
      page.viewportSize()!.width + 1,
    );
    await page.screenshot({
      path: testInfo.outputPath(
        `video-transcript-${testInfo.project.name}.png`,
      ),
      fullPage: false,
    });
  } finally {
    for (const requestId of apiRequestIds.filter(Boolean)) {
      await sql`delete from api_audit_logs where request_id = ${requestId}`;
    }
    if (courseId) {
      await sql`
        delete from activity_events
        where entity_id in (${courseId || null}, ${moduleId || null}, ${lessonId || null})
           or metadata ->> 'courseId' = ${courseId}
      `;
      await sql`delete from courses where id = ${courseId}`;
    }
    if (moduleId) await sql`delete from modules where id = ${moduleId}`;
    await sql.end({ timeout: 5 });
  }
});
