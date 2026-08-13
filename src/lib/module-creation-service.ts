import "server-only";

import { randomUUID } from "node:crypto";

import { lessons, modules } from "@/db/schema";
import { createLessonPageWithTitleSync } from "@/lib/lesson-page-title-sync-service";
import type { ModuleStructureTransaction } from "@/lib/module-structure-service";
import { slugify } from "@/lib/utils";

function uniqueContentSlug(title: string) {
  const base = (slugify(title) || "pruefung").slice(0, 150);
  return `${base}-${randomUUID().slice(0, 8)}`;
}

export async function createModuleWithStructure(
  transaction: ModuleStructureTransaction,
  input: {
    organizationId: string;
    title: string;
    kind: "learning" | "exam" | "link";
    linkedCourseId?: string | null;
    description: string | null;
    folder: string;
    isReusable: boolean;
    estimatedMinutes: number;
  },
) {
  const [learningModule] = await transaction
    .insert(modules)
    .values({
      organizationId: input.organizationId,
      title: input.title,
      kind: input.kind,
      linkedCourseId: input.kind === "link" ? input.linkedCourseId : null,
      description: input.description,
      folder: input.folder,
      isReusable: input.isReusable,
      estimatedMinutes: input.estimatedMinutes,
    })
    .returning();

  if (input.kind === "link") {
    return { learningModule, lesson: null, page: null };
  }

  if (input.kind === "learning") {
    return { learningModule, lesson: null, page: null };
  }

  const lessonSlug = uniqueContentSlug(input.title);
  const [lesson] = await transaction
    .insert(lessons)
    .values({
      organizationId: input.organizationId,
      moduleId: learningModule.id,
      title: input.title,
      slug: lessonSlug,
      summary: input.description,
      type: "exam",
      durationMinutes: input.estimatedMinutes,
      passingScore: 100,
      maxAttempts: null,
      shuffleQuestions: false,
      sortOrder: 0,
      status: "published",
      visibility: "visible",
    })
    .returning();
  const page = await createLessonPageWithTitleSync(transaction, {
    organizationId: input.organizationId,
    lessonId: lesson.id,
    page: {
      title: input.title,
      titleSyncedWithLesson: true,
      slug: lessonSlug,
      sortOrder: 0,
      status: "published",
    },
  });
  return { learningModule, lesson, page };
}

export type CreatedModuleStructure = Awaited<
  ReturnType<typeof createModuleWithStructure>
>;
