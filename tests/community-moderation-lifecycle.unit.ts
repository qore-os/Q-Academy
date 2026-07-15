import assert from "node:assert/strict";
import test from "node:test";

import {
  communityApprovalRequired,
  communityEditModerationDecision,
} from "../src/lib/community-moderation-lifecycle-core";

function decide(
  overrides: Partial<
    Parameters<typeof communityEditModerationDecision>[0]
  > = {},
) {
  return communityEditModerationDecision({
    previousState: "published",
    actorRole: "member",
    authorEdit: true,
    approvalMode: "off",
    automationMode: "off",
    analysisReasonCodes: [],
    activeCaseReason: null,
    ...overrides,
  });
}

test("approval modes distinguish members, non-admins and administrators", () => {
  assert.equal(
    communityApprovalRequired({ mode: "members", role: "member" }),
    true,
  );
  assert.equal(
    communityApprovalRequired({ mode: "members", role: "trainer" }),
    false,
  );
  assert.equal(
    communityApprovalRequired({ mode: "non_admins", role: "trainer" }),
    true,
  );
  assert.equal(
    communityApprovalRequired({ mode: "non_admins", role: "owner" }),
    false,
  );
});

test("edit analysis observes or enforces signals according to policy", () => {
  assert.deepEqual(
    decide({
      automationMode: "off",
      analysisReasonCodes: ["link_limit"],
    }),
    {
      approvalRequired: false,
      automatedReasons: [],
      reason: null,
      state: "published",
      protectedReportOrManualCase: false,
      protectedManualHold: false,
    },
  );
  assert.deepEqual(
    decide({
      automationMode: "observe",
      analysisReasonCodes: ["duplicate"],
    }),
    {
      approvalRequired: false,
      automatedReasons: ["duplicate"],
      reason: "duplicate",
      state: "published",
      protectedReportOrManualCase: false,
      protectedManualHold: false,
    },
  );
  assert.equal(
    decide({
      automationMode: "enforce",
      analysisReasonCodes: ["link_limit"],
    }).state,
    "held",
  );
  assert.deepEqual(decide({ approvalMode: "members" }), {
    approvalRequired: true,
    automatedReasons: [],
    reason: "approval_required",
    state: "pending",
    protectedReportOrManualCase: false,
    protectedManualHold: false,
  });
});

test("rejected and report-held author edits remain reviewable", () => {
  const rejected = decide({ previousState: "rejected" });
  assert.equal(rejected.state, "pending");
  assert.equal(rejected.reason, "manual");

  const rejectedWithApproval = decide({
    previousState: "rejected",
    approvalMode: "members",
  });
  assert.equal(rejectedWithApproval.state, "pending");
  assert.equal(rejectedWithApproval.reason, "approval_required");

  const reportedHold = decide({
    previousState: "held",
    activeCaseReason: "report_threshold",
  });
  assert.equal(reportedHold.state, "held");
  assert.equal(reportedHold.reason, "report_threshold");
  assert.equal(reportedHold.protectedReportOrManualCase, true);

  const orphanedManualHold = decide({ previousState: "held" });
  assert.equal(orphanedManualHold.state, "held");
  assert.equal(orphanedManualHold.reason, "manual");
  assert.equal(orphanedManualHold.protectedManualHold, true);

  const administratorCorrection = decide({
    previousState: "held",
    actorRole: "admin",
    authorEdit: false,
    activeCaseReason: "report_threshold",
  });
  assert.equal(administratorCorrection.state, "published");
  assert.equal(administratorCorrection.reason, null);
});
