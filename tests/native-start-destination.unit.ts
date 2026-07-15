import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  nativeStartPath,
  sanitizeNativeStartDestination,
} from "../src/lib/mobile/start-destination-model";

test("native start destination defaults closed and maps only known views", () => {
  assert.equal(sanitizeNativeStartDestination(undefined), "dashboard");
  assert.equal(sanitizeNativeStartDestination({ destination: "community" }), "community");
  assert.equal(sanitizeNativeStartDestination({ destination: "/admin" }), "dashboard");
  assert.equal(nativeStartPath("dashboard"), "/academy");
  assert.equal(nativeStartPath("community"), "/academy/community");
});

test("native cold start checks an explicit launch URL before tenant fallback", () => {
  const bridge = readFileSync(
    "src/components/mobile/native-runtime-bridge.tsx",
    "utf8",
  );
  const launchCheck = bridge.indexOf("await App.getLaunchUrl()");
  const fallback = bridge.indexOf("nativeStartPath(startDestination)");
  assert.ok(launchCheck > 0 && fallback > launchCheck);
  assert.match(bridge, /initialPathname === "\/academy"/);
  assert.match(bridge, /sessionStorage\.setItem/);
  assert.match(bridge, /safeNativeDeepLinkPath/);
});

test("native start updates are serialized, reauthorized and audited", () => {
  const action = readFileSync(
    "src/lib/mobile/start-destination-actions.ts",
    "utf8",
  );
  assert.match(action, /pg_advisory_xact_lock/);
  assert.match(action, /eq\(users\.organizationId, actor\.organizationId\)/);
  assert.match(action, /inArray\(users\.role, \["owner", "admin"\]\)/);
  assert.match(action, /platform\.native_start\.updated/);
});
