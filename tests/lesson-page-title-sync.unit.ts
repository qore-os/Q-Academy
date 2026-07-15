import assert from "node:assert/strict";
import test from "node:test";

import {
  firstLessonPageId,
  resolvePageTitleSync,
  synchronizedPageTitle,
} from "@/lib/lesson-page-title-sync-policy";

test("first page is deterministic by sort order and id", () => {
  assert.equal(
    firstLessonPageId([
      { id: "b", sortOrder: 0 },
      { id: "a", sortOrder: 0 },
      { id: "c", sortOrder: 1 },
    ]),
    "a",
  );
});

test("only the first page can be explicitly linked", () => {
  assert.deepEqual(
    resolvePageTitleSync({
      pageId: "first",
      firstPageId: "first",
      wasSynced: false,
      requestedSync: true,
    }),
    { synced: true, invalidExplicitSync: false },
  );
  assert.deepEqual(
    resolvePageTitleSync({
      pageId: "second",
      firstPageId: "first",
      wasSynced: false,
      requestedSync: true,
    }),
    { synced: false, invalidExplicitSync: true },
  );
});

test("moving the linked page away from first place disables the link", () => {
  assert.deepEqual(
    resolvePageTitleSync({
      pageId: "previous-first",
      firstPageId: "new-first",
      wasSynced: true,
      requestedSync: undefined,
    }),
    { synced: false, invalidExplicitSync: false },
  );
});

test("restoring a link uses the lesson title without renaming existing content", () => {
  assert.equal(
    synchronizedPageTitle({
      lessonTitle: "Lektionstitel",
      currentPageTitle: "Eigener Seitentitel",
      requestedPageTitle: "Eigener Seitentitel",
      wasSynced: false,
      willBeSynced: true,
    }),
    "Lektionstitel",
  );
});

test("editing an already linked page is bidirectional", () => {
  assert.equal(
    synchronizedPageTitle({
      lessonTitle: "Alter Titel",
      currentPageTitle: "Alter Titel",
      requestedPageTitle: "Gemeinsamer Titel",
      wasSynced: true,
      willBeSynced: true,
    }),
    "Gemeinsamer Titel",
  );
});

test("an unlinked page keeps an independent title", () => {
  assert.equal(
    synchronizedPageTitle({
      lessonTitle: "Lektion",
      currentPageTitle: "Seite",
      requestedPageTitle: "Eigene Seite",
      wasSynced: false,
      willBeSynced: false,
    }),
    "Eigene Seite",
  );
});
