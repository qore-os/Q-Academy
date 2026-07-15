import assert from "node:assert/strict";
import test from "node:test";

import {
  MediaMaintenanceBudget,
  MediaMaintenanceDeadlineError,
  runMediaMaintenanceWithinBudget,
} from "../src/lib/media/maintenance-budget";

test("an aborted delete settles before its maintenance lease is released", async () => {
  const startedAt = Date.now();
  let deleteSignal: AbortSignal | null = null;
  let deleteSettledAt: number | null = null;
  let releasedAt: number | null = null;

  await assert.rejects(
    runMediaMaintenanceWithinBudget({
      ioLimit: 1,
      timeoutMs: 60,
      minimumNewIoMs: 10,
      async work(budget) {
        assert.equal(budget.tryClaimIoAsset(), true);
        await budget.runAbortable(async (signal) => {
          deleteSignal = signal;
          await new Promise<void>((_resolve, reject) => {
            signal.addEventListener(
              "abort",
              () => {
                setTimeout(() => {
                  deleteSettledAt = Date.now();
                  reject(signal.reason);
                }, 40);
              },
              { once: true },
            );
          });
        });
      },
      async release() {
        releasedAt = Date.now();
      },
    }),
    MediaMaintenanceDeadlineError,
  );

  assert.equal((deleteSignal as AbortSignal | null)?.aborted, true);
  assert.ok(deleteSettledAt !== null);
  assert.ok(releasedAt !== null);
  assert.ok(releasedAt >= deleteSettledAt);
  assert.ok(releasedAt - startedAt >= 90);
});

test("a slow delete cannot continue maintenance after the shared deadline", async () => {
  let deleteStarts = 0;
  let deleteCompletions = 0;
  let postDeleteMutations = 0;
  let released = false;
  let deleteCompletedAt: number | null = null;
  let releasedAt: number | null = null;

  await assert.rejects(
    runMediaMaintenanceWithinBudget({
      ioLimit: 5,
      timeoutMs: 50,
      minimumNewIoMs: 10,
      async work(budget) {
        while (budget.tryClaimIoAsset()) {
          deleteStarts += 1;
          await budget.runAbortable(
            () =>
              new Promise<void>((resolve) => {
                setTimeout(() => {
                  deleteCompletions += 1;
                  deleteCompletedAt = Date.now();
                  resolve();
                }, 150);
              }),
          );
          postDeleteMutations += 1;
        }
      },
      async release() {
        released = true;
        releasedAt = Date.now();
      },
    }),
    MediaMaintenanceDeadlineError,
  );

  assert.equal(released, true);
  assert.equal(deleteStarts, 1);
  assert.equal(postDeleteMutations, 0);
  assert.equal(deleteCompletions, 1);
  assert.ok(deleteCompletedAt !== null);
  assert.ok(releasedAt !== null);
  assert.ok(releasedAt >= deleteCompletedAt);
  assert.equal(postDeleteMutations, 0);
});

test("purge and cleanup consume one shared I/O asset budget", async () => {
  const phases: string[] = [];
  let released = false;
  const processed = await runMediaMaintenanceWithinBudget({
    ioLimit: 3,
    timeoutMs: 1_000,
    minimumNewIoMs: 1,
    async work(budget) {
      for (let index = 0; index < 2; index += 1) {
        assert.equal(budget.tryClaimIoAsset(), true);
        phases.push("purge");
      }
      while (budget.tryClaimIoAsset()) phases.push("cleanup");
      return phases.length;
    },
    async release() {
      released = true;
    },
  });

  assert.equal(processed, 3);
  assert.deepEqual(phases, ["purge", "purge", "cleanup"]);
  assert.equal(released, true);
});

test("new assets and phases stop before their configured safety reserve", () => {
  let now = 1_000;
  const budget = new MediaMaintenanceBudget({
    ioLimit: 2,
    timeoutMs: 100,
    minimumNewIoMs: 30,
    now: () => now,
  });
  try {
    assert.equal(budget.tryClaimIoAsset(), true);
    now = 1_071;
    assert.equal(budget.canStartIoAsset(), false);
    assert.equal(budget.tryClaimIoAsset(), false);
    now = 1_091;
    assert.equal(budget.canStartPhase(10), false);
  } finally {
    budget.close();
  }
});
