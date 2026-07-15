import assert from "node:assert/strict";
import test from "node:test";

import { safeNativeDeepLinkPath } from "../src/lib/mobile/deep-links";

test("native deep links accept only the active origin or explicit app schemes", () => {
  const origin = "https://academy.example.test";
  assert.equal(
    safeNativeDeepLinkPath(
      "https://academy.example.test/academy/courses?view=grid#active",
      origin,
    ),
    "/academy/courses?view=grid#active",
  );
  assert.equal(
    safeNativeDeepLinkPath("qacademy://academy/events?event=42", origin),
    "/academy/events?event=42",
  );
  assert.equal(
    safeNativeDeepLinkPath("com.qacademy.mobile://login", origin),
    "/login",
  );
  assert.equal(
    safeNativeDeepLinkPath("https://attacker.test/academy/courses", origin),
    null,
  );
  assert.equal(
    safeNativeDeepLinkPath("https://academy.example.test/admin/events", origin),
    null,
  );
  assert.equal(
    safeNativeDeepLinkPath(
      "customer-academy://academy/events/42",
      origin,
      ["customer-academy"],
    ),
    "/academy/events/42",
  );
  assert.equal(
    safeNativeDeepLinkPath("qacademy://academy-evil/events", origin),
    null,
  );
  assert.equal(safeNativeDeepLinkPath("qacademy://admin/settings", origin), null);
  assert.equal(safeNativeDeepLinkPath("javascript:alert(1)", origin), null);
});
