import assert from "node:assert/strict";
import test from "node:test";

import {
  createHubTemplateLayout,
  HUB_TEMPLATE_KEYS,
} from "../src/lib/hub-templates";
import {
  resolveHubLayoutVariables,
  resolveHubText,
} from "../src/lib/hub-variables";

test("hub templates create bounded layouts with stable local destinations", () => {
  for (const template of HUB_TEMPLATE_KEYS) {
    let sequence = 0;
    const layout = createHubTemplateLayout(
      template,
      () => `row-${(sequence += 1)}`,
    );
    assert.ok(layout.length <= 2);
    assert.deepEqual(
      layout.map((row) => row.id),
      layout.map((_, index) => `row-${index + 1}`),
    );
    for (const widget of layout.flatMap((row) => row.columns)) {
      assert.ok(widget.title.length > 0 && widget.title.length <= 180);
      if (widget.href) {
        assert.match(widget.href, /^\/(?!\/)/);
      }
    }
  }
});

test("hub variables resolve only the documented member and course fields", () => {
  const context = {
    member: { firstName: "Lea", lastName: "Klein" },
    course: { title: "AI Grundlagen", progress: 64 },
    properties: { "profile.job.location": "Berlin <Mitte>" },
  } as const;
  assert.equal(
    resolveHubText(
      "Hallo {{ member.fullName }}, {{course.title}} steht bei {{course.progress}}%.",
      context,
    ),
    "Hallo Lea Klein, AI Grundlagen steht bei 64%.",
  );
  assert.equal(
    resolveHubText("Standort: {{profile.job.location}}", context),
    "Standort: Berlin <Mitte>",
  );
  assert.equal(
    resolveHubText("{{unknown.secret}}", context),
    "{{unknown.secret}}",
  );
});

test("hub layout interpolation preserves references and source layout", () => {
  const source = createHubTemplateLayout("learning_center", () => "row-1");
  const resolved = resolveHubLayoutVariables(source, {
    member: { firstName: "Lea", lastName: "Klein" },
    course: { title: "AI Grundlagen", progress: 64 },
  });
  assert.notStrictEqual(resolved, source);
  assert.match(resolved[0]!.columns[0]!.title, /64/);
  assert.equal(source[0]!.columns[0]!.title, "{{course.progress}}% abgeschlossen");
  assert.equal(resolved[0]!.columns[1]!.href, "/academy/courses");
});
