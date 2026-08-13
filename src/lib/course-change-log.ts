import type { CourseVersionSnapshot } from "@/db/schema";
import { getCourseSupportCopy } from "@/lib/i18n/course-support";
import { DEFAULT_LOCALE, type AppLocale } from "@/lib/i18n/model";

export const COURSE_CHANGE_GROUPS = [
  ["course", "course"],
  ["goals", "goals"],
  ["authors", "authors"],
  ["widgets", "widgets"],
  ["modules", "modules"],
  ["access", "access"],
  ["lessons", "lessons"],
  ["pages", "pages"],
  ["blocks", "blocks"],
] as const;

export type CourseChangeGroupKey = (typeof COURSE_CHANGE_GROUPS)[number][0];
export type CourseChangeKind = "added" | "updated" | "removed" | "moved";

export type CourseChangeEntry = {
  key: string;
  kind: CourseChangeKind;
  title: string;
  detail: string;
};

export type CourseChangeGroup = {
  key: CourseChangeGroupKey;
  label: string;
  entries: CourseChangeEntry[];
};

export type CourseChangeDiff = {
  hasChanges: boolean;
  total: number;
  counts: Record<CourseChangeKind, number>;
  groups: CourseChangeGroup[];
};

type SnapshotModule = CourseVersionSnapshot["modules"][number];
type SnapshotLesson = SnapshotModule["lessons"][number];
type SnapshotPage = SnapshotLesson["pages"][number];
type SnapshotBlock = SnapshotLesson["blocks"][number];

type LocatedModule = { value: SnapshotModule; index: number };
type LocatedLesson = {
  value: SnapshotLesson;
  module: SnapshotModule;
  moduleIndex: number;
  index: number;
};
type LocatedPage = {
  value: SnapshotPage;
  lesson: SnapshotLesson;
  module: SnapshotModule;
  index: number;
};
type LocatedBlock = {
  value: SnapshotBlock;
  lesson: SnapshotLesson;
  page: SnapshotPage | null;
  module: SnapshotModule;
  index: number;
};

function normalizedValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizedValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      // The publication snapshot randomizes this learner-facing order.
      .filter(([key]) => key !== "presentationOrder")
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, normalizedValue(entry)]),
  );
}

function sameValue(left: unknown, right: unknown) {
  return (
    JSON.stringify(normalizedValue(left)) ===
    JSON.stringify(normalizedValue(right))
  );
}

function selected<T extends object>(value: T, keys: readonly (keyof T)[]) {
  return Object.fromEntries(keys.map((key) => [String(key), value[key]]));
}

function sameSelected<T extends object>(
  left: T,
  right: T,
  keys: readonly (keyof T)[],
) {
  return sameValue(selected(left, keys), selected(right, keys));
}

function trimmed(value: string | null | undefined, fallback: string) {
  const clean = value?.trim();
  if (!clean) return fallback;
  return clean.length > 90 ? `${clean.slice(0, 87)}...` : clean;
}

function indexById<T extends { id: string }>(values: T[]) {
  return new Map(values.map((value) => [value.id, value]));
}

function modules(snapshot: CourseVersionSnapshot | null) {
  return new Map<string, LocatedModule>(
    (snapshot?.modules ?? []).map((value, index) => [
      value.id,
      { value, index },
    ]),
  );
}

function lessons(snapshot: CourseVersionSnapshot | null) {
  const result = new Map<string, LocatedLesson>();
  for (const [moduleIndex, learningModule] of (
    snapshot?.modules ?? []
  ).entries()) {
    for (const [index, lesson] of learningModule.lessons.entries()) {
      result.set(lesson.id, {
        value: lesson,
        module: learningModule,
        moduleIndex,
        index,
      });
    }
  }
  return result;
}

function pages(snapshot: CourseVersionSnapshot | null) {
  const result = new Map<string, LocatedPage>();
  for (const locatedLesson of lessons(snapshot).values()) {
    for (const [index, page] of locatedLesson.value.pages.entries()) {
      result.set(page.id, {
        value: page,
        lesson: locatedLesson.value,
        module: locatedLesson.module,
        index,
      });
    }
  }
  return result;
}

function blocks(snapshot: CourseVersionSnapshot | null) {
  const result = new Map<string, LocatedBlock>();
  for (const locatedLesson of lessons(snapshot).values()) {
    for (const [index, block] of locatedLesson.value.blocks.entries()) {
      result.set(block.id, {
        value: block,
        lesson: locatedLesson.value,
        page: null,
        module: locatedLesson.module,
        index,
      });
    }
    for (const page of locatedLesson.value.pages) {
      for (const [index, block] of page.blocks.entries()) {
        result.set(block.id, {
          value: block,
          lesson: locatedLesson.value,
          page,
          module: locatedLesson.module,
          index,
        });
      }
    }
  }
  return result;
}

function legacyVisibility(value: { status: string; visibility?: string }) {
  return (
    value.visibility ?? (value.status === "published" ? "visible" : "draft")
  );
}

function moduleAccess(value: SnapshotModule) {
  return {
    accessMode:
      value.accessMode ?? (value.dripDays > 0 ? "delay_days" : "visible"),
    dripDays: value.dripDays,
    delayPendingState: value.delayPendingState ?? "locked",
    availableFrom: value.availableFrom ?? null,
    availableUntil: value.availableUntil ?? null,
    windowDefaultState: value.windowDefaultState ?? "locked",
    windowState: value.windowState ?? "available",
    requestAccessEnabled: value.requestAccessEnabled ?? false,
    isRequired: value.isRequired,
  };
}

function moduleKind(value: SnapshotModule) {
  return value.kind ?? "learning";
}

function moduleIndentLevel(value: SnapshotModule) {
  return value.indentLevel ?? 0;
}

export function diffCourseSnapshots(
  published: CourseVersionSnapshot | null,
  draft: CourseVersionSnapshot,
  locale: AppLocale = DEFAULT_LOCALE,
): CourseChangeDiff {
  const copy = getCourseSupportCopy(locale).diff;
  const groupEntries = new Map<CourseChangeGroupKey, CourseChangeEntry[]>();
  for (const [key] of COURSE_CHANGE_GROUPS) groupEntries.set(key, []);
  let sequence = 0;
  const add = (
    group: CourseChangeGroupKey,
    kind: CourseChangeKind,
    title: string,
    detail: string,
  ) => {
    sequence += 1;
    groupEntries.get(group)!.push({
      key: `${group}-${sequence}`,
      kind,
      title,
      detail,
    });
  };

  if (!published) {
    add("course", "added", copy.draftCreated, copy.noPublishedVersion);
  } else {
    const courseFields = [
      "categoryId",
      "title",
      "slug",
      "shortDescription",
      "description",
      "coverImage",
      "difficulty",
      "estimatedMinutes",
      "certificateEnabled",
      "featured",
      "visibleInCatalog",
      "showProgressPercentage",
      "notifyMembersOnModuleRelease",
    ] as const;
    for (const field of courseFields) {
      if (!sameValue(published.course[field], draft.course[field])) {
        add(
          "course",
          "updated",
          copy.changed(copy.fields[field]),
          copy.courseInformation,
        );
      }
    }
  }

  const oldGoals = indexById(published?.learningGoals ?? []);
  const newGoals = indexById(draft.learningGoals ?? []);
  for (const goal of published?.learningGoals ?? []) {
    if (!newGoals.has(goal.id)) {
      add(
        "goals",
        "removed",
        trimmed(goal.text, copy.fallback.goal),
        copy.details.goalRemoved,
      );
    }
  }
  for (const [index, goal] of (draft.learningGoals ?? []).entries()) {
    const previous = oldGoals.get(goal.id);
    const label = trimmed(goal.text, copy.fallback.goal);
    if (!previous) add("goals", "added", label, copy.details.goalAdded);
    else {
      if (previous.text !== goal.text)
        add("goals", "updated", label, copy.details.textChanged);
      const previousIndex = (published?.learningGoals ?? []).findIndex(
        (item) => item.id === goal.id,
      );
      if (previousIndex !== index)
        add("goals", "moved", label, copy.details.orderChanged);
    }
  }

  const oldAuthors = indexById(published?.authors ?? []);
  const newAuthors = indexById(draft.authors ?? []);
  const authorLabel = (
    author: NonNullable<CourseVersionSnapshot["authors"]>[number],
  ) =>
    trimmed(
      `${author.author.firstName} ${author.author.lastName}`,
      copy.fallback.author,
    );
  for (const author of published?.authors ?? []) {
    if (!newAuthors.has(author.id))
      add(
        "authors",
        "removed",
        authorLabel(author),
        copy.details.authorRemoved,
      );
  }
  for (const [index, author] of (draft.authors ?? []).entries()) {
    const previous = oldAuthors.get(author.id);
    const label = authorLabel(author);
    if (!previous) add("authors", "added", label, copy.details.authorAdded);
    else {
      if (
        !sameValue(previous.author, author.author) ||
        previous.userId !== author.userId
      ) {
        add("authors", "updated", label, copy.details.authorProfileChanged);
      }
      const previousIndex = (published?.authors ?? []).findIndex(
        (item) => item.id === author.id,
      );
      if (previousIndex !== index)
        add("authors", "moved", label, copy.details.orderChanged);
    }
  }

  const oldWidgets = indexById(published?.widgets ?? []);
  const newWidgets = indexById(draft.widgets ?? []);
  const widgetLabel = (
    widget: NonNullable<CourseVersionSnapshot["widgets"]>[number],
  ) =>
    trimmed(
      widget.title,
      widget.type === "author"
        ? copy.fallback.authorWidget
        : copy.fallback.widget,
    );
  for (const widget of published?.widgets ?? []) {
    if (!newWidgets.has(widget.id))
      add(
        "widgets",
        "removed",
        widgetLabel(widget),
        copy.details.widgetRemoved,
      );
  }
  for (const [index, widget] of (draft.widgets ?? []).entries()) {
    const previous = oldWidgets.get(widget.id);
    const label = widgetLabel(widget);
    if (!previous) add("widgets", "added", label, copy.details.widgetAdded);
    else {
      if (
        !sameSelected(previous, widget, [
          "type",
          "authorUserId",
          "authorRole",
          "authorDescription",
          "title",
          "text",
          "linkUrl",
          "imageUrl",
          "altText",
          "author",
        ])
      ) {
        add("widgets", "updated", label, copy.details.widgetContentChanged);
      }
      const previousIndex = (published?.widgets ?? []).findIndex(
        (item) => item.id === widget.id,
      );
      if (previousIndex !== index)
        add("widgets", "moved", label, copy.details.orderChanged);
    }
  }

  const oldModules = modules(published);
  const newModules = modules(draft);
  for (const oldModule of oldModules.values()) {
    if (!newModules.has(oldModule.value.id)) {
      add(
        "modules",
        "removed",
        trimmed(oldModule.value.title, copy.fallback.module),
        copy.details.moduleRemoved,
      );
    }
  }
  for (const current of newModules.values()) {
    const previous = oldModules.get(current.value.id);
    const label = trimmed(current.value.title, copy.fallback.module);
    if (!previous) add("modules", "added", label, copy.details.moduleAdded);
    else {
      if (
        !sameValue(
          {
            title: previous.value.title,
            description: previous.value.description,
            folder: previous.value.folder,
            isReusable: previous.value.isReusable,
            estimatedMinutes: previous.value.estimatedMinutes,
          },
          {
            title: current.value.title,
            description: current.value.description,
            folder: current.value.folder,
            isReusable: current.value.isReusable,
            estimatedMinutes: current.value.estimatedMinutes,
          },
        )
      ) {
        add("modules", "updated", label, copy.details.moduleContentChanged);
      }
      const previousKind = moduleKind(previous.value);
      const currentKind = moduleKind(current.value);
      if (previousKind !== currentKind) {
        add("modules", "updated", label, copy.details.moduleTypeChanged);
      } else if (
        currentKind === "link" &&
        (previous.value.linkedCourseId ?? null) !==
          (current.value.linkedCourseId ?? null)
      ) {
        add("modules", "updated", label, copy.details.linkedCourseChanged);
      }
      const orderChanged = previous.index !== current.index;
      const indentChanged =
        moduleIndentLevel(previous.value) !== moduleIndentLevel(current.value);
      if (orderChanged || indentChanged) {
        const detail =
          orderChanged && indentChanged
            ? copy.details.orderAndIndentChanged
            : orderChanged
              ? copy.details.orderChanged
              : copy.details.indentChanged;
        add("modules", "moved", label, detail);
      }
      if (
        !sameValue(moduleAccess(previous.value), moduleAccess(current.value))
      ) {
        add("access", "updated", label, copy.details.moduleAccessChanged);
      }
    }
  }

  const oldLessons = lessons(published);
  const newLessons = lessons(draft);
  for (const oldLesson of oldLessons.values()) {
    if (!newLessons.has(oldLesson.value.id)) {
      add(
        "lessons",
        "removed",
        trimmed(oldLesson.value.title, copy.fallback.lesson),
        copy.from(oldLesson.module.title),
      );
    }
  }
  for (const current of newLessons.values()) {
    const previous = oldLessons.get(current.value.id);
    const label = trimmed(current.value.title, copy.fallback.lesson);
    if (!previous)
      add("lessons", "added", label, copy.in(current.module.title));
    else {
      const previousComparable = {
        title: previous.value.title,
        summary: previous.value.summary,
        slug: previous.value.slug,
        type: previous.value.type,
        durationMinutes: previous.value.durationMinutes,
        passingScore: previous.value.passingScore,
        maxAttempts: previous.value.maxAttempts,
        shuffleQuestions: previous.value.shuffleQuestions,
        status: previous.value.status,
        visibility: legacyVisibility(previous.value),
        availableAt: previous.value.availableAt,
        dripDays: previous.value.dripDays,
        unlockAfterPrevious: previous.value.unlockAfterPrevious,
      };
      const currentComparable = {
        title: current.value.title,
        summary: current.value.summary,
        slug: current.value.slug,
        type: current.value.type,
        durationMinutes: current.value.durationMinutes,
        passingScore: current.value.passingScore,
        maxAttempts: current.value.maxAttempts,
        shuffleQuestions: current.value.shuffleQuestions,
        status: current.value.status,
        visibility: legacyVisibility(current.value),
        availableAt: current.value.availableAt,
        dripDays: current.value.dripDays,
        unlockAfterPrevious: current.value.unlockAfterPrevious,
      };
      if (!sameValue(previousComparable, currentComparable)) {
        add("lessons", "updated", label, copy.details.lessonSettingsChanged);
      }
      if (
        previous.module.id !== current.module.id ||
        previous.index !== current.index
      ) {
        add("lessons", "moved", label, copy.in(current.module.title));
      }
    }
  }

  const oldPages = pages(published);
  const newPages = pages(draft);
  for (const oldPage of oldPages.values()) {
    if (!newPages.has(oldPage.value.id)) {
      add(
        "pages",
        "removed",
        trimmed(oldPage.value.title, copy.fallback.page),
        copy.from(oldPage.lesson.title),
      );
    }
  }
  for (const current of newPages.values()) {
    const previous = oldPages.get(current.value.id);
    const label = trimmed(current.value.title, copy.fallback.page);
    if (!previous) add("pages", "added", label, copy.in(current.lesson.title));
    else {
      if (
        !sameValue(
          {
            title: previous.value.title,
            slug: previous.value.slug,
            status: previous.value.status,
            titleSyncedWithLesson:
              previous.value.titleSyncedWithLesson ?? false,
          },
          {
            title: current.value.title,
            slug: current.value.slug,
            status: current.value.status,
            titleSyncedWithLesson: current.value.titleSyncedWithLesson ?? false,
          },
        )
      ) {
        add("pages", "updated", label, copy.details.pageSettingsChanged);
      }
      if (
        previous.lesson.id !== current.lesson.id ||
        previous.index !== current.index
      ) {
        add("pages", "moved", label, copy.in(current.lesson.title));
      }
    }
  }

  const oldBlocks = blocks(published);
  const newBlocks = blocks(draft);
  const blockLabel = (block: SnapshotBlock) =>
    trimmed(block.title, copy.blockTypes[block.type] ?? copy.fallback.block);
  const blockDetail = (block: LocatedBlock) =>
    block.page ? copy.on(block.page.title) : copy.in(block.lesson.title);
  for (const oldBlock of oldBlocks.values()) {
    if (!newBlocks.has(oldBlock.value.id)) {
      add(
        "blocks",
        "removed",
        blockLabel(oldBlock.value),
        blockDetail(oldBlock),
      );
    }
  }
  for (const current of newBlocks.values()) {
    const previous = oldBlocks.get(current.value.id);
    const label = blockLabel(current.value);
    if (!previous) add("blocks", "added", label, blockDetail(current));
    else {
      if (
        !sameSelected(previous.value, current.value, [
          "type",
          "title",
          "required",
          "data",
        ])
      ) {
        add(
          "blocks",
          "updated",
          label,
          copy.blockContentChanged(blockDetail(current)),
        );
      }
      if (
        previous.lesson.id !== current.lesson.id ||
        previous.page?.id !== current.page?.id ||
        previous.index !== current.index
      ) {
        add("blocks", "moved", label, blockDetail(current));
      }
    }
  }

  const groups = COURSE_CHANGE_GROUPS.map(([key]) => ({
    key,
    label: copy.groups[key],
    entries: groupEntries.get(key)!,
  })).filter((group) => group.entries.length > 0);
  const counts: Record<CourseChangeKind, number> = {
    added: 0,
    updated: 0,
    removed: 0,
    moved: 0,
  };
  for (const group of groups) {
    for (const entry of group.entries) counts[entry.kind] += 1;
  }
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  return { hasChanges: total > 0, total, counts, groups };
}
