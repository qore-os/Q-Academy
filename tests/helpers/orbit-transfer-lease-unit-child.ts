import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";

import {
  OrbitTransferClaimLostError,
  startOrbitTransferLeaseHeartbeat,
} from "../../src/lib/orbit/transfer-lease";

function heartbeatInput() {
  return {
    jobId: randomUUID(),
    claimToken: randomUUID(),
    targetOrganizationId: randomUUID(),
    targetMediaIds: [randomUUID()],
  };
}

test("Orbit heartbeat retries a transient renewal failure within the confirmed lease", async () => {
  const clock = { now: new Date("2026-08-12T12:00:00.000Z") };
  const initialLeaseExpiresAt = new Date(clock.now.getTime() + 60_000);
  const renewedLeaseExpiresAt = new Date(clock.now.getTime() + 15 * 60_000);
  let renewalCalls = 0;
  const heartbeat = startOrbitTransferLeaseHeartbeat({
    ...heartbeatInput(),
    initialLeaseExpiresAt,
    now: () => clock.now,
    retryDelayMs: 5,
    renewLease: async () => {
      renewalCalls += 1;
      if (renewalCalls === 1) throw new Error("temporary database outage");
      return renewedLeaseExpiresAt;
    },
  });

  try {
    assert.equal(await heartbeat.assertActive(), initialLeaseExpiresAt);
    assert.equal(heartbeat.signal.aborted, false);
    await delay(20);
    assert.equal(renewalCalls, 2);
    assert.equal(heartbeat.signal.aborted, false);
    assert.equal(await heartbeat.assertActive(), renewedLeaseExpiresAt);
  } finally {
    await heartbeat.stop();
  }
});
test("Orbit heartbeat aborts immediately when renewal proves the claim was lost", async () => {
  const now = new Date("2026-08-12T12:00:00.000Z");
  const heartbeat = startOrbitTransferLeaseHeartbeat({
    ...heartbeatInput(),
    initialLeaseExpiresAt: new Date(now.getTime() + 60_000),
    now: () => now,
    renewLease: async () => null,
  });

  try {
    await assert.rejects(
      heartbeat.assertActive(),
      OrbitTransferClaimLostError,
    );
    assert.equal(heartbeat.signal.aborted, true);
  } finally {
    await heartbeat.stop();
  }
});

test("Orbit heartbeat does not tolerate renewal errors beyond the last confirmed lease", async () => {
  const clock = { now: new Date("2026-08-12T12:00:00.000Z") };
  const initialLeaseExpiresAt = new Date(clock.now.getTime() + 5);
  let renewalCalls = 0;
  const heartbeat = startOrbitTransferLeaseHeartbeat({
    ...heartbeatInput(),
    initialLeaseExpiresAt,
    now: () => clock.now,
    retryDelayMs: 5,
    renewLease: async () => {
      renewalCalls += 1;
      throw new Error("database unavailable");
    },
  });

  try {
    assert.equal(await heartbeat.assertActive(), initialLeaseExpiresAt);
    clock.now = new Date(initialLeaseExpiresAt.getTime() + 1);
    await delay(15);
    assert.equal(heartbeat.signal.aborted, true);
    assert.ok(renewalCalls >= 1);
    await assert.rejects(
      heartbeat.assertActive(),
      OrbitTransferClaimLostError,
    );
  } finally {
    await heartbeat.stop();
  }
});

test("Orbit heartbeat watchdog aborts a hung renewal and stop remains bounded", async () => {
  const initialLeaseExpiresAt = new Date(Date.now() + 20);
  const keepEventLoopAlive = setTimeout(() => undefined, 100);
  const heartbeat = startOrbitTransferLeaseHeartbeat({
    ...heartbeatInput(),
    initialLeaseExpiresAt,
    retryDelayMs: 5,
    renewLease: () => new Promise<Date | null>(() => undefined),
  });

  try {
    await assert.rejects(
      heartbeat.assertActive(),
      OrbitTransferClaimLostError,
    );
    assert.equal(heartbeat.signal.aborted, true);
    const stopStartedAt = Date.now();
    await heartbeat.stop();
    assert.ok(Date.now() - stopStartedAt < 50);
  } finally {
    clearTimeout(keepEventLoopAlive);
    await heartbeat.stop();
  }
});
