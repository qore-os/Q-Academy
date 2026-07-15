import assert from "node:assert/strict";
import test from "node:test";

import {
  communityLevelConfigurationUpdateSchema,
  communityModerationAppealCreateSchema,
  communityModerationAppealDecisionSchema,
  communityModerationCaseClaimSchema,
  communityModerationCaseDecisionSchema,
  communityModerationPolicyUpdateSchema,
  communityModerationQueueQuerySchema,
} from "../src/lib/api/schemas";

const validPolicy = {
  expectedVersion: 1,
  postApproval: "members" as const,
  commentApproval: "off" as const,
  automationMode: "observe" as const,
  reportThreshold: 3,
  duplicateWindowMinutes: 60,
  linkLimit: 4,
};

const validLevels = {
  expectedRevision: 1,
  enabled: true,
  levels: [
    {
      position: 1,
      name: "Starter",
      description: "Erster Community-Rang",
      minPoints: 0,
      icon: "award",
      color: "#2bb7a9",
      active: true,
    },
    {
      position: 2,
      name: "Mitgestalter",
      description: "Regelmaessige Community-Beitraege",
      minPoints: 20,
      icon: "sparkles",
      color: "#d6a536",
      active: true,
    },
  ],
};

test("community moderation policy contract enforces bounded tenant controls", () => {
  assert.deepEqual(
    communityModerationPolicyUpdateSchema.parse(validPolicy),
    validPolicy,
  );
  assert.equal(
    communityModerationPolicyUpdateSchema.safeParse({
      ...validPolicy,
      reportThreshold: 1,
    }).success,
    false,
  );
  assert.equal(
    communityModerationPolicyUpdateSchema.safeParse({
      ...validPolicy,
      duplicateWindowMinutes: 1441,
    }).success,
    false,
  );
  assert.equal(
    communityModerationPolicyUpdateSchema.safeParse({
      ...validPolicy,
      unknownControl: true,
    }).success,
    false,
  );
});

test("moderation queue, decisions and appeals require bounded optimistic versions", () => {
  assert.deepEqual(
    communityModerationQueueQuerySchema.parse({ limit: "50" }),
    { limit: 50 },
  );
  assert.equal(
    communityModerationCaseDecisionSchema.safeParse({
      action: "reject",
      expectedDecisionVersion: 2,
      expectedContentVersion: 4,
      note: "Nach manueller Pruefung abgelehnt.",
    }).success,
    true,
  );
  assert.equal(
    communityModerationCaseDecisionSchema.safeParse({
      action: "delete",
      expectedDecisionVersion: 2,
      expectedContentVersion: 4,
      note: "Unzulaessige Aktion",
    }).success,
    false,
  );
  assert.equal(
    communityModerationCaseClaimSchema.safeParse({
      expectedDecisionVersion: 2,
      expectedContentVersion: 4,
    }).success,
    true,
  );
  assert.equal(
    communityModerationCaseClaimSchema.safeParse({
      expectedDecisionVersion: 2,
    }).success,
    false,
  );
  assert.equal(
    communityModerationAppealDecisionSchema.safeParse({
      action: "overturn",
      expectedDecisionVersion: 3,
      expectedContentVersion: 4,
      note: "Die Entscheidung wird nach erneuter Pruefung aufgehoben.",
    }).success,
    true,
  );
  assert.equal(
    communityModerationAppealDecisionSchema.safeParse({
      action: "appeal_overturned",
      expectedDecisionVersion: 3,
      expectedContentVersion: 4,
      note: "Interner Aktionsname ist kein API-Vertrag.",
    }).success,
    false,
  );
  assert.equal(
    communityModerationAppealCreateSchema.safeParse({
      expectedDecisionVersion: 0,
      statement: "Bitte erneut pruefen.",
    }).success,
    false,
  );
});

test("level configuration requires unique positions, thresholds and a zero baseline", () => {
  assert.deepEqual(
    communityLevelConfigurationUpdateSchema.parse(validLevels),
    validLevels,
  );
  assert.equal(
    communityLevelConfigurationUpdateSchema.safeParse({
      ...validLevels,
      levels: validLevels.levels.map((level) => ({
        ...level,
        minPoints: level.minPoints + 10,
      })),
    }).success,
    false,
  );
  const duplicateId = "10000000-0000-4000-8000-000000000001";
  assert.equal(
    communityLevelConfigurationUpdateSchema.safeParse({
      ...validLevels,
      levels: validLevels.levels.map((level) => ({
        ...level,
        id: duplicateId,
      })),
    }).success,
    false,
  );
  assert.equal(
    communityLevelConfigurationUpdateSchema.safeParse({
      ...validLevels,
      levels: [
        validLevels.levels[0],
        { ...validLevels.levels[1], position: 1 },
      ],
    }).success,
    false,
  );
  assert.equal(
    communityLevelConfigurationUpdateSchema.safeParse({
      expectedRevision: 1,
      enabled: false,
      levels: [],
    }).success,
    true,
  );
});
