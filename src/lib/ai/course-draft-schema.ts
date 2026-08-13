import { z } from "zod";

const comparableText = (value: string) =>
  value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("de-DE");

function uniqueTextArray(
  minimum: number,
  maximum: number,
  itemMaximum: number,
  label: string,
) {
  return z
    .array(z.string().trim().min(1).max(itemMaximum))
    .min(minimum)
    .max(maximum)
    .superRefine((values, context) => {
      const seen = new Set<string>();
      for (const [index, value] of values.entries()) {
        const comparable = comparableText(value);
        if (seen.has(comparable)) {
          context.addIssue({
            code: "custom",
            path: [index],
            message: `${label} muessen eindeutig sein.`,
          });
        }
        seen.add(comparable);
      }
    });
}

const assessmentOptionsSchema = uniqueTextArray(2, 5, 300, "Antwortoptionen");

const headingBlockSchema = z
  .object({
    type: z.literal("heading"),
    text: z.string().trim().min(3).max(220),
  })
  .strict();

const textBlockSchema = z
  .object({
    type: z.literal("text"),
    text: z.string().trim().min(30).max(3_500),
  })
  .strict();

const infoBlockSchema = z
  .object({
    type: z.literal("info"),
    title: z.string().trim().min(3).max(160),
    text: z.string().trim().min(20).max(2_000),
    accent: z.enum(["navy", "teal", "coral", "amber"]),
  })
  .strict();

const checklistBlockSchema = z
  .object({
    type: z.literal("checklist"),
    title: z.string().trim().min(3).max(160),
    items: z.array(z.string().trim().min(3).max(300)).min(2).max(6),
  })
  .strict();

const multipleChoiceBlockSchema = z
  .object({
    type: z.literal("multiple_choice"),
    title: z.string().trim().min(3).max(160),
    prompt: z.string().trim().min(10).max(800),
    options: assessmentOptionsSchema,
    correctOption: z.number().int().min(0).max(4),
    feedback: z.string().trim().min(10).max(800),
  })
  .strict()
  .superRefine((block, context) => {
    if (block.correctOption >= block.options.length) {
      context.addIssue({
        code: "custom",
        path: ["correctOption"],
        message: "correctOption muss auf eine vorhandene Option zeigen.",
      });
    }
  });

const trueFalseBlockSchema = z
  .object({
    type: z.literal("true_false"),
    title: z.string().trim().min(3).max(160),
    prompt: z.string().trim().min(10).max(800),
    correctOption: z.number().int().min(0).max(1),
    feedback: z.string().trim().min(10).max(800),
  })
  .strict();

const multiSelectBlockSchema = z
  .object({
    type: z.literal("multi_select"),
    title: z.string().trim().min(3).max(160),
    prompt: z.string().trim().min(10).max(800),
    options: assessmentOptionsSchema,
    correctOptions: z.array(z.number().int().min(0).max(4)).min(1).max(4),
    feedback: z.string().trim().min(10).max(800),
  })
  .strict()
  .superRefine((block, context) => {
    const correctOptions = new Set(block.correctOptions);
    if (correctOptions.size !== block.correctOptions.length) {
      context.addIssue({
        code: "custom",
        path: ["correctOptions"],
        message: "Korrekte Antworten duerfen nicht doppelt vorkommen.",
      });
    }
    if (block.correctOptions.some((option) => option >= block.options.length)) {
      context.addIssue({
        code: "custom",
        path: ["correctOptions"],
        message: "Korrekte Antworten muessen auf vorhandene Optionen zeigen.",
      });
    }
    if (correctOptions.size === block.options.length) {
      context.addIssue({
        code: "custom",
        path: ["correctOptions"],
        message: "Mindestens eine Antwortoption muss falsch sein.",
      });
    }
  });

const fillBlankBlockSchema = z
  .object({
    type: z.literal("fill_blank"),
    title: z.string().trim().min(3).max(160),
    prompt: z.string().trim().min(10).max(800),
    acceptedAnswers: uniqueTextArray(1, 8, 300, "Akzeptierte Antworten"),
    caseSensitive: z.boolean(),
    feedback: z.string().trim().min(10).max(800),
  })
  .strict()
  .superRefine((block, context) => {
    const normalized = block.acceptedAnswers.map((answer) =>
      block.caseSensitive
        ? answer.normalize("NFKC").trim().replace(/\s+/g, " ")
        : comparableText(answer),
    );
    if (new Set(normalized).size !== normalized.length) {
      context.addIssue({
        code: "custom",
        path: ["acceptedAnswers"],
        message:
          "Akzeptierte Antworten muessen fuer die gewaehlte Grossschreibung eindeutig sein.",
      });
    }
  });

const orderingBlockSchema = z
  .object({
    type: z.literal("ordering"),
    title: z.string().trim().min(3).max(160),
    prompt: z.string().trim().min(10).max(800),
    options: uniqueTextArray(3, 6, 300, "Sortierelemente"),
    feedback: z.string().trim().min(10).max(800),
  })
  .strict();

export const generatedCourseBlockSchema = z.discriminatedUnion("type", [
  headingBlockSchema,
  textBlockSchema,
  infoBlockSchema,
  checklistBlockSchema,
  multipleChoiceBlockSchema,
  trueFalseBlockSchema,
  multiSelectBlockSchema,
  fillBlankBlockSchema,
  orderingBlockSchema,
]);

const scoredBlockTypes = new Set([
  "multiple_choice",
  "true_false",
  "multi_select",
  "fill_blank",
  "ordering",
]);

const generatedCoursePageSchema = z
  .object({
    title: z.string().trim().min(3).max(160),
    blocks: z.array(generatedCourseBlockSchema).min(2).max(5),
  })
  .strict();

export const generatedCourseLessonSchema = z
  .object({
    title: z.string().trim().min(3).max(180),
    summary: z.string().trim().min(20).max(700),
    type: z.enum(["lesson", "quiz"]),
    durationMinutes: z.number().int().min(5).max(90),
    pages: z.array(generatedCoursePageSchema).min(1).max(2),
  })
  .strict()
  .superRefine((lesson, context) => {
    if (
      lesson.type === "quiz" &&
      !lesson.pages.some((page) =>
        page.blocks.some((block) => scoredBlockTypes.has(block.type)),
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["pages"],
        message:
          "Eine Quiz-Lektion benoetigt mindestens eine bewertbare Wissensfrage.",
      });
    }
  });

export type GeneratedCourseBlock = z.infer<typeof generatedCourseBlockSchema>;

export const generatedCourseDifficultyValues = [
  "Grundlagen",
  "Fortgeschritten",
  "Experte",
  "Gemischt",
  "Foundation",
  "Intermediate",
  "Expert",
  "Mixed",
  "Fondamenti",
  "Intermedio",
  "Esperto",
  "Misto",
  "Fundamentos",
  "Experto",
  "Mixto",
  "Fondamentaux",
  "Intermediaire",
  "Mixte",
] as const;

const generatedCourseModuleSchema = z
  .object({
    title: z.string().trim().min(3).max(180),
    description: z.string().trim().min(20).max(900),
    lessons: z.array(generatedCourseLessonSchema).min(1).max(4),
  })
  .strict();

export const generatedCourseDraftSchema = z
  .object({
    title: z.string().trim().min(3).max(220),
    shortDescription: z.string().trim().min(20).max(500),
    description: z.string().trim().min(50).max(4_000),
    difficulty: z.enum(generatedCourseDifficultyValues),
    modules: z.array(generatedCourseModuleSchema).min(1).max(4),
  })
  .strict()
  .superRefine((draft, context) => {
    const blockTypes = new Set(
      draft.modules.flatMap((courseModule) =>
        courseModule.lessons.flatMap((lesson) =>
          lesson.pages.flatMap((page) =>
            page.blocks.map((block) => block.type),
          ),
        ),
      ),
    );
    for (const requiredType of [
      "text",
      "info",
      "checklist",
      "multiple_choice",
      "true_false",
      "multi_select",
      "fill_blank",
      "ordering",
    ] as const) {
      if (!blockTypes.has(requiredType)) {
        context.addIssue({
          code: "custom",
          path: ["modules"],
          message: `Der Kursentwurf benoetigt mindestens einen Block vom Typ ${requiredType}.`,
        });
      }
    }
  });

export type GeneratedCourseDraft = z.infer<typeof generatedCourseDraftSchema>;
