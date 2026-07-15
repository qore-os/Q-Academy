import "server-only";

import { and, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  assessmentAttempts,
  emailDeliveries,
  nativePushDeliveries,
  pushNotificationDeliveries,
  webhookDeliveries,
} from "@/db/schema";
import { buildQueueHealthMetrics } from "@/lib/queue-health-metrics";

export async function readJobQueueMetrics(now = new Date()) {
  const emailQueued = inArray(emailDeliveries.status, [
    "pending",
    "processing",
    "retrying",
  ]);
  const webhookQueued = inArray(webhookDeliveries.status, [
    "pending",
    "processing",
    "retrying",
  ]);
  const emailObserved = inArray(emailDeliveries.status, [
    "pending",
    "processing",
    "retrying",
    "failed",
  ]);
  const webhookObserved = inArray(webhookDeliveries.status, [
    "pending",
    "processing",
    "retrying",
    "failed",
  ]);
  const pushQueued = inArray(pushNotificationDeliveries.status, [
    "pending",
    "processing",
    "retrying",
  ]);
  const pushObserved = inArray(pushNotificationDeliveries.status, [
    "pending",
    "processing",
    "retrying",
    "failed",
  ]);
  const nativePushQueued = inArray(nativePushDeliveries.status, [
    "pending",
    "processing",
    "retrying",
  ]);
  const nativePushObserved = inArray(nativePushDeliveries.status, [
    "pending",
    "processing",
    "retrying",
    "failed",
  ]);
  const examDue = or(
    and(
      inArray(assessmentAttempts.status, ["in_progress", "submitted"]),
      lte(assessmentAttempts.deadlineAt, now),
    ),
    and(
      eq(assessmentAttempts.status, "graded"),
      eq(assessmentAttempts.resultReleaseMode, "after_deadline"),
      isNull(assessmentAttempts.resultReleasedAt),
      lte(assessmentAttempts.deadlineAt, now),
    ),
  );

  const [emailRows, webhookRows, pushRows, nativePushRows, examRows] = await Promise.all([
    db
      .select({
        depth: sql<number>`count(*) filter (where ${emailQueued})::int`,
        failed: sql<number>`count(*) filter (where ${eq(emailDeliveries.status, "failed")})::int`,
        oldestAt: sql<unknown>`min(${emailDeliveries.createdAt}) filter (where ${emailQueued})`,
      })
      .from(emailDeliveries)
      .where(emailObserved),
    db
      .select({
        depth: sql<number>`count(*) filter (where ${webhookQueued})::int`,
        failed: sql<number>`count(*) filter (where ${eq(webhookDeliveries.status, "failed")})::int`,
        oldestAt: sql<unknown>`min(${webhookDeliveries.createdAt}) filter (where ${webhookQueued})`,
      })
      .from(webhookDeliveries)
      .where(webhookObserved),
    db
      .select({
        depth: sql<number>`count(*) filter (where ${pushQueued})::int`,
        failed: sql<number>`count(*) filter (where ${eq(pushNotificationDeliveries.status, "failed")})::int`,
        oldestAt: sql<unknown>`min(${pushNotificationDeliveries.createdAt}) filter (where ${pushQueued})`,
      })
      .from(pushNotificationDeliveries)
      .where(pushObserved),
    db
      .select({
        depth: sql<number>`count(*) filter (where ${nativePushQueued})::int`,
        failed: sql<number>`count(*) filter (where ${eq(nativePushDeliveries.status, "failed")})::int`,
        oldestAt: sql<unknown>`min(${nativePushDeliveries.createdAt}) filter (where ${nativePushQueued})`,
      })
      .from(nativePushDeliveries)
      .where(nativePushObserved),
    db
      .select({
        depth: sql<number>`count(*) filter (where ${examDue})::int`,
        oldestAt: sql<unknown>`min(${assessmentAttempts.deadlineAt}) filter (where ${examDue})`,
      })
      .from(assessmentAttempts)
      .where(examDue),
  ]);
  const nowMilliseconds = now.getTime();
  const email = emailRows[0];
  const webhook = webhookRows[0];
  const push = pushRows[0];
  const nativePush = nativePushRows[0];
  const exams = examRows[0];

  return {
    email: buildQueueHealthMetrics({
      depth: Number(email?.depth ?? 0),
      failed: Number(email?.failed ?? 0),
      oldestAt: email?.oldestAt ?? null,
      nowMilliseconds,
    }),
    webhooks: buildQueueHealthMetrics({
      depth: Number(webhook?.depth ?? 0),
      failed: Number(webhook?.failed ?? 0),
      oldestAt: webhook?.oldestAt ?? null,
      nowMilliseconds,
    }),
    push: buildQueueHealthMetrics({
      depth: Number(push?.depth ?? 0),
      failed: Number(push?.failed ?? 0),
      oldestAt: push?.oldestAt ?? null,
      nowMilliseconds,
    }),
    nativePush: buildQueueHealthMetrics({
      depth: Number(nativePush?.depth ?? 0),
      failed: Number(nativePush?.failed ?? 0),
      oldestAt: nativePush?.oldestAt ?? null,
      nowMilliseconds,
    }),
    examDeadlines: buildQueueHealthMetrics({
      depth: Number(exams?.depth ?? 0),
      failed: 0,
      oldestAt: exams?.oldestAt ?? null,
      nowMilliseconds,
    }),
  };
}
