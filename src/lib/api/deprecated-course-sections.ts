import "server-only";

import { ApiError } from "@/lib/api/errors";

export const COURSE_SECTION_REPLACEMENT_PATH =
  "/api/v1/modules/{moduleId}/lessons";

export function courseSectionGone() {
  return new ApiError(
    410,
    "gone",
    `Kurssektionen wurden entfernt. Verwalte Lektionen direkt ueber ${COURSE_SECTION_REPLACEMENT_PATH}.`,
    { replacement: COURSE_SECTION_REPLACEMENT_PATH },
  );
}
