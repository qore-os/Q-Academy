import assert from "node:assert/strict";
import test from "node:test";

import type { CourseVersionSnapshot } from "@/db/schema";
import { diffCourseSnapshots } from "@/lib/course-change-log";

function fixture(): CourseVersionSnapshot {
  return {
    schemaVersion: 3,
    accessPolicyVersion: 1,
    capturedAt: "2026-07-10T08:00:00.000Z",
    course: {
      id: "10000000-0000-4000-8000-000000000001",
      organizationId: "10000000-0000-4000-8000-000000000002",
      categoryId: null,
      title: "Sicher arbeiten",
      slug: "sicher-arbeiten",
      shortDescription: "Kompakter Kurs",
      description: "Kursbeschreibung",
      coverImage: null,
      status: "published",
      difficulty: "Grundlagen",
      estimatedMinutes: 45,
      certificateEnabled: true,
      featured: false,
      visibleInCatalog: true,
      showProgressPercentage: true,
      publishedVersionId: null,
      firstPublishedAt: "2026-07-10T08:00:00.000Z",
      createdById: "10000000-0000-4000-8000-000000000003",
      createdAt: "2026-07-09T08:00:00.000Z",
      updatedAt: "2026-07-10T08:00:00.000Z",
    },
    learningGoals: [
      {
        id: "10000000-0000-4000-8000-000000000010",
        organizationId: "10000000-0000-4000-8000-000000000002",
        courseId: "10000000-0000-4000-8000-000000000001",
        text: "Risiken erkennen",
        sortOrder: 0,
        createdAt: "2026-07-09T08:00:00.000Z",
        updatedAt: "2026-07-09T08:00:00.000Z",
      },
      {
        id: "10000000-0000-4000-8000-000000000011",
        organizationId: "10000000-0000-4000-8000-000000000002",
        courseId: "10000000-0000-4000-8000-000000000001",
        text: "Sicher handeln",
        sortOrder: 1,
        createdAt: "2026-07-09T08:00:00.000Z",
        updatedAt: "2026-07-09T08:00:00.000Z",
      },
    ],
    authors: [
      {
        id: "10000000-0000-4000-8000-000000000020",
        organizationId: "10000000-0000-4000-8000-000000000002",
        courseId: "10000000-0000-4000-8000-000000000001",
        userId: "10000000-0000-4000-8000-000000000003",
        sortOrder: 0,
        createdAt: "2026-07-09T08:00:00.000Z",
        author: {
          id: "10000000-0000-4000-8000-000000000003",
          firstName: "Ada",
          lastName: "Lovelace",
          avatarUrl: null,
          jobTitle: "Trainerin",
          bio: null,
        },
      },
    ],
    widgets: [
      {
        id: "10000000-0000-4000-8000-000000000030",
        organizationId: "10000000-0000-4000-8000-000000000002",
        courseId: "10000000-0000-4000-8000-000000000001",
        type: "info",
        sortOrder: 0,
        authorUserId: null,
        authorRole: null,
        authorDescription: null,
        title: "Hinweis",
        text: "Vorbereitung",
        linkUrl: null,
        imageUrl: null,
        altText: null,
        createdAt: "2026-07-09T08:00:00.000Z",
        updatedAt: "2026-07-09T08:00:00.000Z",
        author: null,
      },
    ],
    modules: [
      moduleFixture("10000000-0000-4000-8000-000000000100", "Grundlagen", 0),
      moduleFixture("10000000-0000-4000-8000-000000000200", "Praxis", 1, false),
    ],
  };
}

function moduleFixture(
  id: string,
  title: string,
  sortOrder: number,
  withContent = true,
): CourseVersionSnapshot["modules"][number] {
  const organizationId = "10000000-0000-4000-8000-000000000002";
  const sectionId = `${id.slice(0, -3)}300`;
  const lessonId = `${id.slice(0, -3)}400`;
  const pageId = `${id.slice(0, -3)}500`;
  const blockId = `${id.slice(0, -3)}600`;
  return {
    id,
    organizationId,
    title,
    description: `${title} Beschreibung`,
    folder: "Kursmodule",
    isReusable: true,
    estimatedMinutes: 20,
    createdAt: "2026-07-09T08:00:00.000Z",
    updatedAt: "2026-07-09T08:00:00.000Z",
    sortOrder,
    accessMode: "visible",
    dripDays: 0,
    delayPendingState: "locked",
    availableFrom: null,
    availableUntil: null,
    windowDefaultState: "locked",
    windowState: "available",
    requestAccessEnabled: false,
    isRequired: true,
    lessons: [],
    sections: withContent
      ? [
          {
            id: sectionId,
            organizationId,
            moduleId: id,
            title: "Start",
            description: null,
            sortOrder: 0,
            status: "published",
            visibility: "visible",
            dripDays: 0,
            unlockAfterPrevious: false,
            createdAt: "2026-07-09T08:00:00.000Z",
            updatedAt: "2026-07-09T08:00:00.000Z",
            lessons: [
              {
                id: lessonId,
                organizationId,
                moduleId: id,
                sectionId,
                title: "Einstieg",
                summary: null,
                slug: "einstieg",
                type: "quiz",
                durationMinutes: 10,
                passingScore: 80,
                maxAttempts: 3,
                shuffleQuestions: false,
                examDurationSeconds: null,
                examQuestionPools: [],
                examResultReleaseMode: "immediate",
                examReviewReleaseMode: "after_result",
                examContentAccessMode: "allow",
                sortOrder: 0,
                status: "published",
                visibility: "visible",
                availableAt: null,
                createdAt: "2026-07-09T08:00:00.000Z",
                updatedAt: "2026-07-09T08:00:00.000Z",
                blocks: [],
                pages: [
                  {
                    id: pageId,
                    lessonId,
                    title: "Wissenstest",
                    titleSyncedWithLesson: false,
                    slug: "wissenstest",
                    sortOrder: 0,
                    status: "published",
                    revision: 1,
                    layoutWidth: "standard",
                    backgroundTone: "plain",
                    contentSpacing: "comfortable",
                    createdAt: "2026-07-09T08:00:00.000Z",
                    updatedAt: "2026-07-09T08:00:00.000Z",
                    blocks: [
                      {
                        id: blockId,
                        lessonId,
                        pageId,
                        type: "ordering",
                        title: "Ablauf sortieren",
                        sortOrder: 0,
                        required: true,
                        style: {
                          width: "content",
                          alignment: "left",
                          surface: "plain",
                        },
                        data: {
                          options: ["Erster Schritt", "Zweiter Schritt"],
                          correctOptions: [0],
                          presentationOrder: ["first", "second"],
                          acceptedAnswers: ["PRIVATE_ANSWER_KEY"],
                        },
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ]
      : [],
  };
}

function copy(snapshot: CourseVersionSnapshot) {
  return structuredClone(snapshot);
}

test("ignores timestamps and randomized ordering presentation without phantom changes", () => {
  const published = fixture();
  const draft = copy(published);
  draft.capturedAt = "2026-07-11T12:30:00.000Z";
  draft.course.updatedAt = "2026-07-11T12:30:00.000Z";
  draft.modules[0].updatedAt = "2026-07-11T12:30:00.000Z";
  draft.modules[0].sections[0].updatedAt = "2026-07-11T12:30:00.000Z";
  draft.modules[0].sections[0].lessons[0].updatedAt = "2026-07-11T12:30:00.000Z";
  draft.modules[0].sections[0].lessons[0].pages[0].updatedAt = "2026-07-11T12:30:00.000Z";
  draft.modules[0].sections[0].lessons[0].pages[0].blocks[0].data.presentationOrder = [
    "second",
    "first",
  ];

  assert.deepEqual(diffCourseSnapshots(published, draft), {
    hasChanges: false,
    total: 0,
    counts: { added: 0, updated: 0, removed: 0, moved: 0 },
    groups: [],
  });
});

test("reports nested edits without serializing assessment answers or block payloads", () => {
  const published = fixture();
  const draft = copy(published);
  draft.course.title = "Sicher und gesund arbeiten";
  draft.modules[0].accessMode = "delay_days";
  draft.modules[0].dripDays = 3;
  draft.modules[0].sections[0].title = "Vorbereitung";
  draft.modules[0].sections[0].lessons[0].visibility = "coming_soon";
  draft.modules[0].sections[0].lessons[0].pages[0].title = "Abschlusstest";
  const block = draft.modules[0].sections[0].lessons[0].pages[0].blocks[0];
  block.data.acceptedAnswers = ["NEW_ULTRA_SECRET_ANSWER"];

  const result = diffCourseSnapshots(published, draft);
  const serialized = JSON.stringify(result);
  assert.equal(result.hasChanges, true);
  assert.ok(result.groups.some((group) => group.key === "course"));
  assert.ok(result.groups.some((group) => group.key === "access"));
  assert.ok(result.groups.some((group) => group.key === "sections"));
  assert.ok(result.groups.some((group) => group.key === "lessons"));
  assert.ok(result.groups.some((group) => group.key === "pages"));
  assert.ok(result.groups.some((group) => group.key === "blocks"));
  assert.equal(serialized.includes("NEW_ULTRA_SECRET_ANSWER"), false);
  assert.equal(serialized.includes("PRIVATE_ANSWER_KEY"), false);
  assert.equal(serialized.includes("acceptedAnswers"), false);
  assert.equal(serialized.includes("correctOptions"), false);
  assert.equal(serialized.includes("presentationOrder"), false);
});

test("detects a lesson summary edit on its own", () => {
  const published = fixture();
  const draft = copy(published);
  draft.modules[0].sections[0].lessons[0].summary = "Neue Zusammenfassung";

  const result = diffCourseSnapshots(published, draft);
  assert.equal(result.total, 1);
  assert.equal(result.groups[0]?.key, "lessons");
  assert.equal(result.groups[0]?.entries[0]?.kind, "updated");
});

test("detects a module kind change without exposing module payloads", () => {
  const published = fixture();
  const draft = copy(published);
  draft.modules[0].kind = "exam";

  const result = diffCourseSnapshots(published, draft);
  assert.equal(result.total, 1);
  assert.equal(result.groups[0]?.key, "modules");
  assert.equal(result.groups[0]?.entries[0]?.kind, "updated");
  assert.equal(JSON.stringify(result).includes("correctOption"), false);
});

test("reports link retargeting and indentation without target-version phantom diffs", () => {
  const published = fixture();
  const linkModule = published.modules[1];
  linkModule.kind = "link";
  linkModule.linkedCourseId = "10000000-0000-4000-8000-000000000700";
  linkModule.targetVersionIdAtCapture = "10000000-0000-4000-8000-000000000701";
  linkModule.indentLevel = 1;
  linkModule.isRequired = false;
  linkModule.lessons = [];
  linkModule.sections = [];

  const republishedTarget = copy(published);
  republishedTarget.modules[1].targetVersionIdAtCapture =
    "10000000-0000-4000-8000-000000000702";
  assert.equal(
    diffCourseSnapshots(published, republishedTarget).hasChanges,
    false,
  );

  const retargeted = copy(republishedTarget);
  retargeted.modules[1].linkedCourseId =
    "10000000-0000-4000-8000-000000000703";
  retargeted.modules[1].indentLevel = 2;
  const result = diffCourseSnapshots(published, retargeted);
  const entries = result.groups.find((group) => group.key === "modules")?.entries ?? [];

  assert.deepEqual(
    entries.map(({ kind, detail }) => ({ kind, detail })),
    [
      { kind: "updated", detail: "Verlinkter Zielkurs geändert" },
      { kind: "moved", detail: "Einrückung geändert" },
    ],
  );
});

test("treats missing legacy indentation as level zero", () => {
  const published = fixture();
  const draft = copy(published);
  draft.modules[0].indentLevel = 0;

  assert.equal(diffCourseSnapshots(published, draft).hasChanges, false);
});

test("detects additions, deletions, renames and pure reordering deterministically", () => {
  const published = fixture();
  const draft = copy(published);
  draft.learningGoals!.reverse();
  draft.modules.reverse();
  draft.modules[0].sortOrder = 0;
  draft.modules[1].sortOrder = 1;
  draft.modules[1].title = "Grundlagen aktualisiert";
  draft.widgets = [];
  draft.authors!.push({
    ...draft.authors![0],
    id: "10000000-0000-4000-8000-000000000021",
    userId: "10000000-0000-4000-8000-000000000004",
    sortOrder: 1,
    author: {
      ...draft.authors![0].author,
      id: "10000000-0000-4000-8000-000000000004",
      firstName: "Grace",
      lastName: "Hopper",
    },
  });

  const first = diffCourseSnapshots(published, draft);
  const second = diffCourseSnapshots(published, copy(draft));
  assert.deepEqual(first, second);
  assert.ok(first.counts.moved >= 4);
  assert.ok(first.counts.updated >= 1);
  assert.ok(first.counts.removed >= 1);
  assert.ok(first.counts.added >= 1);
});

test("an identical republished snapshot resets the draft diff", () => {
  const republished = fixture();
  republished.capturedAt = "2026-07-11T13:00:00.000Z";
  republished.course.updatedAt = "2026-07-11T13:00:00.000Z";
  assert.equal(diffCourseSnapshots(republished, copy(republished)).hasChanges, false);
});
