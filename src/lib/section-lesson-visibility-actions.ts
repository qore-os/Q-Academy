"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/db";
import { activityEvents } from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import { requireCoursePermission } from "@/lib/course-permissions";
import { requireSharedModuleContentPermission } from "@/lib/shared-module-permissions";
import {
  sectionLessonVisibilitySchema,
  sectionLessonVisibilitySuccessMessage,
  type SectionLessonVisibility,
} from "@/lib/section-lesson-visibility";
import { setSectionLessonsVisibility } from "@/lib/section-lesson-visibility-service";
import {
  getCourseParityCopy,
  type SectionVisibilityActionCode,
} from "@/lib/i18n/course-parity";
import { normalizeLocale, type AppLocale } from "@/lib/i18n/model";
import { resolveUserLocale } from "@/lib/i18n/server";
import { logServerError } from "@/lib/server-error-logging";

export type SectionLessonVisibilityActionResult = {
  ok: boolean;
  code: SectionVisibilityActionCode;
  message: string;
  updatedLessonCount?: number;
};

const inputSchema = z
  .object({
    courseId: z.string().uuid(),
    sectionId: z.string().uuid(),
    visibility: sectionLessonVisibilitySchema,
  })
  .strict();

export async function setSectionLessonsVisibilityAction(
  courseId: string,
  sectionId: string,
  visibility: SectionLessonVisibility,
  requestedLocale?: AppLocale,
): Promise<SectionLessonVisibilityActionResult> {
  const { user: actor } = await requireCoursePermission(courseId, "edit");
  const locale = normalizeLocale(
    requestedLocale,
    await resolveUserLocale(actor),
  );
  const copy = getCourseParityCopy(locale).visibility;
  const failure = (
    code: Exclude<SectionVisibilityActionCode, "section_visibility.updated">,
  ): SectionLessonVisibilityActionResult => ({
    ok: false,
    code,
    message: copy.action[code],
  });
  const parsed = inputSchema.safeParse({ courseId, sectionId, visibility });
  if (!parsed.success) {
    return failure("section_visibility.invalid_input");
  }

  try {
    const result = await db.transaction(async (tx) => {
      await requireSharedModuleContentPermission(
        tx,
        actor,
        parsed.data.courseId,
        {
          type: "section",
          id: parsed.data.sectionId,
        },
      );

      const changed = await setSectionLessonsVisibility(tx, {
        organizationId: actor.organizationId,
        courseId: parsed.data.courseId,
        sectionId: parsed.data.sectionId,
        visibility: parsed.data.visibility,
      });
      await tx.insert(activityEvents).values({
        organizationId: actor.organizationId,
        userId: actor.id,
        type: "section.lesson_visibility.updated",
        entityType: "section",
        entityId: changed.sectionId,
        metadata: {
          courseId: parsed.data.courseId,
          moduleId: changed.moduleId,
          visibility: changed.visibility,
          updatedLessonCount: changed.updatedLessonCount,
        },
      });
      return changed;
    });

    revalidatePath(`/admin/courses/${parsed.data.courseId}`);
    revalidatePath("/admin/courses");
    return {
      ok: true,
      code: "section_visibility.updated",
      message: sectionLessonVisibilitySuccessMessage(
        result.visibility,
        result.updatedLessonCount,
        locale,
      ),
      updatedLessonCount: result.updatedLessonCount,
    };
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return failure("section_visibility.section_unavailable");
    }
    if (error instanceof ApiError && error.status === 409) {
      return failure("section_visibility.conflict");
    }
    if (error instanceof ApiError && error.status === 403) {
      return failure("section_visibility.permission_denied");
    }
    logServerError(error, { action: "section.lesson_visibility.update" });
    return failure("section_visibility.failed");
  }
}
