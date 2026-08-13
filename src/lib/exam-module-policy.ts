import type {
  ContentBlockData,
  ExamQuestionPoolConfiguration,
} from "@/db/schema";
import {
  assessmentQuestionTypes,
  buildAssessmentQuestionSnapshot,
  isAssessmentQuestionType,
} from "@/lib/assessment-engine";
import { examLifecycleConfigurationErrors } from "@/lib/exam-lifecycle-policy";

export const moduleKinds = ["learning", "exam", "link"] as const;
export type ModuleKind = (typeof moduleKinds)[number];

export const examGradableBlockTypes = [
  ...assessmentQuestionTypes,
  "submission",
] as const;

type ExamPublicationBlock = {
  id: string;
  type: string;
  title: string | null;
  required: boolean;
  data: ContentBlockData;
};

type ExamPublicationLesson = {
  id: string;
  type: string;
  status: string;
  visibility?: string;
  examDurationSeconds?: number | null;
  examQuestionPools?: ExamQuestionPoolConfiguration[];
  examResultReleaseMode?: "immediate" | "after_deadline" | "manual";
  examReviewReleaseMode?: "never" | "after_result" | "manual";
  examContentAccessMode?: "allow" | "block_course" | "block_academy";
  blocks: ExamPublicationBlock[];
  pages: Array<{ status?: string; blocks: ExamPublicationBlock[] }>;
};

type ExamPublicationModule = {
  kind?: ModuleKind;
  lessons: ExamPublicationLesson[];
};

export function effectiveModuleKind(kind: unknown): ModuleKind {
  return kind === "exam" ? "exam" : kind === "link" ? "link" : "learning";
}

export function examModulePublicationErrors(
  learningModule: ExamPublicationModule,
) {
  if (effectiveModuleKind(learningModule.kind) !== "exam") return [];

  const errors: string[] = [];
  if (learningModule.lessons.length !== 1) {
    errors.push("Ein Pruefungsmodul benoetigt genau eine Pruefung.");
  }
  const lesson = learningModule.lessons[0];
  if (!lesson) return errors;
  if (lesson.type !== "exam") {
    errors.push("Die Pruefung muss als Typ Pruefung angelegt sein.");
  }
  const visibility =
    lesson.visibility ?? (lesson.status === "published" ? "visible" : "draft");
  if (lesson.status !== "published" || visibility !== "visible") {
    errors.push(
      "Die Pruefung muss fuer die Veroeffentlichung freigegeben sein.",
    );
  }

  const blocks = [
    ...lesson.blocks,
    ...lesson.pages
      .filter((page) => (page.status ?? "published") === "published")
      .flatMap((page) => page.blocks),
  ];
  const gradableBlocks = blocks.filter(
    (block) =>
      isAssessmentQuestionType(block.type) || block.type === "submission",
  );
  if (gradableBlocks.length === 0) {
    errors.push(
      "Das Pruefungsmodul benoetigt mindestens eine bewertbare Aufgabe.",
    );
    return errors;
  }
  if (!gradableBlocks.some((block) => isAssessmentQuestionType(block.type))) {
    errors.push(
      "Das Pruefungsmodul benoetigt mindestens eine automatisch bewertbare Frage; Abgaben koennen zusaetzlich verwendet werden.",
    );
  }

  for (const block of gradableBlocks) {
    if (!block.required) {
      errors.push(
        `Die bewertbare Aufgabe ${block.title?.trim() || block.id} muss verpflichtend sein.`,
      );
      continue;
    }
    if (
      isAssessmentQuestionType(block.type) &&
      !buildAssessmentQuestionSnapshot(block)
    ) {
      errors.push(
        `Die automatische Aufgabe ${block.title?.trim() || block.id} ist unvollstaendig.`,
      );
      continue;
    }
    if (block.type === "submission") {
      const prompt = block.data.prompt?.trim();
      if (!prompt || prompt.length < 3 || prompt.length > 2_000) {
        errors.push(
          `Die Abgabeaufgabe ${block.title?.trim() || block.id} benoetigt eine gueltige Aufgabenstellung.`,
        );
      }
    }
  }
  errors.push(
    ...examLifecycleConfigurationErrors({
      configuration: {
        durationSeconds: lesson.examDurationSeconds ?? null,
        questionPools: lesson.examQuestionPools ?? [],
        resultReleaseMode: lesson.examResultReleaseMode ?? "immediate",
        reviewReleaseMode: lesson.examReviewReleaseMode ?? "after_result",
        contentAccessMode: lesson.examContentAccessMode ?? "allow",
      },
      questionIds: gradableBlocks
        .filter((block) => isAssessmentQuestionType(block.type))
        .map((block) => block.id),
    }),
  );
  return errors;
}
