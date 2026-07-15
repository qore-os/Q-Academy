import assert from "node:assert/strict";
import test from "node:test";
import {
  BoundedJsonError,
  measureBoundedJsonBytes,
  stringifyBoundedJson,
} from "../src/lib/privacy/bounded-json";

function errorCode(error: unknown) {
  return error instanceof BoundedJsonError ? error.code : null;
}

test("bounded JSON exactly matches native pretty JSON for plain export data", () => {
  const value = {
    text: "quote:\" slash:\\ control:\u0000 euro:\u20ac pair:\ud83d\ude00 lone:\ud800",
    date: new Date("2026-07-14T12:34:56.000Z"),
    number: -0,
    nonFinite: Number.POSITIVE_INFINITY,
    omitted: undefined,
    nested: [true, null, , undefined, { value: "ok" }],
  };
  const expected = `${JSON.stringify(value, null, 2)}\n`;
  const encoded = stringifyBoundedJson(value, {
    maxBytes: Buffer.byteLength(expected),
    space: 2,
    trailingNewline: true,
  });
  assert.equal(encoded.json, expected);
  assert.equal(encoded.sizeBytes, Buffer.byteLength(expected));
  assert.equal(
    measureBoundedJsonBytes(value, {
      maxBytes: encoded.sizeBytes,
      space: 2,
      trailingNewline: true,
    }),
    encoded.sizeBytes,
  );
});

test("bounded JSON rejects the value before native serialization exceeds the limit", () => {
  const value = { payload: "x".repeat(64 * 1024) };
  assert.throws(
    () => stringifyBoundedJson(value, { maxBytes: 1_024 }),
    (error) => errorCode(error) === "size_exceeded",
  );
});

test("bounded JSON rejects enumerable and non-enumerable custom toJSON", () => {
  for (const enumerable of [false, true]) {
    const value = { safe: true };
    Object.defineProperty(value, "toJSON", {
      configurable: true,
      enumerable,
      value: () => "x".repeat(64 * 1024),
    });
    assert.throws(
      () => stringifyBoundedJson(value, { maxBytes: 1_024 }),
      (error) => errorCode(error) === "invalid_value",
    );
  }
});

test("bounded JSON rejects accessors, circular values and modified dates", () => {
  const accessor = {};
  Object.defineProperty(accessor, "value", {
    enumerable: true,
    get: () => "unsafe",
  });
  assert.throws(
    () => stringifyBoundedJson(accessor, { maxBytes: 1_024 }),
    (error) => errorCode(error) === "invalid_value",
  );

  const circular: { self?: unknown } = {};
  circular.self = circular;
  assert.throws(
    () => stringifyBoundedJson(circular, { maxBytes: 1_024 }),
    (error) => errorCode(error) === "invalid_value",
  );

  const modified = new Date("2026-07-14T12:34:56.000Z");
  Object.defineProperty(modified, "toJSON", { value: () => "unsafe" });
  assert.throws(
    () => stringifyBoundedJson(modified, { maxBytes: 1_024 }),
    (error) => errorCode(error) === "invalid_value",
  );
});

test("bounded JSON rejects proxies before native serialization", () => {
  const value = new Proxy(
    { payload: "safe" },
    {
      get(target, property, receiver) {
        if (property === "toJSON") {
          return () => "x".repeat(64 * 1024);
        }
        return Reflect.get(target, property, receiver);
      },
    },
  );
  assert.throws(
    () => stringifyBoundedJson(value, { maxBytes: 1_024 }),
    (error) => errorCode(error) === "invalid_value",
  );
});

test("bounded JSON accepts safe Array subclasses and ignores their metadata", () => {
  class ResultLike<T> extends Array<T> {}
  const rows = new ResultLike<{ id: number }>();
  rows.push({ id: 1 }, { id: 2 });
  Object.defineProperty(rows, "columns", {
    enumerable: true,
    value: [{ name: "id", type: 23 }],
  });
  const expected = JSON.stringify(rows, null, 2);
  const encoded = stringifyBoundedJson(rows, {
    maxBytes: Buffer.byteLength(expected),
    space: 2,
  });
  assert.equal(encoded.json, expected);
  assert.equal(encoded.sizeBytes, Buffer.byteLength(expected));
});

test("bounded JSON rejects executable or index-bearing Array subclasses", () => {
  class CustomEncoder<T> extends Array<T> {
    toJSON() {
      return "x".repeat(64 * 1024);
    }
  }
  const customEncoder = new CustomEncoder<string>();
  customEncoder.push("safe");
  assert.throws(
    () => stringifyBoundedJson(customEncoder, { maxBytes: 1_024 }),
    (error) => errorCode(error) === "invalid_value",
  );

  class IndexedPrototype<T> extends Array<T> {}
  Object.defineProperty(IndexedPrototype.prototype, "0", {
    configurable: true,
    get: () => "unsafe",
  });
  const indexed = new IndexedPrototype<string>(1);
  assert.throws(
    () => stringifyBoundedJson(indexed, { maxBytes: 1_024 }),
    (error) => errorCode(error) === "invalid_value",
  );
});
