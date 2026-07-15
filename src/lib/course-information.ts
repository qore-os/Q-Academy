import { z } from "zod";

const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

export const courseLearningGoalSchema = z
  .string()
  .trim()
  .min(1, "Lernziele duerfen nicht leer sein.")
  .max(500)
  .refine(
    (value) => !CONTROL_CHARACTERS.test(value),
    "Lernziel enthaelt ungueltige Steuerzeichen.",
  );

export const courseLearningGoalsSchema = z
  .array(courseLearningGoalSchema)
  .max(20)
  .refine(
    (goals) =>
      new Set(
        goals.map((goal) =>
          goal.normalize("NFKC").replace(/\s+/g, " ").toLocaleLowerCase("de"),
        ),
      ).size === goals.length,
    "Lernziele duerfen nicht doppelt vorkommen.",
  );

export const courseAuthorIdsSchema = z
  .array(z.string().uuid())
  .max(20)
  .refine(
    (ids) => new Set(ids).size === ids.length,
    "Kursautoren duerfen nicht doppelt vorkommen.",
  );

export type CourseInformationCollections = {
  learningGoals?: string[];
  authorIds?: string[];
};
