import assert from "node:assert/strict";
import test from "node:test";

import {
  communityModerationAppealAvailability,
  communityModerationReasonForAuthor,
} from "../src/lib/community-moderation-submissions-core";

test("author-facing moderation reasons do not expose reporters or internal rules", () => {
  assert.equal(
    communityModerationReasonForAuthor("report_threshold"),
    "Community-Pruefung erforderlich",
  );
  assert.equal(
    communityModerationReasonForAuthor("approval_required"),
    "Freigabe erforderlich",
  );
  assert.doesNotMatch(
    communityModerationReasonForAuthor("report_threshold"),
    /reporter|melder|anzahl|schwelle/iu,
  );
});

test("appeal availability includes the exact 30-day boundary and fails closed", () => {
  const resolvedAt = new Date("2026-06-01T12:00:00.000Z");
  const deadline = new Date("2026-07-01T12:00:00.000Z");
  assert.deepEqual(
    communityModerationAppealAvailability({
      caseStatus: "resolved",
      contentState: "rejected",
      contentAvailable: true,
      resolvedAt,
      hasOpenAppeal: false,
      now: deadline,
    }),
    {
      deadline: deadline.toISOString(),
      canAppeal: true,
    },
  );
  assert.equal(
    communityModerationAppealAvailability({
      caseStatus: "resolved",
      contentState: "rejected",
      contentAvailable: true,
      resolvedAt,
      hasOpenAppeal: false,
      now: new Date(deadline.getTime() + 1),
    }).canAppeal,
    false,
  );
  assert.equal(
    communityModerationAppealAvailability({
      caseStatus: "resolved",
      contentState: "held",
      contentAvailable: true,
      resolvedAt,
      hasOpenAppeal: true,
      now: deadline,
    }).canAppeal,
    false,
  );
  assert.deepEqual(
    communityModerationAppealAvailability({
      caseStatus: "resolved",
      contentState: "published",
      contentAvailable: true,
      resolvedAt,
      hasOpenAppeal: false,
      now: deadline,
    }),
    { deadline: null, canAppeal: false },
  );
});
