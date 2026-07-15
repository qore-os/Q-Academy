import assert from "node:assert/strict";
import test from "node:test";

import {
  aiAgentAccessGrantIdentity,
  aiAgentActionIdentity,
  aiAgentDraftDigest,
  aiAgentDraftUpdateSchema,
  aiAgentSourceIdentity,
  type AiAgentDraftUpdate,
} from "../src/lib/ai/agent-studio-model";

const ids = {
  draft: "11111111-1111-4111-8111-111111111111",
  course: "22222222-2222-4222-8222-222222222222",
  member: "33333333-3333-4333-8333-333333333333",
  group: "44444444-4444-4444-8444-444444444444",
  bundle: "55555555-5555-4555-8555-555555555555",
};

function validDraft(
  overrides: Partial<AiAgentDraftUpdate> = {},
): AiAgentDraftUpdate {
  return {
    expectedDraftVersionId: ids.draft,
    expectedDraftRevision: 1,
    agentType: "learning_coach",
    name: "Transfer-Coach",
    description: "Begleitet den Transfer in die Praxis.",
    systemPrompt: "Arbeite ausschliesslich mit freigegebenem Wissen.",
    color: "#2bb7a9",
    icon: "sparkles",
    knowledgeMode: "selected_sources",
    accessMode: "restricted",
    sources: [{ sourceType: "course_version", courseId: ids.course }],
    accessGrants: [{ subjectType: "user", subjectUserId: ids.member }],
    actions: [],
    profileFieldIds: [],
    additionalPrompts: [],
    ...overrides,
  };
}

test("agent studio accepts a bounded versioned draft contract", () => {
  const parsed = aiAgentDraftUpdateSchema.parse(validDraft());
  assert.equal(parsed.agentType, "learning_coach");
  assert.equal(parsed.sources.length, 1);
  assert.equal(parsed.accessGrants.length, 1);
});

test("restricted access and selected knowledge fail closed without targets", () => {
  const parsed = aiAgentDraftUpdateSchema.safeParse(
    validDraft({ sources: [], accessGrants: [] }),
  );
  assert.equal(parsed.success, false);
  if (parsed.success) return;
  assert.deepEqual(
    new Set(parsed.error.issues.map((issue) => issue.path[0])),
    new Set(["sources", "accessGrants"]),
  );
});

test("open access rejects hidden grants and draft inputs reject unknown fields", () => {
  const hiddenGrant = aiAgentDraftUpdateSchema.safeParse(
    validDraft({ accessMode: "open" }),
  );
  assert.equal(hiddenGrant.success, false);

  const unknown = aiAgentDraftUpdateSchema.safeParse({
    ...validDraft(),
    providerSecret: "must-not-be-accepted",
  });
  assert.equal(unknown.success, false);
});

test("source and grant identities detect semantic duplicates", () => {
  const duplicateSources = aiAgentDraftUpdateSchema.safeParse(
    validDraft({
      sources: [
        { sourceType: "course_version", courseId: ids.course },
        { sourceType: "course_version", courseId: ids.course },
      ],
    }),
  );
  assert.equal(duplicateSources.success, false);

  const duplicateGrants = aiAgentDraftUpdateSchema.safeParse(
    validDraft({
      accessGrants: [
        { subjectType: "role", subjectRole: "member" },
        { subjectType: "role", subjectRole: "member" },
      ],
    }),
  );
  assert.equal(duplicateGrants.success, false);

  assert.equal(
    aiAgentSourceIdentity({
      sourceType: "course_version",
      courseId: ids.course,
    }),
    `course:${ids.course}`,
  );
  assert.equal(
    aiAgentAccessGrantIdentity({
      subjectType: "user",
      subjectUserId: ids.member,
    }),
    `user:${ids.member}`,
  );
});

test("web sources are canonical HTTPS URLs with a bounded source count", () => {
  const parsed = aiAgentDraftUpdateSchema.parse(
    validDraft({
      sources: [
        {
          sourceType: "web_url",
          url: "https://Example.com:443/handbook#chapter",
        },
      ],
    }),
  );
  assert.deepEqual(parsed.sources, [
    { sourceType: "web_url", url: "https://example.com/handbook" },
  ]);
  assert.equal(
    aiAgentSourceIdentity(parsed.sources[0]!),
    "web:https://example.com/handbook",
  );

  for (const url of [
    "http://example.com/",
    "https://user:secret@example.com/",
    "https://example.com:9443/",
  ]) {
    assert.equal(
      aiAgentDraftUpdateSchema.safeParse(
        validDraft({ sources: [{ sourceType: "web_url", url }] }),
      ).success,
      false,
    );
  }
  assert.equal(
    aiAgentDraftUpdateSchema.safeParse(
      validDraft({
        sources: Array.from({ length: 11 }, (_, index) => ({
          sourceType: "web_url" as const,
          url: `https://example.com/source-${index}`,
        })),
      }),
    ).success,
    false,
  );
});

test("agent actions are typed, bounded and distinguish grant from revocation", () => {
  const enrollmentAction = {
    actionType: "course_enrollment" as const,
    courseId: ids.course,
    label: "Kurszugriff anfragen",
    description: "Sendet eine freigabepflichtige Anfrage.",
  };
  const unenrollmentAction = {
    actionType: "course_unenrollment" as const,
    courseId: ids.course,
    label: "Direkten Kurszugriff entfernen",
    description: "Entfernt direkte Freigaben erst nach einer Entscheidung.",
  };
  const groupAction = {
    actionType: "group_membership_add" as const,
    groupId: ids.group,
    label: "Projektgruppe beitreten",
    description: "Beantragt eine freigabepflichtige Gruppenzuweisung.",
  };
  const groupRemovalAction = {
    actionType: "group_membership_remove" as const,
    groupId: ids.group,
    label: "Projektgruppe verlassen",
    description: "Entfernt nur die ausgewiesene KI-Zuweisung.",
  };
  const bundleAction = {
    actionType: "bundle_assignment_add" as const,
    bundleId: ids.bundle,
    label: "Transfer-Bundle zuweisen",
    description: "Beantragt eine freigabepflichtige Bundle-Zuweisung.",
  };
  assert.equal(
    aiAgentActionIdentity(enrollmentAction),
    `course_enrollment:${ids.course}`,
  );
  assert.equal(
    aiAgentActionIdentity(unenrollmentAction),
    `course_unenrollment:${ids.course}`,
  );
  assert.equal(
    aiAgentActionIdentity(groupAction),
    `group_membership_add:${ids.group}`,
  );
  assert.equal(
    aiAgentActionIdentity(bundleAction),
    `bundle_assignment_add:${ids.bundle}`,
  );
  assert.equal(
    aiAgentDraftUpdateSchema.safeParse(
      validDraft({
        actions: [
          enrollmentAction,
          unenrollmentAction,
          groupAction,
          groupRemovalAction,
          bundleAction,
        ],
      }),
    ).success,
    true,
  );
  const parsed = aiAgentDraftUpdateSchema.safeParse(
    validDraft({ actions: [enrollmentAction, enrollmentAction] }),
  );
  assert.equal(parsed.success, false);
  if (parsed.success) return;
  assert.ok(parsed.error.issues.some((issue) => issue.path[0] === "actions"));
  assert.equal(
    aiAgentDraftUpdateSchema.safeParse(
      validDraft({
        actions: [
          {
            ...groupAction,
            courseId: ids.course,
          } as never,
        ],
      }),
    ).success,
    false,
  );
});

test("profile personalization and additional prompts are bounded and unique", () => {
  const parsed = aiAgentDraftUpdateSchema.parse(
    validDraft({
      profileFieldIds: [ids.member],
      additionalPrompts: [
        {
          label: "Ton",
          prompt: "Antworte mit kurzen, konkreten naechsten Schritten.",
        },
      ],
    }),
  );
  assert.deepEqual(parsed.profileFieldIds, [ids.member]);
  assert.equal(parsed.additionalPrompts[0]?.label, "Ton");

  assert.equal(
    aiAgentDraftUpdateSchema.safeParse(
      validDraft({ profileFieldIds: [ids.member, ids.member] }),
    ).success,
    false,
  );
  assert.equal(
    aiAgentDraftUpdateSchema.safeParse(
      validDraft({
        additionalPrompts: [
          { label: "Ton", prompt: "Formuliere die Antwort sehr knapp." },
          { label: "ton", prompt: "Formuliere die Antwort ausfuehrlich." },
        ],
      }),
    ).success,
    false,
  );
});

test("draft digest is stable across source and grant ordering", () => {
  const first = validDraft({
    sources: [
      { sourceType: "course_version", courseId: ids.course },
      {
        sourceType: "manual_text",
        title: "Leitlinie",
        content: "Nur freigegebene Aussagen verwenden.",
      },
    ],
    accessGrants: [
      { subjectType: "role", subjectRole: "member" },
      { subjectType: "user", subjectUserId: ids.member },
    ],
    profileFieldIds: [ids.member, ids.course],
  });
  const second = validDraft({
    sources: [...first.sources].reverse(),
    accessGrants: [...first.accessGrants].reverse(),
    profileFieldIds: [...first.profileFieldIds].reverse(),
  });
  assert.equal(aiAgentDraftDigest(first), aiAgentDraftDigest(second));
});
