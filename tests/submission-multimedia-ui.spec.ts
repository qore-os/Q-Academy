import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";

import { getLearningUiCopy } from "../src/lib/i18n/learning";
import { dropFiles } from "./helpers/media-drop";
import { completeMemberWelcomeIfVisible } from "./helpers/member-welcome";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54329/q_academy";
const learningCopy = getLearningUiCopy("de");

async function installDeterministicRecorder(page: Page) {
  await page.addInitScript(() => {
    class FakeMediaStreamTrack {
      onended: (() => void) | null = null;

      stop() {}
    }

    class FakeMediaStream {
      private readonly track = new FakeMediaStreamTrack();

      getTracks() {
        return [this.track];
      }
    }

    class FakeMediaRecorder {
      static isTypeSupported() {
        return true;
      }

      state: "inactive" | "recording" = "inactive";
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      onerror: (() => void) | null = null;
      onstop: (() => void) | null = null;
      private readonly mimeType: string;

      constructor(_stream: unknown, options?: { mimeType?: string }) {
        this.mimeType = options?.mimeType ?? "audio/webm";
      }

      start() {
        this.state = "recording";
      }

      stop() {
        if (this.state === "inactive") return;
        this.state = "inactive";
        this.ondataavailable?.({
          data: new Blob(["recorded-media"], { type: this.mimeType }),
        });
        this.onstop?.();
      }
    }

    Object.defineProperty(window, "MediaRecorder", {
      configurable: true,
      value: FakeMediaRecorder,
    });
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: async () => new FakeMediaStream(),
        getDisplayMedia: async () => new FakeMediaStream(),
      },
    });
  });
}

async function loginAsMember(page: Page) {
  await page.goto("/login");
  await page.getByLabel("E-Mail-Adresse").fill("lea@q-academy.de");
  await page.getByLabel("Passwort", { exact: true }).fill("Demo123!");
  await page.getByRole("button", { name: /bei .* anmelden/i }).click();
  await page.waitForURL("**/academy");
  await completeMemberWelcomeIfVisible(page);
}

async function loginAsAdmin(page: Page) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByRole("button", { name: /Admin-Demo|Als Admin testen/ }).click();
  await page.waitForURL("**/admin");
}

async function expectNoHorizontalOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth + 1);
}

test("multimedia submission and review controls remain usable responsively", async ({
  page,
}, testInfo) => {
  const sql = postgres(databaseUrl, { prepare: false, max: 1 });
  const suffix = `${testInfo.project.name}-${Date.now()}`;
  const submissionTitle = `Multimedia UI ${suffix}`;
  let submissionId = "";

  try {
    await installDeterministicRecorder(page);
    const fixtures = await sql<
      Array<{
        organization_id: string;
        member_id: string;
        course_id: string;
        course_slug: string;
        snapshot: {
          modules: Array<{
            lessons: Array<{
              id: string;
              blocks: Array<{ type: string }>;
              pages: Array<{ blocks: Array<{ type: string }> }>;
            }>;
          }>;
        };
      }>
    >`
      select
        member.organization_id,
        member.id as member_id,
        course.id as course_id,
        course.slug as course_slug,
        version.snapshot
      from users member
      join enrollments enrollment
        on enrollment.user_id = member.id and enrollment.access_active = true
      join courses course
        on course.id = enrollment.course_id and course.status = 'published'
      join course_versions version
        on version.id = course.published_version_id
       and version.course_id = course.id
       and version.organization_id = course.organization_id
      where member.email = 'lea@q-academy.de'
      order by course.slug
    `;
    expect(fixtures.length).toBeGreaterThan(0);
    const fixture = fixtures[0]!;
    const lessonTargets = fixtures.flatMap((course) =>
      course.snapshot.modules.flatMap((module) =>
        module.lessons
          .filter((lesson) =>
            [
              ...lesson.blocks,
              ...lesson.pages.flatMap((page) => page.blocks),
            ].some((block) => block.type === "submission"),
          )
          .map((lesson) => ({
            courseSlug: course.course_slug,
            lessonId: lesson.id,
          })),
      ),
    );
    expect(lessonTargets.length).toBeGreaterThan(0);

    const [submission] = await sql<Array<{ id: string }>>`
      insert into submissions (
        organization_id, user_id, course_id, title, content, status
      ) values (
        ${fixture.organization_id}, ${fixture.member_id}, ${fixture.course_id},
        ${submissionTitle},
        'Ziel, Kontext und Qualitaetskriterien sind dokumentiert. Die Ausgabe wird vor der Freigabe manuell geprueft.',
        'open'
      )
      returning id
    `;
    submissionId = submission.id;

    await loginAsMember(page);
    let recorderFound = false;
    for (const target of lessonTargets) {
      await page.goto(
        `/academy/courses/${target.courseSlug}/learn/${target.lessonId}`,
      );
      if (
        await page
          .getByRole("heading", { name: "Direkt aufnehmen" })
          .isVisible()
          .catch(() => false)
      ) {
        recorderFound = true;
        break;
      }
    }
    expect(recorderFound).toBe(true);
    await expect(
      page.getByRole("heading", { name: "Direkt aufnehmen" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Audio" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Video" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Bildschirm" }),
    ).toBeVisible();

    const uploader = page
      .getByText(learningCopy("attachments.choose"), { exact: true })
      .first()
      .locator("../..");
    const fileInput = uploader.locator('input[type="file"][multiple]').first();
    let blockedUploadRequests = 0;
    const countBlockedUpload = (request: import("@playwright/test").Request) => {
      if (
        request.method() === "POST" &&
        new URL(request.url()).pathname === "/api/media-assets"
      ) {
        blockedUploadRequests += 1;
      }
    };
    page.on("request", countBlockedUpload);
    await uploader
      .getByRole("button", { name: learningCopy("recorder.start") })
      .click();
    await expect(
      uploader.getByRole("button", { name: learningCopy("recorder.stop") }),
    ).toBeVisible();
    await expect(fileInput).toBeDisabled();
    await dropFiles(page, uploader, [
      {
        name: "blocked-while-recording.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("This file must not be queued while recording."),
      },
    ]);
    await expect(
      uploader.getByText("blocked-while-recording.txt", { exact: true }),
    ).toHaveCount(0);
    expect(blockedUploadRequests).toBe(0);

    await page.waitForTimeout(50);
    await uploader
      .getByRole("button", { name: learningCopy("recorder.stop") })
      .click();
    await expect(
      uploader.getByRole("button", { name: learningCopy("recorder.discard") }),
    ).toBeVisible();
    await expect(fileInput).toBeDisabled();
    await dropFiles(page, uploader, [
      {
        name: "blocked-by-recording-preview.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("This file must not be queued while previewing."),
      },
    ]);
    await expect(
      uploader.getByText("blocked-by-recording-preview.txt", { exact: true }),
    ).toHaveCount(0);
    expect(blockedUploadRequests).toBe(0);
    await uploader
      .getByRole("button", { name: learningCopy("recorder.discard") })
      .click();
    await expect(fileInput).toBeEnabled();
    page.off("request", countBlockedUpload);

    await expectNoHorizontalOverflow(page);
    await page.screenshot({
      path: `artifacts/submission-recorder-${testInfo.project.name}.png`,
      fullPage: true,
    });

    await loginAsAdmin(page);
    await page.goto("/admin/tasks");
    await page.getByPlaceholder("Abgaben durchsuchen").fill(submissionTitle);
    await page.locator("button").filter({ hasText: submissionTitle }).click();
    const selectedTitle = page.getByRole("heading", {
      name: submissionTitle,
      exact: true,
    });
    await expect(selectedTitle).toBeVisible();
    await expect
      .poll(() =>
        selectedTitle.evaluate(
          (element) => element.scrollWidth <= element.clientWidth + 1,
        ),
      )
      .toBe(true);
    await expect(
      page.getByRole("textbox", { name: "Eingereichte Antwort" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Textstelle kommentieren" }),
    ).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await page.screenshot({
      path: `artifacts/submission-review-${testInfo.project.name}.png`,
      fullPage: true,
    });
  } finally {
    if (submissionId) {
      await sql`delete from submissions where id = ${submissionId}`;
    }
    await sql.end();
  }
});
