import assert from "node:assert/strict";
import test from "node:test";

import {
  waitForAbortableDelay,
} from "../src/lib/media/browser-async-retry";

test("an asset-generation abort cancels its pending retry timer", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const controller = new AbortController();
  const reason = new DOMException("Asset changed", "AbortError");
  const pending = waitForAbortableDelay(10_000, controller.signal);

  controller.abort(reason);
  await assert.rejects(pending, (error: unknown) => error === reason);
  context.mock.timers.tick(10_000);
});
