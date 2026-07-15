import assert from "node:assert/strict";
import test from "node:test";
import {
  changedMemberWelcomeFields,
  DEFAULT_MEMBER_WELCOME_SETTINGS,
  isMemberWelcomePending,
  memberWelcomeSettingsInputSchema,
  memberWelcomeSettingsUpdateSchema,
} from "../src/lib/member-welcome-model";

test("welcome settings accept only credential-free HTTPS video URLs", () => {
  const valid = memberWelcomeSettingsInputSchema.parse({
    ...DEFAULT_MEMBER_WELCOME_SETTINGS,
    videoUrl: "https://media.example.test/start.mp4?lang=de",
  });
  assert.equal(
    valid.videoUrl,
    "https://media.example.test/start.mp4?lang=de",
  );

  for (const videoUrl of [
    "http://media.example.test/start.mp4",
    "https://user:secret@media.example.test/start.mp4",
    "javascript:alert(1)",
  ]) {
    assert.equal(
      memberWelcomeSettingsInputSchema.safeParse({
        ...DEFAULT_MEMBER_WELCOME_SETTINGS,
        videoUrl,
      }).success,
      false,
    );
  }
});

test("welcome PATCH schema does not inject defaults", () => {
  assert.deepEqual(memberWelcomeSettingsUpdateSchema.parse({}), {});
  assert.deepEqual(
    memberWelcomeSettingsUpdateSchema.parse({ title: "  Neuer Start  " }),
    { title: "Neuer Start" },
  );
});

test("material welcome changes are detected without false version bumps", () => {
  const current = { ...DEFAULT_MEMBER_WELCOME_SETTINGS };
  assert.deepEqual(changedMemberWelcomeFields(current, { ...current }), []);
  assert.deepEqual(
    changedMemberWelcomeFields(current, {
      ...current,
      enabled: true,
      promptProfileImage: true,
    }),
    ["enabled", "promptProfileImage"],
  );
});

test("welcome is pending only for active members behind the current version", () => {
  const baseline = {
    enabled: true,
    memberRole: "member" as const,
    memberStatus: "active" as const,
    configurationVersion: 3,
    acknowledgedVersion: 2,
  };
  assert.equal(isMemberWelcomePending(baseline), true);
  assert.equal(
    isMemberWelcomePending({ ...baseline, acknowledgedVersion: 3 }),
    false,
  );
  assert.equal(
    isMemberWelcomePending({ ...baseline, memberRole: "trainer" }),
    false,
  );
  assert.equal(
    isMemberWelcomePending({ ...baseline, memberStatus: "invited" }),
    false,
  );
  assert.equal(isMemberWelcomePending({ ...baseline, enabled: false }), false);
});
