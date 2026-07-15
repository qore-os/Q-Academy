import "server-only";

import { ApiError } from "@/lib/api/errors";
import {
  courseDataFormIds,
  lockActiveCourseDataForms,
  lockCourseContentBlocksForMutation,
  type CourseDataFormTransaction,
} from "@/lib/course-data-form-lock";

export async function assertActiveDataFormBlock(input: {
  transaction: CourseDataFormTransaction;
  organizationId: string;
  type: string;
  data: unknown;
  }) {
  if (input.type !== "data_form") return;
  const blocks = [{ type: input.type, data: input.data }];
  if (!courseDataFormIds(blocks)) {
    throw new ApiError(
      422,
      "validation_error",
      "Formular-Bloecke benoetigen ein aktives Datenformular.",
    );
  }
  await lockCourseContentBlocksForMutation(input.transaction);
  if (
    !(await lockActiveCourseDataForms(
      input.transaction,
      input.organizationId,
      blocks,
    ))
  ) {
    throw new ApiError(
      422,
      "validation_error",
      "Das Datenformular ist nicht aktiv oder nicht verfuegbar.",
    );
  }
}
