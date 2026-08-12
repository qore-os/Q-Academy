import type { CourseVersionSnapshot } from "@/db/schema";
import { safeCourseImageSource } from "@/lib/content-blocks/interactive-documents";
import { parseVideoPlaybackPolicy } from "@/lib/media/video-playback-policy";
import { sanitizeVideoPoster } from "@/lib/media/video-poster";
import { safeRichTextHref } from "@/lib/rich-text/document";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const moduleAccessModes = new Set([
  "visible",
  "after_previous",
  "delay_days",
  "date_window",
  "coming_soon",
  "locked",
  "hidden",
]);
const configuredAccessStates = new Set([
  "available",
  "read_only",
  "locked",
  "hidden",
]);
const contentVisibilities = new Set(["visible", "draft", "coming_soon"]);

function validDateString(value: unknown, nullable = false) {
  if (nullable && value === null) return true;
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function validContentBlocks(value: unknown) {
  return (
    Array.isArray(value) &&
    value.every((entry) => {
      if (!entry || typeof entry !== "object") return false;
      const block = entry as Record<string, unknown>;
      const revision = block.revision;
      const data =
        block.data && typeof block.data === "object"
          ? (block.data as Record<string, unknown>)
          : null;
      return (
        (revision === undefined ||
          (Number.isInteger(revision) && Number(revision) > 0)) &&
        (block.type !== "video" ||
          ((data?.videoPlayback === undefined ||
            parseVideoPlaybackPolicy(data.videoPlayback) !== null) &&
            (data?.videoPoster === undefined ||
              sanitizeVideoPoster(data.videoPoster) !== null)))
      );
    })
  );
}

function validCourseWidgets(
  value: unknown,
  courseId: string,
  organizationId: string,
) {
  if (!Array.isArray(value)) return false;
  const ids = new Set<string>();
  return value.every((entry) => {
    if (!entry || typeof entry !== "object") return false;
    const widget = entry as Record<string, unknown>;
    if (
      typeof widget.id !== "string" ||
      !UUID_PATTERN.test(widget.id) ||
      ids.has(widget.id) ||
      widget.courseId !== courseId ||
      widget.organizationId !== organizationId ||
      !Number.isInteger(widget.sortOrder) ||
      Number(widget.sortOrder) < 0 ||
      !validDateString(widget.createdAt) ||
      !validDateString(widget.updatedAt)
    ) {
      return false;
    }
    ids.add(widget.id);
    if (widget.type !== "image_link") {
      return (
        (widget.type === "author" || widget.type === "info") &&
        (widget.mediaAssetId === null || widget.mediaAssetId === undefined)
      );
    }
    const imageSource = safeCourseImageSource(widget.imageUrl);
    if (
      !imageSource ||
      !safeRichTextHref(widget.linkUrl) ||
      typeof widget.altText !== "string" ||
      !widget.altText.trim()
    ) {
      return false;
    }
    if (widget.mediaAssetId === null || widget.mediaAssetId === undefined) {
      return (
        imageSource.startsWith("/images/") || imageSource.startsWith("https://")
      );
    }
    return (
      typeof widget.mediaAssetId === "string" &&
      UUID_PATTERN.test(widget.mediaAssetId) &&
      imageSource === `/api/media-assets/${widget.mediaAssetId}/download`
    );
  });
}

export function isValidPublishedCourseSnapshot(
  snapshot: unknown,
  courseId: string,
  organizationId: string,
): snapshot is CourseVersionSnapshot {
  if (!snapshot || typeof snapshot !== "object") return false;
  const candidate = snapshot as Record<string, unknown>;
  if (
    candidate.schemaVersion !== 2 &&
    candidate.schemaVersion !== 3 &&
    candidate.schemaVersion !== 4 &&
    candidate.schemaVersion !== 5
  ) {
    return false;
  }
  if (!validDateString(candidate.capturedAt)) return false;
  if (!candidate.course || typeof candidate.course !== "object") return false;
  const course = candidate.course as Record<string, unknown>;
  if (course.id !== courseId || course.organizationId !== organizationId) {
    return false;
  }
  if (!Array.isArray(candidate.modules)) return false;
  const hasAccessPolicy = candidate.accessPolicyVersion === 1;
  const hasModuleKind = candidate.moduleKindVersion === 1;
  const hasCourseOutline = candidate.courseOutlineVersion === 1;
  if (
    candidate.schemaVersion === 3 &&
    candidate.accessPolicyVersion !== undefined &&
    !hasAccessPolicy
  ) {
    return false;
  }
  if (candidate.moduleKindVersion !== undefined && !hasModuleKind) {
    return false;
  }
  if (
    candidate.courseOutlineVersion !== undefined &&
    !hasCourseOutline
  ) {
    return false;
  }
  const hasStrictOutline =
    candidate.schemaVersion === 4 || candidate.schemaVersion === 5;
  if (
    hasStrictOutline &&
    (!hasAccessPolicy || !hasModuleKind || !hasCourseOutline)
  ) {
    return false;
  }
  if (
    candidate.schemaVersion === 5 &&
    !validCourseWidgets(candidate.widgets, courseId, organizationId)
  ) {
    return false;
  }
  const moduleIds = new Set<string>();
  const sectionIds = new Set<string>();
  const lessonIds = new Set<string>();

  const validLesson = (
    lessonEntry: unknown,
    moduleId: string,
    sectionId: string | null,
  ) => {
    if (!lessonEntry || typeof lessonEntry !== "object") return false;
    const lesson = lessonEntry as Record<string, unknown>;
    if (
      typeof lesson.id !== "string" ||
      lessonIds.has(lesson.id) ||
      lesson.moduleId !== moduleId ||
      lesson.sectionId !== sectionId ||
      !validContentBlocks(lesson.blocks) ||
      !Array.isArray(lesson.pages)
    ) {
      return false;
    }
    for (const pageEntry of lesson.pages) {
      if (
        !pageEntry ||
        typeof pageEntry !== "object" ||
        !validContentBlocks((pageEntry as Record<string, unknown>).blocks) ||
        ((pageEntry as Record<string, unknown>).titleSyncedWithLesson !==
          undefined &&
          typeof (pageEntry as Record<string, unknown>)
            .titleSyncedWithLesson !== "boolean")
      ) {
        return false;
      }
    }
    if (
      hasAccessPolicy &&
      (lesson.organizationId !== organizationId ||
        !contentVisibilities.has(String(lesson.visibility)) ||
        !validDateString(lesson.availableAt, true))
    ) {
      return false;
    }
    lessonIds.add(lesson.id);
    return true;
  };

  let previousIndentLevel = 0;
  for (const [moduleIndex, entry] of candidate.modules.entries()) {
    if (!entry || typeof entry !== "object") return false;
    const learningModule = entry as Record<string, unknown>;
    if (
      typeof learningModule.id !== "string" ||
      moduleIds.has(learningModule.id) ||
      !Array.isArray(learningModule.lessons) ||
      !Array.isArray(learningModule.sections) ||
      (hasModuleKind &&
        learningModule.kind !== "learning" &&
        learningModule.kind !== "exam" &&
        (!hasStrictOutline || learningModule.kind !== "link"))
    ) {
      return false;
    }
    if (hasStrictOutline) {
      const indentLevel = learningModule.indentLevel;
      if (
        !Number.isInteger(indentLevel) ||
        Number(indentLevel) < 0 ||
        Number(indentLevel) > 3 ||
        (moduleIndex === 0 && indentLevel !== 0) ||
        (moduleIndex > 0 && Number(indentLevel) > previousIndentLevel + 1)
      ) {
        return false;
      }
      previousIndentLevel = Number(indentLevel);
      const isLink = learningModule.kind === "link";
      if (
        isLink &&
        (typeof learningModule.linkedCourseId !== "string" ||
          learningModule.linkedCourseId === courseId ||
          typeof learningModule.targetVersionIdAtCapture !== "string" ||
          learningModule.lessons.length !== 0 ||
          learningModule.sections.length !== 0 ||
          learningModule.isRequired !== false)
      ) {
        return false;
      }
      if (
        !isLink &&
        ((learningModule.linkedCourseId !== null &&
          learningModule.linkedCourseId !== undefined) ||
          (learningModule.targetVersionIdAtCapture !== null &&
            learningModule.targetVersionIdAtCapture !== undefined))
      ) {
        return false;
      }
    }
    moduleIds.add(learningModule.id);
    for (const lessonEntry of learningModule.lessons) {
      if (!validLesson(lessonEntry, learningModule.id, null)) return false;
    }
    for (const sectionEntry of learningModule.sections) {
      if (
        !sectionEntry ||
        typeof sectionEntry !== "object" ||
        !Array.isArray((sectionEntry as Record<string, unknown>).lessons)
      ) {
        return false;
      }
      const section = sectionEntry as Record<string, unknown>;
      if (
        typeof section.id !== "string" ||
        sectionIds.has(section.id) ||
        section.moduleId !== learningModule.id ||
        (hasAccessPolicy &&
          (section.organizationId !== organizationId ||
            !contentVisibilities.has(String(section.visibility))))
      ) {
        return false;
      }
      sectionIds.add(section.id);
      for (const lessonEntry of section.lessons as unknown[]) {
        if (!validLesson(lessonEntry, learningModule.id, section.id)) {
          return false;
        }
      }
    }
    if (hasAccessPolicy) {
      const availableFrom = learningModule.availableFrom;
      const availableUntil = learningModule.availableUntil;
      const accessMode = String(learningModule.accessMode);
      if (
        learningModule.organizationId !== organizationId ||
        !moduleAccessModes.has(accessMode) ||
        !configuredAccessStates.has(
          String(learningModule.delayPendingState),
        ) ||
        !configuredAccessStates.has(
          String(learningModule.windowDefaultState),
        ) ||
        !configuredAccessStates.has(String(learningModule.windowState)) ||
        typeof learningModule.requestAccessEnabled !== "boolean" ||
        typeof learningModule.dripDays !== "number" ||
        learningModule.dripDays < 0 ||
        learningModule.dripDays > 36_500 ||
        !validDateString(availableFrom, true) ||
        !validDateString(availableUntil, true) ||
        (accessMode === "date_window" &&
          availableFrom === null &&
          availableUntil === null) ||
        (accessMode !== "date_window" &&
          (availableFrom !== null || availableUntil !== null)) ||
        (accessMode !== "delay_days" && learningModule.dripDays !== 0) ||
        (typeof availableFrom === "string" &&
          typeof availableUntil === "string" &&
          Date.parse(availableUntil) <= Date.parse(availableFrom)) ||
        !["locked", "hidden"].includes(
          String(learningModule.delayPendingState),
        )
      ) {
        return false;
      }
    }
  }
  return (
    candidate.schemaVersion === 2 ||
    candidate.accessPolicyVersion === undefined ||
    validDateString(course.firstPublishedAt)
  );
}
