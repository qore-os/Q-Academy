import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  formatLearningExamDuration,
  formatLearningFileSize,
  getLearningUiCopy,
  learningUiDictionaries,
  type LearningUiKey,
} from "../src/lib/i18n/learning";
import { SUPPORTED_LOCALES } from "../src/lib/i18n/model";

const placeholderPattern = /\{([A-Za-z][A-Za-z0-9]*)\}/g;

function placeholders(value: string) {
  return [...value.matchAll(placeholderPattern)]
    .map((match) => match[1])
    .sort();
}

test("learning dictionaries are complete, nonempty, and placeholder-compatible", () => {
  const referenceKeys = Object.keys(
    learningUiDictionaries.de,
  ) as LearningUiKey[];

  assert.equal(referenceKeys.length, 239);
  for (const locale of SUPPORTED_LOCALES) {
    const dictionary = learningUiDictionaries[locale];
    assert.deepEqual(Object.keys(dictionary).sort(), [...referenceKeys].sort());

    for (const key of referenceKeys) {
      assert.ok(dictionary[key].trim(), `${locale}.${key} must not be empty`);
      assert.deepEqual(
        placeholders(dictionary[key]),
        placeholders(learningUiDictionaries.de[key]),
        `${locale}.${key} must preserve its placeholders`,
      );
    }
  }
});

test("learning dictionaries do not silently fall back to German or English", () => {
  const keys = Object.keys(learningUiDictionaries.de) as LearningUiKey[];

  for (const locale of SUPPORTED_LOCALES.filter((value) => value !== "de")) {
    const localizedCount = keys.filter(
      (key) =>
        learningUiDictionaries[locale][key] !== learningUiDictionaries.de[key],
    ).length;
    assert.ok(
      localizedCount / keys.length > 0.9,
      `${locale} must translate more than 90% of the German learning copy`,
    );
  }

  for (const locale of ["it", "es", "fr"] as const) {
    const localizedCount = keys.filter(
      (key) =>
        learningUiDictionaries[locale][key] !== learningUiDictionaries.en[key],
    ).length;
    assert.ok(
      localizedCount / keys.length > 0.9,
      `${locale} must not inherit English learning copy`,
    );
  }
});

test("learning copy interpolates every supported locale without unresolved tokens", () => {
  const keys = Object.keys(learningUiDictionaries.de) as LearningUiKey[];

  for (const locale of SUPPORTED_LOCALES) {
    const copy = getLearningUiCopy(locale);
    for (const key of keys) {
      const values = Object.fromEntries(
        placeholders(learningUiDictionaries.de[key]).map((name) => [name, 7]),
      );
      assert.doesNotMatch(copy(key, values), placeholderPattern, `${locale}.${key}`);
    }
  }
});

test("German attachment and recorder copy uses native umlauts and eszett", () => {
  const dictionary = learningUiDictionaries.de;

  assert.equal(dictionary["attachments.choose"], "Dateien auswählen");
  assert.equal(dictionary["attachments.securityCheck"], "Sicherheitsprüfung");
  assert.equal(
    dictionary["attachments.invalidFile"],
    "Dateityp oder Dateigröße ist ungültig.",
  );
  assert.equal(
    dictionary["recorder.tooLarge"],
    "Die Aufnahme ist größer als 250 MiB und wurde verworfen.",
  );
  assert.equal(
    dictionary["recorder.checking"],
    "Browser-Unterstützung wird geprüft.",
  );
});

test("exam durations and attachment sizes retain locale-specific formatting", () => {
  for (const locale of SUPPORTED_LOCALES) {
    const duration = formatLearningExamDuration(3_661, locale);
    assert.match(duration, /1/);
    assert.match(duration, /2/);
    assert.equal(
      formatLearningExamDuration(null, locale),
      learningUiDictionaries[locale]["exam.noTimeLimit"],
    );
  }

  assert.match(formatLearningFileSize(1_536, "de"), /1,5/);
  assert.match(formatLearningFileSize(1_536, "en"), /1\.5/);
  assert.notEqual(
    formatLearningExamDuration(3_661, "de"),
    formatLearningExamDuration(3_661, "en"),
  );
});

test("learner lesson and exam surfaces contain no actionable German UI fallback", () => {
  const scopedFiles = [
    "src/components/academy/lesson-content.tsx",
    "src/components/academy/exam-lesson.tsx",
    "src/components/academy/lesson-feedback.tsx",
    "src/components/academy/lesson-bookmark-toggle.tsx",
    "src/components/academy/exam-navigation-guard.tsx",
    "src/components/academy/lesson-availability-subscription.tsx",
    "src/components/academy/submission-recorder.tsx",
    "src/components/academy/submission-attachment-uploader.tsx",
    "src/components/academy/submission-review-annotations.tsx",
    "src/components/academy/video-transcript-player.tsx",
    "src/components/content/submission-answer-content.tsx",
    "src/app/(member)/academy/courses/[slug]/learn/[lessonId]/page.tsx",
  ];
  const source = scopedFiles
    .map((file) => readFileSync(join(process.cwd(), file), "utf8"))
    .join("\n");

  assert.doesNotMatch(
    source,
    /Pflichtfrage|Wissenscheck|Mehrfachauswahl|Lückentext|Sortieraufgabe|Praxisabgabe|Pflichtabgabe|Wird gesendet|Versuchslimit|Prüfung bestanden|Lektion abgeschlossen|Nur lesen|Nächste Seite|Prüfung abgeben|Speichert|Ungespeichert|Serverstand geladen|Lösungseinsicht|Bereit für den Start|Dateianhänge|Dateien auswählen|Direkt aufnehmen|Transkript durchsuchen|Navigation ist|zur Bewertung eingereicht|konnte nicht/i,
  );

  const lesson = readFileSync(
    join(process.cwd(), "src/components/academy/lesson-content.tsx"),
    "utf8",
  );
  const exam = readFileSync(
    join(process.cwd(), "src/components/academy/exam-lesson.tsx"),
    "utf8",
  );
  const lessonPage = readFileSync(
    join(
      process.cwd(),
      "src/app/(member)/academy/courses/[slug]/learn/[lessonId]/page.tsx",
    ),
    "utf8",
  );

  assert.match(lesson, /getLearningUiCopy\(locale\)/);
  assert.match(exam, /getLearningUiCopy\(locale\)/);
  assert.doesNotMatch(exam, /error\.message|payload\?\.detail/);
  assert.doesNotMatch(lesson, /result\.error\s*\?\?|state\.error\s*\}/);
  assert.match(exam, /formatDateTime\([^)]*, locale\)/);
  assert.match(
    lessonPage,
    /<ExamNavigationBoundary[\s\S]*?locale=\{locale\}[\s\S]*?>/,
  );
  assert.match(lessonPage, /<LessonBookmarkToggle[\s\S]*?locale=\{locale\}/);
  assert.match(lessonPage, /<LessonFeedback[\s\S]*?locale=\{locale\}/);
});
