import assert from "node:assert/strict";
import test from "node:test";
import { explicitlyAcceptsJson } from "../src/lib/http-accept";

test("explicit JSON Accept negotiation is case-insensitive and honors quality", () => {
  assert.equal(explicitlyAcceptsJson("application/json"), true);
  assert.equal(explicitlyAcceptsJson("Application/JSON; Q=0.5"), true);
  assert.equal(
    explicitlyAcceptsJson("text/html, APPLICATION/JSON; charset=utf-8; q=0.001"),
    true,
  );
  assert.equal(explicitlyAcceptsJson("application/json;q=0"), false);
  assert.equal(explicitlyAcceptsJson("application/json; q=0.000"), false);
  assert.equal(
    explicitlyAcceptsJson('application/json; profile="a,b"; q=0'),
    false,
  );
  assert.equal(explicitlyAcceptsJson("application/json;q=2"), false);
  assert.equal(explicitlyAcceptsJson("application/json;q=0;q=1"), false);
  assert.equal(explicitlyAcceptsJson("*/*"), false);
  assert.equal(explicitlyAcceptsJson(null), false);
});
