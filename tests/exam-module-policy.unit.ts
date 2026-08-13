import assert from "node:assert/strict";
import test from "node:test";

import type { ContentBlockData } from "../src/db/schema";
import { examModulePublicationErrors } from "../src/lib/exam-module-policy";

function block(
  id: string,
  type: string,
  data: ContentBlockData,
  required = true,
) {
  return { id, type, title: id, required, data };
}

function examModule(
  blocks: ReturnType<typeof block>[],
  options: { visibility?: string; kind?: "learning" | "exam" } = {},
) {
  const lesson = {
    id: "exam-lesson",
    type: "exam",
    status: "published",
    visibility: options.visibility ?? "visible",
    blocks: [] as ReturnType<typeof block>[],
    pages: [{ status: "published", blocks }],
  };
  return {
    kind: options.kind ?? "exam",
    lessons: [lesson],
  };
}

test("legacy learning modules do not inherit exam publication rules", () => {
  const learningModule = examModule([], { kind: "learning" });
  delete (learningModule as { kind?: string }).kind;
  assert.deepEqual(examModulePublicationErrors(learningModule), []);
});

test("exam publication accepts all five auto-graded types plus submission", () => {
  const errors = examModulePublicationErrors(
    examModule([
      block("multiple", "multiple_choice", {
        prompt: "Welche Antwort ist richtig?",
        options: ["A", "B"],
        correctOption: 0,
      }),
      block("boolean", "true_false", {
        prompt: "Ist die Aussage richtig?",
        options: ["Richtig", "Falsch"],
        correctOption: 1,
      }),
      block("multi", "multi_select", {
        prompt: "Welche Antworten treffen zu?",
        options: ["A", "B", "C"],
        correctOptions: [0, 2],
      }),
      block("blank", "fill_blank", {
        prompt: "Ergaenze den Fachbegriff.",
        acceptedAnswers: ["Musterantwort"],
      }),
      block("order", "ordering", {
        prompt: "Bringe die Schritte in Reihenfolge.",
        options: ["Start", "Pruefen", "Abschliessen"],
      }),
      block("manual", "submission", {
        prompt: "Reiche deine begruendete Loesung ein.",
      }),
    ]),
  );
  assert.deepEqual(errors, []);
});

test("submission-only exams are rejected until lifecycle scoring supports them", () => {
  assert.match(
    examModulePublicationErrors(
      examModule([
        block("manual", "submission", {
          prompt: "Reiche deine begruendete Loesung ein.",
        }),
      ]),
    ).join(" "),
    /mindestens eine automatisch bewertbare Frage/,
  );
});

test("exam publication rejects missing, optional, and invalid gradable tasks", () => {
  assert.match(
    examModulePublicationErrors(examModule([])).join(" "),
    /mindestens eine bewertbare Aufgabe/,
  );
  assert.match(
    examModulePublicationErrors(
      examModule([
        block(
          "optional",
          "multiple_choice",
          { prompt: "Gueltige Frage?", options: ["A", "B"], correctOption: 0 },
          false,
        ),
      ]),
    ).join(" "),
    /verpflichtend/,
  );
  assert.match(
    examModulePublicationErrors(
      examModule([
        block("invalid", "multiple_choice", {
          prompt: "Gueltige Frage?",
          options: ["A", "B"],
          correctOption: 4,
        }),
      ]),
    ).join(" "),
    /unvollstaendig/,
  );
});

test("exam publication requires a visible published exam lesson", () => {
  assert.match(
    examModulePublicationErrors(
      examModule(
        [
          block("question", "true_false", {
            prompt: "Ist die Aussage richtig?",
            options: ["Richtig", "Falsch"],
            correctOption: 0,
          }),
        ],
        { visibility: "coming_soon" },
      ),
    ).join(" "),
    /Veroeffentlichung freigegeben/,
  );
});

test("a gradable task on a draft page cannot make an exam publishable", () => {
  const candidate = examModule([
    block("question", "true_false", {
      prompt: "Ist die Aussage richtig?",
      options: ["Richtig", "Falsch"],
      correctOption: 0,
    }),
  ]);
  candidate.lessons[0].pages[0].status = "draft";
  assert.match(
    examModulePublicationErrors(candidate).join(" "),
    /mindestens eine bewertbare Aufgabe/,
  );
});

test("exam publication rejects multiple direct lessons", () => {
  const candidate = examModule([
    block("question", "true_false", {
      prompt: "Ist die Aussage richtig?",
      options: ["Richtig", "Falsch"],
      correctOption: 0,
    }),
  ]);
  candidate.lessons.push({ ...candidate.lessons[0], id: "second" });
  const errors = examModulePublicationErrors(candidate).join(" ");
  assert.match(errors, /genau eine Pruefung/);
});
