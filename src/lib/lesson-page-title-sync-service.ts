import "server-only";

import { and, asc, eq, ne, sql } from "drizzle-orm";

import { db } from "@/db";
import { lessonPages, lessons, modules } from "@/db/schema";
import { ApiError } from "@/lib/api/errors";
import {
  firstLessonPageId,
  resolvePageTitleSync,
  synchronizedPageTitle,
} from "@/lib/lesson-page-title-sync-policy";
import {
  assertExamModuleRetainsPage,
  assertLessonStructureMutation,
  lockLessonModuleStructure,
} from "@/lib/module-structure-service";

export type LessonPageTitleSyncTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0];

type LessonUpdate = Partial<
  Pick<
    typeof lessons.$inferInsert,
    | "title"
    | "slug"
    | "summary"
    | "type"
    | "durationMinutes"
    | "passingScore"
    | "maxAttempts"
    | "shuffleQuestions"
    | "examDurationSeconds"
    | "examQuestionPools"
    | "examResultReleaseMode"
    | "examReviewReleaseMode"
    | "examContentAccessMode"
    | "sortOrder"
    | "status"
    | "visibility"
    | "availableAt"
  >
>;

type LessonPageCreate = {
  title: string;
  titleSyncedWithLesson?: boolean;
  slug: string;
  sortOrder?: number;
  status: "draft" | "published" | "archived";
  layoutWidth?: "narrow" | "standard" | "wide";
  backgroundTone?: "plain" | "soft" | "contrast";
  contentSpacing?: "compact" | "comfortable" | "spacious";
};

type LessonPageUpdate = Partial<
  Pick<
    typeof lessonPages.$inferInsert,
    | "title"
    | "titleSyncedWithLesson"
    | "slug"
    | "sortOrder"
    | "status"
    | "layoutWidth"
    | "backgroundTone"
    | "contentSpacing"
  >
>;

async function lockLessonState(
  transaction: LessonPageTitleSyncTransaction,
  input: { organizationId: string; lessonId: string },
) {
  await transaction.execute(sql`
    select pg_advisory_xact_lock(
      hashtextextended(${`lesson-page-title-sync:${input.lessonId}`}, 0)
    )
  `);
  const [row] = await transaction
    .select({ lesson: lessons })
    .from(lessons)
    .innerJoin(
      modules,
      and(
        eq(modules.id, lessons.moduleId),
        eq(modules.organizationId, input.organizationId),
      ),
    )
    .where(
      and(
        eq(lessons.id, input.lessonId),
        eq(lessons.organizationId, input.organizationId),
      ),
    )
    .limit(1)
    .for("update");
  if (!row) throw new ApiError(404, "not_found", "Lektion nicht gefunden.");
  const pages = await transaction
    .select()
    .from(lessonPages)
    .where(eq(lessonPages.lessonId, input.lessonId))
    .orderBy(asc(lessonPages.sortOrder), asc(lessonPages.id))
    .for("update");
  return { lesson: row.lesson, pages };
}

async function lessonIdForPage(
  transaction: LessonPageTitleSyncTransaction,
  input: { organizationId: string; pageId: string },
) {
  const [reference] = await transaction
    .select({ lessonId: lessonPages.lessonId })
    .from(lessonPages)
    .innerJoin(
      lessons,
      and(
        eq(lessons.id, lessonPages.lessonId),
        eq(lessons.organizationId, input.organizationId),
      ),
    )
    .innerJoin(
      modules,
      and(
        eq(modules.id, lessons.moduleId),
        eq(modules.organizationId, input.organizationId),
      ),
    )
    .where(eq(lessonPages.id, input.pageId))
    .limit(1);
  if (!reference) throw new ApiError(404, "not_found", "Seite nicht gefunden.");
  return reference.lessonId;
}

async function assertUniquePageSlug(
  transaction: LessonPageTitleSyncTransaction,
  lessonId: string,
  slug: string,
  currentPageId?: string,
) {
  const [duplicate] = await transaction
    .select({ id: lessonPages.id })
    .from(lessonPages)
    .where(
      and(
        eq(lessonPages.lessonId, lessonId),
        eq(lessonPages.slug, slug),
        ...(currentPageId ? [ne(lessonPages.id, currentPageId)] : []),
      ),
    )
    .limit(1);
  if (duplicate) {
    throw new ApiError(
      409,
      "conflict",
      "Eine Seite mit diesem Slug existiert bereits in der Lektion.",
    );
  }
}

async function assertUniqueLessonSlug(
  transaction: LessonPageTitleSyncTransaction,
  lesson: typeof lessons.$inferSelect,
  slug: string,
) {
  const [duplicate] = await transaction
    .select({ id: lessons.id })
    .from(lessons)
    .where(
      and(
        eq(lessons.moduleId, lesson.moduleId),
        eq(lessons.slug, slug),
        ne(lessons.id, lesson.id),
      ),
    )
    .limit(1);
  if (duplicate) {
    throw new ApiError(
      409,
      "conflict",
      "Eine Lektion mit diesem Slug existiert bereits im Modul.",
    );
  }
}

async function setOnlyLinkedPage(
  transaction: LessonPageTitleSyncTransaction,
  lessonId: string,
  linkedPageId: string | null,
  controlledPageId?: string,
) {
  const now = new Date();
  await transaction
    .update(lessonPages)
    .set({
      titleSyncedWithLesson: false,
      revision: sql`${lessonPages.revision} + 1`,
      updatedAt: now,
    })
    .where(
      and(
        eq(lessonPages.lessonId, lessonId),
        eq(lessonPages.titleSyncedWithLesson, true),
        ...(linkedPageId ? [ne(lessonPages.id, linkedPageId)] : []),
        ...(controlledPageId ? [ne(lessonPages.id, controlledPageId)] : []),
      ),
    );
  if (linkedPageId && linkedPageId !== controlledPageId) {
    await transaction
      .update(lessonPages)
      .set({
        titleSyncedWithLesson: true,
        revision: sql`${lessonPages.revision} + 1`,
        updatedAt: now,
      })
      .where(
        and(
          eq(lessonPages.id, linkedPageId),
          eq(lessonPages.lessonId, lessonId),
          eq(lessonPages.titleSyncedWithLesson, false),
        ),
      );
  }
}

function validExistingLinkedPage(
  pages: Array<typeof lessonPages.$inferSelect>,
  firstPageId: string | null,
  excludedPageId?: string,
) {
  return (
    pages.find(
      (page) =>
        page.id !== excludedPageId &&
        page.id === firstPageId &&
        page.titleSyncedWithLesson,
    )?.id ?? null
  );
}

export async function createLessonPageWithTitleSync(
  transaction: LessonPageTitleSyncTransaction,
  input: {
    organizationId: string;
    lessonId: string;
    page: LessonPageCreate;
  },
) {
  const state = await lockLessonState(transaction, input);
  await assertUniquePageSlug(
    transaction,
    input.lessonId,
    input.page.slug,
  );
  const sortOrder =
    input.page.sortOrder ??
    (state.pages.reduce(
      (highest, page) => Math.max(highest, page.sortOrder),
      -1,
    ) +
      1);
  const [created] = await transaction
    .insert(lessonPages)
    .values({
      lessonId: input.lessonId,
      title: input.page.title,
      titleSyncedWithLesson: false,
      slug: input.page.slug,
      sortOrder,
      status: input.page.status,
      layoutWidth: input.page.layoutWidth,
      backgroundTone: input.page.backgroundTone,
      contentSpacing: input.page.contentSpacing,
    })
    .returning();
  const finalPages = [...state.pages, created];
  const firstPageId = firstLessonPageId(finalPages);
  const requestedSync =
    input.page.titleSyncedWithLesson ?? state.pages.length === 0;
  if (requestedSync && created.id !== firstPageId) {
    throw new ApiError(
      422,
      "validation_error",
      "Nur die erste Seite einer Lektion kann mit dem Lektionstitel gekoppelt werden.",
    );
  }
  const linkedPageId = requestedSync
    ? created.id
    : validExistingLinkedPage(state.pages, firstPageId);
  await setOnlyLinkedPage(transaction, input.lessonId, linkedPageId);
  if (requestedSync) {
    await transaction
      .update(lessonPages)
      .set({
        title: state.lesson.title,
        titleSyncedWithLesson: true,
        updatedAt: new Date(),
      })
      .where(eq(lessonPages.id, created.id));
  }
  const [page] = await transaction
    .select()
    .from(lessonPages)
    .where(eq(lessonPages.id, created.id))
    .limit(1);
  return page;
}

export async function updateLessonPageWithTitleSync(
  transaction: LessonPageTitleSyncTransaction,
  input: {
    organizationId: string;
    pageId: string;
    page: LessonPageUpdate;
    expectedRevision?: number;
  },
) {
  const lessonId = await lessonIdForPage(transaction, input);
  await lockLessonModuleStructure(transaction, {
    organizationId: input.organizationId,
    lessonId,
  });
  const state = await lockLessonState(transaction, {
    organizationId: input.organizationId,
    lessonId,
  });
  const current = state.pages.find((page) => page.id === input.pageId);
  if (!current) throw new ApiError(404, "not_found", "Seite nicht gefunden.");
  if (
    input.expectedRevision !== undefined &&
    current.revision !== input.expectedRevision
  ) {
    throw new ApiError(
      409,
      "conflict",
      "Die Seite wurde zwischenzeitlich geaendert. Lesen Sie die aktuelle Revision und wiederholen Sie die Aenderung.",
      {
        resourceType: "page",
        resourceId: current.id,
        expectedRevision: input.expectedRevision,
        currentRevision: current.revision,
      },
    );
  }
  if (input.page.slug && input.page.slug !== current.slug) {
    await assertUniquePageSlug(
      transaction,
      current.lessonId,
      input.page.slug,
      current.id,
    );
  }
  const proposedPages = state.pages.map((page) =>
    page.id === current.id
      ? { ...page, sortOrder: input.page.sortOrder ?? page.sortOrder }
      : page,
  );
  const firstPageId = firstLessonPageId(proposedPages);
  const sync = resolvePageTitleSync({
    pageId: current.id,
    firstPageId,
    wasSynced: current.titleSyncedWithLesson,
    requestedSync: input.page.titleSyncedWithLesson,
  });
  if (sync.invalidExplicitSync) {
    throw new ApiError(
      422,
      "validation_error",
      "Nur die erste Seite einer Lektion kann mit dem Lektionstitel gekoppelt werden.",
    );
  }
  const pageTitle = synchronizedPageTitle({
    lessonTitle: state.lesson.title,
    currentPageTitle: current.title,
    requestedPageTitle: input.page.title,
    wasSynced: current.titleSyncedWithLesson,
    willBeSynced: sync.synced,
  });
  const retainedLinkedPageId = sync.synced
    ? current.id
    : validExistingLinkedPage(state.pages, firstPageId, current.id);
  await setOnlyLinkedPage(
    transaction,
    current.lessonId,
    retainedLinkedPageId,
    current.id,
  );
  const now = new Date();
  const [page] = await transaction
    .update(lessonPages)
    .set({
      ...(input.page.slug !== undefined ? { slug: input.page.slug } : {}),
      ...(input.page.sortOrder !== undefined
        ? { sortOrder: input.page.sortOrder }
        : {}),
      ...(input.page.status !== undefined ? { status: input.page.status } : {}),
      ...(input.page.layoutWidth !== undefined
        ? { layoutWidth: input.page.layoutWidth }
        : {}),
      ...(input.page.backgroundTone !== undefined
        ? { backgroundTone: input.page.backgroundTone }
        : {}),
      ...(input.page.contentSpacing !== undefined
        ? { contentSpacing: input.page.contentSpacing }
        : {}),
      title: pageTitle,
      titleSyncedWithLesson: sync.synced,
      revision: sql`${lessonPages.revision} + 1`,
      updatedAt: now,
    })
    .where(
      and(
        eq(lessonPages.id, current.id),
        eq(lessonPages.lessonId, current.lessonId),
        ...(input.expectedRevision !== undefined
          ? [eq(lessonPages.revision, input.expectedRevision)]
          : []),
      ),
    )
    .returning();
  if (!page) {
    throw new ApiError(
      409,
      "conflict",
      "Die Seite wurde zwischenzeitlich geaendert. Lesen Sie die aktuelle Revision und wiederholen Sie die Aenderung.",
      {
        resourceType: "page",
        resourceId: current.id,
        expectedRevision: input.expectedRevision,
        currentRevision: current.revision,
      },
    );
  }
  if (sync.synced && pageTitle !== state.lesson.title) {
    await transaction
      .update(lessons)
      .set({ title: pageTitle, updatedAt: now })
      .where(
        and(
          eq(lessons.id, state.lesson.id),
          eq(lessons.organizationId, input.organizationId),
        ),
      );
  }
  return page;
}

export async function updateLessonWithTitleSync(
  transaction: LessonPageTitleSyncTransaction,
  input: {
    organizationId: string;
    lessonId: string;
    lesson: LessonUpdate;
  },
) {
  await assertLessonStructureMutation(transaction, {
    organizationId: input.organizationId,
    lessonId: input.lessonId,
    mutation: "update",
    type: input.lesson.type,
  });
  const state = await lockLessonState(transaction, input);
  if (input.lesson.slug && input.lesson.slug !== state.lesson.slug) {
    await assertUniqueLessonSlug(transaction, state.lesson, input.lesson.slug);
  }
  const firstPageId = firstLessonPageId(state.pages);
  const linkedPageId = validExistingLinkedPage(state.pages, firstPageId);
  await setOnlyLinkedPage(transaction, input.lessonId, linkedPageId);
  const now = new Date();
  const [lesson] = await transaction
    .update(lessons)
    .set({ ...input.lesson, updatedAt: now })
    .where(
      and(
        eq(lessons.id, input.lessonId),
        eq(lessons.organizationId, input.organizationId),
      ),
    )
    .returning();
  if (linkedPageId && input.lesson.title !== undefined) {
    await transaction
      .update(lessonPages)
      .set({
        title: input.lesson.title,
        revision: sql`${lessonPages.revision} + 1`,
        updatedAt: now,
      })
      .where(
        and(
          eq(lessonPages.id, linkedPageId),
          eq(lessonPages.lessonId, input.lessonId),
          eq(lessonPages.titleSyncedWithLesson, true),
        ),
      );
  }
  return lesson;
}

export async function deleteLessonPageWithTitleSync(
  transaction: LessonPageTitleSyncTransaction,
  input: {
    organizationId: string;
    pageId: string;
    expectedRevision?: number;
  },
) {
  const lessonId = await lessonIdForPage(transaction, input);
  const learningModule = await lockLessonModuleStructure(transaction, {
    organizationId: input.organizationId,
    lessonId,
  });
  const state = await lockLessonState(transaction, {
    organizationId: input.organizationId,
    lessonId,
  });
  const current = state.pages.find((page) => page.id === input.pageId);
  if (!current) throw new ApiError(404, "not_found", "Seite nicht gefunden.");
  if (
    input.expectedRevision !== undefined &&
    current.revision !== input.expectedRevision
  ) {
    throw new ApiError(
      409,
      "conflict",
      "Die Seite wurde zwischenzeitlich geaendert. Lesen Sie die aktuelle Revision und wiederholen Sie das Loeschen.",
      {
        resourceType: "page",
        resourceId: current.id,
        expectedRevision: input.expectedRevision,
        currentRevision: current.revision,
      },
    );
  }
  assertExamModuleRetainsPage(learningModule.kind, state.pages.length - 1);
  const firstPageId = firstLessonPageId(state.pages);
  await setOnlyLinkedPage(
    transaction,
    lessonId,
    validExistingLinkedPage(state.pages, firstPageId),
  );
  await transaction
    .delete(lessonPages)
    .where(
      and(
        eq(lessonPages.id, input.pageId),
        eq(lessonPages.lessonId, lessonId),
        ...(input.expectedRevision !== undefined
          ? [eq(lessonPages.revision, input.expectedRevision)]
          : []),
      ),
    );
  return current;
}

export async function deleteLessonWithTitleSync(
  transaction: LessonPageTitleSyncTransaction,
  input: { organizationId: string; lessonId: string },
) {
  await assertLessonStructureMutation(transaction, {
    organizationId: input.organizationId,
    lessonId: input.lessonId,
    mutation: "delete",
  });
  const state = await lockLessonState(transaction, input);
  await transaction
    .delete(lessons)
    .where(
      and(
        eq(lessons.id, input.lessonId),
        eq(lessons.organizationId, input.organizationId),
      ),
    );
  return state.lesson;
}
