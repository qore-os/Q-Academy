export type LessonPageOrder = {
  id: string;
  sortOrder: number;
};

export function compareLessonPageOrder(
  left: LessonPageOrder,
  right: LessonPageOrder,
) {
  return left.sortOrder - right.sortOrder || left.id.localeCompare(right.id);
}

export function firstLessonPageId(pages: LessonPageOrder[]) {
  return [...pages].sort(compareLessonPageOrder)[0]?.id ?? null;
}

export function resolvePageTitleSync(input: {
  pageId: string;
  firstPageId: string | null;
  wasSynced: boolean;
  requestedSync: boolean | undefined;
}) {
  const wantsSync = input.requestedSync ?? input.wasSynced;
  if (!wantsSync) return { synced: false, invalidExplicitSync: false };
  if (input.pageId === input.firstPageId) {
    return { synced: true, invalidExplicitSync: false };
  }
  return {
    synced: false,
    invalidExplicitSync: input.requestedSync === true,
  };
}

export function synchronizedPageTitle(input: {
  lessonTitle: string;
  currentPageTitle: string;
  requestedPageTitle: string | undefined;
  wasSynced: boolean;
  willBeSynced: boolean;
}) {
  if (!input.willBeSynced) {
    return input.requestedPageTitle ?? input.currentPageTitle;
  }
  if (input.wasSynced && input.requestedPageTitle !== undefined) {
    return input.requestedPageTitle;
  }
  return input.lessonTitle;
}
