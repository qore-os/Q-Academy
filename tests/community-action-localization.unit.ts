import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  COMMUNITY_ACTION_CODES,
  getCommunityNotificationCopy,
  resolveCommunityActionMessage,
} from "../src/lib/i18n/community-actions";
import { SUPPORTED_LOCALES } from "../src/lib/i18n/model";

test("community action codes resolve in every supported locale", () => {
  assert.ok(COMMUNITY_ACTION_CODES.length >= 30);
  for (const locale of SUPPORTED_LOCALES) {
    for (const code of COMMUNITY_ACTION_CODES) {
      const message = resolveCommunityActionMessage(locale, { code });
      assert.ok(message.trim().length > 0, `${locale}.${code}`);
    }
    const notification = getCommunityNotificationCopy(locale);
    assert.ok(notification.reportHeldTitle.trim());
    assert.ok(notification.reportHeldBody.trim());
  }

  assert.equal(
    resolveCommunityActionMessage("en", {
      code: "contentSaved",
      params: { target: "answer", moderationState: "held" },
    }),
    "The change is being reviewed before publication.",
  );
  assert.equal(
    resolveCommunityActionMessage("it", {
      code: "reportSubmitted",
      params: { held: true },
    }),
    "Segnalazione inviata. Il contenuto è trattenuto fino alla revisione.",
  );
  assert.match(
    resolveCommunityActionMessage("es", {
      code: "contentForbidden",
      params: { target: "post", operation: "delete" },
    }),
    /eliminar.*publicaciones/u,
  );
  assert.match(
    resolveCommunityActionMessage("fr", {
      code: "contentChanged",
      params: { target: "answer" },
    }),
    /réponse.*modifi/u,
  );
  assert.equal(
    resolveCommunityActionMessage("en", {
      code: "contentCreated",
      params: { target: "post", moderationState: "published" },
    }),
    "Post published.",
  );
  assert.equal(
    resolveCommunityActionMessage("en", {
      code: "contentRateLimited",
      params: { target: "answer" },
    }),
    "Too many community replies. Please try again later.",
  );

  const authoredName = "Mina USER-AUTHORED-NAME";
  for (const locale of SUPPORTED_LOCALES) {
    const notification = getCommunityNotificationCopy(locale);
    assert.ok(notification.followedPostBody(authoredName, "Authored title"));
    assert.ok(notification.replyTitle(true));
    assert.ok(notification.replyBody(authoredName).includes(authoredName));
    assert.ok(notification.mentionBody(authoredName).includes(authoredName));
    assert.ok(notification.reportReviewedBody(false));
    assert.ok(notification.contentDecisionTitle(true));
    assert.ok(notification.contentDecisionBody(false));
    assert.ok(notification.appealDecisionBody(true));
  }
});

test("community action parameters accept only stable rendering controls", () => {
  const authoredSentinel = "USER-AUTHORED-CONTENT-SENTINEL";
  const message = resolveCommunityActionMessage("en", {
    code: "reportSubmitted",
    params: { held: false, authoredContent: authoredSentinel },
  });
  assert.doesNotMatch(message, new RegExp(authoredSentinel));
  assert.equal(
    resolveCommunityActionMessage("en", {}, "appealFailed"),
    "The appeal could not be submitted.",
  );
});

test("community server actions return stable codes without exposing API messages", () => {
  const memberActionSources = [
    "src/lib/community-actions.ts",
    "src/lib/community-report-actions.ts",
    "src/lib/community-moderation-appeal-actions.ts",
    "src/lib/community-engagement-actions.ts",
  ].map((file) => readFileSync(file, "utf8"));
  const combined = memberActionSources.join("\n");
  assert.match(combined, /code\?: CommunityActionCode/);
  assert.match(combined, /params\?: CommunityActionParams/);
  assert.ok((combined.match(/code: "(?:content|report|appeal|follow)/g) ?? []).length >= 20);
  assert.doesNotMatch(combined, /message:\s*error\.message/);
  assert.doesNotMatch(
    combined,
    /error instanceof ApiError\s*\?\s*error\.message/,
  );

  for (const file of [
    "src/lib/community-badge-actions.ts",
    "src/lib/community-governance-actions.ts",
    "src/lib/community-moderation-case-actions.ts",
  ]) {
    const source = readFileSync(file, "utf8");
    assert.match(source, /messageCode/);
    assert.doesNotMatch(source, /message:\s*error\.message/);
  }

  const sharedActions = readFileSync("src/lib/actions.ts", "utf8");
  const communityCreateActions = sharedActions.slice(
    sharedActions.indexOf("export async function createPostAction"),
    sharedActions.indexOf("export async function rsvpEventAction"),
  );
  assert.match(communityCreateActions, /communityCode: "contentCreated"/);
  assert.match(
    sharedActions,
    /error\.code === "rate_limit_exceeded"[\s\S]*\? "contentRateLimited"/,
  );
  assert.match(communityCreateActions, /communityParams:/);
  assert.doesNotMatch(communityCreateActions, /error\.message/);
});

test("community clients resolve action codes locally", () => {
  const feed = readFileSync(
    "src/components/academy/community-feed.tsx",
    "utf8",
  );
  const submissions = readFileSync(
    "src/components/academy/community-own-submissions.tsx",
    "utf8",
  );
  assert.ok((feed.match(/resolveCommunityActionMessage\(/g) ?? []).length >= 5);
  assert.match(submissions, /resolveCommunityActionMessage\(locale, state/);
  assert.doesNotMatch(feed, /state\.ok === false \? state\.message/);
  assert.doesNotMatch(submissions, />\s*\{state\.message\}\s*</);

  const reports = readFileSync(
    "src/lib/community-report-actions.ts",
    "utf8",
  );
  assert.match(reports, /resolveRecipientLocale\(tx/);
  assert.match(reports, /getCommunityNotificationCopy\(recipientLocale\)/);
  assert.doesNotMatch(reports, /title:\s*"Community-Inhalt/);

  for (const file of [
    "src/lib/community-mentions.ts",
    "src/lib/community-mutations.ts",
    "src/lib/community-moderation-admin.ts",
  ]) {
    const source = readFileSync(file, "utf8");
    assert.match(source, /getCommunityNotificationCopy/);
    assert.match(source, /resolveCommunityRecipientLocales/);
  }
});
