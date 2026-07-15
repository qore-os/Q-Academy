import assert from "node:assert/strict";
import test from "node:test";

import {
  InvalidHttpByteRangeError,
  parseHttpByteRange,
} from "../src/lib/media/http-byte-range";

test("parseHttpByteRange parses bounded, open, and suffix ranges", () => {
  assert.deepEqual(parseHttpByteRange("bytes=10-19", 100), {
    start: 10,
    end: 19,
  });
  assert.deepEqual(parseHttpByteRange("bytes=90-", 100), {
    start: 90,
    end: 99,
  });
  assert.deepEqual(parseHttpByteRange("bytes=-12", 100), {
    start: 88,
    end: 99,
  });
  assert.deepEqual(parseHttpByteRange("bytes=90-200", 100), {
    start: 90,
    end: 99,
  });
  assert.deepEqual(parseHttpByteRange("bytes=0-1,4-5", 100), {
    start: 0,
    end: 1,
  });
  assert.deepEqual(parseHttpByteRange("bytes=200-300,4-5", 100), {
    start: 4,
    end: 5,
  });
  assert.equal(parseHttpByteRange(null, 100), null);
});

test("parseHttpByteRange rejects malformed and unsatisfiable ranges", () => {
  for (const value of [
    "bytes=",
    "bytes=20-10",
    "bytes=100-",
    "bytes=-0",
    "items=0-1",
  ]) {
    assert.throws(
      () => parseHttpByteRange(value, 100),
      InvalidHttpByteRangeError,
    );
  }
});
