import type { courseModules, courseWidgets, modules } from "@/db/schema";

type ModuleRow = typeof modules.$inferSelect;
type CourseModuleRow = typeof courseModules.$inferSelect;
type CourseWidgetRow = typeof courseWidgets.$inferSelect;

type CloneableModule = Pick<
  ModuleRow,
  | "title"
  | "kind"
  | "linkedCourseId"
  | "description"
  | "folder"
  | "isReusable"
  | "estimatedMinutes"
>;

type CloneableCourseModule = Pick<
  CourseModuleRow,
  | "sortOrder"
  | "indentLevel"
  | "accessMode"
  | "dripDays"
  | "delayPendingState"
  | "availableFrom"
  | "availableUntil"
  | "windowDefaultState"
  | "windowState"
  | "requestAccessEnabled"
  | "isRequired"
>;

type CloneableCourseWidget = Pick<
  CourseWidgetRow,
  | "type"
  | "sortOrder"
  | "authorUserId"
  | "authorRole"
  | "authorDescription"
  | "title"
  | "text"
  | "linkUrl"
  | "imageUrl"
  | "mediaAssetId"
  | "altText"
>;

export function moduleValuesForClone(
  organizationId: string,
  source: CloneableModule,
) {
  return {
    organizationId,
    title: source.title,
    kind: source.kind,
    linkedCourseId: source.linkedCourseId,
    description: source.description,
    folder: source.folder,
    isReusable: source.isReusable,
    estimatedMinutes: source.estimatedMinutes,
  };
}

export function courseModuleValuesForClone(
  organizationId: string,
  courseId: string,
  moduleId: string,
  source: CloneableCourseModule,
  moduleKind: ModuleRow["kind"],
) {
  return {
    organizationId,
    courseId,
    moduleId,
    sortOrder: source.sortOrder,
    indentLevel: source.indentLevel,
    accessMode: source.accessMode,
    dripDays: source.dripDays,
    delayPendingState: source.delayPendingState,
    availableFrom: source.availableFrom,
    availableUntil: source.availableUntil,
    windowDefaultState: source.windowDefaultState,
    windowState: source.windowState,
    requestAccessEnabled: source.requestAccessEnabled,
    isRequired: moduleKind === "link" ? false : source.isRequired,
  };
}

export function courseWidgetValuesForClone(
  organizationId: string,
  courseId: string,
  source: CloneableCourseWidget,
) {
  return {
    organizationId,
    courseId,
    type: source.type,
    sortOrder: source.sortOrder,
    authorUserId: source.authorUserId,
    authorRole: source.authorRole,
    authorDescription: source.authorDescription,
    title: source.title,
    text: source.text,
    linkUrl: source.linkUrl,
    imageUrl: source.imageUrl,
    mediaAssetId: source.mediaAssetId,
    altText: source.altText,
  };
}

export function shouldCloneModuleContent(moduleKind: ModuleRow["kind"]) {
  return moduleKind !== "link";
}
