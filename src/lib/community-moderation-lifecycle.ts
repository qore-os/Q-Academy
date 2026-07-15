import "server-only";

import {
  communityApprovalRequired,
  communityEditModerationDecision,
  createCommunityModerationLifecycle,
  DEFAULT_COMMUNITY_MODERATION_POLICY,
} from "@/lib/community-moderation-lifecycle-core";
import { getAuthRateLimitSecret } from "@/lib/server-environment";

/**
 * Transactional community-moderation API.
 *
 * Create paths pass their Drizzle transaction and an insert callback to
 * `createCommunityContentWithModeration`. The callback must persist every
 * supplied moderation field. Points, mentions, notifications and webhooks
 * belong in `onFirstPublish`; that hook runs inside the same transaction only
 * on the first transition to `published`.
 *
 * Edit paths call `updateCommunityContentWithModeration` and persist both the
 * returned body plus every moderation field in one callback. The result exposes
 * `previousState` and `state`, so visible/hidden edit side effects can run in
 * the caller's still-open transaction. Pass title plus body as `analysisContent`
 * while keeping the actual body in `content`.
 *
 * Report paths insert the report and then call
 * `attachCommunityReportToModerationCase` in the same transaction. Manual
 * decisions require both optimistic versions and never delete content.
 *
 * Appeal paths call `createCommunityModerationAppeal` or
 * `resolveCommunityModerationAppeal` inside their Drizzle transaction. Appeal
 * resolution uses the same optimistic content and decision versions as manual
 * decisions and applies first-publish effects transactionally on overturn.
 */
const lifecycle = createCommunityModerationLifecycle({
  getSecret: getAuthRateLimitSecret,
});

export const loadCommunityModerationPolicy =
  lifecycle.loadCommunityModerationPolicy;
export const createCommunityContentWithModeration =
  lifecycle.createCommunityContentWithModeration;
export const updateCommunityContentWithModeration =
  lifecycle.updateCommunityContentWithModeration;
export const decideCommunityModerationCase =
  lifecycle.decideCommunityModerationCase;
export const createCommunityModerationAppeal =
  lifecycle.createCommunityModerationAppeal;
export const resolveCommunityModerationAppeal =
  lifecycle.resolveCommunityModerationAppeal;
export const attachCommunityReportToModerationCase =
  lifecycle.attachCommunityReportToModerationCase;

export {
  communityApprovalRequired,
  communityEditModerationDecision,
  DEFAULT_COMMUNITY_MODERATION_POLICY,
};

export type {
  CommunityFirstPublishEffect,
  CommunityFirstPublishHook,
  CommunityModeratedCreateResult,
  CommunityModeratedUpdateResult,
  CommunityModerationDecision,
  CommunityModerationDecisionResult,
  CommunityModerationAppealCreateResult,
  CommunityModerationAppealResolutionResult,
  CommunityModerationInsertFields,
  CommunityModerationPolicy,
  CommunityModerationRole,
  CommunityModerationState,
  CommunityModerationTargetType,
  CommunityModerationTransaction,
  CommunityReportThresholdResult,
} from "@/lib/community-moderation-lifecycle-core";
