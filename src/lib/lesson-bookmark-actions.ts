"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { setLessonBookmark } from "@/lib/lesson-bookmarks";
import { logServerError } from "@/lib/server-error-logging";

const bookmarkInputSchema = z
  .object({
    courseId: z.string().uuid(),
    moduleId: z.string().uuid(),
    lessonId: z.string().uuid(),
    bookmarked: z.boolean(),
  })
  .strict();

export type LessonBookmarkActionState = {
  status: "idle" | "saved" | "error";
  bookmarked: boolean;
  message: string;
};

export async function setLessonBookmarkAction(
  input: z.infer<typeof bookmarkInputSchema>,
  previousState: LessonBookmarkActionState,
): Promise<LessonBookmarkActionState> {
  void previousState;
  const user = await requireUser();
  const parsed = bookmarkInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      status: "error",
      bookmarked: !input.bookmarked,
      message: "Lesezeichen konnte nicht geaendert werden.",
    };
  }
  try {
    const result = await setLessonBookmark({
      organizationId: user.organizationId,
      userId: user.id,
      ...parsed.data,
    });
    if (!result) {
      return {
        status: "error",
        bookmarked: !parsed.data.bookmarked,
        message: "Der Inhalt ist nicht mehr verfuegbar.",
      };
    }
    revalidatePath("/academy/bookmarks");
    revalidatePath("/academy/courses/[slug]/learn/[lessonId]", "page");
    return {
      status: "saved",
      bookmarked: parsed.data.bookmarked,
      message: parsed.data.bookmarked
        ? "Lesezeichen gespeichert."
        : "Lesezeichen entfernt.",
    };
  } catch (error) {
    logServerError(error, { action: "learning.lesson_bookmark.set" });
    return {
      status: "error",
      bookmarked: !parsed.data.bookmarked,
      message: "Lesezeichen konnte nicht geaendert werden.",
    };
  }
}
