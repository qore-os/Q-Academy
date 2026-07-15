import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BookOpen } from "lucide-react";

import { EmptyState } from "../src/components/ui/empty-state";

function pageSource(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

test("empty state renders its message, inverse tone, and optional action", () => {
  const html = renderToStaticMarkup(
    createElement(EmptyState, {
      icon: BookOpen,
      title: "Noch kein Kurs zugewiesen",
      description: "Freigeschaltete Lernpfade erscheinen hier.",
      tone: "inverse",
      action: createElement("a", { href: "/academy/courses" }, "Meine Kurse"),
    }),
  );

  assert.match(html, /data-empty-state="true"/);
  assert.match(html, /Noch kein Kurs zugewiesen/);
  assert.match(html, /Freigeschaltete Lernpfade erscheinen hier\./);
  assert.match(html, /href="\/academy\/courses"/);
  assert.match(html, /text-white\/65/);
});

test("member dashboard covers every collection and the empty hero column", () => {
  const source = pageSource("src/app/(member)/academy/page.tsx");

  for (const titleBinding of [
    "copy.noCourse",
    "copy.emptyCourses",
    "copy.noPosts",
    "copy.noEvents",
  ]) {
    assert.match(source, new RegExp(`title=\\{${titleBinding}\\}`));
  }
  assert.match(source, /!data\.courses\.length/);
  assert.match(source, /!data\.recentPosts\.length/);
  assert.match(source, /!data\.upcomingEvents\.length/);
  assert.match(source, /tone="inverse"/);
});

test("admin dashboards and inventory pages expose explicit empty states", () => {
  const expectations = [
    ["src/app/(admin)/admin/page.tsx", [/title=\{dashboardCopy\.noSubmissions\}/, /title=\{dashboardCopy\.noCourseData\}/]],
    ["src/app/(admin)/admin/modules/page.tsx", [/title=\{copy\.emptyTitle\}/]],
    ["src/app/(admin)/admin/groups/page.tsx", [/title=\{copy\("group\.empty"\)\}/]],
    ["src/app/(admin)/admin/hubs/page.tsx", [/title=\{copy\("hub\.empty"\)\}/]],
    ["src/app/(admin)/admin/bundles/page.tsx", [/title=\{copy\("bundle\.empty"\)\}/]],
  ] as const;

  for (const [path, titlePatterns] of expectations) {
    const source = pageSource(path);
    assert.match(source, /<EmptyState/);
    for (const titlePattern of titlePatterns) {
      assert.match(source, titlePattern);
    }
  }
});

test("restricted admin empty-state actions keep their role guards", () => {
  const dashboard = pageSource("src/app/(admin)/admin/page.tsx");
  const groups = pageSource("src/app/(admin)/admin/groups/page.tsx");
  const hubs = pageSource("src/app/(admin)/admin/hubs/page.tsx");
  const bundles = pageSource("src/app/(admin)/admin/bundles/page.tsx");

  assert.match(dashboard, /canManageMembers \? \(/);
  assert.match(groups, /action=\{\s*canManageAccess \? \(/);
  assert.match(hubs, /action=\{\s*canManage \? \(/);
  assert.match(bundles, /action=\{\s*canManageAccess \? \(/);
});
