import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after } from "node:test";

import { postgresClient } from "@/db";
import {
  acquireProviderCircuitPermission,
  recordProviderCircuitFailure,
  recordProviderCircuitSuccess,
} from "@/lib/provider-circuit-breaker";

after(async () => {
  await postgresClient.end();
});

test("provider circuit opens, leases one half-open probe, and closes on success", async () => {
  const providerKey = `integration-${randomUUID()}`;
  const startedAt = new Date("2026-07-13T10:00:00.000Z");
  try {
    for (let offset = 0; offset < 3; offset += 1) {
      const state = await recordProviderCircuitFailure({
        providerKey,
        now: new Date(startedAt.getTime() + offset * 1_000),
      });
      assert.equal(state.failures, offset + 1);
      assert.equal(state.open, offset === 2);
    }

    const blocked = await acquireProviderCircuitPermission({
      providerKey,
      now: new Date(startedAt.getTime() + 3_000),
    });
    assert.equal(blocked.allowed, false);

    const halfOpenAt = new Date(startedAt.getTime() + 63_000);
    const probe = await acquireProviderCircuitPermission({
      providerKey,
      now: halfOpenAt,
    });
    assert.equal(probe.allowed, true);
    assert.equal(probe.probe, true);
    const concurrent = await acquireProviderCircuitPermission({
      providerKey,
      now: halfOpenAt,
    });
    assert.equal(concurrent.allowed, false);

    await recordProviderCircuitSuccess(providerKey);
    const closed = await acquireProviderCircuitPermission({
      providerKey,
      now: halfOpenAt,
    });
    assert.equal(closed.allowed, true);
    assert.equal(closed.probe, false);
  } finally {
    await recordProviderCircuitSuccess(providerKey);
  }
});
